import { PAYMENTS_ENABLED } from '@/config/featureFlags';
import {
  SIZES_ADULT_TOPS_EU,
  SIZES_ADULT_TOPS_US,
  getPreferenceSizeLabel,
  getSizes,
} from '@/data/sizes';

describe('correctifs de préférences et bêta', () => {
  it('désactive les paiements pendant la bêta', () => {
    expect(PAYMENTS_ENABLED).toBe(false);
  });

  it('propose XXS et des tailles au-delà de XXL dans les deux systèmes', () => {
    for (const sizes of [SIZES_ADULT_TOPS_EU, SIZES_ADULT_TOPS_US]) {
      expect(sizes).toContain('XXS');
      expect(sizes).toEqual(expect.arrayContaining(['3XL', '4XL', '5XL']));
    }
  });

  it('affiche les équivalences EU demandées et les pointures propres à chaque système', () => {
    expect(getPreferenceSizeLabel('M', 'EU')).toBe('M / 38');
    expect(getPreferenceSizeLabel('L', 'EU')).toBe('L / 40');
    expect(getPreferenceSizeLabel('M', 'US')).toBe('M');
    expect(getSizes('shoes', 'EU', 'adult')).toContain('38');
    expect(getSizes('shoes', 'US', 'adult')).toContain('7.5');
  });
});
