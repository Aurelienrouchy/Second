import type { Swap, SwapStatus } from '@/types';

/** Labels always describe the current participant's perspective. */
export function getSwapStatusLabel(status: SwapStatus, isInitiator = false): string {
  if (status === 'proposed') return isInitiator ? 'Proposition envoyée' : 'Proposition reçue';
  const labels: Record<Exclude<SwapStatus, 'proposed'>, string> = {
    payment_pending: 'Paiement historique en attente',
    accepted: 'Échange accepté',
    photos_pending: 'Photos à ajouter',
    shipping: 'Échange en cours',
    completed: 'Échange terminé',
    declined: 'Proposition refusée',
    cancelled: 'Échange annulé',
    expired: 'Échange expiré',
    disputed: 'Litige ouvert',
  };
  return labels[status];
}

export function getSwapNextStep(swap: Swap, currentUserId: string): string {
  const isInitiator = swap.initiatorId === currentUserId;
  switch (swap.status) {
    case 'proposed':
      return isInitiator ? 'Vous attendez la réponse du membre.' : 'Consultez la proposition pour accepter ou refuser.';
    case 'payment_pending':
      return 'Ce complément appartient à un ancien échange. Les paiements sont indisponibles actuellement.';
    case 'accepted':
      return swap.exchangeMode ? 'Le mode d’échange est choisi.' : 'Choisissez comment échanger vos articles.';
    case 'photos_pending':
      return (isInitiator ? swap.initiatorPhotos?.photos.length : swap.receiverPhotos?.photos.length)
        ? 'Vos photos sont ajoutées. Vous attendez celles du membre.'
        : 'Ajoutez 1 à 4 photos de vos articles avant la remise ou l’envoi.';
    case 'shipping':
      if (isInitiator ? swap.initiatorReceivedAt : swap.receiverReceivedAt) return 'Réception confirmée. Vous attendez la confirmation du membre.';
      if (isInitiator ? swap.initiatorShippedAt : swap.receiverShippedAt) return 'Confirmez la réception une fois les articles reçus.';
      return swap.exchangeMode === 'hand_delivery' ? 'Confirmez la remise de vos articles au membre.' : 'Organisez votre envoi postal, puis confirmez l’envoi.';
    case 'completed':
      return (isInitiator ? swap.initiatorRating : swap.receiverRating) ? 'Merci d’avoir évalué cet échange.' : 'Vous pouvez maintenant évaluer cet échange.';
    case 'declined': return 'Cette proposition a été refusée.';
    case 'cancelled': return 'Cet échange a été annulé.';
    case 'expired': return 'Cet échange n’est plus actif.';
    case 'disputed': return 'Un litige a été ouvert pour cet échange.';
  }
}
