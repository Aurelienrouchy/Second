import type { Swap, SwapStatus } from '@/types';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';

/** Labels describe the current participant’s next step, never a guessed payment. */
export function getSwapStatusLabel(status: SwapStatus, isInitiator = false): string {
  if (status === 'proposed') return isInitiator ? 'Proposition envoyée' : 'Proposition reçue';
  const labels: Record<Exclude<SwapStatus, 'proposed'>, string> = {
    payment_pending: PAYMENTS_ENABLED ? 'Complément à régler' : 'Paiement historique en attente', accepted: 'Échange accepté', photos_pending: 'Préparer l’échange',
    shipping: 'Échange en cours', completed: 'Échange terminé', declined: 'Proposition refusée',
    cancelled: 'Échange annulé', expired: 'Échange expiré', disputed: 'Un problème est en cours d’examen',
  };
  return labels[status];
}
export function getSwapPhotoCount(swap: Swap, side: 'initiator' | 'receiver'): number {
  const proof = side === 'initiator' ? swap.initiatorPhotos : swap.receiverPhotos;
  const owner = side === 'initiator' ? swap.initiatorId : swap.receiverId;
  return proof?.userId === owner && Array.isArray(proof.photos) && proof.photos.length <= 4 && proof.photos.every(photo => typeof photo === 'string' && !!photo) ? proof.photos.length : 0;
}
/** Presentation only; fulfilment still validates both exact acknowledgements on the server. */
export function hasSwapAgreementConfirmations(swap: Swap): boolean {
  const a = swap.exchangeAgreement;
  const recorded = (value: unknown) => value instanceof Date ? Number.isFinite(value.getTime()) : !!value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function';
  return !!a && a.exchangeMode === swap.exchangeMode && !!a.sourceHash &&
    a.initiatorAcknowledgement?.actorUid === swap.initiatorId && a.initiatorAcknowledgement.sourceHash === a.sourceHash && recorded(a.initiatorAcknowledgement.recordedAt) &&
    a.receiverAcknowledgement?.actorUid === swap.receiverId && a.receiverAcknowledgement.sourceHash === a.sourceHash && recorded(a.receiverAcknowledgement.recordedAt);
}
export function getSwapNextStep(swap: Swap, currentUserId: string): string {
  const isInitiator = swap.initiatorId === currentUserId;
  const received = isInitiator ? swap.initiatorReceivedAt : swap.receiverReceivedAt;
  const sent = isInitiator ? swap.initiatorShippedAt : swap.receiverShippedAt;
  const otherSent = isInitiator ? swap.receiverShippedAt : swap.initiatorShippedAt;
  switch (swap.status) {
    case 'proposed': return isInitiator ? 'Vous attendez la réponse du membre.' : 'Une proposition pour vos articles.';
    case 'payment_pending': return !PAYMENTS_ENABLED ? (isInitiator ? 'Le paiement est momentanément indisponible. Contactez le membre ou annulez la proposition.' : 'Le paiement est momentanément indisponible. Contactez le membre ou l’assistance pour la suite.')
      : !swap.cashTopUp || ![swap.initiatorId, swap.receiverId].includes(swap.cashTopUp.payerId) ? 'Le paiement du complément doit être vérifié.' : swap.cashTopUp?.payerId === currentUserId ? 'Réglez le complément pour poursuivre votre échange.' : 'Vous attendez le règlement du complément par l’autre membre.';
    case 'accepted':
    case 'photos_pending':
      if (swap.exchangeMode === 'hand_delivery') return received ? 'Réception confirmée. Vous attendez la confirmation du membre.' : 'Retrouvez-vous, puis confirmez la réception des articles.';
      if (!swap.exchangeMode) return 'Convenez de la remise avec le membre.';
      return getSwapPhotoCount(swap, isInitiator ? 'initiator' : 'receiver')
        ? 'Vos photos sont ajoutées. Vous attendez celles du membre.' : 'Ajoutez vos photos avant l’envoi.';
    case 'shipping':
      if (received) return 'Réception confirmée. Vous attendez la confirmation du membre.';
      if (swap.exchangeMode === 'hand_delivery') return 'Confirmez la réception une fois les articles en main.';
      if (!sent) return otherSent ? 'L’autre membre a envoyé ses articles. Organisez aussi votre envoi.' : 'Préparez votre colis et organisez l’envoi avec le membre.';
      return otherSent ? 'Confirmez la réception une fois les articles reçus.' : 'Votre envoi est confirmé. Vous attendez celui du membre.';
    case 'completed': return (isInitiator ? swap.initiatorRating : swap.receiverRating) ? 'Merci d’avoir évalué cet échange.' : 'Comment s’est passé votre échange ?';
    case 'declined': return 'Cette proposition a été refusée.';
    case 'cancelled': return 'Cet échange a été annulé.';
    case 'expired': return 'Cette proposition n’est plus active.';
    case 'disputed': return 'Notre équipe vous accompagne pour la suite.';
  }
}
