/**
 * Rate limiting utility for Cloud Functions
 * Firebase Functions v7
 *
 * Uses Firestore collection `rate_limits` with a sliding window approach.
 * Supports both authenticated (userId) and unauthenticated (IP-based) callers.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

interface RateLimitOptions {
  functionName: string;
  maxCallsAuthenticated: number;
  maxCallsUnauthenticated: number;
  windowMs: number;
}

/**
 * Check and enforce rate limit.
 * Throws HttpsError('resource-exhausted') if the limit is exceeded.
 *
 * @param callerKey - userId for authenticated, IP hash for unauthenticated
 * @param isAuthenticated - whether the caller is authenticated
 * @param options - rate limit configuration
 */
export async function checkRateLimit(
  callerKey: string,
  isAuthenticated: boolean,
  options: RateLimitOptions
): Promise<void> {
  const maxCalls = isAuthenticated
    ? options.maxCallsAuthenticated
    : options.maxCallsUnauthenticated;

  const docId = `${callerKey}_${options.functionName}`;
  const rateLimitRef = db.collection('rate_limits').doc(docId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateLimitRef);
    const now = Date.now();
    const windowStart = now - options.windowMs;

    if (snap.exists) {
      const data = snap.data()!;
      const windowStartedAt =
        data.windowStartedAt?.toMillis?.() ?? data.windowStartedAt ?? 0;
      const count = data.count ?? 0;

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
          throw new HttpsError(
            'resource-exhausted',
            `Limite atteinte : maximum ${maxCalls} requetes par minute. Reessayez plus tard.`
          );
        }
        tx.update(rateLimitRef, { count: FieldValue.increment(1) });
      } else {
        // Window expired, reset
        tx.set(rateLimitRef, {
          callerKey,
          count: 1,
          windowStartedAt: FieldValue.serverTimestamp(),
        });
      }
    } else {
      // First call ever
      tx.set(rateLimitRef, {
        callerKey,
        count: 1,
        windowStartedAt: FieldValue.serverTimestamp(),
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
export function resolveCallerKey(request: any): {
  callerKey: string;
  isAuthenticated: boolean;
} {
  if (request.auth?.uid) {
    return { callerKey: request.auth.uid, isAuthenticated: true };
  }

  // Unauthenticated: use IP address
  const rawReq = request.rawRequest;
  const forwarded = rawReq?.headers?.['x-forwarded-for'];
  const ip =
    (typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : undefined) ||
    rawReq?.ip ||
    'unknown';

  // Simple hash to avoid storing raw IPs
  const callerKey = `ip_${simpleHash(ip)}`;
  return { callerKey, isAuthenticated: false };
}

/**
 * Simple non-cryptographic hash for IP addresses.
 * Not meant for security, just to avoid storing raw IPs in Firestore.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
