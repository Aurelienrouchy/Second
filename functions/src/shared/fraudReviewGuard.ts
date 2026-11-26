/** Documentary risk guard: unknown native markers remain conservative. */
import {createHash} from 'node:crypto';
export const fraudGuardDigest = (v: unknown) => createHash('sha256').update(JSON.stringify(v, (_key, value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)).digest('hex');
export function fraudReviewBlocksProgress(data: FirebaseFirestore.DocumentData): boolean {
  return Object.prototype.hasOwnProperty.call(data, 'fraudReview');
}
/** Same identity as phase-1 essential notices; transport/read clocks do not
 * manufacture a new risk signal. Provider closure never resolves this key. */
export function fraudBusinessReviewKey(caseId: string, current: unknown, payment: unknown, binding: any): string {
  return fraudGuardDigest([caseId, current, payment, binding.transactionId,
    binding.buyerId, binding.sellerId, binding.cardCents, binding.walletCents]);
}
