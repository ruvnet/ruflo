// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-cjs/**',
      'node_modules/**',
      'coverage/**',
      'bin/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
    ],
  },
  // Configuration for source files (with type-aware linting)
  {
    files: ['src/**/*.ts'],
    ignores: ['src/__tests__/**', 'src/**/tests/**', '**/*.test.ts', '**/*.spec.ts', '**/*.bench.ts'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  // Configuration for test files (without type-aware linting to avoid tsconfig issues)
  {
    files: ['src/__tests__/**/*.ts', 'src/**/tests/**/*.ts', '**/*.test.ts', '**/*.spec.ts', '**/*.bench.ts'],
    extends: [
      ...tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',  // Allow console in tests
      'prefer-const': 'error',
      'no-var': 'error',
    },
  }
);
