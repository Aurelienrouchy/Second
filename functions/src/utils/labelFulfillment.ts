import { financialRecoverySourceFields } from "./financialRecoverySources";
import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "./financialRecoverySources";
import { financialRecoveryWalletFields } from "./financialRecoverySources";
import {preparePurchasePlatformAccounting} from './refundAccounting';
import {prepareSellerTaxFinancialEvent} from './sellerTaxLedger';
import { hasUnsettledRefund } from './refundState';
import { hasActiveBankDispute } from './bankDispute';
import { orderModerationAllowsProgress, ensureOrderModerationNotices } from './orderModeration';
import { fraudReviewAllowsProgress } from './fraudReviewDecision';
import { labelLifecycleAllowsLeg } from './labelLifecycle';
import { readLabelAbandonmentPolicySource } from './purchasePolicy';
import {attachOrderTransport,shippingTransportNativeContext,assertTransportCurrentForNewPost,qualifiedOrderTransportQuote} from '../config/shippingTransportPolicy';
/**
 * Shared label-fulfillment helpers (P1: atomic payment<->label + reconciliation)
 *
 * Single source of truth for:
 *  - crediting the seller's wallet pendingBalance for a sale (escrow), used by
 *    BOTH the Stripe webhook and payWithWallet AND the sweepPendingLabels retry
 *    job, so the credit happens exactly once and only AFTER the shipping label
 *    is successfully created.
 *  - reconciling the real ShipEngine label cost (shipment_cost + insurance_cost)
 *    against the estimated shippingCost billed to the buyer, persisting the
 *    delta on the transaction and writing a platform ledger entry + a CRITICAL
 *    log on a large mismatch.
 *
 * All amounts in the wallet/ledger are CENTS. The transaction `shippingCost` /
 * `actualShippingCost` fields are in DOLLARS (consistent with createTransaction).
 */
import { articleReservationOwnedBy } from './articleReservation';
import { writeAdminAlert } from './failedOperations';
import * as logger from 'firebase-functions/logger';
import { Timestamp } from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import { getOrCreateSellerWallet } from '../callable/wallet';
import { getStripe } from '../config/stripe';
import type { ShipEngineClient, ShipEngineLabel } from '../config/shipEngine';
import { captureServerEvent } from '../lib/analytics';
import { createHash, randomUUID } from 'node:crypto';
import { ShipEngineLabelPurchaseError } from '../config/shipEngine';
import { exactCents, providerId } from './shippingPurchaseRate';

/**
 * Threshold (in DOLLARS) above which a difference between the real label cost
 * and the estimated shippingCost billed to the buyer is treated as a critical
 * anomaly (logged at error level + recorded for accounting follow-up).
 */
export const SHIPPING_COST_MISMATCH_THRESHOLD = 2;

/**
 * Credits the seller's wallet `pendingBalance` for a delivered-pending sale and
 * persists `sellerCreditedCents` on the transaction. MUST be called inside a
 * runTransaction. Idempotent: if `sellerCreditedCents` is already set on the
 * transaction, this is a no-op (the seller was already credited).
 *
 * F39: any outstanding `sellerDebt` is regularised FIRST — the credit pays down
 * the debt before the remainder is added to pendingBalance — so future sales
 * automatically clear the debt (as promised in the wallet copy).
 *
 * The caller is responsible for the transaction status update (e.g. -> 'shipped')
 * and for having read the transaction snapshot used to produce `txData`.
 *
 * @returns true if the seller was credited by this call, false if skipped
 *          (already credited / invalid payout).
 */
export async function creditSellerForSale(
  tx: FirebaseFirestore.Transaction,
  transactionRef: FirebaseFirestore.DocumentReference,
  txData: FirebaseFirestore.DocumentData,
  transactionId: string,
  recoveryOrderFields?: Record<string, any>,
  sourceFinalPatch: Record<string, any> = {}
): Promise<boolean> {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
  // Idempotence: never credit twice for the same sale.
  if (typeof txData.sellerCreditedCents === 'number') {
    return false;
  }

  const sellerId = txData.sellerId;
  const sellerPayout = txData.sellerPayout ?? txData.amount;
  const sellerPayoutCents =
    typeof sellerPayout === 'number' ? Math.round(sellerPayout * 100) : 0;

  if (!sellerId || sellerPayoutCents <= 0) {
    logger.warn('[creditSellerForSale] missing sellerId/payout — not crediting', {
      transactionId,
      sellerId,
      sellerPayoutCents,
    });
    return false;
  }

  // getOrCreateSellerWallet may WRITE a missing wallet. Prepare every fiscal
  // read first, including the final debt split and native ledger identities.
  const walletBefore=(await tx.get(db.collection('wallets').doc(sellerId))).data()??{};
  const sellerDebt=walletBefore.sellerDebt||0,debtRepayment=Math.min(sellerDebt,sellerPayoutCents),toPending=sellerPayoutCents-debtRepayment,creditAt=FieldValue.serverTimestamp();
  const creditTuple={sellerCreditedCents:sellerPayoutCents,sellerPendingCreditCents:toPending,sellerDebtRepaidCents:debtRepayment,sellerCreditRecordedAt:creditAt};
  const creditLedger:{path:string;document:FirebaseFirestore.DocumentData}[]=[];
  if(debtRepayment>0)creditLedger.push({path:db.collection('wallets').doc(sellerId).collection('ledger').doc().path,document:{type:'debt_repayment',amount:debtRepayment,
    balanceAfter:sellerDebt-debtRepayment,description:'Vente — régularisation du solde dû',transactionId,createdAt:creditAt}});
  if(toPending>0)creditLedger.push({path:db.collection('wallets').doc(sellerId).collection('ledger').doc().path,document:{type:'sale_credit',amount:toPending,
    balanceAfter:(walletBefore.pendingBalance||0)+toPending,description:'Vente — fonds en attente de livraison',transactionId,createdAt:creditAt,status:'pending'}});
  const fiscalProjection={order:{...txData,...sourceFinalPatch,...creditTuple},creditLedger,commitTimestamp:creditAt};
  const fiscal=await prepareSellerTaxFinancialEvent(tx,sellerId,{kind:'purchase',id:transactionId},fiscalProjection);
  const {walletRef:sellerWalletRef,walletData:sellerWalletData,isNew:sellerWalletIsNew}=await getOrCreateSellerWallet(tx,sellerId);

  const walletUpdate: Record<string, any> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (debtRepayment > 0) walletUpdate.sellerDebt = FieldValue.increment(-debtRepayment);
  if (sellerWalletIsNew) {
    walletUpdate.pendingBalance = toPending;
  } else if (toPending > 0) {
    walletUpdate.pendingBalance = FieldValue.increment(toPending);
  }
  await recoveryCommit({refs: [(sellerWalletRef).path]});
    tx.update(sellerWalletRef, await financialRecoveryWalletFields(sellerWalletRef,sellerWalletData,walletUpdate,{...(sellerWalletIsNew||toPending>0?{pendingBalance:(sellerWalletData.pendingBalance??0)+toPending}:{}),...(debtRepayment>0?{sellerDebt:(sellerWalletData.sellerDebt??0)-debtRepayment}:{})}));

  for(const row of creditLedger){await recoveryCommit({refs:[row.path]});tx.set(sellerWalletRef.collection('ledger').doc(row.path.split('/').at(-1)!),row.document);}

  // Persist the EXACT amount credited so a later refund/dispute debits precisely
  // this figure (and records any shortfall as sellerDebt rather than masking it).
  await recoveryCommit({refs: [(transactionRef).path]});
  const creditFields=await financialRecoverySourceFields('purchase',transactionRef,txData,creditTuple);
  if(recoveryOrderFields)Object.assign(recoveryOrderFields,creditFields);
  tx.update(transactionRef,creditFields);
  fiscal.commit({order:{...txData,...sourceFinalPatch,...creditFields},creditLedger,commitTimestamp:creditAt});

  return true;
}

