import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { doc, getDocFromServer } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, firestore, functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import type { PrivacyIncidentAttempt, PrivacyIncidentJournalEntry, PrivacyIncidentReceipt, PrivacyIncidentRecord, PrivacyOwnCommandJournalProof, PrivacyOwnCommandReceipt, PrivacyOwnCommandReference } from '@/types/privacyIncident';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(key => keys.includes(key));
const reference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const bounded = (v: unknown, max: number, empty = false): v is string => typeof v === 'string' && v === v.trim() && v.length <= max && (empty || v.length > 0);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const nullableDate = (v: unknown) => v === null || date(v);
const integers = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const strings = (v: unknown, maxCount: number, maxLength: number): v is string[] => Array.isArray(v) && v.length <= maxCount && v.every(s => bounded(s, maxLength));
const severities = ['low', 'medium', 'high', 'critical'];
const statuses = ['open', 'investigating', 'contained', 'resolved'];
const channels = ['cai_secure_form', 'registered_mail', 'email', 'other'];
const unknown = () => new Error('Le résultat doit être relu avec exactement la même intention. Aucune action n’est confirmée par un délai ou une absence dans la liste.');
const journalKey = (uid: string) => `second:privacy-incident:v1:${encodeURIComponent(uid)}`;
const locks = new Set<string>();
const writes = new Map<string, Promise<void>>();
const digest = (value: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(value));
export const newPrivacyIncidentRequestId = () => randomUUID();
export const validPrivacyExternalDate = (value: string) => date(value) && Date.parse(value) <= Date.now();

function validateAttempt(v: unknown, uid: string): v is PrivacyIncidentAttempt {
  if (!record(v) || v.version !== 1 || !record(v.payload) || !['create', 'cai', 'notice'].includes(String(v.kind))) return false;
  if (Object.keys(v).some(key => !['version', 'kind', 'payload'].includes(key))) return false;
  const p = v.payload;
  if (p.expectedAdminUid !== uid || typeof p.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(p.requestId)) return false;
  const allowed = v.kind === 'create' ? ['expectedAdminUid', 'requestId', 'type', 'severity', 'description', 'affectedUserIds', 'affectedDataFields', 'measures', 'status']
    : v.kind === 'cai' ? ['expectedAdminUid', 'requestId', 'incidentId', 'notifiedAt', 'channel', 'caiReference', 'evidenceReference']
      : ['expectedAdminUid', 'requestId', 'incidentId', 'messageVersion', 'message'];
  if (Object.keys(p).some(key => !allowed.includes(key))) return false;
  if (v.kind === 'create') return bounded(p.type, 100) && bounded(p.description, 10000) && severities.includes(String(p.severity)) &&
    statuses.includes(String(p.status)) && strings(p.affectedUserIds, 1000, 200) && p.affectedUserIds.every(reference) &&
    new Set(p.affectedUserIds).size === p.affectedUserIds.length && strings(p.affectedDataFields, 100, 100) && bounded(p.measures, 4000, true);
  if (!reference(p.incidentId)) return false;
  if (v.kind === 'notice') return typeof p.messageVersion === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(p.messageVersion) && bounded(p.message, 4000);
  return date(p.notifiedAt) && channels.includes(String(p.channel)) && bounded(p.caiReference, 500) && bounded(p.evidenceReference, 2000);
}

/** The own journal is guarded by SDK identity, independently of the current profile. */
async function identity(uid: string, assertContext: () => void): Promise<() => void> {
  const session = captureTradeSession(uid), current = auth.currentUser;
  const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); if (auth.currentUser !== current) throw unknown(); };
  assertCurrent();
  if (!current) throw unknown();
  await current.getIdTokenResult(true); assertCurrent();
  return assertCurrent;
}

