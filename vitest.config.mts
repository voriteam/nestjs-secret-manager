import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    coverage: { include: ['src/**/*.ts'], exclude: ['src/index.ts'] },
  },
});
