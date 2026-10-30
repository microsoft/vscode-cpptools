const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');

module.exports = defineConfig([
    {
        ignores: ['**/*.js'],
    },
    {
        files: ['**/*.ts'],
        extends: [js.configs.recommended, tseslint.configs['flat/recommended']],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
]);