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

import * as logger from 'firebase-functions/logger';

// Use ReturnType for cross-platform compatibility
const updateQueues = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Debounce a NON-CRITICAL update function.
 * Batches rapid updates to reduce database writes. Fire-and-forget: see the
 * module-level warning above — the scheduled write is best-effort and may be
 * dropped if the v2 instance is reclaimed before the timer fires.
 */
export function debounceUpdate(
  key: string,
  updateFn: () => Promise<void>,
  delay: number = 5000
): void {
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
    } catch (error) {
      console.error(`Debounced update failed for ${key}:`, error);
      updateQueues.delete(key);
    }
  }, delay);

  updateQueues.set(key, timeout);
}

/**
 * Cancel a pending debounced update
 */
export function cancelDebouncedUpdate(key: string): void {
  const existingTimeout = updateQueues.get(key);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    updateQueues.delete(key);
  }
}
