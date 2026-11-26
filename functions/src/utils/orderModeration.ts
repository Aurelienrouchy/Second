import { createHash } from 'node:crypto';
import { db, FieldValue } from '../config/firebase';
import { hasActiveBankDispute } from './bankDispute';
import { hasUnsettledRefund } from './refundState';
import { Timestamp } from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import { returnToSenderBlocksProgress } from '../shared/returnToSenderGuard';
import { deliveryCorrectionWindowMatches } from './purchasePolicy';
import { trackingProofMatches } from '../config/shipEngine';
import { productPhysicalAllowsLeg } from './productPhysicalInstruction';
import {supportHash, supportObject, supportSourceHash} from './supportRequest';
import type {EvidenceReference} from './productReviewWorkflow';

export const ORDER_CONTINUATION_CAPABILITY = 'order_moderation_continuation_v1';
export const ORDER_CONTINUATION_LIMITS = {humanCompetenceVerified: false, expertiseVerified: false, legalAuthorityVerified: false} as const;
const continuationHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export type OrderContinuationProof = {protocol: 'order_moderation_continuation_proof_v1'; sourceHash: string; stableOrderHash: string;
  caseId: string; caseVersion: number; caseSourceHash: string; corpusHash: string; technicalQualificationOnly: true};
export function parseOrderContinuationProof(raw: unknown): OrderContinuationProof {
  const p = supportObject(raw, ['protocol', 'sourceHash', 'stableOrderHash', 'caseId', 'caseVersion', 'caseSourceHash', 'corpusHash', 'technicalQualificationOnly']);
  if (p.protocol !== 'order_moderation_continuation_proof_v1' || p.technicalQualificationOnly !== true ||
      ![p.sourceHash, p.stableOrderHash, p.caseSourceHash, p.corpusHash].every(continuationHash) ||
      !/^pr_[a-f0-9]{64}$/.test(p.caseId ?? '') || !Number.isSafeInteger(p.caseVersion) || p.caseVersion < 1)
    throw new HttpsError('invalid-argument', 'Référence native versionnée du corpus requise.');
  return p as OrderContinuationProof;
}
/** Reuses P's actual receipt/generation/contribution qualification. The scope
 * excludes only this command's own order mirror/revision and its notices, so
 * writing an instruction cannot invalidate itself. P's published hashes and
 * source captures remain unchanged. */
export async function readOrderContinuationSource(tx: FirebaseFirestore.Transaction, transactionId: string, suppliedOrder?: FirebaseFirestore.DocumentData) {
  const {readProductReviewDocumentarySet} = await import('./productReviewWorkflow');
  const snap = await tx.get(db.collection('transactions').doc(transactionId)), order = snap.data();
  if (!order || suppliedOrder && supportSourceHash(order) !== supportSourceHash(suppliedOrder)) throw new HttpsError('failed-precondition', 'Commande native à rapprocher.');
  const set = await readProductReviewDocumentarySet(tx, {kind: 'order', id: transactionId});
  const stableOrderHash = supportSourceHash({protocol: 'order_moderation_contract_scope_v1', transactionId,
    fields: Object.fromEntries(['articleId', 'buyerId', 'sellerId', 'articleSnapshot', 'shippingSnapshot', 'shippingAddress',
      'deliveryType', 'currency', 'amount', 'totalAmount', 'sellerPayout', 'createdAt', 'paidAt', 'paidVia',
      'stripePaymentIntentId', 'walletAmountUsed', 'capturedCardCents'].map(key => [key, order[key] ?? null]))});
  const document = {...set.source.document, protocol: 'order_moderation_documentary_source_v1', upstreamProtocol: set.source.document.protocol,
    contextSource: {present: true, revision: null, sourceHash: stableOrderHash}};
  const manifest = {...set.manifest, protocol: 'order_moderation_documentary_manifest_v1', upstreamProtocol: set.manifest.protocol,
    sourceHash: supportSourceHash(document)};
  const proof: OrderContinuationProof = {protocol: 'order_moderation_continuation_proof_v1',
    sourceHash: supportSourceHash({scope: ORDER_CONTINUATION_CAPABILITY, document, manifest}), stableOrderHash,
    caseId: set.source.caseId, caseVersion: Number.isSafeInteger(set.root?.version) ? set.root!.version : 0,
    caseSourceHash: supportSourceHash(set.root ?? null), corpusHash: supportSourceHash(manifest), technicalQualificationOnly: true};
  const evidenceReferences = set.evidenceRows.flatMap(row => row.reference?.state === 'received' ? [row.reference] : []);
  const nativeContext = set.source.document.articleId === order.articleId && set.source.document.nativeActors.buyerId === order.buyerId &&
    set.source.document.nativeActors.sellerId === order.sellerId && set.source.document.sources.contractSnapshot.qualification === 'native_order_snapshot_recorded';
  return {proof, document, manifest, evidenceReferences, complete: nativeContext && set.documentaryComplete && proof.caseVersion > 0 && evidenceReferences.length > 0,
    coverage: {...set.coverage, ...set.documentaryCoverage}};
}
export function orderContinuationSelectionMatches(selected: EvidenceReference[], available: EvidenceReference[]): boolean {
  return selected.length > 0 && selected.length <= 100 && new Set(selected.map(ref => ref.id)).size === selected.length &&
    selected.every(ref => ref.state === 'received' && available.some(native => native.id === ref.id && supportHash(native) === supportHash(ref)));
}
/** Historical capture qualification needs no current role/source. It grants
 * no present permission; the NEW-effect reader additionally re-reads P. */
