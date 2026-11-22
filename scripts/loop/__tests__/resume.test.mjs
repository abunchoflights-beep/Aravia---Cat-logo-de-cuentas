import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

import {
  classifyAgentapiError,
  extractErrorMessage,
  isConversationLost,
} from "../lib/classifier.mjs";
import { appendMetric, computeMetricsSummary, readMetrics } from "../lib/metrics.mjs";
import {
  canResumeTask,
  checkWaitStatus,
  formatResumePrompt,
  getExpectedRound,
  markConversationLost,
  prepareTaskForResume,
} from "../lib/rounds.mjs";
import { filterQueueByWip } from "../lib/wip.mjs";

const SCRIPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOOP_MJS = path.join(SCRIPT_DIR, "loop.mjs");

describe("1. Agentapi error classifier", () => {
  it("matches 'trajectory not found: <id>' as conversation_lost", () => {
    const err = "trajectory not found: b3b68cbd-9aaa-4d47-88ab-68b8d174c84a";
    expect(isConversationLost(err)).toBe(true);
    const result = classifyAgentapiError(err);
    expect(result.kind).toBe("conversation_lost");
    expect(result.isLost).toBe(true);
    expect(result.isWrongServer).toBe(false);
  });

  it("matches 'not found' as conversation_lost", () => {
    expect(isConversationLost("not found")).toBe(true);
    expect(isConversationLost("error: not found")).toBe(true);
    expect(isConversationLost({ error: "trajectory not found: 123" })).toBe(true);
    expect(isConversationLost({ err: "conversation not found: conv-456" })).toBe(true);
  });

  it("extracts error message from various error shapes", () => {
    expect(extractErrorMessage("simple error")).toBe("simple error");
    expect(extractErrorMessage({ err: "from err" })).toBe("from err");
    expect(extractErrorMessage({ error: "from error" })).toBe("from error");
    expect(extractErrorMessage({ message: "from message" })).toBe("from message");
    expect(extractErrorMessage({ json: { error: "from json.error" } })).toBe("from json.error");
  });

  it("rejects unrelated errors (connection refused, timeouts, etc.)", () => {
    expect(isConversationLost("connection refused: 127.0.0.1:55000")).toBe(false);
    expect(isConversationLost("socket hang up")).toBe(false);
    expect(isConversationLost("timeout 120000ms exceeded")).toBe(false);
    expect(isConversationLost(null)).toBe(false);
    expect(isConversationLost("")).toBe(false);
  });

  it("rejects WRONG_SERVER errors (projectsStore is nil / project_id is required)", () => {
    const err = "projectsStore is nil";
    expect(isConversationLost(err)).toBe(false);
    const result = classifyAgentapiError(err);
    expect(result.kind).toBe("wrong_server");
    expect(result.isLost).toBe(false);
    expect(result.isWrongServer).toBe(true);

    expect(isConversationLost("project_id is required")).toBe(false);
  });

  it("classifies as lost only when the owning server says so", () => {
    const err = "trajectory not found: b3b68cbd-9aaa-4d47-88ab-68b8d174c84a";

    // Called against wrong server (call was sent to "env" but conversation owned by "config")
    const wrongServerContext = { server: "env", owningServer: "config" };
    expect(isConversationLost(err, wrongServerContext)).toBe(false);
    expect(classifyAgentapiError(err, wrongServerContext).kind).toBe("wrong_server");

    // Explicit isOwningServer: false flag
    expect(isConversationLost(err, { isOwningServer: false })).toBe(false);

    // Called against owning server ("config" == "config")
    const owningServerContext = { server: "config", owningServer: "config" };
    expect(isConversationLost(err, owningServerContext)).toBe(true);
    expect(classifyAgentapiError(err, owningServerContext).kind).toBe("conversation_lost");

    // Explicit isOwningServer: true flag
    expect(isConversationLost(err, { isOwningServer: true })).toBe(true);
  });
});

