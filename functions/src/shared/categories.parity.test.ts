import { describe, expect, it } from 'vitest';
import {
  CATEGORIES as APP_CATEGORIES,
  getLeafCategories as getAppLeaves,
  TOP_LEVEL_CATEGORIES as APP_TOP_LEVEL,
} from '../../../shared/categories';
import {
  CATEGORIES, findCategoryById, findCategoryByLabel, findCategoryByLabelFuzzy,
  findFlatCategoryById, generateCompactCategoryPrompt, getCategoryPath,
  getLeafCategories, TOP_LEVEL_CATEGORIES,
} from './categories';
import { articleHygieneRequirement, evaluateArticleHygieneInput } from './articleHygiene';
import { childSafetyCategory } from './articleChildSafety';
import { assertArticleHygieneAdmitted, declaredArticleHygiene } from '../utils/articleHygiene';

const posters = ['home', 'home_decor', 'home_decor_wall', 'home_decor_wall_posters'];
const sneakers = ['men', 'men_shoes', 'men_shoes_sneakers'];
const cosmetics = ['men_grooming_perfume', 'men_grooming_skincare', 'men_grooming_bodycare'];

describe('distributed app/server category contract', () => {
  it('ships the same complete tree and exact canonical leaf paths as the app', () => {
    expect(CATEGORIES).toEqual(APP_CATEGORIES);
    const app = getAppLeaves();
    expect(app).toHaveLength(1263);
    expect(getLeafCategories()).toEqual(app);
    expect(new Set(app.map(category => category.id)).size).toBe(app.length);
    for (const leaf of app) {
      expect(getCategoryPath(leaf.id)).toEqual(leaf.path);
      expect(articleHygieneRequirement(leaf.path)).not.toBe('invalid');
      expect(childSafetyCategory(leaf.path)).not.toBe('invalid');
    }
  });

  it.each([['posters', posters], ['sneakers', sneakers]] as const)('admits the selected precise path %s', (_label, path) => {
    expect(evaluateArticleHygieneInput(path, 'très bon état', null)).toMatchObject({ allowed: true });
    expect(childSafetyCategory(path)).toBe('not_child_clothing');
    expect(() => assertArticleHygieneAdmitted({ categoryIds: path, condition: 'très bon état' })).not.toThrow();
  });

  it.each(['men_shoes', 'men_accessories', 'men_grooming'])('keeps historical lookup for %s while requiring a precise new leaf', id => {
    expect(getCategoryPath(id)).toEqual(['men', id]);
    expect(findCategoryById(id)?.children?.length).toBeGreaterThan(0);
    expect(findFlatCategoryById(id)?.path).toEqual(['men', id]);
    expect(evaluateArticleHygieneInput(['men', id], 'neuf', null)).toMatchObject({
      allowed: false, reason: 'article_hygiene_category_invalid',
    });
    expect(childSafetyCategory(['men', id])).toBe('invalid');
  });

  it('rejects a fabricated chain or unknown leaf instead of accepting a matching final ID', () => {
    for (const path of [['women', ...posters.slice(1)], posters.slice(1), ['home', 'unknown'], ['men', 'men_shoes']]) {
      expect(articleHygieneRequirement(path)).toBe('invalid');
      expect(childSafetyCategory(path)).toBe('invalid');
    }
  });
});

describe('AI category helpers retain their APIs and canonical universe', () => {
  it('offers all app universes and resolves precise Maison and Hommes leaves', () => {
    expect(TOP_LEVEL_CATEGORIES).toEqual(APP_TOP_LEVEL);
    expect(generateCompactCategoryPrompt()).toContain('Maison: ');
    expect(generateCompactCategoryPrompt()).toContain('Électronique: ');
    expect(findCategoryByLabel('Affiches', 'home')?.path).toEqual(posters);
    expect(findCategoryByLabelFuzzy('Décorations murales > Affiches', 'home')?.path).toEqual(posters);
    expect(findCategoryByLabelFuzzy('Parfums', 'men')?.id).toBe('men_grooming_perfume');
  });

  it('does not cross an explicit Maison or Électronique hint to match a clothing label', () => {
    expect(findCategoryByLabelFuzzy('Robes', 'home')).toBeUndefined();
    expect(findCategoryByLabelFuzzy('Robes', 'electronics')).toBeUndefined();
  });
});

