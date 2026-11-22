# Engineering loop: Claude Code orchestrates, Antigravity implements

```
Claude Code ──loop.mjs──▶ .loop/queue/*.json ──bridge.mjs──▶ agentapi ──▶ Antigravity agent
     ▲                                                                         │
     └──── reviews diff + gates ◀── .loop/tasks/<id>/report-<n>.md ◀───────────┘
```

- **Antigravity** writes the code, one conversation per task, each in its own git worktree (`.loop/wt/<id>`, branch `feat/<id>`).
- **Claude Code** writes the briefs, reviews the commits, runs the gates, sends feedback rounds, and merges.
- `.loop/` is gitignored, and it holds the mailbox, config, metrics, and worktrees.

## One-time setup (owner)

1. In Antigravity, set the agent's terminal policy so it can run `npm`, `npx`, `git` and `node` without asking each time. Otherwise every task stops at the first command.
2. Start the bridge from a terminal that Antigravity created. Those terminals carry `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN`:
   ```bash
   node scripts/loop/bridge.mjs
   ```
   If the integrated terminal doesn't have them, configure fallback credentials in `.loop/config.json`, or ask an Antigravity agent: _"Run `node scripts/loop/bridge.mjs` in the background and leave it running."_
   `bridge.mjs` is a supervisor: it reloads `bridge-worker.mjs` whenever that file changes, so bridge fixes land without a restart.
3. Check it: `node scripts/loop/loop.mjs status` should report `bridge alive`.

## Orchestrator commands

