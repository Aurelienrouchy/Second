import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { doc, getDocFromServer } from 'firebase/firestore';
import { firestore, functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { isProductReviewEvidenceReference, isProductReviewSource, productReviewDocumentId, productReviewEqual, productReviewHash, ProductReviewService } from '@/services/productReviewService';
import { isProductAuthenticityReportReference } from '@/services/productAuthenticityReportService';
import { isProductParcelReportReference } from '@/utils/productParcelReportReference';
import { commercialObject as object, commercialExact as exact, commercialHash as hash, commercialId as id, commercialIso as iso,
  commercialEffects as effects, isProductCommercialReturnReference, PRODUCT_COMMERCIAL_RETURN_ACTIONS } from '@/utils/productCommercialReturnContract';
import type { ProductCommercialReturnBasis, ProductCommercialReturnInstruction, ProductCommercialReturnPage, ProductCommercialReturnPreview } from '@/types/productCommercialReturn';
import type { ProductReviewCursor, ProductReviewScope, ProductReviewWorkflowPreviewV2 } from '@/types/productReview';
const failure = () => new Error('L’instruction commerciale, ses sources et son corpus doivent être relus. Aucun retour ne peut être déduit du récit.');
const count = (v: unknown, max = 100): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max;
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.trim() === v && v.length <= 4000;
const noEffects = (v: Record<string, unknown>) => effects.every(k => v[k] === false);
const references = (v: unknown): boolean => Array.isArray(v) && v.length <= 100 && v.every(r => object(r) && exact(r, ['id', 'contentHash']) &&
  typeof r.id === 'string' && /^pc_[a-f0-9]{64}$/.test(r.id) && hash(r.contentHash)) && new Set(v.map(r => r.id)).size === v.length;
const evidence = (v: unknown): boolean => Array.isArray(v) && v.length <= 100 && v.every(isProductReviewEvidenceReference) && new Set(v.map(r => r.id)).size === v.length;
const coverageKeys = ['contributionsInspected', 'communicationsInspected', 'limitPerSource', 'contributionsHasMore', 'communicationsHasMore', 'completeCurrentCaseSet', 'exhaustiveHistoryVerified',
  'evidenceInspected', 'intentsInspected', 'evidenceHasMore', 'intentsHasMore', 'documentaryCompleteCurrentCaseSet'];
function coverage(v: unknown): v is ProductReviewWorkflowPreviewV2['coverage'] {
  return object(v) && exact(v, coverageKeys) && v.limitPerSource === 100 && ['contributionsInspected', 'communicationsInspected', 'evidenceInspected', 'intentsInspected'].every(k => count(v[k])) &&
    ['contributionsHasMore', 'communicationsHasMore', 'completeCurrentCaseSet', 'evidenceHasMore', 'intentsHasMore', 'documentaryCompleteCurrentCaseSet'].every(k => typeof v[k] === 'boolean') &&
    v.exhaustiveHistoryVerified === false && v.completeCurrentCaseSet === v.documentaryCompleteCurrentCaseSet &&
    (!v.documentaryCompleteCurrentCaseSet || !v.contributionsHasMore && !v.communicationsHasMore && !v.evidenceHasMore && !v.intentsHasMore && Number(v.contributionsInspected) > 0 && Number(v.evidenceInspected) > 0);
}
function basis(v: unknown, transactionId: string, disputeId: string): v is ProductCommercialReturnBasis {
  const parcel = object(v) && Object.prototype.hasOwnProperty.call(v, 'parcelCapability');
  return object(v) && exact(v, ['protocol', 'transactionId', 'disputeId', 'buyerId', 'sellerId', 'instructionId', 'contentHash', 'reportedAt', 'initialReleaseAt', 'instructedAt', 'semanticSourceHash', ...(parcel ? ['parcelCapability', 'commercialStatusAtInstruction'] : [])]) &&
    (!parcel || v.parcelCapability === 'product_review_parcel_v1' && ['delivered', 'disputed'].includes(String(v.commercialStatusAtInstruction))) &&
    v.protocol === 'product_commercial_return_basis_v1' && v.transactionId === transactionId && v.disputeId === disputeId &&
    typeof v.buyerId === 'string' && !!v.buyerId && !v.buyerId.includes('/') && typeof v.sellerId === 'string' && !!v.sellerId && !v.sellerId.includes('/') && v.buyerId !== v.sellerId &&
    isProductCommercialReturnReference({instructionId: v.instructionId, contentHash: v.contentHash}) && hash(v.semanticSourceHash) && iso(v.reportedAt) && iso(v.initialReleaseAt) && iso(v.instructedAt) &&
    Date.parse(v.reportedAt) >= 0 && Date.parse(v.reportedAt) < Date.parse(v.initialReleaseAt) && Date.parse(v.reportedAt) <= Date.parse(v.instructedAt) && Date.parse(v.instructedAt) <= Date.now();
}
async function rpc(uid: string, scope: ProductReviewScope, input: Record<string, unknown>, assertCurrent: () => void): Promise<unknown> {
  const session = captureTradeSession(uid); assertCurrent();
  const response = await httpsCallable<unknown, unknown>(functions, scope === 'admin' ? 'triageReport' : 'submitReport')({...input, expectedUid: uid, capability: 'product_review_v1', materialCapability: 'product_review_material_v1'});
  assertTradeSessionCurrent(session); assertCurrent(); return response.data;
}
function instruction(v: unknown, scope: ProductReviewScope, transactionId: string, caseId: string): v is ProductCommercialReturnInstruction {
  return object(v) && exact(v, ['instructionReference', 'transactionId', 'disputeId', 'caseId', 'action', 'partyMessage', 'sourceHash', 'semanticSourceHash', 'membersHash', 'corpusHash', 'caseVersion', 'recordedAt', 'currentInstructionVerified',
    ...(scope === 'admin' ? ['privateNote', 'contributionReferences', 'evidenceReferences'] : []), ...effects]) &&
    isProductCommercialReturnReference(v.instructionReference) && v.transactionId === transactionId && id(v.disputeId) && v.caseId === caseId && PRODUCT_COMMERCIAL_RETURN_ACTIONS.includes(v.action as 'maintain_review') &&
    text(v.partyMessage) && ['sourceHash', 'semanticSourceHash', 'membersHash', 'corpusHash'].every(k => hash(v[k])) && count(v.caseVersion, Number.MAX_SAFE_INTEGER) && v.caseVersion > 0 && iso(v.recordedAt) &&
    v.currentInstructionVerified === false && noEffects(v) && (scope !== 'admin' || text(v.privateNote) && references(v.contributionReferences) && evidence(v.evidenceReferences));
}
export const ProductCommercialReturnService = {
  /** Only the native complaint reference selects a dispute; free text never supplies it. */
  async dispute(uid: string, transactionId: string, scope: ProductReviewScope, assertCurrent: () => void, parcel = false): Promise<string | null> {
    const session = captureTradeSession(uid); assertCurrent(); if (!id(transactionId)) throw failure();
    const snapshot = await getDocFromServer(doc(firestore, 'transactions', transactionId)); assertTradeSessionCurrent(session); assertCurrent();
    const order = snapshot.data(); if (!order || scope === 'own' && order.buyerId !== uid && order.sellerId !== uid) throw failure();
    const report = order.buyerReport;
    if (!object(report) || !id(report.disputeId) || !(parcel && report.protocol === 'transaction_parcel_report_v1' && isProductParcelReportReference(report.productReview) && report.productReview.actorRole === 'buyer' && report.productReview.leg === 'forward' ||
      report.protocol === 'transaction_problem_report_v1' && isProductAuthenticityReportReference(report.productReview) && report.productReview.topic === 'nonconformity' && report.productReview.materialCapability === 'product_review_material_v1')) return null;
    if (!object(report.productReview) || report.productReview.caseId !== `pr_${await productReviewHash(['order', transactionId])}`) return null;
    assertTradeSessionCurrent(session); assertCurrent(); return report.disputeId;
  },
  async preview(uid: string, transactionId: string, disputeId: string, scope: ProductReviewScope, assertCurrent: () => void, parcel = false): Promise<ProductCommercialReturnPreview> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertCurrent();}; current(); if (!id(transactionId) || !id(disputeId)) throw failure();
    const caseId = `pr_${await productReviewHash(['order', transactionId])}`; current();
    const v = await rpc(uid, scope, {operation: 'productCommercialReturnPreview', transactionId, disputeId, scope, ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'transactionId', 'disputeId', 'returnRequestId', 'source', 'sourceHash', 'semanticSourceHash', 'caseVersion', 'corpusHash', 'membersHash', 'contributionReferences', 'evidenceReferences', 'coverage',
      'documentaryComplete', 'canInstruct', 'admission', 'options', 'previewId', ...(parcel ? ['parcelCapability'] : []), ...effects]) || parcel && v.parcelCapability !== 'product_review_parcel_v1' || v.protocol !== 'product_commercial_return_preview_v1' || v.actorId !== uid || v.scope !== scope || v.transactionId !== transactionId || v.disputeId !== disputeId ||
      !(v.returnRequestId === null || typeof v.returnRequestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.returnRequestId)) || !isProductReviewSource(v.source, uid, {kind: 'order', id: transactionId}, caseId, scope, true, parcel) || v.sourceHash !== v.source.sourceHash ||
      !['sourceHash', 'semanticSourceHash', 'corpusHash', 'membersHash'].every(k => hash(v[k])) || !count(v.caseVersion, Number.MAX_SAFE_INTEGER) || !coverage(v.coverage) ||
      v.documentaryComplete !== v.coverage.documentaryCompleteCurrentCaseSet || typeof v.canInstruct !== 'boolean' || v.canInstruct && !v.documentaryComplete || !references(v.contributionReferences) || !evidence(v.evidenceReferences) || !noEffects(v) ||
      !productReviewEqual(v.options, scope === 'admin' ? PRODUCT_COMMERCIAL_RETURN_ACTIONS : []) || (scope === 'admin' ? !hash(v.previewId) : v.previewId !== null || (v.contributionReferences as unknown[]).length !== 0 || (v.evidenceReferences as unknown[]).length !== 0) ||
      !object(v.admission) || !exact(v.admission, ['protocol', 'allowed', 'qualification', 'reference', 'basis']) || v.admission.protocol !== 'product_commercial_return_guard_v1' || typeof v.admission.allowed !== 'boolean' ||
      !['unknown', 'no_current_instruction', 'native_current_instruction'].includes(String(v.admission.qualification)) || !(v.admission.reference === null || isProductCommercialReturnReference(v.admission.reference)) ||
      v.admission.allowed !== (v.admission.qualification === 'native_current_instruction') || v.admission.qualification === 'unknown' && v.admission.reference !== null ||
      (v.admission.allowed ? v.admission.qualification !== 'native_current_instruction' || !v.canInstruct || !isProductCommercialReturnReference(v.admission.reference) || !basis(v.admission.basis, transactionId, disputeId) ||
        v.admission.basis.instructionId !== v.admission.reference.instructionId || v.admission.basis.contentHash !== v.admission.reference.contentHash || v.admission.basis.semanticSourceHash !== v.semanticSourceHash : v.admission.basis !== null)) throw failure();
    const fresh = await ProductReviewService.workflowPreview(uid, {kind: 'order', id: transactionId}, scope, null, current, true, true, parcel); current();
    if (fresh.source.sourceHash !== v.sourceHash || fresh.documentaryCorpusHash !== v.corpusHash || fresh.caseVersion !== v.caseVersion || !productReviewEqual(fresh.coverage, v.coverage)) throw failure();
    if (scope === 'admin' && !productReviewEqual(fresh.contributionReferences.flatMap(r => r.qualification === 'native_contribution' && r.contentHash ? [{id: r.id, contentHash: r.contentHash}] : []), v.contributionReferences) ||
      scope === 'admin' && !productReviewEqual(fresh.evidenceReferences.flatMap(r => r.qualification === 'native_stored_file' ? [r.evidence] : []), v.evidenceReferences)) throw failure();
    return v as unknown as ProductCommercialReturnPreview;
  },
  async page(uid: string, transactionId: string, scope: ProductReviewScope, cursor: ProductReviewCursor | null, preview: ProductCommercialReturnPreview, assertCurrent: () => void): Promise<ProductCommercialReturnPage> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertCurrent();}; current();
    if (cursor !== null && (!object(cursor) || !exact(cursor, ['lastId']) || !productReviewDocumentId(cursor.lastId)) || preview.transactionId !== transactionId || preview.actorId !== uid || preview.scope !== scope) throw failure();
    const v = await rpc(uid, scope, {operation: 'readProductCommercialReturnInstructions', transactionId, scope, cursor, ...(preview.parcelCapability ? {parcelCapability: preview.parcelCapability} : {})}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'transactionId', 'scope', 'entries', 'readAt', 'nextCursor', 'coverage', ...effects]) || v.protocol !== 'product_commercial_return_instructions_page_v1' || v.actorId !== uid || v.transactionId !== transactionId || v.scope !== scope ||
      !iso(v.readAt) || !Array.isArray(v.entries) || v.entries.length > 20 || !noEffects(v) || !object(v.coverage) || !exact(v.coverage, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoryVerified']) || v.coverage.limit !== 20 ||
      v.coverage.inspected !== v.entries.length || typeof v.coverage.hasMore !== 'boolean' || v.coverage.exhaustiveHistoryVerified !== false) throw failure();
    const ids: string[] = [];
    for (const r of v.entries) {
      if (!object(r)) throw failure();
      if (r.qualification === 'native_commercial_return_instruction') {if (!exact(r, ['qualification', 'instruction']) || !instruction(r.instruction, scope, transactionId, preview.source.caseId)) throw failure(); ids.push(r.instruction.instructionReference.instructionId);}
      else {if (r.qualification !== 'unknown' || !exact(r, ['qualification', 'instructionId', 'instruction']) || !productReviewDocumentId(r.instructionId) || r.instruction !== null) throw failure(); ids.push(r.instructionId);}
    }
    if (new Set(ids).size !== ids.length || (v.coverage.hasMore ? ids.length !== 20 || !object(v.nextCursor) || !exact(v.nextCursor, ['lastId']) || v.nextCursor.lastId !== ids.at(-1) || v.nextCursor.lastId === cursor?.lastId : v.nextCursor !== null)) throw failure();
    const fresh = await ProductCommercialReturnService.preview(uid, transactionId, preview.disputeId, scope, current, preview.parcelCapability === 'product_review_parcel_v1'); current();
    if (fresh.sourceHash !== preview.sourceHash || fresh.corpusHash !== preview.corpusHash || fresh.membersHash !== preview.membersHash || fresh.semanticSourceHash !== preview.semanticSourceHash) throw failure();
    return v as unknown as ProductCommercialReturnPage;
  },
};
