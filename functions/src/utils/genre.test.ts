import { describe, it, expect } from 'vitest';
import { kidsBranchFromGenre, topLevelFromGenre } from './genre';

describe('topLevelFromGenre — l’univers d’un article analysé', () => {
  it('reconnaît les formes que le modèle emploie', () => {
    expect(topLevelFromGenre('femmes')).toBe('women');
    expect(topLevelFromGenre('Femme')).toBe('women');
    expect(topLevelFromGenre('hommes')).toBe('men');
    expect(topLevelFromGenre('Homme')).toBe('men');
    expect(topLevelFromGenre('enfants')).toBe('kids');
    expect(topLevelFromGenre('Enfant')).toBe('kids');
    expect(topLevelFromGenre('fille')).toBe('kids');
    expect(topLevelFromGenre('garçon')).toBe('kids');
    expect(topLevelFromGenre('bébé')).toBe('kids');
  });

  it('ne range pas un genre inconnu chez les Femmes', () => {
    expect(topLevelFromGenre('unisexe')).toBeUndefined();
    expect(topLevelFromGenre('')).toBeUndefined();
    expect(topLevelFromGenre(undefined)).toBeUndefined();
  });
});

describe('kidsBranchFromGenre — filles ou garçons (CG01)', () => {
  it('distingue filles et garçons', () => {
    expect(kidsBranchFromGenre('Filles')).toBe('kids_girls');
    expect(kidsBranchFromGenre('fille')).toBe('kids_girls');
    expect(kidsBranchFromGenre('Garçons')).toBe('kids_boys');
    expect(kidsBranchFromGenre('garcon')).toBe('kids_boys');
  });

  it('ne devine rien pour « Enfants » ni pour un autre genre', () => {
    expect(kidsBranchFromGenre('Enfants')).toBeUndefined();
    expect(kidsBranchFromGenre('Femmes')).toBeUndefined();
    expect(kidsBranchFromGenre(undefined)).toBeUndefined();
  });
});
