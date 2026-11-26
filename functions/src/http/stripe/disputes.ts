import {financialRecoverySourceFields,prepareFinancialRecoverySource} from "../../utils/financialRecoverySources";
import { FinancialRecoveryBlocked } from "../../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../../utils/financialRecoverySources";
import { financialRecoveryWalletFields } from "../../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
export {recordBankDisputeCaseEvent} from '../../utils/bankDisputeCase';
/** Stripe bank disputes have their own identity, independent of commercial recourse. */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../../config/firebase';
import { captureServerEvent } from '../../lib/analytics';
import { prepareOperationalNotices } from '../../utils/notifications';
import { getStripe } from '../../config/stripe';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { hasUnsettledReturnRequest } from '../../utils/returnRequest';
import { deliveryCorrectionBlocksProgress } from '../../utils/orderModeration';
import { hasUnsettledRefund } from '../../utils/refundState';
import { exactCents } from '../../utils/shippingPurchaseRate';
import { BANK_DISPUTE_OUTCOMES, bankDisputeSaleFunds, hasActiveBankDispute, hasCommercialDispute, positiveCents,
  bankRefundOverlapRequiresReview, nativeBankLossLedgerRecorded } from '../../utils/bankDispute';
import { readFinancialClosureBarriers, recordFinancialExposureDuringClosure } from '../../utils/eligibility';

async function bankAlert(
  tx: FirebaseFirestore.Transaction,
  transactionId: string,
  dispute: any,
  reason: string,
  context: Record<string, unknown> = {}
): Promise<() => void> {
  const ref = db.collection('admin_alerts').doc(`bank_${reason}_${transactionId}_${encodeURIComponent(dispute.id)}`);
  const snap = await tx.get(ref);
  return () => { if (!snap.exists) tx.set(ref, {
    kind: 'bank_dispute_reconciliation_required', severity: 'critical', refId: transactionId,
    message: 'Contestation bancaire : rapprochement manuel requis.',
    context: { reason, disputeId: dispute.id, paymentIntentId: stripeId(dispute.payment_intent), ...context },
    status: 'open', createdAt: FieldValue.serverTimestamp(),
  }); };
}

function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') return value.id;
  return null;
}

async function findTransaction(dispute: any) {
  const paymentIntentId = stripeId(dispute.payment_intent);
  const disputeId = typeof dispute.id === 'string' && dispute.id.length > 0 ? dispute.id : null;
  if (!/^pi_[A-Za-z0-9_]{1,190}$/.test(paymentIntentId ?? '') || !/^du_[A-Za-z0-9_]{1,190}$/.test(disputeId ?? '')) {
    throw new Error('Stripe dispute missing valid payment_intent/id');
  }
  const snap = await db.collection('transactions').where('stripePaymentIntentId', '==', paymentIntentId).limit(2).get();
  if (snap.empty || snap.size !== 1) {
    logger.error('Stripe dispute has no purchase transaction; reconciliation required', { paymentIntentId, disputeId });
    await db.runTransaction(async tx => { const commit = await bankAlert(tx, paymentIntentId!, dispute, snap.empty ? 'unmatched_payment' : 'ambiguous_payment'); commit(); });
    return null;
  }
  return snap.docs[0];
}

type BankNoticeObservation = { qualified: boolean; disputeId: string; paymentIntentId: string | null;
  providerStatus: string | null; chargeId: string | null; amountCents: number | null; currency: string | null; proofHash: string; observedAt: Timestamp };
const bankDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Read-only provider observation must match native purchase evidence before
 * the existing financial transition or its notice can commit. The signed event
 * alone never proves the current outcome; this read creates no provider effect. */
async function observeBankNotice(dispute: any): Promise<BankNoticeObservation> {
  const disputeId = typeof dispute?.id === 'string' ? dispute.id : '';
  const paymentIntentId = stripeId(dispute?.payment_intent);
  const unknown = (): BankNoticeObservation => ({ qualified: false, disputeId, paymentIntentId, providerStatus: null,
    chargeId: null, amountCents: null, currency: null, proofHash: bankDigest([disputeId, paymentIntentId, 'unqualified']), observedAt: Timestamp.now() });
  if (!/^du_[A-Za-z0-9_]{1,190}$/.test(disputeId) || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId ?? '')) return unknown();
  const stripe = getStripe(); if (!stripe) return unknown();
  try {
    const current = await stripe.disputes.retrieve(disputeId);
    if (current.object !== 'dispute' || current.id !== disputeId || stripeId(current.payment_intent) !== paymentIntentId ||
        !/^ch_[A-Za-z0-9_]+$/.test(stripeId(current.charge) ?? '') || current.currency !== 'cad' || !Number.isSafeInteger(current.amount) || current.amount <= 0 || typeof current.status !== 'string') return unknown();
    return { qualified: true, disputeId, paymentIntentId, providerStatus: current.status, chargeId: stripeId(current.charge), amountCents: current.amount,
      currency: current.currency, proofHash: bankDigest([current.id, paymentIntentId, stripeId(current.charge), current.amount, current.currency, current.status]), observedAt: Timestamp.now() };
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    logger.warn('Bank dispute current observation unavailable; notice requires reconciliation', { disputeId,
      error: error instanceof Error ? error.message : 'unknown' });
    return unknown();
  }
}

