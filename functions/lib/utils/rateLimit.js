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
exports.checkRateLimit = checkRateLimit;
exports.resolveCallerKey = resolveCallerKey;
/**
 * Rate limiting utility for Cloud Functions
 * Firebase Functions v7
 *
 * Uses Firestore collection `rate_limits` with a sliding window approach.
 * Supports both authenticated (userId) and unauthenticated (IP-based) callers.
 */
const https_1 = require("firebase-functions/v2/https");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
/**
 * Check and enforce rate limit.
 * Throws HttpsError('resource-exhausted') if the limit is exceeded.
 *
 * @param callerKey - userId for authenticated, IP hash for unauthenticated
 * @param isAuthenticated - whether the caller is authenticated
 * @param options - rate limit configuration
 */
async function checkRateLimit(callerKey, isAuthenticated, options) {
    const maxCalls = isAuthenticated
        ? options.maxCallsAuthenticated
        : options.maxCallsUnauthenticated;
    const docId = `${callerKey}_${options.functionName}`;
    const rateLimitRef = firebase_1.db.collection('rate_limits').doc(docId);
    await firebase_1.db.runTransaction(async (tx) => {
        var _a, _b, _c, _d, _e;
        const snap = await tx.get(rateLimitRef);
        const now = Date.now();
        const windowStart = now - options.windowMs;
        if (snap.exists) {
            const data = snap.data();
            const windowStartedAt = (_d = (_c = (_b = (_a = data.windowStartedAt) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : data.windowStartedAt) !== null && _d !== void 0 ? _d : 0;
            const count = (_e = data.count) !== null && _e !== void 0 ? _e : 0;
            if (windowStartedAt > windowStart) {
                // Still within the current window
                if (count >= maxCalls) {
                    logger.warn('[rateLimit] Rate limit exceeded', {
                        callerKey,
                        functionName: options.functionName,
                        count,
                        maxCalls,
                        isAuthenticated,
                    });
                    throw new https_1.HttpsError('resource-exhausted', `Limite atteinte : maximum ${maxCalls} requetes par minute. Reessayez plus tard.`);
                }
                tx.update(rateLimitRef, { count: firebase_1.FieldValue.increment(1) });
            }
            else {
                // Window expired, reset
                tx.set(rateLimitRef, {
                    callerKey,
                    count: 1,
                    windowStartedAt: firebase_1.FieldValue.serverTimestamp(),
                });
            }
        }
        else {
            // First call ever
            tx.set(rateLimitRef, {
                callerKey,
                count: 1,
                windowStartedAt: firebase_1.FieldValue.serverTimestamp(),
            });
        }
    });
}
/**
 * Resolve a caller key from the request context.
 * Returns { callerKey, isAuthenticated }.
 *
 * For authenticated users: uses uid.
 * For unauthenticated: uses rawRequest IP (hashed for privacy).
 */
function resolveCallerKey(request) {
    var _a, _b, _c;
    if ((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) {
        return { callerKey: request.auth.uid, isAuthenticated: true };
    }
    // Unauthenticated: use IP address
    const rawReq = request.rawRequest;
    const forwarded = (_b = rawReq === null || rawReq === void 0 ? void 0 : rawReq.headers) === null || _b === void 0 ? void 0 : _b['x-forwarded-for'];
    const ip = (typeof forwarded === 'string'
        ? (_c = forwarded.split(',')[0]) === null || _c === void 0 ? void 0 : _c.trim()
        : undefined) ||
        (rawReq === null || rawReq === void 0 ? void 0 : rawReq.ip) ||
        'unknown';
    // Simple hash to avoid storing raw IPs
    const callerKey = `ip_${simpleHash(ip)}`;
    return { callerKey, isAuthenticated: false };
}
/**
 * Simple non-cryptographic hash for IP addresses.
 * Not meant for security, just to avoid storing raw IPs in Firestore.
 */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
}
//# sourceMappingURL=rateLimit.js.map