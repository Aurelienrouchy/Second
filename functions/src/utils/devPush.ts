/** Explicit Dev-only, client-declared native destinations. These records are
 * not OS attestations and never qualify a production push destination. */
import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { runtimeProjectId } from '../config/runtimeEnvironment';

export const DEV_PUSH_APPLICATION_ID = 'com.seconde.app.dev';
export const DEV_PUSH_EAS_PROJECT_ID = '5f72091d-3473-467c-a4fd-96fe18cda4d2';
const protocol = 'seconde_dev_push_destination_v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uidPattern = /^[A-Za-z0-9_-]{1,128}$/;
const tokenPattern = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{1,300}\]$/;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function isDevPushRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SECONDE_ENV === 'development' && env.SECONDE_DEV_PUSH_ENABLED === 'true' &&
    env.SECONDE_DEV_EXPO_PROJECT_ID === DEV_PUSH_EAS_PROJECT_ID && env.FUNCTIONS_EMULATOR !== 'true' &&
    runtimeProjectId(env) === 'seconde-dev';
}

export interface DevPushInput {
  mode: 'register' | 'remove'; installationId: string; installationGeneration: number;
  expoPushToken: string; applicationId: typeof DEV_PUSH_APPLICATION_ID;
  easProjectId: typeof DEV_PUSH_EAS_PROJECT_ID; platform: 'ios'; expectedUid: string;
}
export interface DevPushDestination {
  protocol: typeof protocol; userId: string; installationId: string; installationGeneration: number;
  expoPushToken: string; tokenHash: string; bindingId: string;
  applicationId: typeof DEV_PUSH_APPLICATION_ID; easProjectId: typeof DEV_PUSH_EAS_PROJECT_ID;
  platform: 'ios'; source: 'client_declared_native_application'; registeredAt: Timestamp;
}
type Binding = Pick<DevPushDestination, 'userId' | 'installationId' | 'installationGeneration' | 'tokenHash' | 'bindingId'>;

export function parseDevPushInput(value: unknown, uid: string): DevPushInput {
  const input = value as Partial<DevPushInput> | null;
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['mode','installationId','installationGeneration','expoPushToken','applicationId','easProjectId','platform','expectedUid'].includes(key)) ||
      input.expectedUid !== uid || !uidPattern.test(uid) ||
      input.mode !== undefined && input.mode !== 'register' && input.mode !== 'remove' ||
      typeof input.installationId !== 'string' || !uuid.test(input.installationId) ||
      !Number.isSafeInteger(input.installationGeneration) || (input.installationGeneration as number) < 1 ||
      typeof input.expoPushToken !== 'string' || !tokenPattern.test(input.expoPushToken) ||
      input.applicationId !== DEV_PUSH_APPLICATION_ID || input.easProjectId !== DEV_PUSH_EAS_PROJECT_ID || input.platform !== 'ios')
    throw new HttpsError('invalid-argument', 'Destination Seconde Dev et compte exacts requis.');
  return { ...input, mode: input.mode ?? 'register' } as DevPushInput;
}

function destinationRef(userId: string, installationId: string) {
  return db.collection('dev_push_destinations').doc(userId).collection('devices').doc(installationId);
}
function installationRef(installationId: string) { return db.collection('dev_push_installations').doc(installationId); }
function tokenRef(tokenHash: string) { return db.collection('dev_push_tokens').doc(tokenHash); }
function binding(value: any): Binding | null {
  return value?.protocol === protocol && typeof value.userId === 'string' && uidPattern.test(value.userId) &&
    typeof value.installationId === 'string' && uuid.test(value.installationId) &&
    Number.isSafeInteger(value.installationGeneration) && value.installationGeneration >= 1 &&
    typeof value.tokenHash === 'string' && /^[a-f0-9]{64}$/.test(value.tokenHash) && uuid.test(value.bindingId)
    ? value as Binding : null;
}
function sameBinding(value: any, expected: Binding): boolean {
  const current = binding(value);
  return current != null && ['userId','installationId','installationGeneration','tokenHash','bindingId']
    .every(key => current[key as keyof Binding] === expected[key as keyof Binding]);
}
function destination(value: any): DevPushDestination | null {
  return binding(value) && tokenPattern.test(value.expoPushToken) && hash(value.expoPushToken) === value.tokenHash &&
    value.applicationId === DEV_PUSH_APPLICATION_ID && value.easProjectId === DEV_PUSH_EAS_PROJECT_ID && value.platform === 'ios' &&
    value.source === 'client_declared_native_application' && value.registeredAt instanceof Timestamp
    ? value as DevPushDestination : null;
}
function assertRuntime() {
  if (!isDevPushRuntime()) throw new HttpsError('failed-precondition', 'Les notifications de test sont réservées à Seconde Dev.');
}

