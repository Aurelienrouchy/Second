import AsyncStorage from '@/utils/environmentStorage';
import { randomUUID } from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { supportCommandHash } from '@/services/supportRequestService';
import { isProductAuthenticityReportReference } from '@/services/productAuthenticityReportService';
import { productReviewEqual } from '@/services/productReviewService';
import type { ProductAuthenticityReportReference } from '@/types/productAuthenticityReport';
import type { ProductParcelReportReference } from '@/types/productParcelReport';
import { isProductParcelReportReference } from '@/utils/productParcelReportReference';
import type { TransactionProblemAttempt, TransactionProblemObservation, TransactionProblemReason, TransactionProblemReceipt, WholeSetDeclaration, WholeSetReportSource } from '@/types/transactionProblem';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const reference = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const reasons = ['not_received_despite_delivered', 'not_as_described', 'damaged', 'other'];
const locks = new Set<string>();
const key = (uid: string, transactionId: string) => `second:transaction-problem:v1:${JSON.stringify([uid, transactionId])}`;
const unknown = () => new Error('Le signalement doit être relu avec la même référence et le récit d’origine. Aucun nouveau signalement n’est confirmé par une absence de réponse.');
export function isWholeSetDeclaration(v: unknown): v is WholeSetDeclaration {
  if (!object(v) || Object.keys(v).length !== 6 || Object.keys(v).some(k => !['protocol', 'snapshotHash', 'claim', 'received', 'missing', 'recourseScope'].includes(k)) ||
    v.protocol !== 'whole_set_declaration_v1' || typeof v.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(v.snapshotHash) ||
    !['incomplete_set', 'other_nonconformity'].includes(String(v.claim)) || v.recourseScope !== 'whole_transaction') return false;
  const part = (p: unknown, missing: boolean) => object(p) && Object.keys(p).length === 2 && Object.keys(p).every(k => ['status', 'description'].includes(k)) &&
    (p.status === 'described' ? typeof p.description === 'string' && !!p.description.trim() && p.description === p.description.trim() && p.description.length <= 1000 :
      (p.status === 'unknown' || missing && p.status === 'none_observed') && p.description === null);
  return part(v.received, false) && part(v.missing, true) && (v.claim !== 'incomplete_set' || (v.missing as WholeSetDeclaration['missing']).status !== 'none_observed');
}
function validAttempt(v: unknown, uid: string, transactionId: string): v is TransactionProblemAttempt {
  return object(v) && v.version === 1 && v.uid === uid && v.transactionId === transactionId && reference(v.transactionId) &&
    typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId) && reasons.includes(String(v.reason)) &&
    typeof v.details === 'string' && v.details.trim() === v.details && v.details.length <= 1000 &&
    Object.keys(v).every(k => ['version', 'uid', 'transactionId', 'requestId', 'reason', 'details', 'setDeclaration', 'productReview'].includes(k)) &&
    (!Object.prototype.hasOwnProperty.call(v, 'productReview') || (isProductParcelReportReference(v.productReview) ? !Object.prototype.hasOwnProperty.call(v, 'setDeclaration') : ['not_as_described', 'other'].includes(String(v.reason)) && isProductAuthenticityReportReference(v.productReview))) &&
    (!Object.prototype.hasOwnProperty.call(v, 'setDeclaration') || v.reason === 'not_as_described' && isWholeSetDeclaration(v.setDeclaration));
}
const sameDeclaration = (a: WholeSetDeclaration, b: WholeSetDeclaration) => a.snapshotHash === b.snapshotHash && a.claim === b.claim &&
  a.received.status === b.received.status && a.received.description === b.received.description && a.missing.status === b.missing.status && a.missing.description === b.missing.description;
