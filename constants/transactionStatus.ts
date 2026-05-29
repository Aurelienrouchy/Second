/**
 * Transaction status metadata — single source of truth.
 *
 * Maps each {@link TransactionStatus} to its FR copy (buyer & seller points of
 * view), the {@link components/ui/Tag.Badge} variant to render, and a semantic
 * tone. All screens consuming a transaction status read from this module so the
 * wording and visual treatment stay consistent across the app.
 *
 * Layer: shared (constants). Must NOT import from core/features/app.
 *
 * Note on `tagVariant`: the value is a string union kept structurally
 * compatible with `BadgeVariant` from `components/ui/Tag`. We do not import that
 * type here to respect ESLint boundaries (shared -> shared only).
 */

import type { TransactionStatus } from '@/types';

/** Mirror of `BadgeVariant` (components/ui/Tag) — kept local for layer isolation. */
export type TransactionTagVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'outline';

/** Semantic tone for screens that adapt layout/iconography beyond the tag color. */
export type TransactionStatusTone = 'neutre' | 'warning' | 'positif' | 'alerte';

export interface TransactionStatusMeta {
  /** Status label shown to the buyer. */
  labelBuyer: string;
  /** Status label shown to the seller. */
  labelSeller: string;
  /**
   * Short description shown to the buyer. May contain the `{fundsReleaseAt}`
   * placeholder for statuses tied to the protection window.
   */
  descriptionBuyer: string;
  /**
   * Short description shown to the seller. May contain the `{fundsReleaseAt}`
   * placeholder for statuses tied to the protection window.
   */
  descriptionSeller: string;
  /** Badge variant to render for this status. */
  tagVariant: TransactionTagVariant;
  /** Semantic tone. */
  tone: TransactionStatusTone;
}

