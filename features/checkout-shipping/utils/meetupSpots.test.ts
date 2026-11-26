import { describe, expect, it } from 'vitest';

import { meetupSpotsForArticle } from './meetupSpots';

const MILE_END = { id: 'mile-end', name: 'Mile End', borough: 'Le Plateau-Mont-Royal' };
const VERDUN = { id: 'verdun', name: 'Verdun', borough: 'Verdun' };

describe('meetupSpotsForArticle (CM01)', () => {
  it('propose les quartiers choisis par le vendeur', () => {
    const spots = meetupSpotsForArticle({ neighborhoods: [MILE_END, VERDUN] });
    expect(spots.map((s) => s.neighborhood.id)).toEqual(['mile-end', 'verdun']);
    expect(spots[0]).toMatchObject({ category: 'other_public', name: 'À convenir dans Mile End' });
  });

  it('se contente du quartier unique des anciens articles', () => {
    const spots = meetupSpotsForArticle({ neighborhood: VERDUN });
    expect(spots.map((s) => s.neighborhood.id)).toEqual(['verdun']);
  });

  it('garde les lieux précis quand un article en porte', () => {
    const spot = { name: 'Café Olympico', category: 'cafe' as const, neighborhood: MILE_END };
    expect(meetupSpotsForArticle({ preferredMeetupSpots: [spot], neighborhoods: [VERDUN] })).toEqual([
      spot,
    ]);
  });

  it('ne propose rien sans quartier', () => {
    expect(meetupSpotsForArticle({})).toEqual([]);
  });

  it('ne répète pas un quartier', () => {
    expect(meetupSpotsForArticle({ neighborhoods: [VERDUN, VERDUN] })).toHaveLength(1);
  });
});