/**
 * Reconciles the real label cost against the estimated shippingCost billed to
 * the buyer. Persists `actualShippingCost` (dollars), `shippingCostDelta`
 * (actual - estimated, dollars) and `insuranceCost` on the transaction (these
 * fields are added to the `update` object so the CALLER commits them alongside
 * its other writes — this function does NOT call the network or Firestore for
 * the transaction itself).
 *
 * On a delta above SHIPPING_COST_MISMATCH_THRESHOLD it writes a
 * deterministic `platform_ledger` entry inside the caller transaction and logs at
 * error level. Small deltas are absorbed by the buyer-protection fee.
 *
 * @param update mutable object the caller will pass to tx.update / .update()
 * @returns the computed delta in dollars (actual - estimated)
 */
export function reconcileShippingCost(
  label: ShipEngineLabel,
  estimatedShippingCost: number,
  transactionId: string,
  update: Record<string, any>,
  varianceLedger: { tx: FirebaseFirestore.Transaction; reference: FirebaseFirestore.DocumentReference; alreadyRecorded: boolean }
): number {
  const proof = label.qualification, estimatedCents = exactCents(estimatedShippingCost);
  if (!proof || proof.schemaVersion !== 1 || proof.currency !== 'CAD' || !Number.isSafeInteger(proof.totalCents) ||
      proof.totalCents < 0 || exactCents(label.shipmentCost) !== proof.shipmentCents || exactCents(label.insuranceCost) !== proof.insuranceCents ||
      proof.shipmentCents + proof.insuranceCents !== proof.totalCents || estimatedCents === null) {
    throw new Error('Unqualified label cost evidence');
  }
  const actual = proof.totalCents / 100, estimated = estimatedCents / 100, delta = (proof.totalCents - estimatedCents) / 100;

  update.actualShippingCost = actual;
  update.shippingCostDelta = delta;
  update.insuranceCost = proof.insuranceCents / 100;
  update.shippingCostCurrency = 'CAD';
  update.shippingReconciledAt = FieldValue.serverTimestamp();

  logger.info('[reconcileShippingCost] label cost reconciled', {
    transactionId,
    estimated,
    actual,
    delta,
  });

  if (Math.abs(delta) > SHIPPING_COST_MISMATCH_THRESHOLD) {
    logger.error('CRITICAL shipping cost mismatch', {
      transactionId,
      estimated,
      actual,
      delta,
      threshold: SHIPPING_COST_MISMATCH_THRESHOLD,
    });

    // The caller pre-reads this deterministic entry before any write. An SDK
    // transaction retry cannot create an out-of-band duplicate accounting entry.
    if (!varianceLedger.alreadyRecorded) varianceLedger.tx.create(varianceLedger.reference, {
      type: 'shipping_cost_variance', transactionId,
      estimatedShippingCost: estimated, actualShippingCost: actual, delta,
      currency: 'cad', createdAt: FieldValue.serverTimestamp(),
    });
  }

  return delta;
}

/**
 * E6 / F133(c) — Platform revenue accounting. Writes the platform's GROSS revenue
 * for ONE successful purchase transaction into `platform_ledger`, so net margin
 * per transaction is computable (revenue − processor fees − shipping cost).
 *
 * First revenue and tax entries commit atomically. Replays preserve the original
 * entries and their dates; only an absent processor fee can be enriched from a
 * qualified charge observation. Carrier cost belongs to label reconciliation.
 * Historical gaps/contradictions require operator reconciliation, never an
 * automatic replacement or a tax-period inference from this helper's clock.
 * All amounts remain DOLLARS, including the tax register.
 */
