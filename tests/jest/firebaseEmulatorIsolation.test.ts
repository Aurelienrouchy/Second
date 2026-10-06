const mockApps: { options: { projectId?: string } }[] = [];
const mockInitializeApp = jest.fn((options: { projectId?: string }) => ({ options }));
const mockAuthEmulator = jest.fn();
const mockFirestoreEmulator = jest.fn();
const mockStorageEmulator = jest.fn();
const mockFunctionsEmulator = jest.fn();

jest.unmock('@/config/firebaseConfig');
jest.mock('firebase/app', () => ({
  getApps: () => mockApps,
  initializeApp: (options: { projectId?: string }) => mockInitializeApp(options),
}));
jest.mock('@firebase/auth', () => ({ getReactNativePersistence: jest.fn() }));
jest.mock('firebase/auth', () => ({
  initializeAuth: () => ({ kind: 'auth' }),
  getAuth: () => ({ kind: 'auth' }),
  connectAuthEmulator: (...args: unknown[]) => mockAuthEmulator(...args),
}));
jest.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({ kind: 'firestore' }),
  memoryLocalCache: jest.fn(),
  connectFirestoreEmulator: (...args: unknown[]) => mockFirestoreEmulator(...args),
}));
jest.mock('firebase/storage', () => ({
  getStorage: () => ({ kind: 'storage' }),
  connectStorageEmulator: (...args: unknown[]) => mockStorageEmulator(...args),
}));
jest.mock('firebase/functions', () => ({
  getFunctions: () => ({ kind: 'functions' }),
  connectFunctionsEmulator: (...args: unknown[]) => mockFunctionsEmulator(...args),
}));

const originalHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST;
const originalProject = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;

beforeEach(() => {
  jest.resetModules();
  mockApps.length = 0;
  delete process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST;
});

afterAll(() => {
  if (originalHost === undefined) delete process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST;
  else process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST = originalHost;
  if (originalProject === undefined) delete process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  else process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = originalProject;
});

it('isolates every SDK service from production during tests, including a production env override', () => {
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'production-project';
  jest.isolateModules(() => require('@/config/firebaseConfig'));
  expect(mockInitializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'demo-second' }));
  expect(mockAuthEmulator).toHaveBeenCalledWith({ kind: 'auth' }, 'http://127.0.0.1:9099', { disableWarnings: true });
  expect(mockFirestoreEmulator).toHaveBeenCalledWith({ kind: 'firestore' }, '127.0.0.1', 8080);
  expect(mockStorageEmulator).toHaveBeenCalledWith({ kind: 'storage' }, '127.0.0.1', 9199);
  expect(mockFunctionsEmulator).toHaveBeenCalledWith({ kind: 'functions' }, '127.0.0.1', 5001);
});

it('uses the configured device host consistently for all emulators', () => {
  process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST = '10.0.2.2';
  jest.isolateModules(() => require('@/config/firebaseConfig'));
  expect(mockAuthEmulator.mock.calls[0][1]).toBe('http://10.0.2.2:9099');
  for (const connect of [mockFirestoreEmulator, mockStorageEmulator, mockFunctionsEmulator]) {
    expect(connect.mock.calls[0][1]).toBe('10.0.2.2');
  }
});

it('refuses to reuse a preinitialised production app in an emulator run', () => {
  mockApps.push({ options: { projectId: 'production-project' } });
  expect(() => jest.isolateModules(() => require('@/config/firebaseConfig')))
    .toThrow('Emulator builds require the demo-second Firebase project.');
  expect(mockInitializeApp).not.toHaveBeenCalled();
  expect(mockAuthEmulator).not.toHaveBeenCalled();
});
