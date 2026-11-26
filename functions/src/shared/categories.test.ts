/**
 * CG02 — le prompt de catégories ne donnait au modèle que des libellés
 * dédoublonnés par univers : « Bracelets », « Chapeaux » et « Gants »
 * n'apparaissaient qu'une fois pour les Femmes. L'appariement retenait alors
 * la première feuille de l'arbre, qui est sous « Vêtements > Sport », et un
 * bracelet de bijouterie devenait un accessoire de sport — sans que le vendeur
 * voie le chemin choisi.
 */
import { describe, expect, it } from 'vitest';
import { generateCompactCategoryPrompt, findCategoryByLabelFuzzy } from './categories';

describe('generateCompactCategoryPrompt — libellés ambigus (CG02)', () => {
  const prompt = generateCompactCategoryPrompt();

  it('distingue les deux « Bracelets » des Femmes par leur parent', () => {
    expect(prompt).toContain('Bijoux > Bracelets');
    expect(prompt).toContain('Accessoires de sports > Bracelets');
  });

  it('distingue de même les deux « Chapeaux »', () => {
    expect(prompt).toContain('Chapeaux & casquettes > Chapeaux');
    expect(prompt).toContain('Accessoires de sports > Chapeaux');
  });

  it('n’offre plus la feuille « Tous », qui ne désigne rien', () => {
    expect(/(^|,\s)Tous(,|$)/m.test(prompt)).toBe(false);
  });

  it('laisse tels quels les libellés sans ambiguïté', () => {
    expect(prompt).toContain('Robes');
    expect(prompt).toContain('Femmes: ');
  });
});

describe('findCategoryByLabelFuzzy — appariement par parent (CG02)', () => {
  it('range un bracelet de bijouterie dans les bijoux', () => {
    expect(findCategoryByLabelFuzzy('Bijoux > Bracelets', 'women')?.id).toBe(
      'women_accessories_jewelry_bracelets'
    );
  });

  it('range un bracelet de sport dans les accessoires de sport', () => {
    expect(findCategoryByLabelFuzzy('Accessoires de sports > Bracelets', 'women')?.id).toBe(
      'women_clothing_sport_accessories_wristbands'
    );
  });

  it('range un chapeau dans les chapeaux', () => {
    expect(findCategoryByLabelFuzzy('Chapeaux & casquettes > Chapeaux', 'women')?.id).toBe(
      'women_accessories_hats_hats'
    );
  });

  it('apparie toujours un libellé nu', () => {
    const match = findCategoryByLabelFuzzy('Robes', 'women');
    expect(match?.path[0]).toBe('women');
  });

  it('ne rend rien pour un libellé hors mode', () => {
    expect(findCategoryByLabelFuzzy('table basse', 'women')).toBeUndefined();
  });
});
