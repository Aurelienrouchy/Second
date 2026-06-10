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
// TAXES TPS/TVQ — INFRASTRUCTURE DERRIÈRE FLAG (OFF par défaut)
// =============================================================================
//
// ⚠️ ACTION MÉTIER REQUISE AVANT D'ACTIVER (TAX_ENABLED=true) ⚠️
// Activer la taxe est une décision FISCALE du fondateur, PAS technique :
//   - immatriculation TPS (numéro fédéral) + TVQ (numéro Revenu Québec)
//     obligatoire avant de percevoir et remettre la taxe ;
//   - seuil de petit fournisseur (30 000 $ / 4 trimestres) ;
//   - statuer AVEC UN FISCALISTE sur la taxe du shipping refacturé — HORS SCOPE
//     ici : on ne taxe QUE le service fee (la part de revenu plateforme,
//     fourniture taxable en facilitateur de marketplace). Le shipping refacturé
//     est laissé non taxé tant que le traitement n'est pas tranché.
//
// Tant que TAX_ENABLED=false (défaut), la taxe vaut 0 et `buyerTotal` est
// STRICTEMENT inchangé (zéro régression). Quand true, la taxe s'ajoute au
// `buyerTotal` et est conservée par la plateforme (incluse dans la charge
// plateforme — pas de transfer_data, modèle vague 1).

/** Active la perception de la taxe. OFF par défaut (décision fiscale fondateur). */
const TAX_ENABLED = (process.env.TAX_ENABLED || 'false').toLowerCase() === 'true';

/** Taux TPS (fédéral) — 5% par défaut. */
const GST_RATE = parseFloat(process.env.GST_RATE || '0.05');

/** Taux TVQ (Québec) — 9,975% par défaut. */
const QST_RATE = parseFloat(process.env.QST_RATE || '0.09975');

export interface TaxConfig {
  enabled: boolean;
  gstRate: number;
  qstRate: number;
}

/**
 * Config taxe serveur (jamais fournie par le client). Réglable via env vars :
 *   TAX_ENABLED (défaut 'false'), GST_RATE (0.05), QST_RATE (0.09975).
 */
export function getTaxConfig(): TaxConfig {
  return { enabled: TAX_ENABLED, gstRate: GST_RATE, qstRate: QST_RATE };
}

export interface TaxBreakdown {
  /** TPS calculée sur le service fee (0 quand OFF). */
  gst: number;
  /** TVQ calculée sur le service fee (0 quand OFF). */
  qst: number;
  /** Total taxe = gst + qst (0 quand OFF). */
  taxTotal: number;
  /** Taxe perçue sur le service fee uniquement (= taxTotal — shipping non taxé). */
  taxOnServiceFee: number;
}

/**
 * Calcule la taxe SUR LE SERVICE FEE uniquement. Retourne tout à 0 quand
 * TAX_ENABLED est false (invariance garantie). Le shipping refacturé n'est PAS
 * taxé ici (hors scope — à trancher avec un fiscaliste).
 */
function computeTaxOnServiceFee(serviceFee: number): TaxBreakdown {
  if (!TAX_ENABLED || typeof serviceFee !== 'number' || !isFinite(serviceFee) || serviceFee <= 0) {
    return { gst: 0, qst: 0, taxTotal: 0, taxOnServiceFee: 0 };
  }
  const gst = Math.round(serviceFee * GST_RATE * 100) / 100;
  const qst = Math.round(serviceFee * QST_RATE * 100) / 100;
  const taxTotal = Math.round((gst + qst) * 100) / 100;
  return { gst, qst, taxTotal, taxOnServiceFee: taxTotal };
}

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
  /** TPS sur le service fee (0 quand TAX_ENABLED=false). */
  taxGst: number;
  /** TVQ sur le service fee (0 quand TAX_ENABLED=false). */
  taxQst: number;
  /** Taxe perçue sur le service fee uniquement (= taxTotal ; 0 quand OFF). */
  taxOnServiceFee: number;
  /** Total taxe ajoutée au buyerTotal (0 quand OFF). */
  taxTotal: number;
  /** Total que l'acheteur paie (inclut la taxe quand TAX_ENABLED=true) */
  buyerTotal: number;
  /** Montant que le vendeur reçoit (= prix article, 100%) */
  sellerPayout: number;
}

