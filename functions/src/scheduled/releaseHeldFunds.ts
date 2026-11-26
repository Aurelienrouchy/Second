import { financialRecoverySourceFields } from "../utils/financialRecoverySources";
import { FinancialRecoveryBlocked } from "../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../utils/financialRecoverySources";
import { financialRecoveryWalletFields } from "../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../utils/financialRecoveryInterlock";
import {productRoutingAllowsRelease} from '../utils/productRoutingReview';
import {productMixedOrderAllowsRelease} from '../utils/productMixedOrders';
/**
 * Scheduled held-funds release + 7-day dispute window contract
 * Firebase Functions v2 - using onSchedule, region northamerica-northeast1
 *
 * THREE-BUCKET FUNDS MODEL (seller wallet, collection `wallets`)
 * ------------------------------------------------------------------
 *   pendingBalance — sale paid, NOT yet delivered (escrow, in transit)
 *   heldBalance    — delivered, inside the 7-day buyer-dispute window
 *   balance        — withdrawable (dispute window elapsed, no claim)
 *
 * Lifecycle of seller funds for one purchase:
 *   1. PI.succeeded / payWithWallet  -> pendingBalance += payout
 *   2. DELIVERED (tracking)          -> pendingBalance -= payout
 *                                       heldBalance    += payout
 *                                       transaction.fundsReleaseAt = deliveredAt + 7d
 *   3. fundsReleaseAt <= now & no dispute (THIS JOB)
 *                                    -> heldBalance -= payout
 *                                       balance     += payout
 *                                       transaction.fundsReleasedAt = now
 *
 * The DELIVERED transition (step 2) is owned by the shipping/state-machine
 * chantier (trackingCheck.ts + checkTrackingStatus + manual). This module
 * EXPOSES the reusable `applyDeliveredHeldFunds` helper that those sites must
 * call instead of the old "pendingBalance -> balance" move, so the contract
 * lives in one place. Until those sites are migrated, this scheduled job is a
 * no-op for transactions that have no `fundsReleaseAt` (they release on
 * delivery the old way), and becomes active the moment delivery starts setting
 * the held-funds fields.
 *
 * New wallet fields:  heldBalance, sellerDebt  (server-only, see rules chantier)
 * New transaction fields: fundsReleaseAt, fundsReleasedAt, disputed
 *
 * Ledger types introduced here: 'funds_released'.
 */
import { sellerPendingCreditCents, sellerHeldCreditCents } from '../utils/sellerEscrow';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { prepareOperationalNotices } from '../utils/notifications';
import { captureServerEvent } from '../lib/analytics';
import { hasUnsettledRefund } from '../utils/refundState';
import { hasActiveBankDispute } from '../utils/bankDispute';
import { orderModerationAllowsProgress, ensureOrderModerationNotices, deliveryCorrectionBlocksProgress } from '../utils/orderModeration';
import { hasUnsettledReturnRequest } from '../utils/returnRequest';
import { effectivePurchaseReleaseAt, purchasePolicyAllowsRelease } from '../utils/purchasePolicy';
import { fraudReviewAllowsProgress } from '../utils/fraudReviewDecision';
import { accountRelationshipAllowsRelease } from '../utils/accountRelationshipReview';
import { ACTIVE_PURCHASE_HOLD_STATUSES, observeOverduePurchaseHold, preparePurchaseHoldObservation } from '../utils/holdReview';
import { ACTIVE_SWAP_HOLD_STATUSES, readSwapHoldSource, prepareSwapHoldReview } from '../utils/swapHeldFunds';
import { createHash } from 'node:crypto';
import {readPurchaseRefundReleaseContext} from '../utils/refundAllocation';
import {devShippingOrder, DEV_SHIPPING_PROTOCOL} from '../config/devShippingSimulation';
import {isDevCommerceStripeTestRuntime} from '../config/runtimeEnvironment';
import {qualifiedOrderTransportQuote} from '../config/shippingTransportPolicy';

/** Buyer-dispute window after delivery before seller funds become withdrawable. */
export const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Process at most this many transactions per run to bound execution time. */
const MAX_TRANSACTIONS_PER_RUN = 200;
// A native H settlement can refund the buyer while explicitly leaving a
// platform-funded seller entitlement. Scan those terminal orders too; the
// existing per-row guard admits only a CURRENT native H disposition, never a
// refunded legacy order. Keep the same bounded cycle/lease/checkpoints.
const PURCHASE_RELEASE_SCAN_STATUSES = [...ACTIVE_PURCHASE_HOLD_STATUSES, 'refunded'];
const RELEASE_SCAN_LEASE_MS = 10 * 60 * 1000;
type ReleaseScanCursor = {schemaVersion: 2; cycleId: string; startedAt: Timestamp;
  untilId: string | null; lastId: string | null; completedAt: Timestamp | null};
type ReleaseScan = {ref: FirebaseFirestore.DocumentReference; ownerId: string; cursor: ReleaseScanCursor};
const releaseScanId = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') &&
  v !== '.' && v !== '..' && Buffer.byteLength(v, 'utf8') <= 1500;