export function orderContinuationCaptureMatches(capture: any, proof: unknown, selected: unknown): boolean {
  try {
    return capture?.protocol === 'order_moderation_continuation_capture_v1' &&
      supportHash(parseOrderContinuationProof(capture.proof)) === supportHash(proof) &&
      capture.manifest?.documentaryComplete === true && capture.proof.corpusHash === supportSourceHash(capture.manifest) &&
      capture.proof.sourceHash === supportSourceHash({scope: ORDER_CONTINUATION_CAPABILITY, document: capture.document, manifest: capture.manifest}) &&
      Array.isArray(capture.selectedEvidenceReferences) && Array.isArray(selected) &&
      supportHash(capture.selectedEvidenceReferences) === supportHash(selected) &&
      Object.entries(ORDER_CONTINUATION_LIMITS).every(([key, value]) => capture[key] === value);
  } catch {return false;}
}
/** The private instruction receipt, not a client-writable/mirrored message,
 * binds the exact documentary scope re-read before every NEW progression. */
async function currentOrderContinuation(tx: FirebaseFirestore.Transaction, order: FirebaseFirestore.DocumentData, instruction: any): Promise<boolean> {
  const pointer = instruction.continuation;
  if (pointer?.capability !== ORDER_CONTINUATION_CAPABILITY || !id(pointer.transactionId) || !continuationHash(pointer.receiptHash)) return false;
  const receipt = (await tx.get(db.collection('article_moderation').doc(instruction.articleId).collection('decisions').doc(instruction.decisionId)
    .collection('orders').doc(pointer.transactionId).collection('instructions').doc(instruction.id))).data();
  if (receipt?.protocol !== 'order_moderation_continuation_instruction_v1' || receipt.state !== 'committed' ||
      receipt.action !== 'continue' || receipt.transactionId !== pointer.transactionId || receipt.articleId !== order.articleId ||
      receipt.buyerId !== order.buyerId || receipt.sellerId !== order.sellerId || receipt.id !== instruction.id ||
      receipt.decisionId !== instruction.decisionId || receipt.message !== instruction.message ||
      !(receipt.decidedAt instanceof Timestamp) || !(instruction.decidedAt instanceof Timestamp) || !receipt.decidedAt.isEqual(instruction.decidedAt) ||
      receipt.decidedAt.toMillis() > Date.now() || !id(receipt.decidedBy) || !id(receipt.requestId) ||
      receipt.id !== digest([receipt.decidedBy, receipt.transactionId, receipt.requestId]) ||
      receipt.inputHash !== supportHash([receipt.decidedBy, receipt.transactionId, receipt.requestId, receipt.command]) ||
      pointer.receiptHash !== supportSourceHash(receipt) || receipt.command?.action !== 'continue' ||
      receipt.command?.capability !== ORDER_CONTINUATION_CAPABILITY || !Array.isArray(receipt.command.evidenceReferences) ||
      receipt.command.expectedArticleDecisionId !== receipt.decisionId || receipt.command.expectedOrderRevision !== receipt.observedOrderRevision ||
      receipt.command.message !== receipt.message || receipt.command.authorityNote !== receipt.authorityNote ||
      supportHash(receipt.command.evidenceReferences) !== supportHash(receipt.evidenceReferences) ||
      !(receipt.recordedAt instanceof Timestamp) || !receipt.recordedAt.isEqual(receipt.decidedAt)) return false;
  const authority = receipt.operatorAuthority;
  if (authority?.protocol !== 'current_order_moderation_operator_v1' || authority.actorId !== receipt.decidedBy ||
      authority.authorityQualifiedAtCommit !== true || !Number.isSafeInteger(authority.authTime) || authority.authTime < 1 ||
      receipt.decidedAt.toMillis() - authority.authTime * 1000 > 300_000 || authority.authTime * 1000 - receipt.decidedAt.toMillis() > 60_000 ||
      typeof authority.nativeAdminClaimObserved !== 'boolean' ||
      !(authority.privateRoleRevision === null || continuationHash(authority.privateRoleRevision)) || !continuationHash(authority.privateRoleSourceHash)) return false;
  const capture = receipt.continuationCapture;
  if (!orderContinuationCaptureMatches(capture, receipt.command.continuationProof, receipt.command.evidenceReferences)) return false;
  const current = await readOrderContinuationSource(tx, pointer.transactionId, order);
  return current.complete && supportHash(current.proof) === supportHash(capture.proof) &&
    orderContinuationSelectionMatches(capture.selectedEvidenceReferences, current.evidenceReferences);
}

