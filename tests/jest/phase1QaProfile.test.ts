import { httpsCallable } from 'firebase/functions';
import { spawn } from 'node:child_process';
import phase1Release from '@/functions/phase1-release.json';

const mockEnvironment = { name: 'development', projectId: 'seconde-dev', useEmulators: false };
jest.mock('@/config/firebaseEnvironment', () => ({ get runtimeEnvironment() { return mockEnvironment; } }));
jest.mock('node:child_process', () => ({ spawn: jest.fn(() => ({ on: jest.fn().mockReturnThis() })) }));

const environmentKeys = ['EXPO_PUBLIC_PHASE1_QA', 'EXPO_PUBLIC_PAYMENTS_ENABLED',
  'EXPO_PUBLIC_SHIPPING_ENABLED', 'EXPO_PUBLIC_COMMERCE_TEST_MODE', 'EXPO_PUBLIC_DEV_POSTHOG_API_KEY'] as const;
const originalValues = environmentKeys.map(key => [key, process.env[key]] as const);
const originalArguments = process.argv;

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockEnvironment, { name: 'development', projectId: 'seconde-dev', useEmulators: false });
  for (const key of environmentKeys) delete process.env[key];
});
afterEach(() => {
  process.argv = originalArguments;
  for (const [key, value] of originalValues) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  jest.restoreAllMocks();
});

it.each([
  ['development', 'seconde-dev', false, 'true', true],
  ['development', 'seconde-dev', false, undefined, false],
  ['development', 'seconde-dev', false, 'TRUE', false],
  ['development', 'demo-second', true, 'true', false],
  ['development', 'seconde-dev', true, 'true', false],
  ['development', 'seconde-b47a6', false, 'true', false],
  ['production', 'seconde-b47a6', false, 'true', false],
  ['production', 'seconde-dev', false, 'true', false],
] as const)('confines phase 1 QA to explicit Dev cloud: %s/%s, emulator %s, flag %s', (name, projectId, useEmulators, flag, enabled) => {
  Object.assign(mockEnvironment, { name, projectId, useEmulators });
  if (flag !== undefined) process.env.EXPO_PUBLIC_PHASE1_QA = flag;
  jest.isolateModules(() => {
    const flags = require('@/config/featureFlags') as typeof import('@/config/featureFlags');
    const { phase1CallableName } = require('@/config/catalogueCallableContracts') as typeof import('@/config/catalogueCallableContracts');
    expect(flags.PHASE1_QA_ENABLED).toBe(enabled);
    expect(phase1CallableName('getWalletInfo')).toBe(enabled ? 'getWalletInfoPhase1Dev' : 'getWalletInfo');
    expect(phase1CallableName('acceptSwap')).toBe(enabled || name === 'production' ? 'acceptSwapV2' : 'acceptSwap');
  });
});

it('closes every commercial entry even when inherited variables request opening them', () => {
  for (const key of environmentKeys) process.env[key] = 'true';
  jest.isolateModules(() => {
    const flags = require('@/config/featureFlags') as typeof import('@/config/featureFlags');
    expect(flags.PHASE1_QA_ENABLED).toBe(true);
    expect([flags.PAYMENTS_ENABLED, flags.SHIPPING_ENABLED, flags.SHIPPING_LISTINGS_ENABLED,
      flags.DEV_COMMERCE_TESTING_ENABLED, flags.SQUARE_INVENTORY_PILOT_ENABLED]).toEqual([false, false, false, false, false]);
  });
});

it('keeps ordinary Dev commerce and explicitly enabled production flags unchanged', () => {
  for (const name of ['development', 'production'] as const) {
    Object.assign(mockEnvironment, { name, projectId: name === 'development' ? 'seconde-dev' : 'seconde-b47a6' });
    process.env.EXPO_PUBLIC_PHASE1_QA = name === 'production' ? 'true' : 'false';
    for (const key of environmentKeys.slice(1)) process.env[key] = 'true';
    jest.isolateModules(() => {
      const flags = require('@/config/featureFlags') as typeof import('@/config/featureFlags');
      expect(flags.PHASE1_QA_ENABLED).toBe(false);
      expect(flags.PAYMENTS_ENABLED).toBe(true);
      expect(flags.SHIPPING_ENABLED).toBe(true);
      expect(flags.SHIPPING_LISTINGS_ENABLED).toBe(true);
      expect(flags.DEV_COMMERCE_TESTING_ENABLED).toBe(name === 'development');
      expect(flags.SQUARE_INVENTORY_PILOT_ENABLED).toBe(name === 'development');
    });
  }
});

