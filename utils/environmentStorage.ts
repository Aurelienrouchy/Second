import NativeAsyncStorage from '@react-native-async-storage/async-storage';
import { getEnvironmentStorageKey, runtimeEnvironment } from '@/config/firebaseEnvironment';

type StorageDriver = Pick<typeof NativeAsyncStorage,
  'getItem' | 'setItem' | 'removeItem' | 'getAllKeys' | 'multiGet'>;

const ENVIRONMENT_KEY_PREFIX = '@seconde:';

/**
 * Keep callers' logical keys unchanged, including journals which enumerate and
 * validate their own keys. Development never reads or migrates legacy keys.
 * Production keeps its existing storage without exposing development entries.
 */
export function createEnvironmentStorage(driver: StorageDriver, prefix: string) {
  const physicalKey = (key: string) => `${prefix}${key}`;
  const owns = (key: string) => prefix
    ? key.startsWith(prefix)
    : !key.startsWith(ENVIRONMENT_KEY_PREFIX);

  return {
    getItem(key: string) {
      return driver.getItem(physicalKey(key));
    },
    setItem(key: string, value: string) {
      return driver.setItem(physicalKey(key), value);
    },
    removeItem(key: string) {
      return driver.removeItem(physicalKey(key));
    },
    async getAllKeys(): Promise<readonly string[]> {
      return (await driver.getAllKeys())
        .filter(owns)
        .map(key => key.slice(prefix.length));
    },
    async multiGet(keys: readonly string[]): Promise<readonly [string, string | null][]> {
      const expected = new Map<string, number>();
      for (const key of keys.map(physicalKey)) expected.set(key, (expected.get(key) ?? 0) + 1);
      const rows = await driver.multiGet(keys.map(physicalKey));
      if (rows.length !== keys.length) {
        throw new Error('Le stockage n’a pas renvoyé toutes les clés demandées.');
      }
      return rows.map(([key, value]) => {
        const remaining = expected.get(key) ?? 0;
        if (remaining < 1 || !owns(key)) {
          throw new Error('Le stockage a renvoyé une clé d’un autre environnement.');
        }
        expected.set(key, remaining - 1);
        return [key.slice(prefix.length), value];
      });
    },
  };
}

/** Persistent private files use the same project partition as their journals. */
export function getEnvironmentFileDirectory(directory: string): string {
  return runtimeEnvironment.name === 'production' && !runtimeEnvironment.useEmulators
    ? directory
    : `${directory}/${encodeURIComponent(runtimeEnvironment.storageNamespace)}`;
}

// Deliberately no native clear(): clearing all clients could erase production
// sessions and journals while the installed development client shares a sandbox.
const EnvironmentStorage = createEnvironmentStorage(
  NativeAsyncStorage,
  getEnvironmentStorageKey(''),
);

export default EnvironmentStorage;
