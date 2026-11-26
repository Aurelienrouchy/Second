/**
 * La taille de colis suggérée doit revenir au client sous la forme qu'il lit.
 *
 * Le client lit `packageSize.suggested` (types/ai.ts) ; le serveur renvoyait la
 * chaîne brute du modèle. `undefined.suggested` retombait sur « medium » :
 * toute suggestion de l'IA ressortait « medium ».
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./brands', () => ({ matchBrand: async () => ({}) }));

import { validateAndNormalizeResponse } from './ai';

describe('validateAndNormalizeResponse — taille de colis (TY04)', () => {
  it('renvoie la suggestion sous la forme { suggested, confidence }', async () => {
    const result = await validateAndNormalizeResponse({ packageSize: 'large', confidence: 0.9 });
    expect(result.packageSize).toEqual({ suggested: 'large', confidence: 0.9 });
  });

  it('ramène une valeur hors liste à « medium »', async () => {
    const result = await validateAndNormalizeResponse({ packageSize: 'énorme', confidence: 0.9 });
    expect((result.packageSize as { suggested: string }).suggested).toBe('medium');
  });
});