export async function recordTransactionRevenue(params: {
  transactionId: string;
  sellerId: string;
  serviceFee: number;
  shippingCost: number;
  taxTotal: number;
  actualShippingCost?: number;
  chargeId?: string | null;
}): Promise<void> {
  const { transactionId, sellerId, serviceFee, shippingCost, taxTotal, chargeId } = params;
  if (typeof transactionId !== 'string' || !transactionId || transactionId.includes('/')) {
    logger.error('[recordTransactionRevenue] invalid transaction reference');
    return;
  }
  const owns = (data: Record<string, any>, key: string) => Object.prototype.hasOwnProperty.call(data, key);
  const feeCents = exactCents(serviceFee), shippingCents = exactCents(shippingCost), taxCents = exactCents(taxTotal);
  const grossCents = feeCents !== null && shippingCents !== null && taxCents !== null ? feeCents + shippingCents + taxCents : null;
  let processor: { feeCents: number; chargeId: string; balanceTransactionId: string } | null = null;
  try {
    if (typeof chargeId === 'string' && chargeId) {
      const stripe = getStripe();
      if (stripe) {
        const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] });
        const bt = charge.balance_transaction;
        if (charge.id === chargeId && charge.currency === 'cad' && bt && typeof bt === 'object' &&
            typeof bt.id === 'string' && bt.id && bt.currency === 'cad' && bt.type === 'charge' &&
            Number.isSafeInteger(bt.fee) && bt.fee >= 0) {
          processor = { feeCents: bt.fee, chargeId, balanceTransactionId: bt.id };
        }
      }
    }
  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
    logger.warn('[recordTransactionRevenue] could not resolve processor fee', {
      transactionId, error: err instanceof Error ? err.message : err,
    });
  }

  try {
    const revenueRef = db.collection('platform_ledger').doc(`service_fee_revenue_${transactionId}`);
    const taxRef = db.collection('platform_ledger').doc(`tax_collected_${transactionId}`);
    const alertRef = db.collection('admin_alerts').doc(`revenue_accounting_${transactionId}`);
    const outcome = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const sale = (await tx.get(db.collection('transactions').doc(transactionId))).data();
      const revenue = (await tx.get(revenueRef)).data();
      const tax = (await tx.get(taxRef)).data();
      const priorAlert=await tx.get(alertRef);
      const accounting=await preparePurchasePlatformAccounting(tx,transactionId,sale);
      let issue: string | null = null;
      if (typeof sellerId !== 'string' || !sellerId || grossCents === null || !Number.isSafeInteger(grossCents)) {
        issue = 'invalid_revenue_amounts';
      }
      if (sale && (sale.sellerId !== sellerId ||
          (owns(sale, 'serviceFee') && exactCents(sale.serviceFee) !== feeCents) ||
          (owns(sale, 'shippingCost') && exactCents(sale.shippingCost) !== shippingCents) ||
          (owns(sale, 'taxTotal') && exactCents(sale.taxTotal) !== taxCents))) issue = 'native_sale_conflict';
      const qualifiedProcessor = processor && sale?.stripeChargeId === processor.chargeId ? processor : null;
      const carrier = sale && owns(sale, 'actualShippingCost') ? sale.actualShippingCost : params.actualShippingCost ?? shippingCost;
      const carrierCents = exactCents(carrier);
      const marginCents = (fees: number, carrierAmount: number) => feeCents! + shippingCents! - fees - carrierAmount;
      const signedCents = (value: unknown) => typeof value === 'number' ?
        (exactCents(Math.abs(value)) === null ? null : Math.sign(value) * exactCents(Math.abs(value))!) : null;
      const dated = (value: any) => value instanceof Date ? Number.isFinite(value.getTime()) :
        value != null && typeof value.toMillis === 'function' && Number.isFinite(value.toMillis());
      const patch: Record<string, unknown> = {};
      if (revenue) {
        const storedCarrier = exactCents(revenue.carrierCost);
        const storedFee = owns(revenue, 'processorFees') ? exactCents(revenue.processorFees) : null;
        if (revenue.type !== 'service_fee_revenue' || revenue.transactionId !== transactionId || revenue.sellerId !== sellerId ||
            revenue.currency !== 'cad' || exactCents(revenue.serviceFee) !== feeCents || exactCents(revenue.taxCollected) !== taxCents ||
            exactCents(revenue.shippingCostCollected) !== shippingCents || exactCents(revenue.grossRevenue) !== grossCents ||
            storedCarrier === null || typeof revenue.carrierCostEstimated !== 'boolean' || !dated(revenue.createdAt)) {
          issue = 'existing_revenue_conflict';
        }
        if (revenue.carrierCostEstimated === false && sale && owns(sale, 'actualShippingCost') &&
            exactCents(sale.actualShippingCost) !== storedCarrier) issue = 'native_carrier_cost_conflict';
        if (qualifiedProcessor && storedCarrier !== null && !Number.isSafeInteger(marginCents(qualifiedProcessor.feeCents, storedCarrier))) {
          issue = 'invalid_net_margin';
        }
        if (owns(revenue, 'processorFeeChargeId') || owns(revenue, 'processorFeeBalanceTransactionId')) {
          if (typeof revenue.processorFeeChargeId !== 'string' || !revenue.processorFeeChargeId ||
              typeof revenue.processorFeeBalanceTransactionId !== 'string' || !revenue.processorFeeBalanceTransactionId ||
              (sale && revenue.processorFeeChargeId !== sale.stripeChargeId)) issue = 'existing_processor_source_conflict';
        }
        if (owns(revenue, 'processorFees')) {
          if (storedFee === null || !owns(revenue, 'netMargin') || signedCents(revenue.netMargin) !== marginCents(storedFee!, storedCarrier!) ||
              (qualifiedProcessor && (qualifiedProcessor.feeCents !== storedFee ||
                (owns(revenue, 'processorFeeChargeId') && revenue.processorFeeChargeId !== qualifiedProcessor.chargeId) ||
                (owns(revenue, 'processorFeeBalanceTransactionId') && revenue.processorFeeBalanceTransactionId !== qualifiedProcessor.balanceTransactionId)))) {
            issue = 'existing_processor_fee_conflict';
          }
        } else if (owns(revenue, 'netMargin') || owns(revenue, 'processorFeeChargeId') || owns(revenue, 'processorFeeBalanceTransactionId')) {
          issue = 'incomplete_processor_fee_evidence';
        } else if (qualifiedProcessor && storedCarrier !== null && Number.isSafeInteger(marginCents(qualifiedProcessor.feeCents, storedCarrier))) {
          Object.assign(patch, { processorFees: qualifiedProcessor.feeCents / 100,
            processorFeeChargeId: qualifiedProcessor.chargeId, processorFeeBalanceTransactionId: qualifiedProcessor.balanceTransactionId,
            netMargin: marginCents(qualifiedProcessor.feeCents, storedCarrier) / 100 });
        }
        if (taxCents! > 0 && !tax) issue = 'historical_tax_entry_missing';
      } else if (tax) {
        issue = 'historical_revenue_entry_missing';
      } else if (carrierCents === null) {
        issue = 'invalid_carrier_cost';
      }
      if (!revenue && qualifiedProcessor && carrierCents !== null &&
          !Number.isSafeInteger(marginCents(qualifiedProcessor.feeCents, carrierCents))) issue = 'invalid_net_margin';
      if (tax && (tax.type !== 'tax_collected' || tax.transactionId !== transactionId || tax.currency !== 'cad' ||
          taxCents === null || taxCents <= 0 || exactCents(tax.taxTotal) !== taxCents || !dated(tax.createdAt))) issue = 'existing_tax_conflict';
      if (issue) {
        // Deterministic operator witness: repeated deliveries do not replace the
        // ledger, manufacture a compensation, or flood the automatic retry queue.
        if (!priorAlert.exists) { await recoveryCommit({refs: [(alertRef).path]}); tx.create(alertRef, {
          kind: 'platform_revenue_reconciliation', severity: 'warning', refId: transactionId,
          message: 'Écriture de revenu ou taxe à rapprocher ; aucune correction automatique.',
          context: { reason: issue }, status: 'open', createdAt: FieldValue.serverTimestamp(),
        }); }
        accounting.commit(undefined,issue);
        return 'reconciliation_required';
      }
      if (revenue) {
        if (Object.keys(patch).length) { await recoveryCommit({refs: [(revenueRef).path]}); tx.update(revenueRef, patch); }
        accounting.commit();
        return Object.keys(patch).length ? 'processor_fee_enriched' : 'already_recorded';
      }
      accounting.commit();
      if(accounting.willCreateBase&&qualifiedProcessor&&carrierCents!==null){ await recoveryCommit({refs: [(revenueRef).path]}); tx.update(revenueRef,{
        processorFees:qualifiedProcessor.feeCents/100,processorFeeChargeId:qualifiedProcessor.chargeId,
        processorFeeBalanceTransactionId:qualifiedProcessor.balanceTransactionId,
        netMargin:marginCents(qualifiedProcessor.feeCents,carrierCents)/100}); }
      return 'recorded';
    });
    logger.info('[recordTransactionRevenue] accounting observation', { transactionId, outcome });
  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
    logger.error('[recordTransactionRevenue] failed to record platform revenue', {
      transactionId, error: err instanceof Error ? err.message : err,
    });
  }
}

