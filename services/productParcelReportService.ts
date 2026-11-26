import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { productReviewHash } from '@/services/productReviewService';
import { isProductParcelReportReference } from '@/utils/productParcelReportReference';
import type { ProductParcelReportSource } from '@/types/productParcelReport';
export async function observeProductParcelReportSource(uid: string, transactionId: string, contributionId: string, assertContext: () => void): Promise<ProductParcelReportSource> {
  const session = captureTradeSession(uid); assertContext(); if (!/^[A-Za-z0-9_-]{1,200}$/.test(transactionId) || !/^pc_[a-f0-9]{64}$/.test(contributionId)) throw new Error('Contribution colis exacte requise.');
  const caseId = `pr_${await productReviewHash(['order', transactionId])}`; assertTradeSessionCurrent(session); assertContext();
  const result = await httpsCallable<unknown, unknown>(functions, 'reportTransactionProblem')({mode: 'source_observe', capability: 'product_parcel_report_v1', parcelCapability: 'product_review_parcel_v1', expectedUid: uid, transactionId, contributionId});
  assertTradeSessionCurrent(session); assertContext(); const raw = result.data;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Source du recours colis à relire.'); const v = raw as Record<string, unknown>;
  const keys = ['protocol', 'ownerId', 'transactionId', 'productReview', 'physicalReceiptVerified', 'faultEstablished', 'financialEffect', 'freezePermissionGranted'];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k)) || v.protocol !== 'product_parcel_report_source_v1' || v.ownerId !== uid || v.transactionId !== transactionId ||
    v.productReview !== null && (!isProductParcelReportReference(v.productReview) || v.productReview.caseId !== caseId || v.productReview.contributionId !== contributionId) || v.physicalReceiptVerified !== false || v.faultEstablished !== false || v.financialEffect !== 'none' || v.freezePermissionGranted !== false) throw new Error('Source du recours colis à relire.');
  return v as unknown as ProductParcelReportSource;
}
