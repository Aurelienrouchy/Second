import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { Platform } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebaseConfig';
import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import AsyncStorage from '@/utils/environmentStorage';

const DEV_APPLICATION_ID = 'com.seconde.app.dev';
const EAS_PROJECT_ID = '5f72091d-3473-467c-a4fd-96fe18cda4d2';
const STORAGE_KEY = 'seconde-dev-push-installation-v1';
const EXPO_TOKEN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export interface DevPushBinding {
  installationId: string;
  installationGeneration: number;
  expectedUid: string;
  expoPushToken: string;
}
interface Installation {
  installationId: string;
  generation: number;
  pending?: DevPushBinding;
  confirmed?: DevPushBinding;
}
let storageQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const request = storageQueue.catch(() => undefined).then(action);
  storageQueue = request;
  return request;
}

/** A production binary connected to Metro Dev cannot register its APNs identity. */
export function canRegisterDevPushDestination(): boolean {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return runtimeEnvironment.name === 'development' && runtimeEnvironment.projectId === 'seconde-dev' &&
    !runtimeEnvironment.useEmulators && Platform.OS === 'ios' &&
    Application.applicationId === DEV_APPLICATION_ID && projectId === EAS_PROJECT_ID;
}
function assertOwner(uid: string, assertContext: () => void) {
  assertContext();
  if (!canRegisterDevPushDestination() || auth.currentUser?.uid !== uid) throw new Error('L’inscription des notifications nécessite Seconde Dev et la même session.');
}
function binding(value: unknown, installationId: string): value is DevPushBinding {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.installationId === installationId && Number.isSafeInteger(v.installationGeneration) && Number(v.installationGeneration) > 0 &&
    typeof v.expectedUid === 'string' && !!v.expectedUid && typeof v.expoPushToken === 'string' && EXPO_TOKEN.test(v.expoPushToken);
}
async function readInstallation(): Promise<Installation> {
  // This journal contains a push delivery address and monotone installation
  // version, never Firebase credentials or provider authentication tokens.
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw === null) return {installationId: randomUUID(), generation: 0};
  const value = JSON.parse(raw) as Installation;
  if (!value || !UUID.test(value.installationId) || !Number.isSafeInteger(value.generation) || value.generation < 0 ||
      value.pending && (!binding(value.pending, value.installationId) || value.pending.installationGeneration > value.generation) ||
      value.confirmed && (!binding(value.confirmed, value.installationId) || value.confirmed.installationGeneration > value.generation)) {
    throw new Error('L’inscription de cet appareil doit être reprise.');
  }
  return value;
}
export async function prepareDevPushBinding(uid: string, expoPushToken: string, assertContext: () => void): Promise<DevPushBinding> {
  return serialized(async () => {
    assertOwner(uid, assertContext);
    if (!EXPO_TOKEN.test(expoPushToken)) throw new Error('Destination de notification invalide.');
    const installation = await readInstallation(); assertOwner(uid, assertContext);
    const generation = installation.generation + 1;
    if (!Number.isSafeInteger(generation)) throw new Error('La génération de cet appareil doit être vérifiée.');
    const pending = {installationId: installation.installationId, installationGeneration: generation, expectedUid: uid, expoPushToken};
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({...installation, generation, pending}));
    assertOwner(uid, assertContext);
    return pending;
  });
}
async function command(value: DevPushBinding, mode: 'register' | 'remove', assertContext: () => void) {
  assertOwner(value.expectedUid, assertContext);
  const result = await httpsCallable<Record<string, unknown>, {registered: boolean}>(functions, 'registerDevPushDestination')({
    ...value, mode, applicationId: DEV_APPLICATION_ID, easProjectId: EAS_PROJECT_ID, platform: 'ios',
  });
  assertOwner(value.expectedUid, assertContext);
  if (typeof result.data?.registered !== 'boolean' || mode === 'register' && !result.data.registered) throw new Error('L’inscription des notifications n’est pas confirmée.');
}
export async function registerDevPushDestination(value: DevPushBinding, assertContext: () => void): Promise<void> {
  await command(value, 'register', assertContext);
  await serialized(async () => {
    const installation = await readInstallation(); assertOwner(value.expectedUid, assertContext);
    if (installation.pending?.installationGeneration !== value.installationGeneration || installation.pending.expectedUid !== value.expectedUid) return;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({...installation, confirmed: value}));
    assertOwner(value.expectedUid, assertContext);
  });
}

/** Logout fences both a confirmed destination and a response-lost registration.
 * The backend compares owner, token and generation; a newer owner's record wins. */
export async function removeDevPushDestination(uid: string, token?: string): Promise<void> {
  if (!canRegisterDevPushDestination() || auth.currentUser?.uid !== uid) return;
  const installation = await serialized(readInstallation);
  const targets = [installation.pending, installation.confirmed].filter((value): value is DevPushBinding =>
    !!value && value.expectedUid === uid && (!token || value.expoPushToken === token));
  const latest = targets.sort((left, right) => right.installationGeneration - left.installationGeneration)[0];
  const owner = auth.currentUser;
  // Removing the highest known generation also tombstones a register whose
  // response was lost, and retires any earlier association of this same owner.
  if (latest) await command(latest, 'remove', () => {
    if (!owner || auth.currentUser !== owner || owner.uid !== uid) throw new Error('La session a changé.');
  });
}
