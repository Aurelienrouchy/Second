import { findCategoryById, getCategoryPath } from './categories';

/** Documentary seller observations. None of these values certifies a garment. */
export interface ArticleChildSafetyDeclarationInput {
  protocol: 'article_child_safety_statement_v1';
  intendedUse: 'daywear_only' | 'sleep_or_related' | 'unknown';
  labelStatus: 'readable' | 'missing' | 'unknown';
  labelText: string | null;
  sleepwearStyle: 'tight_fitting_claimed' | 'loose_fitting_claimed' | 'unknown' | null;
  safetyConcern: 'none_observed' | 'observed' | 'unknown';
  observation: string | null;
}
export const CHILD_SAFETY_INPUT_FIELDS = ['protocol', 'intendedUse', 'labelStatus', 'labelText', 'sleepwearStyle', 'safetyConcern', 'observation'] as const;
const SLEEPWEAR = new Set(['kids_girls_baby_sleepers', 'kids_boys_baby_sleepers',
  'kids_girls_sleepwear_onepiece', 'kids_girls_sleepwear_twopiece', 'kids_girls_sleepwear_nightgowns',
  'kids_boys_sleepwear_onepiece', 'kids_boys_sleepwear_twopiece',
  'kids_nursery_sleep_sleepbags', 'kids_nursery_sleep_sleepingsacks', 'kids_nursery_sleep_swaddles']);
export type ChildSafetyCategory = 'invalid' | 'not_child_clothing' | 'child_clothing' | 'canonical_sleepwear';
/** Real canonical leaves only; descriptions, images and age labels are not classifiers. */
export function childSafetyCategory(categoryIds: unknown): ChildSafetyCategory {
  if (!Array.isArray(categoryIds) || !categoryIds.length || categoryIds.some(id => typeof id !== 'string')) return 'invalid';
  const leaf = categoryIds[categoryIds.length - 1], node = findCategoryById(leaf), path = getCategoryPath(leaf);
  if (!node || node.children?.length || !path || path.length !== categoryIds.length || path.some((id, i) => id !== categoryIds[i])) return 'invalid';
  if (SLEEPWEAR.has(leaf)) return 'canonical_sleepwear';
  if ((path.includes('kids_girls') || path.includes('kids_boys')) && !path.includes('kids_girls_shoes') && !path.includes('kids_boys_shoes')) return 'child_clothing';
  return 'not_child_clothing';
}
export function parseChildSafetyDeclaration(raw: unknown): ArticleChildSafetyDeclarationInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== [...CHILD_SAFETY_INPUT_FIELDS].sort().join(',')) return null;
  const d = raw as Record<string, unknown>;
  if (d.protocol !== 'article_child_safety_statement_v1' || !['daywear_only', 'sleep_or_related', 'unknown'].includes(d.intendedUse as string) ||
      !['readable', 'missing', 'unknown'].includes(d.labelStatus as string) || !['none_observed', 'observed', 'unknown'].includes(d.safetyConcern as string) ||
      !(d.sleepwearStyle === null || ['tight_fitting_claimed', 'loose_fitting_claimed', 'unknown'].includes(d.sleepwearStyle as string))) return null;
  const text = (v: unknown): string | null => typeof v === 'string' && v.length <= 2000 && v.trim() ? v.trim() : null;
  const labelText = text(d.labelText), observation = text(d.observation);
  if (d.labelStatus === 'readable' ? !labelText : d.labelText !== null) return null;
  if (d.safetyConcern === 'observed' ? !observation : d.observation !== null && !observation) return null;
  if (d.safetyConcern === 'none_observed' && d.observation !== null) return null;
  if (d.intendedUse === 'sleep_or_related' && d.sleepwearStyle === null) return null;
  return { protocol: 'article_child_safety_statement_v1', intendedUse: d.intendedUse as ArticleChildSafetyDeclarationInput['intendedUse'],
    labelStatus: d.labelStatus as ArticleChildSafetyDeclarationInput['labelStatus'], labelText,
    sleepwearStyle: d.sleepwearStyle as ArticleChildSafetyDeclarationInput['sleepwearStyle'],
    safetyConcern: d.safetyConcern as ArticleChildSafetyDeclarationInput['safetyConcern'], observation };
}
/** Projection only. Native author/date/content qualification belongs to the server. */
export function childSafetyStatementProjection(raw: unknown): ArticleChildSafetyDeclarationInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return parseChildSafetyDeclaration(Object.fromEntries(CHILD_SAFETY_INPUT_FIELDS.map(key => [key, (raw as Record<string, unknown>)[key]])));
}
