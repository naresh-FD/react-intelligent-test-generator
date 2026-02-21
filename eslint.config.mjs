/**
 * ESLint 9 flat config — migrated from legacy .eslintrc.js
 * Uses FlatCompat to bridge existing plugin:* extends while staying on flat-config API.
 */
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  // ── Ignored paths ────────────────────────────────────────────────────────
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.testgen-results/**',
      '**/*.d.ts',
      // Config & build artefacts
      '**/jest.config.*',
      '**/webpack.config.*',
      '**/postcss.config.*',
      '**/tailwind.config.*',
    ],
  },

  // ── Legacy-compat block (bridges plugin:* extends) ────────────────────────
  ...compat.config({
    env: {
      browser: true,
      es2022: true,
      node: true,
    },
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:react/recommended',
      'plugin:react-hooks/recommended',
      'plugin:prettier/recommended',
    ],
    parser: '@typescript-eslint/parser',
    parserOptions: {
      ecmaFeatures: { jsx: true },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    plugins: ['react', '@typescript-eslint', 'prettier'],
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // React
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // TypeScript
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      // Prettier
      'prettier/prettier': ['error', { endOfLine: 'auto' }],

      // General
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  }),

  // ── Testgen package overrides (Node CLI — console.log is intentional) ─────
  {
    files: ['packages/testgen/src/**/*.ts'],
    rules: {
      // CLI tools use console.log for user output — allow it
      'no-console': ['warn', { allow: ['log', 'warn', 'error', 'info', 'table'] }],
    },
  },

  // ── Test file overrides ───────────────────────────────────────────────────
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
];
