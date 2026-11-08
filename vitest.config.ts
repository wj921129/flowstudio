import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      '@flowstudio/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
});