function qualifiedReleaseCursor(raw: any): ReleaseScanCursor | null {
  if (raw?.schemaVersion !== 2 || typeof raw.cycleId !== 'string' || !raw.cycleId || !(raw.startedAt instanceof Timestamp) ||
      raw.startedAt.toMillis() < 0 || raw.startedAt.toMillis() > Date.now() || !releaseScanId(raw.untilId) || raw.completedAt !== null ||
      raw.lastId !== null && (!releaseScanId(raw.lastId) || Buffer.compare(Buffer.from(raw.lastId), Buffer.from(raw.untilId)) > 0)) return null;
  return raw as ReleaseScanCursor;
}
function ownsReleaseLease(data: FirebaseFirestore.DocumentData | undefined, ownerId: string) {
  return data?.scanLease?.schemaVersion === 1 && data.scanLease.ownerId === ownerId &&
    data.scanLease.lockedUntil instanceof Timestamp && data.scanLease.lockedUntil.toMillis() > Date.now();
}
async function acquireReleaseScan(): Promise<ReleaseScan | null> {
  const ref = db.collection('job_locks').doc('releaseHeldFunds_transactions_cursor'), ownerId = randomUUID();
  const acquired = await db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data(), lease = data?.scanLease;
    if (lease != null && (lease.schemaVersion !== 1 || typeof lease.ownerId !== 'string' || !lease.ownerId ||
        !(lease.lockedUntil instanceof Timestamp))) throw new Error('Held-funds scan lease needs reconciliation.');
    if (lease?.lockedUntil.toMillis() > Date.now()) return null;
    tx.set(ref, {scanLease: {schemaVersion: 1, ownerId, lockedAt: Timestamp.now(),
      lockedUntil: Timestamp.fromMillis(Date.now() + RELEASE_SCAN_LEASE_MS)}}, {merge: true});
    return {checkpoint: data?.scanCursor};
  });
  if (!acquired) return null;
  try {
    let cursor = qualifiedReleaseCursor(acquired.checkpoint);
    if (!cursor) {
      const startedAt = Timestamp.now();
      const tail = await db.collection('transactions').where('status', 'in', PURCHASE_RELEASE_SCAN_STATUSES)
        .orderBy('__name__', 'desc').limit(1).get();
      cursor = {schemaVersion: 2, cycleId: randomUUID(), startedAt, untilId: tail.docs[0]?.id ?? null,
        lastId: null, completedAt: tail.empty ? Timestamp.now() : null};
      const initialCursor = cursor;
      const saved = await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data();
        if (!ownsReleaseLease(data, ownerId)) return false;
        tx.update(ref, {scanCursor: initialCursor,
          ...(acquired.checkpoint !== undefined && data?.legacyScanCursor === undefined &&
            (acquired.checkpoint == null || acquired.checkpoint.schemaVersion !== 2) ? {legacyScanCursor: acquired.checkpoint} : {})});
        return true;
      });
      if (!saved) { await releasePurchaseScanLease({ref, ownerId}); return null; }
    }
    return {ref, ownerId, cursor};
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    await releasePurchaseScanLease({ref, ownerId});
    throw error;
  }
}
async function checkpointPurchaseRelease(scan: ReleaseScan, transactionId: string): Promise<boolean> {
  const next = {...scan.cursor, lastId: transactionId};
  const saved = await db.runTransaction(async tx => {
    const lock = (await tx.get(scan.ref)).data();
    if (!ownsReleaseLease(lock, scan.ownerId) || lock?.scanCursor?.cycleId !== scan.cursor.cycleId ||
        lock.scanCursor.lastId !== scan.cursor.lastId) return false;
    const observedAt = Timestamp.now();
    const observation = await preparePurchaseHoldObservation(tx, transactionId, observedAt);
    // A failed operator alert or private receipt preserves the preceding row.
    observation.commit();
    tx.update(scan.ref, {scanCursor: next, 'scanLease.lockedUntil': Timestamp.fromMillis(Date.now() + RELEASE_SCAN_LEASE_MS),
      lastRowObservation: {transactionId, observedAt, sourceVersion: observation.sourceVersion,
        qualification: observation.qualification, holdObservationId: observation.observationId}});
    return true;
  });
  if (saved) scan.cursor = next;
  return saved;
}
async function completePurchaseReleaseScan(scan: ReleaseScan): Promise<void> {
  await db.runTransaction(async tx => {
    const data = (await tx.get(scan.ref)).data();
    if (!ownsReleaseLease(data, scan.ownerId) || data?.scanCursor?.cycleId !== scan.cursor.cycleId ||
        data.scanCursor.lastId !== scan.cursor.lastId) return;
    tx.update(scan.ref, {scanCursor: {...scan.cursor, completedAt: Timestamp.now()}});
  });
}
async function releasePurchaseScanLease(scan: {ref: FirebaseFirestore.DocumentReference; ownerId: string}): Promise<void> {
  await db.runTransaction(async tx => {
    if ((await tx.get(scan.ref)).data()?.scanLease?.ownerId !== scan.ownerId) return;
    tx.update(scan.ref, {'scanLease.lockedUntil': Timestamp.fromMillis(0), 'scanLease.releasedAt': Timestamp.now()});
  });
}

/**
 * Transaction statuses that BLOCK the release of held funds. If a transaction
 * is in any of these, the dispute window is on hold and funds stay in
 * heldBalance until the dispute is resolved (charge.dispute.closed handler).
 */
