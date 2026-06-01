/**
 * ImmersiveOverlay animation constants
 *
 * Timing values shared between the overlay, gradient, and warp layers.
 */

/** Duration (ms) for the overlay entrance animation */
export const ENTERING_TIME = 750;

/** Duration (ms) for the overlay exit animation */
export const EXITING_TIME = 500;

/**
 * Delay (ms) before the overlay content (e.g. the sell camera) starts its
 * fade-in. Anchored to ENTERING_TIME so the content waits for the entrance
 * gradient + blurred circles to finish their animation, then fades in cleanly.
 */
export const CONTENT_REVEAL_DELAY = ENTERING_TIME;

/** Duration (ms) of the content fade-in once it is revealed. */
export const CONTENT_REVEAL_TIME = 420;

/**
 * DS-aligned palette for the overlay gradients.
 * Charcoal button → Cream/Sand/Warm white (app signature tones).
 */
export const OVERLAY_COLORS = {
  /** Sand — warm neutral */
  primary: '#D4C4A0',
  /** Cream — app signature background */
  secondary: '#F5F0E8',
  /** Expanding circle gradient stops (charcoal center → cream edge) */
  expanding: {
    start: '#1A1814',                // Charcoal (matches the "+" button)
    mid: '#D4C4A0',                  // Sand
    end: 'rgba(245,240,232,0.85)',   // Cream semi-transparent
  },
  /** Base fill behind everything */
  fill: '#FAF8F4',                   // Warm white (app background)
} as const;
