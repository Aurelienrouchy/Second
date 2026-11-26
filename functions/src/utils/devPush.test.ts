import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({rows: new Map<string, any>(), writes: [] as string[], runtime: 'seconde-dev'}));
vi.mock('../config/runtimeEnvironment', () => ({runtimeProjectId: (env: NodeJS.ProcessEnv) => env.GCLOUD_PROJECT ?? state.runtime}));
vi.mock('../config/firebase', () => {
  const ref = (path: string): any => ({path, id: path.split('/').at(-1),
    collection: (name: string) => collection(`${path}/${name}`),
    get: async () => ({exists: state.rows.has(path), data: () => state.rows.get(path)})});
  const collection = (path: string): any => ({doc: (id: string) => ref(`${path}/${id}`),
    limit: () => ({get: async () => ({docs: [...state.rows].filter(([key]) => key.startsWith(path + '/') &&
      key.split('/').length === path.split('/').length + 1).map(([key, value]) => ({id: key.split('/').at(-1), data: () => value}))})})});
  return {db: {collection, runTransaction: async (operation: (tx: unknown) => Promise<unknown>) => {
    let written = false;
    return operation({get: async (document: any) => {
      if (written) throw new Error('read after write');
      return document.get();
    }, set: (document: any, value: any) => {written = true; state.writes.push(document.path); state.rows.set(document.path, value);},
    delete: (document: any) => {written = true; state.writes.push(document.path); state.rows.delete(document.path);}});
  }}};
});
import { DEV_PUSH_APPLICATION_ID, DEV_PUSH_EAS_PROJECT_ID, isDevPushRuntime, parseDevPushInput,
  writeDevPushDestination, readDevPushDestinations, removeInvalidDevPushDestination, isCurrentDevPushDestination,
  type DevPushInput } from './devPush';

const installation = '00000000-0000-4000-8000-000000000001';
const secondInstallation = '00000000-0000-4000-8000-000000000002';
const token = 'ExpoPushToken[test-dev-device]';
const guard = vi.fn().mockResolvedValue(undefined);
function input(uid: string, generation = 1, changes: Partial<DevPushInput> = {}): DevPushInput {
  return {mode: 'register', expectedUid: uid, installationId: installation, installationGeneration: generation,
    expoPushToken: token, applicationId: DEV_PUSH_APPLICATION_ID, easProjectId: DEV_PUSH_EAS_PROJECT_ID, platform: 'ios', ...changes};
}
const ownPath = (uid: string, device = installation) => `dev_push_destinations/${uid}/devices/${device}`;

beforeEach(() => {
  state.rows.clear(); state.writes.length = 0; state.runtime = 'seconde-dev'; vi.clearAllMocks();
  vi.stubEnv('SECONDE_ENV', 'development'); vi.stubEnv('SECONDE_DEV_PUSH_ENABLED', 'true');
  vi.stubEnv('SECONDE_DEV_EXPO_PROJECT_ID', DEV_PUSH_EAS_PROJECT_ID); vi.stubEnv('FUNCTIONS_EMULATOR', 'false');
  vi.stubEnv('GCLOUD_PROJECT', 'seconde-dev');
});