/** The native veto applies even when the refreshed token still has an admin claim. */
async function admin(uid: string, assertContext: () => void): Promise<() => void> {
  const assertCurrent = await identity(uid, assertContext), current = auth.currentUser;
  if (!current) throw unknown();
  const token = await current.getIdTokenResult(true); assertCurrent();
  const snapshot = await getDocFromServer(doc(firestore, 'users', uid)); assertCurrent();
  const profile = snapshot.data();
  if (profile && Object.prototype.hasOwnProperty.call(profile, 'isAdmin') && profile.isAdmin !== true ||
      profile && Object.prototype.hasOwnProperty.call(profile, 'isActive') && profile.isActive !== true ||
      token.claims.admin !== true && profile?.isAdmin !== true) throw new Error('Accès administrateur actuel requis.');
  return assertCurrent;
}

function parseIncident(value: unknown): PrivacyIncidentRecord {
  if (!record(value) || !reference(value.id) || !(value.type === null || bounded(value.type, 100)) ||
      !(value.severity === null || severities.includes(String(value.severity))) ||
      !(value.description === null || bounded(value.description, 10000)) || !strings(value.affectedUserIds, 1000, 200) ||
      !value.affectedUserIds.every(reference) || !strings(value.affectedDataFields, 100, 200) || !bounded(value.measures, 10000, true) ||
      !(value.status === null || statuses.includes(String(value.status))) || !nullableDate(value.detectedAt) ||
      typeof value.notifiedCAI !== 'boolean' || !['external_action_documented', 'historical_unqualified', 'not_recorded'].includes(String(value.caiNotificationState)) ||
      !['in_app_committed', 'pending_or_unqualified', 'historical_unqualified', 'not_recorded'].includes(String(value.userNotificationState)) ||
      !nullableDate(value.notifiedUsersAt) || !nullableDate(value.legacyNotifiedUsersAt) || value.deviceDeliveryVerified !== false || value.readingVerified !== false ||
      !record(value.legacyCAIDeclaration) || typeof value.legacyCAIDeclaration.notifiedCAI !== 'boolean' ||
      !nullableDate(value.legacyCAIDeclaration.notifiedCAIAt) || !(value.legacyCAIDeclaration.caiReference === null || bounded(value.legacyCAIDeclaration.caiReference, 500))) throw unknown();
  if (value.caiNotificationState === 'external_action_documented') {
    const r = value.caiNotificationReceipt;
    if (!value.notifiedCAI || !record(r) || r.protocol !== 'privacy_cai_external_v1' || !hash(r.receiptId) || !reference(r.actorUid) ||
        !date(r.notifiedAt) || !date(r.recordedAt) || Date.parse(r.notifiedAt) > Date.parse(r.recordedAt) ||
        !channels.includes(String(r.channel)) || !bounded(r.caiReference, 500) || !bounded(r.evidenceReference, 2000) ||
        r.externalActionDeclared !== true || r.sentByApplication !== false) throw unknown();
  } else if (value.notifiedCAI !== false || value.caiNotificationReceipt !== null) throw unknown();
  if (value.userNotificationState === 'in_app_committed' ? !date(value.notifiedUsersAt) : value.notifiedUsersAt !== null) throw unknown();
  return value as unknown as PrivacyIncidentRecord;
}

