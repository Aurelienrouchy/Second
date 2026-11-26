import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { hasActiveBankDispute } from './bankDispute';
import { hasUnsettledRefund } from './refundState';
import { assertAccountOperationOpen } from './eligibility';
import { hasAccountClosure } from '../shared/eligibility';
import { fraudReviewBlocksProgress } from '../shared/fraudReviewGuard';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import { fraudCandidateMatchesOrder } from './fraudReviewCandidates';

const GUARD_QUERY_LIMIT = 201;
type FinancialReason = 'bank_dispute' | 'refund_unsettled' | 'commercial_dispute' |
  'withdrawal_in_progress' | 'withdrawal_recovery_pending' | 'guard_query_truncated' |
  'guard_evidence_unqualified' | 'wallet_unqualified' | 'wallet_inactive' | 'seller_debt' | 'account_closing' | 'account_unavailable' | 'fraud_review';

/** Owner-only observation of the very queries used for NEW financial admission.
 * This is neither a ledger heuristic nor a promise that arbitrary historical
 * records are complete. A mutation always re-reads these witnesses in its TX. */
export async function readWalletFinancialReview(tx: FirebaseFirestore.Transaction, uid: string,
  operation: 'withdrawal' | 'consume' = 'withdrawal', wallet?: FirebaseFirestore.DocumentData,
  ownNativeWithdrawalId?: string,ownExceptionalCaseId?:string) {
  const reasons = new Set<FinancialReason>();
  let reviewRequired = false;
  const linkedOrders = new Map<string, Set<FinancialReason>>();
  const withdrawalRequestIds = new Set<string>();
  const coverage: {query: string; limit: number; inspectedCount: number; truncated: boolean}[] = [];
  // Resume/consume callers do not all supply a wallet snapshot. The durable
  // exceptional reserve must fence those callers using the same transaction.
  if(!wallet)wallet=(await tx.get(db.collection('wallets').doc(uid))).data();
  if(wallet?.exceptionalRestitution!=null){
    const marker=wallet.exceptionalRestitution;
    // Only the exceptional engine's already qualified native case is excluded
    // while documenting/voiding its OWN reserve. No SDK input sets this value.
    if(!(ownExceptionalCaseId&&marker.caseId===ownExceptionalCaseId)&&
      !await (await import('./exceptionalRestitution')).exceptionalWalletRestitutionAllowsClosure(tx,uid,marker)){
      reasons.add('withdrawal_recovery_pending');reviewRequired=true;
    }
  }
  if (operation === 'withdrawal') {
    const user = (await tx.get(db.collection('users').doc(uid))).data();
    const profile = (await tx.get(db.collection('eligibility_profiles').doc(uid))).data();
    const closure = profile?.accountClosure;
    const pausedFunds = closure?.schemaVersion === 1 && closure.ownerId === uid && closure.phase === 'paused';
    if (!user) { reasons.add('account_unavailable'); reviewRequired = true; }
    if (hasAccountClosure(profile) && !pausedFunds) reasons.add('account_closing');
  }
  const sales = db.collection('transactions').where('sellerId', '==', uid);
  const queries = [
    ['seller_disputed', sales.where('disputed', '==', true)],
    ['seller_bank_dispute_identity', sales.where('disputeId', '>', '')],
    ['seller_bank_dispute_freeze', sales.where('disputeFreezeCents', '>', 0)],
    ['seller_bank_reconciliation', sales.where('bankDispute.reconciliationRequired', '==', true)],
    ['seller_refund_blocked', sales.where('refundBlocked', '==', true)],
    // Ordering selects present fields, including explicit null/false/unknown.
    // An arbitrary truthy flag or an alleged buyer identity grants nothing.
    ['seller_fraud_marker', sales.orderBy('fraudReview', 'asc')],
  ] as const;
  for (const [queryName, query] of queries) {
    const found = await tx.get(query.limit(GUARD_QUERY_LIMIT));
    const truncated = found.size >= GUARD_QUERY_LIMIT;
    coverage.push({query: queryName, limit: GUARD_QUERY_LIMIT, inspectedCount: found.size, truncated});
    if (truncated) { reasons.add('guard_query_truncated'); reviewRequired = true; }
    for (const doc of found.docs) {
      const sale = doc.data(), ownReasons = linkedOrders.get(doc.id) ?? new Set<FinancialReason>();
      if (sale.sellerId !== uid || typeof sale.buyerId !== 'string' || !sale.buyerId ||
          typeof sale.deliveryType !== 'string' || !['shipping', 'meetup'].includes(sale.deliveryType)) {
        ownReasons.add('guard_evidence_unqualified'); reviewRequired = true;
      }
      if (hasActiveBankDispute(sale)) ownReasons.add('bank_dispute');
      if (hasUnsettledRefund(sale)) ownReasons.add('refund_unsettled');
      if (sale.disputed === true && sale.deliveryType !== 'meetup') ownReasons.add('commercial_dispute');
      if (fraudReviewBlocksProgress(sale)) {ownReasons.add('fraud_review'); reviewRequired = true;}
      if (ownReasons.size) { linkedOrders.set(doc.id, ownReasons); for (const reason of ownReasons) reasons.add(reason); }
    }
  }
  // The private projection uses only natively attributed actors. Re-read the
  // actual order and all current receipts before NEW available-fund admission.
  const riskCases = await tx.get(db.collection('fraud_review_cases').where('sellerId', '==', uid).limit(GUARD_QUERY_LIMIT));
  coverage.push({query: 'seller_fraud_cases', limit: GUARD_QUERY_LIMIT, inspectedCount: riskCases.size, truncated: riskCases.size >= GUARD_QUERY_LIMIT});
  if (riskCases.size >= GUARD_QUERY_LIMIT) {reasons.add('guard_query_truncated'); reviewRequired = true;}
  const checked = new Set<string>();
  for (const doc of riskCases.docs) {
    const risk = doc.data(), transactionId = risk.transactionId;
    if (risk.sellerId !== uid || typeof transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(transactionId)) {
      reasons.add('guard_evidence_unqualified'); reviewRequired = true; continue;
    }
    if (checked.has(transactionId)) continue;
    checked.add(transactionId);
    const snap = await tx.get(db.collection('transactions').doc(transactionId)), sale = snap.data();
    if (!sale || sale.sellerId !== uid) {reasons.add('guard_evidence_unqualified'); reviewRequired = true; continue;}
    if (!await fraudReviewAllowsProgress(tx, transactionId, sale, snap)) {
      const ownReasons = linkedOrders.get(transactionId) ?? new Set<FinancialReason>();
      ownReasons.add('fraud_review'); linkedOrders.set(transactionId, ownReasons); reasons.add('fraud_review'); reviewRequired = true;
    }
  }
  // A provider outage can leave an unassociated signed signal. This separate
  // native-reference projection selects no debt or capture: only NEW admission
  // waits for the exact current order/cases to be qualified.
  const candidateCases = await tx.get(db.collection('fraud_review_cases').where('candidateSellerId', '==', uid).limit(GUARD_QUERY_LIMIT));
  coverage.push({query: 'seller_fraud_candidates', limit: GUARD_QUERY_LIMIT, inspectedCount: candidateCases.size, truncated: candidateCases.size >= GUARD_QUERY_LIMIT});
  if (candidateCases.size >= GUARD_QUERY_LIMIT) {reasons.add('guard_query_truncated'); reviewRequired = true;}
  for (const doc of candidateCases.docs) {
    const risk = doc.data(), transactionId = risk.candidateTransactionId;
    if (risk.candidateSellerId !== uid || typeof transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(transactionId)) {
      reasons.add('guard_evidence_unqualified'); reviewRequired = true; continue;
    }
    const snap = await tx.get(db.collection('transactions').doc(transactionId)), sale = snap.data();
    if (!sale || sale.sellerId !== uid || !fraudCandidateMatchesOrder(risk, transactionId, sale)) {
      reasons.add('guard_evidence_unqualified'); reviewRequired = true; continue;
    }
    if (checked.has(transactionId)) continue;
    checked.add(transactionId);
    if (!await fraudReviewAllowsProgress(tx, transactionId, sale, snap)) {
      const ownReasons = linkedOrders.get(transactionId) ?? new Set<FinancialReason>();
      ownReasons.add('fraud_review'); linkedOrders.set(transactionId, ownReasons); reasons.add('fraud_review'); reviewRequired = true;
    }
  }
  const withdrawals = db.collection('withdrawal_requests').where('userId', '==', uid);
  const withdrawalQueries = operation === 'withdrawal' ? [
    ['withdrawal_processing', withdrawals.where('status', '==', 'processing')],
    ['withdrawal_payout_unknown', withdrawals.where('payoutOutcome', '==', 'unknown')],
    ['withdrawal_transfer_unknown', withdrawals.where('transferOutcome', '==', 'unknown')],
    ['withdrawal_reconciliation', withdrawals.where('reconciliationRequired', '==', true)],
  ] as const : [['withdrawal_reconciliation', withdrawals.where('reconciliationRequired', '==', true)]] as const;
  for (const [queryName, query] of withdrawalQueries) {
    const found = await tx.get(query.limit(GUARD_QUERY_LIMIT));
    const truncated = found.size >= GUARD_QUERY_LIMIT;
    coverage.push({query: queryName, limit: GUARD_QUERY_LIMIT, inspectedCount: found.size, truncated});
    if (truncated) { reasons.add('guard_query_truncated'); reviewRequired = true; }
    for (const doc of found.docs) {
      // Internal only, after walletWithdraw qualified THIS immutable receipt.
      // The SDK cannot provide exclusions and other requests remain guarded.
      if (doc.id === ownNativeWithdrawalId && doc.data().userId === uid) continue;
      withdrawalRequestIds.add(doc.id);
      reasons.add(queryName === 'withdrawal_reconciliation' ? 'withdrawal_recovery_pending' : 'withdrawal_in_progress');
      if (doc.data().userId !== uid) { reasons.add('guard_evidence_unqualified'); reviewRequired = true; }
    }
  }
  const rawDebt = wallet && Object.prototype.hasOwnProperty.call(wallet, 'sellerDebt') ? wallet.sellerDebt : 0;
  const sellerDebtCents = Number.isSafeInteger(rawDebt) && rawDebt >= 0 ? rawDebt as number : null;
  if (wallet) {
    if (sellerDebtCents === null || !Number.isSafeInteger(wallet.balance) || wallet.balance < 0 ||
        typeof wallet.currency !== 'string' || wallet.currency.toUpperCase() !== 'CAD') {
      reasons.add('wallet_unqualified'); reviewRequired = true;
    }
    if (wallet.status !== 'active') reasons.add('wallet_inactive');
    if (sellerDebtCents !== null && sellerDebtCents > 0) reasons.add('seller_debt');
  }
  return {protocol: 'wallet_financial_review_v1' as const, ownerId: uid, observedAt: new Date().toISOString(),
    scope: 'server_financial_guards' as const, status: reviewRequired ? 'review_required' as const : reasons.size ? 'blocked' as const : 'clear' as const,
    informationalOnly: true as const, withdrawalPermissionGranted: false as const, globalCoverage: false as const,
    reasons: [...reasons], linkedOrders: [...linkedOrders].map(([transactionId, ownReasons]) => ({transactionId, reasons: [...ownReasons]})),
    withdrawalRequestIds: [...withdrawalRequestIds], coverage, sellerDebtCents};
}

export function assertWalletFinancialReviewClear(review: Awaited<ReturnType<typeof readWalletFinancialReview>>) {
  if (review.status !== 'clear') throw new HttpsError('failed-precondition',
    'Un dossier financier suspend cette opération ou doit être vérifié. Contactez notre équipe.',
    {reason: 'wallet_funds_blocked', financialReviewStatus: review.status, reasons: review.reasons,
      transactionIds: review.linkedOrders.map(order => order.transactionId), withdrawalRequestIds: review.withdrawalRequestIds,
      action: 'contactSupport', paymentPermissionGranted: false});
}

/** Same existing withdrawal protections, only for NEW consumption of available
 * funds. Cash meetup without financial exposure retains its exception. */
export async function assertAvailableWalletFunds(tx: FirebaseFirestore.Transaction, uid: string) {
  await assertAccountOperationOpen(tx, uid);
  assertWalletFinancialReviewClear(await readWalletFinancialReview(tx, uid, 'consume'));
}