/** Each native installation has a durable generation watermark. It survives
 * logout, so an older in-flight registration cannot undo a later account switch. */
export async function writeDevPushDestination(uid: string, input: DevPushInput,
  guard: (tx: FirebaseFirestore.Transaction) => Promise<unknown>): Promise<{registered: boolean}> {
  assertRuntime();
  return db.runTransaction(async tx => {
    assertRuntime();
    await guard(tx);
    const ownRef = destinationRef(uid, input.installationId), installRef = installationRef(input.installationId);
    const hashedToken = hash(input.expoPushToken), nativeTokenRef = tokenRef(hashedToken);
    const [own, install, token] = await Promise.all([tx.get(ownRef), tx.get(installRef), tx.get(nativeTokenRef)]);
    const currentInstall = install.data(), currentOwn = destination(own.data());
    if (install.exists && (!currentInstall || currentInstall.protocol !== protocol ||
        !Number.isSafeInteger(currentInstall.installationGeneration)))
      throw new HttpsError('unavailable', 'Association de cet appareil indisponible.');
    if (input.mode === 'remove') {
      const currentBinding = binding(currentInstall);
      if (currentInstall?.installationGeneration > input.installationGeneration ||
          currentBinding && currentBinding.userId !== uid ||
          currentInstall?.installationGeneration === input.installationGeneration && currentOwn &&
            currentOwn.expoPushToken !== input.expoPushToken) return {registered: false};
      // Logout may reach the server before its registration. Keep the newer
      // watermark even without a destination, preventing that delayed register.
      const previousTokenRef = currentBinding ? tokenRef(currentBinding.tokenHash) : null;
      const previousToken = previousTokenRef ? (await tx.get(previousTokenRef)).data() : null;
      if (currentBinding && currentOwn && sameBinding(currentOwn, currentBinding)) tx.delete(ownRef);
      if (currentBinding && previousTokenRef && sameBinding(previousToken, currentBinding)) tx.delete(previousTokenRef);
      tx.set(installRef, {protocol, installationId: input.installationId, installationGeneration: input.installationGeneration,
        revoked: true, revokedBy: uid, updatedAt: Timestamp.now()});
      return {registered: false};
    }
    if (currentInstall && currentInstall.installationGeneration >= input.installationGeneration) {
      return {registered: currentInstall.installationGeneration === input.installationGeneration && currentOwn != null &&
        currentOwn.userId === uid && currentOwn.expoPushToken === input.expoPushToken &&
        sameBinding(currentInstall, currentOwn) && sameBinding(token.data(), currentOwn)};
    }

    // Read every displaced association before writing. Both unique indexes join
    // the transaction, so concurrent tokens/owners cannot remain current.
    const displaced = [binding(currentInstall), binding(token.data())].filter((value): value is Binding => value !== null);
    const oldRefs = new Map<string, FirebaseFirestore.DocumentReference>();
    for (const old of displaced) for (const ref of [destinationRef(old.userId, old.installationId),
      installationRef(old.installationId), tokenRef(old.tokenHash)]) oldRefs.set(ref.path, ref);
    const oldDocuments = new Map<string, any>();
    for (const ref of oldRefs.values()) oldDocuments.set(ref.path, (await tx.get(ref)).data());
    for (const old of displaced) {
      const oldDestination = destinationRef(old.userId, old.installationId);
      if (sameBinding(oldDocuments.get(oldDestination.path), old)) tx.delete(oldDestination);
      const oldToken = tokenRef(old.tokenHash);
      if (oldToken.path !== nativeTokenRef.path && sameBinding(oldDocuments.get(oldToken.path), old)) tx.delete(oldToken);
      const oldInstall = installationRef(old.installationId);
      if (oldInstall.path !== installRef.path && sameBinding(oldDocuments.get(oldInstall.path), old))
        tx.set(oldInstall, {protocol, installationId: old.installationId, installationGeneration: old.installationGeneration,
          revoked: true, updatedAt: Timestamp.now()});
    }
    const next: DevPushDestination = {protocol, userId: uid, installationId: input.installationId,
      installationGeneration: input.installationGeneration, expoPushToken: input.expoPushToken, tokenHash: hashedToken,
      bindingId: randomUUID(), applicationId: DEV_PUSH_APPLICATION_ID, easProjectId: DEV_PUSH_EAS_PROJECT_ID,
      platform: 'ios', source: 'client_declared_native_application', registeredAt: Timestamp.now()};
    tx.set(ownRef, next);
    const index = {protocol, userId: uid, installationId: next.installationId,
      installationGeneration: next.installationGeneration, tokenHash: hashedToken, bindingId: next.bindingId};
    tx.set(installRef, index); tx.set(nativeTokenRef, index);
    return {registered: true};
  });
}

