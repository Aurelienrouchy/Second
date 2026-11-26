/**
 * Private incident register. Severity is an operator assessment, not an
 * automatic legal conclusion. External CAI actions are documented operator
 * attestations; this application does not send them or certify their receipt.
 * Individual notice receipts prove only durable in-app registration.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { auth, db, FieldValue } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { prepareOperationalNotices, readOperationalNoticeReceipts, type OperationalNoticeInput } from '../utils/notifications';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';

const REGION = 'northamerica-northeast1';

type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
type IncidentStatus = 'open' | 'investigating' | 'contained' | 'resolved';

const SEVERITIES: ReadonlySet<IncidentSeverity> = new Set([
  'low',
  'medium',
  'high',
  'critical',
]);
const STATUSES: ReadonlySet<IncidentStatus> = new Set([
  'open',
  'investigating',
  'contained',
  'resolved',
]);

export interface RecordPrivacyIncidentInput {
  type: string;
  severity?: IncidentSeverity;
  description: string;
  affectedUserIds?: string[];
  affectedDataFields?: string[];
  measures?: string;
  notifiedCAI?: boolean;
  status?: IncidentStatus;
}

/**
 * Internal helper: writes a privacy_incidents doc with a serverTimestamp.
 * Never throws — best-effort logging used by automated handlers. Returns the
 * created doc id, or null on failure (which is itself logged).
 *
 * Never writes `undefined` into Firestore (omits absent optional fields).
 */
export async function recordPrivacyIncident(
  input: RecordPrivacyIncidentInput,
): Promise<string | null> {
  try {
    const doc: Record<string, unknown> = {
      type: input.type,
      severity: SEVERITIES.has(input.severity as IncidentSeverity)
        ? input.severity
        : 'medium',
      description: input.description,
      affectedUserIds: Array.isArray(input.affectedUserIds) ? input.affectedUserIds : [],
      affectedDataFields: Array.isArray(input.affectedDataFields)
        ? input.affectedDataFields
        : [],
      measures: typeof input.measures === 'string' ? input.measures : '',
      // Legacy caller boolean is never proof of an external action.
      notifiedCAI: false,
      caiNotificationState: 'not_recorded',
      status: STATUSES.has(input.status as IncidentStatus) ? input.status : 'open',
      detectedAt: FieldValue.serverTimestamp(),
    };
    const ref = await db.collection('privacy_incidents').add(doc);
    logger.warn('[privacy_incidents] incident recorded', {
      incidentId: ref.id,
      type: doc.type,
      severity: doc.severity,
    });
    return ref.id;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[privacy_incidents] failed to record incident', {
      type: input.type,
      error: message,
    });
    return null;
  }
}

/**
 * reportPrivacyIncident — admin-only callable to log a privacy/security incident.
 */
export const reportPrivacyIncident = onCall({ region: REGION, memory: '512MiB' }, async (request) => withIncidentMutationSession(request, async () => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentification requise');
  }

  const ownReceipt = await privacyReceiptOperation(request, 'create');
  if (ownReceipt) return ownReceipt;
  const data = (request.data ?? {}) as Partial<RecordPrivacyIncidentInput> & { expectedAdminUid?: unknown; requestId?: unknown };
  const actorUid = request.auth.uid;
  if (data.expectedAdminUid !== actorUid || typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestId)) {
    throw new HttpsError('invalid-argument', 'Intention et identité administrateur explicites requises.');
  }

  if (typeof data.type !== 'string' || data.type.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'type is required');
  }
  if (typeof data.description !== 'string' || data.description.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'description is required');
  }
  if (data.severity !== undefined && !SEVERITIES.has(data.severity)) {
    throw new HttpsError('invalid-argument', 'invalid severity');
  }
  if (data.status !== undefined && !STATUSES.has(data.status)) {
    throw new HttpsError('invalid-argument', 'invalid status');
  }
  if (data.type.trim().length > 100 || data.description.trim().length > 10_000 ||
      (data.affectedUserIds !== undefined && (!Array.isArray(data.affectedUserIds) || data.affectedUserIds.length > 1000 ||
        data.affectedUserIds.some(uid => !validId(uid))))) {
    throw new HttpsError('invalid-argument', 'Type, description ou personnes concernées invalides.');
  }

  if (data.affectedDataFields !== undefined && (!Array.isArray(data.affectedDataFields) || data.affectedDataFields.length > 100 ||
      data.affectedDataFields.some(value => typeof value !== 'string' || !value.trim() || value.trim().length > 100))) {
    throw new HttpsError('invalid-argument', 'Champs concernés invalides.');
  }
  if (data.measures !== undefined && (typeof data.measures !== 'string' || data.measures.trim().length > 4000)) {
    throw new HttpsError('invalid-argument', 'Mesures invalides.');
  }
  const requestId = data.requestId;
  const canonical = { type: data.type.trim(), severity: data.severity ?? 'medium', description: data.description.trim(),
    affectedUserIds: [...new Set(data.affectedUserIds ?? [])].sort(),
    affectedDataFields: [...new Set((data.affectedDataFields ?? []).map(value => value.trim()))].sort(),
    measures: data.measures?.trim() ?? '', status: data.status ?? 'open' };
  const incidentId = 'pi_' + digest([actorUid, requestId]), ref = db.collection('privacy_incidents').doc(incidentId);
  const payloadHash = digest([actorUid, requestId, canonical]);
  const result = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const reference = ownPrivacyReference({kind: 'create', expectedAdminUid: actorUid, requestId, incidentId, payloadHash}, 'create', actorUid);
    const claim = await readOwnPrivacyClaim(tx, reference);
    if (claim.state === 'not_executed') return {controlReceipt: ownPrivacyEnvelope(reference, claim.state, claim.recordedAt)};
    const existing = (await tx.get(ref)).data();
    if (existing) {
      const proof = existing.creationReceipt;
      if (proof?.protocol !== 'privacy_incident_creation_v1' || proof.actorUid !== actorUid || proof.requestId !== requestId ||
          proof.incidentId !== incidentId || proof.payloadHash !== payloadHash || !(proof.createdAt instanceof Timestamp)) {
        throw new HttpsError('failed-precondition', 'Cette intention correspond à un autre dossier ou à un reçu à rapprocher.');
      }
      return { replay: true, createdAt: proof.createdAt.toDate().toISOString() };
    }
    await assertIncidentReader(request, tx);
    tx.create(ref, { ...canonical, notifiedCAI: false, caiNotificationState: 'not_recorded', detectedAt: FieldValue.serverTimestamp(),
      creationReceipt: { protocol: 'privacy_incident_creation_v1', actorUid, requestId, incidentId, payloadHash,
        createdAt: FieldValue.serverTimestamp() } });
    return { replay: false, createdAt: null };
  });
  if (result.controlReceipt) return result.controlReceipt;
  const receipt = (await ref.get()).data()?.creationReceipt;
  if (receipt?.protocol !== 'privacy_incident_creation_v1' || receipt.actorUid !== actorUid || receipt.requestId !== requestId ||
      receipt.incidentId !== incidentId || receipt.payloadHash !== payloadHash || !(receipt.createdAt instanceof Timestamp)) {
    throw new HttpsError('unavailable', 'Le reçu de création doit être retrouvé.');
  }

  logger.warn('[reportPrivacyIncident] native incident creation receipt returned', {
    incidentId,
    adminUid: request.auth.uid,
    type: data.type,
    replay: result.replay,
  });

  return { protocol: 'privacy_incident_creation_v1', ok: true, incidentId, requestId, actorUid, payloadHash,
    createdAt: result.createdAt ?? receipt.createdAt.toDate().toISOString(), replay: result.replay };
}));

