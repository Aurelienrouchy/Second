import firebaseProjects from './firebaseProjects.json';

export type AppEnvironment = 'development' | 'production';

/** One policy for SDK clients, REST endpoints and on-device storage. No Firebase SDK imports. */
export function resolveFirebaseEnvironment(options: {
  test: boolean;
  development?: boolean;
  appEnvironment?: string;
  useEmulators?: string;
  emulatorHost?: string;
}) {
  const useEmulators = options.test || options.useEmulators === '1';
  const requestedEnvironment = options.appEnvironment || 'development';
  if (!options.test && requestedEnvironment !== 'development' && requestedEnvironment !== 'production') {
    throw new Error('EXPO_PUBLIC_APP_ENV doit valoir development ou production.');
  }
  if (!options.test && options.development && requestedEnvironment === 'production') {
    throw new Error('Le lancement local ne peut pas utiliser Firebase Production. Utilisez Seconde Dev.');
  }
  if (!options.test && requestedEnvironment === 'production' && useEmulators) {
    throw new Error('Un build de production ne peut pas utiliser les émulateurs Firebase.');
  }
  const name: AppEnvironment = options.test ? 'development' : requestedEnvironment as AppEnvironment;
  const projectId = useEmulators ? 'demo-second' : firebaseProjects[name].projectId;
  if (!projectId || (name === 'development' && !useEmulators && projectId === firebaseProjects.production.projectId)) {
    throw new Error('Seconde Dev doit utiliser un projet Firebase distinct de la production.');
  }
  return {
    name,
    projectId,
    useEmulators,
    emulatorHost: options.emulatorHost || '127.0.0.1',
    emulatorProjectId: 'demo-second',
    storageNamespace: useEmulators ? `emulator:${projectId}` : `${name}:${projectId}`,
    appScheme: name === 'production' ? 'seconde' : 'seconde-dev',
  };
}

export const runtimeEnvironment = resolveFirebaseEnvironment({
  test: process.env.NODE_ENV === 'test',
  development: (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.NODE_ENV === 'development',
  appEnvironment: process.env.EXPO_PUBLIC_APP_ENV,
  useEmulators: process.env.EXPO_PUBLIC_FIREBASE_EMULATORS,
  emulatorHost: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
});

/** Keep production data intact; development never reads its historical keys. */
export function getEnvironmentStorageKey(key: string): string {
  return runtimeEnvironment.name === 'production'
    ? key
    : `@seconde:${runtimeEnvironment.storageNamespace}:${key}`;
}