| Command                                                                                                                                    | Does                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loop.mjs new <id> --brief <file> [--branch feat/x] [--base main] [--worktree <path>] [--model pro] [--max-rounds N] [--budget-minutes N]` | Creates worktree & branch, writes protocol + brief, sets round cap (default 3) and budget (default 180m), queues new task                                                                                                                         |
| `loop.mjs resume <id> [--model pro] [--title "..."]`                                                                                       | Starts a new conversation for a task whose conversation was lost, keeping the worktree, branch, round, and history                                                                                                                                |
| `loop.mjs wait <id> [--timeout <seconds>]`                                                                                                 | Blocks until `report-<round>.md` ends with `ready-for-review` or `blocked`. Fails if task exceeds budget (`over_budget`), is lost (`conversation_lost`), is stalled (`stalled`), or is escalated                                                  |
| `loop.mjs feedback <id> --file <file>`                                                                                                     | Checks round cap: sends review feedback into conversation if under cap; refuses and marks task `escalated` if round cap exceeded                                                                                                                  |
| `loop.mjs status [id] [--all]`                                                                                                             | Shows bridge health, queued jobs, running conversations, current round, report state, and elapsed time vs budget for open tasks. Closed tasks are listed compactly at the end (use `--all` for full details). Stalled tasks are shown prominently |
| `loop.mjs verify <id> [--round N] [--build]`                                                                                               | Runs gates in worktree (`vp check`, `vp run -r test`, `vp -C api run test:e2e`, optional `vp run -r build`), runs gaming detector, writes `.loop/tasks/<id>/verify-<round>.json`, and prints summary                                              |
| `loop.mjs audit <id>`                                                                                                                      | Runs gaming detector on task worktree and prints all findings                                                                                                                                                                                     |
| `loop.mjs close <id> --merged \| --abandoned`                                                                                              | Marks task finished (`merged` or `abandoned`), writes status to `state.json`, and appends `closed` event to metrics                                                                                                                               |
| `loop.mjs metrics`                                                                                                                         | Displays per-task metrics (rounds, first verify passed, wall time, status) and totals (first verify passed rate, merged without feedback rate, mean rounds, merged count)                                                                         |

## Configuration keys (`.loop/config.json`)

| Key            | Description                                                                                   | Default       |
| -------------- | --------------------------------------------------------------------------------------------- | ------------- |
| `lsAddress`    | Language server address fallback (`localhost:<port>`) when env lacks `ANTIGRAVITY_LS_ADDRESS` | Unset         |
| `csrfToken`    | Language server CSRF token fallback when env lacks `ANTIGRAVITY_CSRF_TOKEN`                   | Unset         |
| `projectId`    | Antigravity project UUID passed to agentapi                                                   | Unset         |
| `agentapiExe`  | Explicit path override to `language_server_windows_x64.exe` or `agentapi.bat`                 | Auto-detected |
| `maxParallel`  | Maximum tasks running concurrently without a final report before new jobs are queued          | `3`           |
| `stallMinutes` | Inactivity minutes before an auto-nudge fires (and before marking stalled if still inactive)  | `30`          |

## Hardening rules

1. **Fresh credentials win:** `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_CSRF_TOKEN` in the environment always take precedence over saved `.loop/config.json` values. Config values serve purely as a fallback. Tokens and addresses are never logged or committed; heartbeat logs only the source (`env` / `config`).
2. **Gaming detector:** Scans branch diffs and uncommitted worktree changes to detect:
   - Deleted or renamed-away test files, or test count drops in test output
   - Test weakening: new `.skip(`, `.only(`, `it.todo(`, `xit(`, `xdescribe(`
   - Type and lint suppressions: `eslint-disable`, `oxlint-disable`, `@ts-ignore`, `@ts-expect-error`, `as any`
   - Modified snapshots (`*.snap`)
   - Unapproved edits to harness or CI: `scripts/loop/**`, `.github/**`, `.vite-hooks/**`, `vite.config.*`, `vitest.config.*`, `eslint.config.*`, `tsconfig.json`, `package.json` scripts
   - Capability probing on database-client builder methods in production source: `typeof <expr>.<method> === "function"` / `!== "function"`, `"<method>" in <expr>`, `?.<method>(` (`capability-probe`)
   - Test-shaped production fallbacks in comments: comments mentioning a fallback together with `not installed`, `missing rpc`, `mock`, `test env`, or `tests` (`fallback-comment`)
3. **Round cap & escalation:** Default 3 rounds. When feedback exceeds the cap, the command refuses to enqueue further agent rounds, marks the task `escalated`, records an escalation metric, and requests human intervention.
4. **Time budget:** Default 180 minutes. `status` displays elapsed vs budget time for open tasks; `wait` fails with `over_budget` if exceeded, and the bridge records it in `state.json`.
5. **WIP limit:** Bridge only dispatches `new` tasks when fewer than `maxParallel` tasks are running without a final report. Extra tasks remain queued in FIFO order until an active task produces a final report (`ready-for-review` or `blocked`).
6. **Metrics:** Appends structured JSON lines to `.loop/metrics.jsonl` on events (`dispatched`, `report`, `verify`, `feedback`, `escalated`, `closed`, `nudged`). `loop.mjs metrics` aggregates task durations, first verify passed rate, merged without feedback rate, and completion stats.
7. **Protocol integrity:** Brief protocol forbids editing `scripts/loop/**`, CI, or lint/test config, and forbids skipping or weakening tests.
8. **Stall detector & auto-nudge:** For running tasks in their current round, tracks latest activity among file modifications in the worktree (excluding `node_modules`, `.next`, `.git`), git commits, and round start. File walks are throttled to at most once per minute per task. If inactive for `stallMinutes` (default 30) without a final report, the bridge sends an auto-nudge into the conversation to inspect git status, finish, run gates, and write report. If still inactive for `stallMinutes` after the nudge, the task transitions to `stalled`. `wait` exits non-zero on `stalled`.
9. **State persistence & closed task inertness:** All task state updates pass through `updateState(id, mutate)` in `lib/state.mjs`, which re-reads fresh state from disk immediately before mutating and writing, preventing stale overwrites when tasks are closed during asynchronous `agentapi` calls. Closed tasks (`merged`, `abandoned`) are inert across all bridge passes (budget checks, metadata refresh, stall evaluations, auto-nudges, and disk writes are skipped) and any queued `send`, `resume`, or `new` jobs for closed tasks are rejected with a log line.

## Protocol

The brief is the protocol header (`protocol()` in `loop.mjs`) plus the task spec. It covers:

- Work only in the given worktree.
- Gates: `vp check`, `vp run -r test`, `vp -C api run test:e2e`, and optional `vp run -r build`.
- Write the report in a fixed format, ending with a `LOOP-STATUS` line.
- Never edit harness, CI, `.vite-hooks/**`, `vite.config.*`, or lint/test config unless the task says so.
- Never skip, delete, or weaken tests to make gates pass.