const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const boundedText = (value: unknown, name: string, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpsError('invalid-argument', `${name} requis (maximum ${max} caractères).`);
  return value.trim();
};
function requestIdentity(data: Record<string, unknown>, uid: string) {
  if (!validId(data.incidentId) || typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestId) || data.expectedAdminUid !== uid) {
    throw new HttpsError('invalid-argument', 'Incident, intention et identité administrateur explicites requis.');
  }
  return { incidentId: data.incidentId, requestId: data.requestId, actorUid: uid };
}
function recipients(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000 || value.some(uid => !validId(uid))) {
    throw new HttpsError('failed-precondition', 'La liste des personnes concernées doit être vérifiée (1 à 1000 identifiants).');
  }
  return [...new Set(value)].sort();
}
function caiReceiptQualified(receipt: FirebaseFirestore.DocumentData | undefined, incidentId: string, receiptId: string): boolean {
  return !!receipt && receipt.protocol === 'privacy_cai_external_v1' && receipt.receiptId === receiptId &&
    receipt.incidentId === incidentId && validId(receipt.actorUid) && typeof receipt.requestId === 'string' &&
    /^[A-Za-z0-9_-]{16,128}$/.test(receipt.requestId) && receipt.recordedAt instanceof Timestamp &&
    receipt.notifiedAt instanceof Timestamp && receipt.notifiedAt.toMillis() <= receipt.recordedAt.toMillis() &&
    ['cai_secure_form', 'registered_mail', 'email', 'other'].includes(receipt.channel) &&
    typeof receipt.caiReference === 'string' && receipt.caiReference.trim().length > 0 &&
    typeof receipt.evidenceReference === 'string' && receipt.evidenceReference.trim().length > 0 &&
    receipt.externalActionDeclared === true && receipt.sentByApplication === false &&
    receiptId === digest([incidentId, receipt.actorUid, receipt.requestId]) &&
    receipt.payloadHash === digest([incidentId, receipt.actorUid, receipt.requestId, receipt.notifiedAt.toDate().toISOString(),
      receipt.channel, receipt.caiReference, receipt.evidenceReference]);
}

function campaignQualified(campaign: FirebaseFirestore.DocumentData | undefined, incidentId: string, campaignId: string): boolean {
  return !!campaign && campaign.protocol === 'privacy_notice_campaign_v1' && campaign.incidentId === incidentId &&
    campaign.campaignId === campaignId && typeof campaign.messageVersion === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(campaign.messageVersion) &&
    campaignId === digest(campaign.messageVersion) && typeof campaign.message === 'string' && campaign.message.length > 0 && campaign.message.length <= 4000 &&
    campaign.createdAt instanceof Timestamp && validId(campaign.actorUid) && Array.isArray(campaign.recipientIds) &&
    campaign.recipientIds.length > 0 && campaign.recipientIds.length <= 1000 && campaign.recipientIds.every(validId) &&
    digest(campaign.recipientIds) === digest([...new Set(campaign.recipientIds)].sort()) &&
    campaign.payloadHash === digest([incidentId, campaign.messageVersion, campaign.message, campaign.recipientIds]);
}

