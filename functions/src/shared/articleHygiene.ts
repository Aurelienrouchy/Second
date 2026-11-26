import { findCategoryById, getCategoryPath } from './categories';

/** Seller statements, never an inference from the listing condition or AI. */
export type ArticleHygieneDeclarationInput =
  | { schemaVersion: 1; kind: 'underwear'; neverWorn: true }
  | { schemaVersion: 1; kind: 'cosmetic'; isNew: true; isSealed: true }
  | { schemaVersion: 1; kind: 'not_applicable' };
export type ArticleHygieneRequirement = 'invalid' | 'none' | 'underwear' | 'cosmetic' | 'mixed_underwear' | 'mixed_cosmetic';

const UNDERWEAR = new Set([
  'women_clothing_lingerie_bras', 'women_clothing_lingerie_panties', 'women_clothing_lingerie_sets',
  'women_clothing_lingerie_shapewear', 'women_clothing_maternity_underwear_general',
  'women_clothing_maternity_underwear_nursing', 'women_clothing_sport_bras',
  'men_clothing_underwear_underwear', 'kids_girls_underwear_panties', 'kids_boys_underwear_briefs',
]);
const COSMETICS = new Set([
  'women_beauty_makeup', 'women_beauty_perfume', 'women_beauty_skincare', 'women_beauty_handcare',
  'women_beauty_bodycare', 'women_beauty_haircare', 'kids_nursery_bathing_hygiene_skincare',
]);
const MIXED_UNDERWEAR = new Set(['women_clothing_lingerie_other', 'men_clothing_underwear_other',
  'kids_girls_underwear_other', 'kids_boys_underwear_other']);
const MIXED_COSMETICS = new Set(['women_beauty_manicure', 'women_beauty_other', 'kids_nursery_bathing_hygiene_wipes']);

/** A fabricated chain or a broad parent cannot bypass a hygiene leaf. */
export function articleHygieneRequirement(categoryIds: unknown): ArticleHygieneRequirement {
  if (!Array.isArray(categoryIds) || !categoryIds.length || categoryIds.some(id => typeof id !== 'string')) return 'invalid';
  const leafId = categoryIds[categoryIds.length - 1];
  const node = findCategoryById(leafId), path = getCategoryPath(leafId);
  if (!node || node.children?.length || !path || path.length !== categoryIds.length
      || path.some((id, index) => id !== categoryIds[index])) return 'invalid';
  if (UNDERWEAR.has(leafId)) return 'underwear';
  if (COSMETICS.has(leafId)) return 'cosmetic';
  if (MIXED_UNDERWEAR.has(leafId)) return 'mixed_underwear';
  if (MIXED_COSMETICS.has(leafId)) return 'mixed_cosmetic';
  return 'none';
}

export interface ArticleHygieneDecision {
  allowed: boolean; reason: string | null; message: string | null; declaration: ArticleHygieneDeclarationInput | null;
}
function hasStoredDeclarationTimestamp(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  // Firestore Web/Admin timestamps and their callable wire representation.
  const seconds = value.seconds ?? value._seconds, nanos = value.nanoseconds ?? value._nanoseconds;
  return Number.isSafeInteger(seconds) && (seconds as number) > 0
    && Number.isSafeInteger(nanos) && (nanos as number) >= 0 && (nanos as number) < 1_000_000_000;
}
/** Stored witness projection usable by the app; timestamp authority is checked
 * again server-side. A client never manufactures these witness fields. */
