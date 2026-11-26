import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { ACCOUNT_SECURITY_STATEMENT, ACCOUNT_SECURITY_STATEMENT_VERSION, ACCOUNT_SECURITY_RECOVERY_STATEMENT, ACCOUNT_SECURITY_RECOVERY_VERSION,
  type AccountSecurityIntent, type AccountSecurityJournalEntry, type AccountSecurityObservation, type AccountSecurityReceipt, type AccountSecurityMediaProtection,
  type AccountSecurityRecoveryIntent, type AccountSecurityRecoveryJournalEntry, type AccountSecurityRecoveryObservation,
  type AccountSecurityRecoveryPreview, type AccountSecurityRecoveryReceipt } from '@/types/accountSecurity';
import { isDeclaredSupportAccountId } from '@/utils/supportAccountIdentity';

type Mode = 'execute' | 'observe' | 'neutralize';
const locks = new Set<string>();
const slot = (uid: string) => `second:account-security:v1:${encodeURIComponent(uid)}`;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const reference = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const mediaCount = (value: unknown) => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function mediaProtection(value: unknown): value is AccountSecurityMediaProtection {
  return object(value) && Object.keys(value).length === 13 && Object.keys(value).every(key => ['protocol', 'state', 'cutoffAt',
    'nativeReferencesInspected', 'objectsQueued', 'privatelyPreservedCount', 'observedRevokedCount', 'scanReachedEnd', 'referenceCoverage',
    'globalCoverageVerified', 'historicalCopiesErased', 'newMediaPermissionGranted', 'lastObservedAt'].includes(key)) &&
    value.protocol === 'account_security_media_v1' && typeof value.state === 'string' && ['pending', 'in_progress', 'observed_for_scanned_references', 'review_required', 'unknown', 'not_requested'].includes(value.state) &&
    (value.cutoffAt === null || iso(value.cutoffAt)) && (value.lastObservedAt === null || iso(value.lastObservedAt)) &&
    mediaCount(value.nativeReferencesInspected) && mediaCount(value.objectsQueued) && mediaCount(value.privatelyPreservedCount) && mediaCount(value.observedRevokedCount) &&
    typeof value.scanReachedEnd === 'boolean' && typeof value.referenceCoverage === 'string' && ['native_references_only', 'unknown'].includes(value.referenceCoverage) &&
    value.globalCoverageVerified === false && value.historicalCopiesErased === false && value.newMediaPermissionGranted === false;
}
const unknown = () => new Error('La demande doit être relue avec sa référence et sa confirmation d’origine. Le journal est conservé ; aucune nouvelle demande ni levée du blocage n’est confirmée.');
const digest = (value: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(value));
const inputHash = (intent: Pick<AccountSecurityIntent, 'expectedUid' | 'requestId' | 'statementVersion' | 'accepted'>) =>
  digest([intent.expectedUid, intent.requestId, intent.statementVersion, intent.accepted]);

