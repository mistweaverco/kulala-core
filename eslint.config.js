import prettier from "eslint-config-prettier";
import js from "@eslint/js";
import globals from "globals";
import ts from "typescript-eslint";

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    ignores: [
      "build/",
      "dist/",
      "packages/core/src/lib/runner/vendored-curl.embed.generated.ts",
    ],
  },
);
