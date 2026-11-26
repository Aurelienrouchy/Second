/**
 * Types — Swap et SwapZone : zone, articles déposés, cycle d'échange.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

import type { Article, ArticleSize } from './article';
import type { Chat, Message } from './chat';

// ============================================
// SWAP SYSTEM TYPES
// ============================================

// Swap Zone — single, always-active generalist zone (no time window, no theme,
// no participants). The deterministic doc is swapParties/generalist.
export interface SwapParty {
  id: string;
  name: string;
  isGeneralist?: boolean; // true = all items accepted (always true for the zone)
  itemsCount?: number;
  swapsCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// Item in a Swap Party (reference to an Article)
export interface SwapPartyItem {
  id: string;
  partyId: string;
  articleId: string;
  sellerId: string;
  sellerName: string;
  sellerImage?: string;
  title: string;
  price: number; // Valeur estimée pour le swap
  imageUrl?: string;
  isSwapped: boolean;
  addedAt: Date;
}

// Extended SwapPartyItem with full Article metadata for filtering
export interface SwapPartyItemExtended extends SwapPartyItem {
  categoryIds?: string[];
  size?: ArticleSize | null;
  brand?: string;
  color?: string;
  material?: string;
  pattern?: string;
  condition?: 'neuf' | 'neuf sans étiquette' | 'très bon état' | 'bon état' | 'satisfaisant';
}

// Swap status
export type SwapStatus =
  | 'proposed'         // Proposition envoyée
  | 'payment_pending'  // Acceptée avec complément — en attente du paiement Stripe
  | 'accepted'         // Acceptée (sans complément, OU après paiement du complément)
  | 'declined'         // Refusée
  | 'cancelled'        // Annulée par l'initiateur
  | 'photos_pending'   // En attente des photos
  | 'shipping'         // En cours d'envoi
  | 'completed'        // Échange terminé
  | 'disputed'         // Litige ouvert
  | 'expired';         // Statut historique conservé ; aucune nouvelle expiration automatique après acceptation

// Swap photo proof
export interface SwapPhotoProof {
  userId: string;
  photos: string[]; // URLs
  uploadedAt: Date;
  isValidated: boolean;
}

// Info for a single item in a swap (used in arrays)
export interface SwapItemInfo {
  articleId: string;
  /** Native promised content; never supplied from the current listing after agreement. */
  description?: string;
  saleUnit?: Article['saleUnit'];
  listingContentVersion?: 'listing_content_v1' | 'listing_content_v2';
  title: string;
  price: number;
  imageUrl?: string;
  brand?: string;
  size?: ArticleSize | null;
}

// Swap exchange mode
export type SwapExchangeMode = 'hand_delivery' | 'shipping';

export interface SwapAgreementPreview {
  protocol: 'swap_exchange_agreement_v1';
  scope: 'new_proposal' | 'legacy_preparation';
  sourceHash: string;
  termsVersion: '2026-10-17.v1';
  termsText: string;
  exchangeMode: SwapExchangeMode;
  arrangements: string;
  message: string | null;
  initiatorId: string;
  receiverId: string;
  initiatorItems: SwapAgreementItem[];
  receiverItems: SwapAgreementItem[];
  cashTopUp: { amount: number; payerId: string } | null;
}
/** The complete native snapshot is retained; presentation never re-reads the listing. */
export interface SwapAgreementItem extends SwapItemInfo {
  [field: string]: unknown;
}
export type SwapProposalPreviewInput = {
  operation: 'swap_proposal_preview'; expectedUid: string; receiverId: string;
  initiatorArticleIds: string[]; receiverArticleIds: string[]; exchangeMode: SwapExchangeMode;
  arrangements: string; cashTopUp?: { amount: number; payerId: string };
  message?: string | null;
};
export type SwapExchangePreviewInput = {
  operation: 'swap_exchange_preview'; expectedUid: string; swapId: string;
  exchangeMode: SwapExchangeMode; arrangements: string;
};
export interface SwapAgreementAcknowledgement {
  expectedUid: string; agreementProtocol: 'swap_exchange_agreement_v1'; expectedSourceHash: string;
}

// Swap - An exchange between two users (supports multi-article)
export interface Swap {
  id: string;
  /** Native privacy marker; commercial snapshots, status and possession remain unchanged. */
  articlePrivacyWithdrawals?: Record<string, { schemaVersion: 1; articleId: string; operationId: string; withdrawnAt: unknown }>;
  partyId?: string; // Optional: if swap originated from a party

  // Initiator (person who proposed)
  initiatorId: string;
  initiatorName: string;
  initiatorImage?: string;

  // Multi-article: arrays of items on each side
  initiatorItems: SwapItemInfo[];
  receiverItems: SwapItemInfo[];
  initiatorTotalValue: number;   // Sum of initiator items prices
  receiverTotalValue: number;    // Sum of receiver items prices

  // @deprecated — kept for backward compat with old single-item swaps
  initiatorItemId?: string;
  initiatorItem?: SwapItemInfo;
  receiverItemId?: string;
  receiverItem?: SwapItemInfo;

  // Receiver (person who received proposal)
  receiverId: string;
  receiverName: string;
  receiverImage?: string;

  // Cash top-up (if any). amount is IN CENTS.
  cashTopUp?: {
    amount: number;
    payerId: string; // Who pays the difference
  };
  // Stripe payment for the cash top-up
  paymentIntentId?: string;
  topUpFee?: number; // Service fee charged on top of the top-up (cents)
  paidAt?: Date;

  // Exchange details
  exchangeMode?: SwapExchangeMode;
  exchangeAgreement?: Omit<SwapAgreementPreview, 'initiatorId' | 'receiverId' | 'initiatorItems' | 'receiverItems' | 'cashTopUp' | 'message'> & {
    initiatorAcknowledgement: { actorUid: string; sourceHash: string; recordedAt: unknown } | null;
    receiverAcknowledgement: { actorUid: string; sourceHash: string; recordedAt: unknown } | null;
  };
  status: SwapStatus;
  message?: string; // Message from initiator

  // Photo proofs
  initiatorPhotos?: SwapPhotoProof;
  receiverPhotos?: SwapPhotoProof;

  // Shipping confirmations
  initiatorShippedAt?: Date;
  receiverShippedAt?: Date;
  initiatorReceivedAt?: Date;
  receiverReceivedAt?: Date;

  // Chat reference
  chatId?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  acceptedAt?: Date;
  completedAt?: Date;

  // Ratings
  initiatorRating?: {
    score: number;
    comment?: string;
  };
  receiverRating?: {
    score: number;
    comment?: string;
  };
}