type PrivacyOwnKind = 'create' | 'cai' | 'notice';
type PrivacyOwnReference = {kind: PrivacyOwnKind; expectedAdminUid: string; requestId: string; incidentId: string;
  payloadHash: string; campaignId?: string};
const privacyHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function ownPrivacyReference(value: any, kind: PrivacyOwnKind, uid: string): PrivacyOwnReference {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['kind', 'expectedAdminUid', 'requestId', 'incidentId', 'payloadHash', 'campaignId'].includes(key)) ||
      value.kind !== kind || value.expectedAdminUid !== uid || typeof value.requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(value.requestId) || !validId(value.incidentId) || !privacyHash(value.payloadHash) ||
      (kind === 'notice' ? !privacyHash(value.campaignId) : value.campaignId !== undefined) ||
      kind === 'create' && value.incidentId !== 'pi_' + digest([uid, value.requestId])) {
    throw new HttpsError('invalid-argument', 'Référence exacte du propre acte requise.');
  }
  return {kind, expectedAdminUid: uid, requestId: value.requestId, incidentId: value.incidentId,
    payloadHash: value.payloadHash, ...(kind === 'notice' ? {campaignId: value.campaignId} : {})};
}
function legacyPrivacyReference(data: any, kind: PrivacyOwnKind, uid: string) {
  if (data.expectedAdminUid !== uid || typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.requestId)) {
    throw new HttpsError('invalid-argument', 'Intention et identité exactes requises.');
  }
  let incidentId = data.incidentId, payloadHash: string, campaignId: string | undefined;
  if (kind === 'create') {
    if (typeof data.type !== 'string' || !data.type.trim() || typeof data.description !== 'string' || !data.description.trim() ||
        data.affectedUserIds !== undefined && (!Array.isArray(data.affectedUserIds) || data.affectedUserIds.some((v: unknown) => !validId(v))) ||
        data.affectedDataFields !== undefined && (!Array.isArray(data.affectedDataFields) || data.affectedDataFields.some((v: unknown) => typeof v !== 'string')) ||
        data.measures !== undefined && typeof data.measures !== 'string') throw new HttpsError('invalid-argument', 'Intention de création invalide.');
    const canonical = {type: data.type.trim(), severity: data.severity ?? 'medium', description: data.description.trim(),
      affectedUserIds: [...new Set(data.affectedUserIds ?? [])].sort(),
      affectedDataFields: [...new Set((data.affectedDataFields ?? []).map((v: string) => v.trim()))].sort(),
      measures: data.measures?.trim() ?? '', status: data.status ?? 'open'};
    incidentId = 'pi_' + digest([uid, data.requestId]);payloadHash = digest([uid, data.requestId, canonical]);
  } else {
    const input = requestIdentity(data, uid);
    if (kind === 'cai') payloadHash = digest([input.incidentId, uid, input.requestId,
      boundedText(data.notifiedAt, 'Date', 40), boundedText(data.channel, 'Canal', 40),
      boundedText(data.caiReference, 'Référence externe', 500), boundedText(data.evidenceReference, 'Preuve', 2000)]);
    else {
      const version = boundedText(data.messageVersion, 'Version', 64), message = boundedText(data.message, 'Message', 4000);
      campaignId = digest(version);payloadHash = digest([input.incidentId, uid, input.requestId, version, message]);
    }
  }
  return ownPrivacyReference({kind, expectedAdminUid: uid, requestId: data.requestId, incidentId, payloadHash,
    ...(campaignId ? {campaignId} : {})}, kind, uid);
}
const privacyReferenceHash = (r: PrivacyOwnReference) => digest(['privacy_own_command_reference_v1', r.kind,
  r.expectedAdminUid, r.requestId, r.incidentId, r.payloadHash, r.campaignId ?? null]);
