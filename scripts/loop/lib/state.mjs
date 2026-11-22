/**
 * State persistence and atomic updates for the engineering loop.
 *
 * Prevents stale write overwrites (e.g. when a task is closed during an async agentapi call).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultTasksDir = () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const loop = process.env.LOOP_DIR ? path.resolve(process.env.LOOP_DIR) : path.join(repo, ".loop");
  return path.join(loop, "tasks");
};

/**
 * Returns true if the task state is closed (merged or abandoned).
 *
 * @param {Record<string, any>} state
 * @returns {boolean}
 */
export function isTaskClosed(state) {
  return state?.status === "merged" || state?.status === "abandoned";
}

/**
 * Resolves the path to state.json for a given task ID.
 *
 * @param {string} id
 * @param {{ tasksDir?: string }} [options]
 * @returns {string}
 */
export function getStatePath(id, { tasksDir = defaultTasksDir() } = {}) {
  return path.join(tasksDir, id, "state.json");
}

/**
 * Reads task state from disk. Returns a default state object if missing or corrupt.
 *
 * @param {string} id
 * @param {{ fsModule?: typeof fs, tasksDir?: string }} [options]
 * @returns {Record<string, any>}
 */
export function readState(id, { fsModule = fs, tasksDir = defaultTasksDir() } = {}) {
  const target = getStatePath(id, { tasksDir });
  try {
    return JSON.parse(fsModule.readFileSync(target, "utf8"));
  } catch {
    return { taskId: id, history: [] };
  }
}

/**
 * Writes task state to disk.
 *
 * @param {string} id
 * @param {Record<string, any>} state
 * @param {{ fsModule?: typeof fs, tasksDir?: string }} [options]
 */
export function writeState(id, state, { fsModule = fs, tasksDir = defaultTasksDir() } = {}) {
  const target = getStatePath(id, { tasksDir });
  fsModule.mkdirSync(path.dirname(target), { recursive: true });
  fsModule.writeFileSync(target, JSON.stringify(state, null, 2));
}

/**
 * Safely updates task state by re-reading the latest state from disk,
 * applying the mutate callback, and writing it back.
 *
 * @param {string} id
 * @param {(freshState: Record<string, any>) => Record<string, any> | void} mutate
 * @param {{ fsModule?: typeof fs, tasksDir?: string }} [options]
 * @returns {Record<string, any>} updated state
 */
export function updateState(id, mutate, { fsModule = fs, tasksDir = defaultTasksDir() } = {}) {
  const fresh = readState(id, { fsModule, tasksDir });
  const result = mutate(fresh);
  if (result === false) {
    return fresh;
  }
  const next = result === undefined ? fresh : result;
  writeState(id, next, { fsModule, tasksDir });
  return next;
}