async function local(uid: string, transactionId: string, assertContext: () => void): Promise<TransactionProblemAttempt | null> {
  const session = captureTradeSession(uid); assertContext(); if (!reference(transactionId)) throw unknown();
  const raw = await AsyncStorage.getItem(key(uid, transactionId)); assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return null; const value: unknown = JSON.parse(raw);
  if (!validAttempt(value, uid, transactionId)) throw unknown(); return value;
}
async function rpc(attempt: TransactionProblemAttempt, mode: 'execute' | 'observe' | 'neutralize', assertContext: () => void): Promise<TransactionProblemReceipt> {
  const session = captureTradeSession(attempt.uid); assertContext();
  if (!validAttempt(attempt, session.uid, attempt.transactionId)) throw unknown();
  if (mode === 'neutralize' && !attempt.productReview) throw unknown();
  const payloadHash = await supportCommandHash({reason: attempt.reason, details: attempt.details || null, ...(attempt.setDeclaration ? {setDeclaration: attempt.setDeclaration} : {}), ...(attempt.productReview ? {productReview: attempt.productReview} : {})});
  assertTradeSessionCurrent(session); assertContext();
  const result = await httpsCallable<unknown, unknown>(functions, 'reportTransactionProblem')({expectedUid: attempt.uid,
    transactionId: attempt.transactionId, requestId: attempt.requestId, reason: attempt.reason, ...(attempt.details ? {details: attempt.details} : {}),
    ...(attempt.setDeclaration ? {setDeclaration: attempt.setDeclaration} : {}),
    ...(attempt.productReview ? {capability: attempt.productReview.topic === 'parcel_delivery' ? 'product_parcel_report_v1' : attempt.productReview.topic === 'nonconformity' ? 'product_material_report_v1' : 'product_authenticity_report_v1', productReview: attempt.productReview,
      ...('materialCapability' in attempt.productReview && attempt.productReview.materialCapability ? {materialCapability: attempt.productReview.materialCapability} : {}),
      ...('parcelCapability' in attempt.productReview && attempt.productReview.parcelCapability ? {parcelCapability: attempt.productReview.parcelCapability} : {}), ...(mode !== 'observe' ? {accepted: true} : {})} : {}), mode});
  assertTradeSessionCurrent(session); assertContext(); const v = result.data;
  const parcel = attempt.productReview?.topic === 'parcel_delivery';
  if (!object(v) || v.protocol !== (parcel ? 'transaction_parcel_report_v1' : 'transaction_problem_report_v1') || v.ownerId !== attempt.uid || v.transactionId !== attempt.transactionId ||
    v.requestId !== attempt.requestId || v.payloadHash !== payloadHash || !['committed', 'not_executed', 'unrecorded'].includes(String(v.state)) ||
    v.committed !== (v.state === 'committed') || (parcel ? !['unknown', 'buyer_delivery', 'seller_return_parcel', 'parcel_investigation'].includes(String(v.recourseScope)) ||
      v.freezeCommitted !== (v.state === 'committed' && (v.recourseScope === 'parcel_investigation' || attempt.productReview!.topic === 'parcel_delivery' && attempt.productReview!.actorRole === 'buyer' && attempt.productReview!.leg === 'forward')) ||
      (v.state !== 'committed' ? v.recourseScope !== 'unknown' : v.recourseScope === 'unknown' || v.recourseScope === 'buyer_delivery' && (attempt.productReview!.topic !== 'parcel_delivery' || attempt.productReview!.actorRole !== 'buyer' || attempt.productReview!.leg !== 'forward') ||
        v.recourseScope === 'seller_return_parcel' && (attempt.productReview!.topic !== 'parcel_delivery' || attempt.productReview!.actorRole !== 'seller' || attempt.productReview!.leg !== 'return')) : v.freezeCommitted !== v.committed) || typeof v.replay !== 'boolean' ||
    v.admissionVerified !== false || v.financialEffect !== 'none' || v.externalRecourseDeadlineExtended !== false ||
    (attempt.setDeclaration ? !isWholeSetDeclaration(v.setDeclaration) || !sameDeclaration(v.setDeclaration, attempt.setDeclaration) : Object.prototype.hasOwnProperty.call(v, 'setDeclaration')) ||
    (attempt.productReview ? !(parcel ? isProductParcelReportReference(v.productReview) : isProductAuthenticityReportReference(v.productReview)) || !productReviewEqual(v.productReview, attempt.productReview) : Object.prototype.hasOwnProperty.call(v, 'productReview'))) throw unknown();
  if (v.state === 'committed') {
    const expectedDisputeId = `problem_${await supportCommandHash([attempt.uid, attempt.transactionId, attempt.requestId])}`;
    assertTradeSessionCurrent(session); assertContext();
    if (v.disputeId !== expectedDisputeId || v.reason !== null) throw unknown();
  } else if (v.disputeId !== null || (v.state === 'not_executed' ?
    !(parcel ? ['requester_neutralized', 'product_parcel_review_not_exposed', 'native_party_changed', 'product_review_source_changed', 'parcel_source_unqualified', 'native_payment_or_hold_requires_review', 'recourse_window_unqualified_or_closed', 'return_receipt_requires_review', 'claim_without_receipt_requires_review', 'parcel_claim_already_recorded', 'parcel_claim_deduplication_requires_review', 'new_parcel_claim_quota_requires_review', 'new_parcel_claim_quota_exhausted'] :
      ['outside_commercial_window', 'existing_commercial_dispute', 'already_refunded', 'set_content_declaration_required', 'set_contract_source_unqualified', 'set_contract_source_changed', ...(attempt.productReview ? ['requester_neutralized', 'product_review_source_changed', 'commercial_clock_unqualified', ...('materialCapability' in attempt.productReview && attempt.productReview.materialCapability ? ['product_material_review_not_exposed'] : []), ...('parcelCapability' in attempt.productReview && attempt.productReview.parcelCapability ? ['product_parcel_review_not_exposed'] : [])] : [])]).includes(String(v.reason)) : v.reason !== null)) throw unknown();
  if (v.state === 'unrecorded' ? v.reportedAt !== null || v.replay !== false :
    typeof v.reportedAt !== 'string' || !Number.isFinite(Date.parse(v.reportedAt)) || new Date(v.reportedAt).toISOString() !== v.reportedAt) throw unknown();
  return v as unknown as TransactionProblemReceipt;
}
export const TransactionProblemJournal = {
  async wholeSetSource(transactionId: string, uid: string, assertContext: () => void): Promise<WholeSetReportSource> {
    const session = captureTradeSession(uid); assertContext(); if (!reference(transactionId)) throw unknown();
    const result = await httpsCallable<unknown, unknown>(functions, 'reportTransactionProblem')({mode: 'source_observe', capability: 'whole_set_report_v1', expectedUid: uid, transactionId});
    assertTradeSessionCurrent(session); assertContext(); const v = result.data;
    if (!object(v) || Object.keys(v).length !== 9 || Object.keys(v).some(k => !['protocol', 'ownerId', 'transactionId', 'qualification', 'source', 'physicalReceiptVerified', 'faultEstablished', 'financialEffect', 'recourseScope'].includes(k)) ||
      v.protocol !== 'whole_set_report_source_v1' || v.ownerId !== uid || v.transactionId !== transactionId || v.physicalReceiptVerified !== false ||
      v.faultEstablished !== false || v.financialEffect !== 'none' || v.recourseScope !== 'whole_transaction') throw unknown();
    const s = v.source;
    if (v.qualification === 'native_whole_set_snapshot' ? !object(s) || Object.keys(s).length !== 5 || Object.keys(s).some(k => !['snapshotHash', 'articleId', 'saleUnit', 'title', 'description'].includes(k)) ||
      typeof s.snapshotHash !== 'string' || !/^[a-f0-9]{64}$/.test(s.snapshotHash) || !reference(s.articleId) || s.saleUnit !== 'set_as_one' ||
      !['title', 'description'].every(k => typeof s[k] === 'string' && !!s[k].trim() && s[k].length <= (k === 'title' ? 500 : 8000)) :
      !['not_a_set', 'historical_unit_unrecorded', 'unknown'].includes(String(v.qualification)) || s !== null) throw unknown();
    return v as unknown as WholeSetReportSource;
  },
  async read(transactionId: string, uid: string, assertContext: () => void): Promise<TransactionProblemObservation> {
    const attempt = await local(uid, transactionId, assertContext);
    return {attempt, receipt: attempt ? await rpc(attempt, 'observe', assertContext) : null};
  },
  async submit(transactionId: string, reason: TransactionProblemReason, details: string, uid: string, assertContext: () => void, setDeclaration?: WholeSetDeclaration, productReview?: ProductAuthenticityReportReference | ProductParcelReportReference): Promise<TransactionProblemReceipt> {
    const session = captureTradeSession(uid), slot = key(uid, transactionId); assertContext();
    if (locks.has(slot)) throw unknown(); locks.add(slot);
    try {
      const prior = await local(uid, transactionId, assertContext);
      if (prior) throw unknown();
      const attempt: TransactionProblemAttempt = {version: 1, uid, transactionId, requestId: randomUUID(), reason, details: details.trim(), ...(setDeclaration ? {setDeclaration} : {}), ...(productReview ? {productReview} : {})};
      if (!validAttempt(attempt, uid, transactionId)) throw new Error('Le récit doit contenir au maximum 1 000 caractères.');
      assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.setItem(slot, JSON.stringify(attempt));
      assertTradeSessionCurrent(session); assertContext(); await rpc(attempt, 'execute', assertContext);
      return rpc(attempt, 'observe', assertContext);
    } finally {locks.delete(slot);}
  },
  async acknowledge(transactionId: string, uid: string, assertContext: () => void): Promise<TransactionProblemReceipt> {
    const session = captureTradeSession(uid), slot = key(uid, transactionId); assertContext();
    if (locks.has(slot)) throw unknown(); locks.add(slot);
    try {
      const attempt = await local(uid, transactionId, assertContext); if (!attempt) throw unknown();
      const receipt = await rpc(attempt, 'observe', assertContext); if (receipt.state === 'unrecorded') throw unknown();
      const current = await local(uid, transactionId, assertContext);
      if (JSON.stringify(current) !== JSON.stringify(attempt)) throw unknown();
      assertTradeSessionCurrent(session); assertContext(); await AsyncStorage.removeItem(slot);
      assertTradeSessionCurrent(session); assertContext(); return receipt;
    } finally {locks.delete(slot);}
  },
  async resume(transactionId: string, uid: string, assertContext: () => void): Promise<TransactionProblemReceipt> {
    const session = captureTradeSession(uid), slot = key(uid, transactionId); assertContext();
    if (locks.has(slot)) throw unknown(); locks.add(slot);
    try {
      const attempt = await local(uid, transactionId, assertContext); if (!attempt) throw unknown();
      assertTradeSessionCurrent(session); assertContext();
      await rpc(attempt, 'execute', assertContext);
      return rpc(attempt, 'observe', assertContext);
    } finally {locks.delete(slot);}
  },
  async neutralize(transactionId: string, uid: string, assertContext: () => void): Promise<TransactionProblemReceipt> {
    const session = captureTradeSession(uid), slot = key(uid, transactionId); assertContext();
    if (locks.has(slot)) throw unknown(); locks.add(slot);
    try {
      const attempt = await local(uid, transactionId, assertContext); if (!attempt?.productReview) throw unknown();
      assertTradeSessionCurrent(session); assertContext(); await rpc(attempt, 'neutralize', assertContext);
      return rpc(attempt, 'observe', assertContext);
    } finally {locks.delete(slot);}
  },
};