function ownPrivacyPaths(r: PrivacyOwnReference) {
  const incident = db.collection('privacy_incidents').doc(r.incidentId);
  const original = r.kind === 'create' ? incident : r.kind === 'cai'
    ? incident.collection('cai_notifications').doc(digest([r.incidentId, r.expectedAdminUid, r.requestId]))
    : incident.collection('notice_requests').doc(digest([r.expectedAdminUid, r.requestId]));
  return {incident, original, control: incident.collection('command_controls').doc(digest([r.kind, r.expectedAdminUid, r.requestId]))};
}
function ownPrivacyEnvelope(reference: PrivacyOwnReference, state: 'unrecorded' | 'committed' | 'not_executed', recordedAt: Timestamp | null,
  receipt: FirebaseFirestore.DocumentData | null = null) {
  return {protocol: 'privacy_own_command_receipt_v1' as const, actorUid: reference.expectedAdminUid, requestId: reference.requestId,
    reference, state, recordedAt: recordedAt?.toDate().toISOString() ?? null, reason: state === 'not_executed' ? 'command_neutralized' : null,
    requestCommitted: state === 'committed', opaque: receipt === null, privateIncidentAccessGranted: false,
    notificationCompletionVerified: false, externalCAISendVerified: false, receipt};
}
async function readOwnPrivacyClaim(tx: FirebaseFirestore.Transaction, r: PrivacyOwnReference) {
  const paths = ownPrivacyPaths(r), original = (await tx.get(paths.original)).data(), control = (await tx.get(paths.control)).data();
  const mismatch = (): never => {throw new HttpsError('failed-precondition', 'Le propre reçu doit être rapproché de son intention exacte.');};
  const nativeTime = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now() + 60_000;
  if (original) {
    if (control) return mismatch();
    let recordedAt: Timestamp;
    if (r.kind === 'create') {
      const proof = original.creationReceipt;
      if (proof?.protocol !== 'privacy_incident_creation_v1' || proof.actorUid !== r.expectedAdminUid || proof.requestId !== r.requestId ||
          proof.incidentId !== r.incidentId || proof.payloadHash !== r.payloadHash || !nativeTime(proof.createdAt)) return mismatch();
      recordedAt = proof.createdAt;
    } else if (r.kind === 'cai') {
      if (!caiReceiptQualified(original, r.incidentId, paths.original.id) || original.actorUid !== r.expectedAdminUid ||
          original.requestId !== r.requestId || original.payloadHash !== r.payloadHash || !nativeTime(original.recordedAt)) return mismatch();
      recordedAt = original.recordedAt;
    } else {
      if (original.protocol !== 'privacy_notice_request_v1' || original.actorUid !== r.expectedAdminUid || original.requestId !== r.requestId ||
          original.incidentId !== r.incidentId || original.campaignId !== r.campaignId || original.payloadHash !== r.payloadHash || !nativeTime(original.createdAt)) return mismatch();
      recordedAt = original.createdAt;
    }
    return {state: 'committed' as const, recordedAt};
  }
  if (control) {
    if (control.protocol !== 'privacy_own_command_neutralization_v1' || control.state !== 'not_executed' ||
        control.kind !== r.kind || control.expectedAdminUid !== r.expectedAdminUid || control.actorUid !== r.expectedAdminUid || control.requestId !== r.requestId || control.incidentId !== r.incidentId ||
        control.payloadHash !== r.payloadHash || (control.campaignId ?? null) !== (r.campaignId ?? null) ||
        control.referenceHash !== privacyReferenceHash(r) || !nativeTime(control.recordedAt)) return mismatch();
    return {state: 'not_executed' as const, recordedAt: control.recordedAt as Timestamp};
  }
  return {state: 'unrecorded' as const, recordedAt: null};
}
async function readOwnNoticeProgress(request: any, tx: FirebaseFirestore.Transaction, r: PrivacyOwnReference) {
  if (!await incidentReaderAvailable(request, tx)) return null;
  const incident = (await tx.get(ownPrivacyPaths(r).incident)).data(),
    campaign = (await tx.get(ownPrivacyPaths(r).incident.collection('notice_campaigns').doc(r.campaignId!))).data();
  if (!incident || incident.currentNoticeCampaignId !== r.campaignId || !campaignQualified(campaign, r.incidentId, r.campaignId!) ||
      !campaign || digest([r.incidentId, r.expectedAdminUid, r.requestId, campaign.messageVersion, campaign.message]) !== r.payloadHash ||
      digest(recipients(incident.affectedUserIds)) !== digest(campaign.recipientIds)) return null;
  const proofs = await readOperationalNoticeReceipts(tx, campaign.recipientIds.map((uid: string) => privacyNotice(r.incidentId, r.campaignId!, campaign, uid)));
  if (!await incidentReaderAvailable(request, tx)) return null;
  const committed = proofs.filter(Boolean).length, total = campaign.recipientIds.length, complete = committed === total;
  return {protocol: 'privacy_user_notices_v1', ok: true, incidentId: r.incidentId, actorUid: r.expectedAdminUid, requestId: r.requestId,
    campaignId: r.campaignId, messageVersion: campaign.messageVersion, requestPayloadHash: r.payloadHash, payloadHash: campaign.payloadHash,
    total, inAppCommittedCount: committed, pendingCount: total - committed, failedThisAttempt: 0, complete,
    inAppCommitted: complete, resumable: !complete, transportQueued: committed > 0, transportIntentCount: committed,
    deviceDeliveryVerified: false, readingVerified: false};
}
/** Pure own-command observation precedes any NEW admission/body parser. Only
 * neutralization writes, and only its exact absent-command tombstone. */
async function privacyReceiptOperation(request: any, kind: PrivacyOwnKind) {
  const data = request.data ?? {}, normalize = (v: unknown) => v === 'observe' || v === 'receipt_observe' ? 'observe'
    : v === 'neutralize' || v === 'receipt_neutralize' ? 'neutralize' : v === 'execute' ? 'execute' : null;
  if (data.operation === undefined && data.mode === undefined) {
    if (data.reference !== undefined) throw new HttpsError('invalid-argument', 'Mode de lecture du propre reçu requis.');
    return null;
  }
  const operation = normalize(data.operation ?? data.mode);
  if (!operation || data.operation !== undefined && data.mode !== undefined && normalize(data.mode) !== operation) {
    throw new HttpsError('invalid-argument', 'Mode de reçu privé invalide.');
  }
  if (operation === 'execute') return null;
  const uid = request.auth.uid, reference = data.reference !== undefined ? ownPrivacyReference(data.reference, kind, uid) : legacyPrivacyReference(data, kind, uid);
  const observe = () => db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const claim = await readOwnPrivacyClaim(tx, reference);
    const receipt = claim.state === 'committed' && kind === 'notice' ? await readOwnNoticeProgress(request, tx, reference) : null;
    await assertPrivateAccountSession(request, tx);
    return ownPrivacyEnvelope(reference, claim.state, claim.recordedAt, receipt);
  });
  if (operation === 'observe') return observe();
  await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const claim = await readOwnPrivacyClaim(tx, reference);
    if (claim.state !== 'unrecorded') return;
    await assertPrivateAccountSession(request, tx);
    tx.create(ownPrivacyPaths(reference).control, {protocol: 'privacy_own_command_neutralization_v1', ...reference,
      actorUid: uid, state: 'not_executed', referenceHash: privacyReferenceHash(reference), recordedAt: FieldValue.serverTimestamp()});
  });
  return observe();
}

