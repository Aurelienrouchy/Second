import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync, getRandomBytesAsync, randomUUID } from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebaseConfig';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { getCallableErrorCode } from '@/utils/callableError';
import { ACCOUNT_ACCESS_INTAKE_PROTOCOL } from '@/types/accountAccessIntake';
import type { AccountAccessIntakeCommand, AccountAccessIntakeJournal, AccountAccessIntakeObservation, AccountAccessIntakeReceipt, AccountAccessPublicContext } from '@/types/accountAccessIntake';

type Mode = 'submit' | 'observe' | 'neutralize';
const locks = new Set<string>();
const slot = (context: AccountAccessPublicContext) => `second:public-account-access:v1:${encodeURIComponent(context.guestId)}`;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
const sha = (value: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(value));
const unknown = () => new Error('Le reçu de cette intention reste à vérifier. Conservez la même demande ; aucune nouvelle réception ni récupération du compte n’est confirmée.');
const stale = () => new Error('Le contexte avant connexion a changé. Les renseignements locaux sont masqués et ne sont pas rattachés au compte connecté.');
const INPUT_ERROR = 'Indiquez un courriel de réponse valide et un court récit, en 1 000 caractères maximum.';
export function captureAccountAccessContext(): AccountAccessPublicContext {
  const state = useAuthStore.getState(), guestId = state.guestSession?.guestId;
  if (auth.currentUser || state.authenticatedUid || state.user || state.isLoading || !reference(guestId)) throw stale();
  return {guestId, generation: getAuthSessionGeneration()};
}
export function assertAccountAccessContext(context: AccountAccessPublicContext): void {
  const current = captureAccountAccessContext();
  if (current.guestId !== context.guestId || current.generation !== context.generation) throw stale();
}
function command(raw: unknown): AccountAccessIntakeCommand {
  if (!object(raw) || Object.keys(raw).length !== 2 || !['replyEmail', 'narrative'].every(key => Object.prototype.hasOwnProperty.call(raw, key)) || typeof raw.replyEmail !== 'string' || typeof raw.narrative !== 'string') throw unknown();
  const replyEmail = raw.replyEmail.trim(), narrative = raw.narrative.trim();
  if (!replyEmail || replyEmail.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail) ||
    !narrative || narrative.length > 1000 || [replyEmail, narrative].some(text => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))) {
    throw Object.assign(new Error(INPUT_ERROR), {code: 'client/account-access-input'});
  }
  return {replyEmail, narrative};
}
const payloadHash = (journal: Pick<AccountAccessIntakeJournal, 'requestId' | 'command'>) =>
  sha([ACCOUNT_ACCESS_INTAKE_PROTOCOL, journal.requestId, journal.command.replyEmail, journal.command.narrative]);
