/**
 * Types — Remise en main propre : lieux, quartiers, négociation d'offre.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

import type { MessageOffer, OfferStatus } from './chat';
import type { ShippingAddress, ShippingEstimate } from './shipping';

// ============================================
// MEETUP SYSTEM TYPES
// ============================================

// Catégories de lieux de rencontre
export type MeetupSpotCategory =
  | 'cafe'
  | 'metro'
  | 'library'
  | 'mall'
  | 'park'
  | 'community_center'
  | 'other_public';

export const MeetupSpotCategoryLabels: Record<MeetupSpotCategory, string> = {
  'cafe': 'Café',
  'metro': 'Station de métro',
  'library': 'Bibliothèque',
  'mall': 'Centre commercial',
  'park': 'Parc',
  'community_center': 'Centre communautaire',
  'other_public': 'Autre lieu public',
};

// Quartier/Zone de Montréal
export interface MeetupNeighborhood {
  id: string;
  name: string;
  borough: string; // Arrondissement
}

// Lieu de rencontre spécifique
export interface MeetupSpot {
  toArrange?: boolean;
  id?: string;
  name: string;
  category: MeetupSpotCategory;
  neighborhood: MeetupNeighborhood;
  address?: string;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
  // Si c'est un lieu suggéré par la communauté
  isUserSuggested?: boolean;
  suggestedBy?: string;
}

// Historique des négociations d'offre
export type OfferHistoryAction =
  | 'created'
  | 'counter_price'
  | 'counter_location'
  | 'counter_time'
  | 'accepted'
  | 'rejected'
  | 'expired';

export interface OfferHistoryEntry {
  action: OfferHistoryAction;
  by: string; // userId
  timestamp: Date;
  previousValue?: any;
  newValue?: any;
  message?: string;
}

// Détails du meetup dans une offre
export interface MeetupDetails {
  location: MeetupSpot;
  dateTime?: Date; // Optionnel - la date/heure sera convenue via le chat
  proposedBy: 'buyer' | 'seller';
  // Pour le suivi
  confirmedAt?: Date;
  completedAt?: Date;
  noShow?: {
    reportedBy: string;
    reportedAt: Date;
    reason?: string;
  };
}

// Extension de MessageOffer pour supporter le meetup
export interface MessageOfferWithMeetup {
  deliveryType?: 'shipping';
  articleId?: string;
  buyerId?: string;
  sellerId?: string;
  transactionId?: string;
  expiredReason?: string;
  amount: number;
  status: OfferStatus;
  message?: string;

  // Legacy shipping (optional, pour migration)
  shippingAddress?: ShippingAddress;
  shippingEstimate?: ShippingEstimate;
  totalAmount?: number;

  // New meetup fields
  meetup?: MeetupDetails;
  history?: OfferHistoryEntry[];
  expiresAt?: Date;
  offerId?: string; // Reference to the offer document
}
