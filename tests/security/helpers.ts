import fs from 'node:fs';
import path from 'node:path';

import {
  RulesTestEnvironment,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'second-rules-test';
const ROOT = path.resolve(__dirname, '..', '..');

let cachedEnv: RulesTestEnvironment | null = null;

export async function getTestEnv(): Promise<RulesTestEnvironment> {
  if (cachedEnv) return cachedEnv;
  cachedEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
  return cachedEnv;
}

export async function teardownTestEnv(): Promise<void> {
  if (cachedEnv) {
    await cachedEnv.cleanup();
    cachedEnv = null;
  }
}
