/**
 * Debounce utility for batching updates
 */

// Use ReturnType for cross-platform compatibility
const updateQueues = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Debounce an update function
 * Batches rapid updates to reduce database writes
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
