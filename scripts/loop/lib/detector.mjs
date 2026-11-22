/**
 * Gaming detector for the engineering loop.
 *
 * Scans git diff <base>...HEAD plus uncommitted changes in the worktree and flags:
 * - deleted or renamed-away test files, and a drop in the test count in the vitest output
 * - new .skip(, .only(, it.todo(, xit(, xdescribe(
 * - new eslint-disable, @ts-ignore, @ts-expect-error, as any
 * - changed snapshots (*.snap)
 * - edits to the harness or CI: scripts/loop/**, .github/**, .vite-hooks/**, vite.config.*, vitest.config.*, eslint.config.*, tsconfig.json, package.json scripts
 * - capability probing on DB-client builder methods in production source (capability-probe)
 * - test-shaped fallback comments in production source (fallback-comment)
 *
 * Each finding: { file, line, rule, detail? }
 */
import { execFileSync } from "node:child_process";

export function normalizePath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");
}

export function isTestFile(filePath) {
  const norm = normalizePath(filePath);
  return (
    /(?:^|\/)(?:__tests__|tests?)\//.test(norm) ||
    /\.(?:test|spec)\./i.test(norm) ||
    /\.(?:test|spec)\.[a-z0-9]+$/i.test(norm)
  );
}

export function isSnapshotFile(filePath) {
  const norm = normalizePath(filePath);
  return /\.snap(?:$|\.)/i.test(norm) || /(?:^|\/)__snapshots__\//.test(norm);
}

