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
      "**/dist/**",
      "http-example-files/**/*.js",
      "packages/core/.test-import-run/**",
      "packages/core/src/lib/runner/vendored-*",
    ],
  },
);
