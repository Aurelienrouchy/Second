/**
 * Tests unitaires — utils/normalizeBrand.ts.
 *
 * Comportement MÉTIER : afficher une marque de façon canonique (casse "maison"
 * pour les marques connues, title-case sinon) tout en gardant une clé de
 * normalisation stable pour le dédoublonnage / la recherche.
 *
 * Cas couverts : exceptions à casse spéciale, title-case générique,
 * traitement des apostrophes / traits d'union, entrées vides.
 */

import { brandDisplay, brandKey } from '@/utils/normalizeBrand';

describe('utils/normalizeBrand', () => {
  describe('brandKey', () => {
    it('met en minuscules et trim pour une clé stable', () => {
      expect(brandKey('  Zara  ')).toBe('zara');
      expect(brandKey('H&M')).toBe('h&m');
    });

    it('retourne une chaîne vide pour une marque absente', () => {
      expect(brandKey(null)).toBe('');
      expect(brandKey(undefined)).toBe('');
      expect(brandKey('')).toBe('');
    });

    it('rend la même clé quelle que soit la casse saisie (dédoublonnage)', () => {
      expect(brandKey('ZARA')).toBe(brandKey('zara'));
      expect(brandKey('Zara')).toBe(brandKey('  zArA '));
    });
  });

  describe('brandDisplay — exceptions à casse spéciale', () => {
    it('rend les acronymes en majuscules (COS, ASOS, YSL)', () => {
      expect(brandDisplay('cos')).toBe('COS');
      expect(brandDisplay('ASOS')).toBe('ASOS');
      expect(brandDisplay('ysl')).toBe('YSL');
    });

    it('préserve la ponctuation des marques signature', () => {
      expect(brandDisplay('apc')).toBe('A.P.C.');
      expect(brandDisplay('a.p.c.')).toBe('A.P.C.');
      expect(brandDisplay('h&m')).toBe('H&M');
      expect(brandDisplay("levi's")).toBe("Levi's");
      expect(brandDisplay('levis')).toBe("Levi's");
    });

    it('préserve les accents et la casse minuscule choisie (ba&sh, Sézane)', () => {
      expect(brandDisplay('bash')).toBe('ba&sh');
      expect(brandDisplay('ba&sh')).toBe('ba&sh');
      expect(brandDisplay('sezane')).toBe('Sézane');
      expect(brandDisplay('sézane')).toBe('Sézane');
    });

    it('trouve l’exception quelle que soit la casse / les espaces autour', () => {
      expect(brandDisplay('  ZaRa ')).toBe('Zara');
      expect(brandDisplay('UNIQLO')).toBe('Uniqlo');
    });
  });

  describe('brandDisplay — title-case générique (hors exceptions)', () => {
    it('capitalise chaque mot d’une marque inconnue', () => {
      expect(brandDisplay('maison margiela')).toBe('Maison Margiela');
    });

    it('normalise une casse incohérente saisie par l’utilisateur', () => {
      expect(brandDisplay('mAiSoN KiTsUné')).toBe('Maison Kitsuné');
    });

    it('capitalise après un trait d’union mais pas après une apostrophe', () => {
      // Le segment après "-" est recapitalisé ; après "'" il reste tel quel.
      expect(brandDisplay("o'neill")).toBe("O'neill");
      expect(brandDisplay('saint-laurent')).toBe('Saint-Laurent');
    });
  });

  describe('brandDisplay — entrées vides', () => {
    it('retourne une chaîne vide pour null / undefined / vide', () => {
      expect(brandDisplay(null)).toBe('');
      expect(brandDisplay(undefined)).toBe('');
      expect(brandDisplay('   ')).toBe('');
    });
  });
});