export function isHarnessOrCiFile(filePath) {
  const norm = normalizePath(filePath);
  if (/^scripts\/loop\//.test(norm)) return true;
  if (/^\.github\//.test(norm)) return true;
  if (/^\.vite-hooks\//.test(norm)) return true;
  if (/(?:^|\/)vite\.config\.[a-z0-9]+$/i.test(norm)) return true;
  if (/(?:^|\/)vitest\.config\.[a-z0-9]+$/i.test(norm)) return true;
  if (/(?:^|\/)eslint\.config\.[a-z0-9]+$/i.test(norm)) return true;
  if (/(?:^|\/)tsconfig(?:\.[a-z0-9]+)?\.json$/i.test(norm)) return true;
  return false;
}

export const DB_BUILDER_METHODS = [
  "range",
  "rpc",
  "order",
  "select",
  "maybeSingle",
  "single",
  "eq",
  "in",
  "upsert",
  "insert",
  "update",
  "delete",
  "from",
];

const DB_METHODS_RE = `(?:${DB_BUILDER_METHODS.join("|")})`;

const TYPEOF_PROBE_RE = new RegExp(
  `\\btypeof\\s+(?:(?!\\btypeof\\b|[!=]==|;).)*?(?:\\.|\\?\\.)\\s*${DB_METHODS_RE}\\b\\)*\\s*[!=]==?\\s*['"\`]function['"\`]|['"\`]function['"\`]\\s*[!=]==?\\s*\\(*\\s*typeof\\s+(?:(?!\\btypeof\\b|[!=]==|;).)*?(?:\\.|\\?\\.)\\s*${DB_METHODS_RE}\\b`,
);

const IN_PROBE_RE = new RegExp(`['"\`]${DB_METHODS_RE}['"\`]\\s+in\\b`);

const OPTIONAL_CALL_RE = new RegExp(
  `\\?\\.\\s*${DB_METHODS_RE}\\s*\\(|(?:\\.|\\?\\.)\\s*${DB_METHODS_RE}\\s*\\?\\.\\s*\\(`,
);

export function isNonTestSourceFile(filePath) {
  const norm = normalizePath(filePath);
  if (!/\.(?:[cm]?[jt]sx?)$/i.test(norm)) return false;
  if (isTestFile(norm)) return false;
  if (/^scripts\/loop\//.test(norm)) return false;
  if (isHarnessOrCiFile(norm)) return false;
  return true;
}

export function isCapabilityProbe(line) {
  return TYPEOF_PROBE_RE.test(line) || IN_PROBE_RE.test(line) || OPTIONAL_CALL_RE.test(line);
}

const FALLBACK_WORD_RE = /\bfall(?:ing)?[\s-]?backs?\b/i;
const FALLBACK_TRIGGERS_RE =
  /\b(?:not\s+installed|missing\s+rpc|rpc\s+(?:is\s+)?missing|mock(?:s|ing|ed)?|test\s+env(?:ironment)?|tests?)\b/i;

export function isFallbackComment(line) {
  const trimmed = line.trim();
  let commentText = "";
  if (/^(?:\/\/|\/\*|\*)/.test(trimmed)) {
    commentText = trimmed;
  } else {
    const inlineMatch = line.match(/(?:\/\/|\/\*)(.*)/);
    if (inlineMatch) {
      commentText = inlineMatch[1];
    }
  }

  if (!commentText) return false;
  return FALLBACK_WORD_RE.test(commentText) && FALLBACK_TRIGGERS_RE.test(commentText);
}

/**
 * Extracts total test count from vitest runner summary output.
 * e.g. "Tests  959 passed | 2 skipped (961)" -> 961
 *
 * @param {string} output
 * @returns {number | null}
 */
export function parseVitestTestCount(output) {
  if (!output) return null;
  // Match "Tests ... (961)" or "Tests  959 passed"
  const totalMatch = output.match(/Tests\s+[^(]*\((\d+)\)/);
  if (totalMatch) return parseInt(totalMatch[1], 10);

  const passedMatch = output.match(/Tests\s+(\d+)\s+passed/);
  if (passedMatch) return parseInt(passedMatch[1], 10);

  return null;
}

/**
 * Detects gaming attempts in a unified diff string and optional vitest output.
 *
 * @param {string} diffText
 * @param {{
 *   vitestOutput?: string,
 *   baseTestCount?: number,
 *   testCountDrop?: { before: number, after: number }
 * }} [options={}]
 * @returns {{ findings: Array<{ file: string, line: number, rule: string, detail?: string }> }}
 */
export function detectGaming(diffText = "", options = {}) {
  const findings = [];

  // Check test count drop from options or parsed vitest output
  if (options.testCountDrop) {
    if (options.testCountDrop.after < options.testCountDrop.before) {
      findings.push({
        file: "vitest",
        line: 1,
        rule: "test-count-drop",
        detail: `Test count dropped from ${options.testCountDrop.before} to ${options.testCountDrop.after}`,
      });
    }
  } else if (typeof options.baseTestCount === "number" && options.vitestOutput) {
    const currentCount = parseVitestTestCount(options.vitestOutput);
    if (currentCount !== null && currentCount < options.baseTestCount) {
      findings.push({
        file: "vitest",
        line: 1,
        rule: "test-count-drop",
        detail: `Test count dropped from ${options.baseTestCount} to ${currentCount}`,
      });
    }
  }

  if (!diffText || !diffText.trim()) {
    return { findings };
  }

  // Split diff into per-file sections: "diff --git a/... b/..."
  const rawSections = diffText.split(/^diff --git /m);

  for (const section of rawSections) {
    if (!section.trim()) continue;
    const lines = section.split(/\r?\n/);
    const headerLine = lines[0] || "";

    // Parse file names from header "a/path b/path"
    const headerMatch = headerLine.match(/^a\/(.+?)\s+b\/(.+)$/);
    let oldFile = headerMatch ? headerMatch[1] : "";
    let newFile = headerMatch ? headerMatch[2] : "";

    let isDeleted = false;
    let renameFrom = "";
    let renameTo = "";

    for (const line of lines) {
      if (line.startsWith("deleted file mode")) isDeleted = true;
      if (line.startsWith("rename from ")) renameFrom = line.slice("rename from ".length).trim();
      if (line.startsWith("rename to ")) renameTo = line.slice("rename to ".length).trim();
      if (line.startsWith("--- a/")) oldFile = line.slice("--- a/".length).trim();
      if (line.startsWith("+++ b/")) newFile = line.slice("+++ b/".length).trim();
    }

    const currentFile = normalizePath(newFile || renameTo || oldFile || renameFrom);

    // 1. Deleted or renamed-away test files
    if (isDeleted && isTestFile(oldFile)) {
      findings.push({
        file: normalizePath(oldFile),
        line: 1,
        rule: "deleted-test-file",
        detail: "test file was deleted",
      });
    } else if (renameFrom && renameTo && isTestFile(renameFrom) && !isTestFile(renameTo)) {
      findings.push({
        file: normalizePath(renameFrom),
        line: 1,
        rule: "deleted-test-file",
        detail: `test file was renamed away to non-test file ${renameTo}`,
      });
    }

    // 2. Changed snapshots (*.snap)
    if (isSnapshotFile(currentFile)) {
      findings.push({
        file: currentFile,
        line: 1,
        rule: "snapshot-change",
        detail: "snapshot file modified",
      });
    }

    // 3. Harness or CI edits
    if (isHarnessOrCiFile(currentFile)) {
      findings.push({
        file: currentFile,
        line: 1,
        rule: "harness-or-ci-edit",
        detail: "harness or CI configuration file modified",
      });
    }

    // Check package.json scripts edits and line-by-line checks
    const isPackageJson = /(?:^|\/)package\.json$/i.test(currentFile);
    let inPackageJsonScripts = false;
    let currentNewLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match hunk header: @@ -1,5 +1,6 @@
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        currentNewLine = parseInt(hunkMatch[1], 10);
        continue;
      }

      if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;

      if (line.startsWith("+")) {
        const added = line.slice(1);

        // Package.json scripts modification check
        if (isPackageJson) {
          if (/"scripts"\s*:\s*\{/.test(added)) {
            inPackageJsonScripts = true;
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "harness-or-ci-edit",
              detail: "package.json scripts modified",
            });
          } else if (inPackageJsonScripts || /"(?:test|build|lint|dev|dev2)"\s*:/.test(added)) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "harness-or-ci-edit",
              detail: `package.json script line modified: ${added.trim()}`,
            });
          }
        }

        // Only check code-level test skips and type/lint suppressions in code files
        const isCode = /\.(?:[cm]?[jt]sx?)$/i.test(currentFile);

        // Test skips / only / todo
        if (isCode) {
          if (
            /\.skip\s*\(/.test(added) ||
            /\bxit\s*\(/.test(added) ||
            /\bxdescribe\s*\(/.test(added)
          ) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "test-skip",
              detail: added.trim(),
            });
          }
          if (/\.only\s*\(/.test(added)) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "test-only",
              detail: added.trim(),
            });
          }
          if (/\bit\.todo\s*\(/.test(added) || /\btest\.todo\s*\(/.test(added)) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "test-todo",
              detail: added.trim(),
            });
          }

          // Suppressions
          if (/eslint-disable/.test(added) || /oxlint-disable/.test(added)) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: /oxlint-disable/.test(added) ? "oxlint-disable" : "eslint-disable",
              detail: added.trim(),
            });
          }
          if (/@ts-ignore/.test(added)) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "ts-ignore",
              detail: added.trim(),
            });
          }
          if (/@ts-expect-error/.test(added)) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "ts-expect-error",
              detail: added.trim(),
            });
          }
          if (/\bas\s+any\b/.test(added)) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "as-any",
              detail: added.trim(),
            });
          }
        }

        // Production-only rules: capability probes and test-shaped fallback comments
        if (isNonTestSourceFile(currentFile)) {
          if (isCapabilityProbe(added)) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "capability-probe",
              detail: added.trim(),
            });
          }
          if (isFallbackComment(added)) {
            findings.push({
              file: currentFile,
              line: currentNewLine,
              rule: "fallback-comment",
              detail: "check this is not test-shaped",
            });
          }
        }

        currentNewLine++;
      } else if (line.startsWith("-")) {
        // Line deleted
        const removed = line.slice(1);
        if (isPackageJson && /"scripts"\s*:\s*\{/.test(removed)) {
          inPackageJsonScripts = true;
          findings.push({
            file: currentFile,
            line: currentNewLine || 1,
            rule: "harness-or-ci-edit",
            detail: "package.json scripts modified",
          });
        }
      } else if (line.startsWith(" ")) {
        // Context line
        const ctx = line.slice(1);
        if (isPackageJson) {
          if (/"scripts"\s*:\s*\{/.test(ctx)) {
            inPackageJsonScripts = true;
          } else if (inPackageJsonScripts && ctx.trim() === "}") {
            inPackageJsonScripts = false;
          }
        }
        currentNewLine++;
      }
    }
  }

  return { findings };
}