async function labelReservationStillOwned(
  tx: FirebaseFirestore.Transaction,
  data: FirebaseFirestore.DocumentData,
  transactionId: string,
  requirePhysicalPermission = true
): Promise<boolean> {
  if (hasUnsettledRefund(data) || hasActiveBankDispute(data)) return false;
  if (data.labelReconciliationRequired === true) return false;
  if (data.status !== 'paid' || (data.deliveryType && data.deliveryType !== 'shipping')) return false;
  if (requirePhysicalPermission && !await labelLifecycleAllowsLeg(tx, transactionId, data, 'forward')) return false;
  if (!await orderModerationAllowsProgress(tx, data, requirePhysicalPermission ? 'forward' : undefined, transactionId)) return false;
  if (!data.articleId) return true;
  const articleRef = db.collection('articles').doc(data.articleId);
  const article = (await tx.get(articleRef)).data();
  if (article?.isSold === false) return false;
  return articleReservationOwnedBy(tx, articleRef, article ?? {}, transactionId);
}

/** Mandatory witness shared with the sweep. Never turns missing evidence into
 * permission to purchase/refund, nor removes an earlier purchase intention. */
export async function markLabelPurchaseReconciliation(transactionRef: FirebaseFirestore.DocumentReference,
  transactionId: string, reason: string, evidence?: Record<string, unknown>,
  expected?: { status: 'paid'; rateId?: string | null; snapshotHash: string }): Promise<void> {
  if (transactionRef.id !== transactionId) throw new Error('Label purchase order reference mismatch');
  const recorded = await db.runTransaction(async tx => {
    const current = (await tx.get(transactionRef)).data();
    if (!current) throw new Error('Label purchase order disappeared');
    if (expected && (current.status !== expected.status || current.deliveryType !== 'shipping' || current.labelCreationPending !== true ||
        current.shipEngineLabelId != null || current.labelPurchase?.state === 'committed' || current.shipEngineRateId !== expected.rateId ||
        createHash('sha256').update(JSON.stringify(current.shippingSnapshot ?? null)).digest('hex') !== expected.snapshotHash)) return false;
    tx.update(transactionRef, { labelReconciliationRequired: true, labelReconciliationReason: reason.substring(0, 200),
      labelCreationPending: true, labelReconciliationRecordedAt: FieldValue.serverTimestamp(),
      ...(evidence ? { labelReconciliationEvidence: evidence } : {}) });
    return true;
  });
  if (recorded) logger.error('[labelPurchase] reconciliation required', { transactionId, reason });
}

