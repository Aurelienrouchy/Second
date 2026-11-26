import type {Transaction} from '@/types';
import {getRefundPresentation, hasBankObligation, hasUnsettledRefund} from '@/utils/refundPresentation';
import {hasRecordedOrderLabel, hasRecordedOrderPayment} from '@/utils/conversationTimeline';

export function orderDetailPresentation(order: Transaction, uid: string, correction = false) {
  const seller = order.sellerId === uid, refund = getRefundPresentation(order, seller ? 'seller' : 'buyer');
  if (correction) return {title: 'La livraison doit être vérifiée', description: 'Notre équipe examine le suivi de votre colis.', attention: true};
  if (order.refundBlocked || Object.prototype.hasOwnProperty.call(order, 'fraudReview')) return {title: 'Votre commande est en cours d’examen', description: 'Notre équipe vous tiendra informé.', attention: true};
  if (hasBankObligation(order)) return {title: 'Une vérification est en cours', description: 'Une contestation concerne le paiement de cette commande.', attention: true};
  if (refund) return {title: refund.title, description: hasUnsettledRefund(order) ? 'Retrouvez la suite dans l’aide de cette commande.' : '', attention: true};
  if (order.status === 'disputed' || order.disputed) return {title: 'Votre demande est en cours', description: 'Notre équipe examine la situation.', attention: true};
  if (order.status === 'return_requested' || order.returnRequest && ['reserved', 'preparing', 'quoted', 'requested', 'unknown', 'reconciliation_required'].includes(order.returnRequest.state))
    return {title: 'Le retour est en cours', description: 'Retrouvez les prochaines étapes de votre retour.', attention: true};
  if (['delivery_failed', 'lost'].includes(order.status)) return {title: 'Un incident de livraison est signalé', description: 'Notre équipe peut vous aider à retrouver votre colis.', attention: true};
  switch (order.status) {
    case 'pending_payment': return seller ? {title: 'En attente du paiement', description: 'Vous serez averti lorsque l’acheteur aura payé.', attention: false}
      : {title: 'Votre article vous attend', description: 'Finalisez le paiement pour lancer l’envoi.', attention: false};
    case 'paid': return {title: seller ? 'Votre étiquette se prépare' : 'Le vendeur prépare votre colis',
      description: seller ? 'Elle apparaîtra ici dès qu’elle sera prête.' : 'Vous serez averti dès son expédition.', attention: false};
    case 'label_created': return {title: seller ? hasRecordedOrderLabel(order) ? 'Votre étiquette est prête' : 'Votre étiquette se prépare' : 'Le vendeur prépare votre colis',
      description: seller ? hasRecordedOrderLabel(order) ? 'Imprimez-la, puis déposez votre colis.' : 'Actualisez pour retrouver votre étiquette.' : 'Vous serez averti dès son expédition.', attention: false};
    case 'shipped': return {title: 'Votre colis est en route', description: '', attention: false};
    case 'delivered': return {title: 'La livraison est signalée', description: seller ? '' : 'Confirmez la réception lorsque vous avez votre colis.', attention: false};
    case 'completed': return {title: 'La vente est terminée', description: '', attention: false};
    case 'cancelled': return {title: 'La commande est annulée', description: '', attention: false};
    case 'meetup_pending': return {title: 'La rencontre est à confirmer', description: 'Organisez la remise dans votre conversation.', attention: false};
    case 'meetup_confirmed': return {title: 'La rencontre est confirmée', description: 'Retrouvez le rendez-vous dans votre conversation.', attention: false};
    case 'meetup_completed': return {title: 'La remise est terminée', description: '', attention: false};
    default: return {title: 'Votre commande', description: '', attention: false};
  }
}

/** Dates come from this private order; future steps and IDs are never invented. */
export function orderMilestones(order: Transaction) {
  const simulated = order.carrierCode === 'seconde_dev';
  const hasProgress = hasRecordedOrderPayment(order) || hasRecordedOrderLabel(order);
  const candidates: Array<{title: string; at: unknown}> = [
    {title: 'Commande créée', at: order.createdAtKnown === false || hasProgress ? null : order.createdAt},
    {title: 'Paiement confirmé', at: hasRecordedOrderPayment(order) ? order.paidAt : null},
    {title: 'Étiquette prête', at: hasRecordedOrderLabel(order) ? order.labelCreatedAt : null},
    {title: simulated ? 'Envoi simulé' : 'Colis expédié', at: order.shippedAt},
    {title: simulated ? 'Livraison simulée' : 'Livraison signalée', at: order.deliveredAt},
    {title: 'Vente terminée', at: order.fundsReleasedAt},
  ];
  return candidates.filter((item): item is {title: string; at: Date} => item.at instanceof Date && Number.isFinite(item.at.getTime())).slice(-4);
}
