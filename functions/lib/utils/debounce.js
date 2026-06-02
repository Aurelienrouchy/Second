"use strict";
/**
 * Debounce utility for batching updates.
 *
 * WARNING — NON-CRITICAL UPDATES ONLY.
 * debounceUpdate schedules `updateFn` with a fire-and-forget `setTimeout` and
 * returns immediately (no await). On Cloud Functions v2 (Cloud Run) the
 * instance can be frozen or terminated as soon as the handler returns, so the
 * timer is NOT guaranteed to fire and the update may silently never run.
 *
 * Use this ONLY for best-effort, idempotent writes that are safe to lose
 * occasionally (e.g. batching frequent metric updates like views / likes /
 * popularity / denormalized stats).
 *
 * Do NOT use for critical writes — initial document creation, financial
 * mutations, status transitions, or anything an invariant depends on. Those
 * must be awaited directly inside the handler (see triggers/products.ts which
 * awaits the initial search-index write and only debounces later metric
 * updates).
 */
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
exports.debounceUpdate = debounceUpdate;
exports.cancelDebouncedUpdate = cancelDebouncedUpdate;
const logger = __importStar(require("firebase-functions/logger"));
// Use ReturnType for cross-platform compatibility
const updateQueues = new Map();
/**
 * Debounce a NON-CRITICAL update function.
 * Batches rapid updates to reduce database writes. Fire-and-forget: see the
 * module-level warning above — the scheduled write is best-effort and may be
 * dropped if the v2 instance is reclaimed before the timer fires.
 */
function debounceUpdate(key, updateFn, delay = 5000) {
    // Clear existing timeout
    const existingTimeout = updateQueues.get(key);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }
    // Set new timeout
    const timeout = setTimeout(async () => {
        try {
            await updateFn();
            updateQueues.delete(key);
        }
        catch (error) {
            logger.error(`Debounced update failed for ${key}`, { error });
            updateQueues.delete(key);
        }
    }, delay);
    updateQueues.set(key, timeout);
}
/**
 * Cancel a pending debounced update
 */
function cancelDebouncedUpdate(key) {
    const existingTimeout = updateQueues.get(key);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
        updateQueues.delete(key);
    }
}
//# sourceMappingURL=debounce.js.map