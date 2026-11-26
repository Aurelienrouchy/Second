import { describe, expect, it } from 'vitest';

import { MAX_MEETUP_NEIGHBORHOODS, toggleNeighborhood } from './neighborhoods';

function hood(i: number) {
  return { id: `q${i}`, name: `Quartier ${i}`, borough: 'Le Plateau-Mont-Royal' };
}

describe('toggleNeighborhood', () => {
  it('ajoute un quartier absent et retire un quartier présent', () => {
    const one = toggleNeighborhood([], hood(1));
    expect(one).toEqual({ next: [hood(1)], capped: false });
    expect(toggleNeighborhood(one.next, hood(1))).toEqual({ next: [], capped: false });
  });

  it('refuse un onzième quartier : le serveur le rejetterait à la publication', () => {
    const ten = Array.from({ length: MAX_MEETUP_NEIGHBORHOODS }, (_, i) => hood(i));
    const result = toggleNeighborhood(ten, hood(99));
    expect(result.capped).toBe(true);
    expect(result.next).toBe(ten);
  });

  it('laisse toujours retirer un quartier, même au plafond', () => {
    const ten = Array.from({ length: MAX_MEETUP_NEIGHBORHOODS }, (_, i) => hood(i));
    const result = toggleNeighborhood(ten, hood(3));
    expect(result.capped).toBe(false);
    expect(result.next).toHaveLength(MAX_MEETUP_NEIGHBORHOODS - 1);
  });
});
