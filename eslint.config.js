import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/.wrangler/**', '**/.angular/**', '**/coverage/**', 'prototype/**'],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier,
);