const DISPUTE_BLOCKING_STATUSES = new Set([
  'disputed',
  'delivery_failed',
  'lost',
  'refunded',
  'refund_in_progress',
  'refund_action_required',
]);

/**
 * REUSABLE CONTRACT — call this from the DELIVERED transition.
 *
 * Moves a seller payout from `pendingBalance` to `heldBalance` and stamps the
 * transaction with `fundsReleaseAt = deliveredAt + 7 days`. MUST be called
 * inside a runTransaction; the caller is responsible for having already read
 * the wallet/transaction snapshots and for the transaction status update
 * (status -> 'delivered', deliveredAt).
 *
 * @param tx              active Firestore transaction
 * @param sellerWalletRef seller wallet doc ref (collection `wallets`)
 * @param sellerWalletData snapshot data of the seller wallet (for balanceAfter)
 * @param transactionRef  the transaction doc ref
 * @param transactionId   the transaction id (for ledger linkage)
 * @param sellerPayoutCents seller payout in CENTS
 * @param deliveredAtMs   delivery time in epoch ms (used to compute the window)
 */
export async function applyDeliveredHeldFunds(
  tx: FirebaseFirestore.Transaction,
  sellerWalletRef: FirebaseFirestore.DocumentReference,
  sellerWalletData: FirebaseFirestore.DocumentData,
  transactionRef: FirebaseFirestore.DocumentReference,
  transactionId: string,
  sellerPayoutCents: number,
  deliveredAtMs: number,
  frozenPolicy?: { deadline: Timestamp | null },
  recoveryOrder?: FirebaseFirestore.DocumentData,
  recoveryOrderFields?: FirebaseFirestore.DocumentData
): Promise<void> {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
  const sourceOrder = recoveryOrder;
  if (!sourceOrder) throw new FinancialRecoveryBlocked('delivery_order_source_missing');
  // Never manufacture escrow funds if the aggregate bucket is inconsistent.
  sellerPayoutCents = Math.min(sellerPayoutCents, Math.max(0, sellerWalletData.pendingBalance || 0));
  // Move pending -> held (delivered, inside dispute window)
  await recoveryCommit({refs: [(sellerWalletRef).path]});
    tx.update(sellerWalletRef, await financialRecoveryWalletFields(sellerWalletRef,sellerWalletData,{
    pendingBalance: FieldValue.increment(-sellerPayoutCents),
    heldBalance: FieldValue.increment(sellerPayoutCents),
    updatedAt: FieldValue.serverTimestamp(),
  },{pendingBalance: ((sellerWalletData)["pendingBalance"]??0) + (-sellerPayoutCents),heldBalance: ((sellerWalletData)["heldBalance"]??0) + (sellerPayoutCents)}));

  const ledgerRef = sellerWalletRef.collection('ledger').doc();
  await recoveryCommit({refs: [(ledgerRef).path]});
    tx.set(ledgerRef, {
    type: 'funds_held',
    amount: sellerPayoutCents,
    balanceAfter: (sellerWalletData.heldBalance || 0) + sellerPayoutCents,
    description: 'Vente livrée — fonds en attente (fenêtre de litige 7 jours)',
    transactionId,
    createdAt: FieldValue.serverTimestamp(),
    status: 'held',
  });

  // Stamp the release deadline on the transaction.
  // Shipping policy callers supply the exact frozen deadline (or explicitly
  // no qualified deadline). Other historical rails retain their own contract.
  const releaseAt = frozenPolicy === undefined ? Timestamp.fromMillis(deliveredAtMs + DISPUTE_WINDOW_MS) : frozenPolicy.deadline;
  await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,sourceOrder,{...recoveryOrderFields,
    ...(releaseAt ? { fundsReleaseAt: releaseAt } : {}),
    sellerHeldCreditCents: sellerPayoutCents,
  }));
}

/** Shared single-purchase release engine. Production callers always use real
 * time. The explicitly named Dev command may advance ONLY this qualified
 * simulated order's clock; payment, returns, disputes and ledger guards remain
 * identical. Delivery and effect timestamps are never backdated. */
