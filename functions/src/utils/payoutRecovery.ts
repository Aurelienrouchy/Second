import { financialRecoverySourceFields } from "./financialRecoverySources";
import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
import { financialRecoveryWalletFields } from "./financialRecoverySources";
/** Withdrawal recovery: current provider proof, native intention, exact return
 * to the platform, then one local compensation. A failed event is only a hint. */
import * as logger from 'firebase-functions/logger';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { markWithdrawalReconciliation, matchesWithdrawalPayout, resolveWithdrawalPayout, withdrawalFailureDisplay } from './payoutOutcome';
import { prepareOperationalNotices } from './notifications';
import { HttpsError } from 'firebase-functions/v2/https';

type StripeClient = ReturnType<typeof getStripe>;
export interface RevertFailedPayoutInput {
  withdrawalRequestId: string; payoutId?: string | null; failureReason?: string | null;
  ownerIdFallback?: string | null; payoutProof?: unknown;
}
export interface RevertFailedPayoutResult {
  reCredited: boolean; transferId: string | null;
  recoveryState: 'recovered' | 'awaiting_return' | 'reconciliation_required' | 'not_failed';
  ownerId: string | null; payoutId: string | null;
}
const idOf = (value: any): string | null => typeof value === 'string' ? value : typeof value?.id === 'string' ? value.id : null;
const safeCents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const IDENTITY_HOLDS = ['payout_identity_conflict', 'payout_candidate_conflict', 'withdrawal_transfer_binding_conflict',
  'payout_paid_after_compensation', 'payout_changed_during_recovery', 'payout_paid_after_failed_status'];
const source = (data: FirebaseFirestore.DocumentData) => JSON.stringify([data.userId, data.amount, data.currency,
  data.stripeAccountId, data.stripeTransferId ?? null, data.stripePayoutId ?? null, data.ledgerEntryId ?? null,
  data.payoutDestination?.schemaVersion ?? null, data.payoutDestination?.accountId ?? null, data.payoutDestination?.bankAccountId ?? null,
  data.payoutDestination?.country ?? null, data.payoutDestination?.currency ?? null]);
/** The original submitter may persist the very payout this GET just qualified.
 * Only that one-way enrichment is benign; a different movement or intention
 * still invalidates the observation, including when a Firestore retry occurs. */
const sameObservedSource = (initial: FirebaseFirestore.DocumentData, current: FirebaseFirestore.DocumentData, payoutId: string) =>
  (initial.withdrawalIntent?.payloadHash ?? null) === (current.withdrawalIntent?.payloadHash ?? null) &&
  (source(current) === source(initial) || initial.stripePayoutId == null && current.stripePayoutId === payoutId &&
    initial.withdrawalIntent?.schemaVersion === 1 && initial.payoutDestination?.schemaVersion === 1 &&
    source({ ...current, stripePayoutId: null }) === source(initial));
const operatorReference = (requestId: string) => db.collection('failed_operations')
  .doc('withdrawal_' + createHash('sha256').update(requestId).digest('hex'));

/** An old generic CAS hold is re-examined, never assumed to have been a race.
 * A modern, fully submitted intention and its exact operator locator permit
 * current GET-only proof. The debit/transfer/payout are all qualified again
 * before any completion; failure recovery and genuine identity holds stay shut. */
const canReobserveCompletionConflict = (requestId: string, data: FirebaseFirestore.DocumentData, operator: FirebaseFirestore.DocumentData | undefined) =>
  data.reconciliationRequired === true && data.reconciliationReason === 'payout_changed_during_recovery' &&
  data.status === 'processing' && data.payoutRecovery == null && data.payoutCompletion == null && data.exceptionalRestitution == null &&
  data.withdrawalIntent?.schemaVersion === 1 && data.payoutDestination?.schemaVersion === 1 &&
  typeof data.stripePayoutId === 'string' && /^po_[A-Za-z0-9_]+$/.test(data.stripePayoutId) &&
  data.transferOutcome === 'created' && ['pending', 'in_transit', 'unknown'].includes(data.payoutOutcome) &&
  data.providerSubmission?.transfer?.state === 'created' && data.providerSubmission.transfer.providerId === data.stripeTransferId &&
  data.providerSubmission?.payout?.state === 'created' && data.providerSubmission.payout.providerId === data.stripePayoutId &&
  operator?.type === 'payout_reversal_failed' && operator.refId === requestId && operator.status === 'pending' &&
  operator.actionRequired === true && operator.error === 'payout_changed_during_recovery' &&
  operator.payload?.kind === 'payout_identity_reconciliation' && operator.payload.evidence?.payoutId === data.stripePayoutId &&
  Object.keys(operator.payload.evidence).length === 1;
// An expanded source must carry its native Stripe discriminator as well as
// the exact ID. An arbitrary object exposing an `id` is not that movement.
const balanceSourceMatches = (value: unknown, expectedId: string, expectedObject: 'payout' | 'transfer_reversal') =>
  typeof value === 'string' ? value === expectedId : value != null && typeof value === 'object' && !Array.isArray(value) &&
    'object' in value && value.object === expectedObject && 'id' in value && value.id === expectedId;
export const withdrawalFailureReturnMatches = (balance: any, payout: any, amount: number) => balance?.object === 'balance_transaction' &&
  balance.id === idOf(payout.failure_balance_transaction) && ['payout_failure', 'payout_cancel'].includes(balance.type) &&
  balance.currency === 'cad' && balance.amount === amount && balance.net === amount && balance.status === 'available' &&
  balanceSourceMatches(balance.source, payout.id, 'payout');
const failureReturnMatches=withdrawalFailureReturnMatches;
const transferMatches = (transfer: any, requestId: string, data: FirebaseFirestore.DocumentData) => transfer?.object === 'transfer' &&
  transfer.id === data.stripeTransferId && transfer.amount === data.amount && transfer.currency === 'cad' &&
  idOf(transfer.destination) === data.stripeAccountId && transfer.metadata?.firebaseUserId === data.userId &&
  transfer.metadata?.withdrawalRequestId === requestId && safeCents(transfer.amount_reversed) && transfer.amount_reversed <= transfer.amount;

