import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  checkActiveTasksBudgetAndReports,
  checkActiveTasksStall,
  handleJob,
  refreshMetadata,
} from "../lib/bridge-passes.mjs";
import { getStatePath, isTaskClosed, readState, updateState, writeState } from "../lib/state.mjs";

function setupTempLoop() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-state-test-"));
  const tasksDir = path.join(tmpDir, "tasks");
  const loopDir = tmpDir;
  fs.mkdirSync(tasksDir, { recursive: true });

  const cleanup = () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };

  return { tmpDir, tasksDir, loopDir, cleanup };
}

describe("1. updateState atomic updates and helpers", () => {
  it("isTaskClosed identifies merged and abandoned tasks", () => {
    expect(isTaskClosed({ status: "merged" })).toBe(true);
    expect(isTaskClosed({ status: "abandoned" })).toBe(true);
    expect(isTaskClosed({ status: "running" })).toBe(false);
    expect(isTaskClosed({ status: "stalled" })).toBe(false);
    expect(isTaskClosed({ status: "over_budget" })).toBe(false);
    expect(isTaskClosed(null)).toBe(false);
    expect(isTaskClosed(undefined)).toBe(false);
  });

  it("updateState re-reads disk and applies mutations to the fresh copy", () => {
    const { tasksDir, cleanup } = setupTempLoop();
    try {
      const id = "task-fresh-1";
      writeState(id, { taskId: id, count: 1, originalField: "initial" }, { tasksDir });

      // First update
      updateState(
        id,
        (fresh) => {
          fresh.count += 1;
        },
        { tasksDir },
      );
      expect(readState(id, { tasksDir }).count).toBe(2);

      // Concurrent write to disk from an external process
      writeState(
        id,
        { taskId: id, count: 10, concurrentField: "updated-externally" },
        { tasksDir },
      );

      // updateState reads fresh state (count: 10, concurrentField present)
      const res = updateState(
        id,
        (fresh) => {
          fresh.count += 5;
          fresh.addedByWorker = true;
        },
        { tasksDir },
      );

      expect(res.count).toBe(15);
      expect(res.concurrentField).toBe("updated-externally");
      expect(res.addedByWorker).toBe(true);

      const onDisk = readState(id, { tasksDir });
      expect(onDisk.count).toBe(15);
      expect(onDisk.concurrentField).toBe("updated-externally");
      expect(onDisk.addedByWorker).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("updateState aborts writing when mutate returns false", () => {
    const { tasksDir, cleanup } = setupTempLoop();
    try {
      const id = "task-abort-write";
      writeState(id, { taskId: id, status: "merged" }, { tasksDir });

      const statePath = getStatePath(id, { tasksDir });
      const mtimeBefore = fs.statSync(statePath).mtimeMs;

      const res = updateState(
        id,
        (fresh) => {
          if (isTaskClosed(fresh)) return false;
          fresh.status = "running";
        },
        { tasksDir },
      );

      expect(res.status).toBe("merged");
      const onDisk = readState(id, { tasksDir });
      expect(onDisk.status).toBe("merged");
      expect(fs.statSync(statePath).mtimeMs).toBe(mtimeBefore);
    } finally {
      cleanup();
    }
  });

  it("updateState supports mock fsModule injection", () => {
    const mockStore = new Map();
    const mockFs = {
      readFileSync: vi.fn((file) => {
        if (!mockStore.has(file)) throw new Error("ENOENT");
        return mockStore.get(file);
      }),
      writeFileSync: vi.fn((file, data) => {
        mockStore.set(file, data);
      }),
      mkdirSync: vi.fn(),
    };

    const targetDir = "/virtual/loop/tasks";
    writeState(
      "mock-task",
      { taskId: "mock-task", val: 42 },
      { fsModule: mockFs, tasksDir: targetDir },
    );
    expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);

    const updated = updateState(
      "mock-task",
      (fresh) => {
        fresh.val += 8;
      },
      { fsModule: mockFs, tasksDir: targetDir },
    );

    expect(updated.val).toBe(50);
    expect(mockFs.readFileSync).toHaveBeenCalled();
  });
});

describe("2. Concurrent close during pending agentapi call is not overwritten", () => {
  it("does not overwrite close occurring during a pending 'send' agentapi call", async () => {
    const { tasksDir, loopDir, cleanup } = setupTempLoop();
    try {
      const id = "task-race-send";
      writeState(
        id,
        {
          taskId: id,
          status: "running",
          server: "env",
          conversationId: "conv-race-send",
          round: 1,
          history: [],
        },
        { tasksDir },
      );

      let resolveAgentapi;
      const pendingPromise = new Promise((resolve) => {
        resolveAgentapi = resolve;
      });
      const mockAgentapi = vi.fn().mockReturnValue(pendingPromise);
      const logs = [];
      const log = (taskId, msg) => logs.push(`${taskId}: ${msg}`);
      const mockAppendMetric = vi.fn();

      // Launch send job (awaits agentapi)
      const jobPromise = handleJob(
        { op: "send", taskId: id, prompt: "please fix feedback", round: 1 },
        {
          tasksDir,
          loopDir,
          agentapi: mockAgentapi,
          log,
          appendMetric: mockAppendMetric,
        },
      );

      // Verify agentapi is called and pending
      expect(mockAgentapi).toHaveBeenCalledWith(
        ["send-message", "conv-race-send", "please fix feedback"],
        { preferConfig: false },
      );

      // Simulate concurrent close by human or CLI: loop.mjs close task-race-send --abandoned
      writeState(
        id,
        {
          taskId: id,
          status: "abandoned",
          closedAt: "2026-10-21T03:30:00.000Z",
          closeReason: "abandoned",
        },
        { tasksDir },
      );

      // Agentapi call completes after the close
      resolveAgentapi({ ok: true, out: "response received", json: { text: "working on it" } });
      await jobPromise;

      // Assert: task on disk is STILL abandoned, NOT resurrected to running!
      const finalState = readState(id, { tasksDir });
      expect(finalState.status).toBe("abandoned");
      expect(finalState.closedAt).toBe("2026-10-21T03:30:00.000Z");
      expect(logs.some((l) => l.includes("task was closed (abandoned) during send-message"))).toBe(
        true,
      );
      expect(mockAppendMetric).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("does not overwrite close occurring during a pending 'new' agentapi call", async () => {
    const { tasksDir, loopDir, cleanup } = setupTempLoop();
    try {
      const id = "task-race-new";
      writeState(id, { taskId: id, status: "queued", round: 0, history: [] }, { tasksDir });

      let resolveAgentapi;
      const pendingPromise = new Promise((resolve) => {
        resolveAgentapi = resolve;
      });
      const mockAgentapi = vi.fn().mockReturnValue(pendingPromise);
      const logs = [];
      const log = (taskId, msg) => logs.push(`${taskId}: ${msg}`);
      const mockAppendMetric = vi.fn();

      const jobPromise = handleJob(
        { op: "new", taskId: id, prompt: "initial brief", round: 0, model: "pro" },
        {
          tasksDir,
          loopDir,
          agentapi: mockAgentapi,
          log,
          appendMetric: mockAppendMetric,
        },
      );

      // Task is closed as merged concurrently
      writeState(
        id,
        {
          taskId: id,
          status: "merged",
          closedAt: "2026-10-21T03:31:00.000Z",
          closeReason: "merged",
        },
        { tasksDir },
      );

      resolveAgentapi({
        ok: true,
        out: "conv created",
        json: { conversation_id: "conv-race-new-123" },
      });
      await jobPromise;

      const finalState = readState(id, { tasksDir });
      expect(finalState.status).toBe("merged");
      expect(logs.some((l) => l.includes("task was closed (merged) during new-conversation"))).toBe(
        true,
      );
      expect(mockAppendMetric).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("does not overwrite close occurring during a pending 'resume' agentapi call", async () => {
    const { tasksDir, loopDir, cleanup } = setupTempLoop();
    try {
      const id = "task-race-resume";
      writeState(
        id,
        {
          taskId: id,
          status: "conversation_lost",
          conversationId: "lost-conv",
          round: 2,
          history: [],
        },
        { tasksDir },
      );

      let resolveAgentapi;
      const pendingPromise = new Promise((resolve) => {
        resolveAgentapi = resolve;
      });
      const mockAgentapi = vi.fn().mockReturnValue(pendingPromise);
      const logs = [];
      const log = (taskId, msg) => logs.push(`${taskId}: ${msg}`);
      const mockAppendMetric = vi.fn();

      const jobPromise = handleJob(
        { op: "resume", taskId: id, prompt: "resume instructions", round: 2 },
        {
          tasksDir,
          loopDir,
          agentapi: mockAgentapi,
          log,
          appendMetric: mockAppendMetric,
        },
      );

      // Closed concurrently
      writeState(
        id,
        {
          taskId: id,
          status: "abandoned",
          closedAt: "2026-10-21T03:32:00.000Z",
          closeReason: "abandoned",
        },
        { tasksDir },
      );

      resolveAgentapi({
        ok: true,
        out: "conv resumed",
        json: { conversation_id: "conv-resumed-456" },
      });
      await jobPromise;

      const finalState = readState(id, { tasksDir });
      expect(finalState.status).toBe("abandoned");
      expect(logs.some((l) => l.includes("task was closed (abandoned) during resume"))).toBe(true);
      expect(mockAppendMetric).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it("does not overwrite close occurring during a pending auto-nudge in stall evaluation", async () => {
    const { tasksDir, loopDir, cleanup } = setupTempLoop();
    try {
      const id = "task-race-nudge";
      const now = Date.now();
      const taskDir = path.join(tasksDir, id);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, "task.json"),
        JSON.stringify({ taskId: id, createdAt: new Date(now - 60 * 60000).toISOString() }),
      );

      writeState(
        id,
        {
          taskId: id,
          status: "running",
          conversationId: "conv-nudge-race",
          round: 0,
          roundStartedAt: new Date(now - 30 * 60000).toISOString(),
          history: [],
        },
        { tasksDir },
      );

      let resolveAgentapi;
      const pendingPromise = new Promise((resolve) => {
        resolveAgentapi = resolve;
      });
      const mockAgentapi = vi.fn().mockReturnValue(pendingPromise);
      const logs = [];
      const log = (taskId, msg) => logs.push(`${taskId}: ${msg}`);
      const mockAppendMetric = vi.fn();

      const stallPromise = checkActiveTasksStall({
        tasksDir,
        loopDir,
        agentapi: mockAgentapi,
        log,
        appendMetric: mockAppendMetric,
        now,
        walkFiles: () => [], // Inactive: stall triggers nudge
      });

      expect(mockAgentapi).toHaveBeenCalled();

      // Closed during the nudge send-message call
      writeState(
        id,
        {
          taskId: id,
          status: "abandoned",
          closedAt: new Date().toISOString(),
          closeReason: "abandoned",
        },
        { tasksDir },
      );

      resolveAgentapi({ ok: true, out: "nudge delivered" });
      await stallPromise;

      const finalState = readState(id, { tasksDir });
      expect(finalState.status).toBe("abandoned");
      expect(finalState.nudgedAt).toBeUndefined();
      expect(logs.some((l) => l.includes("task was closed (abandoned) during nudge"))).toBe(true);
      expect(mockAppendMetric).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });
});

describe("3. Closed tasks are inert across all bridge passes", () => {
  it("checkActiveTasksBudgetAndReports skips closed tasks (no budget checks, no reports, no writes)", () => {
    const { tasksDir, cleanup } = setupTempLoop();
    try {
      const now = Date.now();
      const twoHoursAgo = new Date(now - 120 * 60000).toISOString();

      // Task 1: Open task, over budget (budget: 60m, elapsed: 120m)
      const openId = "task-open";
      fs.mkdirSync(path.join(tasksDir, openId), { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, openId, "task.json"),
        JSON.stringify({ taskId: openId, budgetMinutes: 60, createdAt: twoHoursAgo }),
      );
      writeState(
        openId,
        { taskId: openId, status: "running", roundStartedAt: twoHoursAgo },
        { tasksDir },
      );

      // Task 2: Merged task, elapsed 120m
      const mergedId = "task-merged";
      fs.mkdirSync(path.join(tasksDir, mergedId), { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, mergedId, "task.json"),
        JSON.stringify({ taskId: mergedId, budgetMinutes: 60, createdAt: twoHoursAgo }),
      );
      writeState(
        mergedId,
        { taskId: mergedId, status: "merged", closedAt: twoHoursAgo },
        { tasksDir },
      );

      // Task 3: Abandoned task, elapsed 120m
      const abandonedId = "task-abandoned";
      fs.mkdirSync(path.join(tasksDir, abandonedId), { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, abandonedId, "task.json"),
        JSON.stringify({ taskId: abandonedId, budgetMinutes: 60, createdAt: twoHoursAgo }),
      );
      writeState(
        abandonedId,
        { taskId: abandonedId, status: "abandoned", closedAt: twoHoursAgo },
        { tasksDir },
      );

      checkActiveTasksBudgetAndReports({ tasksDir, now });

      // open task marked over_budget
      expect(readState(openId, { tasksDir }).status).toBe("over_budget");
      expect(readState(openId, { tasksDir }).overBudgetAt).toBeDefined();

      // merged and abandoned tasks remain inert
      const mergedState = readState(mergedId, { tasksDir });
      expect(mergedState.status).toBe("merged");
      expect(mergedState.overBudgetAt).toBeUndefined();

      const abandonedState = readState(abandonedId, { tasksDir });
      expect(abandonedState.status).toBe("abandoned");
      expect(abandonedState.overBudgetAt).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("checkActiveTasksStall skips closed tasks (no stall evaluation, no nudges, no writes)", async () => {
    const { tasksDir, cleanup } = setupTempLoop();
    try {
      const now = Date.now();
      const thirtyMinsAgo = new Date(now - 30 * 60000).toISOString();

      // Open task
      const openId = "task-stall-open";
      fs.mkdirSync(path.join(tasksDir, openId), { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, openId, "task.json"),
        JSON.stringify({ taskId: openId, createdAt: thirtyMinsAgo }),
      );
      writeState(
        openId,
        {
          taskId: openId,
          status: "running",
          conversationId: "conv-open-1",
          roundStartedAt: thirtyMinsAgo,
        },
        { tasksDir },
      );

      // Closed tasks
      const mergedId = "task-stall-merged";
      fs.mkdirSync(path.join(tasksDir, mergedId), { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, mergedId, "task.json"),
        JSON.stringify({ taskId: mergedId, createdAt: thirtyMinsAgo }),
      );
      writeState(
        mergedId,
        {
          taskId: mergedId,
          status: "merged",
          conversationId: "conv-merged-1",
          closedAt: thirtyMinsAgo,
        },
        { tasksDir },
      );

      const abandonedId = "task-stall-abandoned";
      fs.mkdirSync(path.join(tasksDir, abandonedId), { recursive: true });
      fs.writeFileSync(
        path.join(tasksDir, abandonedId, "task.json"),
        JSON.stringify({ taskId: abandonedId, createdAt: thirtyMinsAgo }),
      );
      writeState(
        abandonedId,
        {
          taskId: abandonedId,
          status: "abandoned",
          conversationId: "conv-abandoned-1",
          closedAt: thirtyMinsAgo,
        },
        { tasksDir },
      );

      const mockAgentapi = vi.fn().mockResolvedValue({ ok: true, out: "nudge ok" });
      await checkActiveTasksStall({
        tasksDir,
        agentapi: mockAgentapi,
        now,
        walkFiles: () => [], // triggers nudge
      });

      // Agentapi was called for open task ONLY
      expect(mockAgentapi).toHaveBeenCalledTimes(1);
      expect(mockAgentapi).toHaveBeenCalledWith(
        expect.arrayContaining(["send-message", "conv-open-1"]),
        expect.any(Object),
      );

      expect(readState(openId, { tasksDir }).nudgedAt).toBeDefined();
      expect(readState(mergedId, { tasksDir }).nudgedAt).toBeUndefined();
      expect(readState(abandonedId, { tasksDir }).nudgedAt).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("refreshMetadata skips closed tasks (no metadata calls, no writes)", async () => {
    const { tasksDir, cleanup } = setupTempLoop();
    try {
      const openId = "task-meta-open";
      writeState(
        openId,
        { taskId: openId, status: "running", conversationId: "conv-open" },
        { tasksDir },
      );

      const mergedId = "task-meta-merged";
      writeState(
        mergedId,
        { taskId: mergedId, status: "merged", conversationId: "conv-merged" },
        { tasksDir },
      );

      const abandonedId = "task-meta-abandoned";
      writeState(
        abandonedId,
        { taskId: abandonedId, status: "abandoned", conversationId: "conv-abandoned" },
        { tasksDir },
      );

      const mockAgentapi = vi.fn().mockResolvedValue({ ok: true, json: { title: "meta" } });
      await refreshMetadata({
        tasksDir,
        agentapi: mockAgentapi,
        now: Date.now(),
        metadataEveryMs: 0,
        metadataState: { lastMetadata: 0 },
      });

      expect(mockAgentapi).toHaveBeenCalledTimes(1);
      expect(mockAgentapi).toHaveBeenCalledWith(
        ["get-conversation-metadata", "conv-open"],
        expect.any(Object),
      );

      expect(readState(openId, { tasksDir }).metadata).toEqual({ title: "meta" });
      expect(readState(mergedId, { tasksDir }).metadata).toBeUndefined();
      expect(readState(abandonedId, { tasksDir }).metadata).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("handleJob refuses send, resume, and new jobs for closed tasks with a log line", async () => {
    const { tasksDir, cleanup } = setupTempLoop();
    try {
      const mergedId = "task-refuse-merged";
      writeState(mergedId, { taskId: mergedId, status: "merged" }, { tasksDir });

      const abandonedId = "task-refuse-abandoned";
      writeState(abandonedId, { taskId: abandonedId, status: "abandoned" }, { tasksDir });

      const mockAgentapi = vi.fn();
      const logs = [];
      const log = (id, msg) => logs.push(`${id}: ${msg}`);

      // send job for abandoned task
      await handleJob(
        { op: "send", taskId: abandonedId, prompt: "test prompt" },
        { tasksDir, agentapi: mockAgentapi, log },
      );
      expect(logs).toContain(`${abandonedId}: REFUSED send: task is closed (abandoned)`);
      expect(mockAgentapi).not.toHaveBeenCalled();

      // resume job for merged task
      await handleJob(
        { op: "resume", taskId: mergedId, prompt: "resume prompt" },
        { tasksDir, agentapi: mockAgentapi, log },
      );
      expect(logs.some((l) => l.startsWith(`${mergedId}: REFUSED resume:`))).toBe(true);
      expect(mockAgentapi).not.toHaveBeenCalled();

      // new job for merged task
      await handleJob(
        { op: "new", taskId: mergedId, prompt: "new prompt" },
        { tasksDir, agentapi: mockAgentapi, log },
      );
      expect(logs).toContain(`${mergedId}: REFUSED new: task is closed (merged)`);
      expect(mockAgentapi).not.toHaveBeenCalled();

      // verify states are untouched
      expect(readState(mergedId, { tasksDir }).status).toBe("merged");
      expect(readState(abandonedId, { tasksDir }).status).toBe("abandoned");
    } finally {
      cleanup();
    }
  });
});
