/**
 * Univers (femmes, hommes, enfants) d'après le genre que lit le modèle.
 *
 * Seules « femmes », « hommes », « enfants » étaient reconnues, et tout le
 * reste tombait par défaut chez les Femmes — « Homme » au singulier compris.
 * Un genre inconnu rend désormais `undefined` : la catégorie reste à choisir
 * par le vendeur plutôt que d'arriver fausse et pré-validée.
 */
export type TopLevelCategory = 'women' | 'men' | 'kids';

const BY_GENRE: Record<string, TopLevelCategory> = {
  femme: 'women',
  femmes: 'women',
  women: 'women',
  woman: 'women',
  homme: 'men',
  hommes: 'men',
  men: 'men',
  man: 'men',
  enfant: 'kids',
  enfants: 'kids',
  kids: 'kids',
  kid: 'kids',
  fille: 'kids',
  filles: 'kids',
  garcon: 'kids',
  garcons: 'kids',
  girl: 'kids',
  girls: 'kids',
  boy: 'kids',
  boys: 'kids',
  bebe: 'kids',
  bebes: 'kids',
};

function normalizeGenre(genre: string): string {
  return genre.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function topLevelFromGenre(genre: unknown): TopLevelCategory | undefined {
  if (typeof genre !== 'string') return undefined;
  return BY_GENRE[normalizeGenre(genre)];
}

export type KidsBranch = 'kids_girls' | 'kids_boys';

const KIDS_BRANCH: Record<string, KidsBranch> = {
  fille: 'kids_girls',
  filles: 'kids_girls',
  girl: 'kids_girls',
  girls: 'kids_girls',
  garcon: 'kids_boys',
  garcons: 'kids_boys',
  boy: 'kids_boys',
  boys: 'kids_boys',
};

/**
 * Branche Enfants, quand le modèle l'a dite. Filles et garçons portent les
 * mêmes libellés de catégorie : sans elle, un vêtement de garçon partait chez
 * les filles.
 */
export function kidsBranchFromGenre(genre: unknown): KidsBranch | undefined {
  if (typeof genre !== 'string') return undefined;
  return KIDS_BRANCH[normalizeGenre(genre)];
}
