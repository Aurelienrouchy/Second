/**
 * SA01 — l'estimation de jetons d'une image était calculée sur la longueur de
 * la chaîne base64. Gemini facture une image par tuiles de 768 px, pas au
 * poids : les journaux d'analyse annonçaient environ cinquante fois le coût
 * réel. Rien ne pilote de quota sur ce chiffre, c'est un journal — mais un
 * journal faux.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('../config/firebase', () => ({ db: {}, FieldValue: {} }));
import { estimateTokens } from './ai';

// ~300 Ko de photo, le gabarit courant après compression avant envoi.
const PHOTO_BASE64 = 'A'.repeat(400_000);

describe('estimateTokens', () => {
  it('chiffre une image en tuiles, pas en octets', () => {
    expect(estimateTokens(PHOTO_BASE64, true)).toBeLessThan(5000);
  });

  it('utilise les dimensions quand elles sont connues', () => {
    expect(estimateTokens(PHOTO_BASE64, true, { width: 1200, height: 1600 })).toBe(258 * 2 * 3);
  });

  it('ne change rien à l’estimation du texte', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(4000))).toBe(1000);
  });
});
