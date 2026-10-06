import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/security/**/*.rules.test.ts'],
    // Explicit partial mode when only the official Firestore emulator is
    // available. Default/full execution still requires the Storage runtime.
    exclude: process.env.FIREBASE_RULES_FIRESTORE_ONLY === '1' ? ['tests/security/storage.rules.test.ts'] : [],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    fileParallelism: false,
    isolate: true,
  },
});