async function parseReceipt(v: unknown, a: PrivacyIncidentAttempt, assertContext: () => void): Promise<PrivacyIncidentReceipt> {
  const p = a.payload;
  if (!record(v) || v.ok !== true || v.actorUid !== p.expectedAdminUid || v.requestId !== p.requestId || !reference(v.incidentId) ||
      !(hash(v.payloadHash) || a.kind === 'notice' && v.opaque === true && v.payloadHash === null)) throw unknown();
  if (v.opaque === true) {
    const common = ['protocol', 'ok', 'incidentId', 'requestId', 'actorUid', 'payloadHash', 'opaque', 'requestCommitted', 'replay'];
    if (v.requestCommitted !== true || v.replay !== true || a.kind === 'create') throw unknown();
    if (a.kind === 'cai') {
      const c = a.payload;
      const receiptId = await digest([c.incidentId, c.expectedAdminUid, c.requestId]); assertContext();
      const payloadHash = await digest([c.incidentId, c.expectedAdminUid, c.requestId, c.notifiedAt, c.channel, c.caiReference, c.evidenceReference]); assertContext();
      if (!exact(v, [...common, 'receiptId', 'recordedAt', 'externalActionDeclared', 'sentByApplication']) ||
          v.protocol !== 'privacy_cai_external_v1' || v.incidentId !== c.incidentId || v.receiptId !== receiptId || v.payloadHash !== payloadHash ||
          !date(v.recordedAt) || v.externalActionDeclared !== true || v.sentByApplication !== false) throw unknown();
    } else {
      const n = a.payload, campaignId = await digest(n.messageVersion); assertContext();
      const requestPayloadHash = await digest([n.incidentId, n.expectedAdminUid, n.requestId, n.messageVersion, n.message]); assertContext();
      if (!exact(v, [...common, 'campaignId', 'requestPayloadHash']) || v.protocol !== 'privacy_user_notices_v1' ||
          v.incidentId !== n.incidentId || v.campaignId !== campaignId || v.requestPayloadHash !== requestPayloadHash) throw unknown();
    }
    return v as unknown as PrivacyIncidentReceipt;
  }
  if ('opaque' in v && v.opaque !== false) throw unknown();
  if (a.kind === 'create') {
    const id = `pi_${await digest([p.expectedAdminUid, p.requestId])}`; assertContext();
    const c = a.payload;
    const canonical = { type: c.type, severity: c.severity, description: c.description,
      affectedUserIds: [...new Set(c.affectedUserIds)].sort(), affectedDataFields: [...new Set(c.affectedDataFields)].sort(),
      measures: c.measures, status: c.status };
    const payloadHash = await digest([c.expectedAdminUid, c.requestId, canonical]); assertContext();
    if (v.protocol !== 'privacy_incident_creation_v1' || v.incidentId !== id || v.payloadHash !== payloadHash ||
        !date(v.createdAt) || typeof v.replay !== 'boolean') throw unknown();
  } else if (a.kind === 'cai') {
    const c = a.payload;
    const receiptId = await digest([c.incidentId, c.expectedAdminUid, c.requestId]); assertContext();
    const payloadHash = await digest([c.incidentId, c.expectedAdminUid, c.requestId, c.notifiedAt, c.channel, c.caiReference, c.evidenceReference]); assertContext();
    if (v.protocol !== 'privacy_cai_external_v1' || v.incidentId !== c.incidentId || v.receiptId !== receiptId || v.payloadHash !== payloadHash ||
        v.notifiedAt !== c.notifiedAt || v.channel !== c.channel || v.caiReference !== c.caiReference || v.evidenceReference !== c.evidenceReference ||
        !date(v.recordedAt) || Date.parse(c.notifiedAt) > Date.parse(v.recordedAt) || typeof v.replay !== 'boolean' ||
        v.externalActionDeclared !== true || v.sentByApplication !== false) throw unknown();
  } else {
    const n = a.payload, campaignId = await digest(n.messageVersion); assertContext();
    const requestPayloadHash = await digest([n.incidentId, n.expectedAdminUid, n.requestId, n.messageVersion, n.message]); assertContext();
    if (v.protocol !== 'privacy_user_notices_v1' || v.incidentId !== n.incidentId || v.campaignId !== campaignId || v.messageVersion !== n.messageVersion ||
        v.requestPayloadHash !== requestPayloadHash ||
        !integers(v.total) || v.total < 1 || v.total > 1000 || !integers(v.inAppCommittedCount) || !integers(v.pendingCount) ||
        v.inAppCommittedCount + v.pendingCount !== v.total || !integers(v.failedThisAttempt) || v.failedThisAttempt > 50 ||
        v.complete !== (v.pendingCount === 0) || v.inAppCommitted !== v.complete || v.resumable !== !v.complete ||
        v.transportQueued !== (v.inAppCommittedCount > 0) || v.transportIntentCount !== v.inAppCommittedCount ||
        v.deviceDeliveryVerified !== false || v.readingVerified !== false) throw unknown();
  }
  return v as unknown as PrivacyIncidentReceipt;
}

