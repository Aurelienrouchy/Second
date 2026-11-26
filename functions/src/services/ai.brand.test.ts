/**
 * La marque rapprochée du catalogue doit revenir au client sous son nom CANONIQUE.
 *
 * `validateAndNormalizeResponse` étale le résultat de `matchBrand` — dont le
 * champ s'appelle `brandName` — puis lisait `matchedName`, qui n'existe pas.
 * Le travail de rapprochement était donc jeté : le vendeur recevait la marque
 * telle que le modèle l'avait lue (« apc »), jamais « A.P.C. ».
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./brands', () => ({
  matchBrand: async () => ({
    brandId: 'b-apc',
    brandName: 'A.P.C.',
    confidence: 0.95,
    matchType: 'fuzzy',
    needsConfirmation: false,
    suggestions: [],
  }),
}));

import { validateAndNormalizeResponse } from './ai';

describe('validateAndNormalizeResponse — marque', () => {
  it('renvoie le nom canonique trouvé dans le catalogue', async () => {
    const result = await validateAndNormalizeResponse({ brand: 'apc', confidence: 0.9 });
    expect(result.brand?.detected).toBe('A.P.C.');
  });
});
