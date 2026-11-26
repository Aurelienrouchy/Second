import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {auth} from '@/config/firebaseConfig';
import {runtimeEnvironment} from '@/config/firebaseEnvironment';
import {getAuthSessionGeneration, useAuthStore} from '@/store/authStore';
import DeviceStorage from '@/utils/environmentStorage';
import {ACCOUNT_ERASURE_PROTOCOL, erasureDigest, erasureIdentifier, isAccountErasureAttempt,
  isAccountErasureReceipt, isAccountErasureRecoveryAttempt} from '@/types/accountErasure';
import type {AccountErasureAttempt, AccountErasurePayload, AccountErasureReceipt, AccountErasureRecoveryAttempt,
  AccountErasureRecoveryPayload, AccountErasureLocalAttempt} from '@/types/accountErasure';

interface StoredAttempt extends AccountErasureAttempt {observationKey: string}
interface StoredRecovery extends AccountErasureRecoveryAttempt {observationKey: string}
interface Pointer {version: 1; ownerId: string; commandId: string | null; recoveryId: string | null;
  anonymousAllowed: boolean; anonymousBlocked: boolean}
interface Session {uid: string | null; generation: number}
const options: SecureStore.SecureStoreOptions = {keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false, keychainService: `ca.seconde.erasure.${runtimeEnvironment.projectId}`};
const pointerKey = `second-erasure-discovery-${runtimeEnvironment.projectId}`;
// Nonsensitive, fail-closed tombstone only. No owner, command identifier or
// capability ever leaves SecureStore. This survives a keychain write failure
// during a foreign account adoption followed by an app restart.
const guestBlockKey = 'account_erasure_guest_blocked';
let tail: Promise<unknown> = Promise.resolve();
let recoveryPoisoned = false;
const listeners = new Set<() => void>();
let revision = 0;
const failure = () => new Error('Le suivi sécurisé de cette demande doit être relu avant de poursuivre.');
const changed = () => {revision++; for (const listener of listeners) listener();};
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const current = tail.then(work, work); tail = current.then(() => undefined, () => undefined); return current;
};
async function guestBlocked(check: () => void): Promise<boolean> {
  check(); let raw: string | null;
  try {raw = await DeviceStorage.getItem(guestBlockKey);} catch {throw failure();}
  check(); if (![null, 'true', 'false'].includes(raw)) throw failure(); return raw === 'true';
}
async function setGuestBlocked(blocked: boolean, check: () => void): Promise<void> {
  check(); try {await DeviceStorage.setItem(guestBlockKey, blocked ? 'true' : 'false');} catch {throw failure();}
  check(); if (await guestBlocked(check) !== blocked) throw failure();
}
function session(): Session {
  const state = useAuthStore.getState(), uid = auth.currentUser?.uid ?? null;
  if (state.isLoading || uid !== state.authenticatedUid) throw failure();
  return {uid, generation: getAuthSessionGeneration()};
}
function guarded(expected: Session, check: () => void): () => void {
  return () => {check(); const current = session();
    if (current.uid !== expected.uid || current.generation !== expected.generation) throw failure();};
}
const hash = (value: unknown) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, JSON.stringify(value));
const slot = async (ownerId: string) => `second-erasure-${await hash([ACCOUNT_ERASURE_PROTOCOL, runtimeEnvironment.storageNamespace, ownerId])}`;
const recoverySlot = async (ownerId: string) => `second-erasure-recovery-${await hash([ACCOUNT_ERASURE_PROTOCOL, runtimeEnvironment.storageNamespace, ownerId])}`;
const reference = (value: StoredAttempt): AccountErasureAttempt => ({protocol: value.protocol, ownerId: value.ownerId,
  requestId: value.requestId, commandId: value.commandId, preparedAt: value.preparedAt, phase: value.phase, receipt: value.receipt});
const identity = (value: AccountErasureAttempt) => JSON.stringify([value.protocol, value.ownerId, value.requestId, value.commandId, value.preparedAt]);
const recoveryReference = (value: StoredRecovery): AccountErasureRecoveryAttempt => ({protocol: value.protocol, ownerId: value.ownerId,
  recoveryId: value.recoveryId, preparedAt: value.preparedAt, phase: value.phase});