async function serialize(uid: string, work: () => Promise<void>) {
  const pending = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(work);
  writes.set(uid, pending);
  try { await pending; } finally { if (writes.get(uid) === pending) writes.delete(uid); }
}


const sameReference = (a: PrivacyOwnCommandReference, b: PrivacyOwnCommandReference) =>
  a.kind === b.kind && a.expectedAdminUid === b.expectedAdminUid && a.requestId === b.requestId && a.incidentId === b.incidentId &&
  a.payloadHash === b.payloadHash && (a.kind !== 'notice' || b.kind === 'notice' && a.campaignId === b.campaignId);
const commandName = (kind: PrivacyIncidentAttempt['kind']) => kind === 'create' ? 'reportPrivacyIncident' : kind === 'cai' ? 'escalatePrivacyIncidentToCAI' : 'notifyAffectedUsers';

async function attemptReference(attempt: PrivacyIncidentAttempt, guard: () => void): Promise<PrivacyOwnCommandReference> {
  const p = attempt.payload;
  if (!validateAttempt(attempt, p.expectedAdminUid)) throw unknown();
  let incidentId: string, payloadHash: string;
  if (attempt.kind === 'create') {
    const c = attempt.payload;
    incidentId = `pi_${await digest([p.expectedAdminUid, p.requestId])}`; guard();
    const canonical = { type: c.type, severity: c.severity, description: c.description,
      affectedUserIds: [...new Set(c.affectedUserIds)].sort(), affectedDataFields: [...new Set(c.affectedDataFields)].sort(),
      measures: c.measures, status: c.status };
    payloadHash = await digest([p.expectedAdminUid, p.requestId, canonical]); guard();
  } else if (attempt.kind === 'cai') {
    const c = attempt.payload; incidentId = c.incidentId;
    payloadHash = await digest([c.incidentId, c.expectedAdminUid, c.requestId, c.notifiedAt, c.channel, c.caiReference, c.evidenceReference]); guard();
  } else {
    const n = attempt.payload; incidentId = n.incidentId;
    payloadHash = await digest([n.incidentId, n.expectedAdminUid, n.requestId, n.messageVersion, n.message]); guard();
    const campaignId = await digest(n.messageVersion); guard();
    return { kind: 'notice', expectedAdminUid: p.expectedAdminUid, requestId: p.requestId, incidentId, payloadHash, campaignId };
  }
  return { kind: attempt.kind, expectedAdminUid: p.expectedAdminUid, requestId: p.requestId, incidentId, payloadHash };
}

async function parseReference(v: unknown, uid: string, guard: () => void): Promise<PrivacyOwnCommandReference> {
  if (!record(v) || !['create', 'cai', 'notice'].includes(String(v.kind)) || v.expectedAdminUid !== uid ||
      !exact(v, ['kind', 'expectedAdminUid', 'requestId', 'incidentId', 'payloadHash', ...(v.kind === 'notice' ? ['campaignId'] : [])]) ||
      typeof v.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) || !reference(v.incidentId) || !hash(v.payloadHash) ||
      v.kind === 'notice' && !hash(v.campaignId)) throw unknown();
  if (v.kind === 'create') {
    const expectedId = `pi_${await digest([uid, v.requestId])}`; guard();
    if (v.incidentId !== expectedId) throw unknown();
  }
  return v as unknown as PrivacyOwnCommandReference;
}

function parseProof(v: unknown): PrivacyOwnCommandJournalProof | null {
  if (v === null || v === undefined) return null;
  if (!record(v) || !exact(v, ['state', 'recordedAt', 'reason']) || !['unrecorded', 'committed', 'not_executed'].includes(String(v.state)) ||
      (v.state === 'unrecorded' ? v.recordedAt !== null || v.reason !== null : !date(v.recordedAt) ||
        v.reason !== (v.state === 'not_executed' ? 'command_neutralized' : null))) throw unknown();
  return v as unknown as PrivacyOwnCommandJournalProof;
}

