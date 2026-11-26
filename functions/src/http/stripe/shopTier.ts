import { financialRecoveryCommitCheckpoint } from "../../utils/financialRecoverySources";
import { financialRecoverySourceFields } from '../../utils/financialRecoverySources';
import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
/**
 * Webhook Stripe — Achat d'un forfait boutique.
 *
 * Éclaté depuis functions/src/http/webhooks.ts (2972 lignes). Le dispatcher
 * et la vérification de signature restent dans webhooks.ts.
 */
import * as logger from 'firebase-functions/logger';
import {createHash} from 'node:crypto';
import { db, FieldValue } from '../../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { qualifiedShopTierOperation, shopTierPaymentMatches, qualifiedShopTierSettlement, shopTierSettlementHash as settlementHash,
  shopTierCancellationProof, SHOP_TIER_PURCHASE_CAPABILITY, type PaidShopTier } from '../../callable/shopTier';
import { captureServerEvent } from '../../lib/analytics';
import {qualifiedShopTierTaxOperation,SHOP_TIER_TAX_PRICING_VERSION} from '../../config/shopTierTax';

/**
 * Confirm a paid shop tier forfait purchase. AFTER the platform charge succeeds:
 *  1. Verify the capture against the immutable native owner operation.
 *  2. Recognize its own settled receipt before current shop state or tariff.
 *  3. Atomically grant the entitlement, record its receipt and create revenue.
 *
 * tier/tierPaidUntil are CF-only in firestore.rules — only this Admin SDK path
 * (and admin moderation) may set them; a client can never self-attribute a tier.
 */