/** A later DE is an observation, never an operator receipt resolving a hold.
 * The window validator is pure; no progress guard runs during module loading. */
export function deliveryCorrectionBlocksProgress(order: FirebaseFirestore.DocumentData): boolean {
  const correction = order.deliveryCorrection;
  if (!Object.prototype.hasOwnProperty.call(order, 'deliveryCorrection')) return false;
  if (!correction || typeof correction !== 'object') return true;
  const resolution = correction.resolution, proof = resolution?.providerProof, current = order.trackingObservation;
  const witness = resolution?.nativeReviewResolution;
  const sameBusinessObservation = witness?.protocol === 'transport_review_resolution_v1' && /^case_[a-f0-9]{64}$/.test(witness.reviewId ?? '') &&
    Number.isSafeInteger(witness.reviewVersion) && witness.reviewVersion > 0 && witness.source?.reviewId === witness.reviewId &&
    /^[a-f0-9]{64}$/.test(witness.source?.reviewHash ?? '') && /^[a-f0-9]{64}$/.test(witness.source?.sourceHash ?? '') &&
    /^[a-f0-9]{64}$/.test(witness.source?.financialSourceHash ?? '') &&
    trackingProofMatches(correction.transactionId, order, current, 'forward') && current.statusCode === 'DE' &&
    current.sourceHash === proof?.sourceHash && current.providerEventAtMs === proof?.providerEventAtMs &&
    current.providerLabelCreatedAtMs === proof?.providerLabelCreatedAtMs && current.observedContentHash === proof?.observedContentHash &&
    current.providerEventTimeSource === proof?.providerEventTimeSource && current.providerRevision === proof?.providerRevision;
  return !(correction.schemaVersion === 1 && typeof correction.correctionId === 'string' && /^[a-f0-9]{64}$/.test(correction.correctionId) &&
    typeof correction.transactionId === 'string' && !!correction.transactionId && !correction.transactionId.includes('/') &&
    correction.detectedAt instanceof Timestamp && correction.originalDeliveryAt instanceof Timestamp &&
    correction.buyerId === order.buyerId && correction.sellerId === order.sellerId && correction.state === 'resolved' &&
    resolution?.schemaVersion === 1 && resolution.source === 'operator_delivery_review' &&
    resolution.correctionId === correction.correctionId && resolution.transactionId === correction.transactionId &&
    resolution.buyerId === order.buyerId && resolution.sellerId === order.sellerId &&
    typeof resolution.operatorUid === 'string' && !!resolution.operatorUid && !resolution.operatorUid.includes('/') &&
    resolution.decidedAt instanceof Timestamp && resolution.decidedAt.toMillis() >= correction.detectedAt.toMillis() &&
    resolution.decidedAt.toMillis() <= Date.now() && typeof resolution.reason === 'string' && !!resolution.reason.trim() &&
    ['continue_held_release', 'retain_released_history'].includes(resolution.action) &&
    (order.fundsReleasedAt ? resolution.action === 'retain_released_history' : resolution.action === 'continue_held_release') &&
    proof?.schemaVersion === 1 && proof.provider === 'shipengine' && proof.transactionId === correction.transactionId && proof.leg === 'forward' &&
    proof.labelId === order.shipEngineLabelId && proof.trackingNumber === order.trackingNumber && proof.carrierCode === order.carrierCode &&
    proof.statusCode === 'DE' && Number.isSafeInteger(proof.providerEventAtMs) && proof.providerEventAtMs >= proof.providerLabelCreatedAtMs &&
    Number.isSafeInteger(proof.providerLabelCreatedAtMs) && ['actual_delivery_date', 'normalized_event'].includes(proof.providerEventTimeSource) &&
    proof.providerRevision === null && typeof proof.observedContentHash === 'string' && /^[a-f0-9]{64}$/.test(proof.observedContentHash) &&
    typeof proof.readId === 'string' && !!proof.readId && Number.isSafeInteger(proof.readVersion) && proof.readVersion > 0 &&
    Number.isSafeInteger(proof.requestedAtMs) && Number.isSafeInteger(proof.observedAtMs) &&
    proof.requestedAtMs >= correction.detectedAt.toMillis() && proof.observedAtMs >= proof.requestedAtMs &&
    proof.observedAtMs <= resolution.decidedAt.toMillis() &&
    proof.providerEventAtMs <= resolution.decidedAt.toMillis() &&
    (order.fundsReleasedAt || resolution.fundsReleaseAt instanceof Timestamp && order.fundsReleaseAt instanceof Timestamp &&
      resolution.fundsReleaseAt.isEqual(order.fundsReleaseAt)) &&
    (order.fundsReleasedAt || resolution.effectiveDeliveryWindow != null
      ? order.fundsReleasedAt || deliveryCorrectionWindowMatches(order, correction.transactionId, sameBusinessObservation ? current : proof, resolution.effectiveDeliveryWindow)
      : proof.providerEventAtMs <= correction.originalDeliveryAt.toMillis()) &&
    current?.schemaVersion === 1 && current.provider === 'shipengine' && current.transactionId === correction.transactionId &&
    (sameBusinessObservation || current.readId === proof.readId && current.readVersion === proof.readVersion) &&
    current.recordedAt instanceof Timestamp && current.sourceHash === proof.sourceHash && current.labelId === proof.labelId &&
    current.statusCode === 'DE' && current.providerEventAtMs === proof.providerEventAtMs && current.observedContentHash === proof.observedContentHash);
}

