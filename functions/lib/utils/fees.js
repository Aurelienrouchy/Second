"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateFees = calculateFees;
exports.calculateServiceFee = calculateServiceFee;
exports.getServiceFeeConfig = getServiceFeeConfig;
exports.getServiceFeePercent = getServiceFeePercent;
// =============================================================================
// CONFIGURATION (modifiable via env vars ou Firebase Remote Config)
// =============================================================================
/** Pourcentage des frais de protection (ex: 5 = 5%) */
const BUYER_FEE_PERCENT = parseFloat(process.env.BUYER_FEE_PERCENT || '5');
/** Frais fixe ajouté en plus du pourcentage (en CAD) */
const BUYER_FEE_FIXED = parseFloat(process.env.BUYER_FEE_FIXED || '1.50');
/** Frais de protection minimum (en CAD) — protège contre les micro-articles */
const BUYER_FEE_MIN = parseFloat(process.env.BUYER_FEE_MIN || '2.00');
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
function normalizeFeeReduction(feeReduction) {
    if (typeof feeReduction !== 'number' || !isFinite(feeReduction)) {
        return 0;
    }
    if (feeReduction <= 0)
        return 0;
    if (feeReduction >= 1)
        return 1;
    return feeReduction;
}
/**
 * Frais de protection au tarif plein (min appliqué), avant réduction boutique.
 */
function fullServiceFee(articlePrice) {
    const calculated = Math.round((articlePrice * (BUYER_FEE_PERCENT / 100) + BUYER_FEE_FIXED) * 100) / 100;
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
function calculateFees(articlePrice, shippingCost, feeReduction) {
    // Frais au tarif plein (min déjà appliqué)
    const serviceFeeBeforeReduction = fullServiceFee(articlePrice);
    // Réduction boutique appliquée 100% serveur, clampée dans [0, 1]
    const reduction = normalizeFeeReduction(feeReduction);
    const serviceFee = Math.round(serviceFeeBeforeReduction * (1 - reduction) * 100) / 100;
    // Total acheteur = article + livraison + frais de protection (réduits)
    const buyerTotal = Math.round((articlePrice + shippingCost + serviceFee) * 100) / 100;
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
        buyerTotal,
        sellerPayout,
    };
}
/**
 * Calcule uniquement les frais de protection (pour affichage côté client).
 *
 * @param feeReduction fraction de réduction boutique (défaut 0 = plein tarif)
 */
function calculateServiceFee(articlePrice, feeReduction) {
    const reduction = normalizeFeeReduction(feeReduction);
    return Math.round(fullServiceFee(articlePrice) * (1 - reduction) * 100) / 100;
}
/**
 * Retourne la config des frais (pour affichage côté client)
 */
function getServiceFeeConfig() {
    return {
        percent: BUYER_FEE_PERCENT,
        fixed: BUYER_FEE_FIXED,
        min: BUYER_FEE_MIN,
    };
}
/**
 * @deprecated — Use getServiceFeeConfig().percent instead
 */
function getServiceFeePercent() {
    return BUYER_FEE_PERCENT;
}
//# sourceMappingURL=fees.js.map