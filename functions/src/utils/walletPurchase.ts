import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { financialRecoverySourceFields } from './financialRecoverySources';
import { financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
import { financialRecoveryWalletFields } from "./financialRecoverySources";
import { readReservedShippingPurchase, type ReservedShippingPurchase } from './reservedShippingPurchase';
import { assertAvailableWalletFunds } from './walletFundsAdmission';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import { assertAccountRelationshipNewPair } from './accountRelationshipReview';
/** New pure-wallet shipping acquisition. Existing money is classified before
 * admission; no provider IO or compensation occurs in read/commit callbacks. */
import { createHash } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { getShipEngine } from '../config/shipEngine';
import { assertNewPaymentsEnabled, isShippingEnabled } from '../config/featureFlags';
import { counterpartEligibilityRefusal } from '../shared/eligibility';
import { captureConnectObservationBarrier, observeConnectAccount } from './connectEligibility';
import { consistentRateDetails, exactCents, hasCurrentRateQualification, type PurchaseRates } from './shippingPurchaseRate';
import { assertNoActiveBankDispute } from './bankDispute';
import { assertNoUnsettledRefund } from './refundState';
import { prepareOperationalNotices } from './notifications';
import { Timestamp } from 'firebase-admin/firestore';
import { acceptedQuotePurchasePolicy, paidPurchasePolicyUpdate } from './purchasePolicy';
import { assertArticleSaleDeclaration } from './articleSaleDeclaration';
import { assertArticleChildSafetyAdmitted } from './tradeAdmission';
import { preparePurchasePlatformAccounting } from './refundAccounting';
import {shippingTransportHash} from '../config/shippingTransportPolicy';

const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? "undefined").digest('hex');
const review = () => new HttpsError('failed-precondition', 'Le paiement doit être rapproché avant toute nouvelle demande. Contactez notre équipe.',
  { reason: 'wallet_payment_reconciliation_required', action: 'contactSupport', paymentPermissionGranted: false });
const stale = () => new HttpsError('aborted', 'Les renseignements ou le prix accepté ont changé. Aucun nouveau paiement n’a été effectué.',
  { reason: 'wallet_purchase_stale', action: 'reviewPendingOrder', paymentPermissionGranted: false });
const sellerUnavailable = () => {
  const refusal = counterpartEligibilityRefusal('new_paid_shipping');
  return new HttpsError('failed-precondition', refusal.message, refusal);
};
function safeBalance(v: unknown): v is number { return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0; }
const paidStatuses = new Set(['paid', 'label_created', 'shipped', 'delivered', 'completed', 'disputed', 'return_requested',
  'refund_in_progress', 'refund_action_required', 'refunded', 'meetup_completed']);
function timestamp(v: any) { return v instanceof Date ? Number.isFinite(v.getTime()) : typeof v?.toMillis === 'function' && Number.isFinite(v.toMillis()); }
function ambiguousMarkers(order: any) {
  return order.stripePaymentIntentId != null || order.stripeChargeId != null || order.capturedCardCents != null ||
    order.walletCheckoutAttemptId != null || order.walletCheckoutOutcome != null || order.checkoutLock != null ||
    order.walletDebitReservedAt != null || order.paymentProcessing === true;
}
export interface WalletPaymentReceipt {
  success: true; replay: true; paymentCommitted: true; paymentPermissionGranted: false; currentStatus: string;
  newBalance: number | null; balanceSource: 'current_wallet' | 'unavailable'; transactionId: string;
}
interface Pending extends ReservedShippingPurchase { replay: false; wallet: FirebaseFirestore.DocumentData; }
/** One transactionId equality scan in the caller's ledger, bounded at 101.
 * Saturation/duplicate/partial/missing evidence is review, never a new debit. */