export async function releasePurchaseHeldFunds(transactionId: string, sellerId: string,
  guard?: (tx: FirebaseFirestore.Transaction) => Promise<unknown>, devClock?: {actorId: string}): Promise<boolean> {
  const transactionRef = db.collection('transactions').doc(transactionId);
  const sellerWalletRef = db.collection('wallets').doc(sellerId);
  return db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
              await guard?.(tx);
              const txSnap = await tx.get(transactionRef);
              if (!txSnap.exists) return false;
              const tdata = txSnap.data()!;
              let now = Timestamp.now();
              let simulationClock: FirebaseFirestore.DocumentData | undefined;
              if (devClock) {
                if (!isDevCommerceStripeTestRuntime() || !devShippingOrder(tdata) ||
                    tdata.deliveryTrackingProof?.provider !== 'seconde_dev_simulation' ||
                    !(tdata.fundsReleaseAt instanceof Timestamp) || typeof tdata.shippingQuoteId !== 'string')
                  throw new Error('dev_shipping_virtual_clock_unqualified');
                const quote = (await tx.get(db.collection('shipping_quotes').doc(tdata.shippingQuoteId))).data();
                if (qualifiedOrderTransportQuote(tdata, quote, transactionId)?.testMode !== 'seconde_dev_commerce_v1')
                  throw new Error('dev_shipping_virtual_clock_quote_unqualified');
                now = tdata.fundsReleaseAt;
                simulationClock = {protocol: DEV_SHIPPING_PROTOCOL, source: 'member_test_action', actorId: devClock.actorId,
                  recordedAt: Timestamp.now(), advancedThroughAt: now, realShipment: false};
              }
              // A query row is only a candidate. Never move an old seller's
              // wallet if the native order changed before this transaction.
              if (tdata.sellerId !== sellerId) return false;
              const currentPayout = tdata.sellerPayout ?? tdata.amount;
              if (typeof currentPayout !== 'number' || !Number.isFinite(currentPayout) || currentPayout < 0 ||
                  !Number.isSafeInteger(Math.round(currentPayout * 100))) return false;

              // Re-check invariants inside the transaction (status may have
              // changed between query and commit — e.g. a dispute was opened).
              const negotiated = tdata.purchaseRefundCaseDisposition != null ? await readPurchaseRefundReleaseContext(tx, transactionId, tdata) : null;
              if (Object.prototype.hasOwnProperty.call(tdata, 'purchaseRefundCaseDisposition') && !negotiated) return false;
              if (tdata.status !== 'delivered' && !negotiated) return false;
              if (tdata.disputed === true) return false;
              if (deliveryCorrectionBlocksProgress(tdata)) return false;
              if (!purchasePolicyAllowsRelease(tdata, transactionId, await productRoutingAllowsRelease(tx, transactionId, tdata), await productMixedOrderAllowsRelease(tx, transactionId, tdata))) return false;
              if (hasUnsettledReturnRequest(tdata) && negotiated?.returnFinanciallySettled !== true) return false;
              const currentReleaseAt = effectivePurchaseReleaseAt(tdata, transactionId);
              if (!currentReleaseAt || currentReleaseAt.toMillis() > now.toMillis()) return false;
              if (hasActiveBankDispute(tdata) || hasUnsettledRefund(tdata)) return false;
              if (tdata.labelReconciliationRequired === true) return false;
              if (tdata.fundsReleasedAt) return false; // idempotence
              if (!await accountRelationshipAllowsRelease(tx, {kind:'purchase',id:transactionId}, tdata.buyerId, tdata.sellerId)) return false;
              if (!await fraudReviewAllowsProgress(tx, transactionId, tdata, txSnap)) return false;
              if (!await orderModerationAllowsProgress(tx, negotiated ? {...tdata, status: 'delivered'} : tdata)) return false;

              const walletSnap = await tx.get(sellerWalletRef);
              if (!walletSnap.exists) {
                logger.warn('[releaseHeldFunds] seller wallet not found — skipping', {
                  transactionId,
                  sellerId,
                });
                return false;
              }
              const walletData = walletSnap.data()!;

              // Move from heldBalance to balance, capped so heldBalance never
              // goes negative (defensive — should equal sellerPayoutCents).
              const heldNow = walletData.heldBalance || 0;
              const escrowCents = typeof tdata.sellerCreditedCents === 'number'
                ? await sellerPendingCreditCents(tx, sellerWalletRef, tdata, transactionId)
                : Math.round(currentPayout * 100);
              const actualHeldCents = await sellerHeldCreditCents(tx, sellerWalletRef, tdata, transactionId, escrowCents);
              if (actualHeldCents === null) {
                logger.error('[releaseHeldFunds] missing sale escrow movement — reconciliation required', { transactionId, sellerId });
                return false;
              }
              const moveCents = Math.min(actualHeldCents, Math.max(0, heldNow));

              // F39: regularise any outstanding sellerDebt FIRST. The released
              // amount pays down the debt before the remainder lands in the
              // withdrawable balance (debt repayment has priority on future funds).
              const sellerDebt = walletData.sellerDebt || 0;
              const debtRepayment = Math.min(sellerDebt, moveCents);
              const toBalance = moveCents - debtRepayment;
              const releaseNotices = await prepareOperationalNotices(tx, [
                { eventKey: `funds_released:${transactionId}`, userId: tdata.sellerId, type: 'funds_released',
                  title: simulationClock ? 'Simulation Dev — fonds de la vente disponibles' : 'Fonds de la vente traités automatiquement',
                  message: simulationClock ? 'Seconde Dev : la fin du délai de réclamation a été simulée pour cette commande. Le porte-monnaie contient uniquement de l’argent de test.' : debtRepayment > 0
                    ? 'Le délai de réclamation est écoulé. Les fonds de cette vente ont été traités, avec régularisation du solde dû. Consultez le porte-monnaie pour les montants. Vous pouvez demander un examen humain de cette décision.'
                    : 'Le délai de réclamation est écoulé. Les fonds de cette vente ont été libérés. Consultez le porte-monnaie pour leur disponibilité courante. Vous pouvez demander un examen humain de cette décision.',
                  data: { transactionId } },
                { eventKey: `funds_released:${transactionId}`, userId: tdata.buyerId, type: 'funds_released',
                  title: simulationClock ? 'Simulation Dev — fin du délai de réclamation' : 'Délai de réclamation de la commande écoulé',
                  message: simulationClock ? 'Seconde Dev : un membre a simulé la fin du délai pour cette commande de test.' : 'Le délai de réclamation de cette commande est écoulé et le traitement automatique des fonds est enregistré. Vous pouvez consulter la commande et contacter le support pour un examen humain.',
                  data: { transactionId } },
              ]);
              const decisionRef = db.collection('automatic_decisions_log').doc();

              const walletUpdate: Record<string, any> = {
                heldBalance: FieldValue.increment(-moveCents),
                updatedAt: FieldValue.serverTimestamp(),
              };
              if (toBalance > 0) walletUpdate.balance = FieldValue.increment(toBalance);
              if (debtRepayment > 0) walletUpdate.sellerDebt = FieldValue.increment(-debtRepayment);
              await recoveryCommit({refs: [(sellerWalletRef).path]});
    tx.update(sellerWalletRef, await financialRecoveryWalletFields(sellerWalletRef,walletData,walletUpdate,{heldBalance:(walletData.heldBalance??0)-moveCents,...(toBalance>0?{balance:(walletData.balance??0)+toBalance}:{}),...(debtRepayment>0?{sellerDebt:(walletData.sellerDebt??0)-debtRepayment}:{})}));

              if (debtRepayment > 0) {
                const debtLedgerRef = sellerWalletRef.collection('ledger').doc();
                await recoveryCommit({refs: [(debtLedgerRef).path]});
    tx.set(debtLedgerRef, {
                  type: 'debt_repayment',
                  amount: debtRepayment,
                  balanceAfter: sellerDebt - debtRepayment,
                  description: 'Fonds libérés — régularisation du solde dû',
                  transactionId,
                  createdAt: FieldValue.serverTimestamp(),
                });
              }

              const ledgerRef = sellerWalletRef.collection('ledger').doc();
              await recoveryCommit({refs: [(ledgerRef).path]});
    tx.set(ledgerRef, {
                type: 'funds_released',
                amount: moveCents,
                balanceAfter: (walletData.balance || 0) + toBalance,
                description:
                  simulationClock ? 'Simulation Seconde Dev — fin du délai de réclamation' : debtRepayment > 0
                    ? 'Fenêtre de litige écoulée — fonds disponibles (après régularisation)'
                    : 'Fenêtre de litige écoulée — fonds disponibles',
                transactionId,
                createdAt: FieldValue.serverTimestamp(),
              });

              // Stamp completedAt alongside status:'completed' to match every
              // other writer of this transition (webhooks/payments/reconcile/
              // swaps). reviews.ts anchors its 60-day review window on
              // completedAt, so this is the "reviewable" marker for the
              // delivered -> completed transition once 'completed' is added to
              // the reviews terminalStatuses (be-reviews-callable).
              await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,tdata,{
                status: negotiated && tdata.status === 'refunded' ? 'refunded' : 'completed',
                completedAt: FieldValue.serverTimestamp(),
                fundsReleasedAt: FieldValue.serverTimestamp(),
                sellerHeldCreditCents: actualHeldCents,
                sellerReleasedCents: moveCents,
                ...(simulationClock ? {devShippingSimulationClock: simulationClock} : {}),
              }));
              // The explanation and the financial effect form ONE commit.
              // No post-effect best-effort log can lose this decision. The
              // source is THIS transaction's native order, not the query row;
              // seller debt details remain outside the common party view.
              await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, { transactionId, userId: tdata.sellerId, decisionType: 'funds_released',
                buyerId: typeof tdata.buyerId === 'string' ? tdata.buyerId : null, sellerId: tdata.sellerId,
                criteria: { status: tdata.status, disputed: typeof tdata.disputed === 'boolean' ? tdata.disputed : null,
                  fundsReleaseAt: currentReleaseAt.toDate().toISOString(), disputeWindowDays: 7,
                  ...(simulationClock ? {simulationClock} : {}),
                  releasedCents: moveCents, orderSourceRevision: txSnap.updateTime
                    ? `${txSnap.updateTime.seconds}:${txSnap.updateTime.nanoseconds}` : null },
                result: simulationClock ? 'Simulation Seconde Dev : fin du délai demandée par un membre, fonds de test traités.' : 'Fonds de la vente traités automatiquement après l’échéance de réclamation.',
                executedAt: FieldValue.serverTimestamp() });
              releaseNotices.commit();

              return true;
  });
}

