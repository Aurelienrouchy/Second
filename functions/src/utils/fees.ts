/**
 * Frais de protection Seconde — Acheteur uniquement
 *
 * Modèle : 0% vendeur, frais 100% côté acheteur (comme Vinted)
 * Le vendeur reçoit 100% du prix de son article.
 *
 * Frais acheteur = 5% du prix article + 1,50$ fixe
 * Minimum : 2,00$
 *
 * Ce que ça couvre :
 * - Protection acheteur (litige, remboursement)
 * - Paiement sécurisé (Stripe processing)
 * - Support client
 * - Infrastructure (hébergement, API shipping)
 *
 * Benchmark :
 * - Vinted : 5% + 0,70€ → on est aligné
 * - Poshmark : 20% vendeur → on est beaucoup plus attractif pour les vendeurs
 */

// =============================================================================
// CONFIGURATION (modifiable via env vars ou Firebase Remote Config)
// =============================================================================

/** Pourcentage des frais de protection (ex: 5 = 5%) */
const BUYER_FEE_PERCENT = parseFloat(
  process.env.BUYER_FEE_PERCENT || '5'
);

/** Frais fixe ajouté en plus du pourcentage (en CAD) */
const BUYER_FEE_FIXED = parseFloat(
  process.env.BUYER_FEE_FIXED || '1.50'
);

/** Frais de protection minimum (en CAD) — protège contre les micro-articles */
const BUYER_FEE_MIN = parseFloat(
  process.env.BUYER_FEE_MIN || '2.00'
);

// =============================================================================
// TYPES
// =============================================================================

export interface FeeBreakdown {
  /** Prix de l'article */
  articlePrice: number;
  /** Frais de livraison */
  shippingCost: number;
  /** Frais de protection acheteur effectifs (après réduction boutique) */
  serviceFee: number;
  /** Frais de protection au tarif plein, avant réduction boutique */
  serviceFeeBeforeReduction: number;
  /** Fraction de réduction appliquée (0 = plein tarif, 1 = gratuit) */
  feeReduction: number;
  /** Pourcentage appliqué */
  serviceFeePercent: number;
  /** Partie fixe des frais */
  serviceFeeFixed: number;
  /** Total que l'acheteur paie */
  buyerTotal: number;
  /** Montant que le vendeur reçoit (= prix article, 100%) */
  sellerPayout: number;
}

// =============================================================================
// CALCULATION
// =============================================================================

/**
 * Calcule les frais de protection et le total pour une transaction
 *
 * Formule : max(BUYER_FEE_MIN, articlePrice × BUYER_FEE_PERCENT/100 + BUYER_FEE_FIXED)
 *
 * Exemples (5% + 1,50$, min 2,00$) :
 *   5$  → max(2,00$, 0,25$ + 1,50$) = 2,00$  → acheteur paie  7,00$ + livraison
 *  15$  → max(2,00$, 0,75$ + 1,50$) = 2,25$  → acheteur paie 17,25$ + livraison
 *  30$  → max(2,00$, 1,50$ + 1,50$) = 3,00$  → acheteur paie 33,00$ + livraison
 *  50$  → max(2,00$, 2,50$ + 1,50$) = 4,00$  → acheteur paie 54,00$ + livraison
 * 100$  → max(2,00$, 5,00$ + 1,50$) = 6,50$  → acheteur paie 106,50$ + livraison
 */
export function calculateFees(
  articlePrice: number,
  shippingCost: number
): FeeBreakdown {
  // Frais = % du prix article + partie fixe
  const calculated = Math.round(
    (articlePrice * (BUYER_FEE_PERCENT / 100) + BUYER_FEE_FIXED) * 100
  ) / 100;

  // Appliquer le minimum
  const serviceFee = Math.max(calculated, BUYER_FEE_MIN);

  // Total acheteur = article + livraison + frais de protection
  const buyerTotal = Math.round((articlePrice + shippingCost + serviceFee) * 100) / 100;

  // Vendeur reçoit 100% du prix article — 0% commission vendeur
  const sellerPayout = articlePrice;

  return {
    articlePrice,
    shippingCost,
    serviceFee,
    serviceFeePercent: BUYER_FEE_PERCENT,
    serviceFeeFixed: BUYER_FEE_FIXED,
    buyerTotal,
    sellerPayout,
  };
}

/**
 * Calcule uniquement les frais de protection (pour affichage côté client)
 */
export function calculateServiceFee(articlePrice: number): number {
  const calculated = Math.round(
    (articlePrice * (BUYER_FEE_PERCENT / 100) + BUYER_FEE_FIXED) * 100
  ) / 100;
  return Math.max(calculated, BUYER_FEE_MIN);
}

/**
 * Retourne la config des frais (pour affichage côté client)
 */
export function getServiceFeeConfig(): {
  percent: number;
  fixed: number;
  min: number;
} {
  return {
    percent: BUYER_FEE_PERCENT,
    fixed: BUYER_FEE_FIXED,
    min: BUYER_FEE_MIN,
  };
}

/**
 * @deprecated — Use getServiceFeeConfig().percent instead
 */
export function getServiceFeePercent(): number {
  return BUYER_FEE_PERCENT;
}