export type OrderModerationState = {
  articleId: string; decisionId: string | null; sourceQualified: boolean;
  action: 'pause' | 'continue'; message: string; instructionId: string | null;
  decidedAt: string | null; otherBlockers: string[];
};
const HOLD_MESSAGE = 'Cette commande nécessite un examen par notre équipe. N’expédiez pas l’article avant une instruction explicite. Les reçus, le suivi et les recours restent accessibles.';
const id = (value: unknown): value is string => typeof value === 'string' && !!value && !value.includes('/') && Buffer.byteLength(value, 'utf8') <= 1500;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = (value: any) => typeof value?.toDate === 'function' ? value.toDate().toISOString() : null;

/** An inactive/sold listing, or an allegation alone, never pauses an order.
 * Only the private operator decision is authoritative. The article read binds
 * its provenance and serializes a new restriction with the fulfillment commit. */
export async function readOrderModeration(
  tx: FirebaseFirestore.Transaction, order: FirebaseFirestore.DocumentData,
): Promise<OrderModerationState | null> {
  if (!id(order.articleId)) return null;
  const [articleSnap, decisionSnap] = await tx.getAll(db.collection('articles').doc(order.articleId),
    db.collection('article_moderation').doc(order.articleId));
  const article = articleSnap.data(), decision = decisionSnap.data();
  const operator = decision?.source === 'operator_report_review' || article?.moderationSource === 'operator_report_review' ||
    order.moderationInstruction != null;
  if (!operator) return null;
  const favorable = !!decision && decision.schemaVersion === 1 && decision.protocol === 'article_moderation_favorable_v1' &&
    decision.outcome === 'approved' && decision.action === 'approve' && decision.source === 'operator_report_review' &&
    decision.articleId === order.articleId && decision.ownerId === order.sellerId && article?.sellerId === order.sellerId &&
    decision.decidedAt instanceof Timestamp && typeof decision.actorUid === 'string' && !!decision.actorUid &&
    typeof decision.decisionId === 'string' && /^[a-f0-9]{64}$/.test(decision.decisionId) &&
    typeof decision.orderRestrictionDecisionId === 'string' && /^[a-f0-9]{64}$/.test(decision.orderRestrictionDecisionId) &&
    Array.isArray(decision.remainingRestrictionDecisionIds) && article?.moderationStatus === decision.moderationStatus &&
    article?.moderationSource === decision.source;
  const preserved = favorable ? (await tx.get(db.collection('article_moderation').doc(order.articleId)
    .collection('decisions').doc(decision.orderRestrictionDecisionId))).data() : null;
  const preservedQualified = favorable && preserved?.schemaVersion === 1 && preserved.source === 'operator_report_review' &&
    preserved.articleId === order.articleId && preserved.ownerId === order.sellerId && preserved.decisionId === decision.orderRestrictionDecisionId &&
    ['hold', 'reject'].includes(preserved.action) && preserved.moderationStatus === (preserved.action === 'hold' ? 'pending' : 'rejected') &&
    preserved.decidedAt instanceof Timestamp && preserved.legacyPointerPreserved !== true;
  const restrictiveQualified = !!decision && decision.schemaVersion === 1 && decision.articleId === order.articleId &&
    decision.ownerId === order.sellerId && article?.sellerId === order.sellerId &&
    decision.source === 'operator_report_review' && ['hold', 'reject'].includes(decision.action) &&
    typeof decision.decisionId === 'string' && /^[a-f0-9]{64}$/.test(decision.decisionId) &&
    decision.moderationStatus === (decision.action === 'hold' ? 'pending' : 'rejected') &&
    article?.moderationStatus === decision.moderationStatus && article?.moderationSource === decision.source;
  const qualified = restrictiveQualified || !!preservedQualified;
  const orderDecisionId = preservedQualified ? decision.orderRestrictionDecisionId : restrictiveQualified ? decision.decisionId : null;
  const instruction = order.moderationInstruction;
  let current = qualified && instruction?.schemaVersion === 1 && instruction.articleId === order.articleId &&
    instruction.decisionId === orderDecisionId && instruction.buyerId === order.buyerId &&
    instruction.sellerId === order.sellerId && typeof instruction.id === 'string' && /^[a-f0-9]{64}$/.test(instruction.id) &&
    ['pause', 'continue'].includes(instruction.action) && typeof instruction.message === 'string' && !!instruction.message &&
    !!instruction.decidedAt;
  if (current && instruction.action === 'continue') {
    // Legacy continuation receipts remain historical, but their free-form
    // references never qualify the NEW evidence-bound continuation rule.
    try {current = await currentOrderContinuation(tx, order, instruction);} catch {current = false;}
  }
  // A continuation only lifts THIS decision's pause. It grants no financial,
  // refund, dispute or closure exemption and never reactivates the listing.
  const otherBlockers: string[] = [];
  if (favorable && (decision.remainingRestrictionDecisionIds.length > 0 || decision.availabilityBlockers?.includes('restriction_history_unqualified')))
    otherBlockers.push('other_article_restrictions');
  if (hasActiveBankDispute(order)) otherBlockers.push('bank_reconciliation');
  if (hasUnsettledRefund(order)) otherBlockers.push('refund_reconciliation');
  if (order.labelReconciliationRequired === true) otherBlockers.push('label_reconciliation');
  if (deliveryCorrectionBlocksProgress(order)) otherBlockers.push('delivery_correction');
  if (order.disputed === true || ['disputed', 'return_requested', 'delivery_failed', 'lost'].includes(order.status)) otherBlockers.push('order_recourse');
  if (!id(order.buyerId) || !id(order.sellerId)) otherBlockers.push('party_provenance');
  else {
    const profiles = await tx.getAll(...[...new Set([order.buyerId, order.sellerId])]
      .map(uid => db.collection('eligibility_profiles').doc(uid)));
    if (profiles.some(snap => {
      const closure = snap.data()?.accountClosure;
      return closure != null && (closure.schemaVersion !== 1 || closure.ownerId !== snap.id || closure.phase !== 'paused');
    })) otherBlockers.push('account_closure');
  }
  return { articleId: order.articleId, decisionId: qualified ? orderDecisionId : null,
    sourceQualified: qualified, action: current ? instruction.action : 'pause',
    message: current ? instruction.message : HOLD_MESSAGE, instructionId: current ? instruction.id : null,
    decidedAt: current ? iso(instruction.decidedAt) : null, otherBlockers };
}
export async function orderModerationAllowsProgress(tx: FirebaseFirestore.Transaction, order: FirebaseFirestore.DocumentData, physicalLeg?: 'forward' | 'return', physicalTransactionId?: string) {
  if (deliveryCorrectionBlocksProgress(order) || returnToSenderBlocksProgress(order)) return false;
  if (physicalLeg && !await productPhysicalAllowsLeg(tx, order, physicalLeg, physicalTransactionId)) return false;
  const state = await readOrderModeration(tx, order);
  return state === null || (state.sourceQualified && state.action === 'continue' && state.otherBlockers.length === 0);
}