/** This private reader uses the CURRENT Auth role, with the existing private
 * user fallback. The native session/profile reads join the caller's TX. */
async function assertIncidentReader(request: any, tx?: FirebaseFirestore.Transaction): Promise<void> {
  if (!tx) return db.runTransaction(current => assertIncidentReader(request, current));
  const session = await assertPrivateAccountSession(request, tx);
  const privateUser = (await tx.get(db.collection('users').doc(session.uid))).data();
  // Auth can change while the native role/profile read is in flight. Its last
  // observation must follow that read, before either a write or private return.
  let current;
  try {current = await auth.getUser(session.uid);}
  catch {throw new HttpsError('unavailable', 'Autorité administrative actuelle indisponible.');}
  const cutoff = typeof current.tokensValidAfterTime === 'string' ? Date.parse(current.tokensValidAfterTime) : NaN;
  if (current.uid !== session.uid || current.disabled || !Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > Date.now() ||
      request.auth.token.auth_time * 1000 < cutoff) {
    throw new HttpsError('unauthenticated', 'Réauthentification requise.', {reason: 'private_session_stale', action: 'reauthenticate'});
  }
  if (privateUser && Object.prototype.hasOwnProperty.call(privateUser, 'isActive') && privateUser.isActive !== true ||
      privateUser && Object.prototype.hasOwnProperty.call(privateUser, 'isAdmin') && privateUser.isAdmin !== true ||
      current.customClaims?.admin !== true && privateUser?.isAdmin !== true) {
    throw new HttpsError('permission-denied', 'Admin privileges required');
  }
}

function opaqueIncidentReceipt(value: Record<string, any>) {
  const common = {protocol: value.protocol, ok: true as const, incidentId: value.incidentId,
    requestId: value.requestId, actorUid: value.actorUid, payloadHash: value.payloadHash,
    opaque: true as const, requestCommitted: true as const, replay: true as const};
  return value.protocol === 'privacy_cai_external_v1'
    ? {...common, receiptId: value.receiptId, recordedAt: value.recordedAt,
      externalActionDeclared: true as const, sentByApplication: false as const}
    : {...common, campaignId: value.campaignId, requestPayloadHash: value.requestPayloadHash};
}
async function incidentReaderAvailable(request: any, tx?: FirebaseFirestore.Transaction) {
  try {await assertIncidentReader(request, tx);return true;}
  catch (error) {if (error instanceof HttpsError && error.code === 'permission-denied') return false;throw error;}
}
async function withIncidentMutationSession(request: any, operation: () => Promise<any>) {
  const result = await withPrivateAccountSession(request, operation);
  // Creation already returns only its own opaque native receipt. Other bodies
  // require current authority AFTER all IO, including the session wrapper.
  if (result.protocol === 'privacy_own_command_receipt_v1') {
    return result.receipt && !await incidentReaderAvailable(request) ? {...result, opaque: true, receipt: null} : result;
  }
  if (result.protocol === 'privacy_incident_creation_v1' || result.opaque === true) return result;
  return await incidentReaderAvailable(request) ? result : opaqueIncidentReceipt(result);
}