export const releaseHeldFunds = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'northamerica-northeast1',
    memory: '512MiB',
  },
  async () => {
    return withFinancialRecoveryScope({operation: "scheduled/releaseHeldFunds.releaseHeldFunds"}, async () => {
    const now = Timestamp.now();
    let released = 0;
    let skipped = 0;
    let errors = 0;

    // Include missing/malformed deadlines. A native ID cycle is bounded and
    // resumes after durable rows; a future clock is qualified inside each TX.
    const scan = await acquireReleaseScan();
    if (scan) try {
      if (scan.cursor.untilId !== null) {
        let query = db
          .collection('transactions')
          .where('status', 'in', PURCHASE_RELEASE_SCAN_STATUSES)
          .orderBy('__name__', 'asc')
          .endAt(scan.cursor.untilId)
          .limit(MAX_TRANSACTIONS_PER_RUN);
        if (scan.cursor.lastId) query = query.startAfter(scan.cursor.lastId);
        const snap = await query.get();
        let completedPage = true;
        for (const doc of snap.docs) {
          const data = doc.data();
          const transactionId = doc.id;

          // A blocked native deadline is an operational review, never an
          // instruction to release or change a historical hold. Re-read under TX.
          try {
            await observeOverduePurchaseHold(transactionId, Timestamp.now(), scan);
          } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
            errors++;
            logger.error('[releaseHeldFunds] could not preserve hold review', {
              transactionId, error: error instanceof Error ? error.message : error,
            });
            completedPage = false;
            break;
          }

          // Defense-in-depth: never release a disputed/lost/refunded transaction.
          if ((data.status !== 'delivered' || DISPUTE_BLOCKING_STATUSES.has(data.status)) && data.purchaseRefundCaseDisposition == null ||
              data.disputed === true || deliveryCorrectionBlocksProgress(data)) {
            if (!await checkpointPurchaseRelease(scan, transactionId)) { completedPage = false; break; }
            skipped++;
            continue;
          }

          const effectiveReleaseAt = effectivePurchaseReleaseAt(data, transactionId);
          if (!effectiveReleaseAt || effectiveReleaseAt.toMillis() > now.toMillis() || data.fundsReleasedAt) {
            if (!await checkpointPurchaseRelease(scan, transactionId)) { completedPage = false; break; }
            skipped++;
            continue;
          }

          const sellerId = data.sellerId;
          const sellerPayout = data.sellerPayout ?? data.amount;

          if (!sellerId || typeof sellerPayout !== 'number') {
            logger.warn('[releaseHeldFunds] missing sellerId/payout — skipping', {
              transactionId,
            });
            if (!await checkpointPurchaseRelease(scan, transactionId)) { completedPage = false; break; }
            skipped++;
            continue;
          }

          const sellerPayoutCents = Math.round(sellerPayout * 100);

          try {
            const moved = await releasePurchaseHeldFunds(transactionId, sellerId, async tx => {
              if (!ownsReleaseLease((await tx.get(scan.ref)).data(), scan.ownerId))
                throw new Error('Held-funds scan lease no longer owned.');
            });

            if (moved) {
              released++;
              if (!await checkpointPurchaseRelease(scan, transactionId)) { completedPage = false; break; }

              // Analytics (§12): order_completed = funds released after the 7-day
              // window (shipping rail). distinct_id = buyer.
              if (typeof data.buyerId === 'string' && data.buyerId) {
                let daysToComplete = 0;
                const createdAt = data.createdAt;
                if (createdAt && typeof createdAt.toMillis === 'function') {
                  daysToComplete =
                    Math.round(((Date.now() - createdAt.toMillis()) / (24 * 60 * 60 * 1000)) * 100) /
                    100;
                }
                await captureServerEvent(data.buyerId, 'order_completed', {
                  transaction_id: transactionId,
                  delivery_type: 'shipping',
                  seller_net_cents: sellerPayoutCents,
                  days_to_complete: daysToComplete,
                  $insert_id: `order_completed_${transactionId}`,
                });
              }

              // Both in-app notices and resumable push intents committed with
              // the exact release above. No transport outcome is called reading.
            } else {
              // A blocker can appear after the initial observation. Observe its
              // current source again; an already released sale produces nothing.
              await observeOverduePurchaseHold(transactionId, Timestamp.now(), scan);
              await ensureOrderModerationNotices(transactionId);
              if (!await checkpointPurchaseRelease(scan, transactionId)) { completedPage = false; break; }
              skipped++;
            }
          } catch (err) {
      if (err instanceof FinancialRecoveryBlocked) throw err;
            errors++;
            logger.error('[releaseHeldFunds] error releasing funds', {
              transactionId,
              error: err instanceof Error ? err.message : err,
            });
            completedPage = false;
            break;
          }
        }
        if (completedPage && (snap.size < MAX_TRANSACTIONS_PER_RUN || scan.cursor.lastId === scan.cursor.untilId))
          await completePurchaseReleaseScan(scan);
      }
    } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      errors++;
      logger.error('[releaseHeldFunds] native row retained for retry', {error: error instanceof Error ? error.message : error});
    } finally {
      await releasePurchaseScanLease(scan);
    }

    // Second sweep: swap cash top-ups held after reception (same 7-day window).
    const swapStats = await releaseSwapTopUpHeldFunds(now);

    logger.info('[releaseHeldFunds] run complete', {
      released,
      skipped,
      errors,
      swapReleased: swapStats.released,
      swapSkipped: swapStats.skipped,
      swapErrors: swapStats.errors,
    });

    });
  }
);

