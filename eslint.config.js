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
    // Web test files use bun:test globals which aren't in the web tsconfig's type scope.
    // The web tsconfig serves Next.js (no bun-types); projectService can't be overridden
    // per-file, so we disable type-checked rules here instead.
    files: ["packages/web/tests/**/*.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ["**/node_modules/", "**/dist/", "**/.next/"],
  },
);