async function parseMinimalReceipt(v: unknown, r: PrivacyOwnCommandReference, guard: () => void): Promise<PrivacyIncidentReceipt> {
  if (!record(v) || v.ok !== true || v.actorUid !== r.expectedAdminUid || v.requestId !== r.requestId || v.incidentId !== r.incidentId) throw unknown();
  const common = ['protocol', 'ok', 'incidentId', 'requestId', 'actorUid', 'payloadHash'];
  if (r.kind === 'create') {
    if (!exact(v, [...common, 'createdAt', 'replay', ...('opaque' in v ? ['opaque'] : [])]) ||
        v.protocol !== 'privacy_incident_creation_v1' || v.payloadHash !== r.payloadHash || !date(v.createdAt) || typeof v.replay !== 'boolean' ||
        'opaque' in v && v.opaque !== false) throw unknown();
  } else {
    if (v.opaque !== true || v.requestCommitted !== true || v.replay !== true) throw unknown();
    const opaque = [...common, 'opaque', 'requestCommitted', 'replay'];
    if (r.kind === 'cai') {
      const receiptId = await digest([r.incidentId, r.expectedAdminUid, r.requestId]); guard();
      if (!exact(v, [...opaque, 'receiptId', 'recordedAt', 'externalActionDeclared', 'sentByApplication']) ||
          v.protocol !== 'privacy_cai_external_v1' || v.receiptId !== receiptId || v.payloadHash !== r.payloadHash || !date(v.recordedAt) ||
          v.externalActionDeclared !== true || v.sentByApplication !== false) throw unknown();
    } else if (!exact(v, [...opaque, 'campaignId', 'requestPayloadHash']) || v.protocol !== 'privacy_user_notices_v1' ||
        v.campaignId !== r.campaignId || v.requestPayloadHash !== r.payloadHash || !(v.payloadHash === null || hash(v.payloadHash))) throw unknown();
  }
  return v as unknown as PrivacyIncidentReceipt;
}

async function parseObservedReceipt(v: unknown, r: PrivacyOwnCommandReference, guard: () => void): Promise<PrivacyOwnCommandReceipt> {
  if (!record(v) || !exact(v, ['protocol', 'actorUid', 'requestId', 'reference', 'state', 'recordedAt', 'reason', 'requestCommitted',
    'opaque', 'privateIncidentAccessGranted', 'notificationCompletionVerified', 'externalCAISendVerified', 'receipt']) ||
      v.protocol !== 'privacy_own_command_receipt_v1' || v.actorUid !== r.expectedAdminUid || v.requestId !== r.requestId ||
      v.privateIncidentAccessGranted !== false || v.notificationCompletionVerified !== false || v.externalCAISendVerified !== false ||
      typeof v.opaque !== 'boolean' || v.requestCommitted !== (v.state === 'committed')) throw unknown();
  const received = await parseReference(v.reference, r.expectedAdminUid, guard); guard();
  if (!sameReference(received, r)) throw unknown();
  parseProof({state: v.state, recordedAt: v.recordedAt, reason: v.reason});
  if (v.opaque) {
    if (v.receipt !== null) throw unknown();
  } else {
    const n = v.receipt;
    if (v.state !== 'committed' || r.kind !== 'notice' || !record(n) || n.protocol !== 'privacy_user_notices_v1' || n.ok !== true ||
        n.actorUid !== r.expectedAdminUid || n.requestId !== r.requestId || n.incidentId !== r.incidentId ||
        n.campaignId !== r.campaignId || n.requestPayloadHash !== r.payloadHash || !hash(n.payloadHash) ||
        typeof n.messageVersion !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(n.messageVersion) || 'opaque' in n && n.opaque !== false ||
        !integers(n.total) || n.total < 1 || n.total > 1000 || !integers(n.inAppCommittedCount) || !integers(n.pendingCount) ||
        n.inAppCommittedCount + n.pendingCount !== n.total || !integers(n.failedThisAttempt) || n.failedThisAttempt > 50 ||
        n.complete !== (n.pendingCount === 0) || n.inAppCommitted !== n.complete || n.resumable !== !n.complete ||
        n.transportQueued !== (n.inAppCommittedCount > 0) || n.transportIntentCount !== n.inAppCommittedCount ||
        n.deviceDeliveryVerified !== false || n.readingVerified !== false) throw unknown();
    const campaignId = await digest(n.messageVersion); guard();
    if (campaignId !== r.campaignId) throw unknown();
  }
  return v as unknown as PrivacyOwnCommandReceipt;
}

