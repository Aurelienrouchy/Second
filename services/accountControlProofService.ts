import {isDeclaredSupportAccountId} from '@/utils/supportAccountIdentity';
import {phase1HttpsCallable as httpsCallable} from '@/services/phase1Callable';
import {CryptoDigestAlgorithm, digestStringAsync} from 'expo-crypto';
import {auth, functions} from '@/config/firebaseConfig';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {ACCOUNT_CONTROL_CAPABILITY, ACCOUNT_CONTROL_STATEMENT, ACCOUNT_CONTROL_STATEMENT_VERSION} from '@/types/accountControlProof';
import type {AccountControlAttempt, AccountControlCommand, AccountControlInvitation, AccountControlJournalState, AccountControlProof, AccountControlReference, AccountControlResponse} from '@/types/accountControlProof';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const accountControlId = isDeclaredSupportAccountId;
const rid = (v: unknown): v is string => accountControlId(v) && v.length >= 16 && v === v.trim();
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const proofId = (v: unknown): v is string => typeof v === 'string' && /^acp_[a-f0-9]{64}$/.test(v);
const code = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const action = (v: unknown) => ['prepare', 'consent_second', 'pause', 'finalize_pause'].includes(String(v));
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
export const accountControlHash = (v: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(canonical(v)));
export const accountControlFailure = () => new Error('Relisez la même référence avec sa connexion d’origine. L’issue reste inconnue ; aucune pause, fusion ou levée de restriction n’est déduite.');
export const isAccountControlReference = (v: unknown): v is AccountControlReference => object(v) && exact(v, ['supportRequestId', 'proofId', 'sourceHash']) && accountControlId(v.supportRequestId) && proofId(v.proofId) && hash(v.sourceHash);
export const isAccountControlInvitation = (v: unknown): v is AccountControlInvitation => object(v) && exact(v, ['supportRequestId', 'proofId', 'invitationCode']) && accountControlId(v.supportRequestId) && proofId(v.proofId) && code(v.invitationCode);
export function isAccountControlCommand(v: unknown): v is AccountControlCommand {
  if (!object(v) || !accountControlId(v.supportRequestId) || v.statementVersion !== ACCOUNT_CONTROL_STATEMENT_VERSION || v.accepted !== true || !action(v.action)) return false;
  const base = ['action', 'supportRequestId', 'statementVersion', 'accepted'];
  if (v.action === 'prepare') return exact(v, [...base, 'expectedCaseVersion', 'declaredOtherUid']) && typeof v.expectedCaseVersion === 'number' && Number.isSafeInteger(v.expectedCaseVersion) && v.expectedCaseVersion >= 1 && accountControlId(v.declaredOtherUid);
  if (!proofId(v.proofId) || !hash(v.sourceHash)) return false;
  return v.action === 'consent_second' ? exact(v, [...base, 'proofId', 'sourceHash', 'invitationCode']) && code(v.invitationCode)
    : v.action === 'finalize_pause' ? exact(v, [...base, 'proofId', 'sourceHash', 'pauseRequestId']) && rid(v.pauseRequestId)
      : exact(v, [...base, 'proofId', 'sourceHash']);
}
export function isAccountControlAttempt(v: unknown, uid: string): v is AccountControlAttempt {
  return object(v) && exact(v, ['uid', 'requestId', 'descriptor']) && v.uid === uid && accountControlId(v.uid) && rid(v.requestId) && object(v.descriptor) &&
    exact(v.descriptor, ['supportRequestId', 'action', 'inputHash']) && accountControlId(v.descriptor.supportRequestId) && action(v.descriptor.action) && hash(v.descriptor.inputHash);
}
export function isAccountControlJournalState(v: unknown, uid: string): v is AccountControlJournalState {
  return object(v) && exact(v, ['version', 'uid', 'reference', 'pending']) && v.version === 1 && v.uid === uid && accountControlId(uid) &&
    (v.reference === null || isAccountControlReference(v.reference)) && (v.pending === null || isAccountControlAttempt(v.pending, uid));
}
function proof(v: unknown, uid: string): v is AccountControlProof {
  if (!object(v) || !exact(v, ['proofId', 'supportRequestId', 'sourceHash', 'keepUid', 'pauseUid', 'stage', 'statementVersion', 'statement', 'invitationCode', 'expiresAt', 'pauseRequestId', 'pauseSourceQualification',
    'controlOfBothFirebaseSessionsObserved', 'pauseObserved', 'inAppNoticeRecorded', 'samePhysicalIdentityVerified', 'fraudEstablished', 'accountsMerged', 'fundsMoved', 'otherAccountDataAccessGranted', 'restrictionsLifted']) ||
    !proofId(v.proofId) || !accountControlId(v.supportRequestId) || !hash(v.sourceHash) || !accountControlId(v.keepUid) || !accountControlId(v.pauseUid) || v.keepUid === v.pauseUid || uid !== v.keepUid && uid !== v.pauseUid ||
    !['awaiting_second_consent', 'both_consented', 'paused', 'finalized', 'source_changed', 'historical_unknown'].includes(String(v.stage)) ||
    v.statementVersion !== ACCOUNT_CONTROL_STATEMENT_VERSION || v.statement !== ACCOUNT_CONTROL_STATEMENT || !iso(v.expiresAt) ||
    !(v.invitationCode === null || code(v.invitationCode) && uid === v.keepUid && v.stage === 'awaiting_second_consent') || !(v.pauseRequestId === null || rid(v.pauseRequestId)) ||
    !['created_pause', 'observed_existing_pause', 'unknown', 'not_recorded'].includes(String(v.pauseSourceQualification)) ||
    ![v.controlOfBothFirebaseSessionsObserved, v.pauseObserved, v.inAppNoticeRecorded].every(x => typeof x === 'boolean') ||
    !['samePhysicalIdentityVerified', 'fraudEstablished', 'accountsMerged', 'fundsMoved', 'otherAccountDataAccessGranted', 'restrictionsLifted'].every(k => v[k] === false)) return false;
  if (v.pauseObserved === true && (v.controlOfBothFirebaseSessionsObserved !== true || !rid(v.pauseRequestId) || !['created_pause', 'observed_existing_pause'].includes(String(v.pauseSourceQualification)))) return false;
  if (['paused', 'finalized'].includes(String(v.stage)) && v.pauseObserved !== true) return false;
  if (v.stage === 'awaiting_second_consent' && (v.controlOfBothFirebaseSessionsObserved !== false || v.pauseObserved !== false)) return false;
  return v.stage !== 'both_consented' || v.controlOfBothFirebaseSessionsObserved === true;
}
export async function parseAccountControlResponse(v: unknown, uid: string, attempt?: AccountControlAttempt, reference?: AccountControlReference | AccountControlInvitation): Promise<AccountControlResponse> {
  if (!object(v) || !exact(v, ['protocol', 'actorUid', 'requestId', 'inputHash', 'state', 'replayed', 'receipt', 'proof']) || v.protocol !== ACCOUNT_CONTROL_CAPABILITY || v.actorUid !== uid ||
    !['completed', 'not_executed', 'unrecorded', 'available', 'unavailable'].includes(String(v.state)) || typeof v.replayed !== 'boolean' || !(v.proof === null || proof(v.proof, uid))) throw accountControlFailure();
  if (reference && v.proof !== null && object(v.proof) && (v.proof.supportRequestId !== reference.supportRequestId || v.proof.proofId !== reference.proofId || 'sourceHash' in reference && v.proof.sourceHash !== reference.sourceHash)) throw accountControlFailure();
  if (!attempt) {
    if (v.requestId !== null || v.inputHash !== null || v.receipt !== null || !['available', 'unavailable'].includes(String(v.state)) || (v.state === 'available') !== (v.proof !== null)) throw accountControlFailure();
  } else {
    if (!isAccountControlAttempt(attempt, uid) || v.requestId !== attempt.requestId || v.inputHash !== attempt.descriptor.inputHash || !['completed', 'not_executed', 'unrecorded'].includes(String(v.state)) ||
      v.proof !== null && object(v.proof) && v.proof.supportRequestId !== attempt.descriptor.supportRequestId) throw accountControlFailure();
    if (v.state === 'unrecorded') {if (v.receipt !== null || v.proof !== null) throw accountControlFailure();}
    else {
      if (attempt.descriptor.action === 'prepare' && object(v.proof) && (v.proof.keepUid !== uid || v.proof.proofId !== `acp_${await accountControlHash([attempt.descriptor.supportRequestId, uid, attempt.requestId])}`)) throw accountControlFailure();
      const r = v.receipt, expected = `acc_${await accountControlHash([uid, attempt.requestId])}`;
      if (!object(r) || !exact(r, ['id', 'requestId', 'inputHash', 'action', 'state', 'recordedAt', 'receiptHash']) || r.id !== expected || r.requestId !== attempt.requestId || r.inputHash !== attempt.descriptor.inputHash ||
        r.action !== attempt.descriptor.action || r.state !== v.state || !iso(r.recordedAt) || !hash(r.receiptHash)) throw accountControlFailure();
    }
  }
  return v as unknown as AccountControlResponse; // Closed keys, exact current actor/RID/hash and nullable proof qualified above.
}
const fenced = (uid: string, guard: () => void) => {const session = captureTradeSession(uid); return () => {assertTradeSessionCurrent(session); guard();};};
export const AccountControlProofService = {
  async attempt(uid: string, requestId: string, command: AccountControlCommand, guard: () => void): Promise<AccountControlAttempt> {
    const current = fenced(uid, guard); current(); if (!rid(requestId) || !isAccountControlCommand(command)) throw accountControlFailure();
    const value = {uid, requestId, descriptor: {supportRequestId: command.supportRequestId, action: command.action, inputHash: await accountControlHash([uid, requestId, command])}}; current(); return value;
  },
  async command(attempt: AccountControlAttempt, mode: 'execute' | 'observe' | 'neutralize', guard: () => void, command?: AccountControlCommand) {
    if (!isAccountControlAttempt(attempt, attempt.uid)) throw accountControlFailure(); const current = fenced(attempt.uid, guard); current();
    if (mode === 'execute' && (!isAccountControlCommand(command) || command.supportRequestId !== attempt.descriptor.supportRequestId || command.action !== attempt.descriptor.action || await accountControlHash([attempt.uid, attempt.requestId, command]) !== attempt.descriptor.inputHash)) throw accountControlFailure(); current();
    let data: unknown;
    if (mode === 'execute' && command?.action === 'pause') {
      const owner = auth.currentUser; if (!owner || owner.uid !== attempt.uid) throw accountControlFailure(); await owner.getIdToken(true); current();
      const reply = await httpsCallable<unknown, unknown>(functions, 'deleteUserAccount')({mode: 'pause', expectedUid: attempt.uid, accountControlProof: {capability: ACCOUNT_CONTROL_CAPABILITY, requestId: attempt.requestId, command}}); current();
      if (!object(reply.data) || !['paused', 'incomplete'].includes(String(reply.data.status)) || reply.data.newOperationsBlocked !== true || reply.data.deletionComplete !== false || reply.data.authDeleted === true) throw accountControlFailure();
      data = reply.data.accountControlProof;
    } else {
      const reply = await httpsCallable<unknown, unknown>(functions, mode === 'observe' ? 'readSupportRequests' : 'commandSupportRequest')({capability: ACCOUNT_CONTROL_CAPABILITY, expectedUid: attempt.uid, mode,
        requestId: attempt.requestId, ...(mode === 'execute' ? {command} : {descriptor: attempt.descriptor})}); current(); data = reply.data;
    }
    const reference = command && command.action !== 'prepare' ? {supportRequestId: command.supportRequestId, proofId: command.proofId, sourceHash: command.sourceHash} : undefined;
    const value = await parseAccountControlResponse(data, attempt.uid, attempt, reference); current();
    if (command?.action === 'prepare' && value.proof && value.proof.pauseUid !== command.declaredOtherUid) throw accountControlFailure();
    return value;
  },
  async read(uid: string, mode: 'invitation' | 'status', reference: AccountControlInvitation | AccountControlReference, guard: () => void) {
    const current = fenced(uid, guard); current(); if (mode === 'invitation' ? !isAccountControlInvitation(reference) : !isAccountControlReference(reference)) throw accountControlFailure();
    const reply = await httpsCallable<unknown, unknown>(functions, 'readSupportRequests')({capability: ACCOUNT_CONTROL_CAPABILITY, expectedUid: uid, mode, ...reference}); current();
    const value = await parseAccountControlResponse(reply.data, uid, undefined, reference); current(); return value;
  },
};

/** An addressed notice selects a native read, never a consent or the other account's ticket. */
export async function accountControlNotificationContext(data: unknown, uid: string, guard: () => void): Promise<{reference: AccountControlReference | null}> {
  if (!object(data) || !accountControlId(data.supportRequestId) || !proofId(data.proofId) || data.ownerId !== undefined && data.ownerId !== uid) throw accountControlFailure();
  const current = fenced(uid, guard); current();
  // Old notices lacked a source/destination witness. They open only this SDK owner's local journal.
  if (data.sourceHash === undefined || data.ownerId === undefined) return {reference: null};
  const reference = {supportRequestId: data.supportRequestId, proofId: data.proofId, sourceHash: data.sourceHash};
  if (!isAccountControlReference(reference)) throw accountControlFailure();
  const response = await AccountControlProofService.read(uid, 'status', reference, current); current();
  if (response.state !== 'available' || !response.proof) throw accountControlFailure(); return {reference};
}
