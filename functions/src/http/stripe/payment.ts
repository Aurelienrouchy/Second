import {orphanCaptureBlocksPayment} from '../../utils/orphanCaptureRefund';
import { financialRecoveryCommitCheckpoint } from "../../utils/financialRecoverySources";
import { financialRecoverySourceFields, writeFinancialRecoveryPurchaseDiagnostic, prepareFinancialRecoverySource } from '../../utils/financialRecoverySources';
import { FinancialRecoveryBlocked } from '../../utils/financialRecoveryInterlock';
import { financialRecoveryWalletFields } from "../../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
import {preparePurchasePlatformAccounting} from '../../utils/refundAccounting';
import { recordPaymentCaptureAnomaly, validCaptureReference, validCapturedPaymentIntent, paymentCaptureScope, type PaymentCaptureContext } from '../../utils/paymentCaptureAnomaly';
import { hasActiveBankDispute } from '../../utils/bankDispute';
import { hasUnsettledRefund } from '../../utils/refundState';
import { articleReleaseUpdate, articleReservationOwnedBy, commitArticleRelease } from '../../utils/articleReservation';
import { inventoryEngagementMatches, inventoryUnitView } from '../../utils/inventoryUnit';
import { prepareFraudCandidateProjection } from '../../utils/fraudReviewCandidates';
/**
 * Webhook Stripe — Encaissement d'une commande : PaymentIntent réussi ou échoué.
 *
 * Éclaté depuis functions/src/http/webhooks.ts (2972 lignes). Le dispatcher
 * et la vérification de signature restent dans webhooks.ts.
 */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../../config/firebase';
import { getShipEngine } from '../../config/shipEngine';
import { getStripe } from '../../config/stripe';
import { prepareOperationalNotices } from '../../utils/notifications';
import { creditSellerForSale, recordTransactionRevenue, createLabelIdempotent } from '../../utils/labelFulfillment';
import { writeFailedOperation } from '../../utils/failedOperations';
import { issueTransactionRefund, resumeTransactionRefund, readPendingCancellationReceipt } from '../../utils/refund';
import { captureServerEvent } from '../../lib/analytics';
import { exactCents } from '../../utils/shippingPurchaseRate';
import { Timestamp } from 'firebase-admin/firestore';
import { paidPurchasePolicyUpdate } from '../../utils/purchasePolicy';

