import { isProductReviewEvidenceReference, productReviewEqual, productReviewHash } from '@/services/productReviewService';
import type { AdminProductFinancialReference, AdminProductFinancialSource } from '@/types/adminProductFinancial';
import { isProductParcelAssessment } from '@/utils/productParcelStatement';
import { isLateCommercialReference, isLateCommercialFinancialBasis } from '@/services/lateCommercialRecourseService';

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 100;
export function isAdminProductFinancialReference(v: unknown): v is AdminProductFinancialReference {
  const material = object(v) && Object.prototype.hasOwnProperty.call(v, 'materialCapability');
  const parcel = object(v) && Object.prototype.hasOwnProperty.call(v, 'parcelCapability');
  const late = object(v) && Object.prototype.hasOwnProperty.call(v, 'lateCommercial');
  return object(v) && exact(v, ['caseId', 'topic', 'caseVersion', 'caseSourceHash', 'issueId', 'issueHash', 'corpusHash', 'membersHash', 'authorizationSourceHash', ...(material ? ['materialCapability'] : []), ...(parcel ? ['parcelCapability'] : []), ...(late ? ['lateCommercial'] : [])]) &&
    (!late || v.topic !== 'parcel_delivery' && isLateCommercialReference(v.lateCommercial)) &&
    (!material || v.materialCapability === 'product_review_material_v1') && (!parcel || v.parcelCapability === 'product_review_parcel_v1') && id(v.caseId, 'pr') && (v.topic === 'authenticity' || material && v.topic === 'nonconformity' || parcel && v.topic === 'parcel_delivery') && typeof v.caseVersion === 'number' && Number.isSafeInteger(v.caseVersion) && v.caseVersion > 0 &&
    id(v.issueId, 'pe') && ['caseSourceHash', 'issueHash', 'corpusHash', 'membersHash', 'authorizationSourceHash'].every(k => hash(v[k]));
}
/** Preserve the server parser's property order in the historical classifier array hash. */
export function adminProductFinancialReference(v: AdminProductFinancialReference): AdminProductFinancialReference {
  return {caseId: v.caseId, topic: v.topic, caseVersion: v.caseVersion, caseSourceHash: v.caseSourceHash, issueId: v.issueId,
    issueHash: v.issueHash, corpusHash: v.corpusHash, membersHash: v.membersHash, authorizationSourceHash: v.authorizationSourceHash,
    ...(v.materialCapability ? {materialCapability: v.materialCapability} : {}), ...(v.parcelCapability ? {parcelCapability: v.parcelCapability} : {}),
    ...(v.lateCommercial ? {lateCommercial: v.lateCommercial} : {})};
}
export function isAdminProductFinancialSource(v: unknown, expected: AdminProductFinancialReference): v is AdminProductFinancialSource {
  if (!object(v) || !exact(v, ['protocol', 'reference', 'issue', 'contributionReferences', 'evidenceReferences', 'coverage', 'authenticityVerified',
    'expertiseVerified', 'newRefundPermissionGranted', 'inventoryPermissionGranted', ...(expected.topic === 'nonconformity' ? ['materialReturnReview'] : []), ...(expected.topic === 'parcel_delivery' ? ['parcelReview', 'parcelReturnReview'] : []), ...(expected.lateCommercial ? ['lateCommercial'] : [])]) || v.protocol !== 'product_financial_source_v1' ||
    (expected.lateCommercial ? !isLateCommercialFinancialBasis(v.lateCommercial, expected.lateCommercial) : v.lateCommercial !== undefined) ||
    !isAdminProductFinancialReference(v.reference) || !productReviewEqual(v.reference, expected) || !object(v.issue) ||
    !exact(v.issue, ['eventId', 'contentHash', 'caseVersion', 'result', 'text', 'motivation', 'sourceHash', 'recordedAt']) ||
    v.issue.eventId !== expected.issueId || v.issue.contentHash !== expected.issueHash || v.issue.caseVersion !== expected.caseVersion ||
    !(expected.topic === 'parcel_delivery' ? ['review_documented', 'information_incomplete'].includes(String(v.issue.result)) : v.issue.result === 'review_documented') || typeof v.issue.text !== 'string' || !v.issue.text.trim() ||
    !(v.issue.motivation === null || typeof v.issue.motivation === 'string') || !hash(v.issue.sourceHash) || typeof v.issue.recordedAt !== 'string' ||
    !Number.isFinite(Date.parse(v.issue.recordedAt)) || !Array.isArray(v.contributionReferences) || !v.contributionReferences.length ||
    v.contributionReferences.length > 100 || !v.contributionReferences.every(r => object(r) && exact(r, ['id', 'contentHash', 'actorId', 'actorRole', 'topic', 'qualification']) &&
      id(r.id, 'pc') && hash(r.contentHash) && typeof r.actorId === 'string' && !!r.actorId && !r.actorId.includes('/') &&
      ['buyer', 'seller', 'reporter'].includes(String(r.actorRole)) && ['authenticity', 'recall', 'child_safety', 'hygiene', 'animal_material', ...(expected.materialCapability || expected.parcelCapability ? ['nonconformity'] : []), ...(expected.parcelCapability ? ['parcel_delivery'] : [])].includes(String(r.topic)) && r.qualification === 'native_contribution') ||
    !Array.isArray(v.evidenceReferences) || expected.topic !== 'parcel_delivery' && !v.evidenceReferences.length || v.evidenceReferences.length > 100 || !v.evidenceReferences.every(isProductReviewEvidenceReference) ||
    v.evidenceReferences.some(r => r.state !== 'received') || !object(v.coverage) || !exact(v.coverage, ['contributionsInspected', 'communicationsInspected', 'limitPerSource',
      'contributionsHasMore', 'communicationsHasMore', 'completeCurrentCaseSet', 'exhaustiveHistoryVerified', 'evidenceInspected', 'intentsInspected', 'evidenceHasMore', 'intentsHasMore', 'documentaryCompleteCurrentCaseSet']) ||
    v.coverage.limitPerSource !== 100 || !['contributionsInspected', 'communicationsInspected', 'evidenceInspected', 'intentsInspected'].every(k => count((v.coverage as Record<string, unknown>)[k])) ||
    !['contributionsHasMore', 'communicationsHasMore', 'exhaustiveHistoryVerified', 'evidenceHasMore', 'intentsHasMore'].every(k => (v.coverage as Record<string, unknown>)[k] === false) ||
    (expected.topic === 'parcel_delivery' ? typeof v.coverage.completeCurrentCaseSet !== 'boolean' || v.coverage.completeCurrentCaseSet !== v.coverage.documentaryCompleteCurrentCaseSet : v.coverage.completeCurrentCaseSet !== true || v.coverage.documentaryCompleteCurrentCaseSet !== true) ||
    !['authenticityVerified', 'expertiseVerified', 'newRefundPermissionGranted', 'inventoryPermissionGranted'].every(k => v[k] === false)) return false;
  if (expected.topic === 'nonconformity') {
    const r = v.materialReturnReview;
    if (!object(r) || !exact(r, ['qualification', 'qualifiesOwnReturnForFinancialReview', 'physicalContentsVerified', 'faultEstablished']) ||
      !['native_parcel_with_actor_return_declaration', 'not_applicable', 'unknown'].includes(String(r.qualification)) ||
      r.qualifiesOwnReturnForFinancialReview !== (r.qualification === 'native_parcel_with_actor_return_declaration') || r.physicalContentsVerified !== false || r.faultEstablished !== false) return false;
  }
  if (expected.topic === 'parcel_delivery') {
    const p = v.parcelReview, r = v.parcelReturnReview;
    if (!object(p) || !exact(p, ['integrityQualified', 'documentaryComplete', 'assessment', 'qualification', 'responsibilityEstablished', 'insurancePaymentPromised', 'costDecisionGranted']) || p.integrityQualified !== true || p.documentaryComplete !== (v.coverage as Record<string, unknown>).documentaryCompleteCurrentCaseSet ||
      p.qualification !== 'native_operator_assessment_of_available_sources' || !isProductParcelAssessment(p.assessment) || p.responsibilityEstablished !== false || p.insurancePaymentPromised !== false || p.costDecisionGranted !== false ||
      !object(r) || !exact(r, ['qualifiesOwnReturnForFinancialReview', 'qualification', 'physicalContentsVerified', 'faultEstablished']) || !['native_parcel_with_actor_return_declaration', 'unknown'].includes(String(r.qualification)) || r.qualifiesOwnReturnForFinancialReview !== (r.qualification === 'native_parcel_with_actor_return_declaration') || r.physicalContentsVerified !== false || r.faultEstablished !== false) return false;
  }
  const qualified = v as unknown as AdminProductFinancialSource;
  return new Set(qualified.contributionReferences.map(r => r.id)).size === qualified.contributionReferences.length && new Set(qualified.evidenceReferences.map(r => r.id)).size === qualified.evidenceReferences.length &&
    qualified.coverage.contributionsInspected === qualified.contributionReferences.length && qualified.coverage.evidenceInspected === qualified.evidenceReferences.length &&
    qualified.contributionReferences.some(r => r.topic === expected.topic) && qualified.evidenceReferences.every(e => qualified.contributionReferences.some(c => c.id === e.contributionId && c.contentHash === e.contributionHash));
}
export async function productFinancialCaseId(transactionId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(transactionId)) throw new Error('Commande exacte requise.');
  return `pr_${await productReviewHash(['order', transactionId])}`;
}
