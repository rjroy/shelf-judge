import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='module']",
          message:
            "mock.module() contaminates Bun's process-wide module cache. Use explicit dependencies or a suite-wide preload instead.",
        },
      ],
    },
  },
  {
    // Web test files need bun-types for bun:test globals, but the main web tsconfig
    // serves Next.js without bun-types. Use a dedicated test tsconfig instead.
    files: ["packages/web/tests/**/*.ts", "packages/web/tests/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./packages/web/tsconfig.test.json",
      },
    },
  },
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    ignores: ["packages/web/lib/browser-uuid.ts", "packages/web/tests/**", "packages/web/e2e/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='randomUUID']",
          message:
            "Browser UUIDs must use generateBrowserUuid() so non-secure HTTP contexts remain supported.",
        },
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.computed=true][callee.property.value='randomUUID']",
          message:
            "Browser UUIDs must use generateBrowserUuid() so non-secure HTTP contexts remain supported.",
        },
      ],
    },
  },
  {
    ignores: ["**/node_modules/", "**/dist/", "**/.next/", "**/.next-e2e*/", "**/tmp/"],
  },
);
