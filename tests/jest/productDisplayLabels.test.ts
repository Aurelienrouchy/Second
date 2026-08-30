import { getColorName } from '@/data/colors';
import { getMaterialName } from '@/data/materials';
import { CONDITION_DISPLAY } from '@/types/ai';

describe('libellés produit affichés', () => {
  it('résout les couleurs composées sans exposer leur identifiant technique', () => {
    expect(['bleu-marine', 'blanc'].map(getColorName).join(', ')).toBe(
      'Bleu marine, Blanc',
    );
  });

  it('capitalise les matières et conserve les accents', () => {
    expect(['coton', 'elasthanne'].map(getMaterialName).join(', ')).toBe(
      'Coton, Élasthanne',
    );
  });

  it('expose le libellé du nouvel état IA', () => {
    expect(CONDITION_DISPLAY['neuf-sans-etiquette']).toBe(
      'neuf sans étiquette',
    );
  });
});
