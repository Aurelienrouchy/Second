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
    // Garde-fou anti-collision avec Jest : Vitest ne ramasse que les *.test.ts
    // (logique pure / stores / services / hooks data). Les tests composant /
    // écran / hook RN (*.test.tsx) et le dossier tests/jest/ appartiennent à Jest.
    exclude: [
      'tests/security/**',
      'tests/jest/**',
      'functions/**',
      'node_modules/**',
      '**/*.test.tsx',
    ],
    setupFiles: ['./test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