/** Admin read distinguishes old claims from qualified native receipts. */
export const getPrivacyIncidentsLog = onCall({ region: REGION, memory: '512MiB' }, async request => withPrivateAccountSession(request, async () => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise');
  await assertIncidentReader(request);
  const rawLimit = (request.data ?? {}).limit;
  const limit = Number.isSafeInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;
  const incidentId = (request.data ?? {}).incidentId;
  if (incidentId !== undefined && !validId(incidentId)) throw new HttpsError('invalid-argument', 'Identifiant d’incident invalide.');
  const documents = incidentId !== undefined
    ? [(await db.collection('privacy_incidents').doc(incidentId).get())].filter(document => document.exists)
    : (await db.collection('privacy_incidents').orderBy('detectedAt', 'desc').limit(limit).get()).docs;
  const incidents = await Promise.all(documents.map(async document => {
    const data = document.data()!, receiptId = data.caiNotificationReceiptId;
    const receipt = validId(receiptId) ? (await document.ref.collection('cai_notifications').doc(receiptId).get()).data() : undefined;
    const qualified = validId(receiptId) && caiReceiptQualified(receipt, document.id, receiptId);
    const aggregate = data.userNoticeCompletion;
    // A native aggregate is linked to an immutable campaign; old timestamps
    // are retained as declarations but never promoted to delivery evidence.
    let userNoticeQualified = false;
    if (aggregate?.protocol === 'privacy_user_notices_v1' && validId(aggregate.campaignId) && aggregate.completedAt instanceof Timestamp &&
        data.currentNoticeCampaignId === aggregate.campaignId) {
      const campaign = (await document.ref.collection('notice_campaigns').doc(aggregate.campaignId).get()).data();
      if (campaignQualified(campaign, document.id, aggregate.campaignId) && campaign &&
          campaign.completedAt instanceof Timestamp && campaign.completedAt.isEqual(aggregate.completedAt) &&
          campaign.messageVersion === aggregate.messageVersion && campaign.payloadHash === aggregate.payloadHash &&
          Array.isArray(campaign.recipientIds) && campaign.recipientIds.length === aggregate.total &&
          aggregate.inAppCommitted === true && aggregate.deviceDeliveryVerified === false && aggregate.readingVerified === false) {
        try {
          const proofs = await db.runTransaction(async tx => {
            await assertIncidentReader(request, tx);
            return readOperationalNoticeReceipts(tx, campaign.recipientIds.map((uid: string) =>
              privacyNotice(document.id, aggregate.campaignId, campaign, uid)));
          });
          userNoticeQualified = proofs.every(proof => !!proof && new Date(proof.committedAt).getTime() <= aggregate.completedAt.toMillis());
        } catch (error) {
          logger.error('Privacy notification aggregate requires reconciliation', { incidentId: document.id,
            error: error instanceof Error ? error.message : 'unknown' });
        }
      }
    }
    return { id: document.id, type: data.type ?? null, severity: data.severity ?? null, description: data.description ?? null,
      affectedUserIds: data.affectedUserIds ?? [], affectedDataFields: data.affectedDataFields ?? [], measures: data.measures ?? '',
      status: data.status ?? null, detectedAt: data.detectedAt instanceof Timestamp ? data.detectedAt.toDate().toISOString() : null,
      notifiedCAI: qualified, caiNotificationState: qualified ? 'external_action_documented' : data.notifiedCAI === true || data.notifiedCAIAt ? 'historical_unqualified' : 'not_recorded',
      caiNotificationReceipt: qualified ? { protocol: 'privacy_cai_external_v1', receiptId, actorUid: receipt!.actorUid,
        notifiedAt: receipt!.notifiedAt.toDate().toISOString(), recordedAt: receipt!.recordedAt.toDate().toISOString(),
        channel: receipt!.channel, caiReference: receipt!.caiReference, evidenceReference: receipt!.evidenceReference,
        externalActionDeclared: true, sentByApplication: false } : null,
      legacyCAIDeclaration: { notifiedCAI: data.notifiedCAI === true,
        notifiedCAIAt: data.notifiedCAIAt instanceof Timestamp ? data.notifiedCAIAt.toDate().toISOString() : null,
        caiReference: typeof data.caiReference === 'string' ? data.caiReference : null },
      userNotificationState: userNoticeQualified ? 'in_app_committed' : data.currentNoticeCampaignId ? 'pending_or_unqualified' : data.notifiedUsersAt ? 'historical_unqualified' : 'not_recorded',
      notifiedUsersAt: userNoticeQualified ? aggregate.completedAt.toDate().toISOString() : null,
      legacyNotifiedUsersAt: data.notifiedUsersAt instanceof Timestamp ? data.notifiedUsersAt.toDate().toISOString() : null,
      deviceDeliveryVerified: false, readingVerified: false };
  }));
  // A role removal or containment during the campaign/receipt reads must not
  // disclose the incident body that was authorized only before that IO.
  await assertIncidentReader(request);
  return { ok: true as const, incidents, count: incidents.length };
}));

