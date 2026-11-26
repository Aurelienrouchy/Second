/**
 * Un genre inconnu ne doit pas ranger l'article chez les Femmes.
 * `validateAndNormalizeResponse` prenait `'women'` par défaut : un vêtement
 * d'homme au genre mal lu devenait un article « Femmes », sans que le vendeur
 * le voie, puisque la catégorie arrivait pré-remplie et validée.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../config/firebase', () => ({ db: {}, FieldValue: {} }));
import { validateAndNormalizeResponse } from './ai';

describe('validateAndNormalizeResponse — catégorie sans genre', () => {
  it('laisse la catégorie à choisir quand le genre est inconnu', async () => {
    const result = await validateAndNormalizeResponse({ category: 'Robes', confidence: 0.9 });
    expect(result.category.categoryId).toBe('');
    expect(result.category.validated).toBe(false);
  });

  it('apparie normalement quand le genre est connu', async () => {
    const result = await validateAndNormalizeResponse({
      category: 'Robes',
      confidence: 0.9,
      _analysisMetadata: { topLevelCategory: 'women' },
    });
    expect(result.category.categoryId).not.toBe('');
  });
});

/**
 * CG01 — Enfants : filles et garçons portent les mêmes libellés (« T-shirts »,
 * « Jeans »…), le prompt ne donnait que les libellés et l'arbre liste les
 * filles d'abord. Tout vêtement de garçon analysé partait chez les filles,
 * pré-validé, sans que le vendeur le voie.
 */
describe('validateAndNormalizeResponse — vêtements d’enfant (CG01)', () => {
  const kids = (extra: Record<string, unknown> = {}) => ({
    category: 'T-shirts',
    confidence: 0.9,
    _analysisMetadata: { topLevelCategory: 'kids', ...extra },
  });

  it('ne range pas un T-shirt d’enfant chez les filles sans que le modèle l’ait dit', async () => {
    const result = await validateAndNormalizeResponse(kids());
    expect(result.category.categoryId).toBe('');
    expect(result.category.validated).toBe(false);
  });

  it('range un T-shirt de garçon chez les garçons', async () => {
    const result = await validateAndNormalizeResponse(kids({ kidsBranch: 'kids_boys' }));
    expect(result.category.categoryId).toBe('kids_boys_tops_tshirts');
  });

  it('range un T-shirt de fille chez les filles', async () => {
    const result = await validateAndNormalizeResponse(kids({ kidsBranch: 'kids_girls' }));
    expect(result.category.categoryId).toBe('kids_girls_tops_tshirts');
  });

  it('apparie toujours un libellé propre à une seule branche', async () => {
    const result = await validateAndNormalizeResponse({
      category: 'Robes',
      confidence: 0.9,
      _analysisMetadata: { topLevelCategory: 'kids' },
    });
    expect(result.category.categoryId).toMatch(/^kids_girls/);
  });
});