function qualifyBankSource(data: FirebaseFirestore.DocumentData, dispute: any, observation: BankNoticeObservation) {
  if (!observation.qualified) return { qualified: false, reason: 'current_proof_unavailable', retry: true };
  const total = exactCents(data.totalAmount), captured = positiveCents(data.capturedCardCents);
  const mixed = data.paidVia === 'wallet_and_card' || data.paidVia === 'mixed';
  const wallet = mixed ? data.walletAmountUsed : 0;
  const parties = [data.buyerId, data.sellerId];
  if (parties.some(uid => typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(uid)) || parties[0] === parties[1] ||
      observation.paymentIntentId !== data.stripePaymentIntentId || observation.disputeId !== dispute.id ||
      stripeId(data.stripeChargeId) !== observation.chargeId || observation.currency !== 'cad' ||
      (data.currency != null && !['CAD', 'cad'].includes(data.currency)) || !captured || total === null || total < captured ||
      !Number.isSafeInteger(wallet) || wallet < 0 || captured + wallet !== total ||
      observation.amountCents !== captured || positiveCents(dispute.amount) !== captured ||
      (dispute.currency != null && dispute.currency !== 'cad') ||
      (stripeId(dispute.charge) != null && stripeId(dispute.charge) !== observation.chargeId)) {
    return { qualified: false, reason: 'native_bank_binding_unqualified', retry: false };
  }
  return { qualified: true, reason: null, retry: false };
}

function nativeBankRecordMalformed(data: FirebaseFirestore.DocumentData) {
  if (!Object.prototype.hasOwnProperty.call(data, 'bankDispute')) return false;
  const bank = data.bankDispute;
  // Keep native legacy identities as history; only real du_ provider IDs are
  // accepted at the external entry point. Never silently rename a dossier.
  return !bank || typeof bank !== 'object' || Array.isArray(bank) || !/^(?:du|dp)_[A-Za-z0-9_]+$/.test(bank.id ?? '') ||
    !['open', 'closed'].includes(bank.state) || !Number.isSafeInteger(bank.freezeCents) || bank.freezeCents < 0 ||
    !(bank.openedAt instanceof Timestamp) || (bank.state === 'closed' && !(bank.closedAt instanceof Timestamp)) ||
    (Object.prototype.hasOwnProperty.call(bank, 'reconciliationRequired') && typeof bank.reconciliationRequired !== 'boolean');
}

async function prepareBankNotices(tx: FirebaseFirestore.Transaction, transactionId: string, data: FirebaseFirestore.DocumentData,
  dispute: any, phase: 'created' | 'closed', observation: BankNoticeObservation, reason: string | null = null) {
  const sameIdentity = qualifyBankSource(data, dispute, observation).qualified;
  const open = sameIdentity && ['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review'].includes(observation.providerStatus ?? '');
  const closed = sameIdentity && BANK_DISPUTE_OUTCOMES.has(observation.providerStatus ?? '') && observation.providerStatus === dispute.status;
  const state = !reason && ((phase === 'created' && open) || (phase === 'closed' && closed))
    ? phase === 'created' ? 'opened' : observation.providerStatus! : 'review_required';
  const message = state === 'opened'
    ? 'Une contestation bancaire est ouverte pour cette commande. Consultez le dossier ou contactez le support. Les autres réclamations restent distinctes.'
    : state === 'won'
      ? 'Le prestataire indique que la contestation bancaire est rejetée. Consultez la commande pour le traitement des fonds et les autres dossiers encore en cours.'
      : state === 'lost'
        ? 'Le prestataire indique que la contestation bancaire est clôturée à l’avantage du titulaire de la carte. Consultez la commande pour ses mouvements et les autres dossiers encore en cours.'
        : state === 'warning_closed'
          ? 'Le prestataire indique que cette précontestation bancaire est clôturée. Consultez la commande pour le traitement des fonds et les autres dossiers encore en cours.'
          : 'Le dossier bancaire de cette commande doit être rapproché. Consultez la commande ou contactez le support ; cet avis ne confirme aucune restitution ni disponibilité des fonds.';
  const recipients = [...new Set([data.buyerId, data.sellerId])].filter((userId): userId is string =>
    typeof userId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(userId));
  const notices = await prepareOperationalNotices(tx, recipients.map(userId => ({
    eventKey: `bank_notice:${transactionId}:${dispute.id}:${phase}:${state}:${reason ?? 'none'}:${observation.proofHash}`,
    userId, type: 'order_moderation', title: state === 'review_required' ? 'Dossier bancaire à vérifier' : 'Mise à jour de la contestation bancaire', message,
    data: { ownerId: userId, transactionId, disputeId: dispute.id,
      paymentIntentId: typeof data.stripePaymentIntentId === 'string' ? data.stripePaymentIntentId : 'unqualified',
      providerOutcome: observation.providerStatus ?? 'unqualified', noticeState: state, observationHash: observation.proofHash,
      noticeReason: reason ?? 'none' },
  })));
  return () => {
    notices.commit();
    tx.set(db.collection('transactions').doc(transactionId), { bankNoticeObservation: { schemaVersion: 1,
      ...observation, phase, noticeState: state, reason, notificationIds: notices.notificationIds,
      buyerId: data.buyerId, sellerId: data.sellerId, recordedAt: FieldValue.serverTimestamp() } }, { merge: true });
  };
}

