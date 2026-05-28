/**
 * featureFlags — Drapeaux de fonctionnalités centralisés et réversibles.
 *
 * Source de vérité unique pour activer/désactiver des fonctionnalités produit
 * sans supprimer le code associé. Pour réactiver une fonctionnalité, repasser
 * le drapeau à `true` — aucun autre changement requis.
 */

/**
 * Active la livraison/expédition (shipping) dans l'UI.
 *
 * Temporairement désactivé : seul le "main à main" (meetup) est proposé tant
 * que le flux d'expédition n'est pas prêt. Les blocs UI liés au shipping sont
 * masqués conditionnellement et les nouveaux articles sont forcés en
 * main-à-main. Repasser à `true` pour tout réactiver.
 */
export const SHIPPING_ENABLED = false;