/** Read before any write. Legacy compensation is qualified separately to avoid
 * restoring a second time money already credited by the former implementation. */
export async function readWithdrawalLocalEvidence(tx: FirebaseFirestore.Transaction, requestId: string, data: FirebaseFirestore.DocumentData) {
  if (typeof data.userId !== 'string' || !data.userId || data.userId.includes('/') || !safeCents(data.amount) || data.amount <= 0) return null;
  const walletRef = db.collection('wallets').doc(data.userId), wallet = (await tx.get(walletRef)).data();
  const rows = await tx.get(walletRef.collection('ledger').where('withdrawalRequestId', '==', requestId).limit(101));
  if (rows.size >= 101 || !wallet || !safeCents(wallet.balance) || typeof wallet.currency !== 'string' || wallet.currency.toUpperCase() !== 'CAD' ||
      !['active', 'inactive'].includes(wallet.status) || (wallet.userId != null && wallet.userId !== data.userId)) return null;
  const debits = rows.docs.filter(doc => doc.data().type === 'withdrawal');
  if (debits.length !== 1) return null;
  const debit = debits[0].data();
  if ((data.ledgerEntryId != null && data.ledgerEntryId !== debits[0].id) || debit.amount !== data.amount ||
      !(debit.createdAt instanceof Timestamp) || !safeCents(debit.balanceAfter) ||
      (debit.currency != null && String(debit.currency).toUpperCase() !== 'CAD')) return null;
  const intent = data.withdrawalIntent, submission = data.providerSubmission;
  if (intent != null && (intent.schemaVersion !== 1 || intent.ownerId !== data.userId || intent.withdrawalRequestId !== requestId ||
      intent.amountCents !== data.amount || intent.currency !== 'CAD' || intent.accountId !== data.stripeAccountId ||
      intent.bankAccountId !== data.payoutDestination?.bankAccountId || intent.debitLedgerId !== debits[0].id ||
      intent.transferKey !== `tr_${debits[0].id}` || intent.payoutKey !== `po_${debits[0].id}` || !(intent.committedAt instanceof Timestamp) ||
      typeof intent.payloadHash !== 'string' || !/^[a-f0-9]{64}$/.test(intent.payloadHash) ||
      debit.withdrawalIntentHash !== intent.payloadHash || debit.clientRequestId !== intent.clientRequestId || debit.currency !== 'CAD' ||
      submission?.schemaVersion !== 1 || submission.ownerId !== data.userId || submission.withdrawalRequestId !== requestId ||
      submission.payloadHash !== intent.payloadHash || submission.amountCents !== data.amount || submission.currency !== 'CAD' ||
      submission.accountId !== data.stripeAccountId || submission.bankAccountId !== intent.bankAccountId || submission.debitLedgerId !== debits[0].id ||
      submission.transfer?.state !== 'created' || submission.transfer.providerId !== data.stripeTransferId ||
      !(submission.transfer.authorizedAt instanceof Timestamp) || !(submission.transfer.observedAt instanceof Timestamp) ||
      !['requested', 'created', 'unknown'].includes(submission.payout?.state) || !(submission.payout.authorizedAt instanceof Timestamp) ||
      (submission.payout.state === 'created' && (submission.payout.providerId !== data.stripePayoutId || !(submission.payout.observedAt instanceof Timestamp))))) return null;
  const credits = rows.docs.filter(doc => doc.data().type === 'withdrawal_failed');
  if (credits.length > 1 || rows.size !== 1 + credits.length) return null;
  const existing = credits[0], credit = existing?.data();
  if (credit && (credit.amount !== data.amount || !(credit.createdAt instanceof Timestamp) || !safeCents(credit.balanceAfter) ||
      (credit.currency != null && String(credit.currency).toUpperCase() !== 'CAD'))) return null;
  const creditRef = walletRef.collection('ledger').doc(`withdrawal_recovery_${requestId}`);
  const deterministic = await tx.get(creditRef);
  if (deterministic.exists && existing?.id !== creditRef.id) return null;
  return { walletRef, wallet, debitId: debits[0].id, existingCreditId: existing?.id ?? null, existingCredit: credit ?? null, creditRef };
}
const localEvidence=readWithdrawalLocalEvidence;

const timingDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const timingIdentity = (data: FirebaseFirestore.DocumentData, debitId: string) => timingDigest([
  'withdrawal_payout_timing_v1', source(data), debitId, data.withdrawalIntent?.payloadHash ?? null]);
const payoutStatuses = ['pending', 'in_transit', 'paid', 'failed', 'canceled'];
const arrivalCalendarDate = (seconds: unknown): string | null => typeof seconds === 'number' &&
  Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 253402300799
  ? new Date(seconds * 1000).toISOString().slice(0, 10) : null;

/** An estimate/status is separate from completion and compensation receipts.
 * All exact native identities/debit are re-read before documenting the GET. */
