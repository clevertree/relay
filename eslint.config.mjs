// Root ESLint Flat Config
// Applies strict rules to template/hooks (client-side repo UI/hooks)

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // React Native app override: keep rules reasonable for RN code so linting is actionable.
  {
    files: ['apps/client-react-native/src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: resolve(rootDir, 'apps/client-react-native'),
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': 'off',
      // Loosen some JS rules for RN to reduce noise while we incrementally fix code
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['template/hooks/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: new URL('./template', import.meta.url),
        project: ['./template/tsconfig.json'],
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    },
  },
]