describe("new men's care leaves preserve explicit hygiene declarations", () => {
  it.each(cosmetics)('requires a new sealed cosmetic and a current owner witness for %s', id => {
    const path = ['men', 'men_grooming', id];
    expect(articleHygieneRequirement(path)).toBe('cosmetic');
    expect(evaluateArticleHygieneInput(path, 'neuf', null)).toMatchObject({ allowed: false, reason: 'article_hygiene_declaration_required' });
    expect(evaluateArticleHygieneInput(path, 'neuf', { schemaVersion: 1, kind: 'not_applicable' }).allowed).toBe(false);
    expect(evaluateArticleHygieneInput(path, 'neuf', { schemaVersion: 1, kind: 'cosmetic', isNew: true, isSealed: false }))
      .toMatchObject({ allowed: false, reason: 'article_cosmetic_new_sealed_required' });
    expect(evaluateArticleHygieneInput(path, 'bon état', { schemaVersion: 1, kind: 'cosmetic', isNew: true, isSealed: true }))
      .toMatchObject({ allowed: false, reason: 'article_hygiene_condition_conflict' });
    const declaration = declaredArticleHygiene(path, 'neuf', { schemaVersion: 1, kind: 'cosmetic', isNew: true, isSealed: true }, 'seller');
    const article = { sellerId: 'seller', categoryIds: path, condition: 'neuf', hygieneDeclaration: declaration };
    expect(() => assertArticleHygieneAdmitted(article)).not.toThrow();
    expect(() => assertArticleHygieneAdmitted({ ...article, sellerId: 'other' })).toThrow();
    expect(() => assertArticleHygieneAdmitted({ ...article, condition: 'bon état' })).toThrow();
    expect(() => assertArticleHygieneAdmitted({ ...article, hygieneDeclaration: null })).toThrow();
  });

  it('requires an explicit nature for the mixed care category', () => {
    const path = ['men', 'men_grooming', 'men_grooming_other'];
    expect(articleHygieneRequirement(path)).toBe('mixed_cosmetic');
    expect(evaluateArticleHygieneInput(path, 'neuf', null).allowed).toBe(false);
    expect(evaluateArticleHygieneInput(path, 'bon état', { schemaVersion: 1, kind: 'not_applicable' }).allowed).toBe(true);
    expect(evaluateArticleHygieneInput(path, 'neuf', { schemaVersion: 1, kind: 'cosmetic', isNew: true, isSealed: true }).allowed).toBe(true);
    expect(evaluateArticleHygieneInput(path, 'neuf', { schemaVersion: 1, kind: 'cosmetic', isNew: true, isSealed: false }).allowed).toBe(false);
  });
});

describe('child-safety category boundaries remain precise', () => {
  it('keeps the existing child clothing and canonical sleepwear classifications', () => {
    expect(childSafetyCategory(['kids', 'kids_girls', 'kids_girls_tops', 'kids_girls_tops_tshirts'])).toBe('child_clothing');
    expect(childSafetyCategory(['kids', 'kids_boys', 'kids_boys_sleepwear', 'kids_boys_sleepwear_onepiece'])).toBe('canonical_sleepwear');
    for (const leaf of getAppLeaves().filter(category => ['home', 'men'].includes(category.path[0]))) {
      expect(childSafetyCategory(leaf.path)).toBe('not_child_clothing');
    }
    expect(childSafetyCategory(['kids', 'kids_boys', 'kids_boys_sleepwear'])).toBe('invalid');
  });
});