async function moneyState(tx: FirebaseFirestore.Transaction, uid: string, id: string) {
  const order = (await tx.get(db.collection('transactions').doc(id))).data();
  if (!order) throw new HttpsError('not-found', 'Commande introuvable');
  if (order.buyerId !== uid) throw new HttpsError('permission-denied', 'Pas votre commande');
  const wallet = (await tx.get(db.collection('wallets').doc(uid))).data();
  const ledger = await tx.get(db.collection('wallets').doc(uid).collection('ledger').where('transactionId', '==', id).limit(101));
  if (ledger.size >= 101) throw review();
  const debits = ledger.docs.filter(d => d.data().type === 'purchase_debit');
  const cents = exactCents(order.totalAmount);
  if (debits.length) {
    const debit = debits[0].data();
    if (debits.length !== 1 || ambiguousMarkers(order) || !cents || debit.amount !== cents || !safeBalance(debit.amount) ||
      !safeBalance(debit.balanceAfter) || !timestamp(debit.createdAt) || !paidStatuses.has(order.status) ||
      order.paidVia !== 'wallet' || order.walletAmountUsed !== cents ||
      (order.currency != null && (typeof order.currency !== 'string' || order.currency.toUpperCase() !== 'CAD')) ||
      (debit.currency != null && (typeof debit.currency !== 'string' || debit.currency.toUpperCase() !== 'CAD'))) throw review();
    const proof = order.walletPayment;
    if (proof != null && (proof.schemaVersion !== 1 || proof.state !== 'committed' || proof.ledgerId !== debits[0].id ||
      proof.actorUid !== uid || proof.amountCents !== cents || proof.currency !== 'CAD' || !timestamp(proof.committedAt) ||
      proof.quoteId !== order.shippingQuoteId || proof.rateId !== order.shipEngineRateId)) throw review();
    const receipt: WalletPaymentReceipt = { success: true, replay: true, paymentCommitted: true, paymentPermissionGranted: false,
      currentStatus: order.status, newBalance: safeBalance(wallet?.balance) ? wallet.balance : null,
      balanceSource: safeBalance(wallet?.balance) ? 'current_wallet' : 'unavailable', transactionId: id };
    return { order, wallet, receipt };
  }
  // Existing card-only preparation writes this field before provider IO. Its
  // presence is NOT payment evidence (including null/0/unknown), but a V4 order
  // with this trace cannot safely authorize a new independent wallet debit.
  // Proven historical receipts above may legitimately have fee metadata.
  if (Object.prototype.hasOwnProperty.call(order, 'serviceFeePercent')) throw review();
  // A marker does not prove a previous debit; even a zero/unknown shape must not
  // be interpreted as proof of absence of an external or wallet effect.
  if (order.status !== 'pending_payment' || ambiguousMarkers(order) || order.walletPayment != null ||
    (order.walletAmountUsed != null && order.walletAmountUsed !== 0) || order.paidVia != null || order.paidAt != null ||
    ledger.docs.length > 0) throw review();
  return { order, wallet, receipt: null };
}
export async function readWalletPaymentReceipt(uid: string, id: string,
  ownerSession?: (tx?: FirebaseFirestore.Transaction) => Promise<unknown>): Promise<WalletPaymentReceipt | null> {
  return db.runTransaction(async tx => {
    await ownerSession?.(tx);
    return (await moneyState(tx, uid, id)).receipt;
  });
}
/** Data-only reader for the existing reserved article. Unlike quote.sources it
 * requires this exact live lock, never bypasses quote's noReservation guard. */
