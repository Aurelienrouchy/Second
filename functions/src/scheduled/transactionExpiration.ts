import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import { financialRecoveryWalletFields } from "../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
/**
 * Scheduled transaction expiration
 * Firebase Functions v7 - using onSchedule
 *
 * Expires orphaned transactions that were never completed:
 * 2. pending_payment transactions older than 1h (buyer never paid)
 * 3. paid transactions older than 7 days (seller never shipped)
 *
 * For each expired transaction:
 * - Status is set to 'cancelled'
 * - The article's isSold flag is reset to false
 * - For paid-not-shipped: buyer is notified via push notification
 *
 * Cash meetups have no qualified accepted expiry policy: this job preserves
 * their agreement and reservation, regardless of historical createdAt.
 *
 * Runs every hour.
 */
import { articleReleaseUpdate, commitArticleRelease } from '../utils/articleReservation';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { getStripe } from '../config/stripe';
import { issueTransactionRefund, resumeTransactionRefund, readPendingCancellationFunds, reconcileCanceledPurchase } from '../utils/refund';
import { hasActiveBankDispute } from '../utils/bankDispute';
import { hasUnsettledRefund } from '../utils/refundState';
import { prepareOperationalNotices, type OperationalNoticeInput } from '../utils/notifications';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { nonShipmentExpirySource, purchasePolicyTimeline, readPurchasePreparationSource, recordPurchasePreparationReview } from '../utils/purchasePolicy';

/**
 * Cap how many docs each query pulls per scheduled run. Each paid-not-shipped
 * doc triggers a Stripe network call (refund) and a runTransaction, so an
 * unbounded `.get()` on a backlog could timeout the function, partially fail,
 * and re-process on the next run (P1-29). With a cap + per-status pagination,
 * the backlog drains across successive hourly runs deterministically.
 */
const MAX_PER_RUN = 200;

/** Taille d'une page lue par la section 5 (retours périmés), qui pagine. */
const RETURN_PAGE_SIZE = 50;

/** Process Stripe-bound work in small concurrent lots to bound network fan-out. */
const STRIPE_LOT_SIZE = 10;

/** Pending payment transactions expire after 1 hour */
const PENDING_PAYMENT_EXPIRY_MS = 1 * 60 * 60 * 1000;

/**
 * F26: a return leg with no carrier DELIVERED scan after this window is routed to
 * admin for human review (a dispute doc is opened). We never auto-release nor
 * auto-refund here — the buyer may never have posted the parcel (fraud) OR the
 * carrier scan may simply be missing. Routing to admin is the safe default: it
 * unblocks the funds-frozen dead-end (return_requested + disputed freezes the
 * seller's payout forever) without silently favoring either party. 21 days is
 * generous (a return ships + transits + scans well within that).
 */
const RETURN_LEG_STALE_MS = 21 * 24 * 60 * 60 * 1000;

/**
 * Stripe PaymentIntent statuses that mean money is in flight or already captured.
 * If a 'pending_payment' transaction's PaymentIntent is in one of these states we
 * must NOT expire/cancel it — the webhook (PI.succeeded) is either about to fire
 * or already did; expiring here would race the credit and leave a paid charge on
 * a cancelled transaction (P1: expiration vs payment in flight).
 */
const STRIPE_PI_IN_FLIGHT = new Set([
  'requires_capture',
  'processing',
  'succeeded',
]);

/**
 * Millisecondes d'un champ de date Firestore, quelle que soit sa forme :
 * `Timestamp` (production), `Date` (Admin SDK et tests), chaîne ISO ou nombre.
 * Renvoie `null` quand la valeur est absente ou inexploitable — jamais une date
 * invalide, qui ferait silencieusement basculer une comparaison.
 */
function millisOf(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'object' && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return isNaN(ms) ? null : ms;
  }
  return null;
}

function expirationNotices(transactionId: string, data: FirebaseFirestore.DocumentData, reason: string): OperationalNoticeInput[] {
  const anchor = typeof data.disputeResolutionDecisionId === 'string' ? data.disputeResolutionDecisionId :
    millisOf(data.meetupConfirmedAt) ?? millisOf(data.createdAt) ?? 'legacy';
  const message = 'Cette commande a été annulée automatiquement parce que le paiement n’a pas été finalisé dans le délai prévu. Consultez la commande et le porte-monnaie pour leurs mouvements. Vous pouvez demander un examen humain au support.';
  return [data.buyerId, data.sellerId].map(userId => ({ eventKey: `transaction_expired:${transactionId}:${reason}:${anchor}`,
    userId, type: 'order_cancelled', title: 'Annulation automatique enregistrée', message,
    data: { transactionId, cancelReason: reason,
      ...(data.deliveryType === 'meetup' && typeof data.chatId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.chatId) ? { chatId: data.chatId } : {}) },
  }));
}