async function local(context: AccountAccessPublicContext, assertCurrent: () => void): Promise<AccountAccessIntakeJournal | null> {
  assertCurrent(); const raw = await AsyncStorage.getItem(slot(context)); assertCurrent();
  if (raw === null) return null;
  let value: unknown;
  try {value = JSON.parse(raw);} catch {throw unknown();}
  if (!object(value) || Object.keys(value).length !== 6 ||
    !['schemaVersion', 'guestId', 'requestId', 'recoverySecret', 'command', 'payloadHash'].every(key => Object.prototype.hasOwnProperty.call(value, key)) ||
    value.schemaVersion !== 1 || value.guestId !== context.guestId || !reference(value.requestId) ||
    typeof value.recoverySecret !== 'string' || !/^[a-f0-9]{64}$/.test(value.recoverySecret) || typeof value.payloadHash !== 'string') throw unknown();
  const normalized = command(value.command);
  if (!object(value.command) || normalized.replyEmail !== value.command.replyEmail || normalized.narrative !== value.command.narrative) throw unknown();
  const journal = value as unknown as AccountAccessIntakeJournal;
  const expected = await payloadHash(journal); assertCurrent(); if (expected !== journal.payloadHash) throw unknown();
  return journal;
}
async function rpc(journal: AccountAccessIntakeJournal, mode: Mode, assertCurrent: () => void): Promise<AccountAccessIntakeReceipt> {
  assertCurrent();
  const expectedReference = 'access_' + await sha([ACCOUNT_ACCESS_INTAKE_PROTOCOL, journal.requestId]); assertCurrent();
  const result = await httpsCallable<unknown, unknown>(functions, 'accountAccessIntake')({mode, requestId: journal.requestId,
    recoverySecret: journal.recoverySecret, command: journal.command});
  assertCurrent(); const value = result.data;
  if (!object(value) || value.protocol !== ACCOUNT_ACCESS_INTAKE_PROTOCOL || value.requestId !== journal.requestId ||
    value.reference !== expectedReference || value.payloadHash !== journal.payloadHash ||
    !['unrecorded', 'received', 'neutralized'].includes(String(value.state)) || value.contactVerified !== false || value.identityVerified !== false || value.recoveryGranted !== false ||
    (value.state === 'unrecorded' ? value.recordedAt !== null : typeof value.recordedAt !== 'string' || !Number.isFinite(Date.parse(value.recordedAt)) || new Date(value.recordedAt).toISOString() !== value.recordedAt)) throw unknown();
  return {protocol: ACCOUNT_ACCESS_INTAKE_PROTOCOL, requestId: journal.requestId, reference: expectedReference, payloadHash: journal.payloadHash,
    state: value.state as AccountAccessIntakeReceipt['state'], recordedAt: value.recordedAt as string | null,
    contactVerified: false, identityVerified: false, recoveryGranted: false};
}
function observation(journal: AccountAccessIntakeJournal, receipt: AccountAccessIntakeReceipt): AccountAccessIntakeObservation {
  return {intent: {requestId: journal.requestId, command: journal.command, payloadHash: journal.payloadHash}, receipt, acknowledged: false};
}
async function withContextLock<T>(context: AccountAccessPublicContext, assertFocus: () => void, execute: (assertCurrent: () => void) => Promise<T>): Promise<T> {
  const assertCurrent = () => {assertAccountAccessContext(context); assertFocus();}; assertCurrent();
  const key = slot(context); if (locks.has(key)) throw unknown(); locks.add(key);
  try {return await execute(assertCurrent);} finally {locks.delete(key);}
}
export function accountAccessIntakeError(error: unknown): string {
  if ((error as {code?: unknown} | null)?.code === 'client/account-access-input') return INPUT_ERROR;
  const code = getCallableErrorCode(error);
  return code === 'resource-exhausted' ? 'La réception est temporairement limitée. Conservez votre intention et sa référence ; réessayez plus tard avec la même demande.'
    : code === 'invalid-argument' ? 'Le formulaire doit être corrigé. Une intention déjà conservée n’est pas remplacée ; relisez son reçu avant un autre envoi.'
      : 'Le résultat n’est pas confirmé. Votre intention conservée doit être relue avec sa référence d’origine ; aucune récupération du compte n’est accordée.';
}
export const AccountAccessIntakeService = {
  async read(context: AccountAccessPublicContext, assertFocus: () => void): Promise<AccountAccessIntakeObservation> {
    const assertCurrent = () => {assertAccountAccessContext(context); assertFocus();};
    const journal = await local(context, assertCurrent);
    return journal ? observation(journal, await rpc(journal, 'observe', assertCurrent)) : {intent: null, receipt: null, acknowledged: false};
  },
  async submit(context: AccountAccessPublicContext, raw: AccountAccessIntakeCommand, assertFocus: () => void): Promise<AccountAccessIntakeObservation> {
    // Capture the declared strings before the first await, not later form edits.
    assertAccountAccessContext(context); assertFocus(); const normalized = command(raw);
    return withContextLock(context, assertFocus, async assertCurrent => {
      if (await local(context, assertCurrent)) throw unknown();
      const requestId = randomUUID();
      const bytes = await getRandomBytesAsync(32); assertCurrent(); if (bytes.length !== 32) throw unknown();
      const recoverySecret = Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const hash = await payloadHash({requestId, command: normalized}); assertCurrent();
      const journal: AccountAccessIntakeJournal = {schemaVersion: 1, guestId: context.guestId, requestId, recoverySecret, command: normalized, payloadHash: hash};
      await AsyncStorage.setItem(slot(context), JSON.stringify(journal)); assertCurrent();
      await rpc(journal, 'submit', assertCurrent);
      return observation(journal, await rpc(journal, 'observe', assertCurrent));
    });
  },
  async resume(context: AccountAccessPublicContext, assertFocus: () => void): Promise<AccountAccessIntakeObservation> {
    return withContextLock(context, assertFocus, async assertCurrent => {
      const journal = await local(context, assertCurrent); if (!journal) throw unknown();
      await rpc(journal, 'submit', assertCurrent);
      return observation(journal, await rpc(journal, 'observe', assertCurrent));
    });
  },
  async neutralize(context: AccountAccessPublicContext, assertFocus: () => void): Promise<AccountAccessIntakeObservation> {
    return withContextLock(context, assertFocus, async assertCurrent => {
      const journal = await local(context, assertCurrent); if (!journal) throw unknown();
      await rpc(journal, 'neutralize', assertCurrent);
      return observation(journal, await rpc(journal, 'observe', assertCurrent));
    });
  },
  async acknowledge(context: AccountAccessPublicContext, assertFocus: () => void): Promise<AccountAccessIntakeObservation> {
    return withContextLock(context, assertFocus, async assertCurrent => {
      const journal = await local(context, assertCurrent); if (!journal) throw unknown();
      const receipt = await rpc(journal, 'observe', assertCurrent); if (receipt.state === 'unrecorded') throw unknown();
      const exact = await local(context, assertCurrent); if (JSON.stringify(exact) !== JSON.stringify(journal)) throw unknown();
      await AsyncStorage.removeItem(slot(context)); assertCurrent();
      return {intent: null, receipt, acknowledged: true};
    });
  },
};
