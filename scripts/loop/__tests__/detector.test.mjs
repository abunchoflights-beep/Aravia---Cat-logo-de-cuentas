import { describe, expect, it } from "vite-plus/test";
import { detectGaming, parseVitestTestCount } from "../lib/detector.mjs";

describe("gaming detector on fixture diffs", () => {
  it("flags deleted test files", () => {
    const diff = `diff --git a/src/__tests__/old-feature.test.ts b/src/__tests__/old-feature.test.ts
deleted file mode 100644
index e69de29..0000000
--- a/src/__tests__/old-feature.test.ts
+++ /dev/null
@@ -1,5 +0,0 @@
-describe("old feature", () => {
-  it("works", () => {});
-});
`;
    const { findings } = detectGaming(diff);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "src/__tests__/old-feature.test.ts",
          rule: "deleted-test-file",
        }),
      ]),
    );
  });

  it("flags test files renamed away to non-test locations", () => {
    const diff = `diff --git a/src/__tests__/auth.test.ts b/src/misc/auth-notes.txt
similarity index 100%
rename from src/__tests__/auth.test.ts
rename to src/misc/auth-notes.txt
`;
    const { findings } = detectGaming(diff);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "src/__tests__/auth.test.ts",
          rule: "deleted-test-file",
        }),
      ]),
    );
  });

  it("does not flag test files renamed to another test file", () => {
    const diff = `diff --git a/src/__tests__/auth.test.ts b/src/__tests__/auth-v2.test.ts
similarity index 100%
rename from src/__tests__/auth.test.ts
rename to src/__tests__/auth-v2.test.ts
`;
    const { findings } = detectGaming(diff);
    expect(findings.filter((f) => f.rule === "deleted-test-file")).toHaveLength(0);
  });

  it("flags new test skips (.skip, xit, xdescribe)", () => {
    const diff = `diff --git a/src/__tests__/runtime.test.ts b/src/__tests__/runtime.test.ts
--- a/src/__tests__/runtime.test.ts
+++ b/src/__tests__/runtime.test.ts
@@ -25,3 +25,6 @@
+it.skip("skips failing case", () => {});
+xit("skips legacy", () => {});
+xdescribe("disabled suite", () => {});
`;
    const { findings } = detectGaming(diff);
    const skipFindings = findings.filter((f) => f.rule === "test-skip");
    expect(skipFindings).toHaveLength(3);
    expect(skipFindings[0].line).toBe(25);
    expect(skipFindings[1].line).toBe(26);
    expect(skipFindings[2].line).toBe(27);
  });

  it("flags new .only and it.todo", () => {
    const diff = `diff --git a/src/__tests__/sample.test.ts b/src/__tests__/sample.test.ts
--- a/src/__tests__/sample.test.ts
+++ b/src/__tests__/sample.test.ts
@@ -10,2 +10,4 @@
+it.only("focus this test", () => {});
+it.todo("implement later");
`;
    const { findings } = detectGaming(diff);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "src/__tests__/sample.test.ts",
          rule: "test-only",
          line: 10,
        }),
        expect.objectContaining({
          file: "src/__tests__/sample.test.ts",
          rule: "test-todo",
          line: 11,
        }),
      ]),
    );
  });

  it("flags new eslint-disable, @ts-ignore, @ts-expect-error, as any", () => {
    const diff = `diff --git a/src/lib/logic.ts b/src/lib/logic.ts
--- a/src/lib/logic.ts
+++ b/src/lib/logic.ts
@@ -40,3 +40,7 @@
+// eslint-disable-next-line
+// @ts-ignore
+// @ts-expect-error
+const payload = data as any;
`;
    const { findings } = detectGaming(diff);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "eslint-disable", line: 40 }),
        expect.objectContaining({ rule: "ts-ignore", line: 41 }),
        expect.objectContaining({ rule: "ts-expect-error", line: 42 }),
        expect.objectContaining({ rule: "as-any", line: 43 }),
      ]),
    );
  });

  it("flags changed snapshot files (*.snap)", () => {
    const diff = `diff --git a/src/__tests__/__snapshots__/copilot.test.ts.snap b/src/__tests__/__snapshots__/copilot.test.ts.snap
--- a/src/__tests__/__snapshots__/copilot.test.ts.snap
+++ b/src/__tests__/__snapshots__/copilot.test.ts.snap
@@ -1,3 +1,3 @@
-exports[\`renders correctly\`] = \`<div>Old</div>\`;
+exports[\`renders correctly\`] = \`<div>New</div>\`;
`;
    const { findings } = detectGaming(diff);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "src/__tests__/__snapshots__/copilot.test.ts.snap",
          rule: "snapshot-change",
        }),
      ]),
    );
  });

  it("flags edits to harness or CI configuration files", () => {
    const diff = `diff --git a/vitest.config.ts b/vitest.config.ts
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -10,1 +10,1 @@
-    exclude: [...configDefaults.exclude, '.claude/**', '.loop/**'],
+    exclude: [...configDefaults.exclude, '.claude/**', '.loop/**', 'src/__tests__/**'],
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -5,1 +5,1 @@
-    run: npm test
+    run: echo "skipped"
diff --git a/scripts/loop/loop.mjs b/scripts/loop/loop.mjs
--- a/scripts/loop/loop.mjs
+++ b/scripts/loop/loop.mjs
@@ -1,1 +1,1 @@
+// modified harness
`;
    const { findings } = detectGaming(diff);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "vitest.config.ts", rule: "harness-or-ci-edit" }),
        expect.objectContaining({ file: ".github/workflows/ci.yml", rule: "harness-or-ci-edit" }),
        expect.objectContaining({ file: "scripts/loop/loop.mjs", rule: "harness-or-ci-edit" }),
      ]),
    );
  });

  it("flags package.json scripts changes", () => {
    const diff = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -8,3 +8,3 @@
-    "test": "vitest",
+    "test": "exit 0",
`;
    const { findings } = detectGaming(diff);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "package.json", rule: "harness-or-ci-edit" }),
      ]),
    );
  });

  it("parses vitest test count and flags drops", () => {
    const vitestOutput = `
 Test Files  56 passed (56)
      Tests  950 passed | 2 skipped (952)
   Duration  4.5s
`;
    const count = parseVitestTestCount(vitestOutput);
    expect(count).toBe(952);

    const { findings } = detectGaming("", {
      baseTestCount: 961,
      vitestOutput,
    });
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "vitest",
          rule: "test-count-drop",
        }),
      ]),
    );
  });

  it("returns zero findings on a clean diff", () => {
    const cleanDiff = `diff --git a/src/lib/calculator.ts b/src/lib/calculator.ts
--- a/src/lib/calculator.ts
+++ b/src/lib/calculator.ts
@@ -1,3 +1,6 @@
 export function add(a: number, b: number): number {
   return a + b;
 }
+export function subtract(a: number, b: number): number {
+  return a - b;
+}
`;
    const { findings } = detectGaming(cleanDiff);
    expect(findings).toHaveLength(0);
  });

  describe("capability-probe rule", () => {
    it("flags typeof <expr>.<method> === 'function' and !== 'function' for DB builder methods", () => {
      const diff = `diff --git a/src/lib/paginate.ts b/src/lib/paginate.ts
--- a/src/lib/paginate.ts
+++ b/src/lib/paginate.ts
@@ -15,3 +15,6 @@
+if (typeof (q as unknown as { range?: unknown }).range === "function") {
+  paginate();
+} else if (typeof client.rpc !== "function") {
+  fallbackRpc();
+}
`;
      const { findings } = detectGaming(diff);
      const probeFindings = findings.filter((f) => f.rule === "capability-probe");
      expect(probeFindings).toHaveLength(2);
      expect(probeFindings[0]).toMatchObject({
        file: "src/lib/paginate.ts",
        line: 15,
        rule: "capability-probe",
      });
      expect(probeFindings[1]).toMatchObject({
        file: "src/lib/paginate.ts",
        line: 17,
        rule: "capability-probe",
      });
    });

    it("flags '<method>' in <expr> for DB builder methods", () => {
      const diff = `diff --git a/src/lib/query.ts b/src/lib/query.ts
--- a/src/lib/query.ts
+++ b/src/lib/query.ts
@@ -20,2 +20,4 @@
+if ("range" in q) return q.range(0, 10);
+if ('rpc' in client) return client.rpc("run");
`;
      const { findings } = detectGaming(diff);
      const probeFindings = findings.filter((f) => f.rule === "capability-probe");
      expect(probeFindings).toHaveLength(2);
      expect(probeFindings[0].line).toBe(20);
      expect(probeFindings[1].line).toBe(21);
    });

    it("flags optional calls on DB builder methods: ?.rpc(, ?.range(", () => {
      const diff = `diff --git a/src/lib/db-client.ts b/src/lib/db-client.ts
--- a/src/lib/db-client.ts
+++ b/src/lib/db-client.ts
@@ -30,2 +30,4 @@
+const paged = await q?.range(0, 20);
+const rpcRes = await client?.rpc("calculate_totals");
`;
      const { findings } = detectGaming(diff);
      const probeFindings = findings.filter((f) => f.rule === "capability-probe");
      expect(probeFindings).toHaveLength(2);
      expect(probeFindings[0].line).toBe(30);
      expect(probeFindings[1].line).toBe(31);
    });

    it("flags all 13 DB client methods (range, rpc, order, select, maybeSingle, single, eq, in, upsert, insert, update, delete, from)", () => {
      const methods = [
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
      const addedLines = methods
        .map((m) => `+if (typeof client.${m} === "function") {}`)
        .join("\n");
      const diff = `diff --git a/src/lib/all-methods.ts b/src/lib/all-methods.ts
--- a/src/lib/all-methods.ts
+++ b/src/lib/all-methods.ts
@@ -1,1 +1,${methods.length + 1} @@
${addedLines}
`;
      const { findings } = detectGaming(diff);
      const probeFindings = findings.filter((f) => f.rule === "capability-probe");
      expect(probeFindings).toHaveLength(methods.length);
    });
  });

  describe("fallback-comment rule", () => {
    it("flags added comment lines mentioning fallback together with test/mock triggers", () => {
      const diff = `diff --git a/src/lib/service.ts b/src/lib/service.ts
--- a/src/lib/service.ts
+++ b/src/lib/service.ts
@@ -10,3 +10,8 @@
+// If the RPC is not installed or errors, fall back to count queries / in-memory grouping
+// fallback: missing rpc
+// fallback for mock client
+// fallback in test env
+// fallback for tests
`;
      const { findings } = detectGaming(diff);
      const commentFindings = findings.filter((f) => f.rule === "fallback-comment");
      expect(commentFindings).toHaveLength(5);
      for (const f of commentFindings) {
        expect(f.file).toBe("src/lib/service.ts");
        expect(f.detail).toBe("check this is not test-shaped");
      }
    });

    it("flags block comment lines mentioning fallback and triggers", () => {
      const diff = `diff --git a/src/lib/grouping.ts b/src/lib/grouping.ts
--- a/src/lib/grouping.ts
+++ b/src/lib/grouping.ts
@@ -5,2 +5,4 @@
+/* fallback when rpc is missing */
+* fallback for mock database
`;
      const { findings } = detectGaming(diff);
      const commentFindings = findings.filter((f) => f.rule === "fallback-comment");
      expect(commentFindings).toHaveLength(2);
      expect(commentFindings[0].detail).toBe("check this is not test-shaped");
      expect(commentFindings[1].detail).toBe("check this is not test-shaped");
    });
  });

  describe("scoping and non-test exclusions", () => {
    it("does NOT flag capability-probe or fallback-comment in src/__tests__/", () => {
      const diff = `diff --git a/src/__tests__/database.test.ts b/src/__tests__/database.test.ts
--- a/src/__tests__/database.test.ts
+++ b/src/__tests__/database.test.ts
@@ -1,5 +1,11 @@
+if (typeof (q as any).range === "function") {}
+if ("range" in q) {}
+const data = q?.range(0, 10);
+const rpcData = client?.rpc("my_rpc");
+// If the RPC is not installed, fall back to count queries
+// fallback for mock
`;
      const { findings } = detectGaming(diff);
      const scopedFindings = findings.filter(
        (f) => f.rule === "capability-probe" || f.rule === "fallback-comment",
      );
      expect(scopedFindings).toHaveLength(0);
    });

    it("does NOT flag capability-probe or fallback-comment in *.test.* files", () => {
      const diff = `diff --git a/src/components/chat.test.tsx b/src/components/chat.test.tsx
--- a/src/components/chat.test.tsx
+++ b/src/components/chat.test.tsx
@@ -1,3 +1,7 @@
+if (typeof client.rpc === "function") {}
+if ("select" in builder) {}
+client?.rpc("test");
+// fallback for tests
`;
      const { findings } = detectGaming(diff);
      const scopedFindings = findings.filter(
        (f) => f.rule === "capability-probe" || f.rule === "fallback-comment",
      );
      expect(scopedFindings).toHaveLength(0);
    });

    it("does NOT flag capability-probe or fallback-comment in scripts/loop/", () => {
      const diff = `diff --git a/scripts/loop/lib/db-check.mjs b/scripts/loop/lib/db-check.mjs
--- a/scripts/loop/lib/db-check.mjs
+++ b/scripts/loop/lib/db-check.mjs
@@ -1,2 +1,6 @@
+if (typeof client.rpc === "function") {}
+if ("range" in q) {}
+client?.rpc("test");
+// fallback for mock
`;
      const { findings } = detectGaming(diff);
      const scopedFindings = findings.filter(
        (f) => f.rule === "capability-probe" || f.rule === "fallback-comment",
      );
      expect(scopedFindings).toHaveLength(0);
    });
  });

  describe("false positive resistance", () => {
    it("does NOT flag legitimate unrelated typeof window === 'undefined'", () => {
      const diff = `diff --git a/src/lib/browser.ts b/src/lib/browser.ts
--- a/src/lib/browser.ts
+++ b/src/lib/browser.ts
@@ -1,3 +1,7 @@
+if (typeof window === "undefined") {
+  return null;
+}
+const isClient = typeof window !== "undefined";
`;
      const { findings } = detectGaming(diff);
      expect(findings).toHaveLength(0);
    });

    it("does NOT flag legitimate comments mentioning fallback or tests separately", () => {
      const diff = `diff --git a/src/lib/cache.ts b/src/lib/cache.ts
--- a/src/lib/cache.ts
+++ b/src/lib/cache.ts
@@ -1,3 +1,7 @@
+// Fallback to secondary redis instance when primary connection drops
+// Integration tests verify the timeout configuration
+// Normal comment mentioning fallback strategy for high latency
`;
      const { findings } = detectGaming(diff);
      const commentFindings = findings.filter((f) => f.rule === "fallback-comment");
      expect(commentFindings).toHaveLength(0);
    });
  });
});