/** Records evidence of an already performed EXTERNAL action. Never sends CAI. */
export const escalatePrivacyIncidentToCAI = onCall({ region: REGION, memory: '512MiB' }, async request => withIncidentMutationSession(request, async () => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise');
  const ownReceipt = await privacyReceiptOperation(request, 'cai');
  if (ownReceipt) return ownReceipt;
  const data = (request.data ?? {}) as Record<string, unknown>, input = requestIdentity(data, request.auth.uid);
  const notifiedAtText = boundedText(data.notifiedAt, 'Date de l’action externe', 40);
  const parsedDate = new Date(notifiedAtText);
  if (!Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString() !== notifiedAtText || parsedDate.getTime() > Date.now()) {
    throw new HttpsError('invalid-argument', 'Date réelle UTC ISO canonique requise, sans date future.');
  }
  const channel = boundedText(data.channel, 'Canal externe', 40);
  if (!['cai_secure_form', 'registered_mail', 'email', 'other'].includes(channel)) throw new HttpsError('invalid-argument', 'Canal externe invalide.');
  const caiReference = boundedText(data.caiReference, 'Référence externe', 500);
  const evidenceReference = boundedText(data.evidenceReference, 'Référence de preuve privée', 2000);
  const receiptId = digest([input.incidentId, input.actorUid, input.requestId]);
  const payloadHash = digest([input.incidentId, input.actorUid, input.requestId, notifiedAtText, channel, caiReference, evidenceReference]);
  const incidentRef = db.collection('privacy_incidents').doc(input.incidentId);
  const receiptRef = incidentRef.collection('cai_notifications').doc(receiptId);
  const result = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const reference = ownPrivacyReference({kind: 'cai', expectedAdminUid: input.actorUid, requestId: input.requestId, incidentId: input.incidentId, payloadHash}, 'cai', input.actorUid);
    const claim = await readOwnPrivacyClaim(tx, reference);
    if (claim.state === 'not_executed') return {controlReceipt: ownPrivacyEnvelope(reference, claim.state, claim.recordedAt)};
    const prior = (await tx.get(receiptRef)).data();
    if (prior) {
      if (!caiReceiptQualified(prior, input.incidentId, receiptId) || prior.payloadHash !== payloadHash) {
        throw new HttpsError('failed-precondition', 'Cette intention correspond à une autre action externe ou à un reçu à rapprocher.');
      }
      return { replay: true, receipt: prior };
    }
    await assertIncidentReader(request, tx);
    const incident = (await tx.get(incidentRef)).data();
    if (!incident) throw new HttpsError('not-found', 'Incident introuvable');
    await assertIncidentReader(request, tx);
    tx.create(receiptRef, { protocol: 'privacy_cai_external_v1', ...input, receiptId, payloadHash,
      notifiedAt: Timestamp.fromDate(parsedDate), channel, caiReference, evidenceReference,
      externalActionDeclared: true, sentByApplication: false, recordedAt: FieldValue.serverTimestamp() });
    // Legacy bool/date/reference remain untouched for audit. The new pointer
    // is trusted only after reading and qualifying its private native receipt.
    tx.update(incidentRef, { caiNotificationReceiptId: receiptId, caiNotificationState: 'external_action_documented',
      ...(incident.status === 'open' ? { status: 'investigating' } : {}) });
    return { replay: false, receipt: null };
  });
  if (result.controlReceipt) return result.controlReceipt;
  const receipt = result.receipt ?? (await receiptRef.get()).data();
  if (!caiReceiptQualified(receipt, input.incidentId, receiptId)) throw new HttpsError('unavailable', 'Le reçu documentant cette action doit être retrouvé.');
  logger.warn('Privacy CAI external action documented by operator', { incidentId: input.incidentId, actorUid: input.actorUid, receiptId });
  return { protocol: 'privacy_cai_external_v1', ok: true, ...input, receiptId, payloadHash, replay: result.replay,
    notifiedAt: receipt!.notifiedAt.toDate().toISOString(), recordedAt: receipt!.recordedAt.toDate().toISOString(),
    channel, caiReference, evidenceReference, externalActionDeclared: true, sentByApplication: false };
}));

function privacyNotice(incidentId: string, campaignId: string, campaign: FirebaseFirestore.DocumentData, uid: string): OperationalNoticeInput {
  return { eventKey: `privacy_incident:${incidentId}:${campaignId}`, userId: uid, type: 'privacy_incident',
    title: 'Incident de confidentialité', message: campaign.message,
    data: { incidentId, messageVersion: campaign.messageVersion, campaignId } };
}

/** Frozen version + per-recipient native receipts. Resume missing entries only.
 * At most 50 recipients per invocation; no all-sent stamp after partial failure. */