export const expireOrphanedTransactions = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
    // Sans `timeoutSeconds` explicite, une fonction v2 s'arrête à 60 s. Les six
    // sections tournent en série et chacune peut traiter jusqu'à MAX_PER_RUN
    // documents avec, pour certaines, un appel Stripe par document : le budget
    // par défaut est dépassé bien avant la fin, et les dernières sections ne
    // s'exécutent alors jamais.
    timeoutSeconds: 540,
    secrets: ['STRIPE_SECRET_KEY'],
  },
  async () => {
    return withFinancialRecoveryScope({operation: "scheduled/transactionExpiration.expireOrphanedTransactions"}, async () => {
    const now = Date.now();
    let totalExpired = 0;

    // Cash meetup V1 records acceptance, but no accepted automatic-expiry
    // clause or deadline. Legacy createdAt may predate that acceptance by weeks.
    // Neither createdAt, confirmedAt nor a status alone authorizes cancellation.
    // Preserve accepted/unknown agreements, their article reservation and offer;
    // support and explicit participant actions remain available. A future policy
    // must be shown and accepted before it can authorize any deadline. Pending
    // offers keep their own native expiresAt, handled by the offer workflow.

    // =========================================================================
    // 2. Expire pending_payment transactions older than 1h
    // =========================================================================

    try {
      const paymentCutoff = new Date(now - PENDING_PAYMENT_EXPIRY_MS);
      const cursorRef=db.collection('job_locks').doc('pendingPaymentPreparation_cursor');
      let cursorSnap=await cursorRef.get();
      const cursor=cursorSnap.data(),validCursor=cursor?.protocol==='pending_payment_preparation_cursor_v1'&&cursor.createdAt instanceof Timestamp&&
        Number.isSafeInteger(cursor.createdAt.toMillis())&&cursor.createdAt.toMillis()>0&&cursor.createdAt.toMillis()<=now&&
        typeof cursor.id==='string'&&!!cursor.id&&!cursor.id.includes('/')&&Buffer.byteLength(cursor.id,'utf8')<=1500;
      const query=db.collection('transactions').where('status','==','pending_payment').where('createdAt','<',paymentCutoff)
        .orderBy('createdAt','asc').orderBy('__name__','asc').limit(MAX_PER_RUN);
      let paymentSnap=await (validCursor?query.startAfter(cursor!.createdAt,cursor!.id):query).get();
      if(paymentSnap.empty&&validCursor)paymentSnap=await query.get();


      if (!paymentSnap.empty) {
        const stripe = getStripe();
        let pendingExpired = 0;

        // Process in small concurrent lots: each doc may require a Stripe
        // PaymentIntent retrieve/cancel network call. Promise.allSettled keeps
        // one slow/failing PI from aborting the whole batch.
        for (let i = 0; i < paymentSnap.docs.length; i += STRIPE_LOT_SIZE) {
          const lot = paymentSnap.docs.slice(i, i + STRIPE_LOT_SIZE);
          const results = await Promise.allSettled(
            lot.map((doc) => expirePendingPayment(doc, stripe))
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              pendingExpired++;
              totalExpired++;
            }
          }
          // An unknown observation is not a resolved order. Failed rows remain
          // pending and are revisited on wrap; none can starve every later row.
          // Checkpoint only after every IO in this lot has actually terminated.
          const last=lot[lot.length-1],expectedRevision=cursorSnap.updateTime;
          const checkpoint=await db.runTransaction(async tx=>{
    const recoveryCommit = financialRecoveryCommitCheckpoint();
            const latest=await tx.get(cursorRef);
            if(expectedRevision?!latest.updateTime?.isEqual(expectedRevision):latest.exists)return false;
            await recoveryCommit({refs: [(cursorRef).path]});
    tx.set(cursorRef,{protocol:'pending_payment_preparation_cursor_v1',id:last.id,createdAt:last.data().createdAt,
              observedAt:Timestamp.now(),lastObservationFailures:results.flatMap((r,i)=>r.status==='rejected'?[lot[i].id]:[])});
            return true;
          });
          if(!checkpoint)break; // A stale runner never overwrites a successor.
          cursorSnap=await cursorRef.get();
          if(cursorSnap.data()?.id!==last.id||!(cursorSnap.data()?.createdAt instanceof Timestamp)||
            !cursorSnap.data()!.createdAt.isEqual(last.data().createdAt))break;

        }

        logger.info(
          `[expireOrphanedTransactions] Expired ${pendingExpired}/${paymentSnap.size} pending_payment transactions (other observations remain pending or require review)`
        );
      }
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logger.error('[expireOrphanedTransactions] Error expiring pending_payment transactions', {
        error: error instanceof Error ? error.message : error,
      });
    }

    // =========================================================================
    // 3. Expire paid but not shipped transactions older than 7 days
    //    F3: Now includes Stripe refund (card portion) + wallet refund
    // =========================================================================

    try {
      // Inspect by document ID, including missing/malformed native clocks.
      // A filtered/blocked page still advances, so one legacy case cannot starve
      // newer sales. The cutoff itself is qualified again inside refund reserve.
      const paidCursorRef = db.collection('job_locks').doc('paidNonShipmentPolicy_cursor');
      const paidCursor = (await paidCursorRef.get()).data()?.lastId;
      const paidQuery = db
        .collection('transactions')
        .where('status', '==', 'paid')
        .orderBy('__name__', 'asc')
        .limit(MAX_PER_RUN);
      const hasCursor = typeof paidCursor === 'string' && !!paidCursor && !paidCursor.includes('/');
      let paidSnap = await (hasCursor ? paidQuery.startAfter(paidCursor) : paidQuery).get();
      if (paidSnap.empty && hasCursor) paidSnap = await paidQuery.get();

      if (!paidSnap.empty) {
        const stripe = getStripe();
        let paidExpired = 0;

        // Each doc issues a Stripe refund (network) + runTransactions, so we
        // process in small concurrent lots and isolate failures with
        // Promise.allSettled (one bad refund never aborts the rest).
        for (let i = 0; i < paidSnap.docs.length; i += STRIPE_LOT_SIZE) {
          const lot = paidSnap.docs.slice(i, i + STRIPE_LOT_SIZE);
          const results = await Promise.allSettled(
            lot.map((doc) => refundPaidNotShipped(doc, stripe))
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              paidExpired++;
              totalExpired++;
            }
          }
        }

        await paidCursorRef.set({ lastId: paidSnap.docs[paidSnap.size - 1].id, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

        logger.info(
          `[expireOrphanedTransactions] Expired ${paidExpired}/${paidSnap.size} paid-not-shipped transactions (7d)`
        );
      }
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logger.error('[expireOrphanedTransactions] Error expiring paid-not-shipped transactions', {
        error: error instanceof Error ? error.message : error,
      });
    }

    // =========================================================================
    // 4. Resume interrupted refunds (status === 'refund_in_progress')
    //    A refund that crashed between PHASE 1 (mark in_progress) and PHASE 3
    //    (confirm) is no longer matched by the 'paid' query above. Re-drive it:
    //    refundPaidNotShipped resumes from refund_in_progress, re-using the
    //    persisted stripeRefundId (no double Stripe refund) and finalizing to
    //    'refunded'. Single equality filter — no composite index required.
    // =========================================================================

    try {
      const stuckSnap = await db
        .collection('transactions')
        .where('status', '==', 'refund_in_progress')
        .limit(MAX_PER_RUN)
        .get();

      if (!stuckSnap.empty) {
        const stripe = getStripe();
        let resumed = 0;

        for (let i = 0; i < stuckSnap.docs.length; i += STRIPE_LOT_SIZE) {
          const lot = stuckSnap.docs.slice(i, i + STRIPE_LOT_SIZE);
          const results = await Promise.allSettled(
            lot.map((doc) => refundPaidNotShipped(doc, stripe))
          );
          for (const r of results) {
            if (r.status === 'fulfilled' && r.value) {
              resumed++;
              totalExpired++;
            }
          }
        }

        logger.info(
          `[expireOrphanedTransactions] Resumed ${resumed}/${stuckSnap.size} interrupted refunds (refund_in_progress)`
        );
      }
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logger.error('[expireOrphanedTransactions] Error resuming interrupted refunds', {
        error: error instanceof Error ? error.message : error,
      });
    }

    // =========================================================================
    // 5. F26: route stale return legs to admin. A `return_requested` tx whose
    //    return parcel never scanned DELIVERED after 21 days is a frozen-funds
    //    dead-end (seller payout blocked forever). We open a `disputes` doc for
    //    human review (safe default — no silent auto-release / auto-refund) and
    //    stamp `returnEscalatedAt` so it is escalated exactly once.
    // =========================================================================

    try {
      const returnCutoff = new Date(now - RETURN_LEG_STALE_MS);
      // Une transaction escaladée GARDE son statut `return_requested` : elle
      // reste donc dans le jeu de résultats à chaque exécution, et le `continue`
      // ci-dessous ne fait que la sauter APRÈS qu'elle a consommé un des
      // MAX_PER_RUN slots. Passé ce nombre d'escalades non résolues, la fenêtre
      // était intégralement remplie de dossiers déjà traités et plus aucun
      // nouveau retour périmé n'était escaladé.
      // On parcourt donc les pages par curseur jusqu'à épuisement, dans la
      // limite d'un budget explicite — sans changer la FORME de la requête, pour
      // ne dépendre d'aucun index à déployer.
      const returnBase = db
        .collection('transactions')
        .where('status', '==', 'return_requested')
        .where('returnRequestedAt', '<', returnCutoff);

      let returnCursor: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | null =
        null;
      let returnScanned = 0;
      let escalated = 0;
      let returnExhausted = false;

      while (returnScanned < MAX_PER_RUN) {
        const returnQuery: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = returnCursor
          ? returnBase.startAfter(returnCursor)
          : returnBase;
        const returnSnap: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData> =
          await returnQuery.limit(RETURN_PAGE_SIZE).get();
        if (returnSnap.empty) {
          returnExhausted = true;
          break;
        }
        returnCursor = returnSnap.docs[returnSnap.docs.length - 1];
        returnScanned += returnSnap.size;

        for (const doc of returnSnap.docs) {
          const data = doc.data();
          // Idempotence: already escalated.
          if (data.returnEscalatedAt) continue;
          try {
            await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
              const snap = await tx.get(doc.ref);
              if (!snap.exists) return;
              const d = snap.data()!;
              if (d.status !== 'return_requested' || d.returnEscalatedAt) return;

              const disputeRef = db.collection('disputes').doc();
              await recoveryCommit({refs: [(disputeRef).path]});
    tx.set(disputeRef, {
                transactionId: doc.id,
                type: 'return_not_delivered',
                buyerId: d.buyerId ?? null,
                sellerId: d.sellerId ?? null,
                articleId: d.articleId ?? null,
                articleTitle: d.articleTitle ?? null,
                reason: 'return_leg_stale',
                details:
                  'Colis de retour non livré (aucun scan DELIVERED) après 21 jours — revue manuelle requise.',
                status: 'open',
                statusBeforeDispute: 'return_requested',
                createdAt: FieldValue.serverTimestamp(),
              });

              await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, {
                returnEscalatedAt: FieldValue.serverTimestamp(),
              });
            });
            escalated++;
          } catch (e) {
      if (e instanceof FinancialRecoveryBlocked) throw e;
            logger.error('[expireOrphanedTransactions] Failed to escalate stale return', {
              transactionId: doc.id,
              error: e instanceof Error ? e.message : e,
            });
          }
        }

        if (returnSnap.size < RETURN_PAGE_SIZE) {
          returnExhausted = true;
          break;
        }
      }

      if (escalated > 0 || !returnExhausted) {
        logger.warn(
          `[expireOrphanedTransactions] Escalated ${escalated} stale return legs to admin (21d)`,
          { scanned: returnScanned, exhausted: returnExhausted }
        );
      }
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      logger.error('[expireOrphanedTransactions] Error escalating stale return legs', {
        error: error instanceof Error ? error.message : error,
      });
    }

    logger.info(`[expireOrphanedTransactions] Total expired: ${totalExpired}`);

    });
  }
);

