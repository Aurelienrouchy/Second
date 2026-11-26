import { describe, expect, it } from 'vitest';

import { boundedResize } from './imageResize';

describe('boundedResize — borne le plus grand côté, n’agrandit jamais', () => {
  it('une photo paysage est bornée en largeur', () => {
    expect(boundedResize(4032, 3024, 1200)).toEqual([{ resize: { width: 1200 } }]);
  });

  it('une photo portrait est bornée en HAUTEUR (elle sortait plus haute que la borne)', () => {
    expect(boundedResize(3024, 4032, 1200)).toEqual([{ resize: { height: 1200 } }]);
  });

  it('une petite photo n’est pas agrandie (elle était alourdie jusqu’à la borne)', () => {
    expect(boundedResize(800, 600, 1600)).toEqual([]);
  });

  it('taille inconnue : le comportement d’avant, borné en largeur', () => {
    expect(boundedResize(0, 0, 1200)).toEqual([{ resize: { width: 1200 } }]);
  });
});