describe('isolated Dev push destinations', () => {
  it('requires the exact cloud runtime and explicit pinned native project', () => {
    expect(isDevPushRuntime()).toBe(true);
    for (const overrides of [{SECONDE_ENV: 'production'}, {SECONDE_DEV_PUSH_ENABLED: 'false'},
      {GCLOUD_PROJECT: 'seconde-b47a6'}, {FUNCTIONS_EMULATOR: 'true'}, {SECONDE_DEV_EXPO_PROJECT_ID: 'other'}]) {
      expect(isDevPushRuntime({...process.env, ...overrides})).toBe(false);
    }
  });
  it('validates a declared native identity, UID and generation without accepting prod or raw APNs', () => {
    expect(parseDevPushInput(input('A'), 'A')).toEqual(input('A'));
    for (const changes of [{expectedUid: 'B'}, {installationGeneration: 0}, {installationGeneration: 1.1},
      {applicationId: 'com.seconde.app'}, {easProjectId: 'wrong'}, {expoPushToken: 'a'.repeat(64)},
      {installationId: '../other'}, {unexpected: true}]) expect(() => parseDevPushInput({...input('A'), ...changes}, 'A')).toThrow();
  });
  it('registers once, ignores legacy arrays and reuses the exact binding for retries', async () => {
    state.rows.set('users/A', {expoPushTokens: ['ExpoPushToken[prod]'], fcmTokens: ['legacy']});
    expect(await writeDevPushDestination('A', input('A'), guard)).toEqual({registered: true});
    const first = state.rows.get(ownPath('A'));
    expect(first.source).toBe('client_declared_native_application');
    expect(await readDevPushDestinations('A')).toEqual([first]);
    state.writes.length = 0;
    expect(await writeDevPushDestination('A', input('A'), guard)).toEqual({registered: true});
    expect(state.writes).toEqual([]);
    expect(guard).toHaveBeenCalledTimes(2);
  });
  it('rebinds the same iPhone to B and rejects delayed A registration/removal and receipt cleanup', async () => {
    await writeDevPushDestination('A', input('A'), guard);
    const old = state.rows.get(ownPath('A'));
    await writeDevPushDestination('B', input('B', 2), guard);
    expect(await readDevPushDestinations('A')).toEqual([]);
    const current = state.rows.get(ownPath('B'));
    expect(await writeDevPushDestination('A', input('A'), guard)).toEqual({registered: false});
    await writeDevPushDestination('A', input('A', 1, {mode: 'remove'}), guard);
    await removeInvalidDevPushDestination(old);
    expect(state.rows.get(ownPath('B'))).toEqual(current);
    expect(await isCurrentDevPushDestination(old)).toBe(false);
    expect(await readDevPushDestinations('B')).toEqual([current]);
  });
  it('retains a logout tombstone and prevents delayed same-generation registration', async () => {
    await writeDevPushDestination('A', input('A', 2, {mode: 'remove'}), guard);
    expect(await writeDevPushDestination('A', input('A', 2), guard)).toEqual({registered: false});
    expect(await readDevPushDestinations('A')).toEqual([]);
    expect(await writeDevPushDestination('A', input('A', 3), guard)).toEqual({registered: true});
  });
  it('can revoke an earlier same-owner binding before a new registration reaches the server', async () => {
    await writeDevPushDestination('A', input('A'), guard);
    await writeDevPushDestination('A', input('A', 2, {mode: 'remove', expoPushToken: 'ExpoPushToken[rotated]'}), guard);
    expect(await readDevPushDestinations('A')).toEqual([]);
    expect(await writeDevPushDestination('A', input('A', 2, {expoPushToken: 'ExpoPushToken[rotated]'}), guard))
      .toEqual({registered: false});
  });
  it('never lets a foreign remove take over another account even with a greater generation', async () => {
    await writeDevPushDestination('B', input('B'), guard);
    const before = [...state.rows];
    await writeDevPushDestination('A', input('A', 999, {mode: 'remove'}), guard);
    expect([...state.rows]).toEqual(before);
  });
  it('enforces token uniqueness when the native installation identifier changes', async () => {
    await writeDevPushDestination('A', input('A'), guard);
    await writeDevPushDestination('B', input('B', 1, {installationId: secondInstallation}), guard);
    expect(await readDevPushDestinations('A')).toEqual([]);
    expect(await readDevPushDestinations('B')).toHaveLength(1);
    expect(state.rows.get(`dev_push_installations/${installation}`).revoked).toBe(true);
  });
  it('requires a new generation for token rotation and preserves it against an old invalid receipt', async () => {
    await writeDevPushDestination('A', input('A'), guard);
    const original = state.rows.get(ownPath('A'));
    expect(await writeDevPushDestination('A', input('A', 1, {expoPushToken: 'ExpoPushToken[rotated]'}), guard))
      .toEqual({registered: false});
    await writeDevPushDestination('A', input('A', 2, {expoPushToken: 'ExpoPushToken[rotated]'}), guard);
    await removeInvalidDevPushDestination(original);
    expect((await readDevPushDestinations('A'))[0].expoPushToken).toBe('ExpoPushToken[rotated]');
    expect(state.rows.has(`dev_push_tokens/${original.tokenHash}`)).toBe(false);
  });
  it('refuses an orphaned destination when one unique index no longer proves its current binding', async () => {
    await writeDevPushDestination('A', input('A'), guard);
    const original = state.rows.get(ownPath('A'));
    state.rows.delete(`dev_push_tokens/${original.tokenHash}`);
    expect(await readDevPushDestinations('A')).toEqual([]);
    state.writes.length = 0;
    await removeInvalidDevPushDestination(original);
    expect(state.writes).toEqual([]);
  });
  it('cleans only the current invalid binding and preserves all legacy user data', async () => {
    const legacy = {expoPushTokens: [token], fcmTokens: ['keep']}; state.rows.set('users/A', legacy);
    await writeDevPushDestination('A', input('A'), guard);
    await removeInvalidDevPushDestination(state.rows.get(ownPath('A')));
    expect(await readDevPushDestinations('A')).toEqual([]);
    expect(state.rows.get('users/A')).toEqual(legacy);
    expect(state.writes.every(path => path.startsWith('dev_push_'))).toBe(true);
  });
  it('fails closed outside Dev without a read or write to legacy destinations', async () => {
    await writeDevPushDestination('A', input('A'), guard);
    const before = [...state.rows]; vi.stubEnv('GCLOUD_PROJECT', 'seconde-b47a6');
    expect(await readDevPushDestinations('A')).toEqual([]);
    await expect(writeDevPushDestination('A', input('A', 2), guard)).rejects.toThrow();
    await removeInvalidDevPushDestination(state.rows.get(ownPath('A')));
    expect([...state.rows]).toEqual(before);
  });
});
