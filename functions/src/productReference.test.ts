/**
 * PRF01 — couleurs et matières n'étaient reconnues qu'en égalité STRICTE,
 * sensible aux accents, aux tirets et aux pourcentages. « coton bio »,
 * « 95 % coton » ou « rose pale » ressortaient sans identifiant : le champ
 * arrivait vide chez le vendeur, sans badge IA, à remplir à la main.
 */
import { describe, expect, it } from 'vitest';
import { findColorByNameOrAlias, findMaterialByNameOrAlias } from './productReference';

describe('findMaterialByNameOrAlias', () => {
  it('reconnaît une matière qualifiée', () => {
    expect(findMaterialByNameOrAlias('coton bio')?.id).toBe('coton');
  });

  it('ignore les pourcentages d’étiquette', () => {
    expect(findMaterialByNameOrAlias('95% coton')?.id).toBe('coton');
  });

  it('traite le tiret comme une espace', () => {
    expect(findMaterialByNameOrAlias('simili-cuir')?.id).toBe('cuir-synthetique');
  });

  it('retient la matière la plus longue, pas la première trouvée', () => {
    expect(findMaterialByNameOrAlias('cuir synthétique noir')?.id).toBe('cuir-synthetique');
  });

  it('apparie toujours en égalité stricte', () => {
    expect(findMaterialByNameOrAlias('Coton')?.id).toBe('coton');
    expect(findMaterialByNameOrAlias('cachemire')?.id).toBe('cachemire');
  });

  it('ne reconnaît rien dans une matière inconnue', () => {
    expect(findMaterialByNameOrAlias('kryptonite')).toBeUndefined();
  });
});

describe('findColorByNameOrAlias', () => {
  it('supporte l’absence d’accent', () => {
    expect(findColorByNameOrAlias('rose pale')?.id).toBe('rose-pale');
  });

  it('reconnaît une couleur qualifiée, la plus longue d’abord', () => {
    expect(findColorByNameOrAlias('bleu marine délavé')?.id).toBe('bleu-marine');
  });

  it('n’attrape pas un nom court à l’intérieur d’un mot', () => {
    expect(findColorByNameOrAlias('orange')?.id).toBe('orange');
    expect(findColorByNameOrAlias('bordeaux')?.id).toBe('bordeaux');
  });

  it('apparie toujours en égalité stricte', () => {
    expect(findColorByNameOrAlias('Noir')?.id).toBe('noir');
    expect(findColorByNameOrAlias('gris clair')?.id).toBe('gris-clair');
  });

  it('ne reconnaît rien dans une couleur inconnue', () => {
    expect(findColorByNameOrAlias('chartreuse électrique')).toBeUndefined();
  });
});