type SwapReleaseCursor = ReleaseScanCursor & {source: 'swaps'};
type SwapReleaseScan = {ref: FirebaseFirestore.DocumentReference; ownerId: string; cursor: SwapReleaseCursor};
async function acquireSwapReleaseScan(): Promise<SwapReleaseScan | null> {
  const ref = db.collection('job_locks').doc('releaseHeldFunds_swaps_cursor'), ownerId = randomUUID();
  const acquired = await db.runTransaction(async tx => {
    const data = (await tx.get(ref)).data(), lease = data?.scanLease;
    if (lease != null && (lease.schemaVersion !== 1 || typeof lease.ownerId !== 'string' || !lease.ownerId ||
        !(lease.lockedUntil instanceof Timestamp))) throw new Error('Swap release scan lease needs reconciliation.');
    if (lease?.lockedUntil.toMillis() > Date.now()) return null;
    tx.set(ref, {scanLease: {schemaVersion: 1, ownerId, lockedAt: Timestamp.now(),
      lockedUntil: Timestamp.fromMillis(Date.now() + RELEASE_SCAN_LEASE_MS)}}, {merge: true});
    return {checkpoint: data?.scanCursor};
  });
  if (!acquired) return null;
  try {
    let cursor = acquired.checkpoint?.source === 'swaps' ? qualifiedReleaseCursor(acquired.checkpoint) as SwapReleaseCursor | null : null;
    if (!cursor) {
      const startedAt = Timestamp.now();
      const tail = await db.collection('swaps').where('status', 'in', [...ACTIVE_SWAP_HOLD_STATUSES])
        .orderBy('__name__', 'desc').limit(1).get();
      cursor = {schemaVersion: 2, source: 'swaps', cycleId: randomUUID(), startedAt, untilId: tail.docs[0]?.id ?? null,
        lastId: null, completedAt: tail.empty ? Timestamp.now() : null};
      const initialCursor = cursor;
      const saved = await db.runTransaction(async tx => {
        const data = (await tx.get(ref)).data();
        if (!ownsReleaseLease(data, ownerId)) return false;
        tx.update(ref, {scanCursor: initialCursor,
          ...(acquired.checkpoint !== undefined && data?.legacyScanCursor === undefined &&
            (acquired.checkpoint?.source !== 'swaps' || acquired.checkpoint?.schemaVersion !== 2) ? {legacyScanCursor: acquired.checkpoint} : {})});
        return true;
      });
      if (!saved) {await releasePurchaseScanLease({ref, ownerId}); return null;}
    }
    return {ref, ownerId, cursor};
  } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
    await releasePurchaseScanLease({ref, ownerId}); throw error;
  }
}

