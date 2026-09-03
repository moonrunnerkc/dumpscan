import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** Packages whose output must be byte-identical on every machine. */
const PURE_PACKAGES = ['canon', 'merkle', 'versions', 'match', 'predicate'];

const PURE_GLOBS = PURE_PACKAGES.map((p) => `packages/${p}/src/**/*.ts`);

const FORBIDDEN_MODULES = [
  'fs',
  'node:fs',
  'node:fs/promises',
  'os',
  'node:os',
  'process',
  'node:process',
  'http',
  'node:http',
  'https',
  'node:https',
  'net',
  'node:net',
  'dns',
  'node:dns',
  'child_process',
  'node:child_process',
  'worker_threads',
  'node:worker_threads',
  'perf_hooks',
  'node:perf_hooks',
];

const LOCALE_METHODS =
  '/^(toLocaleLowerCase|toLocaleUpperCase|localeCompare|toLocaleString|toLocaleDateString|toLocaleTimeString)$/';

const PURITY_SYNTAX = [
  {
    selector: "MemberExpression[object.name='Date'][property.name='now']",
    message:
      'Date.now is nondeterministic. Time enters dumpscan only through sign and exclusions expiry.',
  },
  {
    selector: "NewExpression[callee.name='Date']",
    message: 'new Date reads the clock. Take the instant as an explicit parameter instead.',
  },
  {
    selector: "MemberExpression[object.name='Math'][property.name='random']",
    message:
      'Math.random is nondeterministic. Every value in a pure package must derive from the inputs.',
  },
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message:
      'process.env leaks the host environment into hashed output. Pass configuration as an argument.',
  },
  {
    selector: "MemberExpression[object.name='performance'][property.name='now']",
    message: 'performance.now reads a clock. Pure packages must not observe time.',
  },
  {
    selector: `MemberExpression[property.name=${LOCALE_METHODS}]`,
    message:
      'Locale-sensitive string methods vary with LANG. Use toLowerCase, toUpperCase, and code-unit comparison.',
  },
  {
    selector: `CallExpression[callee.property.name=${LOCALE_METHODS}]`,
    message:
      'Locale-sensitive string methods vary with LANG. Use toLowerCase, toUpperCase, and code-unit comparison.',
  },
  {
    selector: "CallExpression[callee.name='sort'][arguments.length=0]",
    message: 'Sort with an explicit comparator so the ordering does not depend on the engine.',
  },
  {
    selector: "CallExpression[callee.property.name='sort'][arguments.length=0]",
    message: 'Sort with an explicit comparator so the ordering does not depend on the engine.',
  },
];

const PURITY_GLOBALS = [
  { name: 'Intl', message: 'Intl is locale sensitive and forbidden in pure packages.' },
  { name: 'fetch', message: 'Pure packages must not reach the network.' },
  { name: 'XMLHttpRequest', message: 'Pure packages must not reach the network.' },
  { name: 'WebSocket', message: 'Pure packages must not reach the network.' },
];

export const config = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/reports/**',
      '**/node_modules/**',
      '.determinism/**',
      'fixtures/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.node,
    },
    rules: {
      'no-restricted-exports': [
        'error',
        {
          restrictDefaultExports: { direct: true, named: true, defaultFrom: true, namedFrom: true },
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  {
    files: PURE_GLOBS,
    rules: {
      'no-restricted-syntax': ['error', ...PURITY_SYNTAX],
      'no-restricted-globals': ['error', ...PURITY_GLOBALS],
      'no-restricted-imports': ['error', { paths: FORBIDDEN_MODULES }],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    files: ['packages/cli/src/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', '*.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'no-console': 'off',
      'no-restricted-exports': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  prettier,
);

export default config;
