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
    // react-test-renderer exposes host-node props as any. These tests validate
    // those handlers at runtime without weakening production type checking.
    files: [
      "packages/web/tests/axes-page-workflows.test.tsx",
      "packages/web/tests/rating-form.test.tsx",
      "packages/web/tests/shelf-assignment-interaction.test.tsx",
    ],
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  {
    ignores: ["**/node_modules/", "**/dist/", "**/.next/"],
  },
);
