import eslint from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["android", "dist", "coverage", "ios/App/App/public"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        document: "readonly",
        navigator: "readonly",
        window: "readonly",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  {
    files: ["src/app/repository-context.tsx"],
    rules: {
      // This module intentionally keeps the provider and its repository hooks
      // together so they share one private context contract.
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["src/domain/**/*.ts"],
    ignores: ["src/domain/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../application/**",
                "../storage/**",
                "../app/**",
                "../native/**",
                "../cloud/**",
              ],
              message:
                "Domain modules must remain pure and dependency-free from outer layers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/application/**/*.ts"],
    ignores: ["src/application/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../app/**",
                "../storage/**",
                "../native/**",
                "../cloud/**",
              ],
              message:
                "Application services depend on ports and domain rules, never adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/views-screen.tsx"],
    rules: {
      "max-lines": [
        "error",
        { max: 2500, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["src/app/task-screen.tsx"],
    rules: {
      "max-lines": [
        "error",
        { max: 1300, skipBlankLines: true, skipComments: true },
      ],
    },
  },
);
