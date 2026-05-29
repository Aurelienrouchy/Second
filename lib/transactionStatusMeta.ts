/**
 * Transaction status metadata — single source of truth for status presentation.
 *
 * Maps every `TransactionStatus` to its FR copy (buyer + seller perspectives)
 * and to a `Badge` variant. Buyer and seller see the SAME technical status but
 * a different formulation (the buyer awaits a parcel, the seller awaits a
 * payment / must ship).
 *
 * Copy is owned by the UX spec (`_bmad-output/UX_PAIEMENT_LIVRAISON_spec.md`).
 * Shared layer: contains no UI dependency — the `variant` string is consumed by
 * the `Badge` component (`components/ui/Tag.tsx`). The literal union below mirrors
 * `BadgeVariant` (minus `outline`, unused for statuses) so screens can pass it
 * straight to `<Badge variant={...} />`.
 */

import type { TransactionStatus } from '@/types';

/** Subset of `BadgeVariant` used for transaction status pills. */
export type StatusBadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger';

export type StatusPerspective = 'buyer' | 'seller';

interface StatusMeta {
  /** Buyer-facing label. */
  labelBuyer: string;
  /** Seller-facing label. */
  labelSeller: string;
  /** Badge variant (color/tone). */
  variant: StatusBadgeVariant;
  /** Buyer-facing short description (detail screens). */
  descriptionBuyer: string;
  /** Seller-facing short description (detail screens). */
  descriptionSeller: string;
}

/**
 * `{fundsReleaseAt}` placeholder is left intact here; callers substitute the
 * formatted date with `fillFundsReleaseAt()` once they have the transaction.
 */