async function recordPayoutTiming(requestId: string, initial: FirebaseFirestore.DocumentData, payout: any, transfer: any, observedAt: Timestamp) {
  if (!payoutStatuses.includes(payout?.status) || !transferMatches(transfer, requestId, initial)) return false;
  const ref = db.collection('withdrawal_requests').doc(requestId);
  try { return await db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (!current || !sameObservedSource(initial, current, payout.id) ||
        !matchesWithdrawalPayout(requestId, current, payout) ||
        !transferMatches(transfer, requestId, current)) return false;
    const local = await localEvidence(tx, requestId, current);
    if (!local) return false;
    const calendarDate = arrivalCalendarDate(payout.arrival_date);
    const document = { protocol: 'withdrawal_payout_timing_v1', withdrawalRequestId: requestId, ownerId: current.userId,
      providerStatus: payout.status as string, arrivalDateSeconds: calendarDate === null ? null : payout.arrival_date as number,
      arrivalCalendarDate: calendarDate, arrivalQualification: calendarDate === null ? 'unknown' : 'provider_estimate',
      accountId: current.stripeAccountId, payoutId: payout.id as string, transferId: transfer.id as string,
      debitLedgerId: local.debitId, destinationBankId: idOf(payout.destination), amountCents: current.amount, currency: 'CAD',
      identityQualification: current.payoutDestination == null ? 'legacy_saved_payout' : 'frozen_destination',
      identityHash: timingIdentity(current, local.debitId), bankReceiptVerified: false, arrivalGuaranteed: false };
    const earlier = current.payoutTimingObservation;
    // A slower older commit never overwrites a later native observation. Paid
    // is not monotone: a subsequently observed bank failure remains documentable.
    if (earlier?.observedAt instanceof Timestamp) {
      const ordering = earlier.observedAt.seconds - observedAt.seconds || earlier.observedAt.nanoseconds - observedAt.nanoseconds;
      if (ordering > 0) return false;
      if (ordering === 0) {
        if (earlier.contentHash === timingDigest(document)) return earlier.orderingConflict !== true;
        // Equal native instants cannot choose which differing GET is current.
        // Keep the original evidence; expose unknown until a strictly later GET.
        tx.update(ref, { 'payoutTimingObservation.orderingConflict': true });
        return false;
      }
    }
    tx.update(ref, { payoutTimingObservation: { document, contentHash: timingDigest(document), observedAt } });
    return true;
  }); } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    // Documentary availability must not prevent an already-qualified financial
    // completion/recovery from being examined by its unchanged native workflow.
    logger.warn('Withdrawal timing documentation unavailable', { requestId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** A candidate found on an early page is not timestamped at the end of the
 * whole uniqueness scan. One exact documentary GET supplies its own instant;
 * failure here never changes the existing completion/recovery workflow. */
async function documentResolvedPayoutTiming(requestId: string, initial: FirebaseFirestore.DocumentData, payout: any,
  transfer: any, observedAt: Timestamp, stripe: StripeClient) {
  if (!stripe) return false;
  try {
    if (initial.stripePayoutId == null) {
      const exact = await stripe.payouts.retrieve(payout.id, undefined, { stripeAccount: initial.stripeAccountId });
      const exactObservedAt = Timestamp.now();
      if (exact.id !== payout.id || !matchesWithdrawalPayout(requestId, initial, exact)) return false;
      return recordPayoutTiming(requestId, initial, exact, transfer, exactObservedAt);
    }
    return recordPayoutTiming(requestId, initial, payout, transfer, observedAt);
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    logger.warn('Withdrawal exact timing candidate unavailable', { requestId, error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Pure SDK owner/support source. No provider GET, recovery, compensation,
 * account-profile lookup or creation of a missing financial document. */
export async function readWithdrawalTimingSource(tx: FirebaseFirestore.Transaction, requestId: string, ownerId: string) {
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(requestId)) throw new HttpsError('invalid-argument', 'Référence exacte du retrait requise.');
  const snap = await tx.get(db.collection('withdrawal_requests').doc(requestId)), data = snap.data();
  if (!data || data.userId !== ownerId) return null;
  const local = await localEvidence(tx, requestId, data), native = data.payoutTimingObservation, doc = native?.document;
  const destination = data.payoutDestination;
  const nativeIdentityQualified = !!local && /^acct_[A-Za-z0-9]+$/.test(data.stripeAccountId ?? '') &&
    /^tr_[A-Za-z0-9_]+$/.test(data.stripeTransferId ?? '') && data.createdAt instanceof Timestamp &&
    data.createdAt.toMillis() >= 0 && data.createdAt.toMillis() <= Date.now() &&
    (data.currency === 'cad' || destination == null && data.currency == null) &&
    (destination == null ? /^po_[A-Za-z0-9_]+$/.test(data.stripePayoutId ?? '') :
      destination.schemaVersion === 1 && destination.accountId === data.stripeAccountId && destination.country === 'CA' &&
      destination.currency === 'CAD' && /^ba_[A-Za-z0-9]+$/.test(destination.bankAccountId ?? '') &&
      (data.stripePayoutId == null || /^po_[A-Za-z0-9_]+$/.test(data.stripePayoutId)));
  const calendarDate = arrivalCalendarDate(doc?.arrivalDateSeconds);
  const observationQualified = nativeIdentityQualified && native?.orderingConflict !== true && !!doc && doc.protocol === 'withdrawal_payout_timing_v1' &&
    doc.withdrawalRequestId === requestId && doc.ownerId === ownerId && payoutStatuses.includes(doc.providerStatus) &&
    doc.accountId === data.stripeAccountId && doc.transferId === data.stripeTransferId && doc.debitLedgerId === local.debitId &&
    typeof doc.payoutId === 'string' && /^po_[A-Za-z0-9_]+$/.test(doc.payoutId) &&
    (data.stripePayoutId == null && data.payoutDestination?.schemaVersion === 1 || doc.payoutId === data.stripePayoutId) &&
    doc.amountCents === data.amount && doc.currency === 'CAD' &&
    (data.payoutDestination == null ? doc.identityQualification === 'legacy_saved_payout' :
      doc.identityQualification === 'frozen_destination' && doc.destinationBankId === data.payoutDestination.bankAccountId) &&
    (doc.arrivalDateSeconds === null && doc.arrivalCalendarDate === null && doc.arrivalQualification === 'unknown' ||
      calendarDate !== null && doc.arrivalCalendarDate === calendarDate && doc.arrivalQualification === 'provider_estimate') &&
    doc.bankReceiptVerified === false && doc.arrivalGuaranteed === false && native.contentHash === timingDigest(doc) &&
    native.observedAt instanceof Timestamp && native.observedAt.toMillis() >= 0 && native.observedAt.toMillis() <= Date.now();
  const sourceHash = timingDigest(['withdrawal_timing_source_v1', source(data), local?.debitId ?? null,
    data.withdrawalIntent?.payloadHash ?? null, data.status ?? null, data.reconciliationRequired === true,
    data.payoutRecovery?.state ?? null, observationQualified ? native.contentHash : null, native?.orderingConflict === true]);
  return { protocol: 'withdrawal_timing_source_v1', ownerId, withdrawalRequestId: requestId,
    sourceRevision: snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null, sourceHash,
    sourceQualification: nativeIdentityQualified ? 'qualified' : 'unknown',
    requestState: ['processing', 'completed', 'failed'].includes(data.status) ? data.status as string : null,
    amountCents: nativeIdentityQualified ? data.amount as number : null, currency: nativeIdentityQualified ? 'CAD' : null,
    observation: observationQualified ? { protocol: 'withdrawal_payout_timing_v1', providerStatus: doc.providerStatus,
      arrivalDateSeconds: doc.arrivalDateSeconds, arrivalCalendarDate: doc.arrivalCalendarDate, arrivalQualification: doc.arrivalQualification,
      observedAt: native.observedAt.toDate().toISOString(), identityQualification: doc.identityQualification,
      sourceCurrent: doc.identityHash === timingIdentity(data, local!.debitId), bankReceiptVerified: false, arrivalGuaranteed: false } : null,
    bankReceiptVerified: false, financialEffectAuthorized: false };
}

export async function readOwnerWithdrawalTiming(ownerId: string, raw: any, guard?: (tx: FirebaseFirestore.Transaction) => Promise<unknown>) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).some(key => !['mode', 'expectedUid', 'withdrawalRequestId'].includes(key)) || raw.expectedUid !== ownerId) {
    throw new HttpsError('invalid-argument', 'Compte et retrait exacts requis.');
  }
  return db.runTransaction(async tx => {
    await guard?.(tx);
    const result = await readWithdrawalTimingSource(tx, raw.withdrawalRequestId, ownerId);
    if (!result) throw new HttpsError('permission-denied', 'Retrait privé non autorisé.');
    return result;
  });
}

export interface WithdrawalObservation {
  state: 'paid' | 'pending' | 'recovered' | 'awaiting_return' | 'reconciliation_required';
  completedNow: boolean; ownerId: string | null; amountCents: number | null;
  payoutId: string | null; daysToPayout: number | null;
}

/** Events trigger a current read. A saved legacy payout can be serviced only
 * with its original account, real transfer and native debit; no current bank
 * profile is consulted and no new payout is submitted by this observer. */
export async function observeWithdrawalPayout(requestId: string, stripe: StripeClient, candidatePayoutId?: string | null): Promise<WithdrawalObservation> {
  if (!requestId || requestId.includes('/') || requestId.length > 200) throw new Error('Invalid withdrawal reference');
  const ref = db.collection('withdrawal_requests').doc(requestId), initial = (await ref.get()).data();
  let payoutId: string | null = typeof initial?.stripePayoutId === 'string' ? initial.stripePayoutId : null;
  const result = (state: WithdrawalObservation['state'], completedNow = false): WithdrawalObservation => ({ state, completedNow,
    ownerId: typeof initial?.userId === 'string' ? initial.userId : null,
    amountCents: safeCents(initial?.amount) ? initial.amount : null, payoutId,
    daysToPayout: initial?.createdAt instanceof Timestamp ? Math.round((Date.now() - initial.createdAt.toMillis()) / 864000) / 100 : null });
  const block = async (reason: string, evidence: Record<string, unknown> = {}) => {
    await markWithdrawalReconciliation(requestId, reason, evidence); return result('reconciliation_required');
  };
  if (!initial || !stripe) return block(!initial ? 'withdrawal_missing' : 'payout_provider_unavailable');
  const reobserveCompletionConflict = initial.reconciliationReason === 'payout_changed_during_recovery' &&
    canReobserveCompletionConflict(requestId, initial, (await operatorReference(requestId).get()).data());
  if (initial.reconciliationRequired === true && IDENTITY_HOLDS.includes(initial.reconciliationReason) && !reobserveCompletionConflict) return result('reconciliation_required');
  if (candidatePayoutId && initial.stripePayoutId && candidatePayoutId !== initial.stripePayoutId) return block('payout_identity_conflict', { candidatePayoutId });
  let payout: any, transfer: any, payoutObservedAt: Timestamp;
  try {
    payout = await resolveWithdrawalPayout(requestId, initial, stripe);
    payoutObservedAt = Timestamp.now();
    if (!payout) return reobserveCompletionConflict ? result('reconciliation_required') :
      block('payout_outcome_unqualified', { candidatePayoutId: candidatePayoutId ?? null });
    payoutId = payout.id;
    if (candidatePayoutId && candidatePayoutId !== payout.id) return block('payout_candidate_conflict', { candidatePayoutId });
    if (['failed', 'canceled'].includes(payout.status)) {
      if (reobserveCompletionConflict) return result('reconciliation_required');
      const recovery = await revertFailedPayout({ withdrawalRequestId: requestId, payoutId }, stripe);
      return result(recovery.recoveryState === 'not_failed' ? 'pending' : recovery.recoveryState);
    }
    if (payout.status !== 'paid') {
      // Pending/in-transit previously returned before retaining Stripe's native
      // estimate. Document only an exact existing transfer/debit, never submit.
      try {
        if (typeof initial.stripeTransferId === 'string' && /^tr_[A-Za-z0-9_]+$/.test(initial.stripeTransferId)) {
          transfer = await stripe.transfers.retrieve(initial.stripeTransferId);
          await documentResolvedPayoutTiming(requestId, initial, payout, transfer, payoutObservedAt, stripe);
        }
      } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error; logger.warn('Withdrawal timing observation unavailable', { requestId, error: error instanceof Error ? error.message : String(error) }); }
      return result(reobserveCompletionConflict ? 'reconciliation_required' : 'pending');
    }
    if (initial.payoutRecovery != null) {
      try {
        if (typeof initial.stripeTransferId === 'string' && /^tr_[A-Za-z0-9_]+$/.test(initial.stripeTransferId)) {
          await documentResolvedPayoutTiming(requestId, initial, payout, await stripe.transfers.retrieve(initial.stripeTransferId), payoutObservedAt, stripe);
        }
      } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error; logger.warn('Withdrawal timing after recovery unavailable', { requestId, error: error instanceof Error ? error.message : String(error) }); }
      return block(initial.payoutRecovery.state === 'recovered' ? 'payout_paid_after_compensation' : 'payout_changed_during_recovery', { payoutId });
    }
    if (typeof initial.stripeTransferId !== 'string' || !/^tr_[A-Za-z0-9_]+$/.test(initial.stripeTransferId)) return block('withdrawal_transfer_unqualified', { payoutId });
    transfer = await stripe.transfers.retrieve(initial.stripeTransferId);
    if (!transferMatches(transfer, requestId, initial) || transfer.amount_reversed !== 0 || transfer.reversed !== false) return block('withdrawal_transfer_binding_conflict', { payoutId, transferId: initial.stripeTransferId });
    // A paid event can race a bank failure. Read the same payout again after the
    // transfer inspection, before recording any local completion.
    payout = await stripe.payouts.retrieve(payout.id, undefined, { stripeAccount: initial.stripeAccountId });
    payoutObservedAt = Timestamp.now();
    if (!matchesWithdrawalPayout(requestId, initial, payout)) return block('payout_changed_during_recovery', { payoutId });
    await recordPayoutTiming(requestId, initial, payout, transfer, payoutObservedAt);
    if (['failed', 'canceled'].includes(payout.status)) {
      if (reobserveCompletionConflict) return result('reconciliation_required');
      const recovery = await revertFailedPayout({ withdrawalRequestId: requestId, payoutId }, stripe);
      return result(recovery.recoveryState === 'not_failed' ? 'pending' : recovery.recoveryState);
    }
    if (payout.status !== 'paid') return result(reobserveCompletionConflict ? 'reconciliation_required' : 'pending');
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    logger.warn('Withdrawal outcome inspection unavailable', { requestId, error: error instanceof Error ? error.message : String(error) });
    return reobserveCompletionConflict ? result('reconciliation_required') : block('payout_current_proof_unavailable', { payoutId });
  }
  const committed = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const current = (await tx.get(ref)).data();
    if (!current || !sameObservedSource(initial, current, payout.id) || !matchesWithdrawalPayout(requestId, current, payout) || current.payoutRecovery != null) return null;
    if (!['processing', 'completed'].includes(current.status)) return { blocked: 'payout_paid_after_failed_status' };
    const operatorRef = operatorReference(requestId);
    const operator = (await tx.get(operatorRef)).data();
    const resolvesCompletionConflict = reobserveCompletionConflict && canReobserveCompletionConflict(requestId, current, operator);
    // Recovery or identity markers from another workflow are not silently
    // cleared by bookkeeping. These reasons only mean current proof was absent.
    if (current.reconciliationRequired === true && !['payout_outcome_unknown', 'payout_outcome_unqualified', 'payout_provider_unavailable',
      'payout_current_proof_unavailable', 'withdrawal_transfer_unqualified', 'withdrawal_submission_unknown', 'withdrawal_submission_pending'].includes(current.reconciliationReason) &&
      !resolvesCompletionConflict) return { preservedHold: true };
    const local = await localEvidence(tx, requestId, current);
    if (!local) return { blocked: 'withdrawal_local_evidence_unqualified' };
    if (['withdrawal_submission_unknown', 'withdrawal_submission_pending'].includes(current.reconciliationReason) && current.withdrawalIntent == null) return { blocked: 'withdrawal_prior_reconciliation_required' };
    if (local.existingCreditId) return { blocked: 'payout_paid_after_compensation' };
    const completedNow = current.status === 'processing';
    const notices = await prepareOperationalNotices(tx, [{ eventKey: `withdrawal_paid:${requestId}:${payout.id}`, userId: current.userId,
      type: 'withdrawal_update', title: 'Virement confirmé par le prestataire',
      message: 'Le prestataire confirme le paiement de ce virement. Consultez le porte-monnaie pour son suivi et votre banque pour sa disponibilité.',
      data: { ownerId: current.userId, withdrawalRequestId: requestId, payoutId: payout.id, state: 'paid', amountCents: String(current.amount),
        currency: 'CAD', debitLedgerId: local.debitId, transferId: transfer.id } }]);
    await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('withdrawal',ref,current,{ status: 'completed', ...(completedNow ? { completedAt: FieldValue.serverTimestamp() } : {}),
      stripePayoutId: payout.id, payoutOutcome: 'paid', transferOutcome: 'created', reconciliationRequired: false,
      payoutObservation: { schemaVersion: 1, outcome: 'paid', qualification: current.payoutDestination == null ? 'legacy_saved_payout' : 'frozen_destination',
        payoutId: payout.id, accountId: current.stripeAccountId, bankAccountId: idOf(payout.destination), amountCents: current.amount, currency: 'CAD',
        debitLedgerId: local.debitId, transferId: transfer.id, observedAt: FieldValue.serverTimestamp() },
      payoutCompletion: { schemaVersion: 1, withdrawalRequestId: requestId, ownerId: current.userId, amountCents: current.amount, currency: 'CAD',
        accountId: current.stripeAccountId, bankAccountId: idOf(payout.destination), payoutId: payout.id, transferId: transfer.id,
        debitLedgerId: local.debitId, observedAt: FieldValue.serverTimestamp() },
      ownerMessage: 'Le virement bancaire a été confirmé. Un retour bancaire ultérieur reste suivi.', ownerAction: 'refreshWithdrawals', updatedAt: FieldValue.serverTimestamp() }));
    if (operator?.payload?.kind === 'payout_identity_reconciliation' && operator.error === current.reconciliationReason) { await recoveryCommit({refs: [(operatorRef).path]}); tx.set(operatorRef,
      { status: 'resolved', actionRequired: false, resolvedAt: FieldValue.serverTimestamp(),
        ...(resolvesCompletionConflict ? { resolution: { protocol: 'withdrawal_completion_requalification_v1',
          qualification: 'current_native_payout_transfer_and_original_debit', payoutId: payout.id, transferId: transfer.id,
          debitLedgerId: local.debitId, observedAt: FieldValue.serverTimestamp(), providerMutationSubmitted: false } } : {}) }, { merge: true }); }
    notices.commit();
    return { completedNow };
  });
  if (!committed) return block('payout_changed_during_recovery', { payoutId });
  if ('preservedHold' in committed) return result('reconciliation_required');
  if ('blocked' in committed) return block(committed.blocked!, { payoutId });
  return result('paid', committed.completedNow);
}