export const TRANSACTION_STATUS_META: Record<TransactionStatus, TransactionStatusMeta> = {
  pending_payment: {
    labelBuyer: 'Paiement en attente',
    labelSeller: 'Paiement en attente',
    descriptionBuyer: "Le paiement n'a pas encore été confirmé.",
    descriptionSeller: "Le paiement n'a pas encore été confirmé.",
    tagVariant: 'warning',
    tone: 'warning',
  },
  meetup_pending: {
    labelBuyer: 'Rencontre à confirmer',
    labelSeller: 'Rencontre à confirmer',
    descriptionBuyer: 'Une rencontre a été proposée, en attente de confirmation.',
    descriptionSeller: 'Une rencontre a été proposée, en attente de confirmation.',
    tagVariant: 'warning',
    tone: 'warning',
  },
  meetup_confirmed: {
    labelBuyer: 'Rencontre confirmée',
    labelSeller: 'Rencontre confirmée',
    descriptionBuyer: 'La rencontre est confirmée. Réglez en main propre.',
    descriptionSeller: 'La rencontre est confirmée. Le règlement se fait en main propre.',
    tagVariant: 'primary',
    tone: 'neutre',
  },
  meetup_completed: {
    labelBuyer: 'Échange terminé',
    labelSeller: 'Échange terminé',
    descriptionBuyer: "L'échange en main propre est confirmé.",
    descriptionSeller: "L'échange en main propre est confirmé.",
    tagVariant: 'success',
    tone: 'positif',
  },
  paid: {
    labelBuyer: 'Payée — en préparation',
    labelSeller: 'À expédier',
    descriptionBuyer: 'Le vendeur prépare votre colis.',
    descriptionSeller: "Paiement reçu. Préparez votre colis, l'étiquette va être générée.",
    tagVariant: 'primary',
    tone: 'neutre',
  },
  label_created: {
    labelBuyer: 'Étiquette prête — bientôt en route',
    labelSeller: 'Étiquette créée — déposez le colis',
    descriptionBuyer: "L'étiquette est prête, le vendeur va déposer votre colis.",
    descriptionSeller: "Votre étiquette d'expédition est prête. Déposez le colis chez le transporteur.",
    tagVariant: 'primary',
    tone: 'neutre',
  },
  shipped: {
    labelBuyer: "En cours d'acheminement",
    labelSeller: 'Colis expédié',
    descriptionBuyer: 'Votre colis est en route. Suivez son acheminement ci-dessous.',
    descriptionSeller: "Colis en transit vers l'acheteur·euse.",
    tagVariant: 'primary',
    tone: 'neutre',
  },
  delivered: {
    labelBuyer: 'Livrée',
    labelSeller: 'Livrée',
    descriptionBuyer: 'Colis livré. Vos fonds sont protégés jusqu’au {fundsReleaseAt}.',
    descriptionSeller: 'Colis livré. Vos fonds seront disponibles le {fundsReleaseAt}.',
    tagVariant: 'success',
    tone: 'positif',
  },
  completed: {
    labelBuyer: 'Vente finalisée',
    labelSeller: 'Vente finalisée',
    descriptionBuyer: 'Vente finalisée. Merci pour votre achat.',
    descriptionSeller: 'Vente finalisée. Le montant est disponible dans votre porte-monnaie.',
    tagVariant: 'success',
    tone: 'positif',
  },
  delivery_failed: {
    labelBuyer: 'Problème de livraison',
    labelSeller: 'Problème de livraison',
    descriptionBuyer: "La livraison n'a pas abouti. Nous avons gelé votre paiement, vous êtes protégé·e.",
    descriptionSeller: 'La livraison a échoué. Un litige est ouvert, les fonds sont gelés le temps de la résolution.',
    tagVariant: 'danger',
    tone: 'alerte',
  },
  lost: {
    labelBuyer: 'Colis égaré',
    labelSeller: 'Colis égaré',
    descriptionBuyer: 'Le colis semble égaré. Nous avons gelé votre paiement, vous êtes protégé·e.',
    descriptionSeller: 'Le colis a été déclaré égaré. Les fonds sont gelés le temps de la résolution.',
    tagVariant: 'danger',
    tone: 'alerte',
  },
  disputed: {
    labelBuyer: 'Litige en cours',
    labelSeller: 'Litige en cours',
    descriptionBuyer: "Un litige est ouvert sur cette commande. Notre équipe l'examine.",
    descriptionSeller: 'Un litige est ouvert. Notre équipe vous contactera si besoin.',
    tagVariant: 'warning',
    tone: 'alerte',
  },
  refund_in_progress: {
    labelBuyer: 'Remboursement en cours',
    labelSeller: 'Remboursement en cours',
    descriptionBuyer: 'Votre remboursement est en cours de traitement.',
    descriptionSeller: 'Un remboursement est en cours sur cette vente.',
    tagVariant: 'warning',
    tone: 'neutre',
  },
  refunded: {
    labelBuyer: 'Remboursée',
    labelSeller: 'Remboursée',
    descriptionBuyer: 'Vous avez été remboursé·e.',
    descriptionSeller: "Cette vente a été remboursée à l'acheteur·euse.",
    tagVariant: 'default',
    tone: 'neutre',
  },
  cancelled: {
    labelBuyer: 'Annulée',
    labelSeller: 'Annulée',
    descriptionBuyer: 'Cette commande a été annulée.',
    descriptionSeller: 'Cette vente a été annulée.',
    tagVariant: 'danger',
    tone: 'alerte',
  },
};

/** Perspective for status copy resolution. */
export type TransactionViewer = 'buyer' | 'seller';

/** Returns the status metadata, defaulting safely if an unknown status slips in. */
export function getTransactionStatusMeta(status: TransactionStatus): TransactionStatusMeta {
  return TRANSACTION_STATUS_META[status] ?? TRANSACTION_STATUS_META.pending_payment;
}

/** Resolves the status label for a given viewer perspective. */
export function getTransactionStatusLabel(
  status: TransactionStatus,
  viewer: TransactionViewer,
): string {
  const meta = getTransactionStatusMeta(status);
  return viewer === 'seller' ? meta.labelSeller : meta.labelBuyer;
}

/**
 * Resolves the status description for a given viewer perspective.
 * Replaces the `{fundsReleaseAt}` placeholder when a formatted date is provided.
 */
export function getTransactionStatusDescription(
  status: TransactionStatus,
  viewer: TransactionViewer,
  fundsReleaseAtLabel?: string,
): string {
  const meta = getTransactionStatusMeta(status);
  const description = viewer === 'seller' ? meta.descriptionSeller : meta.descriptionBuyer;
  if (fundsReleaseAtLabel) {
    return description.replace('{fundsReleaseAt}', fundsReleaseAtLabel);
  }
  return description;
}