/** The Stripe client singleton type (or null when not configured). */
type StripeClient = ReturnType<typeof getStripe>;

/**
 * Expire a single 'pending_payment' transaction, respecting an in-flight
 * PaymentIntent.
 *
 * P1 (expiration vs payment in flight): a buyer can authorize/capture a payment
 * right at the 1h boundary; the PI.succeeded webhook may not have landed yet.
 * Blindly expiring would cancel a transaction whose card was (or is about to be)
 * charged → paid charge on a cancelled order.
 *
 *  - If a stripePaymentIntentId exists, retrieve the PI. If its status is
 *    in-flight (requires_capture/processing/succeeded) → DO NOT expire; let the
 *    webhook (or reconciler) finish the job.
 *  - Otherwise cancel the PI (best-effort, idempotent) so no late capture can
 *    occur, then expire the transaction + release the article atomically.
 *
 * @returns true if the transaction was expired, false if it was left in place.
 */
async function expirePendingPayment(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  stripe: StripeClient
): Promise<boolean> {
  const transactionId = doc.id;
  const data = doc.data();
  const paymentIntentId = data.stripePaymentIntentId;
  let cancelledPaymentIntent: unknown = null;
  let expirySource:Awaited<ReturnType<typeof readPurchasePreparationSource>>=null;
  if (hasActiveBankDispute(data) || (hasUnsettledRefund(data) && !paymentIntentId)) return false;

  // A submitted checkout without a persisted PI id is not an unpaid order.
  // Preserve the reservation until reconciliation certifies the outcome.
  if ((data.walletCheckoutOutcome === 'unknown' || data.walletCheckoutOutcome === 'creating') && !paymentIntentId) return false;
  if (paymentIntentId && !stripe) return false;

  try {
    if (paymentIntentId && stripe) {
      // 1. Is the payment in flight / already captured?
      let piStatus: string | undefined;
      let observedPaymentIntent: unknown = null;
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        piStatus = pi.status;
        observedPaymentIntent = pi;
        if (piStatus === 'canceled') {
          const result = await reconcileCanceledPurchase(transactionId, pi);
          if (!result.committed) {
            const { recordCheckoutReconciliation } = await import('../utils/paymentCheckoutReconciliation');
            await recordCheckoutReconciliation(transactionId, pi, data, 'cancellation_unsettled', 'expirePendingPayment', result.reason);
          }
          return result.committed;
        }
      } catch (retrieveErr) {
      if (retrieveErr instanceof FinancialRecoveryBlocked) throw retrieveErr;
        // Could not reach Stripe — be conservative and DO NOT expire this run.
        // The next hourly run will retry; expiring blindly risks cancelling a
        // captured payment.
        logger.warn('[expireOrphanedTransactions] PI retrieve failed — deferring expiry', {
          transactionId,
          paymentIntentId,
          error: retrieveErr instanceof Error ? retrieveErr.message : retrieveErr,
        });
        return false;
      }

      if (piStatus && STRIPE_PI_IN_FLIGHT.has(piStatus)) {
        logger.info('[expireOrphanedTransactions] pending_payment PI in flight — not expiring', {
          transactionId,
          paymentIntentId,
          piStatus,
        });
        return false;
      }
      if (hasUnsettledRefund(data)) return false;

      // Bind the actual provider object to the order and debit BEFORE cancelling
      // it. An unqualified stored PI must never cancel somebody else's charge.
      const mayCancel = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        const current = (await tx.get(doc.ref)).data();
        if (!current || current.status !== 'pending_payment' || hasActiveBankDispute(current) || hasUnsettledRefund(current) ||
            current.stripePaymentIntentId !== paymentIntentId || current.walletCheckoutAttemptId !== data.walletCheckoutAttemptId) return false;
        if(current.deliveryType==='shipping'){
          const source=await readPurchasePreparationSource(tx,transactionId,current);
          if(!source||source.policyHash!==data.purchasePolicy?.hash||source.windowHash!==data.pendingPaymentPolicyWindow?.sourceHash){
            return {permitted:false,policyUnknown:true};
          }
          if(Date.now()<source.expiresAtMs)return false;
          expirySource=source;
        } else {
          // The query is only a candidate. Requalify the SAME one-hour
          // createdAt rule before a provider cancellation can be attempted.
          const createdAtMs = millisOf(current.createdAt), observedAtMs = Date.now();
          if (createdAtMs === null || createdAtMs < 0 || createdAtMs > observedAtMs ||
              createdAtMs + PENDING_PAYMENT_EXPIRY_MS > observedAtMs) return false;
        }
        const proof = await readPendingCancellationFunds(tx, transactionId, current, observedPaymentIntent, false);
        if (proof.qualified) return true;
        await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { refundBlocked: true, refundLegacyReconciliationRequired: true,
          pendingCancellation: { schemaVersion: 1, state: 'reconciliation_required', transactionId,
            buyerId: typeof current.buyerId === 'string' ? current.buyerId : null,
            sellerId: typeof current.sellerId === 'string' ? current.sellerId : null,
            source: 'expiry_pending_1h', requestedBy: null, reason: proof.reason,
            recordedAt: FieldValue.serverTimestamp() } });
        return false;
      });
      if (typeof mayCancel==='object'&&mayCancel?.policyUnknown){
        await recordPurchasePreparationReview(transactionId,'pending_payment','accepted_preparation_window_unknown_or_changed');return false;
      }
      if (!mayCancel) return false;

      // 2. Not in flight (requires_payment_method / requires_action /
      //    requires_confirmation / canceled). Cancel the PI so no late capture
      //    is possible, then expire. cancel is idempotent against an already
      //    canceled PI (Stripe throws — we swallow that specific case).
      if (piStatus !== 'canceled') {
        try {
          cancelledPaymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
          logger.info('[expireOrphanedTransactions] cancelled in-flight-less PI before expiry', {
            transactionId,
            paymentIntentId,
            piStatusBefore: piStatus,
          });
        } catch (cancelErr) {
      if (cancelErr instanceof FinancialRecoveryBlocked) throw cancelErr;
          // If it became uncancelable between retrieve and cancel (e.g. it just
          // succeeded), defer — never expire a possibly-captured payment.
          logger.warn('[expireOrphanedTransactions] PI cancel failed — deferring expiry', {
            transactionId,
            paymentIntentId,
            error: cancelErr instanceof Error ? cancelErr.message : cancelErr,
          });
          return false;
        }
      }
    }

    if(!paymentIntentId&&data.deliveryType==='shipping'){
      expirySource=await db.runTransaction(async tx=>{
        const current=(await tx.get(doc.ref)).data();
        if(!current||current.status!=='pending_payment')return null;
        const source=await readPurchasePreparationSource(tx,transactionId,current);
        return source&&source.policyHash===data.purchasePolicy?.hash&&source.windowHash===data.pendingPaymentPolicyWindow?.sourceHash?source:null;
      });
      if(!expirySource){await recordPurchasePreparationReview(transactionId,'pending_payment','accepted_preparation_window_unknown_or_changed');return false;}
      if(Date.now()<expirySource.expiresAtMs)return false;
    }

    // 3. Expire the transaction + release the article atomically. The status
    //    guard inside the transaction keeps this idempotent across runs.
    const expired = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
      // ── ALL READS FIRST ──
      const txSnap = await tx.get(doc.ref);
      const txData = txSnap.data();
      if (!txData || txData.status !== 'pending_payment') {
        return false;
      }
      if (hasActiveBankDispute(txData) || hasUnsettledRefund(txData)) return false;
      let currentPreparationSource: Awaited<ReturnType<typeof readPurchasePreparationSource>> = null;
      const currentCreatedAtMs = millisOf(txData.createdAt);
      if(txData.deliveryType==='shipping'){
        const source=await readPurchasePreparationSource(tx,transactionId,txData);
        if(!source||!expirySource||source.sourceHash!==expirySource.sourceHash||Date.now()<source.expiresAtMs)return false;
        currentPreparationSource = source;
      } else {
        const observedAtMs = Date.now();
        if (currentCreatedAtMs === null || currentCreatedAtMs < 0 || currentCreatedAtMs > observedAtMs ||
            currentCreatedAtMs + PENDING_PAYMENT_EXPIRY_MS > observedAtMs) return false;
      }

      if ((txData.walletCheckoutOutcome === 'unknown' || txData.walletCheckoutOutcome === 'creating') && !txData.stripePaymentIntentId) return false;
      if (txData.stripePaymentIntentId !== data.stripePaymentIntentId ||
          txData.walletCheckoutAttemptId !== data.walletCheckoutAttemptId) return false;

      const funds = await readPendingCancellationFunds(tx, transactionId, txData, cancelledPaymentIntent);
      if (!funds.qualified) {
        await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { refundBlocked: true, refundLegacyReconciliationRequired: true,
          pendingCancellation: { schemaVersion: 1, state: 'reconciliation_required', transactionId,
            buyerId: typeof txData.buyerId === 'string' ? txData.buyerId : null,
            sellerId: typeof txData.sellerId === 'string' ? txData.sellerId : null,
            source: 'expiry_pending_1h', requestedBy: null, reason: funds.reason,
            recordedAt: FieldValue.serverTimestamp() } });
        logger.warn('[expireOrphanedTransactions] Pending cancellation requires reconciliation',
          { transactionId, reason: funds.reason });
        return false;
      }

      let articleSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      const articleRef = txData.articleId
        ? db.collection('articles').doc(txData.articleId)
        : null;
      if (articleRef) {
        articleSnap = await tx.get(articleRef);
      }

      // Restore only the debit just qualified in the ledger/intention. A new
      // manual checkout reserves this amount at confirmation, not preparation.
      // Cancellation, one deterministic credit and its receipt commit together.
      const walletAmountUsed = funds.walletAmount;
      const hasWalletDebit = walletAmountUsed > 0;

      const articleUnlock = articleRef && articleSnap?.exists
        ? await articleReleaseUpdate(tx, articleRef, articleSnap.data()!, transactionId) : null;

      const notices = await prepareOperationalNotices(tx, expirationNotices(transactionId, txData, 'pending_payment_expired_1h'));
      const decisionId = 'transaction_expired_' + createHash('sha256')
        .update(JSON.stringify([transactionId, 'pending_payment_expired_1h'])).digest('hex');
      const decisionRef = db.collection('automatic_decisions_log').doc(decisionId), priorDecision = await tx.get(decisionRef);
      // A matching status transition is the native replay guard above. A lone
      // explanation on a STILL pending order is not proof of its cancellation.
      if (priorDecision.exists) {
        logger.warn('[expireOrphanedTransactions] Expiry decision requires reconciliation', {transactionId, decisionId});
        return false;
      }
      // ── ALL WRITES AFTER ALL READS ──
      const txUpdate: Record<string, any> = {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelReason: 'pending_payment_expired_1h',
        pendingCancellation: { schemaVersion: 1, state: 'committed', transactionId,
          buyerId: txData.buyerId, sellerId: txData.sellerId, source: 'expiry_pending_1h', requestedBy: null,
          walletRefundCents: walletAmountUsed, purchaseDebitLedgerId: funds.debitLedgerId,
          walletRefundLedgerId: hasWalletDebit ? funds.creditRef.id : null,
          cardCapabilityNeutralized: true,...(expirySource?{preparationPolicySource:expirySource}:{}), committedAt: FieldValue.serverTimestamp() },
      };
      // F22/F73: clear the wallet markers so the PI (already cancelled in step 2)
      // can never drive a second wallet re-credit via issueTransactionRefund.
      if (hasWalletDebit) {
        txUpdate.walletAmountUsed = FieldValue.delete();
        txUpdate.paidVia = FieldValue.delete();
      }
      await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, txUpdate);

      if (articleRef && articleUnlock) {
        commitArticleRelease(tx, articleRef, articleUnlock);
      }

      if (hasWalletDebit && funds.wallet) {
        await recoveryCommit({refs: [(funds.walletRef).path]});
    tx.update(funds.walletRef, await financialRecoveryWalletFields(funds.walletRef,funds.wallet,{
          balance: FieldValue.increment(walletAmountUsed),
          updatedAt: FieldValue.serverTimestamp(),
        },{balance: ((funds.wallet)["balance"]??0) + (walletAmountUsed)}));

        await recoveryCommit({refs: [(funds.creditRef).path]});
    tx.create(funds.creditRef, {
          type: 'refund_credit',
          amount: walletAmountUsed,
          balanceAfter: funds.wallet.balance + walletAmountUsed,
          description: 'Remboursement — paiement non finalisé (porte-monnaie)',
          transactionId,
          currency: 'CAD', purchaseDebitLedgerId: funds.debitLedgerId,
          createdAt: FieldValue.serverTimestamp(),
        });

        logger.info('[expireOrphanedTransactions] wallet portion restored on expiry', {
          transactionId,
          buyerId: txData.buyerId,
          walletAmountRefunded: walletAmountUsed,
        });
      }
      if (funds.intent) { await recoveryCommit({refs: [(funds.intentRef).path]}); tx.update(funds.intentRef, { state: 'canceled', providerStatus: 'canceled',
        cardCapabilityNeutralized: true, walletRestitutionLedgerId: hasWalletDebit ? funds.creditRef.id : null,
        cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }); }
      // The local cancellation, any attributed wallet restitution, notices and
      // explanation share ONE commit. This describes the local decision; it
      // does not turn an earlier provider call into a new banking attestation.
      await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, {transactionId, userId: txData.buyerId, decisionType: 'transaction_expired',
        buyerId: txData.buyerId, sellerId: txData.sellerId,
        criteria: {status: txData.status, cancelReason: 'pending_payment_expired_1h',
          ...(currentPreparationSource ? {clockBasis: currentPreparationSource.clockBasis,
            nativeStartsAtMs: currentPreparationSource.startsAtMs, nativeDeadlineMs: currentPreparationSource.expiresAtMs,
            policyVersion: currentPreparationSource.policyVersion, policyHash: currentPreparationSource.policyHash,
            preparationSourceHash: currentPreparationSource.sourceHash, preparationWindowHash: currentPreparationSource.windowHash} :
            {clockBasis: 'created_at', expiryWindowHours: 1, nativeStartsAtMs: currentCreatedAtMs,
              nativeDeadlineMs: currentCreatedAtMs! + PENDING_PAYMENT_EXPIRY_MS}),
          orderSourceRevision: txSnap.updateTime ? `${txSnap.updateTime.seconds}:${txSnap.updateTime.nanoseconds}` : null},
        result: 'Commande annulée automatiquement après l’échéance de finalisation du paiement.',
        executedAt: FieldValue.serverTimestamp()});
      notices.commit();
      return true;
    });

    return expired;
  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
    logger.error('[expireOrphanedTransactions] Error expiring pending_payment transaction', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}

