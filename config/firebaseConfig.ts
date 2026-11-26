import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getAuth, connectAuthEmulator } from 'firebase/auth';
// @ts-expect-error getReactNativePersistence exists at runtime
import { getReactNativePersistence } from '@firebase/auth';
import {
  initializeFirestore,
  memoryLocalCache,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firebaseProjects from './firebaseProjects.json';
import { runtimeEnvironment as environment } from './firebaseEnvironment';

// Firebase public configuration is a single canonical tuple per project. Old
// EXPO_PUBLIC_FIREBASE_* values cannot silently mix development and production.
const firebaseConfig = environment.useEmulators ? {
  apiKey: 'demo-api-key',
  projectId: environment.emulatorProjectId,
  authDomain: `${environment.emulatorProjectId}.firebaseapp.com`,
  storageBucket: `${environment.emulatorProjectId}.appspot.com`,
  appId: 'demo-second-app',
} : firebaseProjects[environment.name];

const requiredCloudOptions = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'] as const;
const cloudConfig = firebaseProjects[environment.name];
if (!environment.useEmulators && requiredCloudOptions.some(key =>
  typeof cloudConfig[key] !== 'string' || !cloudConfig[key].trim())) {
  throw new Error(`Configuration Firebase ${environment.name} incomplète.`);
}

const appName = environment.useEmulators
  ? 'seconde-emulator'
  : environment.name === 'production' ? '[DEFAULT]' : 'seconde-development';
const signature = JSON.stringify({
  config: firebaseConfig,
  appName,
  transport: environment.useEmulators ? `emulator:${environment.emulatorHost}` : 'cloud',
});
// Survives Fast Refresh. A reload is required before changing project or
// transport, so no existing Auth session can be adopted by another environment.
const runtime = globalThis as typeof globalThis & { __SECONDE_FIREBASE_RUNTIME__?: string };
const existingApps = getApps();
if (existingApps.length && (
  runtime.__SECONDE_FIREBASE_RUNTIME__ !== signature ||
  existingApps.some(existing => existing.name !== appName ||
    Object.entries(firebaseConfig).some(([key, value]) =>
      existing.options[key as keyof typeof existing.options] !== value))
)) {
  throw new Error(environment.useEmulators
    ? 'Emulator builds require the demo-second Firebase project. Redémarrez entièrement l’application.'
    : 'Le projet Firebase ou son transport a changé. Redémarrez entièrement l’application.');
}
const existingApp = existingApps.find(existing => existing.name === appName);
const app = existingApp ?? initializeApp(firebaseConfig, appName);
runtime.__SECONDE_FIREBASE_RUNTIME__ = signature;

// Auth persistence is keyed by the SDK app name and API key. Dev uses its own
// named app; production retains [DEFAULT] and its existing member sessions.
const auth = !existingApp
  ? initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })
  : getAuth(app);
const firestore = initializeFirestore(app, { localCache: memoryLocalCache() });
const storage = getStorage(app);
const functions = getFunctions(app, 'northamerica-northeast1');

if (environment.useEmulators && !existingApp) {
  const host = environment.emulatorHost;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(firestore, host, 8080);
  connectStorageEmulator(storage, host, 9199);
  connectFunctionsEmulator(functions, host, 5001);
}

export { app, auth, firestore, storage, functions };
