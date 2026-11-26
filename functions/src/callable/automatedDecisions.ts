import {assertPrivateAccountSession, withPrivateAccountSession} from '../utils/privateAccountSession';
/**
 * Automated-decision transparency & contestation callables (Loi 25, art. 12.1)
 * Firebase Functions v2 — region northamerica-northeast1, memory 512MiB.
 *
 * LEGAL ANCHOR — Loi 25, art. 12.1 ("décision fondée exclusivement sur un
 * traitement automatisé"):
 *   - The platform takes a handful of decisions WITHOUT human intervention:
 *       • funds_released     — heldBalance → balance after the 7-day dispute
 *                              window elapses (releaseHeldFunds).
 *       • transaction_expired — an orphaned/unfulfilled order is cancelled
 *                              (expireOrphanedTransactions).
 *       • label_refund       — a paid order whose shipping label could never be
 *                              created is refunded (sweepPendingLabels).
 *   - The user must be (a) INFORMED that the decision was automated, (b) able to
 *     understand the CRITERIA used, and (c) able to request a HUMAN REVIEW.
 *
 * This module never moves money. Current purchase/Troc releases and automatic
 * refund reservation/settlement commit their native explanations WITH the
 * local effect. The compatibility log helper has no current runtime caller.
 *   - contestAutomatedDecision — lets a party open a human-review request. It
 *                               records an exact-source private support dossier. It
 *                               REVERSES NOTHING automatically (human decides).
 *   - getAutomatedDecisionLog  — private purchase, admission and exact native
 *                               Troc-release readers with distinct DTOs.
 *
 * COLLECTIONS:
 *   - automatic_decisions_log/{id}            — server-written audit log.
 *   - support_requests/{id}                  — current exact-source review requests.
 *   - automated_decision_contestations/{id}   — historical requests only.
 *     (We do NOT reuse `disputes`: that collection is purpose-built for the
 *      buyer "delivered but problem" flow which FREEZES the funds — an automated-
 *      decision contestation must NOT freeze anything, so support lives apart to keep
 *      the dispute-freeze invariant clean.)
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { executeSupportOwnerCommand } from './supportRequests';
import { admissionDecisionView, decisionView, supportId, supportUid, supportObject, readNativeSwapFundReleaseLog } from '../utils/supportRequest';

const REGION = 'northamerica-northeast1';

/** The three decision types taken without human intervention. */
export type AutomatedDecisionType =
  | 'funds_released'
  | 'transaction_expired'
  | 'label_refund';

const DECISION_TYPES: ReadonlySet<AutomatedDecisionType> = new Set([
  'funds_released',
  'transaction_expired',
  'label_refund',
]);

export interface LogAutomatedDecisionInput {
  transactionId: string;
  /** The user this decision concerns (seller for funds_released, buyer for refunds). */
  userId: string;
  decisionType: AutomatedDecisionType;
  /** Human-readable criteria object that drove the decision (e.g. { status, releaseAt, disputed }). */
  criteria: Record<string, unknown>;
  /** Human-readable outcome summary (e.g. 'Fonds libérés au vendeur'). */
  result: string;
}

/**
 * Legacy compatibility helper, not a writer for new financial decisions.
 * Current runtime callers are absent; new effects use their own atomic source
 * and immutable phases. Historical random-ID rows remain readable.
 * Best-effort journalling writes one
 * `automatic_decisions_log/{id}` doc with a serverTimestamp. NEVER throws — it
 * is called from inside the scheduled monetary jobs AFTER the money has moved,
 * so a logging hiccup must never roll back or block a successful release/refund.
 *
 * Never writes `undefined` into Firestore (sanitises the criteria map; omits
 * absent values rather than passing undefined).
 */
