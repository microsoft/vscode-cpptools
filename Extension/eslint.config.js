const js = require("@eslint/js");
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");
const jsdoc = require("eslint-plugin-jsdoc");
const eslintImport = require("eslint-plugin-import");

module.exports = [
  {
    ignores: ["dist/", "vscode*.d.ts", "**/*.js"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        process: "readonly",
        module: "readonly",
        require: "readonly",
        global: "readonly",
        __dirname: "readonly",
        exports: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      jsdoc,
      import: eslintImport,
    },
    rules: {
      // TypeScript-specific rules
      "@typescript-eslint/adjacent-overload-signatures": "error",
      "@typescript-eslint/array-type": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "typeLike",
          format: ["PascalCase"]
        }
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-array-constructor": "error",
      "@typescript-eslint/no-useless-constructor": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-misused-new": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-namespace": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-extra-non-null-assertion": "error",
      "@typescript-eslint/no-this-alias": "error",
      "@typescript-eslint/no-unnecessary-type-arguments": "error",
      "@typescript-eslint/no-var-requires": "error",
      "@typescript-eslint/prefer-function-type": "error",
      "@typescript-eslint/prefer-namespace-keyword": "error",
      "@typescript-eslint/triple-slash-reference": "error",
      "@typescript-eslint/unified-signatures": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/method-signature-style": ["error", "method"],
      "@typescript-eslint/no-unused-vars": ["off"],
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "off",
      
      // Core ESLint rules
      "camelcase": "off",
      "no-case-declarations": "off",
      "no-useless-escape": "off",
      "no-floating-decimal": "error",
      "keyword-spacing": ["error", { before: true, overrides: { this: { before: false } } }],
      "arrow-spacing": ["error", { before: true, after: true }],
      "semi-spacing": ["error", { before: false, after: true }],
      "no-extra-parens": ["error", "all", { nestedBinaryExpressions: false, ternaryOperandBinaryExpressions: false }],
      "arrow-body-style": "error",
      "comma-dangle": "error",
      "comma-spacing": "error",
      "constructor-super": "error",
      "curly": "error",
      "eol-last": "error",
      "eqeqeq": ["error", "always"],
      "new-parens": "error",
      "no-bitwise": "error",
      "no-caller": "error",
      "no-cond-assign": "error",
      "no-debugger": "error",
      "no-duplicate-case": "error",
      "no-duplicate-imports": "error",
      "no-eval": "error",
      "no-fallthrough": "error",
      "no-invalid-this": "error",
      "no-irregular-whitespace": "error",
      "rest-spread-spacing": ["error", "never"],
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 1, maxBOF: 0 }],
      "no-new-wrappers": "error",
      "no-return-await": "error",
      "no-sequences": "error",
      "no-sparse-arrays": "error",
      "no-trailing-spaces": "error",
      "no-multi-spaces": "error",
      "no-undef-init": "error",
      "no-unsafe-finally": "error",
      "no-unused-expressions": "error",
      "no-unused-labels": "error",
      "no-unused-vars": "off",
      "space-before-blocks": "error",
      "no-var": "error",
      "one-var": ["error", "never"],
      "prefer-const": "error",
      "prefer-object-spread": "error",
      "space-in-parens": ["error", "never"],
      "spaced-comment": ["off", "always", { line: { exceptions: ["/"] } }],
      "use-isnan": "error",
      "valid-typeof": "error",
      "yoda": "error",
      "space-infix-ops": "error",
      
      // Import rules
      "import/no-default-export": "error",
      "import/no-unassigned-import": "error",
      
      // JSDoc rules
      "jsdoc/no-types": "error",
      
      // Header rules - TODO: eslint-plugin-header may not be compatible with ESLint 9 flat config
      // The old config had:
      // "header/header": ["warn", "block", [
      //   " --------------------------------------------------------------------------------------------",
      //   " * Copyright (c) Microsoft Corporation. All Rights Reserved.",
      //   " * See 'LICENSE' in the project root for license information.",
      //   " * ------------------------------------------------------------------------------------------ "
      // ]],
    },
  },
  {
    // Apply JS recommended rules only to JS files
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"]
  },
];
