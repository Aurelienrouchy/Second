import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { productReviewHash } from '@/services/productReviewService';
import type { ProductAuthenticityReportReference, ProductAuthenticityReportSource } from '@/types/productAuthenticityReport';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function isProductAuthenticityReportReference(v: unknown): v is ProductAuthenticityReportReference {
  const material = object(v) && Object.prototype.hasOwnProperty.call(v, 'materialCapability');
  const parcel = object(v) && Object.prototype.hasOwnProperty.call(v, 'parcelCapability');
  return object(v) && Object.keys(v).length === 7 + Number(material) + Number(parcel) && Object.keys(v).every(k => ['caseId', 'caseVersion', 'caseSourceHash', 'contributionId', 'contributionHash', 'sourceHash', 'topic', ...(material ? ['materialCapability'] : []), ...(parcel ? ['parcelCapability'] : [])].includes(k)) &&
    (!parcel || v.parcelCapability === 'product_review_parcel_v1') &&
    (!material || v.materialCapability === 'product_review_material_v1') &&
    typeof v.caseId === 'string' && /^pr_[a-f0-9]{64}$/.test(v.caseId) && typeof v.contributionId === 'string' && /^pc_[a-f0-9]{64}$/.test(v.contributionId) &&
    typeof v.caseVersion === 'number' && Number.isSafeInteger(v.caseVersion) && v.caseVersion > 0 && (v.topic === 'authenticity' || material && v.topic === 'nonconformity') &&
    ['caseSourceHash', 'contributionHash', 'sourceHash'].every(k => hash(v[k]));
}
export async function observeProductAuthenticityReportSource(uid: string, transactionId: string, contributionId: string, assertContext: () => void, material = false, topic: 'authenticity' | 'nonconformity' = 'authenticity', parcel = false): Promise<ProductAuthenticityReportSource> {
  const session = captureTradeSession(uid); assertContext();
  if (topic === 'nonconformity' && !material || !/^[A-Za-z0-9_-]{1,200}$/.test(transactionId) || !/^pc_[a-f0-9]{64}$/.test(contributionId)) throw new Error('Contribution exacte requise.');
  const expectedCase = `pr_${await productReviewHash(['order', transactionId])}`; assertTradeSessionCurrent(session); assertContext();
  const result = await httpsCallable<unknown, unknown>(functions, 'reportTransactionProblem')({mode: 'source_observe', capability: topic === 'nonconformity' ? 'product_material_report_v1' : 'product_authenticity_report_v1', expectedUid: uid, transactionId, contributionId,
    ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})});
  assertTradeSessionCurrent(session); assertContext(); const v = result.data;
  if (!object(v) || Object.keys(v).length !== 8 || Object.keys(v).some(k => !['protocol', 'ownerId', 'transactionId', 'productReview', 'authenticityVerified', 'faultEstablished', 'financialEffect', 'freezePermissionGranted'].includes(k)) ||
    v.protocol !== (topic === 'nonconformity' ? 'product_material_report_source_v1' : 'product_authenticity_report_source_v1') || v.ownerId !== uid || v.transactionId !== transactionId ||
    v.authenticityVerified !== false || v.faultEstablished !== false || v.financialEffect !== 'none' || v.freezePermissionGranted !== false ||
    v.productReview !== null && (!isProductAuthenticityReportReference(v.productReview) || v.productReview.caseId !== expectedCase || v.productReview.contributionId !== contributionId || v.productReview.topic !== topic ||
      (v.productReview.materialCapability === 'product_review_material_v1') !== material || (v.productReview.parcelCapability === 'product_review_parcel_v1') !== parcel))
    throw new Error('La source du recours doit être relue.');
  return v as unknown as ProductAuthenticityReportSource;
}