export async function logAutomatedDecision(
  input: LogAutomatedDecisionInput,
): Promise<string | null> {
  try {
    if (
      typeof input.transactionId !== 'string' ||
      input.transactionId.length === 0 ||
      typeof input.userId !== 'string' ||
      input.userId.length === 0 ||
      !DECISION_TYPES.has(input.decisionType)
    ) {
      logger.warn('[logAutomatedDecision] invalid input — skipping', {
        transactionId: input.transactionId,
        decisionType: input.decisionType,
      });
      return null;
    }

    // Sanitise the criteria map: drop any undefined value so Firestore never
    // receives an undefined (defensive — Firestore rejects undefined fields).
    const criteria: Record<string, unknown> = {};
    if (input.criteria && typeof input.criteria === 'object') {
      for (const [key, value] of Object.entries(input.criteria)) {
        if (value !== undefined) {
          criteria[key] = value;
        }
      }
    }

    // F113 — denormalise the transaction parties onto the log doc so the read
    // rule on automatic_decisions_log can authorise the buyer/seller WITHOUT a
    // per-row cross-collection get() at list time (the expensive path). Writes
    // are rare scheduled events, so one extra read here trades a frequent read
    // cost for a one-off write cost. Best-effort: a lookup miss never blocks the
    // log (the rule keeps a legacy get() fallback for docs missing these).
    let buyerId: string | null = null;
    let sellerId: string | null = null;
    try {
      const txSnap = await db.collection('transactions').doc(input.transactionId).get();
      if (txSnap.exists) {
        const tx = txSnap.data()!;
        buyerId = typeof tx.buyerId === 'string' ? tx.buyerId : null;
        sellerId = typeof tx.sellerId === 'string' ? tx.sellerId : null;
      }
    } catch {
      // ignore — denormalisation is best-effort, the rule falls back to get()
    }

    const ref = await db.collection('automatic_decisions_log').add({
      transactionId: input.transactionId,
      userId: input.userId,
      decisionType: input.decisionType,
      criteria,
      result: typeof input.result === 'string' ? input.result : '',
      buyerId,
      sellerId,
      executedAt: FieldValue.serverTimestamp(),
    });

    logger.info('[logAutomatedDecision] decision logged', {
      logId: ref.id,
      transactionId: input.transactionId,
      decisionType: input.decisionType,
    });
    return ref.id;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[logAutomatedDecision] failed to log decision', {
      transactionId: input.transactionId,
      decisionType: input.decisionType,
      error: message,
    });
    return null;
  }
}

/**
 * Assert the caller is a party (buyer or seller) to the transaction. Returns
 * the transaction snapshot data so the caller can reuse it. Throws HttpsError
 * (`not-found` / `permission-denied`) otherwise.
 */
async function assertPartyToTransaction(
  transactionId: string,
  uid: string,
): Promise<FirebaseFirestore.DocumentData> {
  const snap = await db.collection('transactions').doc(transactionId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Transaction introuvable');
  }
  const data = snap.data()!;
  if (data.buyerId !== uid && data.sellerId !== uid) {
    throw new HttpsError(
      'permission-denied',
      'Vous n\'êtes pas partie à cette transaction',
    );
  }
  return data;
}

/** A Troc is never a purchase transaction. Read the exact native receipt and
 * its linked explanation, without adopting a missing historical journal as
 * proof of no financial effect or recreating it from today's mutable source. */
async function readSwapFundReleaseLog(request: any, uid: string, swapId: string) {
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    return readNativeSwapFundReleaseLog(tx, uid, swapId);
  });
}

/**
 * contestAutomatedDecision — opens a HUMAN-REVIEW request against an automated
 * decision (Loi 25, art. 12.1 right to request human intervention).
 *
 * - Requires auth; the caller MUST be the buyer or seller of the transaction.
 * - Validates the decisionType against the known automated decisions.
 * - New requests use versioned `support_requests` and deterministic commands.
 *   Old `automated_decision_contestations` remain historical, without a new receipt.
 * - REVERSES NOTHING. The monetary state is untouched — a human agent decides
 *   the outcome out-of-band (via the existing admin tooling).
 */
export const contestAutomatedDecision = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    // Old type-only/random-id contestations remain historical. A fresh request
    // must bind the source actually read by this owner and use the same journal.
    if (request.data?.command?.action === 'submit' && request.data.command.kind !== 'automated_decision_review') {
      throw new HttpsError('invalid-argument', 'Une décision exacte doit être liée à cet examen.');
    }
    return executeSupportOwnerCommand(request);
  },
);

