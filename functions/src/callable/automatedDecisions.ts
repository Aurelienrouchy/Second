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
 * THIS MODULE IS PURELY ADDITIVE. It never moves money and never touches the
 * existing runTransaction monetary logic of the scheduled jobs:
 *   - logAutomatedDecision()  — best-effort journalling helper called AFTER the
 *                               monetary move succeeds. Never throws.
 *   - contestAutomatedDecision — lets a party open a human-review request. It
 *                               records a contestation doc + alerts admins. It
 *                               REVERSES NOTHING automatically (human decides).
 *   - getAutomatedDecisionLog  — lets a party read the transparent log for one
 *                               of their transactions (ISO-serialised dates).
 *
 * COLLECTIONS:
 *   - automatic_decisions_log/{id}            — server-written audit log.
 *   - automated_decision_contestations/{id}   — human-review requests.
 *     (We do NOT reuse `disputes`: that collection is purpose-built for the
 *      buyer "delivered but problem" flow which FREEZES the funds — an automated-
 *      decision contestation must NOT freeze anything, so it lives apart to keep
 *      the dispute-freeze invariant clean.)
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { recordPrivacyIncident } from './privacyIncidents';

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
 * Best-effort journalling of an automated decision. Writes one
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

    const ref = await db.collection('automatic_decisions_log').add({
      transactionId: input.transactionId,
      userId: input.userId,
      decisionType: input.decisionType,
      criteria,
      result: typeof input.result === 'string' ? input.result : '',
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

/**
 * contestAutomatedDecision — opens a HUMAN-REVIEW request against an automated
 * decision (Loi 25, art. 12.1 right to request human intervention).
 *
 * - Requires auth; the caller MUST be the buyer or seller of the transaction.
 * - Validates the decisionType against the known automated decisions.
 * - Creates an `automated_decision_contestations/{id}` doc (status 'open').
 * - Alerts the support/admin team via recordPrivacyIncident (a low-severity
 *   register entry that the on-call dashboard ingests) + a structured warn log.
 * - REVERSES NOTHING. The monetary state is untouched — a human agent decides
 *   the outcome out-of-band (via the existing admin tooling).
 */
export const contestAutomatedDecision = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = request.auth.uid;

    const data = (request.data ?? {}) as {
      transactionId?: unknown;
      decisionType?: unknown;
      reason?: unknown;
    };

    if (typeof data.transactionId !== 'string' || data.transactionId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'transactionId is required');
    }
    if (
      typeof data.decisionType !== 'string' ||
      !DECISION_TYPES.has(data.decisionType as AutomatedDecisionType)
    ) {
      throw new HttpsError('invalid-argument', 'invalid decisionType');
    }
    if (typeof data.reason !== 'string' || data.reason.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'reason is required');
    }

    const transactionId = data.transactionId.trim();
    const decisionType = data.decisionType as AutomatedDecisionType;
    const reason = data.reason.trim().substring(0, 2000);

    // Party check (and grab tx data for the contestation snapshot).
    const txData = await assertPartyToTransaction(transactionId, uid);

    // Create the contestation doc. The monetary state is NOT touched.
    const ref = await db.collection('automated_decision_contestations').add({
      transactionId,
      userId: uid,
      buyerId: typeof txData.buyerId === 'string' ? txData.buyerId : null,
      sellerId: typeof txData.sellerId === 'string' ? txData.sellerId : null,
      decisionType,
      reason,
      status: 'open',
      createdAt: FieldValue.serverTimestamp(),
    });

    // Alert support/admins for human review (register entry + structured log).
    // recordPrivacyIncident never throws (best-effort).
    await recordPrivacyIncident({
      type: 'automated_decision_contestation',
      severity: 'low',
      description:
        `Contestation d'une décision automatisée (${decisionType}) ` +
        `sur la transaction ${transactionId} par l'utilisateur ${uid}.`,
      affectedUserIds: [uid],
      affectedDataFields: ['transactionId', 'decisionType'],
      status: 'open',
    });

    logger.warn('ADMIN_REVIEW — automated decision contested', {
      contestationId: ref.id,
      transactionId,
      decisionType,
      userId: uid,
    });

    return { ok: true as const, contestationId: ref.id };
  },
);

/**
 * getAutomatedDecisionLog — returns the transparent automated-decision log for
 * ONE transaction (Loi 25 right to an explanation).
 *
 * - Requires auth; the caller MUST be the buyer or seller of the transaction.
 * - Returns the entries with ISO-serialised dates and the human-readable
 *   criteria/result, sorted most-recent first.
 */
export const getAutomatedDecisionLog = onCall(
  { region: REGION, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = request.auth.uid;

    const data = (request.data ?? {}) as { transactionId?: unknown };
    if (typeof data.transactionId !== 'string' || data.transactionId.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'transactionId is required');
    }
    const transactionId = data.transactionId.trim();

    // Party check.
    await assertPartyToTransaction(transactionId, uid);

    const snap = await db
      .collection('automatic_decisions_log')
      .where('transactionId', '==', transactionId)
      .orderBy('executedAt', 'desc')
      .limit(50)
      .get();

    const entries = snap.docs.map((d) => {
      const e = d.data();
      const executedAt = e.executedAt;
      return {
        id: d.id,
        transactionId: e.transactionId ?? null,
        userId: e.userId ?? null,
        decisionType: e.decisionType ?? null,
        criteria: e.criteria ?? {},
        result: e.result ?? '',
        executedAt:
          executedAt && typeof executedAt.toDate === 'function'
            ? executedAt.toDate().toISOString()
            : null,
      };
    });

    return { ok: true as const, transactionId, entries, count: entries.length };
  },
);
