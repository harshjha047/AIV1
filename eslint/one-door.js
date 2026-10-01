const BANNED = [
  { name: 'mongodb', message: 'Only packages/source-gate and packages/snapshot-db may import database drivers.' },
  { name: 'mongoose', message: 'Mongoose is banned; use the native driver inside the allowed packages.' },
  { name: 'pg', message: 'Only packages/source-gate may import pg.' }
];

const PATTERNS = [
  { group: ['mongodb/*', 'pg/*', 'pg-*', 'pg-*/*'], message: 'Database drivers are restricted to the one-door packages.' }
];

export default [
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    ignores: ['packages/source-gate/**', 'packages/snapshot-db/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: BANNED, patterns: PATTERNS }]
    }
  }
];