export async function handlePaymentIntentSucceeded(paymentIntent: any, context: PaymentCaptureContext = {}): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/payment.handlePaymentIntentSucceeded"}, async () => {
  if (paymentCaptureScope(context) !== 'platform') {
    await recordPaymentCaptureAnomaly(paymentIntent, 'payment_account_scope_unqualified', context);
    return;
  }
  const transactionId = paymentIntent?.metadata?.transactionId;
  if (!transactionId) {
    await recordPaymentCaptureAnomaly(paymentIntent, 'missing_reference', context);
    return;
  }
  if (!validCaptureReference(transactionId)) {
    await recordPaymentCaptureAnomaly(paymentIntent, 'invalid_reference', context);
    return;
  }
  if (!validCapturedPaymentIntent(paymentIntent?.id)) {
    await recordPaymentCaptureAnomaly(paymentIntent, 'invalid_payment_intent', context);
    return;
  }
  // amount is planned/authorized, amount_received alone proves collection.
  const amountReceivedCents = paymentIntent.amount_received;
  if (paymentIntent.currency !== 'cad') {
    await recordPaymentCaptureAnomaly(paymentIntent, 'invalid_currency', context);
    return;
  }
  if (!Number.isSafeInteger(amountReceivedCents) || amountReceivedCents <= 0) {
    await recordPaymentCaptureAnomaly(paymentIntent, 'invalid_capture_amount', context);
    return;
  }
  const paymentProof = { id: paymentIntent.id, currency: paymentIntent.currency, capturedCents: amountReceivedCents, transactionId };
  const amountReceivedDollars = amountReceivedCents / 100;

  // Only the stored order determines its wallet/card allocation.
  let isMixedPayment = false;
  let walletAmountUsedCents = 0;

  const transactionRef = db.collection('transactions').doc(transactionId);

  // =====================================================================
  // ATOMIC TRANSACTION: idempotence + mark paid + mark sold + credit seller
  // =====================================================================

  const result = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    if(await orphanCaptureBlocksPayment(tx,paymentIntent.id))return {processed:false,reason:'orphan_capture_original_refund_reserved' as const};
    const txSnap = await tx.get(transactionRef);
    const txData = txSnap.data();

    if (!txData) {
      logger.error('Stripe webhook: transaction not found', { transactionId });
      return { processed: false, reason: 'transaction_not_found' };
    }

    if (!validCapturedPaymentIntent(txData.stripePaymentIntentId)) {
      return { processed: false, reason: 'native_payment_identity_unqualified', originalPaymentIntentId: txData.stripePaymentIntentId ?? null };
    }
    if (txData.stripePaymentIntentId !== paymentIntent.id) {
      logger.error('Stripe payment proof does not match stored PaymentIntent', { transactionId });
      return { processed: false, reason: 'payment_identity_mismatch', originalPaymentIntentId: txData.stripePaymentIntentId };
    }
    isMixedPayment = txData.paidVia === 'wallet_and_card' || txData.paidVia === 'mixed';
    walletAmountUsedCents = isMixedPayment ? txData.walletAmountUsed : 0;
    // A committed cancellation may have cleared its wallet markers after
    // restitution. Recover the former split only from its receipt AND ledger;
    // this qualifies the capture, never authorizes another wallet credit.
    const priorRefund = txData.refund;
    const cancelledRefundReplay = ['refund_in_progress', 'refund_action_required', 'refunded'].includes(txData.status) &&
      priorRefund?.originalStatus === 'cancelled' && priorRefund.requestedAt instanceof Timestamp &&
      priorRefund.paymentIntentId === paymentIntent.id && priorRefund.currency === 'cad' &&
      priorRefund.capturedCardCents === amountReceivedCents && priorRefund.cardAmountCents === amountReceivedCents &&
      priorRefund.walletAmountCents === 0;
    const walletAlreadyRestituted = (txData.status === 'cancelled' || cancelledRefundReplay) && txData.pendingCancellation?.state === 'committed';
    if (walletAlreadyRestituted) {
      if (!await readPendingCancellationReceipt(tx, transactionId, cancelledRefundReplay ? { ...txData, status: 'cancelled' } : txData)) {
        return { processed: false, reason: 'wallet_amount_invalid' };
      }
      walletAmountUsedCents = txData.pendingCancellation.walletRefundCents;
      isMixedPayment = walletAmountUsedCents > 0;
    }
    const totalCents = exactCents(txData.totalAmount);
    const expectedAmounts = { totalCents, walletCents: Number.isSafeInteger(walletAmountUsedCents) && walletAmountUsedCents >= 0 ? walletAmountUsedCents : null,
      cardCents: null as number | null };
    if (!Number.isSafeInteger(walletAmountUsedCents) || walletAmountUsedCents < 0 || txData.paidVia === 'wallet' ||
        (!walletAlreadyRestituted && !isMixedPayment && txData.walletAmountUsed !== undefined && txData.walletAmountUsed !== 0)) {
      return { processed: false, reason: 'wallet_amount_invalid', expectedAmounts };
    }
    if (totalCents === null || totalCents <= 0 || walletAmountUsedCents >= totalCents) {
      return { processed: false, reason: 'expected_amount_invalid', expectedAmounts };
    }
    const expectedCardCents = totalCents - walletAmountUsedCents;
    expectedAmounts.cardCents = expectedCardCents;
    if (txData.currency != null && txData.currency !== 'CAD') return { processed: false, reason: 'invalid_currency', expectedAmounts };

    // Exact canonical cents, including historical orders: a missing total is
    // unqualified, and even a one-cent difference must never become a sale.
    // An anomaly must be durably recorded outside this transaction before ACK.
    if (amountReceivedCents !== expectedCardCents) {
        logger.error(
          `Stripe webhook: amount mismatch${isMixedPayment ? ' (mixed payment)' : ''}`,
          {
            transactionId,
            received: amountReceivedDollars,
            expected: expectedCardCents / 100,
            expectedTotal: totalCents / 100,
            walletCents: walletAmountUsedCents,
          }
        );
        // Buyer is short-changed (paid LESS than owed) => seller would be
        // under-funded; buyer overpaid (paid MORE) => buyer is owed a refund.
        // Either way the platform must NOT mark this paid blindly.
        return {
          processed: false,
          reason: 'amount_mismatch' as const,
          expectedAmounts,
          walletAlreadyRestituted,
          // Carry the tx data so the buyer-overpaid auto-refund can reuse the
          // shared refund core (atomic Stripe refund + wallet reconciliation).
          txData,
          mismatch: {
            received: amountReceivedDollars,
            expected: expectedCardCents / 100,
            expectedTotal: totalCents / 100,
            walletCents: walletAmountUsedCents,
            isMixedPayment,
            // Buyer overpaid → refunding makes them whole; underpaid → manual.
            buyerOverpaid: amountReceivedCents > expectedCardCents,
          },
        };
    }

    // Existing states remain monotone after exact capture qualification.
    if (['paid', 'label_created', 'shipped', 'delivered', 'completed', 'disputed', 'return_requested', 'delivery_failed', 'lost', 'meetup_completed'].includes(txData.status)) return { processed: false, reason: 'already_processed' };
    if (txData.refund || ['refund_in_progress', 'refund_action_required', 'refunded'].includes(txData.status)) return { processed: false, reason: 'refund_obligation', txData };

    // IDEMPOTENCE: If already paid/label_created/shipped/delivered, do nothing
    // (replay protection).
    const currentStatus = txData.status;
    if (
      currentStatus === 'paid' ||
      currentStatus === 'label_created' ||
      currentStatus === 'shipped' ||
      currentStatus === 'delivered'
    ) {
      logger.info('Stripe webhook: transaction already processed', {
        transactionId,
        currentStatus,
      });
      return { processed: false, reason: 'already_processed' };
    }

    // P1 (expiration vs payment in flight): the order was cancelled/expired
    // BEFORE this success landed (e.g. the 1h expiry raced a late capture, or
    // the buyer paid right after the order was cancelled). We must NOT mark it
    // paid — the article may already be relisted/sold. Instead, trigger an
    // idempotent Stripe refund AFTER the transaction so the buyer is made whole.
    // Already-refunded / in-progress states need no new refund (the refund key
    // is deterministic, so even a duplicate request would be a no-op, but we
    // skip to avoid noise).
    if (
      currentStatus === 'cancelled' ||
      currentStatus === 'refund_in_progress' ||
      currentStatus === 'refunded'
    ) {
      logger.warn('Stripe webhook: PI.succeeded on a non-payable transaction — will refund', {
        transactionId,
        currentStatus,
      });
      return {
        processed: false,
        reason: currentStatus === 'cancelled' ? 'cancelled_needs_refund' : 'already_refunded',
        walletAlreadyRestituted,
        // Carry the tx data so the post-transaction refund (issueTransactionRefund)
        // can re-credit the buyer wallet portion and debit the seller exactly what
        // was credited, in one atomic operation (no two-phase charge.refunded).
        txData,
      };
    }

    // A signed capture is money evidence, not authority over today's stock.
    // Qualify the original reservation under this lock before seller credit or
    // fulfilment. Existing paid/refund receipts above remain historical first.
    const articleRef = validCaptureReference(txData.articleId) ? db.collection('articles').doc(txData.articleId) : null;
    const article = articleRef ? (await tx.get(articleRef)).data() : null;
    const stockOwned = articleRef && article && article.sellerId === txData.sellerId &&
      await inventoryEngagementMatches(tx, articleRef.id, article,
        {kind: 'purchase', id: transactionId, sourceArticleId: articleRef.id}, txData.inventoryUnitCommitment) &&
      await articleReservationOwnedBy(tx, articleRef, article, transactionId);
    if (txData.paymentInventoryReconciliation != null || !stockOwned) {
      const source = {articleId: txData.articleId ?? null, articleSellerId: article?.sellerId ?? null,
        activeTransactionId: article?.activeTransactionId ?? null, inventoryUnit: article?.inventoryUnit ?? null,
        inventoryObservation: articleRef && article ? await inventoryUnitView(tx, articleRef.id, article) : null,
        expectedInventoryUnitCommitment: txData.inventoryUnitCommitment ?? null};
      const prior = txData.paymentInventoryReconciliation;
      await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,txData,{
        stripePaymentIntentId: paymentIntent.id,
        stripeChargeId: typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id ?? null,
        capturedCardCents: amountReceivedCents,
        refundBlocked: true, refundLegacyReconciliationRequired: true,
        paymentInventoryReconciliation: {protocol: 'captured_purchase_inventory_review_v1', state: 'reconciliation_required',
          reason: 'inventory_engagement_mismatch', paymentIntentId: paymentIntent.id, capturedCardCents: amountReceivedCents,
          firstObservedSource: prior?.protocol === 'captured_purchase_inventory_review_v1' && prior.paymentIntentId === paymentIntent.id
            ? prior.firstObservedSource ?? source : source,
          firstRecordedAt: prior?.protocol === 'captured_purchase_inventory_review_v1' && prior.paymentIntentId === paymentIntent.id && prior.firstRecordedAt instanceof Timestamp
            ? prior.firstRecordedAt : Timestamp.now(), lastObservedSource: source, lastObservedAt: Timestamp.now()},
      }));
      return {processed: false, reason: 'inventory_engagement_mismatch' as const, expectedAmounts};
    }

    // --- Credit seller's wallet pendingBalance ---
    // P1 (atomicity payment<->label): for SHIPPING transactions the seller is
    // credited ONLY after the shipping label is successfully created (deferred
    // to the label step / sweepPendingLabels). Crediting here then failing the
    // label would leave the seller paid for a parcel that never ships. For
    // non-shipping (meetup is handled elsewhere; this guards anything that is
    // not 'shipping') there is no label, so we credit immediately.
    //
    // F1: creditSellerForSale reads the wallet (tx.get via getOrCreateSellerWallet),
    // so it MUST run BEFORE any tx.update below — the Admin SDK forbids a read after
    // a buffered write in the same runTransaction (READ_AFTER_WRITE_ERROR).
    const sellerId = txData.sellerId;
    const fraudCandidates = await prepareFraudCandidateProjection(tx, transactionId, {...txData,
      stripePaymentIntentId: paymentIntent.id,
      stripeChargeId: typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id ?? null});
    const saleNotices = await prepareOperationalNotices(tx, [
      { eventKey: `payment_paid:${transactionId}:${paymentIntent.id}`, userId: sellerId, type: 'new_sale',
        title: 'Paiement enregistré pour votre vente',
        message: 'Le paiement de votre vente est enregistré. Consultez la commande pour connaître la prochaine étape et les documents disponibles.',
        data: { transactionId, paymentIntentId: paymentIntent.id } },
      { eventKey: `payment_paid:${transactionId}:${paymentIntent.id}`, userId: txData.buyerId, type: 'order_paid',
        title: 'Paiement enregistré', message: 'Le paiement de votre commande est enregistré. Consultez son suivi et les recours disponibles.',
        data: { transactionId, paymentIntentId: paymentIntent.id } },
    ]);
    const paymentRecordedAt = txData.paidAt instanceof Timestamp ? txData.paidAt : Timestamp.now();
    await prepareFinancialRecoverySource('purchase',transactionRef.path,txData);
    if(txData.stripeCheckoutProtocol==='server_manual_v1') {
      const checkoutRef=db.collection('stripe_checkout_intents').doc(transactionId), checkout=(await tx.get(checkoutRef)).data();
      if(!checkout || checkout.paymentIntentId!==paymentIntent.id || checkout.ownerId!==txData.buyerId || checkout.transactionId!==transactionId)
        throw new FinancialRecoveryBlocked('card_intent_source_unqualified');
      await prepareFinancialRecoverySource('card_intent',checkoutRef.path,checkout);
    }
    const accounting=await preparePurchasePlatformAccounting(tx,transactionId,txData,{payment:{kind:'stripe_payment_intent',
      referenceId:paymentIntent.id,amountCents:totalCents,walletCents:walletAmountUsedCents,cardCents:amountReceivedCents,recordedAt:paymentRecordedAt}});
    const recoveryCreditFields:Record<string,any>={};
    if (txData.deliveryType !== 'shipping') await creditSellerForSale(tx, transactionRef, txData, transactionId,recoveryCreditFields);

    // --- Mark transaction as paid ---
    accounting.commit();
    await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,txData,{
      ...recoveryCreditFields,
      status: 'paid',
      ...(txData.paidAt == null ? { paidAt: paymentRecordedAt } : {}),
      ...(txData.deliveryType === 'shipping' ? paidPurchasePolicyUpdate(txData, transactionId, paymentRecordedAt,
        { kind: 'stripe_payment_intent', referenceId: paymentIntent.id, amountCents: totalCents, walletCents: walletAmountUsedCents }) : {}),
      stripePaymentIntentId: paymentIntent.id,
      stripeChargeId: typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id ?? null,
      capturedCardCents: amountReceivedCents,
      // Durable in the paid commit: interruption before external fulfilment
      // must still leave this order discoverable by sweepPendingLabels.
      ...(txData.deliveryType === 'shipping' ? { labelCreationPending: true } : {}),
    }));

    // --- Mark article as sold ---
    if (articleRef) {
      await recoveryCommit({refs: [(articleRef).path]});
    tx.update(articleRef, await financialRecoverySourceFields('inventory_article',articleRef,article!,{
        isSold: true,
        soldAt: FieldValue.serverTimestamp(),
      }));
    }
    saleNotices.commit();
    fraudCandidates.commit();

    return {
      processed: true,
      sellerId,
      buyerId: txData.buyerId,
      chatId: txData.chatId,
      shipEngineRateId: txData.shipEngineRateId,
      deliveryType: txData.deliveryType,
      shippingCost: typeof txData.shippingCost === 'number' ? txData.shippingCost : 0,
      serviceFee: typeof txData.serviceFee === 'number' ? txData.serviceFee : 0,
      taxTotal: typeof txData.taxTotal === 'number' ? txData.taxTotal : 0,
      itemAmount:
        typeof txData.amount === 'number'
          ? txData.amount
          : typeof txData.sellerPayout === 'number'
            ? txData.sellerPayout
            : 0,
      totalAmount: typeof txData.totalAmount === 'number' ? txData.totalAmount : 0,
      sellerPayout: typeof txData.sellerPayout === 'number' ? txData.sellerPayout : 0,
      chargeId: paymentIntent.latest_charge || null,
      articleId: txData.articleId,
      articleTitle: txData.articleTitle || null,
    };
  });

  if (!result.processed) {
    if(result.reason==='orphan_capture_original_refund_reserved'){await recordPaymentCaptureAnomaly(paymentIntent,result.reason,context,paymentIntent.id);return;}
    if (result.reason === 'inventory_engagement_mismatch') {
      await recordPaymentCaptureAnomaly(paymentIntent, result.reason, context, paymentIntent.id, result.expectedAmounts);
      return;
    }
    if (result.reason === 'transaction_not_found' || result.reason === 'payment_identity_mismatch' || result.reason === 'native_payment_identity_unqualified' || result.reason === 'wallet_amount_invalid' ||
        result.reason === 'expected_amount_invalid' || result.reason === 'invalid_currency') {
      await recordPaymentCaptureAnomaly(paymentIntent, result.reason, context,
        'originalPaymentIntentId' in result ? result.originalPaymentIntentId : null,
        'expectedAmounts' in result ? result.expectedAmounts : undefined);
      return;
    }

    if (result.reason === 'refund_obligation') {
      const data = 'txData' in result ? result.txData : null;
      if (data?.refund) await resumeTransactionRefund(transactionId);
      else await issueTransactionRefund(transactionId, data ?? {}, { idempotencyKey: 'rf_legacy_' + transactionId,
        paymentProof, source: 'webhook_legacy_refund', reason: 'legacy_refund_reconciliation' });
      return;
    }

    // A late capture cannot revive a cancelled sale. Its captured card amount
    // must obtain a durable refund intention before this event is acknowledged.
    if (result.reason === 'cancelled_needs_refund') {
      // The refund core retains any existing intention and its idempotency key.
      // A wallet already returned by a qualified cancellation receives no
      // second credit; the event itself proves the actually collected card sum.
      try {
        const cancelledTxData = 'txData' in result ? result.txData : {};
        const walletRefundCents = 'walletAlreadyRestituted' in result && result.walletAlreadyRestituted ? 0 : walletAmountUsedCents;
        // Reserve the durable intent before provider availability is examined.
        const refundOutcome = await issueTransactionRefund(
          transactionId,
          { ...cancelledTxData, stripePaymentIntentId: paymentIntent.id },
          {
            reason: 'cancelled_payment_succeeded_late',
            idempotencyKey: `rf_${transactionId}`,
            // The refund core's ownership guard controls any article release.
            source: 'webhook_cancelled_needs_refund',
            paymentProof,
            buyerWalletRefundOverrideCents: walletRefundCents,
          }
        );
        const current = (await transactionRef.get()).data(), intention = current?.refund;
        if (!intention || typeof intention.intentId !== 'string' || !intention.intentId || refundOutcome.intentId !== intention.intentId ||
            typeof intention.idempotencyKey !== 'string' || !intention.idempotencyKey || !(intention.requestedAt instanceof Timestamp) ||
            intention.paymentIntentId !== paymentIntent.id || intention.currency !== 'cad' ||
            intention.capturedCardCents !== amountReceivedCents || intention.cardAmountCents !== amountReceivedCents ||
            intention.walletAmountCents !== walletRefundCents) {
          await recordPaymentCaptureAnomaly(paymentIntent, 'late_capture_refund_unqualified', context, paymentIntent.id);
          throw new Error('La capture tardive ne dispose pas d’une intention de remboursement qualifiée.');
        }
        logger.warn('Stripe webhook: cancelled payment refund outcome', {
          refundStatus: refundOutcome.status, success: refundOutcome.success,
          transactionId,
          paymentIntentId: paymentIntent.id,
        });
      } catch (refundErr) {if(refundErr instanceof FinancialRecoveryBlocked)throw refundErr;
        // An exception may precede reservation OR follow an external attempt.
        // Do not ACK either as complete: the retry uses the stored intent/key
        // when present, preserving an unknown outcome without a new request.
        logger.error('Stripe webhook: auto-refund on cancelled transaction FAILED', {
          transactionId,
          paymentIntentId: paymentIntent.id,
          error: refundErr instanceof Error ? refundErr.message : refundErr,
        });
        throw refundErr;
      }
      return;
    }

    // A mismatch cannot become a sale. Persist mandatory signed evidence before
    // ACK, then delegate any full-card refund to the common financial core.
    if (result.reason === 'amount_mismatch') {
      const mismatch = 'mismatch' in result ? result.mismatch : undefined;
      const buyerOverpaid = mismatch?.buyerOverpaid === true;
      const isMixedMismatch = mismatch?.isMixedPayment === true;

      // Mandatory capture evidence; the legacy replayable dead-letter below
      // is best-effort and cannot be the sole condition for acknowledging money.
      await recordPaymentCaptureAnomaly(paymentIntent, 'amount_mismatch', context, paymentIntent.id,
        'expectedAmounts' in result ? result.expectedAmounts : undefined);

      await writeFailedOperation({
        type: 'amount_mismatch',
        refId: transactionId,
        payload: {
          paymentIntentId: paymentIntent.id,
          received: mismatch?.received ?? amountReceivedDollars,
          expected: mismatch?.expected ?? null,
          expectedTotal: mismatch?.expectedTotal ?? null,
          walletCents: mismatch?.walletCents ?? walletAmountUsedCents,
          isMixedCharge: isMixedMismatch,
          // Drive retryFailedOperations: only auto-refund the buyer-overpaid case.
          autoRefund: buyerOverpaid,
        },
        error: 'PaymentIntent amount does not match expected transaction amount',
      });

      if (buyerOverpaid) {
        const stripe = getStripe();
        if (stripe) {
          // Reuse the shared refund core: ONE atomic op refunds the full card
          // charge (deterministic key rf_mismatch_${txId}) AND reconciles the
          // wallet (re-credit buyer wallet portion, debit seller exactly what was
          // credited — 0 here since the tx was never marked paid). The tx never
          // persisted stripePaymentIntentId (never reached 'paid'), so we inject
          // the live id from the event. The refund is a plain platform-charge
          // refund (single-rail model, no transfer to reverse).
          const mismatchTxData = 'txData' in result ? result.txData : {};
          try {
            const refundOutcome = await issueTransactionRefund(
              transactionId,
              { ...mismatchTxData, stripePaymentIntentId: paymentIntent.id },
              {
                reason: 'amount_mismatch_buyer_overpaid',
                idempotencyKey: `rf_mismatch_${transactionId}`,
                source: 'webhook_amount_mismatch',
                paymentProof,
                ...('walletAlreadyRestituted' in result && result.walletAlreadyRestituted ? { buyerWalletRefundOverrideCents: 0 } : {}),
              }
            );
            logger.warn('Stripe webhook: overpaid payment refund outcome', {
              refundStatus: refundOutcome.status, success: refundOutcome.success,
              transactionId,
              paymentIntentId: paymentIntent.id,
            });
          } catch (refundErr) {
            if (refundErr instanceof FinancialRecoveryBlocked) throw refundErr;
            // issueTransactionRefund already dead-lettered the Stripe failure with
            // the same deterministic key, in addition to the amount_mismatch
            // dead-letter above; a later replay (retryFailedOperations) is safe.
            logger.error('CRITICAL Stripe webhook: amount mismatch auto-refund FAILED', {
              transactionId,
              paymentIntentId: paymentIntent.id,
              error: refundErr instanceof Error ? refundErr.message : refundErr,
            });
          }
        }
      } else {
        // F30: buyer UNDERPAID. We cannot fulfill at the wrong price, and the
        // article was locked (isSold=true) at createTransaction time. Leaving it
        // here strands the buyer's (partial) charge AND locks the article forever.
        // Deterministic safe treatment: refund the captured charge in full
        // (idempotent key) so the buyer is made whole, RELEASE the article so it
        // can be sold again, and keep the dead-letter for human visibility. The
        // refund key is distinct from the overpaid path; both never run for the
        // same transaction (mutually exclusive branches).
        logger.error('CRITICAL Stripe webhook: amount underpaid — refunding + releasing article', {
          transactionId,
          paymentIntentId: paymentIntent.id,
        });
        const stripe = getStripe();
        if (stripe) {
          const underpaidTxData = 'txData' in result ? result.txData : {};
          try {
            const refundOutcome = await issueTransactionRefund(
              transactionId,
              { ...underpaidTxData, stripePaymentIntentId: paymentIntent.id },
              {
                reason: 'amount_mismatch_buyer_underpaid',
                idempotencyKey: `rf_mismatch_${transactionId}`,
                // Item never fulfilled — re-list it so it is not locked forever.
                relistArticle: true,
                source: 'webhook_amount_mismatch_underpaid',
                paymentProof,
                ...('walletAlreadyRestituted' in result && result.walletAlreadyRestituted ? { buyerWalletRefundOverrideCents: 0 } : {}),
              }
            );
            logger.warn('Stripe webhook: underpaid payment refund outcome', {
              refundStatus: refundOutcome.status, success: refundOutcome.success,
              transactionId,
              paymentIntentId: paymentIntent.id,
            });
          } catch (refundErr) {
            if (refundErr instanceof FinancialRecoveryBlocked) throw refundErr;
            // issueTransactionRefund already dead-lettered the Stripe failure with
            // the same deterministic key; a later replay is safe. The article is
            // released by the refund core's atomic stage; if that never committed,
            // the dead-letter above keeps the case visible for a human.
            logger.error('CRITICAL Stripe webhook: amount underpaid auto-refund FAILED', {
              transactionId,
              paymentIntentId: paymentIntent.id,
              error: refundErr instanceof Error ? refundErr.message : refundErr,
            });
          }
        }
      }
      // ACK 200 (return normally): the outer handler responds received:true.
      return;
    }

    logger.info('Stripe webhook: skipping post-processing', {
      transactionId,
      reason: result.reason,
    });
    return;
  }

  logger.info('Stripe webhook: payment confirmed, atomic mutations committed', {
    transactionId,
    paymentIntentId: paymentIntent.id,
  });

  // Analytics (§12): order_paid follows the BUYER, sale_paid mirrors it on the
  // SELLER so vendor funnels (F6) can be built. $insert_id keeps both idempotent
  // against webhook replays (distinct ids for the two events, same fact).
  {
    const serviceFeeCents = Math.round((result.serviceFee ?? 0) * 100);
    const orderProps = {
      transaction_id: transactionId,
      article_id: result.articleId ?? null,
      buyer_id: result.buyerId ?? null,
      seller_id: result.sellerId ?? null,
      item_amount_cents: Math.round((result.itemAmount ?? 0) * 100),
      shipping_cents: Math.round((result.shippingCost ?? 0) * 100),
      service_fee_cents: serviceFeeCents,
      tax_cents: Math.round((result.taxTotal ?? 0) * 100),
      buyer_total_cents: Math.round((result.totalAmount ?? 0) * 100),
      application_fee_cents: serviceFeeCents,
      wallet_amount_cents: walletAmountUsedCents,
      card_amount_cents: amountReceivedCents,
      payment_method: isMixedPayment ? 'mixed' : 'card',
      delivery_type: result.deliveryType ?? null,
    };
    if (result.buyerId) {
      await captureServerEvent(result.buyerId, 'order_paid', {
        ...orderProps,
        $insert_id: transactionId,
      });
    }
    if (result.sellerId) {
      await captureServerEvent(result.sellerId, 'sale_paid', {
        transaction_id: transactionId,
        article_id: result.articleId ?? null,
        seller_id: result.sellerId,
        buyer_id: result.buyerId ?? null,
        item_amount_cents: Math.round((result.itemAmount ?? 0) * 100),
        seller_net_cents: Math.round((result.sellerPayout ?? 0) * 100),
        delivery_type: result.deliveryType ?? null,
        $insert_id: `sale_${transactionId}`,
      });
    }
  }

  // =====================================================================
  // PLATFORM REVENUE LEDGER (E6 / F133c) — record gross revenue + tax once
  // =====================================================================
  // Idempotent by deterministic doc id; best-effort (never blocks the webhook).
  // Records serviceFee (+ tax if collected) + shippingCost collected, and the
  // Stripe processor fee from the charge's balance_transaction, so net margin per
  // transaction is computable from platform_ledger.
  await recordTransactionRevenue({
    transactionId,
    sellerId: result.sellerId,
    serviceFee: result.serviceFee ?? 0,
    shippingCost: result.shippingCost ?? 0,
    taxTotal: result.taxTotal ?? 0,
    chargeId: result.chargeId ?? null,
  });

  // =====================================================================
  // SHIPPING LABEL (non-atomic, external call — safe to retry separately)
  // =====================================================================

  let trackingNumber = '';
  let labelUrl = '';
  let trackingUrl = '';

  if (result.deliveryType === 'shipping') {
    const rateId = result.shipEngineRateId;

    // Guard: reject fallback rateIds generated by the client when ShipEngine
    // was unreachable. These are not real ShipEngine rate IDs and will fail
    // label creation. Flag the transaction for the sweep job — the seller is
    // NOT credited (no label = no shipment), the transaction stays 'paid'.
    if (rateId && rateId.startsWith('fallback_')) {
      logger.warn('Stripe webhook: fallback rateId detected — deferring to sweepPendingLabels', {
        transactionId,
        rateId,
      });
      await writeFinancialRecoveryPurchaseDiagnostic(db, db.collection('transactions').doc(transactionId), {
        labelCreationPending: true,
        labelCreationNote: `Fallback rateId "${rateId}" — re-rate + retry required`,
      });
    } else {
      const shipEngine = getShipEngine();
      if (shipEngine && rateId) {
        // F5/F82: idempotent, double-spend-safe label creation. The helper
        // reserves the tx (atomic) BEFORE the paid ShipEngine call, so a webhook
        // timeout / Stripe retry / concurrent sweep can never create a 2nd label;
        // on success it credits the seller + persists the label atomically.
        const outcome = await createLabelIdempotent({
          transactionRef,
          transactionId,
          rateId,
          shipEngine,
          estimatedShippingCost: result.shippingCost ?? 0,
        });

        if (outcome === 'created' || outcome === 'skip') {
          // Read back the persisted label fields for the chat system message
          // below (a 'skip' means another path already created the label).
          const fresh = (await transactionRef.get()).data();
          trackingNumber = fresh?.trackingNumber || '';
          labelUrl = fresh?.shippingLabelUrl || '';
          trackingUrl = fresh?.trackingUrl || '';
          logger.info('Stripe webhook: label creation outcome', { transactionId, outcome });
        } else {
          // 'failed': the reservation was cleared (createLabel error) — defer to
          // sweepPendingLabels which re-rates + retries. Payment stays valid; the
          // seller is NOT credited (deferred-credit model).
          await writeFinancialRecoveryPurchaseDiagnostic(db, db.collection('transactions').doc(transactionId), {
            labelCreationPending: true,
            labelCreationNote: 'ShipEngine createLabel failed — re-rate + retry required',
          }).catch((err) => {
            if(err instanceof FinancialRecoveryBlocked)throw err;
            logger.error('Failed to flag labelCreationPending', {
              transactionId,
              error: err instanceof Error ? err.message : err,
            });
          });
        }
      } else {
        // No ShipEngine client or no rateId — defer to the sweep.
        logger.warn('Stripe webhook: no ShipEngine/rateId — deferring to sweepPendingLabels', {
          transactionId,
          hasRateId: !!rateId,
        });
        await writeFinancialRecoveryPurchaseDiagnostic(db, db.collection('transactions').doc(transactionId), {
          labelCreationPending: true,
          labelCreationNote: 'No rateId/ShipEngine at payment — re-rate + retry required',
        });
      }
    }
  }

  // =====================================================================
  // SYSTEM MESSAGE: Send shipping/tracking info to chat
  // =====================================================================

  const chatId = result.chatId;
  if (chatId) {
    const labelInfo = trackingNumber
      ? `\n\nNumero de suivi: ${trackingNumber}\nEtiquette: disponible dans les details de la commande.`
      : '\n\nL\'etiquette d\'expedition sera disponible sous peu.';

    let participants: string[] = [];
    try {
      const chatSnap = await db.collection('chats').doc(chatId).get();
      if (chatSnap.exists) {
        participants = (chatSnap.data()?.participants as string[]) || [];
      }
    } catch (lookupErr) {if(lookupErr instanceof FinancialRecoveryBlocked)throw lookupErr;
      logger.warn('Could not load chat participants', {
        chatId,
        error: lookupErr instanceof Error ? lookupErr.message : lookupErr,
      });
    }

    await db.collection('messages').add({
      chatId,
      senderId: 'system',
      receiverId: 'system',
      type: 'system',
      content: `Paiement confirme !${labelInfo}\n\nLe vendeur peut maintenant expedier l'article.`,
      participants,
      timestamp: FieldValue.serverTimestamp(),
      status: 'sent',
      isRead: true,
      ...(trackingNumber && {
        shippingLabel: {
          labelUrl,
          trackingNumber,
          trackingUrl,
        },
      }),
    });
  }

  // In-app notices and private transport intents were committed with payment.
  // The independent leased worker resumes optional push after interruptions.

  logger.info('Stripe webhook: fully processed', { transactionId });

    });
  }

