/** Isolated technical servicing for the two exact-scope legal review paths.
 * A current Seconde administrator is not automatically a corporate delegate,
 * a privacy officer, or a legally empowered external recipient. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportUid, supportObject, supportId, supportRequestId, supportHash, supportAdmin} from './supportRequest';
import {assertPrivateAccountSession} from './privateAccountSession';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from './eligibility';
import {privateSupportEvidenceRef, type PrivateSupportEvidenceRef} from './privateSupportCaseEvidence';

export const SUPPORT_LEGAL_REVIEW_CAPABILITY = 'support_legal_review_v2';
export type LegalReviewArea = 'confidential_original'|'authority_request';
export type LegalReviewReference = {id: string; contentHash: string};
export type LegalReviewEnvelope = {uid: string; requestId: string; area: LegalReviewArea;
  mode: 'execute'|'observe'|'neutralize'; descriptor: {caseId: string; action: string; payloadHash: string}; command: any};
const HASH = /^[a-f0-9]{64}$/;
const stamp = (value: any): value is Timestamp => value instanceof Timestamp && value.toMillis() > 0 && value.toMillis() <= Date.now();
const ref = (env: LegalReviewEnvelope) => db.collection('support_legal_review_commands').doc(supportHash([env.area, env.uid, env.requestId]));
export function legalReviewEnvelope(request: any, area: LegalReviewArea, actions: readonly string[]): LegalReviewEnvelope {
  const uid = supportUid(request), data = supportObject(request.data, ['capability', 'area', 'expectedUid', 'mode', 'requestId', 'descriptor', 'command']);
  const descriptor = supportObject(data.descriptor, ['caseId', 'action', 'payloadHash']);
  if (data.capability !== SUPPORT_LEGAL_REVIEW_CAPABILITY || data.area !== area || !['execute', 'observe', 'neutralize'].includes(data.mode) ||
      !actions.includes(descriptor.action) || !HASH.test(descriptor.payloadHash ?? '') ||
      (data.mode === 'execute' ? !data.command || typeof data.command !== 'object' : data.command !== undefined)) {
    throw new HttpsError('invalid-argument', 'Descripteur et mode exacts du parcours V2 requis.');
  }
  const caseId = supportId(descriptor.caseId), requestId = supportRequestId(data.requestId);
  if (data.mode === 'execute' && (data.command.action !== descriptor.action || supportHash(data.command) !== descriptor.payloadHash)) {
    throw new HttpsError('invalid-argument', 'Le corps exact ne correspond pas au journal opaque.');
  }
  return {uid, requestId, area, mode: data.mode, descriptor: {caseId, action: descriptor.action, payloadHash: descriptor.payloadHash}, command: data.command};
}
export async function assertLegalReviewAdmin(tx: FirebaseFirestore.Transaction, request: any) {
  const session = await assertPrivateAccountSession(request, tx), uid = supportUid(request);
  await supportAdmin(tx, uid, session.currentAdminClaim);
  if ((await tx.get(db.collection('users').doc(uid))).data()?.isAdmin !== true) {
    throw new HttpsError('permission-denied', 'Un administrateur Seconde actuellement désigné est requis pour cet examen limité.');
  }
  assertRecentAccountAuthentication(request.auth.token);
  if (request.auth.token.auth_time > Math.floor(Date.now() / 1000)) throw new HttpsError('unauthenticated', 'Connexion administrative actuelle requise.');
  await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);
}
function reference(raw: any): LegalReviewReference|null {
  if (raw === null) return null;
  const value = supportObject(raw, ['id', 'contentHash']);
  if (supportId(value.id) !== value.id || !HASH.test(value.contentHash ?? '')) throw new HttpsError('failed-precondition', 'Référence opaque native inconnue.');
  return {id: value.id, contentHash: value.contentHash};
}
function view(env: LegalReviewEnvelope, raw: any, replayed: boolean) {
  if (raw && (raw.protocol !== 'support_legal_review_command_v2' || raw.area !== env.area || raw.actorId !== env.uid ||
      raw.requestId !== env.requestId || supportHash(raw.descriptor) !== supportHash(env.descriptor))) {
    throw new HttpsError('already-exists', 'Cet identifiant correspond à une autre intention V2.');
  }
  if (raw && (!['committed', 'not_executed'].includes(raw.state) || !stamp(raw.recordedAt) ||
      !['command_neutralized', 'source_changed', 'examinations_unknown', null].includes(raw.reasonCode) ||
      raw.state === 'not_executed' && (raw.reference !== null || raw.evidence !== null) ||
      raw.state === 'committed' && (raw.reasonCode !== null || raw.reference === null))) throw new HttpsError('failed-precondition', 'Reçu historique V2 non qualifié.');
  return {protocol: 'support_legal_review_receipt_v2', area: env.area, actorId: env.uid, requestId: env.requestId,
    ...env.descriptor, state: raw?.state ?? 'unrecorded', committed: raw?.state === 'committed', replayed,
    recordedAt: raw ? raw.recordedAt.toDate().toISOString() : null, reasonCode: raw?.reasonCode ?? null,
    reference: raw ? reference(raw.reference) : null, evidence: raw?.evidence ? privateSupportEvidenceRef(raw.evidence) : null,
    storageOutcome: 'not_asserted', originalRedisclosed: false, legalAuthorityVerified: false, financialEffect: 'none'};
}
export async function legalReviewEarlyReceipt(tx: FirebaseFirestore.Transaction, request: any, env: LegalReviewEnvelope) {
  await assertPrivateAccountSession(request, tx);
  const prior = (await tx.get(ref(env))).data();
  if (prior) return view(env, prior, true);
  if (env.mode === 'observe') return view(env, null, false);
  if (env.mode === 'neutralize') return commitLegalReviewReceipt(tx, env, null, null, 'command_neutralized');
  return null;
}
export function commitLegalReviewReceipt(tx: FirebaseFirestore.Transaction, env: LegalReviewEnvelope,
  result: LegalReviewReference|null, evidence: PrivateSupportEvidenceRef|null = null,
  reasonCode: 'command_neutralized'|'source_changed'|'examinations_unknown'|null = null) {
  const record = {protocol: 'support_legal_review_command_v2', area: env.area, actorId: env.uid, requestId: env.requestId,
    descriptor: env.descriptor, state: reasonCode ? 'not_executed' : 'committed', recordedAt: Timestamp.now(), reasonCode,
    reference: result, evidence};
  tx.create(ref(env), record);
  return view(env, record, false);
}
