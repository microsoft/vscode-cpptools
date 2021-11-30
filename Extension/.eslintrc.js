module.exports = {
    "env": {
        "browser": true,
        "es6": true,
        "node": true
    },
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "project": "tsconfig.json",
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint",
        "@typescript-eslint/tslint",
        "eslint-plugin-jsdoc",
        "@typescript-eslint/eslint-plugin-tslint",
        "eslint-plugin-import",
    ],
    "rules": {
        "@typescript-eslint/adjacent-overload-signatures": "error",
        "@typescript-eslint/array-type": "error",
        "camelcase": "off",
        "@typescript-eslint/naming-convention": [
            "error",
            {
                "selector": "typeLike",
                "format": ["PascalCase"]
            }
        ],
        "@typescript-eslint/indent": "error",
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
        "@typescript-eslint/no-for-in-array": "error",
        "@typescript-eslint/no-misused-new": "error",
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
        "arrow-body-style": "error",
        "comma-dangle": "error",
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
        "no-redeclare": "error",
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
            "error",
            "always"
        ],
        "use-isnan": "error",
        "valid-typeof": "error",
        "yoda": "error",
        "@typescript-eslint/tslint/config": [
            "error",
            {
                "rules": {
                    "encoding": true,
                    "file-header": [
                        true,
                        ".*"
                    ],
                    "import-spacing": true,
                    "match-default-export-name": true,
                    "no-boolean-literal-compare": true,
                    "no-mergeable-namespace": true,
                    "no-reference-import": true,
                    "no-unnecessary-callback-wrapper": true,
                    "number-literal-format": true,
                    "one-line": [
                        true,
                        "check-catch",
                        "check-finally",
                        "check-else",
                        "check-open-brace",
                        "check-whitespace"
                    ],
                    "prefer-method-signature": true,
                    "prefer-while": true,
                    "typedef": [
                        true,
                        "variable-declaration",
                        "call-signature",
                        "variable-declaration-ignore-function"
                    ],
                    "whitespace": [
                        true,
                        "check-branch",
                        "check-operator",
                        "check-separator",
                        "check-preblock",
                        "check-type"
                    ]
                }
            }
        ]
    }
};