async function pending(tx: FirebaseFirestore.Transaction, uid: string, id: string, requireObservation: boolean): Promise<Pending | WalletPaymentReceipt> {
  const money = await moneyState(tx, uid, id); if (money.receipt) return money.receipt;
  const { order, wallet } = money;
  await assertAccountRelationshipNewPair(tx, uid, order.sellerId);
  if (!await fraudReviewAllowsProgress(tx, id, order)) throw review();
  assertNoActiveBankDispute(order); assertNoUnsettledRefund(order);
  assertNewPaymentsEnabled();
  if (order.deliveryType !== 'shipping') throw new HttpsError('failed-precondition', 'Ce paiement nécessite une commande expédiée issue d’un devis accepté.', { reason: 'wallet_shipping_quote_required' });
  if (!isShippingEnabled()) throw new HttpsError('failed-precondition', 'La livraison n’est pas disponible pour le moment.');
  await assertAvailableWalletFunds(tx, uid);
  const canonical = await readReservedShippingPurchase(tx, uid, id, order, requireObservation);
  const article = (await tx.get(db.collection('articles').doc(canonical.articleId))).data();
  if (!article) throw review();
  assertArticleSaleDeclaration(canonical.articleId, article);
  await assertArticleChildSafetyAdmitted(tx, canonical.articleId, article);
  if (!acceptedQuotePurchasePolicy(order, id, canonical.quote)) throw new HttpsError('failed-precondition', 'La politique de cette commande doit être acceptée dans un nouveau devis.',
    { reason: 'purchase_policy_acceptance_required', action: 'quoteShippingPurchase', paymentPermissionGranted: false });
  const { totalCents } = canonical;
  if (!wallet || wallet.status !== 'active' || typeof wallet.currency !== 'string' || wallet.currency.toUpperCase() !== 'CAD' || !safeBalance(wallet.balance)) throw review();
  if ((wallet.sellerDebt || 0) > 0) throw new HttpsError('failed-precondition', 'Votre compte présente un solde dû. L’utilisation du solde est suspendue.',
    { reason: 'wallet_funds_blocked', action: 'contactSupport', paymentPermissionGranted: false });
  if (wallet.balance < totalCents) throw new HttpsError('failed-precondition', 'Solde insuffisant dans le porte-monnaie');
  return { replay: false, ...canonical, wallet };
}
/** Reserve/commit is the sole money linearization point. A changed source or
 * an uncertain previous effect never causes a debit, cancel or repricing. */