/**
 * Refund + expire a single 'paid' transaction the seller never shipped (>7d).
 *
 * REUSES the shared issueTransactionRefund core (single source of truth for the
 * Stripe refund + sellerDebt reconciliation + dead-lettering on Stripe
 * failure with the deterministic key rf_${txId}). The previous bespoke 3-phase
 * implementation is replaced by:
 *
 *  1. INTENT (runTransaction): re-check status (paid OR resume a stuck
 *     refund_in_progress), mark `refund_in_progress`, stamp `refundReason`.
 *  2. CORE: issueTransactionRefund does the idempotent Stripe refund OUTSIDE a
 *     transaction (key rf_${txId} — Stripe dedups any re-run / resume) then the
 *     atomic Firestore reconciliation: re-credit buyer wallet portion, debit the
 *     seller EXACTLY sellerCreditedCents across pending->held->balance (shortfall
 *     -> sellerDebt, never masked), re-list the article, status -> 'refunded'.
 *     Final status 'refunded' makes the inbound charge.refunded webhook a no-op.
 *  3. STAMP: record cancelReason/cancelledAt (audit fields the generic core does
 *     not own). On the core throwing (Stripe failed -> dead-lettered), roll the
 *     status back to 'refund_in_progress' is NOT needed — the tx is already
 *     refund_in_progress and the next run (section 4 resume) re-drives it.
 *
 * NOTE: the seller debit now uses sellerCreditedCents (matching the rest of the
 * hardened ledger) instead of the legacy derived sellerPayout — a correctness
 * improvement. Under the deferred-credit model a never-credited 'paid' tx has no
 * sellerCreditedCents, so the debit target is 0 (no false debt).
 *
 * @returns true if the transaction reached a terminal refunded state this run.
 */
