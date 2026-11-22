import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    overrides: [
      {
        files: ["api/**"],
        options: {
          singleQuote: true,
          trailingComma: "all",
        },
      },
    ],
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    plugins: ["typescript"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      {
        files: ["api/**"],
        env: {
          node: true,
        },
        rules: {
          "typescript/no-explicit-any": "error",
          "typescript/no-floating-promises": "error",
        },
      },
      {
        files: ["web/**"],
        plugins: ["react", "typescript", "oxc"],
        rules: {
          "react/rules-of-hooks": "error",
          "react/only-export-components": ["warn", { allowConstantExport: true }],
        },
      },
    ],
  },
});
