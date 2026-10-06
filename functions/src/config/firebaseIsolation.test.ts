import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initializeApp: vi.fn(), apps: [] as { options: { projectId: string } }[] }));
vi.mock('firebase-admin', () => ({
  apps: mocks.apps,
  initializeApp: mocks.initializeApp,
  firestore: vi.fn(), auth: vi.fn(), messaging: vi.fn(), storage: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.apps.length = 0;
  vi.unstubAllEnvs();
  for (const name of ['GCLOUD_PROJECT', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
    vi.stubEnv(name, undefined);
  }
});

function configureEmulators() {
  vi.stubEnv('GCLOUD_PROJECT', 'demo-second');
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
  vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
  vi.stubEnv('FIREBASE_STORAGE_EMULATOR_HOST', '127.0.0.1:9199');
}

describe('Admin test isolation', () => {
  it('fails before SDK initialization when a test has no emulator configuration', async () => {
    await expect(import('./firebase')).rejects.toThrow('Functions tests must mock Firebase');
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it('initializes the demo project and demo bucket for emulator integration tests', async () => {
    configureEmulators();
    await import('./firebase');
    expect(mocks.initializeApp).toHaveBeenCalledWith({ projectId: 'demo-second', storageBucket: 'demo-second.appspot.com' });
  });

  it('rejects a real project even if emulator hosts were set', async () => {
    configureEmulators();
    vi.stubEnv('GCLOUD_PROJECT', 'production-project');
    await expect(import('./firebase')).rejects.toThrow('Functions tests must mock Firebase');
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });

  it('rejects a preinitialized real project', async () => {
    configureEmulators();
    mocks.apps.push({ options: { projectId: 'production-project' } });
    await expect(import('./firebase')).rejects.toThrow('Functions tests cannot reuse');
    expect(mocks.initializeApp).not.toHaveBeenCalled();
  });
});
