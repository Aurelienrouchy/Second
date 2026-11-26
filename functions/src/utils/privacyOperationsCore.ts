/** Narrow private servicing for written access/correction cases. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportUid, supportObject, supportId, supportRequestId, supportHash, supportSourceHash, supportRevision,
  supportVersion, supportAccountUid} from './supportRequest';
import {assertPrivateAccountSession} from './privateAccountSession';
import {assertLegalReviewAdmin} from './supportLegalReviewV2';

export const SUPPORT_PRIVACY_OPERATIONS_CAPABILITY = 'support_privacy_operations_v2';
export const PRIVACY_OPERATION_ACTIONS = ['capture_prepare', 'capture_advance', 'release_copy', 'correct_profile',
  'disposition_authorize', 'disposition_execute', 'disposition_reconcile', 'disposition_scope_prepare', 'disposition_scope_advance'] as const;
export type PrivacyEnvelope = {uid: string; requestId: string; mode: string;
  descriptor: {caseId: string; action: string; payloadHash: string}; command: any};
export type PrivacyContext = Awaited<ReturnType<typeof readPrivacyOperationCase>>;
export const privacyHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function privacyReference(raw: unknown) {
  const value = supportObject(raw, ['id', 'contentHash']);
  if (!privacyHash(value.contentHash)) throw new HttpsError('invalid-argument', 'Référence native privée requise.');
  return {id: supportId(value.id), contentHash: value.contentHash as string};
}
export function privacyEnvelope(request: any): PrivacyEnvelope {
  const uid = supportUid(request), data = supportObject(request.data, ['capability', 'expectedUid', 'mode', 'requestId', 'descriptor', 'command']);
  const descriptor = supportObject(data.descriptor, ['caseId', 'action', 'payloadHash']);
  if (data.capability !== SUPPORT_PRIVACY_OPERATIONS_CAPABILITY || !['execute', 'observe', 'neutralize'].includes(data.mode) ||
      !(PRIVACY_OPERATION_ACTIONS as readonly unknown[]).includes(descriptor.action) || !privacyHash(descriptor.payloadHash) ||
      (data.mode === 'execute' ? !data.command || data.command.action !== descriptor.action || supportHash(data.command) !== descriptor.payloadHash : data.command !== undefined)) {
    throw new HttpsError('invalid-argument', 'Intention exacte de confidentialité et journal opaque requis.');
  }
  return {uid, requestId: supportRequestId(data.requestId), mode: data.mode,
    descriptor: {caseId: supportId(descriptor.caseId), action: descriptor.action, payloadHash: descriptor.payloadHash}, command: data.command};
}
export const privacyCaseRef = (caseId: string) => db.collection('support_requests').doc(caseId);
const commandRef = (env: PrivacyEnvelope) => privacyCaseRef(env.descriptor.caseId).collection('privacy_commands').doc(supportHash([env.uid, env.requestId]));
function receipt(env: PrivacyEnvelope, value: any, replayed: boolean) {
  if (value && (value.protocol !== 'support_privacy_command_v2' || value.actorId !== env.uid || value.requestId !== env.requestId ||
      supportHash(value.descriptor) !== supportHash(env.descriptor) || !(value.recordedAt instanceof Timestamp) ||
      value.recordedAt.toMillis() <= 0 || value.recordedAt.toMillis() > Date.now() || !['committed', 'not_executed'].includes(value.state))) {
    throw new HttpsError('already-exists', 'Cet identifiant appartient à une autre intention privée.');
  }
  return {protocol: 'support_privacy_operation_receipt_v2', actorId: env.uid, requestId: env.requestId, ...env.descriptor,
    state: value?.state ?? 'unrecorded', committed: value?.state === 'committed', replayed,
    recordedAt: value ? value.recordedAt.toDate().toISOString() : null, reasonCode: value?.reasonCode ?? null,
    reference: value?.reference ? privacyReference(value.reference) : null, effectVerified: false,
    externalOutcomeNotAsserted: true, legalCompletionVerified: false};
}
export async function earlyPrivacyReceipt(tx: FirebaseFirestore.Transaction, request: any, env: PrivacyEnvelope) {
  await assertPrivateAccountSession(request, tx);
  const prior = (await tx.get(commandRef(env))).data();
  if (prior) return receipt(env, prior, true);
  if (env.mode === 'observe') return receipt(env, null, false);
  if (env.mode === 'neutralize') return commitPrivacyReceipt(tx, env, null, 'command_neutralized');
  return null;
}
export function commitPrivacyReceipt(tx: FirebaseFirestore.Transaction, env: PrivacyEnvelope,
  reference: {id: string; contentHash: string}|null, reasonCode: string|null = null) {
  const value = {protocol: 'support_privacy_command_v2', actorId: env.uid, requestId: env.requestId,
    descriptor: env.descriptor, state: reasonCode ? 'not_executed' : 'committed', reasonCode, reference, recordedAt: Timestamp.now()};
  tx.create(commandRef(env), value);
  return receipt(env, value, false);
}
export async function readPrivacyOperationCase(tx: FirebaseFirestore.Transaction, request: any, caseId: string) {
  await assertLegalReviewAdmin(tx, request);
  const snapshot = await tx.get(privacyCaseRef(caseId)), ticket = snapshot.data();
  if (!ticket || ticket.schemaVersion !== 1 || !['personal_data_access', 'personal_data_correction'].includes(ticket.kind)) {
    throw new HttpsError('failed-precondition', 'Une demande écrite native d’accès ou de rectification est requise.');
  }
  const ownerId = supportAccountUid(ticket.ownerId);
  return {caseId, ownerId, ticket, snapshot, version: supportVersion(ticket), revision: supportRevision(snapshot),
    sourceHash: supportSourceHash(ticket)};
}
export function privacyJson(value: any, depth = 0): any {
  if (depth > 20) throw new HttpsError('failed-precondition', 'Valeur privée trop imbriquée.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (Array.isArray(value)) return value.map(v => privacyJson(v, depth + 1));
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, privacyJson(v, depth + 1)]));
  }
  throw new HttpsError('failed-precondition', 'Valeur privée non exportable sans examen.');
}