/** Deliberately ignores users.expoPushTokens and fcmTokens, even on Dev. */
export async function readDevPushDestinations(userId: string): Promise<DevPushDestination[]> {
  if (!isDevPushRuntime() || !uidPattern.test(userId)) return [];
  const devices = await db.collection('dev_push_destinations').doc(userId).collection('devices').limit(20).get();
  const eligible: DevPushDestination[] = [];
  for (const doc of devices.docs) {
    const value = destination(doc.data());
    if (value?.userId === userId && value.installationId === doc.id && await isCurrentDevPushDestination(value)) eligible.push(value);
  }
  return eligible;
}

/** A fresh check immediately before each gateway submission; client handlers
 * additionally discard a previously submitted push whose owner differs. */
export async function isCurrentDevPushDestination(expected: DevPushDestination): Promise<boolean> {
  if (!isDevPushRuntime() || !destination(expected)) return false;
  const [own, install, token] = await Promise.all([destinationRef(expected.userId, expected.installationId).get(),
    installationRef(expected.installationId).get(), tokenRef(expected.tokenHash).get()]);
  return sameBinding(own.data(), expected) && sameBinding(install.data(), expected) && sameBinding(token.data(), expected);
}

/** Late invalid receipts can only delete the exact destination that was sent.
 * A newer login/token binding, production and legacy arrays are untouched. */
export async function removeInvalidDevPushDestination(expected: DevPushDestination): Promise<void> {
  if (!isDevPushRuntime() || !destination(expected)) return;
  await db.runTransaction(async tx => {
    if (!isDevPushRuntime()) return;
    const ownRef = destinationRef(expected.userId, expected.installationId), installRef = installationRef(expected.installationId);
    const nativeTokenRef = tokenRef(expected.tokenHash);
    const [own, install, token] = await Promise.all([tx.get(ownRef), tx.get(installRef), tx.get(nativeTokenRef)]);
    if (!sameBinding(own.data(), expected) || !sameBinding(install.data(), expected) || !sameBinding(token.data(), expected)) return;
    tx.delete(ownRef); tx.delete(nativeTokenRef);
    tx.set(installRef, {protocol, installationId: expected.installationId, installationGeneration: expected.installationGeneration,
      revoked: true, updatedAt: Timestamp.now()});
  });
}

export function qualifyStoredDevPushDestination(value: unknown): DevPushDestination | null { return destination(value); }