function bankRecord(data: FirebaseFirestore.DocumentData, dispute: any, freezeCents: number) {
  return {
    id: dispute.id,
    state: 'open',
    outcome: null,
    stripeStatus: typeof dispute.status === 'string' ? dispute.status : 'unknown',
    reason: typeof dispute.reason === 'string' ? dispute.reason : null,
    amountCents: positiveCents(dispute.amount),
    freezeCents,
    statusBeforeOpen: typeof data.status === 'string' ? data.status : null,
    commercialDisputedBeforeOpen: hasCommercialDispute(data),
    openedAt: FieldValue.serverTimestamp(),
  };
}

function bankLossHistoryNeedsReview(data: FirebaseFirestore.DocumentData): boolean {
  const bank = data.bankDispute;
  const closedLoss = bank?.state === 'closed' && bank.outcome === 'lost' ||
    !bank && !!data.disputeClosedAt && data.disputeOutcome === 'lost';
  return closedLoss && !nativeBankLossLedgerRecorded(bank);
}

/** The original sale amounts cannot settle a bank/refund overlap. Preserve
 * every applied effect, reserve and dossier identity; only document a separate
 * obligation. The same order is read by financial reservations in their TX,
 * and the existing disputeId query discovers this witness even after closure.
 */
async function prepareRefundOverlapReview(tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData,
  dispute: any, phase: 'created' | 'closed', observation: BankNoticeObservation,
  sourceRevision: Timestamp | null) {
  const qualification = qualifyBankSource(data, dispute, observation);
  const reason = bankRefundOverlapRequiresReview(data) ? 'refund_overlap_requires_reconciliation' : 'bank_loss_ledger_unqualified';
  const storedId = typeof data.bankDispute?.id === 'string' && data.bankDispute.id
    ? data.bankDispute.id : typeof data.disputeId === 'string' && data.disputeId ? data.disputeId : null;
  const commitAlert = await bankAlert(tx, ref.id, dispute, reason, {
    storedDisputeId: storedId, currentOutcome: observation.providerStatus,
    providerSourceQualified: qualification.qualified,
    providerSourceReason: qualification.reason,
    netSellerDebitCents: null, netWalletCreditCents: null,
  });
  const commitNotice = await prepareBankNotices(tx, ref.id, data, dispute, phase, observation, reason);
  return {retry: qualification.retry, commit: () => {
    const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
      // Retain the old identity if present. Neither a second dossier nor a
      // changed outcome silently replaces an earlier local financial proof.
      disputeId: typeof data.disputeId === 'string' && data.disputeId ? data.disputeId : storedId ?? dispute.id,
    };
    if (!Object.prototype.hasOwnProperty.call(data, 'bankRefundReconciliation')) {
      update.bankRefundReconciliation = {
        protocol: 'bank_refund_reconciliation_v1', transactionId: ref.id, disputeId: dispute.id,
        storedDisputeId: storedId, paymentIntentId: stripeId(dispute.payment_intent),
        reason, reviewRequired: true, firstObservedAt: observation.observedAt,
        sourceRevision, observationHash: observation.proofHash,
        providerSourceQualified: qualification.qualified,
        providerStatus: qualification.qualified ? observation.providerStatus : null,
        providerAmountCents: qualification.qualified ? observation.amountCents : null,
        providerCurrency: qualification.qualified ? observation.currency : null,
        netSellerDebitCents: null, netWalletCreditCents: null,
        newFinancialEffectAuthorized: false, providerRestitutionVerified: false,
      };
    }
    if (!Object.prototype.hasOwnProperty.call(data, 'bankDispute')) {
      update.bankDispute = {...bankRecord(data, {...dispute, id: storedId ?? dispute.id}, positiveCents(data.disputeFreezeCents)),
        // This is a logical guard only, not a new monetary reservation.
        stripeStatus: qualification.qualified ? observation.providerStatus : 'current_proof_review',
        amountCents: qualification.qualified ? observation.amountCents : null, reconciliationRequired: true};
    } else if (!nativeBankRecordMalformed(data)) {
      update['bankDispute.reconciliationRequired'] = true;
      if (data.bankDispute.id !== dispute.id && !data.bankDispute.conflictingDisputeId)
        update['bankDispute.conflictingDisputeId'] = dispute.id;
    }
    // A malformed bank witness or reconciliation marker remains intact. The
    // separate presence guard closes NEW permissions without inventing repair.
    tx.update(ref, update);
    commitAlert(); commitNotice();
  }};
}