// =============================================================================
// CALCULATION
// =============================================================================

/**
 * Normalise une réduction de frais boutique en fraction sûre dans [0, 1].
 *
 * Fail-safe : toute valeur non finie / hors borne est ramenée à 0 (plein
 * tarif). Ne JAMAIS faire confiance au client : la valeur passée ici doit
 * provenir d'une lecture serveur du tier boutique (createTransaction).
 *
 * @param feeReduction fraction de réduction (0 = plein tarif, 1 = gratuit)
 */
function normalizeFeeReduction(feeReduction?: number): number {
  if (typeof feeReduction !== 'number' || !isFinite(feeReduction)) {
    return 0;
  }
  if (feeReduction <= 0) return 0;
  if (feeReduction >= 1) return 1;
  return feeReduction;
}

/**
 * Frais de protection au tarif plein (min appliqué), avant réduction boutique.
 */
function fullServiceFee(articlePrice: number): number {
  const calculated = Math.round(
    (articlePrice * (BUYER_FEE_PERCENT / 100) + BUYER_FEE_FIXED) * 100
  ) / 100;
  return Math.max(calculated, BUYER_FEE_MIN);
}

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
 *
 * Boutiques (Paid shop model) : `feeReduction` est une fraction dans [0, 1]
 * appliquée APRÈS le minimum, qui réduit UNIQUEMENT les frais acheteur — le
 * vendeur reçoit toujours 100% du prix (0% commission vendeur). La réduction
 * est dérivée serveur du tier boutique ; jamais fournie par le client.
 *
 * @param feeReduction fraction de réduction boutique (défaut 0 = plein tarif)
 */
export function calculateFees(
  articlePrice: number,
  shippingCost: number,
  feeReduction?: number
): FeeBreakdown {
  // Frais au tarif plein (min déjà appliqué)
  const serviceFeeBeforeReduction = fullServiceFee(articlePrice);

  // Réduction boutique appliquée 100% serveur, clampée dans [0, 1]
  const reduction = normalizeFeeReduction(feeReduction);
  const serviceFee = Math.round(
    serviceFeeBeforeReduction * (1 - reduction) * 100
  ) / 100;

  // Taxe sur le service fee uniquement. 0 quand TAX_ENABLED=false → buyerTotal
  // strictement inchangé (zéro régression). Quand ON, elle s'ajoute au total.
  const tax = computeTaxOnServiceFee(serviceFee);

  // Total acheteur = article + livraison + frais de protection (réduits) + taxe
  const buyerTotal = Math.round(
    (articlePrice + shippingCost + serviceFee + tax.taxTotal) * 100
  ) / 100;

  // Vendeur reçoit 100% du prix article — 0% commission vendeur
  const sellerPayout = articlePrice;

  return {
    articlePrice,
    shippingCost,
    serviceFee,
    serviceFeeBeforeReduction,
    feeReduction: reduction,
    serviceFeePercent: BUYER_FEE_PERCENT,
    serviceFeeFixed: BUYER_FEE_FIXED,
    taxGst: tax.gst,
    taxQst: tax.qst,
    taxOnServiceFee: tax.taxOnServiceFee,
    taxTotal: tax.taxTotal,
    buyerTotal,
    sellerPayout,
  };
}

/**
 * Calcule uniquement les frais de protection (pour affichage côté client).
 *
 * @param feeReduction fraction de réduction boutique (défaut 0 = plein tarif)
 */
export function calculateServiceFee(
  articlePrice: number,
  feeReduction?: number
): number {
  const reduction = normalizeFeeReduction(feeReduction);
  return Math.round(
    fullServiceFee(articlePrice) * (1 - reduction) * 100
  ) / 100;
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
