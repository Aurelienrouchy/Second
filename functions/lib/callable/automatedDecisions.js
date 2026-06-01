"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAutomatedDecisionLog = exports.contestAutomatedDecision = void 0;
exports.logAutomatedDecision = logAutomatedDecision;
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
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
const privacyIncidents_1 = require("./privacyIncidents");
const REGION = 'northamerica-northeast1';
const DECISION_TYPES = new Set([
    'funds_released',
    'transaction_expired',
    'label_refund',
]);
/**
 * Best-effort journalling of an automated decision. Writes one
 * `automatic_decisions_log/{id}` doc with a serverTimestamp. NEVER throws — it
 * is called from inside the scheduled monetary jobs AFTER the money has moved,
 * so a logging hiccup must never roll back or block a successful release/refund.
 *
 * Never writes `undefined` into Firestore (sanitises the criteria map; omits
 * absent values rather than passing undefined).
 */
async function logAutomatedDecision(input) {
    try {
        if (typeof input.transactionId !== 'string' ||
            input.transactionId.length === 0 ||
            typeof input.userId !== 'string' ||
            input.userId.length === 0 ||
            !DECISION_TYPES.has(input.decisionType)) {
            logger.warn('[logAutomatedDecision] invalid input — skipping', {
                transactionId: input.transactionId,
                decisionType: input.decisionType,
            });
            return null;
        }
        // Sanitise the criteria map: drop any undefined value so Firestore never
        // receives an undefined (defensive — Firestore rejects undefined fields).
        const criteria = {};
        if (input.criteria && typeof input.criteria === 'object') {
            for (const [key, value] of Object.entries(input.criteria)) {
                if (value !== undefined) {
                    criteria[key] = value;
                }
            }
        }
        const ref = await firebase_1.db.collection('automatic_decisions_log').add({
            transactionId: input.transactionId,
            userId: input.userId,
            decisionType: input.decisionType,
            criteria,
            result: typeof input.result === 'string' ? input.result : '',
            executedAt: firebase_1.FieldValue.serverTimestamp(),
        });
        logger.info('[logAutomatedDecision] decision logged', {
            logId: ref.id,
            transactionId: input.transactionId,
            decisionType: input.decisionType,
        });
        return ref.id;
    }
    catch (error) {
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
async function assertPartyToTransaction(transactionId, uid) {
    const snap = await firebase_1.db.collection('transactions').doc(transactionId).get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'Transaction introuvable');
    }
    const data = snap.data();
    if (data.buyerId !== uid && data.sellerId !== uid) {
        throw new https_1.HttpsError('permission-denied', 'Vous n\'êtes pas partie à cette transaction');
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
exports.contestAutomatedDecision = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = request.auth.uid;
    const data = ((_a = request.data) !== null && _a !== void 0 ? _a : {});
    if (typeof data.transactionId !== 'string' || data.transactionId.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'transactionId is required');
    }
    if (typeof data.decisionType !== 'string' ||
        !DECISION_TYPES.has(data.decisionType)) {
        throw new https_1.HttpsError('invalid-argument', 'invalid decisionType');
    }
    if (typeof data.reason !== 'string' || data.reason.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'reason is required');
    }
    const transactionId = data.transactionId.trim();
    const decisionType = data.decisionType;
    const reason = data.reason.trim().substring(0, 2000);
    // Party check (and grab tx data for the contestation snapshot).
    const txData = await assertPartyToTransaction(transactionId, uid);
    // Create the contestation doc. The monetary state is NOT touched.
    const ref = await firebase_1.db.collection('automated_decision_contestations').add({
        transactionId,
        userId: uid,
        buyerId: typeof txData.buyerId === 'string' ? txData.buyerId : null,
        sellerId: typeof txData.sellerId === 'string' ? txData.sellerId : null,
        decisionType,
        reason,
        status: 'open',
        createdAt: firebase_1.FieldValue.serverTimestamp(),
    });
    // Alert support/admins for human review (register entry + structured log).
    // recordPrivacyIncident never throws (best-effort).
    await (0, privacyIncidents_1.recordPrivacyIncident)({
        type: 'automated_decision_contestation',
        severity: 'low',
        description: `Contestation d'une décision automatisée (${decisionType}) ` +
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
    return { ok: true, contestationId: ref.id };
});
/**
 * getAutomatedDecisionLog — returns the transparent automated-decision log for
 * ONE transaction (Loi 25 right to an explanation).
 *
 * - Requires auth; the caller MUST be the buyer or seller of the transaction.
 * - Returns the entries with ISO-serialised dates and the human-readable
 *   criteria/result, sorted most-recent first.
 */
exports.getAutomatedDecisionLog = (0, https_1.onCall)({ region: REGION, memory: '512MiB' }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentification requise');
    }
    const uid = request.auth.uid;
    const data = ((_a = request.data) !== null && _a !== void 0 ? _a : {});
    if (typeof data.transactionId !== 'string' || data.transactionId.trim().length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'transactionId is required');
    }
    const transactionId = data.transactionId.trim();
    // Party check.
    await assertPartyToTransaction(transactionId, uid);
    const snap = await firebase_1.db
        .collection('automatic_decisions_log')
        .where('transactionId', '==', transactionId)
        .orderBy('executedAt', 'desc')
        .limit(50)
        .get();
    const entries = snap.docs.map((d) => {
        var _a, _b, _c, _d, _e;
        const e = d.data();
        const executedAt = e.executedAt;
        return {
            id: d.id,
            transactionId: (_a = e.transactionId) !== null && _a !== void 0 ? _a : null,
            userId: (_b = e.userId) !== null && _b !== void 0 ? _b : null,
            decisionType: (_c = e.decisionType) !== null && _c !== void 0 ? _c : null,
            criteria: (_d = e.criteria) !== null && _d !== void 0 ? _d : {},
            result: (_e = e.result) !== null && _e !== void 0 ? _e : '',
            executedAt: executedAt && typeof executedAt.toDate === 'function'
                ? executedAt.toDate().toISOString()
                : null,
        };
    });
    return { ok: true, transactionId, entries, count: entries.length };
});
//# sourceMappingURL=automatedDecisions.js.map