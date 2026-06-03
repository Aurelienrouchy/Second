/**
 * isFallbackRate — garde-fou métier "ShipEngine indisponible".
 *
 * Domaine achat-paiement (frais de livraison). Quand ShipEngine est down, le
 * backend renvoie des tarifs synthétiques préfixés `fallback_`. Un tel tarif ne
 * permet PAS d'acheter une vraie étiquette : l'écran checkout doit alors bloquer
 * le paiement carte et rediriger vers la remise en main propre. Cette détection
 * repose entièrement sur ce prédicat — on en verrouille le contrat.
 *
 * Placé dans tests/jest/ pour éviter la collision avec Vitest (qui ramasse les
 * tests `.test.ts` de features/).
 */

// Import direct depuis le module types : le barrel tire des composants
// (Skeleton → expo-linear-gradient ESM) inutiles pour ce test de logique pure.
import {
  isFallbackRate,
  FALLBACK_RATE_PREFIX,
  FALLBACK_ESTIMATES,
} from '@/features/checkout-shipping/types';

describe('isFallbackRate', () => {
  it('détecte un tarif de repli (préfixe fallback_) → paiement carte à bloquer', () => {
    expect(isFallbackRate('fallback_standard')).toBe(true);
    expect(isFallbackRate(`${FALLBACK_RATE_PREFIX}express`)).toBe(true);
  });

  it('laisse passer un vrai tarif ShipEngine (rateId réel)', () => {
    expect(isFallbackRate('se_rate_abc123')).toBe(false);
  });

  it('traite l\'absence de tarif comme non-fallback (null / undefined)', () => {
    expect(isFallbackRate(null)).toBe(false);
    expect(isFallbackRate(undefined)).toBe(false);
    expect(isFallbackRate('')).toBe(false);
  });

  it('classe TOUS les FALLBACK_ESTIMATES exposés comme tarifs de repli', () => {
    // Cohérence : les estimations de secours servies par l'app doivent toutes
    // être reconnues comme fallback, sinon un paiement carte impossible
    // passerait le garde-fou.
    for (const estimate of FALLBACK_ESTIMATES) {
      expect(isFallbackRate(estimate.rateId)).toBe(true);
    }
  });
});
