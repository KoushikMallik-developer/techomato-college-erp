import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/rules/**/*.test.js'], testTimeout: 30000, fileParallelism: false },
});