async function readJournal(uid: string, guard: () => void): Promise<PrivacyIncidentJournalEntry | null> {
  guard(); const raw = await AsyncStorage.getItem(journalKey(uid)); guard();
  if (raw === null) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { throw unknown(); }
  if (!record(value)) throw unknown();
  if (value.version === 2) {
    if (!exact(value, ['version', 'reference', 'receipt', 'proof'])) throw unknown();
    const r = await parseReference(value.reference, uid, guard); guard();
    const proof = parseProof(value.proof);
    const receipt = value.receipt === null ? null : await parseMinimalReceipt(value.receipt, r, guard); guard();
    if (!receipt && (!proof || proof.state === 'unrecorded') || proof?.state === 'unrecorded' || proof?.state === 'not_executed' && receipt) throw unknown();
    return { version: 2, reference: r, attempt: null, receipt, proof };
  }
  if (!validateAttempt(value.attempt, uid) || !(value.receipt === null || record(value.receipt))) throw unknown();
  const r = await attemptReference(value.attempt, guard); guard();
  const receipt = value.receipt === null ? null : await parseReceipt(value.receipt, value.attempt, guard); guard();
  const proof = parseProof(value.proof);
  if (receipt && proof?.state === 'unrecorded' || proof?.state === 'not_executed') throw unknown();
  return { version: 1, reference: r, attempt: value.attempt, receipt, proof };
}

const journalValue = (entry: PrivacyIncidentJournalEntry) => entry.version === 1
  ? { attempt: entry.attempt, receipt: entry.receipt, proof: entry.proof }
  : { version: 2, reference: entry.reference, receipt: entry.receipt, proof: entry.proof };
const journalEqual = (a: PrivacyIncidentJournalEntry, b: PrivacyIncidentJournalEntry) => JSON.stringify(journalValue(a)) === JSON.stringify(journalValue(b));
const proofOf = (r: PrivacyOwnCommandReceipt): PrivacyOwnCommandJournalProof => ({state: r.state, recordedAt: r.recordedAt, reason: r.reason});
const terminalOwn = (r: PrivacyOwnCommandReceipt) => r.state === 'not_executed' || r.state === 'committed' && (r.opaque || r.receipt?.complete === true);
export const privacyIncidentCanAcknowledge = (entry: PrivacyIncidentJournalEntry) => entry.version === 2 || !!entry.receipt &&
  (entry.receipt.opaque === true || entry.receipt.protocol !== 'privacy_user_notices_v1' || entry.receipt.complete);
export const privacyIncidentCanResume = (entry: PrivacyIncidentJournalEntry) => entry.version === 1 && !!entry.attempt && entry.receipt?.opaque !== true &&
  (entry.proof?.state === 'unrecorded' || entry.proof?.state === 'committed' && entry.receipt?.protocol === 'privacy_user_notices_v1' && !entry.receipt.complete);