/**
 * Runs git diff in the worktree and applies the gaming detector.
 *
 * @param {string} worktreeDir
 * @param {string} [baseBranch="main"]
 * @param {{
 *   vitestOutput?: string,
 *   baseTestCount?: number,
 *   testCountDrop?: { before: number, after: number }
 * }} [options={}]
 * @returns {{ findings: Array<{ file: string, line: number, rule: string, detail?: string }> }}
 */
export function scanWorktreeGaming(worktreeDir, baseBranch = "main", options = {}) {
  let diffText = "";
  try {
    let mergeBase = "";
    try {
      mergeBase = execFileSync("git", ["-C", worktreeDir, "merge-base", baseBranch, "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      mergeBase = baseBranch;
    }

    // Diff between mergeBase and current working tree (including uncommitted tracked changes)
    diffText = execFileSync("git", ["-C", worktreeDir, "diff", mergeBase], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    // Also check untracked files
    const statusOut = execFileSync("git", ["-C", worktreeDir, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const untrackedLines = statusOut
      .split(/\r?\n/)
      .filter((l) => l.startsWith("?? "))
      .map((l) => l.slice(3).trim());

    for (const untracked of untrackedLines) {
      try {
        const untrackedDiff = execFileSync(
          "git",
          ["-C", worktreeDir, "diff", "--no-index", "--", "/dev/null", untracked],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
        diffText += `\n${untrackedDiff}`;
      } catch (e) {
        // diff --no-index exits with 1 when differences exist
        if (e.stdout) diffText += `\n${e.stdout}`;
      }
    }
  } catch {
    // If git commands fail, return no git findings
  }

  return detectGaming(diffText, options);
}