/**
 * getAutomatedDecisionLog — returns the transparent automated-decision log for
 * ONE transaction (Loi 25 right to an explanation).
 *
 * - Requires auth; the caller MUST be the buyer or seller of the transaction.
 * - Returns bounded recorded entries with source revision/hash and native pagination.
 *   This best-effort journal cannot certify that no financial decision occurred.
 */
export const getAutomatedDecisionLog = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
  return withPrivateAccountSession(request, async () => {
    const uid = supportUid(request);
    if (request.data?.operation === 'swap_fund_release') {
      const data = supportObject(request.data, ['operation', 'expectedUid', 'swapId']);
      return readSwapFundReleaseLog(request, uid, supportId(data.swapId, 'Troc'));
    }
    if (request.data?.operation === 'owner_admission_refusals') {
      const data = supportObject(request.data, ['operation', 'expectedUid', 'decisionId', 'cursor']);
      if (data.decisionId != null && data.cursor != null) throw new HttpsError('invalid-argument', 'Une référence exacte ou un curseur, pas les deux.');
      const base = { ok: true, protocol: 'owner_admission_refusals_v1', ownerId: uid,
        coverage: 'recorded_entries_only', absenceOfDecisionVerified: false, completeHistory: false,
        financialExecutionCoverageVerified: false, admissionGranted: false };
      if (data.decisionId != null) {
        const snap = await db.collection('automatic_decisions_log').doc(supportId(data.decisionId)).get();
        if (!snap.exists || snap.data()?.ownerId !== uid || snap.data()?.userId !== uid) throw new HttpsError('permission-denied', 'Référence privée non autorisée.');
        return { ...base, entries: [admissionDecisionView(snap)], hasMore: false, cursor: null, unknownEntries: 0, inspectedCount: 1 };
      }
      // Name order is explicit, bounded and stable. It is NOT chronology.
      let query = db.collection('automatic_decisions_log').where('ownerId', '==', uid).orderBy('__name__', 'desc').limit(21);
      if (data.cursor != null) {
        const cursor = await db.collection('automatic_decisions_log').doc(supportId(data.cursor, 'Curseur')).get();
        if (!cursor.exists || cursor.data()?.ownerId !== uid) throw new HttpsError('invalid-argument', 'Curseur étranger ou absent.');
        query = query.startAfter(cursor);
      }
      const snap = await query.get(), inspected = snap.docs.slice(0, 20), entries = [];
      let unknownEntries = 0;
      for (const row of inspected) {
        try { entries.push(admissionDecisionView(row)); }
        catch { unknownEntries++; }
      }
      return { ...base, entries, hasMore: snap.size > 20,
        cursor: snap.size > 20 ? inspected.at(-1)!.id : null, unknownEntries, inspectedCount: inspected.length };
    }
    const data = (request.data ?? {}) as { transactionId?: unknown; expectedUid?: unknown; cursor?: unknown };
    const transactionId = supportId(data.transactionId);

    // Party check.
    await assertPartyToTransaction(transactionId, uid);

    let query = db
      .collection('automatic_decisions_log')
      .where('transactionId', '==', transactionId)
      .orderBy('executedAt', 'desc')
      .orderBy('__name__', 'desc').limit(51);
    if (data.cursor != null) {
      const cursorId = supportId(data.cursor, 'Curseur');
      const cursor = await db.collection('automatic_decisions_log').doc(cursorId).get();
      if (!cursor.exists || cursor.data()?.transactionId !== transactionId) throw new HttpsError('invalid-argument', 'Curseur étranger ou absent.');
      query = query.startAfter(cursor);
    }
    const snap = await query.get(), rows = snap.docs.slice(0, 50), hasMore = snap.size > 50;
    const entries = rows.map(decisionView);
    return { ok: true as const, protocol: 'automated_decision_log_v1', ownerId: uid, transactionId, entries,
      count: entries.length, hasMore, cursor: hasMore ? rows.at(-1)!.id : null,
      coverage: 'recorded_entries_only', financialExecutionCoverageVerified: false,
      absenceOfDecisionVerified: false, completeHistory: false };

  });
},
);
