import type { SwapTopUpCommand, SwapTopUpProviderStatus } from '@/types/swapTopUpCheckout';
export const SWAP_TOPUP_ACTION_LABELS: Record<SwapTopUpCommand['action'], string> = {
  prepare: 'Préparation du complément manuel', confirm: 'Confirmation serveur du complément', retire_legacy: 'Neutralisation de l’ancien paiement exact',
};
export const SWAP_TOPUP_STATUS_LABELS: Record<SwapTopUpProviderStatus, string> = {
  requires_payment_method: 'Moyen de paiement requis', requires_confirmation: 'Nouvelle confirmation serveur requise', requires_action: 'Authentification requise',
  processing: 'Traitement en cours', requires_capture: 'Autorisation à rapprocher', canceled: 'Annulation prestataire observée', succeeded: 'Encaissement prestataire observé', unknown: 'Résultat inconnu',
};
export function createSwapTopUpInteraction() {
  let epoch = 0;
  return {invalidate: () => {epoch++;}, capture: () => {const expected = epoch; return () => {if (epoch !== expected) throw new Error('Le Troc, le montant ou votre choix ont changé. Relisez la même intention.');};}};
}
