import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/", "logs/", "public/"] },
  {
    files: ["client/src/**/*.{ts,tsx}"],
    ...js.configs.recommended,
    ...tseslint.configs.recommended[0],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      parser: tseslint.parser,
      globals: globals.browser,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.reduce(
        (acc, c) => ({ ...acc, ...c.rules }),
        {},
      ),
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["server.ts", "src/**/*.ts"],
    ...js.configs.recommended,
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.reduce(
        (acc, c) => ({ ...acc, ...c.rules }),
        {},
      ),
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
