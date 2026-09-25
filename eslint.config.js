import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import angular from 'angular-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/.wrangler/**',
      '**/.angular/**',
      '**/coverage/**',
      'prototype/**',
      '**/worker-configuration.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,js,mjs}'],
    extends: [js.configs.recommended, tseslint.configs.strict, prettier],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['apps/web/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // Angular-DI braucht Wert-Importe für Klassen, die per inject() genutzt werden.
      '@typescript-eslint/consistent-type-imports': 'off',
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: ['fa', 'app'], style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'fa', style: 'camelCase' },
      ],
    },
  },
  {
    files: ['apps/web/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },
  {
    files: ['**/test/**', '**/*.spec.ts', '**/*.test.ts', '**/e2e/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
