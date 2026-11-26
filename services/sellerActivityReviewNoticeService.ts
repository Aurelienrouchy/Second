import {EligibilityService} from '@/services/eligibilityService';
import {captureTradeSession, assertTradeSessionCurrent} from '@/services/tradeOperation';
import {isEligibilityReviewReference} from '@/services/sellerActivityReviewService';
export async function sellerActivityReviewNotificationContext(data: unknown, uid: string, guard: () => void): Promise<{reviewId: string}> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Avis d’examen non qualifié.');
  const v = data as Record<string, unknown>;
  if (v.reviewCapability !== 'seller_activity_review_v1' || !isEligibilityReviewReference(v.reviewId) || typeof v.event !== 'string' ||
    !/^(?:opened|appeal_received|decision_[1-9]\d*_(?:request_information|reject|complete_review))$/.test(v.event)) throw new Error('Référence d’examen non qualifiée.');
  const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); guard();}; current();
  const detail = await EligibilityService.getReview(uid, v.reviewId, current); current();
  if (detail.request.id !== v.reviewId || detail.request.kind !== 'review' || detail.request.scope !== 'sell') throw new Error('Le dossier propriétaire doit être relu.');
  return {reviewId: v.reviewId};
}
