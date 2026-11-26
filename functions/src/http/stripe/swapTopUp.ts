import { financialRecoveryCommitCheckpoint } from "../../utils/financialRecoverySources";
import { financialRecoveryWalletFields } from "../../utils/financialRecoverySources";
import { financialRecoverySourceFields, prepareFinancialRecoverySource } from '../../utils/financialRecoverySources';
import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
/**
 * Webhook Stripe — Complément cash d'un échange : encaissement et remboursement.
 *
 * Éclaté depuis functions/src/http/webhooks.ts (2972 lignes). Le dispatcher
 * et la vérification de signature restent dans webhooks.ts.
 */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../../config/firebase';
import { getOrCreateSellerWallet } from '../../callable/wallet';
import { writeFailedOperation } from '../../utils/failedOperations';
import { captureServerEvent } from '../../lib/analytics';
import { qualifyManualSwapTopUpSettlement, qualifyManualSwapTopUpRefundSource } from '../../utils/swapTopUpCheckout';
import { supportHash, supportSourceHash } from '../../utils/supportRequest';
import { observedSwapTopUpNeutralization } from '../../utils/swapTopUpCheckoutProof';
import {requestSwapTopUpRefund, observeSwapTopUpRefund} from '../../utils/swapTopUpRefund';
import {hasNativeAcceptedSwapAgreement} from '../../utils/swapLaunchPolicy';

/**
 * Confirm a swap cash top-up payment.
 *
 * Calqued on handlePaymentIntentSucceeded for purchases:
 *  1. Idempotence: only advance a swap still in 'payment_pending'.
 *  2. Verify the amount matches the stored topUpFee + base top-up amount.
 *  3. Transition swap 'payment_pending' → 'accepted' (exchange mode flow next).
 *  4. Credit the payee wallet pendingBalance (escrow) with the base top-up
 *     amount (the platform keeps the fee, mirroring 0% seller commission).
 *     Funds are released to `balance` at confirmSwapReception.
 *
 * The top-up `amount` in metadata is in CENTS (base amount, fee excluded).
 */