describe("2. State transitions", () => {
  it("transitions to conversation_lost with lostAt and error recorded", () => {
    const state = {
      taskId: "task-test",
      status: "running",
      conversationId: "conv-1",
      round: 1,
    };
    const at = "2026-10-20T23:00:00.000Z";
    const errorMsg = "trajectory not found: conv-1";

    markConversationLost({ state, error: errorMsg, at });

    expect(state.status).toBe("conversation_lost");
    expect(state.lostAt).toBe(at);
    expect(state.lostError).toBe(errorMsg);
    expect(state.error).toBe(errorMsg);
  });

  it("prepares task for resume: updates status, archives previous conversation, clears lost flags", () => {
    const state = {
      taskId: "task-test",
      status: "conversation_lost",
      conversationId: "conv-old-1",
      round: 1,
      lostAt: "2026-10-20T22:00:00.000Z",
      lostError: "trajectory not found: conv-old-1",
      history: [{ op: "new", ok: true }],
    };

    const at = "2026-10-20T23:30:00.000Z";
    prepareTaskForResume({
      state,
      newConversationId: "conv-new-2",
      server: "config",
      round: 1,
      at,
    });

    expect(state.status).toBe("running");
    expect(state.conversationId).toBe("conv-new-2");
    expect(state.previousConversations).toEqual(["conv-old-1"]);
    expect(state.server).toBe("config");
    expect(state.round).toBe(1);
    expect(state.roundStartedAt).toBe(at);
    expect(state.lostAt).toBeUndefined();
    expect(state.lostError).toBeUndefined();
    // History is preserved
    expect(state.history).toHaveLength(1);

    // Resuming again adds the second conversation to previousConversations without duplicating
    prepareTaskForResume({
      state,
      newConversationId: "conv-new-3",
      server: "env",
      round: 2,
    });
    expect(state.previousConversations).toEqual(["conv-old-1", "conv-new-2"]);
    expect(state.conversationId).toBe("conv-new-3");
    expect(state.server).toBe("env");
    expect(state.round).toBe(2);
  });
});