const stable = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(
    Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  return item;
});
async function available(check: () => void) {
  check(); let supported = false; try {supported = await SecureStore.isAvailableAsync();} catch {throw failure();}
  check(); if (!supported) throw failure();
}
async function get(key: string, check: () => void): Promise<string | null> {
  check(); let raw: string | null; try {raw = await SecureStore.getItemAsync(key, options);} catch {throw failure();}
  check(); return raw;
}
async function put(key: string, value: unknown, check: () => void): Promise<void> {
  const raw = JSON.stringify(value);
  // Keep the record below conservative native keychain payload limits.
  if (raw.length > 2000) throw failure();
  check(); try {await SecureStore.setItemAsync(key, raw, options);} catch {throw failure();} check();
  if (await get(key, check) !== raw) throw failure();
}
async function remove(key: string, check: () => void): Promise<void> {
  check(); try {await SecureStore.deleteItemAsync(key, options);} catch {throw failure();} check();
  if (await get(key, check) !== null) throw failure();
}
function parsePointer(raw: string | null): Pointer | null {
  if (!raw) return null;
  if (raw.length > 800) throw failure();
  let value: unknown; try {value = JSON.parse(raw);} catch {throw failure();}
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure();
  const p = value as Record<string, unknown>;
  if (Object.keys(p).sort().join(',') !== 'anonymousAllowed,anonymousBlocked,commandId,ownerId,recoveryId,version' ||
      p.version !== 1 || !erasureIdentifier(p.ownerId) ||
      !(erasureDigest(p.commandId) && p.recoveryId === null || p.commandId === null && erasureIdentifier(p.recoveryId) && p.recoveryId.length >= 16) ||
      typeof p.anonymousAllowed !== 'boolean' || typeof p.anonymousBlocked !== 'boolean') throw failure();
  return p as unknown as Pointer;
}
async function readStored(ownerId: string, check: () => void): Promise<StoredAttempt | null> {
  const key = await slot(ownerId); check(); const raw = await get(key, check);
  if (raw === null) return null;
  if (raw.length > 2000) throw failure();
  let parsed: unknown; try {parsed = JSON.parse(raw);} catch {throw failure();}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw failure();
  const value = parsed as Record<string, unknown>, {observationKey, ...publicPart} = value;
  if (!erasureDigest(observationKey) || !isAccountErasureAttempt(publicPart, ownerId) ||
      publicPart.commandId !== await hash([ACCOUNT_ERASURE_PROTOCOL, ownerId, publicPart.requestId])) throw failure();
  check(); return value as unknown as StoredAttempt;
}
async function pointTo(value: StoredAttempt, check: () => void) {
  await put(pointerKey, {version: 1, ownerId: value.ownerId, commandId: value.commandId,
    recoveryId: null, anonymousAllowed: value.phase === 'submitted', anonymousBlocked: false} satisfies Pointer, check);
  await setGuestBlocked(false, check);
}
async function pointToRecovery(value: StoredRecovery, check: () => void) {
  await put(pointerKey, {version: 1, ownerId: value.ownerId, commandId: null, recoveryId: value.recoveryId,
    anonymousAllowed: value.phase === 'submitted', anonymousBlocked: false} satisfies Pointer, check);
  await setGuestBlocked(false, check);
}
async function readRecovery(ownerId: string, check: () => void): Promise<StoredRecovery | null> {
  const key = await recoverySlot(ownerId); check(); const raw = await get(key, check);
  if (raw === null) return null;
  let parsed: unknown; try {parsed = JSON.parse(raw);} catch {throw failure();}
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || raw.length > 1000) throw failure();
  const value = parsed as Record<string, unknown>, {observationKey, ...publicPart} = value;
  if (!erasureDigest(observationKey) || !isAccountErasureRecoveryAttempt(publicPart, ownerId)) throw failure();
  return value as unknown as StoredRecovery;
}
function expired(value: StoredAttempt): boolean {
  return value.receipt?.deletionComplete === true && !!value.receipt.observationExpiresAt &&
    Date.parse(value.receipt.observationExpiresAt) <= Date.now();
}
async function purgeExpired(value: StoredAttempt, check: () => void): Promise<void> {
  await remove(await slot(value.ownerId), check);
  const recovery = await readRecovery(value.ownerId, check);
  if (recovery?.observationKey === value.observationKey) await remove(await recoverySlot(value.ownerId), check);
  const pointer = parsePointer(await get(pointerKey, check));
  if (pointer?.ownerId === value.ownerId && pointer.commandId === value.commandId) await remove(pointerKey, check);
  changed();
}
async function sameRecovery(attempt: AccountErasureRecoveryAttempt, check: () => void): Promise<StoredRecovery> {
  if (!isAccountErasureRecoveryAttempt(attempt)) throw failure();
  const found = await readRecovery(attempt.ownerId, check);
  if (!found || stable(recoveryReference(found)) !== stable(attempt)) throw failure();
  return found;
}
async function sameStored(attempt: AccountErasureAttempt, check: () => void, exactReceipt = false): Promise<StoredAttempt> {
  if (!isAccountErasureAttempt(attempt)) throw failure();
  const found = await readStored(attempt.ownerId, check);
  if (!found || identity(found) !== identity(attempt) || exactReceipt && stable(reference(found)) !== stable(attempt)) throw failure();
  return found;
}
async function access(attempt: AccountErasureAttempt, expected: Session, check: () => void): Promise<void> {
  if (expected.uid === attempt.ownerId) return;
  if (expected.uid !== null || recoveryPoisoned || await guestBlocked(check)) throw failure();
  const pointer = parsePointer(await get(pointerKey, check));
  if (!pointer || !pointer.anonymousAllowed || pointer.anonymousBlocked ||
      pointer.ownerId !== attempt.ownerId || pointer.commandId !== attempt.commandId || attempt.phase !== 'submitted') throw failure();
}
/** Called synchronously from the existing Zustand identity source. No extra
 * Firebase listener or hydration is installed. Foreign identities enqueue a
 * durable close BEFORE a later anonymous discovery can read the capability. */