export class PrivacyIncidentService {
  static async permission(uid: string, assertContext: () => void): Promise<true> { await admin(uid, assertContext); return true; }
  static async read(uid: string, incidentId: string | null, assertContext: () => void): Promise<PrivacyIncidentRecord[]> {
    const assertCurrent = await admin(uid, assertContext);
    if (incidentId !== null && !reference(incidentId)) throw unknown();
    const payload = incidentId ? { incidentId } : { limit: 200 };
    const { data } = await httpsCallable<typeof payload, unknown>(functions, 'getPrivacyIncidentsLog')(payload); assertCurrent();
    if (!record(data) || data.ok !== true || !Array.isArray(data.incidents) || data.incidents.length > (incidentId ? 1 : 200) ||
        data.count !== data.incidents.length) throw unknown();
    const incidents = data.incidents.map(parseIncident);
    if (new Set(incidents.map(i => i.id)).size !== incidents.length || incidentId && incidents.some(i => i.id !== incidentId)) throw unknown();
    return incidents;
  }
  static async journal(uid: string, assertContext: () => void): Promise<PrivacyIncidentJournalEntry | null> {
    const guard = await identity(uid, assertContext);
    return readJournal(uid, guard);
  }
  private static async observeNative(r: PrivacyOwnCommandReference, operation: 'receipt_observe' | 'receipt_neutralize', guard: () => void): Promise<PrivacyOwnCommandReceipt> {
    guard();
    const payload = { operation, reference: r };
    const { data } = await httpsCallable<typeof payload, unknown>(functions, commandName(r.kind))(payload); guard();
    const receipt = await parseObservedReceipt(data, r, guard); guard();
    return receipt;
  }
  private static async saveObservation(entry: PrivacyIncidentJournalEntry, result: PrivacyOwnCommandReceipt, guard: () => void): Promise<PrivacyIncidentJournalEntry> {
    if (!sameReference(entry.reference, result.reference) || result.state === 'unrecorded' && (entry.version === 2 || entry.receipt || entry.proof?.state === 'committed')) throw unknown();
    const minimal = entry.version === 2 || entry.receipt?.opaque === true || result.state === 'not_executed' || result.state === 'committed' && result.opaque;
    const next: PrivacyIncidentJournalEntry = minimal
      ? { version: 2, reference: entry.reference, attempt: null, receipt: null, proof: proofOf(result) }
      : { ...entry, receipt: result.receipt ?? entry.receipt, proof: proofOf(result) };
    await serialize(entry.reference.expectedAdminUid, async () => {
      guard(); const current = await readJournal(entry.reference.expectedAdminUid, guard); guard();
      if (!current || !journalEqual(current, entry)) throw unknown();
      await AsyncStorage.setItem(journalKey(entry.reference.expectedAdminUid), JSON.stringify(journalValue(next))); guard();
    });
    return next;
  }
  /** Pure observation never repeats a mutation, even if admin authority was restored. */
  static async observe(r: PrivacyOwnCommandReference, assertContext: () => void): Promise<PrivacyOwnCommandReceipt> {
    const uid = r.expectedAdminUid, guard = await identity(uid, assertContext);
    const qualified = await parseReference(r, uid, guard); guard();
    if (locks.has(uid)) throw unknown(); locks.add(uid);
    try {
      const entry = await readJournal(uid, guard); guard();
      if (!entry || !sameReference(entry.reference, qualified)) throw unknown();
      const result = await this.observeNative(qualified, 'receipt_observe', guard); guard();
      await this.saveObservation(entry, result, guard); guard();
      return result;
    } finally { locks.delete(uid); }
  }
  /** Only a fresh absent observation permits neutralization; committed campaigns stay committed. */
  static async neutralize(r: PrivacyOwnCommandReference, assertContext: () => void): Promise<PrivacyOwnCommandReceipt> {
    const uid = r.expectedAdminUid, guard = await identity(uid, assertContext);
    const qualified = await parseReference(r, uid, guard); guard();
    if (locks.has(uid)) throw unknown(); locks.add(uid);
    try {
      const entry = await readJournal(uid, guard); guard();
      if (!entry || !sameReference(entry.reference, qualified)) throw unknown();
      const observed = await this.observeNative(qualified, 'receipt_observe', guard); guard();
      if (observed.state !== 'unrecorded') { await this.saveObservation(entry, observed, guard); return observed; }
      const result = await this.observeNative(qualified, 'receipt_neutralize', guard); guard();
      await this.saveObservation(entry, result, guard); guard(); return result;
    } finally { locks.delete(uid); }
  }
  static async execute(attempt: PrivacyIncidentAttempt, assertContext: () => void): Promise<PrivacyIncidentReceipt | PrivacyOwnCommandReceipt> {
    const uid = attempt.payload.expectedAdminUid, guard = await identity(uid, assertContext);
    if (!validateAttempt(attempt, uid) || locks.has(uid)) throw unknown();
    if (attempt.kind === 'cai' && !validPrivacyExternalDate(attempt.payload.notifiedAt)) throw new Error('La date doit être celle d’une action externe déjà effectuée.');
    locks.add(uid);
    try {
      const r = await attemptReference(attempt, guard); guard();
      let entry = await readJournal(uid, guard); guard();
      if (entry && (entry.version !== 1 || !entry.attempt || JSON.stringify(entry.attempt) !== JSON.stringify(attempt) || entry.receipt?.opaque === true)) throw unknown();
      // NEW is admitted before persisting a body. A pre-existing intent is observed first under SDK identity alone.
      if (!entry) {
        await admin(uid, guard); guard();
        entry = { version: 1, attempt, reference: r, receipt: null, proof: null };
        const initial = entry;
        await serialize(uid, async () => { guard(); if (await readJournal(uid, guard)) throw unknown(); guard(); await AsyncStorage.setItem(journalKey(uid), JSON.stringify(journalValue(initial))); guard(); });
      }
      const observed = await this.observeNative(r, 'receipt_observe', guard); guard();
      entry = await this.saveObservation(entry, observed, guard); guard();
      if (observed.state !== 'unrecorded' && !(entry.version === 1 && observed.state === 'committed' && !observed.opaque && observed.receipt?.resumable === true)) return observed;
      if (entry.version !== 1 || !entry.attempt) throw unknown();
      await admin(uid, guard); guard();
      const { data } = await httpsCallable<typeof attempt.payload, unknown>(functions, commandName(attempt.kind))(attempt.payload); guard();
      if (record(data) && data.protocol === 'privacy_own_command_receipt_v1') {
        const own = await parseObservedReceipt(data, r, guard); guard(); await this.saveObservation(entry, own, guard); return own;
      }
      const receipt = await parseReceipt(data, attempt, guard); guard();
      const next: PrivacyIncidentJournalEntry = receipt.opaque === true
        ? { version: 2, reference: r, attempt: null, receipt, proof: null }
        : { ...entry, receipt, proof: null };
      await serialize(uid, async () => {
        guard(); const current = await readJournal(uid, guard); guard();
        if (!current || !journalEqual(current, entry)) throw unknown();
        await AsyncStorage.setItem(journalKey(uid), JSON.stringify(journalValue(next))); guard();
      });
      return receipt;
    } finally { locks.delete(uid); }
  }
  /** ACK is a pure native re-read followed by exact local removal, never an execute. */
  static async acknowledge(r: PrivacyOwnCommandReference, assertContext: () => void): Promise<void> {
    const uid = r.expectedAdminUid, guard = await identity(uid, assertContext);
    const qualified = await parseReference(r, uid, guard); guard();
    if (locks.has(uid)) throw unknown(); locks.add(uid);
    try {
      const prior = await readJournal(uid, guard); guard();
      if (!prior || !sameReference(prior.reference, qualified) || !privacyIncidentCanAcknowledge(prior)) throw unknown();
      const result = await this.observeNative(qualified, 'receipt_observe', guard); guard();
      if (!(terminalOwn(result) || (prior.version === 2 || prior.receipt?.opaque === true) && result.state === 'committed') || prior.proof?.state === 'not_executed' && result.state !== 'not_executed' ||
          (prior.proof?.state === 'committed' || prior.receipt) && result.state !== 'committed') throw unknown();
      await serialize(uid, async () => {
        guard(); const current = await readJournal(uid, guard); guard();
        if (!current || !journalEqual(current, prior)) throw unknown();
        await AsyncStorage.removeItem(journalKey(uid)); guard();
      });
    } finally { locks.delete(uid); }
  }
}
