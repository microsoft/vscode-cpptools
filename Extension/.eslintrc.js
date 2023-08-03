module.exports = {
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/eslint-recommended"
        //"plugin:@typescript-eslint/strict", // I want to enable this. Lots of little changes will happen.
    ],
    "env": {
        "browser": true,
        "es6": true,
        "node": true
    },
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "project": "tsconfig.json",
        "ecmaVersion": 2022,
        "sourceType": "module",
        "warnOnUnsupportedTypeScriptVersion": false,
    },
    "plugins": [
        "@typescript-eslint",
        "eslint-plugin-jsdoc",
        "@typescript-eslint/eslint-plugin",
        "eslint-plugin-import",
        "eslint-plugin-header"
    ],
    "rules": {
        "indent": [
            "warn",
            4,
            {
                "SwitchCase": 1,
                "ObjectExpression": "first"
            }
        ],
        "@typescript-eslint/indent": [
            "error", 4
        ],
        "@typescript-eslint/adjacent-overload-signatures": "error",
        "@typescript-eslint/array-type": "error",
        "@typescript-eslint/await-thenable": "error",
        "camelcase": "off",
        "@typescript-eslint/naming-convention": [
            "error",
            {
                "selector": "typeLike",
                "format": ["PascalCase"]
            }
        ],
        "@typescript-eslint/member-delimiter-style": [
            "error",
            {
                "multiline": {
                    "delimiter": "semi",
                    "requireLast": true
                },
                "singleline": {
                    "delimiter": "semi",
                    "requireLast": false
                }
            }
        ],
        "no-case-declarations": "off",
        "no-useless-escape": "off",
        "no-floating-decimal": "error",
        "keyword-spacing": ["error", { "before": true, "overrides": { "this": { "before": false } } }],
        "arrow-spacing": ["error", { "before": true, "after": true }],
        "@typescript-eslint/no-for-in-array": "error",
        "@typescript-eslint/no-misused-new": "error",
        "@typescript-eslint/no-misused-promises": "error",
        "@typescript-eslint/no-namespace": "error",
        "@typescript-eslint/no-non-null-assertion": "error",
        "@typescript-eslint/no-extra-non-null-assertion": "error",
        "@typescript-eslint/no-this-alias": "error",
        "@typescript-eslint/no-unnecessary-qualifier": "error",
        "@typescript-eslint/no-unnecessary-type-arguments": "error",
        "@typescript-eslint/no-var-requires": "error",
        "@typescript-eslint/prefer-function-type": "error",
        "@typescript-eslint/prefer-namespace-keyword": "error",
        "@typescript-eslint/semi": "error",
        "@typescript-eslint/triple-slash-reference": "error",
        "@typescript-eslint/type-annotation-spacing": "error",
        "@typescript-eslint/unified-signatures": "error",
        "@typescript-eslint/no-floating-promises": "error",
        "@typescript-eslint/method-signature-style": ["error", "method"],
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
        "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
        "arrow-body-style": "error",
        "comma-dangle": "error",
        "comma-spacing": "off",
        "@typescript-eslint/comma-spacing": "error",
        "constructor-super": "error",
        "curly": "error",
        "eol-last": "error",
        "eqeqeq": [
            "error",
            "always"
        ],
        "import/no-default-export": "error",
        "import/no-unassigned-import": "error",
        "jsdoc/no-types": "error",
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
        "no-multiple-empty-lines": ["error", { "max": 1, "maxEOF": 1, "maxBOF": 0 }],
        "no-new-wrappers": "error",
        "no-return-await": "error",
        "no-sequences": "error",
        "no-sparse-arrays": "error",
        "no-trailing-spaces": "error",
        "no-undef-init": "error",
        "no-unsafe-finally": "error",
        "no-unused-expressions": "error",
        "no-unused-labels": "error",
        "no-var": "error",
        "one-var": [
            "error",
            "never"
        ],
        "prefer-const": "error",
        "prefer-object-spread": "error",
        "space-in-parens": [
            "error",
            "never"
        ],
        "spaced-comment": [
            "off",
            "always",
            { "line": { "exceptions": ["/"] } }  // triple slash directives
        ],
        "use-isnan": "error",
        "valid-typeof": "error",
        "yoda": "error",
        "space-infix-ops": "error",
        "header/header": [
            "warn",
            "block",
            [
                " --------------------------------------------------------------------------------------------",
                " * Copyright (c) Microsoft Corporation. All Rights Reserved.",
                " * See 'LICENSE' in the project root for license information.",
                " * ------------------------------------------------------------------------------------------ "

            ],
        ],

    }
};
