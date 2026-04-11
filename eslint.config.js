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
    ignores: ["**/node_modules/", "**/dist/", "**/.next/"],
  },
);
