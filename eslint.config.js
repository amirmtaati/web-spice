// ESLint owns type-aware rules only; Biome owns formatting + general lint
// (SPEC §3.1, §12.3). No rule is configured in both tools.
import tseslint from "typescript-eslint";

// Runtime-agnostic packages: the browser is the product runtime (SPEC §2.2).
// These must never touch Bun, Node, or process.
const RUNTIME_AGNOSTIC = [
  "spicekit/packages/protocol/**/*.ts",
  "spicekit/packages/core/**/*.ts",
  "spicekit/packages/client/**/*.ts",
  "circuit-studio/src/**/*.ts",
  "circuit-studio/src/**/*.tsx",
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.config.*",
      "**/test/**", // bun:test typechecking lands with E1 (see docs/progress.md)
      ".dependency-cruiser.cjs",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    files: RUNTIME_AGNOSTIC,
    languageOptions: {
      globals: {
        Bun: "off",
        process: "off",
        require: "off",
        Buffer: "off",
        __dirname: "off",
        __filename: "off",
        global: "off",
      },
    },
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Bun", message: "Runtime-agnostic code must not use the Bun global (SPEC §2.2)." },
        { name: "process", message: "Runtime-agnostic code must not use process (SPEC §2.2)." },
        { name: "Buffer", message: "Runtime-agnostic code must not use Buffer (SPEC §2.2)." },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["bun:*", "node:*", "bun", "node"],
              message:
                "Runtime-agnostic code must not import bun:* or node:* built-ins (SPEC §2.2).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["spicekit/packages/server/**", "spicekit/packages/cli/**", "spicekit/scripts/**"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-imports": "off",
    },
  },
);
