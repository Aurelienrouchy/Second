/** Qualification of the native refusal written before any withdrawal debit or
 * provider submission. Read-only: a status alone never proves non-execution. */
import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {PLATFORM_CASH_REFUSAL_REASONS, platformCashObservationHash, type PlatformCashRefusalReason} from './platformCashPreflight';

type WithdrawalIdentityInput = {userId: string; requestId: string; amount: number; bankAccountId: string};
export const withdrawalIntentHash = (input: WithdrawalIdentityInput) => createHash('sha256')
  .update(JSON.stringify([input.userId, input.requestId, input.amount, 'CAD', input.bankAccountId, 'standard'])).digest('hex');
export const withdrawalIdentity = (input: Pick<WithdrawalIdentityInput, 'userId' | 'requestId'>) => createHash('sha256')
  .update(JSON.stringify([input.userId, input.requestId])).digest('hex');

/** The exact request, private observation and absent deterministic debit are
 * read in the caller's transaction. Contradictory provider/debit evidence stays
 * unknown; this helper neither erases the request nor authorizes a new one. */
export async function qualifiedWithdrawalNonExecution(tx: FirebaseFirestore.Transaction, uid: string,
  ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData): Promise<boolean> {
  const refusal = data.withdrawalNonExecution;
  if (data.userId !== uid || refusal?.ownerId !== uid ||
      typeof refusal.clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(refusal.clientRequestId) ||
      !Number.isSafeInteger(data.amount) || data.amount < 1 ||
      typeof refusal.bankAccountId !== 'string' || !/^ba_[A-Za-z0-9_]{1,190}$/.test(refusal.bankAccountId)) return false;
  const input = {userId: uid, requestId: refusal.clientRequestId, amount: data.amount, bankAccountId: refusal.bankAccountId};
  const identity = withdrawalIdentity(input), payloadHash = withdrawalIntentHash(input);
  if (ref.id !== `wi_${identity}` || data.status !== 'not_executed' || data.currency !== 'cad' ||
      refusal.protocol !== 'withdrawal_non_execution_v1' || refusal.withdrawalRequestId !== ref.id ||
      refusal.payloadHash !== payloadHash || refusal.amountCents !== input.amount || refusal.currency !== 'CAD' ||
      !PLATFORM_CASH_REFUSAL_REASONS.includes(refusal.reason) || !(refusal.recordedAt instanceof Timestamp) ||
      refusal.recordedAt.toMillis() <= 0 || refusal.recordedAt.toMillis() > Date.now() ||
      !(data.createdAt instanceof Timestamp) || !data.createdAt.isEqual(refusal.recordedAt) ||
      ['withdrawalIntent', 'ledgerEntryId', 'stripeAccountId', 'payoutDestination', 'providerSubmission', 'stripeTransferId', 'stripePayoutId',
        'payoutRecovery', 'payoutCompletion', 'completedAt', 'payoutOutcome', 'transferOutcome', 'reconciliationRequired']
        .some(key => Object.prototype.hasOwnProperty.call(data, key))) return false;
  const debit = await tx.get(db.collection('wallets').doc(uid).collection('ledger').doc(`withdrawal_${identity}`));
  const source = (await tx.get(ref.collection('private_preflight').doc('observation'))).data(), proof = source?.observation;
  if (debit.exists || proof?.protocol !== 'platform_cash_preflight_v1' || proof.requestedCents !== input.amount ||
      proof.currency !== 'CAD' || proof.reason !== refusal.reason ||
      !['not_exposed', 'unknown', 'unavailable', 'insufficient'].includes(proof.qualification) || !(proof.observedAt instanceof Timestamp) ||
      proof.observedAt.toMillis() <= 0 || proof.observedAt.toMillis() > refusal.recordedAt.toMillis() ||
      proof.cashReserved !== false || proof.concurrentCapacityGuaranteed !== false ||
      ({platform_cash_preflight_not_exposed: 'not_exposed', platform_cash_observation_unknown: 'unknown',
        platform_cash_unavailable: 'unavailable', platform_cash_insufficient: 'insufficient'} as const)
        [refusal.reason as PlatformCashRefusalReason] !== proof.qualification ||
      source?.protocol !== 'withdrawal_platform_cash_proof_v1' || source.ownerId !== uid || source.clientRequestId !== input.requestId ||
      source.withdrawalRequestId !== ref.id || source.payloadHash !== payloadHash || source.contentHash !== platformCashObservationHash(proof) ||
      refusal.platformCashSourceHash !== source.contentHash) return false;
  return true;
}
