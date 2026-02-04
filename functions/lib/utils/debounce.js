"use strict";
/**
 * Debounce utility for batching updates
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.debounceUpdate = debounceUpdate;
exports.cancelDebouncedUpdate = cancelDebouncedUpdate;
// Use ReturnType for cross-platform compatibility
const updateQueues = new Map();
/**
 * Debounce an update function
 * Batches rapid updates to reduce database writes
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
            console.error(`Debounced update failed for ${key}:`, error);
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