describe("3. Wait command exit on conversation_lost", () => {
  it("checkWaitStatus returns exit_error immediately when status is conversation_lost", () => {
    const state = {
      status: "conversation_lost",
      lostError: "trajectory not found: conv-xyz",
    };
    const res = checkWaitStatus({ state, report: { status: null }, isDelivering: false });
    expect(res.action).toBe("exit_error");
    expect(res.status).toBe("conversation_lost");
    expect(res.reason).toBe("trajectory not found: conv-xyz");
  });

  it("checkWaitStatus returns exit_error even when isDelivering is true", () => {
    const state = {
      status: "conversation_lost",
      lostError: "trajectory not found: conv-xyz",
      round: 0,
    };
    // Even if expectedRound > state.round, lost conversation must exit immediately
    const res = checkWaitStatus({ state, report: { status: null }, isDelivering: true });
    expect(res.action).toBe("exit_error");
    expect(res.status).toBe("conversation_lost");
  });

  it("CLI: wait exits non-zero with conversation_lost message instead of timing out", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-wait-test-"));
    try {
      const taskDir = path.join(tmp, "tasks", "task-lost");
      fs.mkdirSync(taskDir, { recursive: true });

      fs.writeFileSync(
        path.join(taskDir, "task.json"),
        JSON.stringify({ taskId: "task-lost", createdAt: new Date().toISOString() }, null, 2),
      );

      fs.writeFileSync(
        path.join(taskDir, "state.json"),
        JSON.stringify(
          {
            taskId: "task-lost",
            status: "conversation_lost",
            lostError: "trajectory not found: conv-lost-123",
          },
          null,
          2,
        ),
      );

      // Run loop.mjs wait task-lost with a 10-second timeout; should exit immediately
      const start = Date.now();
      const res = spawnSync(process.execPath, [LOOP_MJS, "wait", "task-lost", "--timeout", "10"], {
        cwd: SCRIPT_DIR,
        env: { ...process.env, LOOP_DIR: tmp },
        encoding: "utf8",
      });
      const elapsed = Date.now() - start;

      // Must exit non-zero
      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain("conversation_lost");
      expect(res.stderr).toContain("trajectory not found: conv-lost-123");
      // Must not wait for the 10s timeout
      expect(elapsed).toBeLessThan(5000);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("4. Resume prompt, round keeping, and history preservation", () => {
  it("formats prompt for round 0 (mentions brief.md, no feedback-N.md)", () => {
    const prompt = formatResumePrompt({ taskId: "task-abc", round: 0, taskDir: "/path/to/task" });
    expect(prompt).toContain("This resumes task task-abc in round 0:");
    expect(prompt).toContain("read brief.md at");
    expect(prompt).toContain(
      "check git log and git status in the worktree for what is already done",
    );
    expect(prompt).toContain("finish, and write report-0.md");
    expect(prompt).not.toContain("feedback");
  });

  it("formats prompt for round N > 0 (mentions brief.md AND feedback-N.md)", () => {
    const prompt = formatResumePrompt({ taskId: "task-abc", round: 2, taskDir: "/path/to/task" });
    expect(prompt).toContain("This resumes task task-abc in round 2:");
    expect(prompt).toContain("read brief.md at");
    expect(prompt).toContain("feedback-2.md at");
    expect(prompt).toContain(
      "check git log and git status in the worktree for what is already done",
    );
    expect(prompt).toContain("finish, and write report-2.md");
  });

  it("determines expected round correctly using getExpectedRound", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-resume-round-"));
    try {
      const state = { taskId: "task-r", round: 0 };
      expect(getExpectedRound(state, tmp)).toBe(0);

      // When feedback-1.md exists on disk
      fs.writeFileSync(path.join(tmp, "feedback-1.md"), "fix this");
      expect(getExpectedRound(state, tmp)).toBe(1);

      // When state is already at round 2
      state.round = 2;
      expect(getExpectedRound(state, tmp)).toBe(2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("5. Refuse to resume closed tasks", () => {
  it("canResumeTask allows running, conversation_lost, dispatch_failed", () => {
    expect(canResumeTask({ status: "running" }).allowed).toBe(true);
    expect(canResumeTask({ status: "conversation_lost" }).allowed).toBe(true);
    expect(canResumeTask({ status: "dispatch_failed" }).allowed).toBe(true);
    expect(canResumeTask({ status: "send_failed" }).allowed).toBe(true);
  });

  it("canResumeTask refuses merged and abandoned tasks", () => {
    const merged = canResumeTask({ status: "merged" });
    expect(merged.allowed).toBe(false);
    expect(merged.reason).toContain('"merged"');

    const abandoned = canResumeTask({ status: "abandoned" });
    expect(abandoned.allowed).toBe(false);
    expect(abandoned.reason).toContain('"abandoned"');
  });

  it("CLI: loop.mjs resume refuses merged tasks with non-zero exit", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-cli-resume-"));
    try {
      const taskDir = path.join(tmp, "tasks", "task-closed");
      fs.mkdirSync(taskDir, { recursive: true });

      fs.writeFileSync(
        path.join(taskDir, "task.json"),
        JSON.stringify({ taskId: "task-closed", createdAt: new Date().toISOString() }, null, 2),
      );
      fs.writeFileSync(
        path.join(taskDir, "state.json"),
        JSON.stringify({ taskId: "task-closed", status: "merged" }, null, 2),
      );

      const res = spawnSync(process.execPath, [LOOP_MJS, "resume", "task-closed"], {
        cwd: tmp,
        env: { ...process.env, LOOP_DIR: tmp },
        encoding: "utf8",
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('Cannot resume task with status "merged"');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CLI: loop.mjs resume refuses abandoned tasks with non-zero exit", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-cli-resume-"));
    try {
      const taskDir = path.join(tmp, "tasks", "task-abandoned");
      fs.mkdirSync(taskDir, { recursive: true });

      fs.writeFileSync(
        path.join(taskDir, "task.json"),
        JSON.stringify({ taskId: "task-abandoned", createdAt: new Date().toISOString() }, null, 2),
      );
      fs.writeFileSync(
        path.join(taskDir, "state.json"),
        JSON.stringify({ taskId: "task-abandoned", status: "abandoned" }, null, 2),
      );

      const res = spawnSync(process.execPath, [LOOP_MJS, "resume", "task-abandoned"], {
        cwd: tmp,
        env: { ...process.env, LOOP_DIR: tmp },
        encoding: "utf8",
      });

      expect(res.status).not.toBe(0);
      expect(res.stderr).toContain('Cannot resume task with status "abandoned"');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CLI: loop.mjs resume enqueues resume job with expected round and prompt", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-cli-resume-success-"));
    try {
      const taskDir = path.join(tmp, "tasks", "task-open");
      fs.mkdirSync(taskDir, { recursive: true });

      fs.writeFileSync(
        path.join(taskDir, "task.json"),
        JSON.stringify({ taskId: "task-open", createdAt: new Date().toISOString() }, null, 2),
      );
      fs.writeFileSync(
        path.join(taskDir, "state.json"),
        JSON.stringify({ taskId: "task-open", status: "conversation_lost", round: 1 }, null, 2),
      );
      fs.writeFileSync(path.join(taskDir, "brief.md"), "# Brief\n");
      fs.writeFileSync(path.join(taskDir, "feedback-1.md"), "# Feedback 1\n");

      const res = spawnSync(process.execPath, [LOOP_MJS, "resume", "task-open"], {
        cwd: tmp,
        env: { ...process.env, LOOP_DIR: tmp },
        encoding: "utf8",
      });

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("queued resume for task-open (round 1)");

      // Check queue file was created
      const queueDir = path.join(tmp, "queue");
      const files = fs.readdirSync(queueDir);
      expect(files.length).toBe(1);
      const job = JSON.parse(fs.readFileSync(path.join(queueDir, files[0]), "utf8"));
      expect(job.op).toBe("resume");
      expect(job.taskId).toBe("task-open");
      expect(job.round).toBe(1);
      expect(job.prompt).toContain("This resumes task task-open in round 1:");
      expect(job.prompt).toContain("feedback-1.md");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("6. Resume WIP limit handling", () => {
  it("counts 'resume' jobs against WIP like 'new' jobs", () => {
    const queue = [
      { op: "resume", taskId: "task-resume-1", round: 1 },
      { op: "new", taskId: "task-new-2", round: 0 },
    ];

    // With 0 running and maxParallel = 1, first resume job runs, second is blocked
    const step1 = filterQueueByWip(queue, 0, 1);
    expect(step1.runnable).toHaveLength(1);
    expect(step1.runnable[0].taskId).toBe("task-resume-1");
    expect(step1.blocked).toHaveLength(1);
    expect(step1.blocked[0].taskId).toBe("task-new-2");

    // With 1 running and maxParallel = 1, resume job is blocked by WIP limit
    const step2 = filterQueueByWip(queue, 1, 1);
    expect(step2.runnable).toHaveLength(0);
    expect(step2.blocked).toHaveLength(2);
  });
});

describe("7. Metrics for conversation_lost and resumed", () => {
  it("appends and parses conversation_lost and resumed metrics", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-metrics-test-"));
    try {
      appendMetric(tmp, {
        event: "dispatched",
        taskId: "task-m",
        model: "pro",
      });
      appendMetric(tmp, {
        event: "conversation_lost",
        taskId: "task-m",
        round: 1,
        error: "trajectory not found: conv-m",
      });

      let events = readMetrics(tmp);
      expect(events).toHaveLength(2);
      expect(events[1].event).toBe("conversation_lost");
      expect(events[1].error).toBe("trajectory not found: conv-m");

      let summary = computeMetricsSummary(events);
      expect(summary.tasks[0].status).toBe("conversation_lost");

      // Now resumed
      appendMetric(tmp, {
        event: "resumed",
        taskId: "task-m",
        round: 1,
        model: "pro",
      });

      events = readMetrics(tmp);
      expect(events).toHaveLength(3);
      expect(events[2].event).toBe("resumed");

      summary = computeMetricsSummary(events);
      expect(summary.tasks[0].status).toBe("active");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