/**
 * F77: re-drive a LOST payment_intent.succeeded from a dead-letter replay.
 * retryFailedOperations calls this when a `lost_pi_succeeded_webhook` op is
 * eligible: it retrieves the live PI from Stripe and replays the canonical
 * handler, which is idempotent (status guards + deterministic keys). Routes
 * swap top-up / shop tier PIs to their own handlers based on metadata.type so a
 * lost top-up/forfait succeeded is also recoverable.
 *
 * @returns true if a handler ran to completion (resolve the dead-letter),
 *          false if Stripe was unreachable / the PI was not actually succeeded
 *          (keep retrying).
 */

export async function handlePaymentIntentFailed(paymentIntent: any): Promise<void> {
    return withFinancialRecoveryScope({operation: "http/stripe/payment.handlePaymentIntentFailed"}, async () => {
  const transactionId = paymentIntent.metadata?.transactionId;

  if (!transactionId) {
    logger.error('Stripe webhook: payment_failed PaymentIntent missing transactionId in metadata', {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  if (
    typeof transactionId !== 'string' ||
    transactionId.length === 0 ||
    transactionId.length > 200 ||
    transactionId.includes('/')
  ) {
    logger.error('Stripe webhook: payment_failed invalid transactionId shape', { transactionId });
    return;
  }

  const transactionRef = db.collection('transactions').doc(transactionId);

  // F102: Stripe emits payment_intent.payment_failed on EVERY failed attempt
  // (card declined, 3DS abandoned), but the buyer can immediately retry in the
  // SAME Payment Sheet on the SAME PaymentIntent. Cancelling on the first failure
  // relisted the article mid-checkout and, if the retry then succeeded, produced
  // a PI.succeeded on a 'cancelled' tx → auto-refund + lost sale.
  //
  // The PaymentIntent status is the authority: only a TERMINAL 'canceled' PI is a
  // real, final failure. Anything else (requires_payment_method/requires_action/
  // processing) is a retryable attempt — do nothing and let the 1h pending_payment
  // expiry (which re-reads the live PI status, transactionExpiration.ts) decide.
  const stripe = getStripe();
  let piTerminallyCanceled = false;
  if (stripe && typeof paymentIntent.id === 'string') {
    try {
      const livePi = await stripe.paymentIntents.retrieve(paymentIntent.id);
      piTerminallyCanceled = livePi.status === 'canceled';
      if (!piTerminallyCanceled) {
        logger.info('Stripe webhook: payment_failed is a retryable attempt — not cancelling', {
          transactionId,
          paymentIntentId: paymentIntent.id,
          piStatus: livePi.status,
        });
      }
    } catch (retrieveErr) {if(retrieveErr instanceof FinancialRecoveryBlocked)throw retrieveErr;
      // Could not reach Stripe — be conservative and do NOT cancel; the 1h expiry
      // will reconcile against the live PI status.
      logger.warn('Stripe webhook: payment_failed PI retrieve failed — deferring to expiry', {
        transactionId,
        paymentIntentId: paymentIntent.id,
        error: retrieveErr instanceof Error ? retrieveErr.message : retrieveErr,
      });
    }
  }

  if (!piTerminallyCanceled) {
    return;
  }

  let cancelBuyerId: string | null = null;
  let cancelRefundCents = 0;
  let cancelRelisted = false;
  let didCancel = false;

  await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
    const txSnap = await tx.get(transactionRef);
    const txData = txSnap.data();

    if (!txData) {
      logger.error('Stripe webhook: payment_failed transaction not found', { transactionId });
      return;
    }

    if (hasActiveBankDispute(txData) || hasUnsettledRefund(txData) || (txData.stripePaymentIntentId && txData.stripePaymentIntentId !== paymentIntent.id)) return;

    // Idempotence: only cancel if still in a pre-payment status
    const cancellableStatuses = new Set(['pending_payment', 'pending']);
    if (!cancellableStatuses.has(txData.status)) {
      logger.info('Stripe webhook: payment_failed skipping — transaction not in cancellable status', {
        transactionId,
        currentStatus: txData.status,
      });
      return;
    }
    cancelBuyerId = typeof txData.buyerId === 'string' ? txData.buyerId : null;
    didCancel = true;

    // ALL reads BEFORE all writes (Admin SDK READ_AFTER_WRITE_ERROR, cf. F1):
    // read the article + buyer wallet now, write everything after.
    const articleRef = txData.articleId
      ? db.collection('articles').doc(txData.articleId)
      : null;
    const articleSnap = articleRef ? await tx.get(articleRef) : null;
    const articleUnlock = articleRef && articleSnap?.exists
      ? await articleReleaseUpdate(tx, articleRef, articleSnap.data()!, transactionId) : null;

    const walletAmountUsed = txData.walletAmountUsed || 0; // in cents
    const shouldRefundWallet =
      walletAmountUsed > 0 &&
      (txData.paidVia === 'wallet_and_card' || txData.paidVia === 'mixed' || txData.paidVia === 'wallet');
    const buyerId = txData.buyerId;
    const buyerWalletRef = shouldRefundWallet
      ? db.collection('wallets').doc(buyerId)
      : null;
    const buyerWalletSnap = buyerWalletRef ? await tx.get(buyerWalletRef) : null;

    // Cancel the transaction
    await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,txData,{
      status: 'cancelled',
      cancelledAt: FieldValue.serverTimestamp(),
      cancelReason: 'payment_failed',
    }));

    // Release the article so it can be purchased again
    if (articleRef && articleUnlock) {
      commitArticleRelease(tx, articleRef, articleUnlock);
      cancelRelisted = true;
    }

    // F02: Refund wallet portion if this was a mixed wallet+card payment
    if (buyerWalletRef && buyerWalletSnap && buyerWalletSnap.exists) {
      cancelRefundCents = walletAmountUsed;
      const walletData = buyerWalletSnap.data()!;
      await recoveryCommit({refs: [(buyerWalletRef).path]});
    tx.update(buyerWalletRef, await financialRecoveryWalletFields(buyerWalletRef,walletData,{
        balance: FieldValue.increment(walletAmountUsed),
        updatedAt: FieldValue.serverTimestamp(),
      },{balance: ((walletData)["balance"]??0) + (walletAmountUsed)}));

      const buyerLedgerRef = buyerWalletRef.collection('ledger').doc();
      await recoveryCommit({refs: [(buyerLedgerRef).path]});
    tx.set(buyerLedgerRef, {
        type: 'refund_credit',
        amount: walletAmountUsed,
        balanceAfter: (walletData.balance || 0) + walletAmountUsed,
        description: 'Remboursement — echec de paiement',
        transactionId,
        createdAt: FieldValue.serverTimestamp(),
      });

      logger.info('Stripe webhook: payment_failed — wallet portion refunded', {
        transactionId,
        buyerId,
        walletAmountRefunded: walletAmountUsed,
      });
    }
  });

  const failureMessage = paymentIntent.last_payment_error?.message || 'Unknown failure';
  logger.error('Stripe webhook: payment failed — transaction cancelled', {
    transactionId,
    paymentIntentId: paymentIntent.id,
    failureMessage,
  });

  // Analytics (§12): order_cancelled — system-initiated on a terminal payment
  // failure. distinct_id = buyer. $insert_id shared with the callable cancel
  // paths so a tx yields at most one order_cancelled.
  if (didCancel && cancelBuyerId) {
    await captureServerEvent(cancelBuyerId, 'order_cancelled', {
      transaction_id: transactionId,
      cancelled_by: 'system_expiry',
      stage: 'pending_payment',
      refunded_cents: cancelRefundCents,
      article_relisted: cancelRelisted,
      $insert_id: `order_cancelled_${transactionId}`,
    });
  }

    });
  }

// =============================================================================
// HANDLER: charge.dispute.created
// =============================================================================
