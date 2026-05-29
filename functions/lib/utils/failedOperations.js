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
exports.writeFailedOperation = writeFailedOperation;
/**
 * Dead-letter queue helper — `failed_operations` collection (P1 ops resilience)
 *
 * WHY
 * ---
 * Every critical money/shipping side-effect (Stripe refund, transfer reversal,
 * payout reversal, ShipEngine label, webhook amount mismatch) can fail AFTER the
 * point of no return. Previously such failures were only logged ("CRITICAL:
 * manual reconciliation needed") and silently lost. This module persists each
 * failure as a replayable dead-letter doc so `retryFailedOperations` (scheduled,
 * every 30 min) can re-drive it with backoff, and a log-based alert can fire on
 * `CRITICAL`.
 *
 * CANONICAL SCHEMA (collection `failed_operations`)
 * -------------------------------------------------
 *   type        FailedOperationType  — discriminates the replay handler
 *   refId       string               — the primary entity id (transactionId,
 *                                       withdrawalRequestId, swapId, eventId…)
 *   payload     Record<string,any>   — everything the replay handler needs
 *                                       (paymentIntentId, transferId, amounts…)
 *   error       string               — last error message
 *   attempts    number               — replay attempts so far (starts at 0)
 *   status      'pending'|'resolved'|'exhausted'
 *   createdAt   serverTimestamp
 *   lastTriedAt serverTimestamp | null
 *
 * Backwards compatibility: earlier chantiers wrote a leaner shape
 * (`type`, `transactionId`, `paymentIntentId`, `reason`, `status:'pending'`).
 * The retry job normalizes those legacy docs (transactionId→refId, reason→error)
 * before dispatching, so both shapes are replayable.
 *
 * IMPORTANT: writing a dead-letter doc is ALWAYS best-effort and NEVER throws —
 * losing the doc must not abort the caller's primary flow.
 */
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/**
 * Persist a replayable dead-letter doc. Best-effort: swallows its own errors so
 * it can be safely called from any catch block without masking the original
 * failure. Returns the created doc id (or null if the write itself failed).
 */
async function writeFailedOperation(input) {
    var _a;
    const errorMessage = input.error instanceof Error
        ? input.error.message
        : typeof input.error === 'string'
            ? input.error
            : input.error != null
                ? String(input.error)
                : 'unknown_error';
    try {
        const ref = await firebase_1.db.collection('failed_operations').add({
            type: input.type,
            refId: input.refId,
            payload: (_a = input.payload) !== null && _a !== void 0 ? _a : {},
            error: errorMessage,
            attempts: 0,
            status: 'pending',
            createdAt: firebase_1.FieldValue.serverTimestamp(),
            lastTriedAt: null,
        });
        logger.warn('[failedOperations] dead-letter recorded', {
            failedOperationId: ref.id,
            type: input.type,
            refId: input.refId,
        });
        return ref.id;
    }
    catch (dlErr) {
        // Never throw — the caller's primary flow must not depend on this.
        logger.error('CRITICAL [failedOperations] could not write dead-letter doc', {
            type: input.type,
            refId: input.refId,
            originalError: errorMessage,
            writeError: dlErr instanceof Error ? dlErr.message : dlErr,
        });
        return null;
    }
}
//# sourceMappingURL=failedOperations.js.map