const stripeChargeId = (v: any): string | null => {
  const id = typeof v === 'string' ? v : v?.id;
  return typeof id === 'string' && /^ch_[A-Za-z0-9_]+$/.test(id) ? id : null;
};
export async function handleShopTierSucceeded(paymentIntent: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/shopTier.handleShopTierSucceeded"}, async () => {
  const shopId = paymentIntent.metadata?.shopId;
  const tier = paymentIntent.metadata?.tier as PaidShopTier | undefined;
  const periodText = paymentIntent.metadata?.periodMonths;
  const periodMonths = typeof periodText === 'string' && /^(?:[1-9]|1[0-2])$/.test(periodText) ? Number(periodText) : null;
  if (typeof shopId !== 'string' || !shopId || shopId.length > 200 || shopId.includes('/') ||
      !['pro', 'premium'].includes(tier ?? '') || periodMonths === null || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntent.id ?? '')) {
    logger.error('Stripe webhook: invalid shop tier identity', {paymentIntentId: paymentIntent.id ?? null});
    return;
  }
  const operationId = paymentIntent.metadata?.secondAccountOperationId;
  const operationRef = typeof operationId === 'string' && /^forfait_[a-f0-9]{64}$/.test(operationId)
    ? db.collection('eligibility_audit').doc(operationId) : null;
  const shopRef = db.collection('shops').doc(shopId);
  const ledgerRef = db.collection('platform_ledger').doc(`shop_tier_revenue_${paymentIntent.id}`);
  const alertRef = db.collection('admin_alerts').doc(`shop_tier_review_${paymentIntent.id}`);
  const result = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const operation = operationRef ? (await tx.get(operationRef)).data() : null;
    const snap = await tx.get(shopRef), ledger = (await tx.get(ledgerRef)).data(), alert = await tx.get(alertRef);
    const slotRef=operation?.requestProtocol===SHOP_TIER_PURCHASE_CAPABILITY
      ?db.collection('eligibility_audit').doc('forfait_slot_'+createHash('sha256').update(JSON.stringify([operation.ownerId,shopId])).digest('hex')):null;
    const slot=slotRef?(await tx.get(slotRef)).data():null;
    let nativePayment = false;
    const review = async (reason: string) => {
      if (!alert.exists) {await recoveryCommit({refs:[alertRef.path]});tx.create(alertRef, {kind: 'shop_tier_reconciliation', severity: 'critical', refId: shopId,
        status: 'open', createdAt: FieldValue.serverTimestamp(), message: 'Forfait payé à rapprocher ; aucune nouvelle activation autorisée.',
        context: {reason, paymentIntentId: paymentIntent.id, operationId: operationRef?.id ?? null, shopId,
          ownerId: typeof paymentIntent.metadata?.ownerId === 'string' ? paymentIntent.metadata.ownerId : null,
          tier, periodMonths, receivedCents: Number.isSafeInteger(paymentIntent.amount_received) ? paymentIntent.amount_received : null}});}
      if (nativePayment && operationRef && operation?.state !== 'settled') tx.update(operationRef, await financialRecoverySourceFields('shop_tier',operationRef,operation!,{state: 'review_required',
        paymentIntentId: paymentIntent.id, updatedAt: FieldValue.serverTimestamp()}));
      return {applied: false as const, reason};
    };
    if (!operationRef || !qualifiedShopTierOperation(operation, operationId)) return review('native_operation_unknown');
    if (!shopTierPaymentMatches(paymentIntent, operation, operationId, true)) return review('native_payment_identity_conflict');
    nativePayment = true;
    // Historical effects are recognized before today's shop status or prices.
    if (operation.state === 'settled') return ledger?.chargeId === stripeChargeId(paymentIntent.latest_charge) && qualifiedShopTierSettlement(operation, operationId, ledger)
      ? {applied: false as const, reason: 'already_applied'} : review('settlement_evidence_unknown');
    if (Object.prototype.hasOwnProperty.call(operation, 'settlement') || ledger || snap.data()?.tierPaymentIntentId === paymentIntent.id)
      return review('historical_effect_requires_reconciliation');
    if (!['reserved', 'pending', 'unknown'].includes(operation.state)) return review('native_operation_not_payable');
    if(slotRef&&(slot?.protocol!=='shop_tier_request_slot_v1'||slot.ownerId!==operation.ownerId||slot.shopId!==shopId||slot.currentOperationId!==operationId))
      return review('native_request_slot_unqualified');
    if (!snap.exists) return review('shop_not_found');
    const shop = snap.data()!;
    if (shop.ownerId !== operation.ownerId) return review('shop_owner_changed');
    if (shop.status !== 'approved') return review('not_approved');
    const now = Timestamp.now();
    // Preparation is not authority for a later grant: the current entitlement
    // must still be the exact native receipt read in this commit's read set.
    if (slotRef) {
      const entitlement = slot?.entitlement;
      if (entitlement === null) {
        if (['pro','premium'].includes(shop.tier) || shop.tierPaidUntil != null || shop.tierPaymentIntentId != null)
          return review('current_entitlement_conflict');
      } else {
        if (!entitlement || !/^forfait_[a-f0-9]{64}$/.test(entitlement.operationId ?? '') ||
            !/^[a-f0-9]{64}$/.test(entitlement.proofHash ?? '')) return review('current_entitlement_unknown');
        const entitled = (await tx.get(db.collection('eligibility_audit').doc(entitlement.operationId))).data();
        const entitledLedger = typeof entitled?.paymentIntentId === 'string' && /^pi_[A-Za-z0-9_]+$/.test(entitled.paymentIntentId)
          ? (await tx.get(db.collection('platform_ledger').doc('shop_tier_revenue_' + entitled.paymentIntentId))).data() : null;
        const proof = entitled?.settlement;
        if (!qualifiedShopTierSettlement(entitled,entitlement.operationId,entitledLedger) || !entitled ||
            entitled.ownerId !== operation.ownerId || entitled.shopId !== shopId || !proof || proof.proofHash !== entitlement.proofHash ||
            shop.tierPaymentIntentId !== entitled.paymentIntentId || !(shop.tierPaidUntil instanceof Timestamp) ||
            !shop.tierPaidUntil.isEqual(proof.paidUntil) ||
            !(shop.tier === entitled.tier || shop.tier === 'basic' && proof.paidUntil.toMillis() <= now.toMillis()))
          return review('current_entitlement_conflict');
      }
    }
    const chargeId = stripeChargeId(paymentIntent.latest_charge);
    if (!chargeId) return review('captured_charge_unknown');
    const currentUntilMs = shop.tierPaidUntil == null ? 0 : shop.tierPaidUntil instanceof Timestamp
      ? shop.tierPaidUntil.toMillis() : NaN;
    if (!Number.isSafeInteger(currentUntilMs) || currentUntilMs < 0) return review('current_entitlement_unknown');
    const paidUntilDate = new Date(Math.max(now.toMillis(), currentUntilMs));
    paidUntilDate.setMonth(paidUntilDate.getMonth() + operation.periodMonths);
    if (!Number.isSafeInteger(paidUntilDate.getTime()) || paidUntilDate.getTime() > 253402300799999)
      return review('entitlement_limit_unknown');
    const paidUntil = Timestamp.fromDate(paidUntilDate);
    const pricing=qualifiedShopTierTaxOperation(operation);
    const settlement = {protocol: pricing?'shop_tier_settlement_v2':'shop_tier_settlement_v1', operationId, ownerId: operation.ownerId, shopId, tier: operation.tier,
      periodMonths: operation.periodMonths, amountCents: operation.amountCents, currency: 'CAD', paymentIntentId: paymentIntent.id,
      ...(pricing?{taxPricingVersion:SHOP_TIER_TAX_PRICING_VERSION,pricingHash:pricing.hash,taxDecisionHash:pricing.taxDecisionHash}:{}),
      chargeId, recordedAt: now, paidUntil};
    const proofHash = settlementHash(settlement);
    await recoveryCommit({refs: [(shopRef).path]});
    tx.update(shopRef, await financialRecoverySourceFields('shop_entitlement',shopRef,shop,{tier: operation.tier, tierPaidUntil: paidUntil, tierPaymentIntentId: paymentIntent.id,
      tierChargeId: chargeId, updatedAt: FieldValue.serverTimestamp()}));
    await recoveryCommit({refs: [(ledgerRef).path]});
    tx.create(ledgerRef, {type: 'shop_tier_revenue', shopId, ownerId: operation.ownerId, tier: operation.tier,
      periodMonths: operation.periodMonths, amount: (pricing?pricing.netCents:operation.amountCents) / 100, paymentIntentId: paymentIntent.id,
      ...(pricing?{shopTierPricingVersion:SHOP_TIER_TAX_PRICING_VERSION,taxAccounting:'revenue_excludes_tax_with_informational_components_v1',
        pricingHash:pricing.hash,taxDecisionHash:pricing.taxDecisionHash,netRevenueCents:pricing.netCents,gstCents:pricing.gstCents,qstCents:pricing.qstCents,
        taxCollectedCents:pricing.taxCents,totalCollectedCents:pricing.totalCents}:{}),
      chargeId, currency: 'cad', createdAt: now, shopTierOperationId: operationId, shopTierSettlementHash: proofHash});
    await recoveryCommit({refs: [(operationRef).path]});
    tx.update(operationRef, await financialRecoverySourceFields('shop_tier',operationRef,operation,{state: 'settled', paymentIntentId: paymentIntent.id, settlement: {...settlement, proofHash},
      settledAt: now, updatedAt: FieldValue.serverTimestamp()}));
    if(slotRef){ await recoveryCommit({refs: [(slotRef).path]}); tx.update(slotRef,await financialRecoverySourceFields('shop_tier',slotRef,slot!,{entitlement:{operationId,proofHash},updatedAt:now})); }
    return {applied: true as const, ownerId: operation.ownerId, tier: operation.tier, amountCents: operation.amountCents,
      periodMonths: operation.periodMonths, paidUntilIso: paidUntil.toDate().toISOString(),
      isRenewal: currentUntilMs > now.toMillis() || typeof shop.tier === 'string'};
  });
  if (!result.applied) {
    logger.info('Stripe webhook: shop tier unchanged', {shopId, paymentIntentId: paymentIntent.id, reason: result.reason});
    return;
  }
  logger.info('Stripe webhook: shop tier applied', {shopId, tier: result.tier, periodMonths: result.periodMonths, paidUntil: result.paidUntilIso});
  await captureServerEvent(result.ownerId, 'shop_tier_activated', {shop_id: shopId, tier: result.tier,
    period_months: result.periodMonths, amount_cents: result.amountCents, is_renewal: result.isRenewal,
    $set: {shop_tier: result.tier, has_shop: true}, $insert_id: `shop_tier_${paymentIntent.id}`});

    });
  }

