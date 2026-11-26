import { runtimeEnvironment } from './firebaseEnvironment';

/**
 * featureFlags — Drapeaux de fonctionnalités centralisés et réversibles.
 *
 * Source de vérité unique pour activer/désactiver des fonctionnalités produit
 * sans supprimer le code associé. Les rails commerciaux s'activent uniquement
 * avec la valeur exacte `true` dans l'environnement public Expo choisi par EAS.
 * Leurs contrôles serveur restent indépendants.
 */

/**
 * Active la livraison/expédition (shipping) dans l'UI.
 *
 * Fermé par défaut. L'activation publique explicite ne remplace pas
 * la qualification des transporteurs ni l'activation du rail serveur.
 */
/** Recette native locale de la V1, exclusivement contre le serveur Seconde Dev. */
export const PHASE1_QA_ENABLED = process.env.EXPO_PUBLIC_PHASE1_QA === 'true' &&
  runtimeEnvironment.name === 'development' && runtimeEnvironment.projectId === 'seconde-dev' &&
  !runtimeEnvironment.useEmulators;

const CLOUD_COMMERCE_ENVIRONMENT = !PHASE1_QA_ENABLED && !runtimeEnvironment.useEmulators && (
  runtimeEnvironment.name === 'development' && runtimeEnvironment.projectId === 'seconde-dev' ||
  runtimeEnvironment.name === 'production' && runtimeEnvironment.projectId === 'seconde-b47a6'
);
export const SHIPPING_ENABLED = CLOUD_COMMERCE_ENVIRONMENT && process.env.EXPO_PUBLIC_SHIPPING_ENABLED === 'true';
/** Seconde Dev may prepare shipping listings while the purchase rail stays closed. */
export const SHIPPING_LISTINGS_ENABLED = !PHASE1_QA_ENABLED && (SHIPPING_ENABLED || (
  runtimeEnvironment.name === 'development' && runtimeEnvironment.projectId === 'seconde-dev' && !runtimeEnvironment.useEmulators
));
/** Collecte et refus de colis : nouveaux actes fermés pendant les contre-revues. */
export const TRANSPORT_CONTACT_REVIEW_ENABLED = true;

/**
 * Paiements marketplace / Stripe Connect.
 * Gardé désactivé pendant la bêta tant que le parcours financier complet
 * n'est pas validé. Les écrans liés au paiement ne doivent pas être exposés.
 */
export const PAYMENTS_ENABLED = CLOUD_COMMERCE_ENVIRONMENT && process.env.EXPO_PUBLIC_PAYMENTS_ENABLED === 'true';
/** Tools that simulate transport are never exposed by a production or emulator build. */
export const DEV_COMMERCE_TESTING_ENABLED = runtimeEnvironment.name === 'development' &&
  runtimeEnvironment.projectId === 'seconde-dev' && !runtimeEnvironment.useEmulators &&
  process.env.EXPO_PUBLIC_COMMERCE_TEST_MODE === 'true' && PAYMENTS_ENABLED && SHIPPING_ENABLED;
/** Le pilote Square utilise uniquement le Sandbox sur le projet Seconde Dev. */
export const SQUARE_INVENTORY_PILOT_ENABLED = !PHASE1_QA_ENABLED && runtimeEnvironment.name === 'development' &&
  runtimeEnvironment.projectId === 'seconde-dev' && !runtimeEnvironment.useEmulators;
/** Surcharges et indemnisation transporteur : nouveaux actes fermés pendant les contre-revues. */
export const CARRIER_COST_CLAIM_ENABLED = true;
/** Dossier bancaire et consultations d'images contrevérifiés ; H19 reste distinct. */
export const BANK_DISPUTE_CASE_ENABLED = true;
/** H19 : rapports/instructions documentaires seulement, fermés pendant les contre-revues. */
export const BANK_REFUND_RECONCILIATION_ENABLED = true;

/** Nouveaux constats/instructions de routage P ; lectures et reçus conservés. */
export const PRODUCT_ROUTING_REVIEW_ENABLED = true;
/** F11 : déclarations et revue des mélanges contrevérifiées ; gates paiement/livraison distinctes. */
export const PRODUCT_MIXED_ORDERS_REVIEW_ENABLED = true;

/** Examen humain des liens entre comptes contrevérifié ; couverture legacy exhaustive encore distincte. */
export const ACCOUNT_RELATIONSHIP_REVIEW_ENABLED = true;
/** Inventaire privé de paire contrevérifié ; pages successives et couverture historique non exhaustive. */
export const ACCOUNT_RELATIONSHIP_INVENTORY_ENABLED = true;
/** G20 : retrait documentaire et réexamen contrevérifiés ; admission courante et historique séparés. */
export const COMMERCIAL_CLAIM_REVIEW_ENABLED = true;

/** Complément Troc manuel et reprises contrevérifiés ; gates paiement/livraison distinctes, servicing SDK conservé. */
export const SWAP_TOPUP_MANUAL_ENABLED = true;

// Support confinement and reference-only servicing independently reviewed.
export const SUPPORT_CONFIDENTIALITY_ENABLED = true;
/** L08 : revue documentaire contrevérifiée, sans permission financière ou physique. */
export const SWAP_DISPUTE_REVIEW_ENABLED = true;
