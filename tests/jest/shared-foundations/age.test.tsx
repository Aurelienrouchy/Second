/**
 * Tests unitaires — utils/age.ts (age gating partagé avec le backend).
 *
 * Comportement MÉTIER vérifié :
 * - seuils légaux 16 (inscription) / 18 (vente, exigence payout Stripe)
 * - le calcul d'âge se fait sur le jour calendaire LOCAL (pas de fuseau),
 *   d'où l'usage de fake timers ancrés sur une date connue
 * - validation stricte d'une vraie date calendaire (mois/jour/année réels)
 * - tolérance aux entrées malformées (null, format invalide, dates folles)
 *
 * Pure logique → placé en .tsx pour rester dans le périmètre Jest et profiter
 * des fake timers (les *.test.ts restent à Vitest, cf. jest.config.js).
 */

import {
  MIN_AGE_REGISTER,
  MIN_AGE_SELL,
  canSell,
  computeAgeFromIso,
  isRealCalendarDate,
  toIsoDate,
} from '@/utils/age';

// On ancre "aujourd'hui" pour que le calcul d'âge soit déterministe.
// 2026-06-15 (milieu d'année) : permet de tester l'anniversaire passé / à venir.
const TODAY = new Date(2026, 5, 15); // mois 0-indexé → juin

describe('utils/age', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(TODAY);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('seuils métier', () => {
    it('expose 16 pour l’inscription et 18 pour la vente', () => {
      // Garde-fou contre un changement accidentel des seuils légaux côté app
      // (doivent rester alignés avec le backend consent.ts).
      expect(MIN_AGE_REGISTER).toBe(16);
      expect(MIN_AGE_SELL).toBe(18);
    });
  });

  describe('computeAgeFromIso', () => {
    it('compte les années révolues quand l’anniversaire est déjà passé cette année', () => {
      // Né le 1er janvier 2000 → au 15 juin 2026, a 26 ans révolus.
      expect(computeAgeFromIso('2000-01-01')).toBe(26);
    });

    it('retire une année quand l’anniversaire n’est pas encore arrivé', () => {
      // Né le 31 décembre 2000 → au 15 juin 2026, n'a que 25 ans (anniv à venir).
      expect(computeAgeFromIso('2000-12-31')).toBe(25);
    });

    it('compte l’année le jour même de l’anniversaire (>=, pas >)', () => {
      // Né le 15 juin 2008 → exactement 18 ans aujourd'hui (15 juin 2026).
      expect(computeAgeFromIso('2008-06-15')).toBe(18);
    });

    it('ne compte pas encore l’année la veille de l’anniversaire', () => {
      // Né le 16 juin 2008 → au 15 juin 2026, a 17 ans (anniv demain).
      expect(computeAgeFromIso('2008-06-16')).toBe(17);
    });

    it('retourne null pour un format non ISO', () => {
      expect(computeAgeFromIso('15/06/2008')).toBeNull();
      expect(computeAgeFromIso('2008-6-1')).toBeNull();
      expect(computeAgeFromIso('')).toBeNull();
    });

    it('retourne null pour une date calendaire impossible bien formatée', () => {
      // 31 février : format ISO valide mais date inexistante.
      expect(computeAgeFromIso('2000-02-31')).toBeNull();
      expect(computeAgeFromIso('2000-13-01')).toBeNull();
    });
  });

  describe('canSell', () => {
    it('autorise la vente à 18 ans pile (jour de l’anniversaire)', () => {
      expect(canSell('2008-06-15')).toBe(true);
    });

    it('refuse la vente à 17 ans (anniv 18 demain)', () => {
      expect(canSell('2008-06-16')).toBe(false);
    });

    it('refuse la vente sans date de naissance', () => {
      expect(canSell(null)).toBe(false);
      expect(canSell(undefined)).toBe(false);
      expect(canSell('')).toBe(false);
    });

    it('refuse la vente pour une date malformée', () => {
      expect(canSell('pas-une-date')).toBe(false);
    });
  });

  describe('isRealCalendarDate', () => {
    it('accepte une date réelle', () => {
      expect(isRealCalendarDate(2000, 6, 15)).toBe(true);
    });

    it('accepte le 29 février d’une année bissextile', () => {
      expect(isRealCalendarDate(2000, 2, 29)).toBe(true);
    });

    it('rejette le 29 février d’une année non bissextile', () => {
      expect(isRealCalendarDate(2001, 2, 29)).toBe(false);
    });

    it('rejette des composantes non entières', () => {
      expect(isRealCalendarDate(2000.5, 6, 15)).toBe(false);
    });

    it('rejette une année hors plage', () => {
      expect(isRealCalendarDate(1899, 6, 15)).toBe(false);
      // Année future (> année courante simulée 2026).
      expect(isRealCalendarDate(2027, 6, 15)).toBe(false);
    });
  });

  describe('toIsoDate', () => {
    it('zéro-padde le mois et le jour', () => {
      expect(toIsoDate(2008, 6, 5)).toBe('2008-06-05');
    });

    it('retourne null pour une date impossible', () => {
      expect(toIsoDate(2001, 2, 29)).toBeNull();
    });

    it('produit une chaîne reparsables par computeAgeFromIso (aller-retour)', () => {
      const iso = toIsoDate(2008, 6, 15);
      expect(iso).toBe('2008-06-15');
      expect(computeAgeFromIso(iso as string)).toBe(18);
    });
  });
});
