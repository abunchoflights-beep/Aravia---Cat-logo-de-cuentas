import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import { checkRoundCap } from "../lib/rounds.mjs";
import {
  checkStallStatus,
  computeLastActivityTime,
  createMtimeTracker,
  evaluateTaskStall,
  formatNudgePrompt,
  getWorktreeLatestMtime,
} from "../lib/stall.mjs";

describe("stall detection and auto-nudge", () => {
  describe("stall timing: activity resets clock, nudge fires once, stalled after nudge", () => {
    const baseTime = 1700000000000; // arbitrary fixed epoch

    it("resets the clock when new activity occurs before the stall threshold", () => {
      const roundStart = baseTime;
      const stallMinutes = 30;

      // 1. At 20m in, activity occurs (e.g. file touch or commit)
      const activityAt = baseTime + 20 * 60_000;
      const lastActivity = computeLastActivityTime({
        roundStartedAt: roundStart,
        worktreeLatestMtime: activityAt,
      });
      expect(lastActivity).toBe(activityAt);

      // 2. At 35m total (15m after activity), task should NOT be nudged or stalled
      const check1 = checkStallStatus({
        status: "running",
        lastActivityAt: lastActivity,
        nudgedAt: null,
        stallMinutes,
        now: baseTime + 35 * 60_000,
      });
      expect(check1.action).toBe("none");
      expect(check1.elapsedSinceActivityMinutes).toBe(15);

      // 3. At 50m total (30m after activity), nudge fires
      const check2 = checkStallStatus({
        status: "running",
        lastActivityAt: lastActivity,
        nudgedAt: null,
        stallMinutes,
        now: baseTime + 50 * 60_000,
      });
      expect(check2.action).toBe("nudge");
      expect(check2.elapsedSinceActivityMinutes).toBe(30);
    });

    it("fires auto-nudge once and does not fire again while waiting", () => {
      const roundStart = baseTime;
      const stallMinutes = 30;
      const nudgedAt = baseTime + 30 * 60_000;

      // At 35m total (5m after nudge, still no activity)
      const check = checkStallStatus({
        status: "running",
        lastActivityAt: roundStart,
        nudgedAt,
        stallMinutes,
        now: baseTime + 35 * 60_000,
      });

      // Does not re-nudge
      expect(check.action).toBe("none");
      expect(check.elapsedSinceNudgeMinutes).toBe(5);
    });

    it("marks task as stalled when no activity occurs stallMinutes after the nudge", () => {
      const roundStart = baseTime;
      const stallMinutes = 30;
      const nudgedAt = baseTime + 30 * 60_000;

      // At 60m total (30m after nudge with NO activity since nudge)
      const check = checkStallStatus({
        status: "running",
        lastActivityAt: roundStart,
        nudgedAt,
        stallMinutes,
        now: baseTime + 60 * 60_000,
      });

      expect(check.action).toBe("stall");
      expect(check.elapsedSinceNudgeMinutes).toBe(30);
    });

    it("resets the stall timer if activity occurs after the nudge", () => {
      const stallMinutes = 30;
      const nudgedAt = baseTime + 30 * 60_000;

      // Agent wakes up and touches a file 5m after the nudge
      const postNudgeActivity = baseTime + 35 * 60_000;

      // At 60m total (25m after post-nudge activity, 30m after nudge)
      // Because activity occurred after the nudge, it should NOT stall yet!
      const check1 = checkStallStatus({
        status: "running",
        lastActivityAt: postNudgeActivity,
        nudgedAt,
        stallMinutes,
        now: baseTime + 60 * 60_000,
      });
      expect(check1.action).toBe("none");

      // At 65m total (30m after post-nudge activity), it now stalls
      const check2 = checkStallStatus({
        status: "running",
        lastActivityAt: postNudgeActivity,
        nudgedAt,
        stallMinutes,
        now: baseTime + 65 * 60_000,
      });
      expect(check2.action).toBe("stall");
    });

    it("ignores tasks that are not running or already have a final report", () => {
      const base = baseTime;
      const longAgo = base - 100 * 60_000;

      // Non-running status
      expect(
        checkStallStatus({
          status: "merged",
          lastActivityAt: longAgo,
          now: base,
        }).action,
      ).toBe("none");

      expect(
        checkStallStatus({
          status: "abandoned",
          lastActivityAt: longAgo,
          now: base,
        }).action,
      ).toBe("none");

      // Running but final report is ready
      expect(
        checkStallStatus({
          status: "running",
          hasFinalReport: true,
          lastActivityAt: longAgo,
          now: base,
        }).action,
      ).toBe("none");
    });
  });

  describe("a nudge does not change the round or count toward the cap", () => {
    it("preserves state.round and does not advance round cap", () => {
      const state = {
        taskId: "task-cap-test",
        status: "running",
        round: 1,
        roundStartedAt: new Date().toISOString(),
      };

      const maxRounds = 3;

      // Before nudge: round 1 is allowed
      expect(checkRoundCap({ round: state.round, maxRounds }).allowed).toBe(true);

      // Simulate sending a nudge: record nudgedAt without touching round
      state.nudgedAt = new Date().toISOString();

      // State round is unchanged
      expect(state.round).toBe(1);

      // Still allowed, does not count as a feedback round
      expect(checkRoundCap({ round: state.round, maxRounds }).allowed).toBe(true);
      expect(state.status).toBe("running");
    });
  });

  describe("filesystem walk and throttling", () => {
    it("excludes node_modules, .next, and .git directories", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loop-walk-test-"));
      try {
        const srcDir = path.join(tmpDir, "src");
        const nodeModulesDir = path.join(tmpDir, "node_modules", "some-pkg");
        const gitDir = path.join(tmpDir, ".git", "objects");
        const nextDir = path.join(tmpDir, ".next", "cache");

        fs.mkdirSync(srcDir, { recursive: true });
        fs.mkdirSync(nodeModulesDir, { recursive: true });
        fs.mkdirSync(gitDir, { recursive: true });
        fs.mkdirSync(nextDir, { recursive: true });

        // Touch files with specific timestamps
        const validFile = path.join(srcDir, "index.ts");
        const nmFile = path.join(nodeModulesDir, "pkg.js");
        const gitFile = path.join(gitDir, "git.obj");
        const nextFile = path.join(nextDir, "build.cache");

        fs.writeFileSync(validFile, "content");
        fs.writeFileSync(nmFile, "nm content");
        fs.writeFileSync(gitFile, "git content");
        fs.writeFileSync(nextFile, "next content");

        const tValid = new Date("2026-01-01T12:00:00Z");
        const tIgnored = new Date("2026-02-01T12:00:00Z"); // Much newer, but inside excluded dirs

        fs.utimesSync(validFile, tValid, tValid);
        fs.utimesSync(nmFile, tIgnored, tIgnored);
        fs.utimesSync(gitFile, tIgnored, tIgnored);
        fs.utimesSync(nextFile, tIgnored, tIgnored);

        const latestMtime = getWorktreeLatestMtime(tmpDir);
        expect(latestMtime).toBe(tValid.getTime());
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("throttles walk to at most once per minute per task", () => {
      const mockWalk = vi.fn(() => 12345);

      const tracker = createMtimeTracker({ walkFn: mockWalk, throttleMs: 60_000 });
      const now = 1000000;

      // 1. Initial walk for task-a
      const m1 = tracker.getLatestMtime("task-a", "/fake/wt", { now });
      expect(m1).toBe(12345);
      expect(mockWalk).toHaveBeenCalledTimes(1);

      // 2. Second walk for task-a 30s later (within 60s) -> should use cached value
      const m2 = tracker.getLatestMtime("task-a", "/fake/wt", { now: now + 30_000 });
      expect(m2).toBe(12345);
      expect(mockWalk).toHaveBeenCalledTimes(1);

      // 3. Walk for task-b at 30s -> different task, calls walk
      tracker.getLatestMtime("task-b", "/fake/wt-b", { now: now + 30_000 });
      expect(mockWalk).toHaveBeenCalledTimes(2);

      // 4. Walk for task-a after 65s -> calls walk again
      tracker.getLatestMtime("task-a", "/fake/wt", { now: now + 65_000 });
      expect(mockWalk).toHaveBeenCalledTimes(3);
    });
  });

  describe("nudge prompt formatting", () => {
    it("includes all required elements for round 0", () => {
      const prompt = formatNudgePrompt({ taskId: "my-task", round: 0 });
      expect(prompt).toContain("my-task");
      expect(prompt).toContain("round 0");
      expect(prompt).toContain("git log and git status");
      expect(prompt).toContain("brief.md");
      expect(prompt).toContain("run the gates");
      expect(prompt).toContain("report-0.md");
      expect(prompt).toContain("LOOP-STATUS: blocked");
      expect(prompt).toContain("stopping silently");
    });

    it("includes feedback-N.md reference for round > 0", () => {
      const prompt = formatNudgePrompt({ taskId: "my-task", round: 2 });
      expect(prompt).toContain("round 2");
      expect(prompt).toContain("feedback-2.md");
      expect(prompt).toContain("report-2.md");
      expect(prompt).toContain("LOOP-STATUS: blocked");
    });
  });

  describe("evaluateTaskStall", () => {
    it("evaluates a task using injected walk and commit getters", () => {
      const now = 1700000000000;
      const res = evaluateTaskStall({
        taskId: "eval-task",
        worktree: "/wt",
        state: {
          status: "running",
          round: 0,
          roundStartedAt: new Date(now - 40 * 60_000).toISOString(),
        },
        task: { createdAt: new Date(now - 40 * 60_000).toISOString() },
        reportStatus: null,
        config: { stallMinutes: 30 },
        now,
        mtimeTracker: {
          getLatestMtime: () => now - 40 * 60_000,
          clear: () => {},
        },
        getCommitTime: () => now - 40 * 60_000,
      });

      expect(res.action).toBe("nudge");
      expect(res.elapsedSinceActivityMinutes).toBe(40);
    });
  });
});