export async function commitWalletPurchase(uid: string, id: string,
  ownerSession?: (tx?: FirebaseFirestore.Transaction) => Promise<unknown>) {
  const pre = await db.runTransaction(async tx => { await ownerSession?.(tx); return pending(tx, uid, id, false); });
  if (pre.replay) return pre;
  try {
    const barrier = await captureConnectObservationBarrier(pre.sellerId, pre.accountId, ownerSession), stripe = getStripe();
    if (!stripe) throw sellerUnavailable();
    await ownerSession?.();
    const account = await stripe.accounts.retrieve(pre.accountId);
    await ownerSession?.();
    await observeConnectAccount(pre.sellerId, account, { barrier, expectedId: pre.accountId, transactionGuard: ownerSession });
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    if (error instanceof HttpsError && ['unauthenticated', 'permission-denied'].includes(error.code)) throw error;
    if (error instanceof HttpsError && error.code === 'aborted') throw stale();
    throw sellerUnavailable();
  }
  const prepared = await db.runTransaction(async tx => { await ownerSession?.(tx); return pending(tx, uid, id, true); }); if (prepared.replay) return prepared;
  const engine = getShipEngine(); if (!engine) throw new HttpsError('unavailable', 'Le tarif ne peut pas être vérifié. Aucun nouveau paiement n’a été effectué.');
  let live: PurchaseRates;
  try {
    await ownerSession?.();
    live = await engine.getPurchaseRatesForShipment(prepared.quote.rates.shipmentId, prepared.context);
    await ownerSession?.();
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    if (error instanceof HttpsError && ['unauthenticated', 'permission-denied'].includes(error.code)) throw error;
    throw new HttpsError('unavailable', 'Le tarif ne peut pas être vérifié. Aucun nouveau paiement n’a été effectué.');
  }
  const selected = prepared.quote.rates.rates.find((r: any) => r.rateId === prepared.order.shipEngineRateId);
  if (!hasCurrentRateQualification(live, prepared.context)) throw stale();
  const liveRate = live.rates.find(r => r.rateId === selected.rateId);
  if (!liveRate || live.shipmentId !== selected.shipmentId ||
    shippingTransportHash(liveRate) !== shippingTransportHash(selected) || !consistentRateDetails(prepared.quote.rates.qualification, live.qualification, selected.rateId)) throw stale();
  const ledgerRef = db.collection('wallets').doc(uid).collection('ledger').doc();
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    await ownerSession?.(tx);
    const current = await pending(tx, uid, id, true); if (current.replay) return current;
    if (current.hash !== prepared.hash || current.revision !== prepared.revision || sha(current.quote) !== sha(prepared.quote) ||
      sha(current.order) !== sha(prepared.order)) throw stale();
    const newBalance = current.wallet.balance - current.totalCents;
    const paymentRecordedAt = Timestamp.now();
    const notices = await prepareOperationalNotices(tx, [
      { eventKey: `wallet_paid:${id}:${ledgerRef.id}`, userId: current.sellerId, type: 'new_sale',
        title: 'Paiement enregistré pour votre vente',
        message: 'Le paiement de votre vente est enregistré. Consultez la commande pour connaître la prochaine étape et les documents disponibles.',
        data: { transactionId: id, walletPaymentLedgerId: ledgerRef.id } },
      { eventKey: `wallet_paid:${id}:${ledgerRef.id}`, userId: uid, type: 'order_paid',
        title: 'Paiement enregistré', message: 'Le paiement de votre commande est enregistré. Consultez son suivi et les recours disponibles.',
        data: { transactionId: id, walletPaymentLedgerId: ledgerRef.id } },
    ]);
    const accounting = await preparePurchasePlatformAccounting(tx, id, current.order, {payment: {
      kind: 'wallet_ledger', referenceId: ledgerRef.id, amountCents: current.totalCents,
      walletCents: current.totalCents, cardCents: 0, recordedAt: paymentRecordedAt,
    }});
    await ownerSession?.(tx);
    await recoveryCommit({refs: [(db.collection('wallets').doc(uid)).path]});
    tx.update(db.collection('wallets').doc(uid), await financialRecoveryWalletFields(db.collection('wallets').doc(uid),current.wallet,{ balance: FieldValue.increment(-current.totalCents), updatedAt: FieldValue.serverTimestamp() },{balance: ((current.wallet)["balance"]??0) + (-current.totalCents)}));
    await recoveryCommit({refs: [(ledgerRef).path]});
    tx.set(ledgerRef, { type: 'purchase_debit', amount: current.totalCents, balanceAfter: newBalance, transactionId: id, currency: 'CAD',
      description: 'Achat article', createdAt: paymentRecordedAt });
    await recoveryCommit({refs: [(db.collection('transactions').doc(id)).path]});
    tx.update(db.collection('transactions').doc(id), await financialRecoverySourceFields('purchase',db.collection('transactions').doc(id),current.order,{ status: 'paid', paidAt: paymentRecordedAt, paidVia: 'wallet', walletAmountUsed: current.totalCents,
      ...paidPurchasePolicyUpdate(current.order, id, paymentRecordedAt, { kind: 'wallet_ledger', referenceId: ledgerRef.id, amountCents: current.totalCents }),
      labelCreationPending: true, walletPayment: { schemaVersion: 1, state: 'committed', actorUid: uid, amountCents: current.totalCents,
        ledgerId: ledgerRef.id, currency: 'CAD', quoteId: current.order.shippingQuoteId, rateId: selected.rateId, committedAt: paymentRecordedAt } }));
    await recoveryCommit({refs: [(db.collection('articles').doc(current.articleId)).path]});
    tx.update(db.collection('articles').doc(current.articleId), { isSold: true, soldAt: FieldValue.serverTimestamp() });
    accounting.commit();
    notices.commit();
    return { success: true as const, replay: false as const, paymentCommitted: true as const, paymentPermissionGranted: false as const,
      currentStatus: 'paid', transactionId: id, newBalance, balanceSource: 'current_wallet' as const, sellerId: current.sellerId,
      chatId: current.order.chatId ?? null, deliveryType: 'shipping', shipEngineRateId: selected.rateId, shippingCost: current.order.shippingCost,
      serviceFee: current.order.serviceFee, taxTotal: current.order.taxTotal, itemAmount: current.order.amount,
      sellerPayout: current.order.sellerPayout, totalAmountCents: current.totalCents, articleId: current.articleId, articleTitle: current.order.articleSnapshot?.title ?? null };
  });
}