export async function handleSwapTopUpSucceeded(paymentIntent: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/swapTopUp.handleSwapTopUpSucceeded"}, async () => {
  const swapId = paymentIntent.metadata?.swapId;

  if (
    typeof swapId !== 'string' ||
    swapId.length === 0 ||
    swapId.length > 200 ||
    swapId.includes('/')
  ) {
    logger.error('Stripe webhook: swap_topup PaymentIntent missing/invalid swapId', {
      paymentIntentId: paymentIntent.id,
      swapId,
    });
    return;
  }

  const payeeId = paymentIntent.metadata?.payeeId;
  const baseAmountCents = parseInt(paymentIntent.metadata?.topUpAmount || '0', 10);

  if (typeof payeeId !== 'string' || !payeeId || !Number.isInteger(baseAmountCents) || baseAmountCents <= 0) {
    logger.error('Stripe webhook: swap_topup PaymentIntent missing payeeId/topUpAmount', {
      paymentIntentId: paymentIntent.id,
      swapId,
    });
    return;
  }

  const amountReceivedCents = paymentIntent.amount_received || paymentIntent.amount;
  const swapRef = db.collection('swaps').doc(swapId);

  // Terminal states a swap can never advance OUT of into the exchange flow. If a
  // late top-up capture lands here while the swap already reached one of these,
  // the payer was charged for an exchange that will never happen → refund.
  const CANCELLED_LIKE = new Set(['cancelled', 'declined', 'expired', 'disputed']);

  const result = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const swapSnap = await tx.get(swapRef);
    const swap = swapSnap.data();

    if (!swap) {
      logger.error('Stripe webhook: swap_topup swap not found', { swapId });
      return { outcome: 'not_found' as const };
    }

    const nativePayee = swap.cashTopUp?.payerId === swap.initiatorId ? swap.receiverId : swap.initiatorId;
    const nativeIntention = await tx.get(swapRef.collection('topup_checkout').doc('current'));
    const retirement = (await tx.get(swapRef.collection('topup_checkout').doc('legacy_retirement'))).data();
    const retired = observedSwapTopUpNeutralization(retirement,swapId,swap.cashTopUp?.payerId,nativePayee)&&
      retirement!.document.paymentIntentId===paymentIntent.id&&supportSourceHash(retirement!.document)===retirement!.contentHash;
    const manual = nativeIntention.exists || paymentIntent.metadata?.swapCheckoutIntentId != null || swap.topUpCheckoutProtocol === 'swap_server_manual_v1';
    const identity = paymentIntent.id === swap.topUpPaymentIntentId && paymentIntent.metadata?.payerId === swap.cashTopUp?.payerId &&
      payeeId === nativePayee && paymentIntent.metadata?.topUpAmount === String(swap.cashTopUp?.amount) && paymentIntent.currency === 'cad' &&
      paymentIntent.transfer_data == null && (paymentIntent.application_fee_amount == null || paymentIntent.application_fee_amount === 0);
    const normalManualSettlement = !manual || await qualifyManualSwapTopUpSettlement(tx, swapId, swap, paymentIntent);
    const manualAnomalyOnly = manual && !normalManualSettlement &&
      await qualifyManualSwapTopUpRefundSource(tx, swapId, swap, paymentIntent);
    if (!identity || retired || manual && !normalManualSettlement && !manualAnomalyOnly) {
      // A late retired/foreign PI cannot replace the current PI, amounts or
      // receipt. Keep a durable financial reconciliation before webhook ACK.
      const key = supportHash(['swap_topup_identity', paymentIntent.id]);
      const reviewRef = db.collection('swap_topup_reconciliation').doc(key), existing = await tx.get(reviewRef);
      if (!existing.exists) {
        await recoveryCommit({refs: [(reviewRef).path]});
    tx.create(reviewRef, {protocol:'swap_topup_reconciliation_v1',swapId,paymentIntentId:paymentIntent.id,
          currentPaymentIntentId:swap.topUpPaymentIntentId??null,reason:'current_identity_or_native_authorization_unknown',
          observed:{status:paymentIntent.status??null,amountReceivedCents:Number.isSafeInteger(paymentIntent.amount_received)?paymentIntent.amount_received:null,
            amountCents:Number.isSafeInteger(paymentIntent.amount)?paymentIntent.amount:null,currency:paymentIntent.currency??null},
          createdAt:FieldValue.serverTimestamp(),financialEffectApplied:false});
        await recoveryCommit({refs: [(db.collection('admin_alerts').doc(`swap_topup_${key}`)).path]});
    tx.create(db.collection('admin_alerts').doc(`swap_topup_${key}`), {type:'swap_topup_reconciliation',severity:'critical',swapId,
          message:'Paiement de complément à rapprocher : identité courante ou autorisation native inconnue.',createdAt:FieldValue.serverTimestamp()});
      }
      return {outcome:'identity_reconciliation' as const};
    }

    const noCreditSettlement = async (source: 'overpaid_capture' | 'cancelled_capture') => {
      if (swap.topUpSettlement != null || swap.topUpPaidAt != null ||
          ['topUpRefundId', 'topUpRefundedAt', 'topUpRefundReconciledAt', 'topUpReleasedAt', 'topUpFundsHeldAt']
            .some(key => Object.prototype.hasOwnProperty.call(swap, key))) return null;
      const ledger = await tx.get(db.collection('wallets').doc(nativePayee).collection('ledger').where('swapId', '==', swapId).limit(1));
      if (!ledger.empty || !Number.isSafeInteger(amountReceivedCents) || amountReceivedCents <= 0) return null;
      return {protocol: 'swap_topup_settlement_v1', state: 'not_credited', source, swapId, paymentIntentId: paymentIntent.id,
        payerId: swap.cashTopUp.payerId, payeeId: nativePayee, baseCents: swap.cashTopUp.amount,
        capturedCents: amountReceivedCents, recordedAt: FieldValue.serverTimestamp()};
    };

    // SECURITY: verify the charged amount matches base + fee from the swap doc.
    //
    // P1 (dead-letter, not throw): a swap top-up amount mismatch is a
    // DETERMINISTIC error (the captured charge and the stored base+fee will not
    // change on a Stripe retry). Throwing here propagated to a 500, which (a) made
    // Stripe re-deliver the same event for ~3 days to no effect, and (b) left the
    // charge captured while the swap never advanced and the payee was never
    // credited — a silent loss with no audit trail. Instead we RETURN a structured
    // outcome; the caller persists a dead-letter (and auto-refunds idempotently if
    // the payer OVERPAID) and ACKs 200, mirroring the purchase amount_mismatch path.
    const expectedTotalCents = baseAmountCents + (swap.topUpFee || 0) + (manual ? swap.topUpTax || 0 : 0);
    if (Math.abs(amountReceivedCents - expectedTotalCents) > 1) {
      logger.error('Stripe webhook: swap_topup amount mismatch', {
        swapId,
        received: amountReceivedCents,
        expected: expectedTotalCents,
      });
      const settlement = amountReceivedCents - expectedTotalCents > 1 ? await noCreditSettlement('overpaid_capture') : null;
      await recoveryCommit({refs: [(swapRef).path]});
    tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,{
        ...(settlement ? {topUpSettlement: settlement} : {}),
        topUpPaymentIntentId: paymentIntent.id,
        topUpChargeId: paymentIntent.latest_charge || null,
        updatedAt: FieldValue.serverTimestamp(),
      }));
      return {
        outcome: 'amount_mismatch' as const,
        mismatch: {
          received: amountReceivedCents,
          expected: expectedTotalCents,
          // Payer overpaid → a full refund of the (direct platform) charge makes
          // them whole; underpaid → a human decides (refund vs chase the balance).
          payerOverpaid: amountReceivedCents - expectedTotalCents > 1,
        },
      };
    }

    // A1 (race capture vs cancellation/expiry): the swap was cancelled (by the
    // initiator) or expired (expireStaleProposedSwaps) BEFORE this capture landed.
    // The payer was debited but the exchange is dead → refund, mirroring the
    // purchase `cancelled_needs_refund` path. The wallet was NEVER credited (we
    // only credit on the payment_pending → accepted transition below), so there is
    // nothing to reverse internally. A native pre-credit receipt records that
    // fact; absence of a ledger alone never authorizes a debit. We persist the PI/charge
    // ids so the post-transaction refund and any reconciliation can resolve them.
    if (CANCELLED_LIKE.has(swap.status)) {
      logger.warn('Stripe webhook: swap_topup captured on a cancelled/expired swap — will refund', {
        swapId,
        currentStatus: swap.status,
      });
      const settlement = await noCreditSettlement('cancelled_capture');
      await recoveryCommit({refs: [(swapRef).path]});
    tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,{
        ...(settlement ? {topUpSettlement: settlement} : {}),
        topUpPaidAt: swap.topUpPaidAt ?? FieldValue.serverTimestamp(),
        topUpPaymentIntentId: paymentIntent.id,
        topUpChargeId: paymentIntent.latest_charge || null,
        updatedAt: FieldValue.serverTimestamp(),
      }));
      return { outcome: 'cancelled_needs_refund' as const };
    }

    // IDEMPOTENCE: only advance a swap still awaiting payment. Any other status
    // (accepted/photos_pending/shipping/completed…) means a prior delivery of a
    // top-up capture already advanced this swap — do nothing.
    if (swap.status !== 'payment_pending') {
      logger.info('Stripe webhook: swap_topup already processed or not pending', {
        swapId,
        currentStatus: swap.status,
      });
      return { outcome: 'already_processed' as const };
    }
    // The exception above qualifies only the anomaly refund source. It cannot
    // admit a normal seller credit, even if a later comparison changes.
    if (!normalManualSettlement) return {outcome: 'identity_reconciliation' as const};
    await prepareFinancialRecoverySource('swap',swapRef.path,swap);

    // Credit payee wallet pendingBalance (escrow), auto-create if absent.
    const { walletRef, walletData, isNew } = await getOrCreateSellerWallet(tx, payeeId);
    if (!isNew) {
      await recoveryCommit({refs: [(walletRef).path]});
    tx.update(walletRef, await financialRecoveryWalletFields(walletRef,walletData,{
        pendingBalance: FieldValue.increment(baseAmountCents),
        updatedAt: FieldValue.serverTimestamp(),
      },{pendingBalance: ((walletData)["pendingBalance"]??0) + (baseAmountCents)}));
    } else {
      await recoveryCommit({refs: [(walletRef).path]});
    tx.update(walletRef, await financialRecoveryWalletFields(walletRef,walletData,{
        pendingBalance: baseAmountCents,
        updatedAt: FieldValue.serverTimestamp(),
      },{}));
    }

    const ledgerRef = walletRef.collection('ledger').doc();
    await recoveryCommit({refs: [(ledgerRef).path]});
    tx.set(ledgerRef, {
      type: 'sale_credit',
      currency:'CAD',
      paymentIntentId:paymentIntent.id,
      amount: baseAmountCents,
      balanceAfter: (walletData.pendingBalance || 0) + baseAmountCents,
      description: 'Complément d\'échange — fonds en attente',
      swapId,
      createdAt: FieldValue.serverTimestamp(),
      status: 'pending',
    });

    // Native postal terms are already agreed by both members. Legacy sources
    // keep their separate preparation step rather than inventing agreement.
    const settledStatus = swap.exchangeMode === 'shipping' && hasNativeAcceptedSwapAgreement(swap) ? 'photos_pending' : 'accepted';
    await recoveryCommit({refs: [(swapRef).path]});
    tx.update(swapRef, await financialRecoverySourceFields('swap',swapRef,swap,{
      status: settledStatus,
      topUpPaidAt: FieldValue.serverTimestamp(),
      topUpPaymentIntentId: paymentIntent.id,
      topUpChargeId: paymentIntent.latest_charge || null,
      updatedAt: FieldValue.serverTimestamp(),
    }));

    return {
      outcome: 'accepted' as const,
      payerId:
        swap.cashTopUp && typeof swap.cashTopUp.payerId === 'string'
          ? swap.cashTopUp.payerId
          : null,
    };
  });

  // P1 (amount mismatch — deterministic): the captured top-up amount does not
  // match base+fee from the swap doc. This cannot self-heal on a Stripe retry, so
  // we MUST NOT 500. We always persist a dead-letter for audit/reconciliation. If
  // the payer OVERPAID we additionally auto-refund the full (direct platform)
  // charge idempotently — a defensive, payer-favourable action. An UNDERPAYMENT is
  // left for a human (refunding the full charge vs chasing the balance is a
  // business decision). Either way we ACK 200 so Stripe stops retrying.
  if (result.outcome === 'amount_mismatch') {
    const mismatch = 'mismatch' in result ? result.mismatch : undefined;
    const payerOverpaid = mismatch?.payerOverpaid === true;
    if (payerOverpaid) {
      await requestSwapTopUpRefund(swapId, 'overpaid_capture', paymentIntent.id);
    } else {
      // Underpaid: no safe automatic refund. Persist an audit
      // dead-letter for manual reconciliation. amount_mismatch with autoRefund:false
      // keeps it visible (retryFailedOperations logs CRITICAL until it exhausts)
      // without taking a money-moving action a human must decide.
      await writeFailedOperation({
        type: 'amount_mismatch',
        refId: swapId,
        payload: {
          paymentIntentId: paymentIntent.id,
          received: mismatch?.received ?? amountReceivedCents,
          expected: mismatch?.expected ?? null,
          isMixedCharge: true,
          autoRefund: false,
          kind: 'swap_topup_amount_mismatch',
        },
        error: 'Swap top-up amount does not match expected base+fee total',
      });
      logger.error('CRITICAL Stripe webhook: swap_topup amount underpaid — dead-lettered for manual reconciliation', {
        swapId,
        paymentIntentId: paymentIntent.id,
      });
    }
    // ACK 200 (return normally): the outer handler responds received:true.
    return;
  }

  if (result.outcome === 'cancelled_needs_refund') {
    await requestSwapTopUpRefund(swapId, 'cancelled_capture', paymentIntent.id);
    return;
  }

  if (result.outcome === 'accepted') {
    logger.info('Stripe webhook: swap top-up confirmed, swap advanced to accepted', {
      swapId,
      paymentIntentId: paymentIntent.id,
      payeeId,
    });
    // Analytics (§12): distinct_id = payer of the cash top-up.
    const payerId = 'payerId' in result ? result.payerId : null;
    if (payerId) {
      await captureServerEvent(payerId, 'swap_topup_paid', {
        swap_id: swapId,
        cash_top_up_cents: baseAmountCents,
        payer_id: payerId,
        $insert_id: `swap_topup_${swapId}`,
      });
    }
  }

    });
  }

// =============================================================================
// HANDLER: payment_intent.succeeded (metadata.type === 'shop_tier') — F134
// =============================================================================

/**
 * Confirm a paid shop tier forfait purchase. AFTER the platform charge succeeds:
 *  1. Verify the captured amount matches the server forfait price (base+period).
 *  2. Idempotently stamp `tier` + `tierPaidUntil` (now + periodMonths) on the
 *     shop. A replay (same status guard via tierPaymentIntentId) is a no-op.
 *  3. Write a `shop_tier_revenue` platform_ledger entry (idempotent, deterministic
 *     id) so the forfait revenue is accounted (E6).
 *
 * tier/tierPaidUntil are CF-only in firestore.rules — only this Admin SDK path
 * (and admin moderation) may set them; a client can never self-attribute a tier.
 */

/** An event is a hint only. Current provider evidence and the immutable native
 * intention own the one attributed wallet debit and terminal receipt. */
export async function handleSwapTopUpRefund(swapDoc: FirebaseFirestore.QueryDocumentSnapshot,
  expectedPi?: string, eventRefundId?: string): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/swapTopUp.handleSwapTopUpRefund"}, async () => {
  await observeSwapTopUpRefund(swapDoc.id, expectedPi, eventRefundId);

    });
  }