it.each([
  ['development', 'seconde-dev', 'true', ''],
  ['development', 'seconde-dev', 'false', 'synthetic-dev-capture-key'],
  ['production', 'seconde-b47a6', 'true', ''],
] as const)('does not enable analytics in phase 1 QA or production: %s/%s flag %s', (name, projectId, flag, expected) => {
  Object.assign(mockEnvironment, { name, projectId });
  process.env.EXPO_PUBLIC_PHASE1_QA = flag;
  process.env.EXPO_PUBLIC_DEV_POSTHOG_API_KEY = 'synthetic-dev-capture-key';
  jest.isolateModules(() => {
    expect((require('@/config/posthogConfig') as typeof import('@/config/posthogConfig')).POSTHOG_API_KEY).toBe(expected);
  });
});

it('routes the installed phase 1 contracts and preserves payloads and unknown names', async () => {
  process.env.EXPO_PUBLIC_PHASE1_QA = 'true';
  const request = jest.fn(async (payload: unknown) => ({ data: payload }));
  jest.mocked(httpsCallable).mockReturnValue(request);
  let result: unknown;
  jest.isolateModules(() => {
    const { phase1CallableName, phase1QaDevContracts } = require('@/config/catalogueCallableContracts') as typeof import('@/config/catalogueCallableContracts');
    for (const { original, name } of phase1Release.versionedFunctions) expect(phase1CallableName(original)).toBe(name);
    expect(Object.keys(phase1QaDevContracts)).toHaveLength(9);
    for (const [original, endpoint] of Object.entries(phase1QaDevContracts)) {
      expect(phase1CallableName(original)).toBe(endpoint);
      expect(phase1CallableName(endpoint)).toBe(endpoint);
      expect(phase1CallableName(original, 'production')).toBe(original);
    }
    expect(phase1CallableName('createPaymentIntent')).toBe('createPaymentIntent');
    expect(phase1CallableName('__proto__')).toBe('__proto__');
    const { phase1HttpsCallable } = require('@/services/phase1Callable') as typeof import('@/services/phase1Callable');
    result = phase1HttpsCallable({} as Parameters<typeof httpsCallable>[0], 'readSupportRequests')({ expectedUid: 'qa-dev-only', mode: 'owner_list' });
  });
  await expect(result).resolves.toEqual({ data: { expectedUid: 'qa-dev-only', mode: 'owner_list' } });
  expect(httpsCallable).toHaveBeenCalledWith({}, 'readSupportRequestsPhase1Dev');
  expect(request).toHaveBeenCalledWith({ expectedUid: 'qa-dev-only', mode: 'owner_list' });
});

function launch(arguments_: string[]) {
  process.argv = ['node', 'scripts/start-dev.cjs', ...arguments_];
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.isolateModules(() => { require('../../scripts/start-dev.cjs'); });
}

it('launches the explicit phase 1 profile only on Dev with commercial rails closed', () => {
  process.env.EXPO_PUBLIC_PHASE1_QA = 'false';
  launch(['--phase1', '--port', '8091']);
  expect(spawn).toHaveBeenCalledWith(process.execPath, expect.arrayContaining(['start', '--dev-client', '--scheme', 'seconde-dev', '--port', '8091']),
    expect.objectContaining({ env: expect.objectContaining({
      EXPO_PUBLIC_APP_ENV: 'development', EXPO_PUBLIC_FIREBASE_EMULATORS: '0', EXPO_PUBLIC_PHASE1_QA: 'true',
      EXPO_PUBLIC_PAYMENTS_ENABLED: 'false', EXPO_PUBLIC_SHIPPING_ENABLED: 'false', EXPO_PUBLIC_COMMERCE_TEST_MODE: 'false',
    }) }));
  expect(jest.mocked(spawn).mock.calls[0][1]).not.toContain('--phase1');
});

it('cannot combine phase 1 cloud QA with emulators', () => {
  expect(() => launch(['--phase1', '--emulators'])).toThrow('Seconde Dev distant');
  expect(spawn).not.toHaveBeenCalled();
});

it.each([[], ['--emulators']])('resets an inherited QA flag outside the explicit profile: %s', (...arguments_) => {
  process.env.EXPO_PUBLIC_PHASE1_QA = 'true';
  launch(arguments_);
  expect(spawn).toHaveBeenCalledWith(expect.anything(), expect.anything(),
    expect.objectContaining({ env: expect.objectContaining({ EXPO_PUBLIC_PHASE1_QA: 'false' }) }));
});
