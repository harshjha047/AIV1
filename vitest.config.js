import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{packages,apps}/**/test/**/*.test.js'],
    exclude: ['**/node_modules/**']
  }
});