export async function handleDisputeCreated(dispute: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/disputes.handleDisputeCreated"}, async () => {
  const doc = await findTransaction(dispute);
  if (!doc) return;
  const observation = await observeBankNotice(dispute);
  const result = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const snap = await tx.get(doc.ref);
    if (!snap.exists) return { retry: false };
    const data = snap.data()!;
    const barriers = await readFinancialClosureBarriers(tx, [data.buyerId, data.sellerId]);
    const recordExposure = (kind: string) => recordFinancialExposureDuringClosure(tx, barriers,
      { source: 'stripe_bank_dispute', transactionId: doc.id, disputeId: dispute.id, kind });
    if (bankRefundOverlapRequiresReview(data) || bankLossHistoryNeedsReview(data)) {
      const review = await prepareRefundOverlapReview(tx, doc.ref, data, dispute, 'created', observation, snap.updateTime ?? null);
      review.commit(); recordExposure('bank_refund_reconciliation_required');
      return {retry: review.retry};
    }
    if (nativeBankRecordMalformed(data)) {
      const commitAlert = await bankAlert(tx, doc.id, dispute, 'native_bank_record_unqualified');
      const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'created', observation, 'native_bank_record_unqualified');
      commitAlert(); commitNotice(); recordExposure('native_bank_record_unqualified');
      // Keep the malformed witness for the operator. Its signed native case
      // identity remains discoverable by the existing financial guard query.
      await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { disputeId: typeof data.disputeId === 'string' && data.disputeId ? data.disputeId : dispute.id });
      return { retry: false };
    }
    const qualification = qualifyBankSource(data, dispute, observation);
    const terminal = data.bankDispute?.id === dispute.id && data.bankDispute.state === 'closed' &&
      data.bankDispute.closedAt instanceof Timestamp && BANK_DISPUTE_OUTCOMES.has(data.bankDispute.outcome);
    if (terminal && qualification.qualified && data.bankDispute.outcome === observation.providerStatus) {
      const commitNotice = await prepareBankNotices(tx, doc.id, data, { ...dispute, status: observation.providerStatus }, 'closed', observation,
        data.bankDispute.reconciliationRequired === true ? 'native_reconciliation_required' : null);
      commitNotice(); return { retry: false }; // A delayed created event cannot reopen it.
    }
    if (!qualification.qualified || !['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review'].includes(observation.providerStatus ?? '')) {
      const reason = qualification.reason ?? 'created_outcome_no_longer_open';
      const commitAlert = await bankAlert(tx, doc.id, dispute, reason, { currentOutcome: observation.providerStatus });
      const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'created', observation, reason);
      commitAlert(); commitNotice(); recordExposure('created_current_proof_review');
      // Preserve every financial bucket and the commercial status. A native
      // identity guard prevents consumption/withdrawal while this is open.
      if (!data.bankDispute && !data.disputeId) { await recoveryCommit({refs: [(doc.ref).path]}); tx.update(doc.ref, {
        bankDispute: { ...bankRecord(data, dispute, 0), stripeStatus: 'current_proof_review',
          ...(qualification.retry ? {} : { reconciliationRequired: true }) }, disputeId: dispute.id }); }
      return { retry: qualification.retry };
    }
    // Includes closed-before-created delivery, replays and unqualified legacy IDs.
    if (data.bankDispute || data.disputeId) {
      if ((data.bankDispute?.id ?? data.disputeId) !== dispute.id) {
        logger.error('Stripe bank dispute identity mismatch; reconciliation required', { transactionId: doc.id, disputeId: dispute.id });
        const commitAlert = await bankAlert(tx, doc.id, dispute, 'identity_conflict', { storedDisputeId: data.bankDispute?.id ?? data.disputeId });
        const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'created', observation, 'identity_conflict');
        commitAlert(); commitNotice();
        recordExposure('created_identity_conflict');
        // A new dossier after a closed dossier is real exposure, even though
        // it cannot automatically replace the original reconciliation record.
        const bank = data.bankDispute ?? bankRecord(data, { ...dispute, id: data.disputeId }, positiveCents(data.disputeFreezeCents));
        await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { bankDispute: { ...bank, state: 'open', outcome: null, stripeStatus: 'identity_conflict',
          conflictingDisputeId: dispute.id, reconciliationRequired: true }, disputeId: bank.id });
      } else if (!data.bankDispute && !(data.disputeClosedAt && BANK_DISPUTE_OUTCOMES.has(data.disputeOutcome))) {
        // Adopt an already frozen legacy dossier without freezing it twice.
        const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'created', observation);
        commitNotice();
        await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { bankDispute: { ...bankRecord(data, dispute, positiveCents(data.disputeFreezeCents)),
          statusBeforeOpen: typeof data.statusBeforeDispute === 'string' ? data.statusBeforeDispute : (typeof data.status === 'string' ? data.status : null) } });
        recordExposure('created_legacy_adoption');
      } else if (hasActiveBankDispute(data)) {
        const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'created', observation);
        commitNotice();
        recordExposure('created_open_dossier');
      }
      return { retry: false };
    }
    const refunded = data.status === 'refunded' || !!data.refundedAt;
    const walletRef = typeof data.sellerId === 'string' && data.sellerId.length > 0 ? db.collection('wallets').doc(data.sellerId) : null;
    const walletSnap = !refunded && walletRef ? await tx.get(walletRef) : null;
    // Estimates are never proof of a seller credit. Debt repaid at sale credit
    // belongs to gross refund exposure but never entered withdrawable balance.
    const releasedCents = walletRef && walletSnap?.exists
      ? (await bankDisputeSaleFunds(tx, walletRef, data, doc.id)).releasedCents : 0;
    const freezeCents = walletSnap?.exists
      ? Math.min(releasedCents, positiveCents(walletSnap.data()!.balance)) : 0;
    const bank = bankRecord(data, dispute, freezeCents);
    const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'created', observation);
    recordExposure('created');
    await prepareFinancialRecoverySource('purchase',doc.ref.path,data);
    if (freezeCents > 0 && walletRef && walletSnap) {
      await recoveryCommit({refs: [(walletRef).path]});
    tx.update(walletRef, await financialRecoveryWalletFields(walletRef,walletSnap!,{ balance: FieldValue.increment(-freezeCents), heldBalance: FieldValue.increment(freezeCents), updatedAt: FieldValue.serverTimestamp() },{balance: ((walletSnap!.data()??{})["balance"]??0) + (-freezeCents),heldBalance: ((walletSnap!.data()??{})["heldBalance"]??0) + (freezeCents)}));
      await recoveryCommit({refs: [(walletRef.collection('ledger').doc()).path]});
    tx.set(walletRef.collection('ledger').doc(), {
        type: 'dispute_hold', amount: freezeCents, balanceAfter: walletSnap.data()!.balance - freezeCents,
        description: 'Contestation bancaire ouverte — fonds gelés', transactionId: doc.id, disputeId: dispute.id,
        createdAt: FieldValue.serverTimestamp(), status: 'held',
      });
    }
    const update: Record<string, unknown> = { bankDispute: bank, disputeId: dispute.id, disputeFreezeCents: freezeCents };
    // Preserve an existing commercial dispute/return and never resurrect a refund.
    if (!refunded) {
      update.disputed = true;
      if (!bank.commercialDisputedBeforeOpen) {
        update.status = 'disputed';
        update.statusBeforeDispute = bank.statusBeforeOpen;
        update.disputedAt = FieldValue.serverTimestamp();
        update.disputeReason = bank.reason;
      }
    }
    await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, await financialRecoverySourceFields('purchase',doc.ref,data,update));
    commitNotice();
    return { retry: false };
  });
  if (result?.retry) throw new Error('Bank dispute observation unavailable; native review and notices committed, retry required');

    });
  }