/**
 * A native intention precedes every paid POST. Expired dates, a timeout and an
 * empty GET are never permission for a second purchase. Re-entry reads the same
 * shipment/rate through GET only; a certain pre-carrier rejection permits retry.
 *
 * PROBLEM
 * -------
 * `shipEngine.createLabel(rateId)` is a PAID external call that is NOT idempotent
 * (ShipEngine bills a new label every time). The previous flow called it OUTSIDE
 * any guard, then persisted `shipEngineLabelId` in a follow-up transaction. If
 * the webhook timed out (or a concurrent sweep run / Stripe retry re-entered)
 * between the external call and the persist, a SECOND paid label was created.
 *
 * RESERVE records immutable purchase identity, REQUESTED precedes provider I/O,
 * then COMMIT rechecks ownership before label/credit. A known rejection may be
 * retried; all uncertain or orphan outcomes retain their native purchase proof.
 *
 * @param applyExtraUpdate optional hook to merge extra fields into the commit
 *        update (e.g. shipEngineRateId on the sweep retry). Receives the label.
 * @returns 'failed' only for a qualified request rejection. 'unknown' and
 * 'reconciliation_required' never permit another label or automatic refund.
 */
export async function createLabelIdempotent(params: {
  transactionRef: FirebaseFirestore.DocumentReference;
  transactionId: string;
  rateId: string;
  shipEngine: ShipEngineClient;
  estimatedShippingCost: number;
  reservationTtlMs?: number;
  applyExtraUpdate?: (label: ShipEngineLabel, update: Record<string, any>) => void;
}): Promise<'created' | 'skip' | 'failed' | 'unknown' | 'reconciliation_required'> {
  const {
    transactionRef,
    transactionId,
    rateId,
    shipEngine,
    estimatedShippingCost,
  } = params;
  const sourceHash = (data: FirebaseFirestore.DocumentData) => createHash('sha256').update(JSON.stringify({
    buyerId: data.buyerId, sellerId: data.sellerId, articleId: data.articleId,
    snapshot: data.shippingSnapshot, rateId: data.shipEngineRateId,
  })).digest('hex');

  // ---- Phase 1: RESERVE (atomic) ----
  const reserved = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const snap = await tx.get(transactionRef);
    const data = snap.data();
    if (!data) return { action: 'skip' as const };

    // Already labelled / advanced — nothing to do.
    if (
      data.shipEngineLabelId ||
      data.status === 'label_created' ||
      data.status === 'shipped' ||
      data.status === 'delivered'
    ) {
      return { action: 'skip' as const };
    }
    const prior = data.labelPurchase, snapshot = data.shippingSnapshot;
    if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.provider !== 'shipengine' || !providerId(snapshot.shipmentId) ||
        !providerId(rateId) || data.shipEngineRateId !== rateId || snapshot.rate?.rateId !== rateId ||
        snapshot.rate?.shipmentId !== snapshot.shipmentId || typeof data.buyerId !== 'string' || !data.buyerId ||
        typeof data.sellerId !== 'string' || !data.sellerId || data.buyerId === data.sellerId || !providerId(snapshot.rate?.carrierId) ||
        !['carrierCode', 'serviceCode'].every(key => typeof snapshot.rate?.[key] === 'string' && snapshot.rate[key].trim())) {
      await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,data,{ labelReconciliationRequired: true, labelReconciliationReason: 'label_purchase_source_unqualified', labelCreationPending: true }));
      return { action: 'blocked' as const };
    }
    let observationData=data;
    if((prior?.state==='requested'||prior?.state==='unknown')&&typeof data.shippingQuoteId==='string'&&data.shippingQuoteId&&!data.shippingQuoteId.includes('/')) {
      const originalQuote=(await tx.get(db.collection('shipping_quotes').doc(data.shippingQuoteId))).data();
      if(originalQuote?.source&&Object.prototype.hasOwnProperty.call(originalQuote.source,'transportAdmission')) {
        const original={...data,transportAdmission:originalQuote.source.transportAdmission,transportBaseHash:originalQuote.source.transportBaseHash,
          transportTermsAcceptance:originalQuote.transportTermsAcceptance,shippingSnapshot:{...snapshot,transportAdmission:originalQuote.source.transportAdmission}};
        try {
          qualifiedOrderTransportQuote(original,originalQuote,transactionId);
          // Read-only reconstruction for the SAME escaped effect. Native
          // source/witnesses are never repaired or granted a fresh POST here.
          if(sourceHash(original)===prior.sourceHash)observationData=original;
          else if(!Object.prototype.hasOwnProperty.call(snapshot,'transportAdmission')) {
            // The historical source digest serialized map order. Only the
            // removed field's position is unknown: preserve every other native
            // byte, bound the search, and require the EXACT existing digest.
            const entries=Object.entries(snapshot);
            if(entries.length<=64)for(let index=0;index<=entries.length;index++) {
              const candidate={...original,shippingSnapshot:Object.fromEntries([...entries.slice(0,index),
                ['transportAdmission',originalQuote.source.transportAdmission],...entries.slice(index)])};
              if(sourceHash(candidate)===prior.sourceHash){observationData=candidate;break;}
            }
          }
        }catch{/* Keep the historical attempt unknown, never recreate it. */}
      }
    }
    let shipmentContext;
    try{shipmentContext=attachOrderTransport(observationData,shippingTransportNativeContext(snapshot.origin,snapshot.destination,snapshot.parcel),'forward');}
    catch{
      // Keep any escaped attempt and its original evidence. An incomplete
      // restore is an unknown observation, never a second purchase grant.
      await recoveryCommit({refs:[transactionRef.path]});
      tx.update(transactionRef,await financialRecoverySourceFields('purchase',transactionRef,data,{labelReconciliationRequired:true,
        labelReconciliationReason:'label_transport_accepted_source_unknown',labelCreationPending:true}));
      return{action:'blocked' as const};
    }
    const context = { shipmentId: snapshot.shipmentId, carrierId: snapshot.rate.carrierId,
      carrierCode: snapshot.rate.carrierCode, serviceCode: snapshot.rate.serviceCode,
      ...(shipmentContext.transport?{shipmentContext}:{} ) };
    const hash = sourceHash(observationData);
    if (prior) {
      if (prior.schemaVersion !== 1 || typeof prior.attemptId !== 'string' || !prior.attemptId || prior.transactionId !== transactionId ||
          prior.buyerId !== data.buyerId || prior.sellerId !== data.sellerId || prior.shipmentId !== snapshot.shipmentId ||
          prior.rateId !== rateId || prior.sourceHash !== hash || !(prior.reservedAt instanceof Timestamp)) {
        await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,data,{ labelReconciliationRequired: true, labelReconciliationReason: 'label_purchase_intention_unqualified', labelCreationPending: true }));
        return { action: 'blocked' as const };
      }
      if (prior.state === 'requested' || prior.state === 'unknown') {
        if (!(prior.requestedAt instanceof Timestamp)) {
          await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,data,{ labelReconciliationRequired: true, labelReconciliationReason: 'label_purchase_attempt_unqualified', labelCreationPending: true }));
          return { action: 'blocked' as const };
        }
        return { action: 'recover' as const, intent: prior, context };
      }
      if (prior.state === 'reserved' && prior.requestedAt == null) return { action: 'purchase' as const, intent: prior, context };
      const rejection = prior.rejection?.evidence;
      if (prior.state !== 'rejected' || prior.rejection?.outcome !== 'rejected' || !(prior.rejectedAt instanceof Timestamp) ||
          rejection?.httpStatus !== 400 || typeof rejection.requestId !== 'string' || !rejection.requestId ||
          !Array.isArray(rejection.errors) || !rejection.errors.length || rejection.errors.some((entry: any) =>
            entry?.source !== 'shipengine' || entry.type !== 'validation' || typeof entry.code !== 'string' || !entry.code)) {
        await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,data,{ labelReconciliationRequired: true,
          labelReconciliationReason: typeof data.labelReconciliationReason === 'string' ? data.labelReconciliationReason : 'label_purchase_state_unqualified',
          labelCreationPending: true }));
        return { action: 'blocked' as const };
      }
    } else if (data.labelReservationAt != null) {
      // An old lock can predate a paid request whose response was lost. TTL is
      // not evidence of absence, even when no native intention was then stored.
      await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,data,{ labelReconciliationRequired: true, labelReconciliationReason: 'label_purchase_legacy_lock_unqualified', labelCreationPending: true }));
      return { action: 'blocked' as const };
    }
    // Historical committed/requested/unknown/reserved intentions above keep
    // their servicing. Only a NEW purchase after a definitive rejection needs
    // this accepted policy/count source, shared by every fulfillment caller.
    if(prior?.state==='rejected'){
      const policy=await readLabelAbandonmentPolicySource(tx,transactionId,data);
      if(!policy||policy.ready){
        await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef,await financialRecoverySourceFields('purchase',transactionRef,data,{purchasePreparationReviewRequired:true,purchasePreparationReview:{
          protocol:'purchase_preparation_review_v1',kind:'label_abandonment',
          reason:policy?.ready?'native_label_rejection_limit_reached':'accepted_preparation_terms_or_rejections_unknown',
          observedAt:Timestamp.now(),financialEffectAuthorized:false,acceptanceReconstructed:false}}));
        return {action:'blocked' as const};
      }
    }
    if (!await fraudReviewAllowsProgress(tx, transactionId, data, snap) ||
        !await labelReservationStillOwned(tx, data, transactionId)) return { action: 'skip' as const };
    const previousAttempts = Array.isArray(prior?.previousAttempts) ? prior.previousAttempts : [];
    if (previousAttempts.length >= 20) {
      await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,data,{ labelReconciliationRequired: true, labelReconciliationReason: 'label_purchase_attempt_history_full', labelCreationPending: true }));
      return { action: 'blocked' as const };
    }
    const intent = { schemaVersion: 1, attemptId: randomUUID(), transactionId, buyerId: data.buyerId, sellerId: data.sellerId,
      shipmentId: snapshot.shipmentId, rateId, sourceHash: hash, state: 'reserved', reservedAt: Timestamp.now(), requestedAt: null,
      previousAttempts: prior ? [...previousAttempts, { attemptId: prior.attemptId, rateId: prior.rateId, shipmentId: prior.shipmentId,
        requestedAt: prior.requestedAt, rejectedAt: prior.rejectedAt, rejection: prior.rejection }] : previousAttempts };
    await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,data,{
      labelReservationAt: FieldValue.serverTimestamp(), labelPurchase: intent, labelCreationPending: true,
    }));
    return { action: 'purchase' as const, intent, context };
  });
  if (reserved.action === 'blocked') return 'reconciliation_required';
  if (reserved.action === 'skip') {
    await ensureOrderModerationNotices(transactionId);
    logger.info('[createLabelIdempotent] reservation not acquired — skipping', { transactionId });
    return 'skip';
  }

  // Re-read the current decision immediately before the paid provider call.
  // A decision during provider I/O is reconciled below; it is never erased.
  const stillAllowed = reserved.action === 'recover' || await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const data = (await tx.get(transactionRef)).data();
    if (!data || data.labelPurchase?.attemptId !== reserved.intent.attemptId || data.labelPurchase.state !== 'reserved' ||
        data.labelPurchase.requestedAt != null || sourceHash(data) !== reserved.intent.sourceHash ||
        !await labelReservationStillOwned(tx, data, transactionId)) return false;
    // This commit is the irrevocable witness before external I/O. A crash
    // after it requires GET of the same purchase; it never grants another POST.
    // This is a NEW provider permission. A positive GET/recovery keeps its
    // original historical commit path above/below without a fresh risk grant.
    if (!await fraudReviewAllowsProgress(tx, transactionId, data)) return false;
    if(reserved.context.shipmentContext?.transport)try{assertTransportCurrentForNewPost(reserved.context.shipmentContext.transport);}catch{return false;}
    await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,data,{ 'labelPurchase.state': 'requested', 'labelPurchase.requestedAt': FieldValue.serverTimestamp() }));
    return true;
  });
  if (!stillAllowed) {
    await ensureOrderModerationNotices(transactionId);
    return 'skip';
  }

  // ---- Phase 2: CREATE (external, exactly once — we hold the reservation) ----
  let label: ShipEngineLabel;
  try {
    label = reserved.action === 'recover' ? await shipEngine.readPurchasedLabel(reserved.intent.shipmentId, reserved.intent.rateId, reserved.context)
      : await shipEngine.createLabel(rateId, reserved.context);
    const proof = label.qualification;
    if (!proof || proof.schemaVersion !== 1 || proof.currency !== 'CAD' || proof.requestedRateId !== reserved.intent.rateId ||
        !['request_path', 'filtered_lookup'].includes(proof.rateIdentitySource) || !providerId(label.labelId) ||
        label.shipmentId !== reserved.intent.shipmentId || label.carrierId !== reserved.context.carrierId ||
        label.carrierCode !== reserved.context.carrierCode || label.serviceCode !== reserved.context.serviceCode ||
        (label.rateId != null && label.rateId !== reserved.intent.rateId) || !label.trackingNumber || !label.labelDownload?.href ||
        exactCents(label.shipmentCost) !== proof.shipmentCents || exactCents(label.insuranceCost) !== proof.insuranceCents ||
        !Number.isSafeInteger(proof.totalCents) || proof.totalCents < 0 || proof.shipmentCents + proof.insuranceCents !== proof.totalCents) {
      throw new ShipEngineLabelPurchaseError('unknown', { reason: 'label_qualification_missing_or_contradictory',
        labelId: typeof label.labelId === 'string' ? label.labelId : null, shipmentId: label.shipmentId ?? null });
    }
  } catch (labelError) {
      if (labelError instanceof FinancialRecoveryBlocked) throw labelError;
    const rejected = reserved.action === 'purchase' && labelError instanceof ShipEngineLabelPurchaseError && labelError.outcome === 'rejected';
    const evidence = labelError instanceof ShipEngineLabelPurchaseError ? labelError.evidence :
      { error: labelError instanceof Error ? labelError.message.substring(0, 300) : 'Unknown purchase outcome' };
    await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const current = (await tx.get(transactionRef)).data();
      if (!current || current.labelPurchase?.attemptId !== reserved.intent.attemptId) throw new Error('Label purchase intention changed');
      if (current.labelPurchase.state === 'committed') return;
      await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,current,rejected ? { 'labelPurchase.state': 'rejected', 'labelPurchase.rejectedAt': FieldValue.serverTimestamp(),
        'labelPurchase.rejection': { outcome: 'rejected', evidence }, labelReservationAt: FieldValue.delete() } :
        { 'labelPurchase.state': 'unknown', 'labelPurchase.lastObservation': evidence,
          labelReconciliationRequired: true, labelReconciliationReason: 'label_purchase_unknown', labelCreationPending: true }));
    });
    logger.error('[createLabelIdempotent] label purchase outcome', {
      transactionId,
      outcome: rejected ? 'rejected' : 'unknown',
      error: labelError instanceof Error ? labelError.message : labelError,
    });
    return rejected ? 'failed' : 'unknown';
  }

  // ---- Phase 3: COMMIT (atomic) ----
  let labelSellerId: string | null = null;
  let labelService = '';
  let orphanReason: string | null = null;
  try {
    const committed = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const snap = await tx.get(transactionRef);
      const data = snap.data();
      if (!data) { orphanReason = 'transaction_missing'; return false; }
      if (data.labelPurchase?.attemptId !== reserved.intent.attemptId || sourceHash(data) !== reserved.intent.sourceHash) {
        orphanReason = 'purchase_intention_changed'; return false;
      }
      // Idempotence: a concurrent path persisted the label first — no-op.
      if (
        data.shipEngineLabelId ||
        data.status === 'label_created' ||
        data.status === 'shipped' ||
        data.status === 'delivered'
      ) {
        if (data.shipEngineLabelId !== label.labelId) orphanReason = 'transaction_advanced';
        return false;
      }

      // A verified GET may lift only this purchase's own unknown-outcome fence.
      // Operator/moderation/bank/refund/ownership decisions remain independent.
      const progress = data.labelReconciliationReason === 'label_purchase_unknown' ? { ...data, labelReconciliationRequired: false } : data;
      // This is a real, source-attributed label result, not permission for a
      // new paid provider call or a physical shipment. Preserve its servicing.
      if (!await labelReservationStillOwned(tx, progress, transactionId, false)) {
        orphanReason = 'terminal_or_different_agreement';
        return false;
      }

      labelSellerId = typeof data.sellerId === 'string' ? data.sellerId : null;
      labelService =
        typeof data.shipEngineServiceCode === 'string'
          ? data.shipEngineServiceCode
          : typeof data.serviceCode === 'string'
            ? data.serviceCode
            : '';

      const revenueRef = db.collection('platform_ledger').doc(`service_fee_revenue_${transactionId}`);
      const revenue = (await tx.get(revenueRef)).data();
      const varianceRef = db.collection('platform_ledger').doc(`shipping_cost_variance_${transactionId}`);
      const varianceSnapshot = await tx.get(varianceRef);
      const recoveryCreditFields:Record<string,any>={};
      const update: Record<string, any> = {
        trackingNumber: label.trackingNumber,
        shippingLabelUrl: label.labelDownload.href,
        trackingUrl: label.trackingUrl,
        carrierCode: label.carrierCode,
        trackingStatus: 'LABEL_CREATED',
        shipEngineLabelId: label.labelId,
        status: 'label_created',
        labelCreatedAt: FieldValue.serverTimestamp(),
        labelCreationPending: false,
        labelReservationAt: FieldValue.delete(),
        'labelPurchase.state': 'committed', 'labelPurchase.providerLabelId': label.labelId,
        'labelPurchase.committedAt': FieldValue.serverTimestamp(),
        'labelPurchase.qualification': label.qualification,
        ...(data.labelReconciliationReason === 'label_purchase_unknown' ? { labelReconciliationRequired: false,
          labelReconciliationReason: FieldValue.delete() } : {}),
      };
      if (params.applyExtraUpdate) params.applyExtraUpdate(label, update);
      await creditSellerForSale(tx, transactionRef, data, transactionId, recoveryCreditFields, update);
      reconcileShippingCost(label, estimatedShippingCost, transactionId, update, {
        tx, reference: varianceRef, alreadyRecorded: varianceSnapshot.exists,
      });
      if (revenue) {
        const accounting: Record<string, unknown> = {
          carrierCost: update.actualShippingCost, carrierCostEstimated: false,
        };
        if (typeof revenue.processorFees === 'number') {
          accounting.netMargin = Math.round(((revenue.serviceFee || 0) +
            (revenue.shippingCostCollected || 0) - revenue.processorFees - update.actualShippingCost) * 100) / 100;
        }
        await recoveryCommit({refs: [(revenueRef).path]});
    tx.update(revenueRef, accounting);
      }
      await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,data,{...update,...recoveryCreditFields}));
      return true;
    });
    if (!committed) {
      if (orphanReason) {
        // The provider has already billed this label. Keep its identity and
        // tracking evidence so a paused order cannot silently buy another one.
        // Do not make the order shippable or credit the seller on this path.
        await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          const current = (await tx.get(transactionRef)).data();
          if (!current) throw new Error('Purchased label order disappeared');
          if (current.labelPurchase?.attemptId !== reserved.intent.attemptId) throw new Error('Purchased label intention changed');
          if (current.shipEngineLabelId === label.labelId) return;
          await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,current,{ 'labelPurchase.state': 'reconciliation_required',
            'labelPurchase.providerLabelId': typeof label.labelId === 'string' ? label.labelId : null,
            'labelPurchase.lastObservation': { labelId: typeof label.labelId === 'string' ? label.labelId : null,
              trackingNumber: typeof label.trackingNumber === 'string' ? label.trackingNumber : null },
            labelReconciliationRequired: true, labelReconciliationReason: orphanReason,
            labelCreationPending: true }));
        });
        await writeAdminAlert({
        kind: 'orphan_shipping_label', severity: 'critical', refId: transactionId,
        message: 'Bordereau acheté après fin ou changement de réservation : rapprochement requis, aucun crédit vendeur.',
        context: { transactionId, labelId: label.labelId, reason: orphanReason },
        });
      }
      return orphanReason ? 'reconciliation_required' : 'skip';
    }
  } catch (commitErr) {
      if (commitErr instanceof FinancialRecoveryBlocked) throw commitErr;
    // The native intention remains irrevocable even if persisting this response
    // fails again. A later run may only GET the same shipment/rate purchase.
    logger.error('CRITICAL [createLabelIdempotent] label created but commit failed', {
      transactionId,
      shipEngineLabelId: label.labelId,
      error: commitErr instanceof Error ? commitErr.message : commitErr,
    });
    await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      const current = (await tx.get(transactionRef)).data();
      if (!current) throw new Error('Purchased label order disappeared');
      if (current.labelPurchase?.attemptId !== reserved.intent.attemptId) throw new Error('Purchased label intention changed');
      if (current.labelPurchase.state === 'committed') return;
      await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,current,{ 'labelPurchase.state': 'unknown',
        'labelPurchase.providerLabelId': typeof label.labelId === 'string' ? label.labelId : null,
        'labelPurchase.lastObservation': { labelId: typeof label.labelId === 'string' ? label.labelId : null,
          trackingNumber: typeof label.trackingNumber === 'string' ? label.trackingNumber : null, reason: 'label_commit_failed' },
        labelReconciliationRequired: true, labelReconciliationReason: 'label_purchase_unknown', labelCreationPending: true }));
    });
    await writeAdminAlert({ kind: 'orphan_shipping_label', severity: 'critical', refId: transactionId,
      message: 'Bordereau acheté mais commande non rapprochée : conserver la preuve et examiner le dossier.',
      context: { transactionId, labelId: label.labelId, reason: 'label_commit_failed' } });
    return 'unknown';
  }

  // Analytics (§12): shipping_label_purchased follows the SELLER. This is the
  // single choke point for forward-label purchase (webhook + sweep both route
  // here). $insert_id keeps it unique per transaction. is_return=false (returns
  // use a separate path).
  if (labelSellerId) {
    await captureServerEvent(labelSellerId, 'shipping_label_purchased', {
      transaction_id: transactionId,
      carrier: label.carrierCode || '',
      service: labelService,
      label_cost_cents: label.qualification!.totalCents,
      is_return: false,
      $insert_id: `label_${transactionId}`,
    });
  }

  return 'created';
}