async function validateIntent(value: unknown, uid: string, assertContext: () => void): Promise<AccountSecurityIntent> {
  if (!object(value) || Object.keys(value).length !== 7 ||
    !['schemaVersion', 'expectedUid', 'requestId', 'statementVersion', 'accepted', 'statement', 'inputHash'].every(key => Object.prototype.hasOwnProperty.call(value, key)) ||
    value.schemaVersion !== 1 || value.expectedUid !== uid || !reference(value.requestId) ||
    value.statementVersion !== ACCOUNT_SECURITY_STATEMENT_VERSION || value.accepted !== true || value.statement !== ACCOUNT_SECURITY_STATEMENT ||
    typeof value.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputHash)) throw unknown();
  const intent = value as unknown as AccountSecurityIntent;
  const expected = await inputHash(intent); assertContext();
  if (expected !== intent.inputHash) throw unknown();
  return intent;
}
async function local(uid: string, assertContext: () => void): Promise<AccountSecurityJournalEntry | null> {
  const session = captureTradeSession(uid); assertContext();
  const raw = await AsyncStorage.getItem(slot(uid)); assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return null;
  let value: unknown;
  try {value = JSON.parse(raw);} catch {throw unknown();}
  if (!object(value) || Object.keys(value).length !== 2 || !Object.prototype.hasOwnProperty.call(value, 'intent') || typeof value.acknowledged !== 'boolean') throw unknown();
  const intent = await validateIntent(value.intent, uid, () => {assertTradeSessionCurrent(session); assertContext();});
  return {intent, acknowledged: value.acknowledged};
}
async function newIntent(uid: string, prefix: 'security_' | 'view_', assertContext: () => void): Promise<AccountSecurityIntent> {
  const session = captureTradeSession(uid); assertContext();
  const tuple = {expectedUid: uid, requestId: prefix + randomUUID(), statementVersion: ACCOUNT_SECURITY_STATEMENT_VERSION, accepted: true as const};
  const hash = await inputHash(tuple); assertTradeSessionCurrent(session); assertContext();
  return {schemaVersion: 1, ...tuple, statement: ACCOUNT_SECURITY_STATEMENT, inputHash: hash};
}
async function rpc(intent: AccountSecurityIntent, mode: Mode, assertContext: () => void): Promise<AccountSecurityReceipt> {
  const session = captureTradeSession(intent.expectedUid); assertContext();
  await validateIntent(intent, session.uid, () => {assertTradeSessionCurrent(session); assertContext();});
  const expectedCommandId = 'security_' + await digest([session.uid, intent.requestId]); assertTradeSessionCurrent(session); assertContext();
  const result = await httpsCallable<unknown, unknown>(functions, 'secureMyAccount')({expectedUid: session.uid, requestId: intent.requestId,
    mode, statementVersion: intent.statementVersion, accepted: intent.accepted});
  assertTradeSessionCurrent(session); assertContext();
  const value = result.data;
  if (!object(value) || value.protocol !== ACCOUNT_SECURITY_STATEMENT_VERSION || value.ownerId !== session.uid || value.requestId !== intent.requestId ||
    value.commandId !== expectedCommandId || !['unrecorded', 'neutralized', 'revocation_pending', 'revocation_unknown', 'contained'].includes(String(value.state)) ||
    typeof value.newEffectsBlocked !== 'boolean' || value.authRevocationObserved !== (value.state === 'contained') ||
    value.identityRecoveryGranted !== false || value.newOperationsPermissionGranted !== false) throw unknown();
  if (value.state === 'unrecorded' ? value.receivedAt !== null : !iso(value.receivedAt)) throw unknown();
  if (value.state === 'contained' ? !iso(value.authTokensValidAfter) : value.authTokensValidAfter !== null) throw unknown();
  if (['revocation_pending', 'revocation_unknown', 'contained'].includes(String(value.state)) && value.newEffectsBlocked !== true) throw unknown();
  const expectedAction = value.state === 'neutralized' ? value.newEffectsBlocked ? 'contactSupport' : 'acknowledgeNeutralized'
    : value.state === 'contained' ? 'reauthenticateAndContactSupport'
      : value.state === 'unrecorded' ? value.newEffectsBlocked ? 'contactSupport' : 'resumeOrNeutralizeSameRequest' : 'resumeSameRequestOrContactSupport';
  if (value.action !== expectedAction) throw unknown();
  if (Object.hasOwn(value, 'mediaProtection') && !mediaProtection(value.mediaProtection)) throw unknown();
  return {protocol: ACCOUNT_SECURITY_STATEMENT_VERSION, ownerId: session.uid, requestId: intent.requestId, commandId: expectedCommandId,
    state: value.state as AccountSecurityReceipt['state'], newEffectsBlocked: value.newEffectsBlocked,
    authRevocationObserved: value.authRevocationObserved as boolean, authTokensValidAfter: value.authTokensValidAfter as string | null,
    receivedAt: value.receivedAt as string | null, action: expectedAction, identityRecoveryGranted: false, newOperationsPermissionGranted: false,
    ...mediaProtection(value.mediaProtection) ? {mediaProtection: value.mediaProtection} : {}};
}
async function withOwnerLock<T>(uid: string, assertContext: () => void, execute: (assertCurrent: () => void) => Promise<T>): Promise<T> {
  const session = captureTradeSession(uid);
  const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
  assertCurrent();
  if (locks.has(uid)) throw unknown(); locks.add(uid);
  try {return await execute(assertCurrent);} finally {locks.delete(uid);}
}
export const AccountSecurityService = {
  async read(uid: string, assertContext: () => void): Promise<AccountSecurityObservation> {
    const session = captureTradeSession(uid);
    const assertCurrent = () => {assertTradeSessionCurrent(session); assertContext();};
    const journal = await local(uid, assertCurrent);
    // This disposable reference is never written, executed or neutralized.
    // accepted is required by the read protocol, not recorded as consent.
    const intent = journal?.intent ?? await newIntent(uid, 'view_', assertCurrent);
    return {journal, receipt: await rpc(intent, 'observe', assertCurrent), linkedToLocalIntent: journal !== null};
  },
  async submit(uid: string, explicitlyAccepted: boolean, assertContext: () => void): Promise<AccountSecurityObservation> {
    if (explicitlyAccepted !== true) throw new Error('Confirmez explicitement la demande de sécurisation de ce compte.');
    return withOwnerLock(uid, assertContext, async assertCurrent => {
      const previous = await local(uid, assertCurrent);
      if (previous) {
        const receipt = await rpc(previous.intent, 'observe', assertCurrent);
        if (!previous.acknowledged || !['contained', 'neutralized'].includes(receipt.state)) throw unknown();
        const recovery = recoveryPreview(await recoveryRpc(uid, {mode: 'preview'}, assertCurrent), uid);
        if (!recovery.canStartNewContainment) throw unknown();
      }
      const intent = await newIntent(uid, 'security_', assertCurrent);
      const journal: AccountSecurityJournalEntry = {intent, acknowledged: false};
      assertCurrent(); await AsyncStorage.setItem(slot(uid), JSON.stringify(journal)); assertCurrent();
      await rpc(intent, 'execute', assertCurrent);
      return {journal, receipt: await rpc(intent, 'observe', assertCurrent), linkedToLocalIntent: true};
    });
  },
  async resume(uid: string, assertContext: () => void): Promise<AccountSecurityObservation> {
    return withOwnerLock(uid, assertContext, async assertCurrent => {
      const journal = await local(uid, assertCurrent); if (!journal || journal.acknowledged) throw unknown();
      await rpc(journal.intent, 'execute', assertCurrent);
      return {journal, receipt: await rpc(journal.intent, 'observe', assertCurrent), linkedToLocalIntent: true};
    });
  },
  async neutralize(uid: string, assertContext: () => void): Promise<AccountSecurityObservation> {
    return withOwnerLock(uid, assertContext, async assertCurrent => {
      const journal = await local(uid, assertCurrent); if (!journal || journal.acknowledged) throw unknown();
      const current = await rpc(journal.intent, 'observe', assertCurrent); if (current.state !== 'unrecorded') throw unknown();
      await rpc(journal.intent, 'neutralize', assertCurrent);
      return {journal, receipt: await rpc(journal.intent, 'observe', assertCurrent), linkedToLocalIntent: true};
    });
  },
  async acknowledge(uid: string, assertContext: () => void): Promise<AccountSecurityObservation> {
    return withOwnerLock(uid, assertContext, async assertCurrent => {
      const journal = await local(uid, assertCurrent); if (!journal) throw unknown();
      const receipt = await rpc(journal.intent, 'observe', assertCurrent);
      if (!['contained', 'neutralized'].includes(receipt.state)) throw unknown();
      const exact = await local(uid, assertCurrent);
      if (!exact || JSON.stringify(exact.intent) !== JSON.stringify(journal.intent)) throw unknown();
      const acknowledged = {...journal, acknowledged: true};
      assertCurrent(); await AsyncStorage.setItem(slot(uid), JSON.stringify(acknowledged)); assertCurrent();
      return {journal: acknowledged, receipt, linkedToLocalIntent: true};
    });
  },
};

