/**
 * Types — Notifications in-app et push.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

import type { Swap } from './swap';

// Notification types
export type NotificationType =
  | 'support_deadline'
  | 'account_security'
  | 'eligibility_review'
  | 'shop_created'
  | 'shop_approved'
  | 'shop_rejected'
  | 'new_message'
  | 'article_liked'
  | 'article_favorited'    // Quelqu'un a ajouté mon article en favori
  | 'article_sold'
  | 'price_drop'           // Baisse de prix sur un article en favori
  | 'saved_search'         // Nouveaux articles pour une recherche enregistrée
  | 'offer_received'
  | 'offer_counter'        // Contre-offre reçue
  | 'offer_accepted'       // Offre acceptée
  | 'offer_rejected'       // Offre refusée
  | 'offer_expired'        // Offre expirée
  | 'meetup_reminder'      // Rappel de meetup (1h avant)
  | 'meetup_confirmed'     // Meetup confirmé
  | 'meetup_completed'     // Rencontre déclarée terminée, sans preuve de paiement
  | 'meetup_cancelled'     // Meetup annulé
  | 'no_show_reported'     // No-show signalé
  | 'swap_zone_reminder'   // Rappel Swap Zone (3 jours avant)
  | 'swap_proposed'
  | 'swap_accepted'
  | 'swap_declined'
  | 'swap_photos_uploaded'
  | 'swap_shipped'
  | 'swap_received'
  | 'swap_completed'
  | 'swap_party_starting'
  | 'swap_party_ending'
  | 'swap_match_found'
  | 'swap_update'          // Mise à jour générique d'un swap (serveur)
  // Order lifecycle (émis serveur via sendPushNotification)
  | 'new_sale'             // Nouvelle vente côté vendeur
  | 'order_paid'           // Paiement enregistré côté acheteur
  | 'order_shipped'        // Colis expédié
  | 'order_delivered'      // Colis livré
  | 'buyer_receipt_declared' // Déclaration humaine, distincte du scan et des fonds
  | 'order_cancelled'      // Commande annulée
  | 'order_refunded'       // Commande remboursée
  | 'order_moderation'     // Instruction privée liée à une commande existante
  | 'shipping_update'      // Avis privé du cycle d’étiquette, sans permission de dépôt
  | 'article_moderation'   // Décision privée sur un article existant
  | 'product_review_update' // Échange privé d’examen du produit, sans autorité matérielle
  | 'dispute_resolved'     // Décision privée sur un dossier commercial
  | 'withdrawal_update'    // État natif d'un retrait, consultation privée du portefeuille
  | 'funds_released'       // Fonds libérés au vendeur (fin fenêtre protection)
  | 'review_received'      // Nouvel avis reçu
  | 'moderation_update'    // Décision adressée sur un contenu exact
  | 'privacy_incident';    // Incident de confidentialité (Loi 25)

export interface NotificationData {
  supportUpdateProtocol?: 'support_owner_update_v1';
  supportCommandId?: string;
  supportAction?: 'request_details' | 'respond';
  supportRequestVersion?: string;
  proofId?: string;
  sourceHash?: string;
  bankCaseCapability?: 'bank_dispute_case_v1';
  bankCaseEntryId?: string;
  bankCaseEntryHash?: string;
  deadlineLane?: 'dated' | 'unknown' | 'bank';
  sourceCollection?: 'support_requests' | 'bank_dispute_cases';
  alertId?: string;
  supportRequestId?: string;
  accountRelationshipCapability?: 'account_relationship_review_v1';
  accountRelationshipPairId?: string;
  accountRelationshipEntryId?: string;
  accountRelationshipEntryHash?: string;
  accountRelationshipVersion?: string;
  contentSafetyCapability?: 'content_safety_v1';
  contentTargetType?: 'review'|'message';
  contentTargetId?: string;
  contentCaseId?: string;
  contentEntryId?: string;
  contentEntryHash?: string;
  contentEntryVersion?: string;
  reportId?: string;
  ownerId?: string;
  labelLifecycleCaseId?: string;
  labelLifecycleLeg?: 'forward' | 'return';
  labelLifecycleEntryId?: string;
  labelLifecycleNoticeState?: 'intent_reserved' | 'entry_recorded';
  labelRouteAmendmentEntryId?: string;
  labelRouteAmendmentContentHash?: string;
  routeAmendmentCapability?: 'label_route_amendment_v1';
  parcelAmendmentCapability?: 'label_parcel_amendment_v1';
  productReviewCaseId?: string;
  contextKind?: 'order' | 'article_report' | 'article_listing';
  contextId?: string;
  productReviewEventId?: string;
  productReviewEvidenceId?: string;
  productReviewAdmissionId?: string;
  lateCommercialCapability?: 'late_commercial_recourse_v1';
  lateCommercialAdmissionId?: string;
  lateCommercialAdmissionHash?: string;
  productPhysicalInstructionId?: string;
  productPhysicalSignalId?: string;
  childPublicationCommandId?: string;
  withdrawalRequestId?: string;
  state?: 'paid' | 'failed' | 'canceled' | 'awaiting_return' | 'recovered' | 'reconciliation_required';
  payoutId?: string;
  amountCents?: string;
  currency?: 'CAD';
  debitLedgerId?: string;
  transferId?: string;
  compensationLedgerId?: string;
  reversalId?: string;
  returnBalanceTransactionId?: string;
  failureBalanceTransactionId?: string;
  bankAction?: string;
  reason?: string;
  disputeId?: string;
  providerOutcome?: string;
  noticeState?: string;
  articleId?: string;
  decisionId?: string;
  favorableRecorded?: 'true';
  listingReactivated?: 'true' | 'false';
  transactionId?: string;
  receiptDeclarationCommandId?: string;
  deepLink?: string;
  savedSearchId?: string;
  articleTitle?: string;
  chatId?: string;
  partyId?: string;
  partyName?: string;
  userId?: string;
  userName?: string;
  amount?: number;
  oldPrice?: number;
  newPrice?: number;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: NotificationData;
  isRead: boolean;
  createdAt: Date;
}