export async function revertFailedPayout(input: RevertFailedPayoutInput, stripe: StripeClient): Promise<RevertFailedPayoutResult> {
  const requestId = input.withdrawalRequestId;
  if (!requestId || requestId.includes('/') || requestId.length > 200) throw new Error('Invalid withdrawal reference');
  const ref = db.collection('withdrawal_requests').doc(requestId), initial = (await ref.get()).data();
  const ownerId = typeof initial?.userId === 'string' ? initial.userId : null;
  const transferId = typeof initial?.stripeTransferId === 'string' ? initial.stripeTransferId : null;
  let payoutId: string | null = initial?.stripePayoutId ?? null;
  const result = (recoveryState: RevertFailedPayoutResult['recoveryState'], reCredited = false) => ({ recoveryState, reCredited, ownerId, transferId, payoutId });
  const block = async (reason: string, evidence: Record<string, unknown> = {}) => {
    await markWithdrawalReconciliation(requestId, reason, evidence); return result('reconciliation_required');
  };
  if (!initial || !stripe) return block(!initial ? 'withdrawal_missing' : 'payout_provider_unavailable');
  if (initial.reconciliationRequired === true && IDENTITY_HOLDS.includes(initial.reconciliationReason)) return result('reconciliation_required');
  if (input.payoutId && initial.stripePayoutId && input.payoutId !== initial.stripePayoutId) return block('payout_identity_conflict', { candidatePayoutId: input.payoutId });
  let payout: any, transfer: any, returned: any, payoutObservedAt: Timestamp;
  try {
    // A signed event never supplies the financial outcome. Query the exact
    // connected account with the saved identity or its qualified candidate.
    payout = await resolveWithdrawalPayout(requestId, initial, stripe);
    payoutObservedAt = Timestamp.now();
    if (!payout || !matchesWithdrawalPayout(requestId, initial, payout)) return block('payout_outcome_unqualified');
    if (input.payoutId && input.payoutId !== payout.id) return block('payout_candidate_conflict', { candidatePayoutId: input.payoutId });
    payoutId = payout.id;
    if (!['failed', 'canceled'].includes(payout.status)) {
      try {
        if (transferId && /^tr_[A-Za-z0-9_]+$/.test(transferId)) {
          await documentResolvedPayoutTiming(requestId, initial, payout, await stripe.transfers.retrieve(transferId), payoutObservedAt, stripe);
        }
      } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error; logger.warn('Withdrawal timing without current failure unavailable', { requestId, error: error instanceof Error ? error.message : String(error) }); }
      if (initial.payoutRecovery?.state === 'recovered' && payout.status === 'paid') return block('payout_paid_after_compensation', { payoutId });
      return result('not_failed');
    }
    const failureCode = typeof payout.failure_code === 'string' ? payout.failure_code.substring(0, 100) : null;
    const display = withdrawalFailureDisplay(failureCode, payout.status);
    await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const current = (await tx.get(ref)).data();
      if (!current || source(current) !== source(initial)) throw new Error('Withdrawal failure source changed');
      if (!matchesWithdrawalPayout(requestId, current, payout)) throw new Error('Withdrawal failure proof changed');
      const notices = await prepareOperationalNotices(tx, [{
        eventKey: `withdrawal_failure:${requestId}:${payout.id}:${payout.status}:${failureCode ?? 'unspecified'}`, userId: current.userId,
        type: 'withdrawal_update', title: payout.status === 'canceled' ? 'Virement annulé' : 'Échec de virement enregistré',
        message: `${display.message} Consultez le porte-monnaie pour le suivi du retour des fonds.`,
        data: { ownerId: current.userId, withdrawalRequestId: requestId, payoutId: payout.id, state: payout.status, amountCents: String(current.amount),
          currency: 'CAD', bankAction: display.action } }]);
      await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('withdrawal',ref,current,{ payoutFailure: { schemaVersion: 1, payoutId: payout.id, accountId: current.stripeAccountId,
        status: payout.status, code: failureCode, providerMessage: typeof payout.failure_message === 'string' ? payout.failure_message.substring(0, 500) : null,
        observedAt: FieldValue.serverTimestamp() }, failureReason: display.message, ownerBankAction: display.action,
        ...(current.payoutRecovery?.state !== 'recovered' ? { reconciliationRequired: true,
          ownerMessage: display.message, ownerAction: display.action } : {}), updatedAt: FieldValue.serverTimestamp() }));
      notices.commit();
    });
    if (!transferId || !/^tr_[A-Za-z0-9_]+$/.test(transferId)) return block('withdrawal_transfer_unqualified', { payoutId });
    transfer = await stripe.transfers.retrieve(transferId);
    if (!transferMatches(transfer, requestId, initial)) return block('withdrawal_transfer_binding_conflict', { payoutId, transferId });
    await documentResolvedPayoutTiming(requestId, initial, payout, transfer, payoutObservedAt, stripe);
    const returnId = idOf(payout.failure_balance_transaction);
    if (!returnId) return block('payout_return_unconfirmed', { payoutId, transferId });
    returned = await stripe.balanceTransactions.retrieve(returnId, undefined, { stripeAccount: initial.stripeAccountId });
    if (!failureReturnMatches(returned, payout, initial.amount)) return block('payout_return_unqualified', { payoutId, transferId, returnId });
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    logger.error('Withdrawal current proof unavailable', { requestId, error: error instanceof Error ? error.message : String(error) });
    return block('payout_current_proof_unavailable', { payoutId, transferId });
  }
  const leaseOwner = randomUUID();
  const prepared = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const current = (await tx.get(ref)).data();
    if (!current || source(current) !== source(initial) || !matchesWithdrawalPayout(requestId, current, payout) ||
        !['processing', 'completed', 'failed'].includes(current.status)) return null;
    const local = await localEvidence(tx, requestId, current); if (!local) return null;
    const recoveryOperation = db.collection('failed_operations').doc(`withdrawal_recovery_${requestId}`);
    const priorOperation = (await tx.get(recoveryOperation)).data();
    const prior = current.payoutRecovery;
    if (prior && (prior.schemaVersion !== 1 || prior.requestId !== requestId || prior.ownerId !== current.userId ||
        prior.amountCents !== current.amount || prior.currency !== 'CAD' || prior.accountId !== current.stripeAccountId ||
        prior.payoutId !== payout.id || prior.transferId !== transferId || prior.debitLedgerId !== local.debitId ||
        !(prior.requestedAt instanceof Timestamp) || prior.idempotencyKey !== `rev_${transferId}` ||
        !safeCents(prior.leaseUntilMs) || (prior.externalAttemptedAtMs != null && !safeCents(prior.externalAttemptedAtMs)))) return null;
    if (prior?.state === 'recovered') {
      if (!local.existingCreditId || local.existingCreditId !== prior.compensationLedgerId || !(prior.compensatedAt instanceof Timestamp) ||
          typeof prior.reversalId !== 'string' || !/^trr_[A-Za-z0-9_]+$/.test(prior.reversalId) ||
          typeof prior.returnBalanceTransactionId !== 'string' || !/^txn_[A-Za-z0-9_]+$/.test(prior.returnBalanceTransactionId) ||
          prior.failureBalanceTransactionId !== returned.id ||
          transfer.reversed !== true || transfer.amount_reversed !== current.amount ||
          (local.existingCreditId === local.creditRef.id && (local.existingCredit?.withdrawalDebitLedgerId !== local.debitId ||
            local.existingCredit.payoutId !== payout.id || local.existingCredit.transferId !== transferId ||
            local.existingCredit.reversalId !== prior.reversalId || local.existingCredit.returnBalanceTransactionId !== prior.returnBalanceTransactionId))) return null;
      return { replay: true as const, local, intent: prior };
    }
    if(await (await import('./exceptionalRestitution')).exceptionalRestitutionBlocksPayoutRecovery(tx,requestId,current))return {manual:true as const};
    if (prior?.leaseUntilMs > Date.now()) return { waiting: true as const, local, intent: prior };
    const intent = { ...(prior ?? {}), schemaVersion: 1, requestId, ownerId: current.userId, amountCents: current.amount,
      currency: 'CAD', accountId: current.stripeAccountId, payoutId: payout.id, transferId, debitLedgerId: local.debitId,
      originalStatus: prior?.originalStatus ?? current.status, state: 'awaiting_return',
      idempotencyKey: prior?.idempotencyKey ?? `rev_${transferId}`, requestedAt: prior?.requestedAt ?? Timestamp.now(),
      externalAttemptedAtMs: prior?.externalAttemptedAtMs ?? null, leaseOwner, leaseUntilMs: Date.now() + 180000,
      failureBalanceTransactionId: returned.id, existingCreditLedgerId: local.existingCreditId,
      providerFailureCode: typeof payout.failure_code === 'string' ? payout.failure_code : null };
    const notices = await prepareOperationalNotices(tx, [{ eventKey: `withdrawal_return_check:${requestId}:${payout.id}:${returned.id}`,
      userId: current.userId, type: 'withdrawal_update', title: 'Retour des fonds à vérifier',
      message: 'Un échec de virement est confirmé. Le retour des fonds reste à vérifier et une nouvelle demande est suspendue. Consultez le porte-monnaie ou contactez le support.',
      data: { ownerId: current.userId, withdrawalRequestId: requestId, payoutId: payout.id, state: 'awaiting_return', amountCents: String(current.amount),
        currency: 'CAD', debitLedgerId: local.debitId, transferId: transferId!, failureBalanceTransactionId: returned.id } }]);
    await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('withdrawal',ref,current,{ payoutRecovery: intent, status: 'processing', reconciliationRequired: true, payoutOutcome: payout.status,
      ownerMessage: 'Le virement bancaire a échoué. Le retour des fonds est en cours de vérification.', ownerAction: 'refreshWithdrawals',
      updatedAt: FieldValue.serverTimestamp() }));
    await recoveryCommit({refs: [(recoveryOperation).path]});
    tx.set(recoveryOperation, { type: 'payout_reversal_failed', refId: requestId,
      payload: { kind: 'withdrawal_recovery', withdrawalRequestId: requestId, payoutId: payout.id, transferId },
      status: 'pending', attempts: priorOperation?.attempts ?? 0, lastTriedAt: priorOperation?.lastTriedAt ?? null,
      createdAt: priorOperation?.createdAt ?? FieldValue.serverTimestamp() });
    notices.commit();
    return { replay: false as const, local, intent };
  });
  if (!prepared) return block('withdrawal_local_evidence_unqualified', { payoutId, transferId });
  if('manual' in prepared)return block('withdrawal_external_compensation_requires_platform_reconciliation',{payoutId,transferId});
  if ('waiting' in prepared) return result('awaiting_return');
  if (prepared.replay) return result('recovered');
  const intent = prepared.intent;
  let reversal: any;
  try {
    // Resolve an existing reversal FIRST. Partial or ambiguous recoveries are
    // not expanded into another financial request.
    const reversals = await stripe.transfers.listReversals(transferId!, { limit: 100 });
    if (reversals.has_more) return block('withdrawal_reversal_scan_incomplete', { payoutId, transferId });
    if (transfer.amount_reversed > 0) {
      if (transfer.amount_reversed !== initial.amount || transfer.reversed !== true || reversals.data.length !== 1) return block('withdrawal_partial_or_multiple_reversals', { payoutId, transferId });
      reversal = await stripe.transfers.retrieveReversal(transferId!, reversals.data[0].id);
    } else {
      if (reversals.data.length) return block('withdrawal_reversal_proof_conflict', { payoutId, transferId });
      if (intent.externalAttemptedAtMs != null && (!Number.isSafeInteger(intent.externalAttemptedAtMs) ||
          Date.now() - intent.externalAttemptedAtMs >= 23 * 60 * 60 * 1000)) return block('withdrawal_reversal_idempotency_horizon', { payoutId, transferId });
      await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        const current = (await tx.get(ref)).data();
        if (current?.payoutRecovery?.leaseOwner !== leaseOwner || source(current) !== source(initial)) throw new Error('Withdrawal recovery changed');
        if(await (await import('./exceptionalRestitution')).exceptionalRestitutionBlocksPayoutRecovery(tx,requestId,current))throw new Error('External compensation fences transfer reversal');
        await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('withdrawal',ref,current,{ 'payoutRecovery.externalAttemptedAtMs': intent.externalAttemptedAtMs ?? Date.now() }));
      });
      reversal = await stripe.transfers.createReversal(transferId!, { amount: initial.amount }, { idempotencyKey: intent.idempotencyKey });
    }
    if (reversal?.object !== 'transfer_reversal' || !/^trr_[A-Za-z0-9_]+$/.test(reversal.id) || idOf(reversal.transfer) !== transferId ||
        reversal.amount !== initial.amount || reversal.currency !== 'cad' || !idOf(reversal.balance_transaction)) return block('withdrawal_reversal_unqualified', { payoutId, transferId });
    const balance = await stripe.balanceTransactions.retrieve(idOf(reversal.balance_transaction)!);
    if (balance.object !== 'balance_transaction' || balance.id !== idOf(reversal.balance_transaction) || balance.type !== 'transfer_refund' ||
        balance.currency !== 'cad' || balance.amount !== initial.amount || balance.net !== initial.amount || balance.status !== 'available' ||
        !balanceSourceMatches(balance.source, reversal.id, 'transfer_reversal')) {
      return block('withdrawal_platform_return_unqualified', { payoutId, transferId, reversalId: reversal.id });
    }
    // Recheck the actual bank outcome after recovery, before wallet compensation.
    const currentPayout = await stripe.payouts.retrieve(payout.id, undefined, { stripeAccount: initial.stripeAccountId });
    if (!matchesWithdrawalPayout(requestId, initial, currentPayout) || !['failed', 'canceled'].includes(currentPayout.status)) return block('payout_changed_during_recovery', { payoutId, transferId });
    const compensated = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const current = (await tx.get(ref)).data();
      if (!current || source(current) !== source(initial) || current.payoutRecovery?.leaseOwner !== leaseOwner) throw new Error('Withdrawal recovery changed');
      if(await (await import('./exceptionalRestitution')).exceptionalRestitutionBlocksPayoutRecovery(tx,requestId,current))throw new Error('External compensation requires platform reconciliation, not another wallet credit');
      const local = await localEvidence(tx, requestId, current); if (!local) throw new Error('Withdrawal wallet/debit evidence changed');
      const newBalance = local.wallet.balance + (local.existingCreditId ? 0 : current.amount);
      if (!safeCents(newBalance)) throw new Error('Withdrawal compensation balance invalid');
      const notices = await prepareOperationalNotices(tx, [{
        eventKey: `withdrawal_compensated:${requestId}:${payout.id}:${reversal.id}:${balance.id}`, userId: current.userId,
        type: 'withdrawal_update', title: 'Retour des fonds dans le solde confirmé',
        message: 'Le retour des fonds de ce retrait est confirmé et enregistré dans votre solde. Consultez le porte-monnaie pour les mouvements et sa disponibilité courante.',
        data: { ownerId: current.userId, withdrawalRequestId: requestId, payoutId: payout.id, state: 'recovered', amountCents: String(current.amount),
          currency: 'CAD', debitLedgerId: local.debitId, compensationLedgerId: local.existingCreditId ?? local.creditRef.id,
          transferId: transferId!, reversalId: reversal.id, returnBalanceTransactionId: balance.id } }]);
      if (!local.existingCreditId) {
        await recoveryCommit({refs: [(local.walletRef).path]});
    tx.update(local.walletRef, await financialRecoveryWalletFields(local.walletRef,local.wallet,{ balance: FieldValue.increment(current.amount), updatedAt: FieldValue.serverTimestamp() },{balance: ((local.wallet)["balance"]??0) + (current.amount)}));
        await recoveryCommit({refs: [(local.creditRef).path]});
    tx.create(local.creditRef, { type: 'withdrawal_failed', amount: current.amount, currency: 'CAD', balanceAfter: newBalance,
          withdrawalRequestId: requestId, withdrawalDebitLedgerId: local.debitId, payoutId, transferId, reversalId: reversal.id,
          returnBalanceTransactionId: balance.id, description: 'Retrait échoué — retour des fonds confirmé', createdAt: FieldValue.serverTimestamp() });
      }
      await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('withdrawal',ref,current,{ status: 'failed', failedAt: FieldValue.serverTimestamp(), stripePayoutId: payout.id, payoutOutcome: currentPayout.status, transferOutcome: 'reversed',
        'payoutRecovery.state': 'recovered', 'payoutRecovery.reversalId': reversal.id, 'payoutRecovery.returnBalanceTransactionId': balance.id,
        'payoutRecovery.compensationLedgerId': local.existingCreditId ?? local.creditRef.id,
        'payoutRecovery.compensatedAt': FieldValue.serverTimestamp(), 'payoutRecovery.leaseUntilMs': 0,
        reconciliationRequired: false, ownerMessage: 'Le virement a échoué. Le retour des fonds dans votre solde est confirmé.',
        ownerAction: 'refreshWithdrawals', updatedAt: FieldValue.serverTimestamp() }));
      await recoveryCommit({refs: [(db.collection('failed_operations').doc(`withdrawal_recovery_${requestId}`)).path]});
    tx.set(db.collection('failed_operations').doc(`withdrawal_recovery_${requestId}`), { status: 'resolved', resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
      notices.commit();
      return !local.existingCreditId;
    });
    return result('recovered', compensated);
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const current = (await tx.get(ref)).data();
      if (!current || current.payoutRecovery?.state === 'recovered') return;
      if (current.payoutRecovery?.leaseOwner !== leaseOwner) throw new Error('Withdrawal recovery lease changed');
      await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('withdrawal',ref,current,{ reconciliationRequired: true, 'payoutRecovery.state': 'awaiting_return', 'payoutRecovery.leaseUntilMs': 0,
        // Internal API failures may mention credentials. Owner-readable records
        // retain a stable code; bank failure details are separately qualified.
        'payoutRecovery.lastError': 'provider_recovery_unconfirmed',
        ownerMessage: 'Le retour des fonds doit encore être confirmé. Une nouvelle demande de retrait est suspendue.', ownerAction: 'contactSupport' }));
    });
    return result('awaiting_return');
  }
}