const STATUS_META: Record<TransactionStatus, StatusMeta> = {
  pending_payment: {
    labelBuyer: 'Paiement en attente',
    labelSeller: 'Paiement en attente',
    variant: 'warning',
    descriptionBuyer: "Le paiement n'a pas encore été confirmé.",
    descriptionSeller: "Le paiement n'a pas encore été confirmé.",
  },
  meetup_pending: {
    labelBuyer: 'Rencontre à confirmer',
    labelSeller: 'Rencontre à confirmer',
    variant: 'warning',
    descriptionBuyer: 'Une rencontre a été proposée, en attente de confirmation.',
    descriptionSeller: 'Une rencontre a été proposée, en attente de confirmation.',
  },
  meetup_confirmed: {
    labelBuyer: 'Rencontre confirmée',
    labelSeller: 'Rencontre confirmée',
    variant: 'primary',
    descriptionBuyer: 'La rencontre est confirmée. Réglez en main propre.',
    descriptionSeller: 'La rencontre est confirmée. Le règlement se fait en main propre.',
  },
  meetup_completed: {
    labelBuyer: 'Réglée en main propre',
    labelSeller: 'Réglée en main propre',
    variant: 'success',
    descriptionBuyer: "L'échange en main propre est confirmé.",
    descriptionSeller: "L'échange en main propre est confirmé.",
  },
  paid: {
    labelBuyer: 'Payée — en préparation',
    labelSeller: 'À expédier',
    variant: 'primary',
    descriptionBuyer: 'Le vendeur prépare votre colis.',
    descriptionSeller: "Paiement reçu. Préparez votre colis, l'étiquette va être générée.",
  },
  label_created: {
    labelBuyer: 'Étiquette prête — bientôt en route',
    labelSeller: 'Étiquette créée — déposez le colis',
    variant: 'primary',
    descriptionBuyer: "L'étiquette est prête, le vendeur va déposer votre colis.",
    descriptionSeller: "Votre étiquette d'expédition est prête. Déposez le colis chez le transporteur.",
  },
  shipped: {
    labelBuyer: "En cours d'acheminement",
    labelSeller: 'Colis expédié',
    variant: 'primary',
    descriptionBuyer: 'Votre colis est en route. Suivez son acheminement ci-dessous.',
    descriptionSeller: "Colis en transit vers l'acheteur·euse.",
  },
  delivered: {
    labelBuyer: 'Livrée',
    labelSeller: 'Livrée',
    variant: 'success',
    descriptionBuyer: 'Colis livré. Vos fonds sont protégés jusqu\'au {fundsReleaseAt}.',
    descriptionSeller: 'Colis livré. Vos fonds seront disponibles le {fundsReleaseAt}.',
  },
  completed: {
    labelBuyer: 'Vente finalisée',
    labelSeller: 'Vente finalisée',
    variant: 'success',
    descriptionBuyer: 'Vente finalisée. Merci pour votre achat.',
    descriptionSeller: 'Vente finalisée. Le montant est disponible dans votre porte-monnaie.',
  },
  return_requested: {
    labelBuyer: 'Retour demandé',
    labelSeller: 'Retour en cours',
    variant: 'warning',
    descriptionBuyer: 'Votre demande de retour est en cours de validation. Vous recevrez l\'étiquette de retour et les instructions ici même.',
    descriptionSeller: 'L\'acheteur·euse a demandé un retour. Les fonds restent gelés le temps de la réception du colis.',
  },
  delivery_failed: {
    labelBuyer: 'Problème de livraison',
    labelSeller: 'Problème de livraison',
    variant: 'danger',
    descriptionBuyer: "La livraison n'a pas abouti. Nous avons gelé votre paiement, vous êtes protégé·e.",
    descriptionSeller: 'La livraison a échoué. Un litige est ouvert, les fonds sont gelés le temps de la résolution.',
  },
  lost: {
    labelBuyer: 'Colis égaré',
    labelSeller: 'Colis égaré',
    variant: 'danger',
    descriptionBuyer: 'Le colis semble égaré. Nous avons gelé votre paiement, vous êtes protégé·e.',
    descriptionSeller: 'Le colis a été déclaré égaré. Les fonds sont gelés le temps de la résolution.',
  },
  disputed: {
    labelBuyer: 'Litige en cours',
    labelSeller: 'Litige en cours',
    variant: 'warning',
    descriptionBuyer: "Un litige est ouvert sur cette commande. Notre équipe l'examine.",
    descriptionSeller: 'Un litige est ouvert. Notre équipe vous contactera si besoin.',
  },
  refund_in_progress: {
    labelBuyer: 'Remboursement en cours',
    labelSeller: 'Remboursement en cours',
    variant: 'warning',
    descriptionBuyer: 'Votre remboursement est en cours de traitement.',
    descriptionSeller: 'Un remboursement est en cours sur cette vente.',
  },
  refunded: {
    labelBuyer: 'Remboursée',
    labelSeller: 'Remboursée',
    variant: 'default',
    descriptionBuyer: 'Vous avez été remboursé·e.',
    descriptionSeller: "Cette vente a été remboursée à l'acheteur·euse.",
  },
  cancelled: {
    labelBuyer: 'Annulée',
    labelSeller: 'Annulée',
    variant: 'danger',
    descriptionBuyer: 'Cette commande a été annulée.',
    descriptionSeller: 'Cette vente a été annulée.',
  },
};

/** Returns the status label for the given perspective. */
export function getStatusLabel(
  status: TransactionStatus,
  perspective: StatusPerspective,
): string {
  const meta = STATUS_META[status];
  return perspective === 'seller' ? meta.labelSeller : meta.labelBuyer;
}

/** Returns the `Badge` variant for the given status. */
export function getStatusVariant(status: TransactionStatus): StatusBadgeVariant {
  return STATUS_META[status].variant;
}

/** Returns the short description for the given perspective (placeholders intact). */
export function getStatusDescription(
  status: TransactionStatus,
  perspective: StatusPerspective,
): string {
  const meta = STATUS_META[status];
  return perspective === 'seller' ? meta.descriptionSeller : meta.descriptionBuyer;
}

/**
 * Substitutes the `{fundsReleaseAt}` placeholder with a formatted date.
 * Returns the input unchanged when there is no date to inject.
 */
export function fillFundsReleaseAt(text: string, formattedDate?: string): string {
  if (!text.includes('{fundsReleaseAt}')) return text;
  return text.replace('{fundsReleaseAt}', formattedDate ?? 'sous peu');
}
