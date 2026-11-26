import NativeAsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@/config/firebaseEnvironment', () => {
  const environment = {
    name: 'development', projectId: 'seconde-dev', useEmulators: false,
    storageNamespace: 'development:seconde-dev',
  };
  return {
    runtimeEnvironment: environment,
    getEnvironmentStorageKey: (key: string) => `@seconde:${environment.storageNamespace}:${key}`,
  };
});

import { createEnvironmentStorage, getEnvironmentFileDirectory } from '@/utils/environmentStorage';
import { runtimeEnvironment as mockEnvironment } from '@/config/firebaseEnvironment';

const development = createEnvironmentStorage(NativeAsyncStorage, '@seconde:development:seconde-dev:');
const emulators = createEnvironmentStorage(NativeAsyncStorage, '@seconde:development:demo-second:');
const production = createEnvironmentStorage(NativeAsyncStorage, '');

beforeEach(async () => {
  await NativeAsyncStorage.clear();
  mockEnvironment.name = 'development';
  mockEnvironment.useEmulators = false;
});

it('never adopts a production cached identity, draft or pending financial intention in development', async () => {
  for (const key of ['user_data', '@article_draft:user:same-uid', 'withdrawal:same-uid']) {
    await NativeAsyncStorage.setItem(key, 'production-record');
    expect(await development.getItem(key)).toBeNull();
    await development.setItem(key, 'development-record');
    expect(await development.getItem(key)).toBe('development-record');
    expect(await production.getItem(key)).toBe('production-record');
    expect(await emulators.getItem(key)).toBeNull();
  }
});

it('keeps journal enumeration and batched logical keys scoped to the same environment', async () => {
  await production.setItem('journal:uid:attempt', 'prod');
  await development.setItem('journal:uid:attempt', 'dev');
  await emulators.setItem('journal:uid:attempt', 'emulator');
  expect(await development.getAllKeys()).toEqual(['journal:uid:attempt']);
  expect(await production.getAllKeys()).toEqual(['journal:uid:attempt']);
  expect(await development.multiGet(['journal:uid:attempt', 'absent'])).toEqual([
    ['journal:uid:attempt', 'dev'], ['absent', null],
  ]);
});

it('removes only the development record while preserving production and emulator bytes', async () => {
  await production.setItem('same', 'prod');
  await development.setItem('same', 'dev');
  await emulators.setItem('same', 'emulator');
  await development.removeItem('same');
  expect(await development.getItem('same')).toBeNull();
  expect(await production.getItem('same')).toBe('prod');
  expect(await emulators.getItem('same')).toBe('emulator');
  expect('clear' in development).toBe(false);
});

it('refuses a batched response containing an unexpected key instead of adopting its value', async () => {
  const driver = {...NativeAsyncStorage, multiGet: jest.fn(async () => [['outside', 'private'] as [string, string | null]])};
  await expect(createEnvironmentStorage(driver, '@seconde:dev:').multiGet(['journal'])).rejects.toThrow('autre environnement');
});

it('keeps the production private files in place and partitions development files by project', () => {
  expect(getEnvironmentFileDirectory('draft_images')).toBe('draft_images/development%3Aseconde-dev');
  mockEnvironment.name = 'production';
  expect(getEnvironmentFileDirectory('draft_images')).toBe('draft_images');
});

it('never adopts the production analytics key or host in development', () => {
  const names = ['EXPO_PUBLIC_POSTHOG_API_KEY', 'EXPO_PUBLIC_POSTHOG_HOST',
    'EXPO_PUBLIC_DEV_POSTHOG_API_KEY', 'EXPO_PUBLIC_DEV_POSTHOG_HOST'] as const;
  const previous = names.map(name => process.env[name]);
  try {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'production-public-key';
    process.env.EXPO_PUBLIC_POSTHOG_HOST = 'https://analytics.production.example';
    delete process.env.EXPO_PUBLIC_DEV_POSTHOG_API_KEY;
    delete process.env.EXPO_PUBLIC_DEV_POSTHOG_HOST;
    jest.isolateModules(() => {
      const config = require('@/config/posthogConfig') as typeof import('@/config/posthogConfig');
      expect(config.POSTHOG_API_KEY).toBe('');
      expect(config.POSTHOG_HOST).not.toBe('https://analytics.production.example');
    });
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