/** Equal deadlines do not affect ID traversal. No amount is taken from another swap. */
async function releaseSwapTopUpHeldFunds(
  _now: Timestamp
): Promise<{ released: number; skipped: number; errors: number }> {
  const stats = {released: 0, skipped: 0, errors: 0};
  const scan = await acquireSwapReleaseScan();
  if (!scan) return stats;
  try {
    if (scan.cursor.untilId === null) return stats;
    let query = db.collection('swaps').where('status', 'in', [...ACTIVE_SWAP_HOLD_STATUSES]).orderBy('__name__', 'asc')
      .endAt(scan.cursor.untilId).limit(MAX_TRANSACTIONS_PER_RUN);
    if (scan.cursor.lastId) query = query.startAfter(scan.cursor.lastId);
    const page = await query.get();
    let completedPage = true;
    for (const doc of page.docs) {
      const next = {...scan.cursor, lastId: doc.id};
      try {
        const moved = await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          const lock = (await tx.get(scan.ref)).data();
          if (!ownsReleaseLease(lock, scan.ownerId) || lock?.scanCursor?.source !== 'swaps' ||
              lock.scanCursor.cycleId !== scan.cursor.cycleId || lock.scanCursor.lastId !== scan.cursor.lastId) return null;
          const fresh = await tx.get(doc.ref), data = fresh.data(), observedAt = Timestamp.now();
          let released = false, result = 'source_not_active', review: Awaited<ReturnType<typeof prepareSwapHoldReview>> | null = null;
          if (data && (ACTIVE_SWAP_HOLD_STATUSES as readonly string[]).includes(data.status)) {
            const qualified = await readSwapHoldSource(tx, doc.id, data, observedAt);
            result = qualified.source.state;
            if (qualified.releaseReady && qualified.plan && fresh.updateTime instanceof Timestamp &&
                await accountRelationshipAllowsRelease(tx, {kind:'swap',id:doc.id}, data.initiatorId, data.receiverId)) {
              const plan = qualified.plan;
              const identity = createHash('sha256').update(JSON.stringify([doc.id, plan.payeeId, plan.amountCents,
                plan.creditLedgerId, plan.heldLedgerId, 'CAD'])).digest('hex');
              const ledgerRef = plan.walletRef.collection('ledger').doc(`swap_release_${identity}`);
              const decisionRef = db.collection('automatic_decisions_log').doc(`swap_funds_released_${identity}`);
              const collision = await tx.get(ledgerRef), priorDecision = await tx.get(decisionRef);
              if (collision.exists || priorDecision.exists) {
                qualified.source.state = 'review_required'; qualified.source.reason = 'financial_source_reconciliation';
                qualified.source.amountCents = null; qualified.source.financialQualification = 'unknown';
                review = await prepareSwapHoldReview(tx, fresh, qualified.source, observedAt);
                result = collision.exists ? 'release_identity_reconciliation' : 'release_decision_reconciliation';
              } else {
                // The private explanation and both durable in-app notices are
                // prepared before ANY financial write, then share its commit.
                // A published query row never supplies their parties/criteria.
                const releaseNotices = await prepareOperationalNotices(tx, [data.initiatorId, data.receiverId].map(userId => ({
                  eventKey: `swap_funds_released:${doc.id}:${identity}`, userId, type: 'swap_update',
                  title: 'Complément du Troc traité automatiquement',
                  message: 'L’échéance de réclamation de cet échange est écoulée. Le traitement automatique du complément est enregistré. Consultez le Troc et le porte-monnaie pour les montants ; vous pouvez contacter le support pour demander un examen humain.',
                  data: {swapId: doc.id, decisionId: decisionRef.id},
                })));
                // Exact qualified attribution or no effect. No min(globalHeld).
                await recoveryCommit({refs: [(plan.walletRef).path]});
    tx.update(plan.walletRef, await financialRecoveryWalletFields(plan.walletRef,plan.wallet,{heldBalance: FieldValue.increment(-plan.amountCents),
                  balance: FieldValue.increment(plan.amountCents), updatedAt: FieldValue.serverTimestamp()},{heldBalance: ((plan.wallet)["heldBalance"]??0) + (-plan.amountCents),balance: ((plan.wallet)["balance"]??0) + (plan.amountCents)}));
                await recoveryCommit({refs: [(ledgerRef).path]});
    tx.create(ledgerRef, {type: 'funds_released', amount: plan.amountCents, currency: 'CAD',
                  balanceAfter: plan.wallet.balance + plan.amountCents, description: 'Complément d’échange — fonds traités après l’échéance initiale',
                  swapId: doc.id, createdAt: FieldValue.serverTimestamp()});
                await recoveryCommit({refs: [(doc.ref.collection('topup_release').doc('committed')).path]});
    tx.create(doc.ref.collection('topup_release').doc('committed'), {protocol: 'swap_topup_release_v1', swapId: doc.id,
                  initiatorId: data.initiatorId, receiverId: data.receiverId, payerId: plan.payerId, payeeId: plan.payeeId,
                  amountCents: plan.amountCents, currency: 'CAD', creditLedgerId: plan.creditLedgerId, heldLedgerId: plan.heldLedgerId,
                  releaseLedgerId: ledgerRef.id, sourceVersion: fresh.updateTime,
                  decisionId: decisionRef.id, decisionProtocol: 'swap_funds_released_v1', recordedAt: FieldValue.serverTimestamp()});
                await recoveryCommit({refs: [(decisionRef).path]});
    tx.create(decisionRef, {protocol: 'swap_funds_released_v1', sourceKind: 'swap', swapId: doc.id, transactionId: null,
                  decisionType: 'funds_released', automated: true, userId: plan.payeeId,
                  initiatorId: data.initiatorId, receiverId: data.receiverId,
                  // No purchase roles: the dedicated callable authorises the
                  // Troc participants; purchase rules/DTOs cannot adopt this.
                  buyerId: null, sellerId: null,
                  criteria: {status: data.status, disputed: Object.prototype.hasOwnProperty.call(data, 'disputed') ? data.disputed : null,
                    heldAt: qualified.source.startedAt, initialDeadlineAt: qualified.source.initialDeadlineAt,
                    bothReceptionsAt: qualified.source.bothReceptionsAt, releasedCents: plan.amountCents, currency: 'CAD',
                    swapSourceRevision: `${fresh.updateTime.seconds}:${fresh.updateTime.nanoseconds}`},
                  result: 'Libération interne du complément du Troc enregistrée après l’échéance de réclamation.',
                  executedAt: FieldValue.serverTimestamp()});
                await recoveryCommit({refs: [(doc.ref).path]});
    tx.update(doc.ref, await financialRecoverySourceFields('swap',doc.ref,data,{topUpReleasedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()}));
                releaseNotices.commit();
                released = true; result = 'native_release_committed';
              }
            } else if (qualified.source.state === 'review_required') {
              review = await prepareSwapHoldReview(tx, fresh, qualified.source, observedAt);
              result = 'native_review_committed';
            }
          }
          // All reads precede writes; review/alert/receipt and checkpoint are
          // atomic. An unknown failed commit retains the preceding ID.
          review?.commit();
          await recoveryCommit({refs: [(scan.ref).path]});
    tx.update(scan.ref, {scanCursor: next, 'scanLease.lockedUntil': Timestamp.fromMillis(Date.now() + RELEASE_SCAN_LEASE_MS),
            lastRowObservation: {swapId: doc.id, sourceVersion: fresh.updateTime ?? null, observedAt, result,
              holdObservationId: review?.key ?? null}});
          return released;
        });
        if (moved === null) {completedPage = false; break;}
        scan.cursor = next;
        if (moved) stats.released++; else stats.skipped++;
      } catch (error) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
        stats.errors++; completedPage = false;
        logger.error('[releaseHeldFunds] swap row retained for retry', {swapId: doc.id, error: error instanceof Error ? error.message : error});
        break;
      }
    }
    if (completedPage && (page.size < MAX_TRANSACTIONS_PER_RUN || scan.cursor.lastId === scan.cursor.untilId)) {
      await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        const data = (await tx.get(scan.ref)).data();
        if (ownsReleaseLease(data, scan.ownerId) && data?.scanCursor?.cycleId === scan.cursor.cycleId && data.scanCursor.lastId === scan.cursor.lastId)
          { await recoveryCommit({refs: [(scan.ref).path]}); tx.update(scan.ref, {scanCursor: {...scan.cursor, completedAt: Timestamp.now()}}); }
      });
    }
    return stats;
  } finally {
    await releasePurchaseScanLease(scan);
  }
}