export async function handleDisputeClosed(dispute: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/disputes.handleDisputeClosed"}, async () => {
  const doc = await findTransaction(dispute);
  if (!doc) return;
  const observation = await observeBankNotice(dispute);
  const outcome = dispute.status;
  const result = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const snap = await tx.get(doc.ref);
    if (!snap.exists) return null;
    const data = snap.data()!;
    const barriers = await readFinancialClosureBarriers(tx, [data.buyerId, data.sellerId]);
    const recordExposure = (kind: string) => recordFinancialExposureDuringClosure(tx, barriers,
      { source: 'stripe_bank_dispute', transactionId: doc.id, disputeId: dispute.id, kind });
    if (bankRefundOverlapRequiresReview(data) || bankLossHistoryNeedsReview(data)) {
      const review = await prepareRefundOverlapReview(tx, doc.ref, data, dispute, 'closed', observation, snap.updateTime ?? null);
      review.commit(); recordExposure('bank_refund_reconciliation_required');
      return review.retry ? {retry: true} : null;
    }
    const storedId = data.bankDispute?.id ?? data.disputeId;
    const nativeBankMalformed = nativeBankRecordMalformed(data);
    if (nativeBankMalformed) {
      const commitAlert = await bankAlert(tx, doc.id, dispute, 'native_bank_record_unqualified');
      const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'closed', observation, 'native_bank_record_unqualified');
      commitAlert(); commitNotice(); recordExposure('native_bank_record_unqualified');
      await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { disputeId: typeof data.disputeId === 'string' && data.disputeId ? data.disputeId : dispute.id });
      return null;
    }
    if (data.bankDispute?.conflictingDisputeId) {
      const commitAlert = await bankAlert(tx, doc.id, dispute, 'identity_conflict', { storedDisputeId: storedId });
      const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'closed', observation, 'identity_conflict');
      commitAlert(); commitNotice();
      recordExposure('closure_identity_conflict');
      return null;
    }
    if (storedId && storedId !== dispute.id) {
      logger.error('Stripe bank closure identity mismatch; reconciliation required', { transactionId: doc.id, disputeId: dispute.id, storedId });
      const commitAlert = await bankAlert(tx, doc.id, dispute, 'foreign_closure', { storedDisputeId: storedId });
      const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'closed', observation, 'foreign_closure');
      commitAlert(); commitNotice();
      recordExposure('foreign_closure');
      return null;
    }
    // Match on dossier identity, never on the mutable purchase status.
    if ((data.bankDispute?.state === 'closed' && data.bankDispute.closedAt && BANK_DISPUTE_OUTCOMES.has(data.bankDispute.outcome)) ||
      (!data.bankDispute && data.disputeClosedAt && BANK_DISPUTE_OUTCOMES.has(data.disputeOutcome))) {
      const priorOutcome = data.bankDispute?.outcome ?? data.disputeOutcome;
      const qualification = qualifyBankSource(data, dispute, observation);
      const revision = qualification.qualified && observation.providerStatus !== priorOutcome;
      const reason = revision ? 'closure_outcome_changed' : !qualification.qualified ? qualification.reason :
        data.bankDispute?.reconciliationRequired === true ? 'native_reconciliation_required' : null;
      const commitAlert = reason ? await bankAlert(tx, doc.id, dispute, reason!, { priorOutcome, currentOutcome: observation.providerStatus }) : null;
      const commitNotice = await prepareBankNotices(tx, doc.id, data,
        qualification.qualified && !revision ? { ...dispute, status: priorOutcome } : dispute, 'closed', observation, reason);
      commitAlert?.(); commitNotice();
      if ((revision || (observation.qualified && !qualification.qualified)) && data.bankDispute) {
        await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { 'bankDispute.reconciliationRequired': true });
      }
      return qualification.retry ? { retry: true } : null;
    }
    const qualification = qualifyBankSource(data, dispute, observation);
    if (!qualification.qualified || !BANK_DISPUTE_OUTCOMES.has(observation.providerStatus ?? '') || observation.providerStatus !== outcome) {
      const reason = qualification.reason ?? (BANK_DISPUTE_OUTCOMES.has(observation.providerStatus ?? '') ? 'event_outcome_superseded' : 'current_outcome_not_terminal');
      const commitAlert = await bankAlert(tx, doc.id, dispute, reason, { currentOutcome: observation.providerStatus, eventOutcome: outcome ?? null });
      const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'closed', observation, reason);
      commitAlert(); commitNotice(); recordExposure('closure_current_proof_review');
      if (!data.bankDispute) { await recoveryCommit({refs: [(doc.ref).path]}); tx.update(doc.ref, { bankDispute: { ...bankRecord(data, dispute, positiveCents(data.disputeFreezeCents)),
        stripeStatus: 'current_proof_review', ...(qualification.retry ? {} : { reconciliationRequired: true }) }, disputeId: dispute.id }); }
      // A missing current read retries the native event. Divergent/partial
      // outcomes remain operator cases; no blind refund/debt/release occurs.
      return qualification.retry ? { retry: true } : null;
    }
    if (data.bankDispute?.reconciliationRequired === true) {
      const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'closed', observation, 'native_reconciliation_required');
      commitNotice(); recordExposure('native_reconciliation_required');
      return null; // A fresh provider result does not settle an unrelated hold.
    }
    const bank = data.bankDispute ?? {
      ...bankRecord(data, dispute, positiveCents(data.disputeFreezeCents)),
      statusBeforeOpen: typeof data.statusBeforeDispute === 'string' ? data.statusBeforeDispute : (typeof data.status === 'string' ? data.status : null),
    };
    const totalCents = typeof data.totalAmount === 'number' ? Math.round(data.totalAmount * 100) : 0;
    const mixed = data.paidVia === 'wallet_and_card' || data.paidVia === 'mixed';
    const cardCents = positiveCents(data.capturedCardCents) || Math.max(0, totalCents - (mixed ? positiveCents(data.walletAmountUsed) : 0));
    const partial = outcome === 'lost' && !(cardCents > 0 && positiveCents(dispute.amount) === cardCents);
    if (!BANK_DISPUTE_OUTCOMES.has(outcome) || partial) {
      // Persist even if closed arrived first: an unknown outcome must not leave
      // an unguarded purchase. Partial losses require explicit reconciliation.
      const commitAlert = await bankAlert(tx, doc.id, dispute, partial ? 'unqualified_loss' : 'unknown_outcome', { outcome: outcome ?? null, amountCents: positiveCents(dispute.amount), expectedCardCents: cardCents });
      const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'closed', observation, partial ? 'unqualified_loss' : 'unknown_outcome');
      commitAlert(); commitNotice();
      recordExposure(partial ? 'unqualified_loss' : 'unknown_outcome');
      await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, {
        bankDispute: { ...bank, state: 'open', outcome: null, stripeStatus: typeof outcome === 'string' ? outcome : 'unknown',
          ...(partial ? { reconciliationRequired: true } : {}) },
        disputeId: dispute.id,
      });
      logger.error('Stripe bank closure cannot settle automatically', { transactionId: doc.id, disputeId: dispute.id, outcome: outcome ?? null, partial });
      return null;
    }
    const alreadyRefunded = data.status === 'refunded' || !!data.refundedAt;
    const freezeCents = positiveCents(bank.freezeCents);
    const refundFreeze = !alreadyRefunded && outcome === 'lost' ? positiveCents(data.refund?.freezeCents) : 0;
    const sellerExposure = !alreadyRefunded && outcome === 'lost' ? positiveCents(data.sellerCreditedCents) : 0;
    const sellerRef = typeof data.sellerId === 'string' && data.sellerId.length > 0 ? db.collection('wallets').doc(data.sellerId) : null;
    const sellerSnap = sellerRef ? await tx.get(sellerRef) : null;
    const buyerWalletCents = !alreadyRefunded && outcome === 'lost' && mixed ? positiveCents(data.walletAmountUsed) : 0;
    const buyerRef = buyerWalletCents > 0 && typeof data.buyerId === 'string' && data.buyerId.length > 0 ? db.collection('wallets').doc(data.buyerId) : null;
    const buyerSnap = buyerRef ? await tx.get(buyerRef) : null;
    const funds = sellerRef && sellerSnap?.exists && sellerExposure > 0
      ? await bankDisputeSaleFunds(tx, sellerRef, data, doc.id) : { pendingCents: 0, heldCents: 0, releasedCents: 0 };
    if ((sellerExposure > 0 && !sellerRef) || (buyerWalletCents > 0 && !buyerRef)) {
      const commitAlert = await bankAlert(tx, doc.id, dispute, 'missing_party_identity', { sellerExposure, buyerWalletCents });
      const commitNotice = typeof data.buyerId === 'string' && typeof data.sellerId === 'string'
        ? await prepareBankNotices(tx, doc.id, data, dispute, 'closed', observation, 'missing_party_identity') : null;
      commitAlert(); commitNotice?.();
      recordExposure('missing_party_identity');
      await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { bankDispute: { ...bank, state: 'open', outcome: null, stripeStatus: outcome, reconciliationRequired: true }, disputeId: dispute.id });
      return null;
    }
    if (!alreadyRefunded && outcome !== 'lost' && freezeCents > 0 && !sellerSnap?.exists) {
      const commitAlert = await bankAlert(tx, doc.id, dispute, 'missing_frozen_wallet', { freezeCents });
      const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'closed', observation, 'missing_frozen_wallet');
      commitAlert(); commitNotice();
      recordExposure('missing_frozen_wallet');
      await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { bankDispute: { ...bank, state: 'open', outcome: null, stripeStatus: outcome, reconciliationRequired: true }, disputeId: dispute.id });
      return null;
    }
    const openClaims = await tx.get(db.collection('disputes').where('transactionId', '==', doc.id).where('status', '==', 'open').limit(1));
    const commercialActive = bank.commercialDisputedBeforeOpen === true || hasCommercialDispute(data) || !openClaims.empty ||
      hasUnsettledReturnRequest(data) || deliveryCorrectionBlocksProgress(data) || hasUnsettledRefund(data);
    const commitRefundRaceAlert = alreadyRefunded && freezeCents > 0 ? await bankAlert(tx, doc.id, dispute, 'refund_race_hold', { freezeCents }) : null;
    const commitCommercialAlert = outcome === 'lost' && !alreadyRefunded && commercialActive
      ? await bankAlert(tx, doc.id, dispute, 'commercial_after_loss', {
        nextAction: 'Examiner le dossier commercial séparément du règlement bancaire, sans nouveau mouvement depuis cet avis.',
      }) : null;
    const commitNotice = await prepareBankNotices(tx, doc.id, data, dispute, 'closed', observation,
      bank.reconciliationRequired === true || (alreadyRefunded && freezeCents > 0) ? 'native_reconciliation_required' : null);
    // No alert helper buffers writes until EVERY remaining read is complete.
    await prepareFinancialRecoverySource('purchase',doc.ref.path,data);
    commitRefundRaceAlert?.(); commitCommercialAlert?.();
    if (outcome === 'lost' || freezeCents > 0 || buyerWalletCents > 0 || bank.reconciliationRequired === true) recordExposure('closed_financial_effect');
    // A refunded status does not prove which aggregate bucket the old refund
    // consumed. Retain the full observed bank reserve for explicit reconciliation.
    let retainedFreeze = freezeCents;
    if (sellerRef && sellerSnap?.exists && !alreadyRefunded) {
      const wallet = sellerSnap.data()!;
      const pending = positiveCents(wallet.pendingBalance), held = positiveCents(wallet.heldBalance), balance = positiveCents(wallet.balance);
      const fromPending = Math.min(sellerExposure, pending, funds.pendingCents);
      const fromHeld = Math.min(sellerExposure - fromPending, held, funds.heldCents + freezeCents + refundFreeze);
      const fromBalance = Math.min(sellerExposure - fromPending - fromHeld, balance);
      const debt = sellerExposure - fromPending - fromHeld - fromBalance;
      const residual = Math.min(Math.max(0, freezeCents - fromHeld), held - fromHeld);
      // A successful bank closure does not grant permission to dismiss an open
      // commercial case. Retain its hold until resolveDispute handles it.
      const release = outcome === 'lost' || !commercialActive ? residual : 0;
      retainedFreeze = residual - release;
      if (sellerExposure > 0 || release > 0) {
        await recoveryCommit({refs: [(sellerRef).path]});
    tx.update(sellerRef, await financialRecoveryWalletFields(sellerRef,sellerSnap!,{ pendingBalance: FieldValue.increment(-fromPending), heldBalance: FieldValue.increment(-fromHeld - release),
          balance: FieldValue.increment(-fromBalance + release), sellerDebt: FieldValue.increment(debt), updatedAt: FieldValue.serverTimestamp() },{pendingBalance: ((sellerSnap!.data()??{})["pendingBalance"]??0) + (-fromPending),heldBalance: ((sellerSnap!.data()??{})["heldBalance"]??0) + (-fromHeld - release),balance: ((sellerSnap!.data()??{})["balance"]??0) + (-fromBalance + release),sellerDebt: ((sellerSnap!.data()??{})["sellerDebt"]??0) + (debt)}));
      }
      if (sellerExposure > 0) {
        await recoveryCommit({refs: [(sellerRef.collection('ledger').doc()).path]});
    tx.set(sellerRef.collection('ledger').doc(), {
          type: 'refund_debit', amount: fromPending + fromHeld + fromBalance, balanceAfter: balance - fromBalance + release,
          description: 'Contestation bancaire perdue — débit vendeur', transactionId: doc.id, disputeId: dispute.id,
          createdAt: FieldValue.serverTimestamp(), ...(debt > 0 ? { debtRecorded: debt } : {}),
        });
      }
      if (release > 0) {
        await recoveryCommit({refs: [(sellerRef.collection('ledger').doc()).path]});
    tx.set(sellerRef.collection('ledger').doc(), {
          type: 'dispute_hold_released', amount: release, balanceAfter: balance - fromBalance + release,
          description: 'Contestation bancaire clôturée — fonds gelés restitués', transactionId: doc.id, disputeId: dispute.id,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    } else if (sellerRef && sellerExposure > 0) {
      await recoveryCommit({refs: [(sellerRef).path]});
    tx.set(sellerRef, await financialRecoveryWalletFields(sellerRef,sellerSnap!,{ sellerDebt: FieldValue.increment(sellerExposure), updatedAt: FieldValue.serverTimestamp() },{sellerDebt: ((sellerSnap!.data()??{})["sellerDebt"]??0) + (sellerExposure)}), { merge: true });
      await recoveryCommit({refs: [(sellerRef.collection('ledger').doc()).path]});
    tx.set(sellerRef.collection('ledger').doc(), { type: 'refund_debit', amount: 0, balanceAfter: 0, debtRecorded: sellerExposure,
        description: 'Contestation bancaire perdue — dette (porte-monnaie absent)', transactionId: doc.id, disputeId: dispute.id, createdAt: FieldValue.serverTimestamp() });
      retainedFreeze = 0;
    }
    if (buyerRef) {
      const balanceBefore = positiveCents(buyerSnap?.data()?.balance);
      if (buyerSnap?.exists) { await recoveryCommit({refs: [(buyerRef).path]}); tx.update(buyerRef, await financialRecoveryWalletFields(buyerRef,buyerSnap!,{ balance: FieldValue.increment(buyerWalletCents), updatedAt: FieldValue.serverTimestamp() },{balance: ((buyerSnap!.data()??{})["balance"]??0) + (buyerWalletCents)})); }
      else { await recoveryCommit({refs: [(buyerRef).path]}); tx.set(buyerRef, await financialRecoveryWalletFields(buyerRef,buyerSnap!,{ balance: FieldValue.increment(buyerWalletCents), pendingBalance:0,heldBalance:0,sellerDebt:0,status: 'active', currency: 'cad', updatedAt: FieldValue.serverTimestamp() },{balance: buyerWalletCents}), { merge: true }); }
      await recoveryCommit({refs: [(buyerRef.collection('ledger').doc()).path]});
    tx.set(buyerRef.collection('ledger').doc(), { type: 'refund_credit', amount: buyerWalletCents, balanceAfter: balanceBefore + buyerWalletCents,
        description: 'Contestation bancaire perdue — portion porte-monnaie restituée', transactionId: doc.id, disputeId: dispute.id, createdAt: FieldValue.serverTimestamp() });
    }
    const reconciliationRequired = bank.reconciliationRequired === true || (alreadyRefunded && freezeCents > 0);
    const update: Record<string, unknown> = {
      bankDispute: { ...bank, state: 'closed', outcome, stripeStatus: outcome, freezeCents: retainedFreeze, closedAt: FieldValue.serverTimestamp(),
        ...(outcome === 'lost' && !alreadyRefunded ? { ledgerReconciledAt: FieldValue.serverTimestamp() } : {}),
        ...(reconciliationRequired ? { reconciliationRequired: true } : {}) },
      // External bank closure is not local reserve settlement: keep both active
      // projections until explicit reconciliation, even if disputed was cleared.
      disputeId: reconciliationRequired ? dispute.id : FieldValue.delete(), disputeFreezeCents: retainedFreeze,
      disputeClosedAt: FieldValue.serverTimestamp(),
    };
    if (outcome === 'lost' && !alreadyRefunded) {
      update.status = 'refunded'; update.refundedAt = FieldValue.serverTimestamp(); update.disputed = false;
      update.refundedVia = 'chargeback'; update.disputeOutcome = outcome;
      if (data.refund) {
        update['refund.freezeCents'] = 0;
        update['refund.state'] = 'reconciliation_required';
        update['refund.bankSettlementAt'] = FieldValue.serverTimestamp();
        update.refundBlocked = true;
      }
    } else if (!commercialActive && !alreadyRefunded) {
      if (data.status === 'disputed') update.status = bank.statusBeforeOpen ?? 'delivered';
      update.disputed = false; update.disputeOutcome = outcome;
    }
    await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, await financialRecoverySourceFields('purchase',doc.ref,data,update));
    commitNotice();
    return outcome === 'lost' && !alreadyRefunded && typeof data.buyerId === 'string' ? data.buyerId : null;
  });
  if (result && typeof result === 'object' && result.retry) throw new Error('Bank closure current observation unavailable; retry required');
  if (typeof result === 'string') await captureServerEvent(result, 'order_refunded', { transaction_id: doc.id, refund_cents: positiveCents(dispute.amount), reason: 'dispute', $insert_id: `order_refunded_${doc.id}` });

    });
  }