export function orderHasPaymentEvidence(order: FirebaseFirestore.DocumentData): boolean {
  return ['paid', 'label_created', 'shipped', 'delivered', 'completed', 'disputed', 'return_requested',
    'delivery_failed', 'lost', 'refund_in_progress', 'refund_action_required', 'refunded'].includes(order.status) ||
    !!order.paidAt || !!order.walletDebitedAt || (typeof order.sellerCreditedCents === 'number' && order.sellerCreditedCents > 0);
}

/** Reads first; callers invoke commit only after their own remaining reads.
 * A private receipt prevents a user-deleted notification being resurrected. */
export async function prepareOrderModerationNotices(tx: FirebaseFirestore.Transaction, transactionId: string,
  order: FirebaseFirestore.DocumentData, state: OrderModerationState | null) {
  if (!state?.sourceQualified || !state.decisionId || !orderHasPaymentEvidence(order) || !id(order.buyerId) || !id(order.sellerId)) return () => {};
  const key = state.instructionId ?? 'initial_pause';
  const receiptRef = db.collection('article_moderation').doc(state.articleId).collection('decisions').doc(state.decisionId)
    .collection('orders').doc(transactionId).collection('notices').doc(digest(key));
  const prior = await tx.get(receiptRef);
  if (prior.exists) return () => {};
  const entries = [...new Set([order.buyerId, order.sellerId])].map(uid => {
    const noticeId = digest(['order_moderation', state.decisionId, transactionId, key, uid]);
    return { uid, noticeId, ref: db.collection('notifications').doc(noticeId) };
  });
  const existing = await tx.getAll(...entries.map(entry => entry.ref));
  return () => {
    tx.create(receiptRef, { transactionId, articleId: state.articleId, decisionId: state.decisionId,
      instructionId: state.instructionId, buyerId: order.buyerId, sellerId: order.sellerId, createdAt: FieldValue.serverTimestamp() });
    entries.forEach((entry, index) => {
      if (existing[index].exists) return;
      tx.create(entry.ref, { id: entry.noticeId, userId: entry.uid, type: 'order_moderation',
        title: state.action === 'continue' ? 'Instruction concernant votre commande' : 'Commande en cours d’examen',
        message: 'Une instruction concernant votre commande est disponible dans son dossier privé.', isRead: false, createdAt: FieldValue.serverTimestamp(),
        data: { transactionId, ownerId: entry.uid, noticeSource: 'order_moderation_instruction_v1', articleId: state.articleId,
          decisionId: state.decisionId, instructionId: key, deepLink: `https://seconde.ca/orders/${transactionId}` } });
    });
  };
}

export async function ensureOrderModerationNotices(transactionId: string) {
  await db.runTransaction(async tx => {
    const order = (await tx.get(db.collection('transactions').doc(transactionId))).data();
    if (!order) return;
    const state = await readOrderModeration(tx, order);
    const commit = await prepareOrderModerationNotices(tx, transactionId, order, state);
    commit();
  });
}
