/**
 * Tests unitaires — constants/theme.ts (tokens du Design System).
 *
 * Ces tokens sont la source de vérité du DS "Editorial Luxe". Les tests
 * agissent comme des garde-fous CONTRACTUELS : ils documentent et figent les
 * invariants sur lesquels tout le styling repose (gouttière unique, cartes à
 * coins nets, échelle d'espacement monotone, palette bien formée). Un change-
 * ment de ces valeurs doit être un acte conscient qui casse un test.
 */

import {
  colors,
  components,
  radius,
  spacing,
  theme,
  typography,
} from '@/constants/theme';

describe('constants/theme', () => {
  describe('spacing — échelle éditoriale', () => {
    it('définit la gouttière de base lg = 24 (rythme Home)', () => {
      // La doc projet impose spacing.lg comme gouttière unique sur Home.
      expect(spacing.lg).toBe(24);
    });

    it('est une échelle strictement croissante', () => {
      const order = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'] as const;
      const values = order.map((k) => spacing[k]);
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeGreaterThan(values[i - 1]);
      }
    });

    it('n’expose que des entiers positifs (pas de demi-pixels)', () => {
      Object.values(spacing).forEach((v) => {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('radius — cartes nettes (signature Seconde)', () => {
    it('none vaut 0 et full est un pill', () => {
      expect(radius.none).toBe(0);
      expect(radius.full).toBe(9999);
    });

    it('la carte produit a des coins nets (radius.none)', () => {
      // Invariant de l'identité visuelle : pas de coins arrondis sur les cards.
      expect(components.card.borderRadius).toBe(radius.none);
    });

    it('le ratio image carte est portrait 4/5', () => {
      expect(components.card.imageRatio).toBeCloseTo(4 / 5);
    });
  });

  describe('colors — palette bien formée', () => {
    it('primary est le rust de référence et rust en est l’alias', () => {
      expect(colors.primary).toBe('#C4603A');
      expect(colors.rust).toBe(colors.primary);
    });

    it('tous les hex pleins sont au format #RRGGBB valide', () => {
      const hexEntries = Object.entries(colors).filter(
        ([, v]) => typeof v === 'string' && v.startsWith('#'),
      );
      // Sanity : il y a bien des couleurs hex à valider.
      expect(hexEntries.length).toBeGreaterThan(0);
      hexEntries.forEach(([, v]) => {
        expect(v).toMatch(/^#[0-9A-Fa-f]{6}$/);
      });
    });

    it('les alias pointent sur leur couleur canonique', () => {
      expect(colors.cream).toBe(colors.surfaceWarm);
      expect(colors.charcoal).toBe(colors.dark);
      expect(colors.sage).toBe(colors.secondary);
    });
  });

  describe('typography — familles cohérentes', () => {
    it('les styles de titre utilisent une famille display (serif)', () => {
      [typography.hero, typography.h1, typography.h2, typography.h3].forEach(
        (t) => {
          expect(t.fontFamily).toMatch(/Cormorant-Garamond/);
        },
      );
    });

    it('chaque style a un lineHeight >= fontSize (jamais de chevauchement)', () => {
      Object.values(typography).forEach((t) => {
        expect(t.lineHeight).toBeGreaterThanOrEqual(t.fontSize);
      });
    });
  });

  describe('theme — objet agrégé', () => {
    it('réexporte les mêmes références que les exports nommés', () => {
      // L'objet `theme` ne doit pas dupliquer/diverger des tokens nommés.
      expect(theme.colors).toBe(colors);
      expect(theme.spacing).toBe(spacing);
      expect(theme.radius).toBe(radius);
      expect(theme.typography).toBe(typography);
    });
  });
});
