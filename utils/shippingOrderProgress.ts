import type {Transaction} from '@/types/transaction';
import {getPaymentBlockReason, hasBankObligation, hasUnsettledRefund} from '@/utils/refundPresentation';
import {hasRecordedOrderLabel} from '@/utils/conversationTimeline';

/** Presentation only: each destination re-reads the private order before acting. */
export function shippingOrderProgress(order: Transaction, uid: string) {
  if (order.deliveryType !== 'shipping' || ![order.buyerId, order.sellerId].includes(uid)) return null;
  const seller = order.sellerId === uid;
  const labelReady = hasRecordedOrderLabel(order);
  if (hasBankObligation(order) || hasUnsettledRefund(order) || order.disputed || order.refundBlocked) {
    return {title: 'Commande en cours d’examen', action: 'Voir le suivi', destination: 'order' as const};
  }
  if (order.status === 'pending_payment') return seller
    ? {title: 'En attente du paiement', action: 'Voir la commande', destination: 'order' as const}
    : {title: 'Votre commande est réservée', action: getPaymentBlockReason(order, uid) === null ? 'Continuer le paiement' : 'Consulter la commande',
      destination: getPaymentBlockReason(order, uid) === null ? 'payment' as const : 'order' as const};
  if (order.status === 'paid' || order.status === 'label_created') return {
    title: labelReady ? 'Étiquette prête' : 'Préparation de l’envoi',
    action: seller ? labelReady ? 'Voir l’envoi' : 'Préparer l’envoi' : 'Suivre le colis', destination: seller ? 'order' as const : 'tracking' as const,
  };
  if (order.status === 'shipped') return {title: 'Colis en route', action: 'Suivre le colis', destination: 'tracking' as const};
  if (order.status === 'delivered') return {title: 'Livraison signalée', action: 'Voir le suivi', destination: 'tracking' as const};
  if (order.status === 'completed') return {title: 'Commande terminée', action: 'Voir le suivi', destination: 'tracking' as const};
  return {title: 'Suivi de la commande', action: 'Voir le suivi', destination: 'order' as const};
}
