import js from '@eslint/js';
import globals from 'globals';
import clockRules from './eslint/clock.js';
import oneDoor from './eslint/one-door.js';

export default [
  { ignores: ['node_modules/**', 'ops/samples/**', 'ops/live/**', 'ops/benchmarks/**'] },
  js.configs.recommended,
  { rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }] } },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } }
  },
  ...oneDoor,
  ...clockRules
];