export const notifyAffectedUsers = onCall({ region: REGION, memory: '512MiB' }, async request => withIncidentMutationSession(request, async () => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentification requise');
  const ownReceipt = await privacyReceiptOperation(request, 'notice');
  if (ownReceipt) return ownReceipt;
  const data = (request.data ?? {}) as Record<string, unknown>, input = requestIdentity(data, request.auth.uid);
  const message = boundedText(data.message, 'Message', 4000), messageVersion = boundedText(data.messageVersion, 'Version du message', 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(messageVersion)) throw new HttpsError('invalid-argument', 'Version explicite invalide.');
  const incidentRef = db.collection('privacy_incidents').doc(input.incidentId), campaignId = digest(messageVersion);
  const campaignRef = incidentRef.collection('notice_campaigns').doc(campaignId);
  const commandRef = incidentRef.collection('notice_requests').doc(digest([input.actorUid, input.requestId]));
  const commandHash = digest([input.incidentId, input.actorUid, input.requestId, messageVersion, message]);
  const commandQualified = (command: FirebaseFirestore.DocumentData | undefined) => command?.protocol === 'privacy_notice_request_v1' &&
    command.payloadHash === commandHash && command.actorUid === input.actorUid && command.requestId === input.requestId &&
    command.incidentId === input.incidentId && command.campaignId === campaignId && command.createdAt instanceof Timestamp;
  const prepared = await db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const reference = ownPrivacyReference({kind: 'notice', expectedAdminUid: input.actorUid, requestId: input.requestId, incidentId: input.incidentId, payloadHash: commandHash, campaignId}, 'notice', input.actorUid);
    const claim = await readOwnPrivacyClaim(tx, reference);
    if (claim.state === 'not_executed') return {controlReceipt: ownPrivacyEnvelope(reference, claim.state, claim.recordedAt)};
    const command = (await tx.get(commandRef)).data(), prior = (await tx.get(campaignRef)).data();
    if (command && !commandQualified(command)) throw new HttpsError('failed-precondition', 'Cette intention désigne un autre message.');
    if (command && !await incidentReaderAvailable(request, tx)) {
      return {opaque: opaqueIncidentReceipt({protocol: 'privacy_user_notices_v1', ...input, campaignId,
        payloadHash: campaignQualified(prior, input.incidentId, campaignId) && prior?.message === message && prior.messageVersion === messageVersion
          ? prior.payloadHash : null, requestPayloadHash: commandHash})};
    }
    await assertIncidentReader(request, tx);
    const incident = (await tx.get(incidentRef)).data();
    if (!incident) throw new HttpsError('not-found', 'Incident introuvable');
    const recipientIds = recipients(incident.affectedUserIds), payloadHash = digest([input.incidentId, messageVersion, message, recipientIds]);
    if (prior && (incident.currentNoticeCampaignId !== campaignId || !campaignQualified(prior, input.incidentId, campaignId) || prior.payloadHash !== payloadHash || prior.message !== message ||
        prior.messageVersion !== messageVersion)) {
      throw new HttpsError('failed-precondition', 'Cette version ou sa liste de destinataires est déjà figée avec un autre contenu.');
    }
    const frozen = prior ?? { protocol: 'privacy_notice_campaign_v1', incidentId: input.incidentId, campaignId,
      messageVersion, message, recipientIds, payloadHash, actorUid: input.actorUid, createdAt: FieldValue.serverTimestamp() };
    await assertIncidentReader(request, tx);
    if (!prior) tx.create(campaignRef, frozen);
    if (!prior) tx.update(incidentRef, { currentNoticeCampaignId: campaignId });
    if (!command) tx.create(commandRef, { protocol: 'privacy_notice_request_v1', ...input, campaignId,
      payloadHash: commandHash, createdAt: FieldValue.serverTimestamp() });
    return {campaign: frozen};
  });
  if (prepared.controlReceipt) return prepared.controlReceipt;
  if (prepared.opaque) return prepared.opaque;
  const campaign = prepared.campaign!;
  const acknowledgement = () => opaqueIncidentReceipt({protocol: 'privacy_user_notices_v1', ...input, campaignId,
    payloadHash: campaign.payloadHash, requestPayloadHash: commandHash});
  // Every phase rejoins the current case/campaign/command versions and current
  // account authority. A prior command permits its own acknowledgement only.
  const currentContext = async (tx: FirebaseFirestore.Transaction) => {
    await assertIncidentReader(request, tx);
    const incident = (await tx.get(incidentRef)).data(), current = (await tx.get(campaignRef)).data(), command = (await tx.get(commandRef)).data();
    if (!commandQualified(command)) throw new HttpsError('unavailable', 'Le reçu de cette intention doit être retrouvé.');
    if (!incident || incident.currentNoticeCampaignId !== campaignId || !campaignQualified(current, input.incidentId, campaignId) || current?.payloadHash !== campaign.payloadHash ||
        digest(recipients(incident.affectedUserIds)) !== digest(campaign.recipientIds)) {
      throw new HttpsError('failed-precondition', 'Le dossier ou ses destinataires ont changé.');
    }
    return {incident, current: current!};
  };
  try {
    const initial = await db.runTransaction(async tx => {
      await currentContext(tx);
      const receipts = await readOperationalNoticeReceipts(tx, campaign.recipientIds.map((uid: string) => privacyNotice(input.incidentId, campaignId, campaign, uid)));
      await assertIncidentReader(request, tx);
      return receipts;
    });
    const missingUids = campaign.recipientIds.filter((_uid: string, index: number) => !initial[index]).slice(0, 50);
    let failedThisAttempt = 0;
    for (const uid of missingUids) {
      try {
        await db.runTransaction(async tx => {
          await currentContext(tx);
          const notices = await prepareOperationalNotices(tx, [privacyNotice(input.incidentId, campaignId, campaign, uid)]);
          await assertIncidentReader(request, tx);
          notices.commit();
        });
      } catch (error) {
        // Authority/session loss cannot be downgraded to a delivery failure or
        // allow another recipient attempt under a formerly issued claim.
        if (error instanceof HttpsError && (['permission-denied', 'unauthenticated'].includes(error.code) ||
            error.details && (error.details as {reason?: unknown}).reason === 'private_session_unqualified')) throw error;
        failedThisAttempt++;
        logger.error('Privacy in-app notice remains uncommitted', { incidentId: input.incidentId, uid,
          error: error instanceof Error ? error.message : 'unknown' });
      }
    }
    const state = await db.runTransaction(async tx => {
      const {incident, current} = await currentContext(tx);
      const proofs = await readOperationalNoticeReceipts(tx, campaign.recipientIds.map((uid: string) => privacyNotice(input.incidentId, campaignId, campaign, uid)));
      const committed = proofs.filter(Boolean).length, total = campaign.recipientIds.length, complete = committed === total;
      await assertIncidentReader(request, tx);
      if (complete && !(current.completedAt instanceof Timestamp)) {
        tx.update(campaignRef, { completedAt: FieldValue.serverTimestamp() });
        if (incident.currentNoticeCampaignId === campaignId) tx.update(incidentRef, { userNoticeCompletion: { protocol: 'privacy_user_notices_v1', campaignId,
          messageVersion, payloadHash: campaign.payloadHash, total, inAppCommitted: true,
          deviceDeliveryVerified: false, readingVerified: false, completedAt: FieldValue.serverTimestamp() } });
      }
      return { committed, total, complete };
    });
    return { protocol: 'privacy_user_notices_v1', ok: true, ...input, campaignId, messageVersion,
      requestPayloadHash: commandHash, payloadHash: campaign.payloadHash, total: state.total, inAppCommittedCount: state.committed,
      pendingCount: state.total - state.committed, failedThisAttempt, complete: state.complete,
      inAppCommitted: state.complete, resumable: !state.complete, transportQueued: state.committed > 0,
      transportIntentCount: state.committed, deviceDeliveryVerified: false, readingVerified: false };
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'permission-denied') {
      await assertPrivateAccountSession(request);
      return acknowledgement();
    }
    throw error;
  }
}));