const recoverySlot = (uid: string) => `second:account-security-recovery:v1:${encodeURIComponent(uid)}`;
const recoveryFailure = () => new Error('Relisez la reprise de sécurisation et sa même référence. Le résultat inconnu reste conservé ; aucun rétablissement n’est déduit.');
const recoveryHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const recoveryEpisode = (value: unknown): value is string => typeof value === 'string' && /^security_[a-f0-9]{64}$/.test(value);
const exactRecovery = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const recoveryInputHash = (intent: Pick<AccountSecurityRecoveryIntent, 'expectedUid' | 'requestId' | 'statementVersion' | 'accepted' | 'expectedEpisodeId' | 'expectedSourceHash'>) =>
  digest([intent.expectedUid, intent.requestId, intent.statementVersion, intent.accepted, intent.expectedEpisodeId, intent.expectedSourceHash]);

function recoveryPreview(value: unknown, uid: string): AccountSecurityRecoveryPreview {
  if (!object(value) || !exactRecovery(value, ['protocol', 'ownerId', 'kind', 'episodeId', 'sourceHash', 'canRestore', 'canStartNewContainment', 'reason', 'statementVersion',
    'statement', 'newEffectsBlocked', 'restorationRecorded', 'identityRecoveryGranted', 'otherRestrictionsLifted']) ||
    value.protocol !== ACCOUNT_SECURITY_RECOVERY_VERSION || value.ownerId !== uid || value.kind !== 'preview' ||
    !(value.episodeId === null || recoveryEpisode(value.episodeId)) || !(value.sourceHash === null || recoveryHash(value.sourceHash)) ||
    !['ready', 'no_episode', 'baseline_unknown', 'revocation_unknown', 'reauthentication_required', 'linked_method_required', 'source_unqualified', 'already_restored'].includes(String(value.reason)) ||
    value.statementVersion !== ACCOUNT_SECURITY_RECOVERY_VERSION || value.statement !== ACCOUNT_SECURITY_RECOVERY_STATEMENT ||
    typeof value.canStartNewContainment !== 'boolean' ||
    value.reason === 'no_episode' && value.canStartNewContainment !== true ||
    !['no_episode', 'already_restored', 'ready'].includes(String(value.reason)) && value.canStartNewContainment !== false ||
    value.canRestore !== (value.reason === 'ready') || value.newEffectsBlocked !== !['no_episode', 'already_restored'].includes(String(value.reason)) ||
    value.restorationRecorded !== (value.reason === 'already_restored') || value.identityRecoveryGranted !== false || value.otherRestrictionsLifted !== false ||
    value.reason === 'ready' && (!recoveryEpisode(value.episodeId) || !recoveryHash(value.sourceHash))) throw recoveryFailure();
  return value as unknown as AccountSecurityRecoveryPreview;
}
async function recoveryIntent(value: unknown, uid: string, current: () => void): Promise<AccountSecurityRecoveryIntent> {
  if (!object(value) || !exactRecovery(value, ['schemaVersion', 'expectedUid', 'requestId', 'expectedEpisodeId', 'expectedSourceHash', 'statementVersion', 'accepted', 'inputHash']) ||
    value.schemaVersion !== 1 || value.expectedUid !== uid || !isDeclaredSupportAccountId(uid) || !reference(value.requestId) ||
    !recoveryEpisode(value.expectedEpisodeId) || !recoveryHash(value.expectedSourceHash) || value.statementVersion !== ACCOUNT_SECURITY_RECOVERY_VERSION ||
    value.accepted !== true || !recoveryHash(value.inputHash)) throw recoveryFailure();
  const intent = value as unknown as AccountSecurityRecoveryIntent;
  const expected = await recoveryInputHash(intent); current();
  if (expected !== intent.inputHash) throw recoveryFailure();
  return intent;
}
async function recoveryLocal(uid: string, current: () => void): Promise<AccountSecurityRecoveryJournalEntry | null> {
  current(); const raw = await AsyncStorage.getItem(recoverySlot(uid)); current();
  if (raw === null) return null;
  let value: unknown;
  try {value = JSON.parse(raw);} catch {throw recoveryFailure();}
  if (!object(value) || !exactRecovery(value, ['intent', 'acknowledged']) || typeof value.acknowledged !== 'boolean') throw recoveryFailure();
  return {intent: await recoveryIntent(value.intent, uid, current), acknowledged: value.acknowledged};
}
async function recoverySame(entry: AccountSecurityRecoveryJournalEntry, current: () => void) {
  const saved = await recoveryLocal(entry.intent.expectedUid, current);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(entry)) throw recoveryFailure();
}
async function recoveryRpc(uid: string, input: Record<string, unknown>, current: () => void): Promise<unknown> {
  current(); const owner = auth.currentUser;
  if (!owner || owner.uid !== uid) throw recoveryFailure();
  await owner.getIdTokenResult(true); current();
  if (auth.currentUser !== owner) throw recoveryFailure();
  const result = await httpsCallable<unknown, unknown>(functions, 'secureMyAccount')({action: 'recovery', expectedUid: uid, ...input});
  current(); return result.data;
}
async function recoveryObserveOrCommand(intent: AccountSecurityRecoveryIntent, mode: Mode, current: () => void): Promise<AccountSecurityRecoveryReceipt> {
  await recoveryIntent(intent, intent.expectedUid, current);
  const commandId = 'recovery_' + await digest([intent.expectedUid, intent.requestId]); current();
  const value = await recoveryRpc(intent.expectedUid, {mode, requestId: intent.requestId, expectedEpisodeId: intent.expectedEpisodeId,
    expectedSourceHash: intent.expectedSourceHash, statementVersion: intent.statementVersion, accepted: intent.accepted}, current);
  if (!object(value) || !exactRecovery(value, ['protocol', 'kind', 'ownerId', 'requestId', 'commandId', 'episodeId', 'sourceHash', 'inputHash',
    'statementVersion', 'accepted', 'state', 'receivedAt', 'receiptHash', 'restorationRecorded', 'newOperationsPermissionGranted', 'identityRecoveryGranted', 'otherRestrictionsLifted']) ||
    value.protocol !== ACCOUNT_SECURITY_RECOVERY_VERSION || value.kind !== 'receipt' || value.ownerId !== intent.expectedUid || value.requestId !== intent.requestId ||
    value.commandId !== commandId || value.episodeId !== intent.expectedEpisodeId || value.sourceHash !== intent.expectedSourceHash || value.inputHash !== intent.inputHash ||
    value.statementVersion !== intent.statementVersion || value.accepted !== true || !['unrecorded', 'neutralized', 'restored'].includes(String(value.state)) ||
    (value.state === 'unrecorded' ? value.receivedAt !== null || value.receiptHash !== null : !iso(value.receivedAt) || !recoveryHash(value.receiptHash)) ||
    value.restorationRecorded !== (value.state === 'restored') || value.newOperationsPermissionGranted !== false || value.identityRecoveryGranted !== false ||
    value.otherRestrictionsLifted !== false) throw recoveryFailure();
  return value as unknown as AccountSecurityRecoveryReceipt;
}
async function recoveryRead(uid: string, current: () => void): Promise<AccountSecurityRecoveryObservation> {
  const entry = await recoveryLocal(uid, current);
  return {journal: entry, receipt: entry ? await recoveryObserveOrCommand(entry.intent, 'observe', current) : null};
}
async function recoveryExisting(uid: string, action: 'resume' | 'neutralize' | 'acknowledge', guard: () => void): Promise<AccountSecurityRecoveryObservation> {
  return withOwnerLock(uid, guard, async current => {
    const entry = await recoveryLocal(uid, current); if (!entry) throw recoveryFailure();
    let receipt = await recoveryObserveOrCommand(entry.intent, 'observe', current);
    if (action === 'acknowledge') {
      if (receipt.state === 'unrecorded' || receipt.receiptHash === null || receipt.receivedAt === null) throw recoveryFailure();
      await recoverySame(entry, current);
      const acknowledged = {...entry, acknowledged: true};
      await AsyncStorage.setItem(recoverySlot(uid), JSON.stringify(acknowledged)); current();
      return {journal: acknowledged, receipt};
    }
    if (receipt.state === 'unrecorded') {
      if (entry.acknowledged) throw recoveryFailure();
      await recoverySame(entry, current);
      await recoveryObserveOrCommand(entry.intent, action === 'resume' ? 'execute' : 'neutralize', current);
      receipt = await recoveryObserveOrCommand(entry.intent, 'observe', current);
    }
    return {journal: entry, receipt};
  });
}
/** Separate opt-in rail; containment V1 hashes, commands and journal remain unchanged. */
export const AccountSecurityRecoveryService = {
  async preview(uid: string, guard: () => void): Promise<AccountSecurityRecoveryPreview> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();};
    return recoveryPreview(await recoveryRpc(uid, {mode: 'preview'}, current), uid);
  },
  async read(uid: string, guard: () => void): Promise<AccountSecurityRecoveryObservation> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();};
    return recoveryRead(uid, current);
  },
  async submit(uid: string, source: AccountSecurityRecoveryPreview, accepted: boolean, guard: () => void): Promise<AccountSecurityRecoveryObservation> {
    if (accepted !== true || !recoveryPreview(source, uid).canRestore) throw recoveryFailure();
    return withOwnerLock(uid, guard, async current => {
      const previous = await recoveryLocal(uid, current);
      if (previous) {
        const receipt = await recoveryObserveOrCommand(previous.intent, 'observe', current);
        if (!previous.acknowledged || receipt.state === 'unrecorded') throw recoveryFailure();
      }
      const fresh = await recoveryRpc(uid, {mode: 'preview'}, current), preview = recoveryPreview(fresh, uid);
      if (!preview.canRestore || preview.episodeId !== source.episodeId || preview.sourceHash !== source.sourceHash) throw recoveryFailure();
      const tuple = {expectedUid: uid, requestId: 'recovery_' + randomUUID(), expectedEpisodeId: source.episodeId as string,
        expectedSourceHash: source.sourceHash as string, statementVersion: ACCOUNT_SECURITY_RECOVERY_VERSION, accepted: true as const};
      const inputHash = await recoveryInputHash(tuple); current();
      const entry: AccountSecurityRecoveryJournalEntry = {intent: {schemaVersion: 1, ...tuple, inputHash}, acknowledged: false};
      await AsyncStorage.setItem(recoverySlot(uid), JSON.stringify(entry)); current();
      await recoverySame(entry, current);
      await recoveryObserveOrCommand(entry.intent, 'execute', current);
      return {journal: entry, receipt: await recoveryObserveOrCommand(entry.intent, 'observe', current)};
    });
  },
  resume: (uid: string, guard: () => void) => recoveryExisting(uid, 'resume', guard),
  neutralize: (uid: string, guard: () => void) => recoveryExisting(uid, 'neutralize', guard),
  acknowledge: (uid: string, guard: () => void) => recoveryExisting(uid, 'acknowledge', guard),
};
