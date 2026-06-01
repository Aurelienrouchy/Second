/**
 * Shared article types for the functions build.
 *
 * Mirrors the app-side `ArticleSize` contract (`@/types`). The functions
 * package is built separately, so we redefine the equivalent shape locally.
 */

/** Sizing system used by a clothing/footwear size. */
export type SizeSystem = 'US' | 'EU';

/**
 * Article size stored in Firestore. Both `articles.size` and
 * `search_index.size` use this shape (or `null` when unset).
 */
export interface ArticleSize {
  value: string;
  system: SizeSystem;
}

const VALID_SYSTEMS: readonly SizeSystem[] = ['US', 'EU'];
const MAX_SIZE_VALUE_LENGTH = 50;

function isSizeSystem(v: unknown): v is SizeSystem {
  return typeof v === 'string' && (VALID_SYSTEMS as readonly string[]).includes(v);
}

/**
 * Sanitise a raw `size` input (from a callable payload) into a storable value.
 *
 * Returns:
 *  - an `ArticleSize` object when the input is a valid object `{ value, system }`
 *    or a legacy non-empty string (back-compat → defaults to `system: 'EU'`);
 *  - `null` when the caller explicitly passes `null` (field erasure);
 *  - `undefined` when there is nothing to write (empty / malformed input) — the
 *    caller MUST omit the field in that case (never write `undefined`).
 *
 * The `value` is trimmed and truncated to 50 chars. Empty values yield
 * `undefined` (omit), never an object with an empty value.
 */
export function sanitizeArticleSize(
  raw: unknown,
): ArticleSize | null | undefined {
  // Explicit erasure.
  if (raw === null) return null;

  // New contract: object { value, system }.
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const value = typeof obj.value === 'string' ? obj.value.trim() : '';
    if (value.length === 0) return undefined;
    const system: SizeSystem = isSizeSystem(obj.system) ? obj.system : 'EU';
    return { value: value.substring(0, MAX_SIZE_VALUE_LENGTH), system };
  }

  // Back-compat: legacy plain string from an old client → default to EU.
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return undefined;
    return { value: trimmed.substring(0, MAX_SIZE_VALUE_LENGTH), system: 'EU' };
  }

  // number / undefined / anything else → nothing to write.
  return undefined;
}