export function articleHygieneInputFromStored(categoryIds: unknown, sellerId: unknown, raw: unknown): ArticleHygieneDeclarationInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof sellerId !== 'string' || !sellerId || value.declaredBy !== sellerId
      || !Array.isArray(categoryIds) || !Array.isArray(value.categoryIds)
      || value.categoryIds.length !== categoryIds.length || value.categoryIds.some((id, i) => id !== categoryIds[i])
      || !hasStoredDeclarationTimestamp(value.declaredAt)) return null;
  const inputKeys = value.kind === 'underwear' ? ['schemaVersion', 'kind', 'neverWorn']
    : value.kind === 'cosmetic' ? ['schemaVersion', 'kind', 'isNew', 'isSealed'] : ['schemaVersion', 'kind'];
  if (Object.keys(value).some(key => ![...inputKeys, 'declaredBy', 'declaredAt', 'categoryIds'].includes(key))) return null;
  const input = Object.fromEntries(inputKeys.map(key => [key, value[key]]));
  // Conditions are validated separately against the actual article, never
  // inferred here. "neuf" merely exercises the statement shape parser.
  const parsed = evaluateArticleHygieneInput(categoryIds, 'neuf', input);
  return parsed.allowed ? parsed.declaration : null;
}
const refused = (reason: string, message: string): ArticleHygieneDecision => ({ allowed: false, reason, message, declaration: null });

/** Client input excludes server authorship, dates and category witnesses. */
export function evaluateArticleHygieneInput(categoryIds: unknown, condition: unknown, input: unknown): ArticleHygieneDecision {
  const requirement = articleHygieneRequirement(categoryIds);
  if (requirement === 'invalid') return refused('article_hygiene_category_invalid', 'Choisissez une catégorie précise et complète avant de confirmer la règle d’hygiène.');
  if (requirement === 'none') return input == null
    ? { allowed: true, reason: null, message: null, declaration: null }
    : refused('article_hygiene_category_mismatch', 'La déclaration d’hygiène ne correspond plus à la catégorie. Confirmez la nature de l’article après ce changement.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) return refused('article_hygiene_declaration_required',
    'Le vendeur doit confirmer la nature et la règle d’hygiène de cet article avant une nouvelle opération.');
  const value = input as Record<string, unknown>;
  const keys = value.kind === 'underwear' ? ['schemaVersion', 'kind', 'neverWorn']
    : value.kind === 'cosmetic' ? ['schemaVersion', 'kind', 'isNew', 'isSealed'] : ['schemaVersion', 'kind'];
  if (value.schemaVersion !== 1 || Object.keys(value).some(key => !keys.includes(key))) return refused('article_hygiene_declaration_invalid', 'La déclaration d’hygiène doit être confirmée à nouveau par le vendeur.');
  if (value.kind === 'not_applicable' && requirement.startsWith('mixed_')) {
    return { allowed: true, reason: null, message: null, declaration: { schemaVersion: 1, kind: 'not_applicable' } };
  }
  if (value.kind === 'underwear' && (requirement === 'underwear' || requirement === 'mixed_underwear')) {
    if (value.neverWorn !== true) return refused('article_underwear_never_worn_required', 'Seuls les sous-vêtements jamais portés sont admis.');
    if (condition !== 'neuf' && condition !== 'neuf sans étiquette') return refused('article_hygiene_condition_conflict', 'L’état indiqué contredit la déclaration « sous-vêtement jamais porté ». Corrigez les renseignements.');
    return { allowed: true, reason: null, message: null, declaration: { schemaVersion: 1, kind: 'underwear', neverWorn: true } };
  }
  if (value.kind === 'cosmetic' && (requirement === 'cosmetic' || requirement === 'mixed_cosmetic')) {
    if (value.isNew !== true || value.isSealed !== true) return refused('article_cosmetic_new_sealed_required', 'Seuls les cosmétiques neufs encore scellés sont admis.');
    if (condition !== 'neuf' && condition !== 'neuf sans étiquette') return refused('article_hygiene_condition_conflict', 'L’état indiqué contredit la déclaration « cosmétique neuf encore scellé ». Corrigez les renseignements.');
    return { allowed: true, reason: null, message: null, declaration: { schemaVersion: 1, kind: 'cosmetic', isNew: true, isSealed: true } };
  }
  return refused('article_hygiene_nature_required', requirement.startsWith('mixed_')
    ? 'Précisez si cet article est concerné par la règle d’hygiène ou s’il est d’une autre nature.'
    : 'La nature déclarée ne correspond pas à la catégorie de cet article.');
}
