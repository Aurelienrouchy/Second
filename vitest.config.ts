import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    include: [
      'utils/**/*.test.ts',
      'lib/**/*.test.ts',
      'store/**/*.test.ts',
      'hooks/**/*.test.ts',
      'services/**/*.test.ts',
      'features/**/*.test.ts',
    ],
    exclude: ['tests/security/**', 'functions/**', 'node_modules/**'],
    setupFiles: ['./test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