/** Only a signed, exact canceled PI closes a pending owner operation. A failed
 * payment attempt is retryable at Stripe and is deliberately not terminal. */
export async function handleShopTierCanceled(paymentIntent: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/shopTier.handleShopTierCanceled"}, async () => {
  const operationId = paymentIntent.metadata?.secondAccountOperationId;
  if (typeof operationId !== 'string' || !/^forfait_[a-f0-9]{64}$/.test(operationId)) return;
  const ref = db.collection('eligibility_audit').doc(operationId);
  await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const witness = (await tx.get(ref)).data();
    if (!qualifiedShopTierOperation(witness, operationId) || !shopTierPaymentMatches(paymentIntent, witness, operationId, false) ||
        paymentIntent.status !== 'canceled') throw new Error('Forfait cancellation identity conflict');
    if (['settled', 'review_required'].includes(witness.state)) return;
    const priorCancellation=(witness as FirebaseFirestore.DocumentData).cancellation;
    if(witness.state==='canceled' && priorCancellation?.paymentIntentId===paymentIntent.id && priorCancellation?.providerStatus==='canceled')return;
    const cancellation = witness.requestProtocol === SHOP_TIER_PURCHASE_CAPABILITY && !Object.prototype.hasOwnProperty.call(witness,'cancellation')
      ? shopTierCancellationProof(witness,operationId,paymentIntent,'signed_webhook') : null;
    await recoveryCommit({refs: [(ref).path]});
    tx.update(ref, await financialRecoverySourceFields('shop_tier',ref,witness,{ state: 'canceled', paymentIntentId: paymentIntent.id,
      ...(cancellation?{cancellation}:{}),
      ...(witness.canceledAt === undefined?{canceledAt:FieldValue.serverTimestamp()}:{}), updatedAt: FieldValue.serverTimestamp() }));
  });

    });
  }

// =============================================================================
// HANDLER: payment_intent.payment_failed
// =============================================================================