async function refundPaidNotShipped(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  _stripe: StripeClient
): Promise<boolean> {
  const transactionId = doc.id;
  const data = doc.data();

  // P1 (atomicity payment<->label): a transaction still awaiting its shipping
  // label is owned by sweepPendingLabels (re-rate + retry, then refund after N
  // attempts). Do NOT expire/refund it here — the seller was never credited and
  // the sweep handles the eventual refund itself.
  if (data.labelCreationPending === true) {
    logger.info('[expireOrphanedTransactions] skipping labelCreationPending tx (owned by sweepPendingLabels)', {
      transactionId,
    });
    return false;
  }

  try {
    const fresh = (await doc.ref.get()).data();
    if (!fresh || (!fresh.refund && fresh.status !== 'paid' && fresh.status !== 'refund_in_progress')) return false;
    const expiry = fresh.refund ? null : nonShipmentExpirySource(fresh, transactionId);
    if (!fresh.refund && !expiry) {
      const timeline = purchasePolicyTimeline(fresh, transactionId);
      if (timeline.reviewRequired || fresh.nonShipmentPolicyWindow == null) await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        const current = (await tx.get(doc.ref)).data();
        const alertRef = db.collection('admin_alerts').doc(`purchase_policy_${transactionId}`), alert = await tx.get(alertRef);
        if (!current || current.refund || current.status !== 'paid' || nonShipmentExpirySource(current, transactionId)) return;
        if (current.nonShipmentPolicyWindow != null && !purchasePolicyTimeline(current, transactionId).reviewRequired) return;
        if (!alert.exists) { await recoveryCommit({refs: [(alertRef).path]}); tx.create(alertRef, { kind: 'purchase_policy_reconciliation', refId: transactionId, status: 'open',
          message: 'Rapprocher la politique acceptée, le paiement enregistré et les scans avant une décision sur cette vente.', createdAt: FieldValue.serverTimestamp() }); }
        await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, { purchasePolicyReviewRequired: true, purchasePolicyReviewReason: 'non_shipment_clock_reconciliation_required' });
      });
      return false;
    }
    const result = fresh.refund ? await resumeTransactionRefund(transactionId) : await issueTransactionRefund(transactionId, fresh, {
      reason: 'seller_did_not_ship_7d', idempotencyKey: 'rf_' + transactionId, relistArticle: true,
      source: 'expireOrphanedTransactions_paidNotShipped', allowedInitialStatuses: ['paid', 'refund_in_progress'],
      nonShipmentExpiry: expiry!,
    });
    if (!result.success) return false;
    const settled = (await doc.ref.get()).data();
    // Another initiator owns its reason, partial amounts and audit context.
    if (settled?.refund?.source !== 'expireOrphanedTransactions_paidNotShipped') return true;

    // The native refund core commits cancellation metadata and its immutable
    // explanation WITH the local settlement. A replay never rewrites its date.
    // The qualified refund core already committed both party notices. An
    // automatic cancellation must not emit a detached duplicate refund claim.

    return true;
  } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
    // issueTransactionRefund already dead-lettered a Stripe failure with the
    // deterministic key; the tx stays refund_in_progress so section 4 re-drives
    // it next run. Just log domain context.
    logger.error('[expireOrphanedTransactions] Error processing paid-not-shipped transaction', {
      transactionId,
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}
