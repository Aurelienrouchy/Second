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

/** Same < 1e-7 cents tolerance as the canonical purchase calculation. This
 * validates only: callers persist the declared value, never round it to fit. */
export function isValidArticlePrice(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.01 || value > 10000) return false;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < 1e-7;
}

/** Missing fields on an old article mean undeclared, never "no known defect". */
export interface ArticleDefectDisclosure {
  hasKnownDefects: boolean;
  defectsDescription: string | null;
}

/** null is an explicit "unknown" choice; an absent legacy field is undeclared. */
export interface ArticleAlterationDisclosure {
  hasAlterations: boolean | null;
  alterationsDescription: string | null;
}

/** Same HTML cleaning as article text, with no truncation of a disclosure. */
function disclosureText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/<\/?[a-zA-Z][^>]*>/g, '').trim();
  return text.length > 0 && text.length <= 2000 ? text : null;
}

export function parseArticleDefectDisclosure(raw: Record<string, unknown>): ArticleDefectDisclosure | null {
  if (typeof raw.hasKnownDefects !== 'boolean' || !Object.prototype.hasOwnProperty.call(raw, 'defectsDescription')) return null;
  if (raw.hasKnownDefects === false) {
    return raw.defectsDescription === null ? { hasKnownDefects: false, defectsDescription: null } : null;
  }
  const text = disclosureText(raw.defectsDescription);
  return text ? { hasKnownDefects: true, defectsDescription: text } : null;
}

export function parseArticleAlterationDisclosure(raw: Record<string, unknown>): ArticleAlterationDisclosure | null {
  if (!Object.prototype.hasOwnProperty.call(raw, 'hasAlterations')
      || !Object.prototype.hasOwnProperty.call(raw, 'alterationsDescription')
      || (typeof raw.hasAlterations !== 'boolean' && raw.hasAlterations !== null)) return null;
  if (raw.hasAlterations !== true) {
    return raw.alterationsDescription === null
      ? { hasAlterations: raw.hasAlterations, alterationsDescription: null }
      : null;
  }
  const text = disclosureText(raw.alterationsDescription);
  return text ? { hasAlterations: true, alterationsDescription: text } : null;
}

/** Seller declaration; an absent status on a legacy article stays undeclared. */
export const ARTICLE_BRAND_STATUSES = ['known', 'unbranded', 'unknown'] as const;
export type ArticleBrandStatus = typeof ARTICLE_BRAND_STATUSES[number];

/** Absence on a legacy listing is compatible, never proof of human review.
 * Unknown explicit statuses fail closed until an operator examines them. */
export function isArticleModerationRestricted(article: { moderationStatus?: unknown }): boolean {
  return article.moderationStatus != null && article.moderationStatus !== 'approved';
}

/** New-publication requirement based on the declared category. Accessories
 * and non-clothing categories never need a fabricated "Unique" size. */
export function articleRequiresSize(categoryIds: readonly string[]): boolean {
  const categoryId = categoryIds.at(-1) ?? '';
  if (/(?:^|_)(?:accessories|bags|jewelry)(?:_|$)/.test(categoryId)) return false;
  return /^(?:women|men)_(?:clothing|shoes)(?:_|$)/.test(categoryId)
    || /^kids_(?:girls|boys)(?:_|$)/.test(categoryId);
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

/**
 * Statuts pour lesquels une transaction est encore « en cours » sur l'article.
 * Tant qu'il en existe une, `isSold` est un VERROU (une réservation), pas une
 * vente conclue.
 */
export const ARTICLE_BLOCKING_TX_STATUSES = [
  'pending_payment',
  'meetup_pending',
  'meetup_confirmed',
  'paid',
  'label_created',
  'shipped',
  'delivered',
  'return_requested',
  'delivery_failed',
  'lost',
  'disputed',
  'refund_in_progress',
  'refund_action_required',
];