function noteIdentity(uid: string | null): Promise<void> {
  if (!uid) return Promise.resolve();
  return serial(async () => {
    let durableFallback = false;
    try {await setGuestBlocked(true, () => undefined); durableFallback = true;} catch {recoveryPoisoned = true;}
    const pointer = parsePointer(await SecureStore.getItemAsync(pointerKey, options));
    if (pointer && pointer.ownerId !== uid && !pointer.anonymousBlocked) {
      await put(pointerKey, {...pointer, anonymousBlocked: true}, () => undefined); changed();
    }
    // Same known owner / no prior pointer is not a foreign adoption. A closed
    // pointer stays closed until the owner explicitly discovers its journal.
    if (durableFallback && (!pointer || pointer.ownerId === uid && !pointer.anonymousBlocked)) {
      await setGuestBlocked(false, () => undefined);
    }
  }).catch(() => {recoveryPoisoned = true; changed();});
}

export const AccountErasureJournal = {
  subscribe(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};},
  getRevision: () => revision,
  attachIdentityWatcher() {
    void noteIdentity(auth.currentUser?.uid ?? useAuthStore.getState().authenticatedUid);
    return useAuthStore.subscribe(state => state.authenticatedUid, uid => {void noteIdentity(uid);});
  },
  /** Only a fully hydrated coherent session can discover an owner record or
   * the signed-out device's explicitly submitted recovery pointer. */
  async discover(assertView: () => void): Promise<AccountErasureLocalAttempt | null> {
    const expected = session(), check = guarded(expected, assertView);
    return serial(async () => {
      await available(check);
      if (expected.uid) {
        const pointer = parsePointer(await get(pointerKey, check));
        if (pointer && pointer.ownerId !== expected.uid && !pointer.anonymousBlocked) {
          await put(pointerKey, {...pointer, anonymousBlocked: true}, check);
        }
        if (pointer?.ownerId === expected.uid && pointer.recoveryId) {
          const recovery = await readRecovery(expected.uid, check);
          if (!recovery || recovery.recoveryId !== pointer.recoveryId) throw failure();
          await pointToRecovery(recovery, check); recoveryPoisoned = false; return recoveryReference(recovery);
        }
        const own = await readStored(expected.uid, check);
        if (!own) return null;
        if (expired(own)) {await purgeExpired(own, check); return null;}
        await pointTo(own, check); recoveryPoisoned = false; return reference(own);
      }
      if (recoveryPoisoned) throw failure();
      if (await guestBlocked(check)) return null;
      const pointer = parsePointer(await get(pointerKey, check));
      if (!pointer || !pointer.anonymousAllowed || pointer.anonymousBlocked) return null;
      if (pointer.recoveryId) {
        const recovery = await readRecovery(pointer.ownerId, check);
        if (!recovery || recovery.phase !== 'submitted' || recovery.recoveryId !== pointer.recoveryId) throw failure();
        return recoveryReference(recovery);
      }
      const found = await readStored(pointer.ownerId, check);
      if (!found || found.phase !== 'submitted' || found.commandId !== pointer.commandId) throw failure();
      if (expired(found)) {await purgeExpired(found, check); return null;}
      return reference(found);
    });
  },
  async prepare(ownerId: string, assertView: () => void): Promise<AccountErasureAttempt> {
    const expected = session(), check = guarded(expected, assertView);
    if (!erasureIdentifier(ownerId) || expected.uid !== ownerId) throw failure();
    return serial(async () => {
      await available(check);
      const prior = await readStored(ownerId, check);
      if (prior) {await pointTo(prior, check); recoveryPoisoned = false; return reference(prior);}
      const requestBytes = await Crypto.getRandomBytesAsync(16); check();
      const keyBytes = await Crypto.getRandomBytesAsync(32); check();
      const hex = (bytes: Uint8Array) => Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const requestId = hex(requestBytes), commandId = await hash([ACCOUNT_ERASURE_PROTOCOL, ownerId, requestId]); check();
      const created: StoredAttempt = {protocol: ACCOUNT_ERASURE_PROTOCOL, ownerId, requestId, commandId,
        observationKey: hex(keyBytes), preparedAt: Date.now(), phase: 'prepared', receipt: null};
      const key = await slot(ownerId); check(); await put(key, created, check); await pointTo(created, check);
      recoveryPoisoned = false; changed(); return reference(created);
    });
  },
  /** Before the first HTTP effect: one unchanged identity and observation
   * key are durably reread; an uncertain attempt never gets a fresh ID. */
  async beginSubmission(attempt: AccountErasureAttempt, assertView: () => void): Promise<AccountErasureAttempt> {
    const expected = session(), check = guarded(expected, assertView);
    if (expected.uid !== attempt.ownerId) throw failure();
    return serial(async () => {
      await available(check); const saved = await sameStored(attempt, check, true);
      const next: StoredAttempt = {...saved, phase: 'submitted'};
      const key = await slot(next.ownerId); check(); await put(key, next, check); await pointTo(next, check);
      changed(); return reference(next);
    });
  },
  async payload(attempt: AccountErasureAttempt, operation: AccountErasurePayload['operation'], assertView: () => void): Promise<AccountErasurePayload> {
    const expected = session(), check = guarded(expected, assertView);
    return serial(async () => {
      await available(check); await access(attempt, expected, check);
      if (operation !== 'observe' && expected.uid !== attempt.ownerId) throw failure();
      const saved = await sameStored(attempt, check, operation !== 'observe');
      if (saved.phase !== 'submitted' || expired(saved)) throw failure();
      return {capability: ACCOUNT_ERASURE_PROTOCOL, mode: 'delete', operation, requestId: saved.requestId,
        commandId: saved.commandId, observationKey: saved.observationKey};
    });
  },
  async record(attempt: AccountErasureAttempt, receipt: AccountErasureReceipt, assertView: () => void): Promise<AccountErasureAttempt> {
    const expected = session(), check = guarded(expected, assertView);
    return serial(async () => {
      await available(check); await access(attempt, expected, check);
      if (!isAccountErasureReceipt(receipt, attempt)) throw failure();
      const saved = await sameStored(attempt, check);
      if (saved.receipt && (receipt.version < saved.receipt.version ||
          receipt.version === saved.receipt.version && stable(receipt) !== stable(saved.receipt) ||
          saved.receipt.deletionComplete && !receipt.deletionComplete)) throw failure();
      if (saved.receipt && stable(receipt) === stable(saved.receipt)) return reference(saved);
      const next: StoredAttempt = {...saved, phase: 'submitted', receipt};
      const key = await slot(next.ownerId); check(); await put(key, next, check); return reference(next);
    });
  },
  async prepareRecovery(ownerId: string, assertView: () => void): Promise<AccountErasureRecoveryAttempt> {
    const expected = session(), check = guarded(expected, assertView);
    if (expected.uid !== ownerId || !erasureIdentifier(ownerId)) throw failure();
    return serial(async () => {
      await available(check);
      const old = await readRecovery(ownerId, check);
      const pointer = parsePointer(await get(pointerKey, check));
      if (old && pointer?.ownerId === ownerId && pointer.recoveryId === old.recoveryId) {
        await pointToRecovery(old, check); changed(); return recoveryReference(old);
      }
      const bytes = await Crypto.getRandomBytesAsync(16); check(); const keyBytes = await Crypto.getRandomBytesAsync(32); check();
      const hex = (data: Uint8Array) => Array.from(data).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const created: StoredRecovery = {protocol: ACCOUNT_ERASURE_PROTOCOL, ownerId, recoveryId: hex(bytes),
        observationKey: hex(keyBytes), preparedAt: Date.now(), phase: 'prepared'};
      const key = await recoverySlot(ownerId); check(); await put(key, created, check); await pointToRecovery(created, check);
      recoveryPoisoned = false; changed(); return recoveryReference(created);
    });
  },
  async beginRecovery(attempt: AccountErasureRecoveryAttempt, assertView: () => void): Promise<AccountErasureRecoveryAttempt> {
    const expected = session(), check = guarded(expected, assertView);
    if (expected.uid !== attempt.ownerId) throw failure();
    return serial(async () => {
      await available(check); const old = await sameRecovery(attempt, check), next: StoredRecovery = {...old, phase: 'submitted'};
      const key = await recoverySlot(next.ownerId); check(); await put(key, next, check); await pointToRecovery(next, check);
      changed(); return recoveryReference(next);
    });
  },
  async recoveryPayload(attempt: AccountErasureRecoveryAttempt, operation: 'recover_owner' | 'observe_recovery', assertView: () => void): Promise<AccountErasureRecoveryPayload> {
    const expected = session(), check = guarded(expected, assertView);
    return serial(async () => {
      await available(check);
      if (expected.uid !== null && expected.uid !== attempt.ownerId || operation === 'recover_owner' && expected.uid !== attempt.ownerId) throw failure();
      if (expected.uid === null) {
        const pointer = parsePointer(await get(pointerKey, check));
        if (recoveryPoisoned || await guestBlocked(check) || !pointer || !pointer.anonymousAllowed || pointer.anonymousBlocked ||
            pointer.ownerId !== attempt.ownerId || pointer.recoveryId !== attempt.recoveryId) throw failure();
      }
      const saved = await sameRecovery(attempt, check); if (saved.phase !== 'submitted') throw failure();
      return {capability: ACCOUNT_ERASURE_PROTOCOL, mode: 'delete', operation, recoveryId: saved.recoveryId, observationKey: saved.observationKey};
    });
  },
  /** A lost recovery response can be observed by recoveryId+key after Auth
   * disappears. Only then are the canonical command identifiers adopted. */
  async bindRecovery(attempt: AccountErasureRecoveryAttempt, receipt: AccountErasureReceipt, assertView: () => void): Promise<AccountErasureAttempt> {
    const expected = session(), check = guarded(expected, assertView);
    return serial(async () => {
      await available(check);
      if (expected.uid !== null && expected.uid !== attempt.ownerId) throw failure();
      if (expected.uid === null) {
        const pointer = parsePointer(await get(pointerKey, check));
        if (recoveryPoisoned || await guestBlocked(check) || !pointer || !pointer.anonymousAllowed || pointer.anonymousBlocked ||
            pointer.ownerId !== attempt.ownerId || pointer.recoveryId !== attempt.recoveryId) throw failure();
      }
      const recovery = await sameRecovery(attempt, check);
      if (recovery.phase !== 'submitted') throw failure();
      if (!isAccountErasureReceipt(receipt) || receipt.commandId !== await hash([ACCOUNT_ERASURE_PROTOCOL, attempt.ownerId, receipt.requestId])) throw failure();
      check(); const prior = await readStored(attempt.ownerId, check);
      if (prior && prior.phase === 'submitted' && prior.commandId !== receipt.commandId && !prior.receipt?.deletionComplete && prior.receipt?.state !== 'not_executed') throw failure();
      if (prior?.commandId === receipt.commandId && prior.receipt &&
          (receipt.version < prior.receipt.version ||
          receipt.version === prior.receipt.version && stable(receipt) !== stable(prior.receipt) ||
          prior.receipt.deletionComplete && !receipt.deletionComplete)) throw failure();
      const next: StoredAttempt = {protocol: ACCOUNT_ERASURE_PROTOCOL, ownerId: attempt.ownerId, requestId: receipt.requestId,
        commandId: receipt.commandId, observationKey: recovery.observationKey, preparedAt: recovery.preparedAt, phase: 'submitted', receipt};
      const key = await slot(next.ownerId); check(); await put(key, next, check); await pointTo(next, check);
      changed(); return reference(next);
    });
  },
};
