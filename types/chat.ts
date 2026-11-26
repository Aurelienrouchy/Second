/**
 * Types — Messagerie : messages, offre portée par un message, conversation.
 *
 * Éclaté depuis types/index.ts (1029 lignes, tous domaines mêlés).
 * `types/index.ts` reste le barrel public : les imports `from '@/types'`
 * sont inchangés.
 */

import type { ShippingAddress, ShippingEstimate } from './shipping';
import type { Transaction } from './transaction';

export type MessageType = 'text' | 'image' | 'offer' | 'system';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read';

// New offer status with counter-offer support
export type OfferStatus =
  | 'pending'           // En attente de réponse
  | 'accepted'          // Acceptée → paiement
  | 'rejected'          // Refusée définitivement
  | 'completed'         // Transaction terminée (meetup complété)
  | 'counter_price'     // Contre-offre sur le prix
  | 'counter_location'  // Contre-proposition de lieu
  | 'counter_time'      // Contre-proposition d'horaire
  | 'expired';          // Expirée (après 48h)

export interface MessageOffer {
  deliveryType?: 'shipping';
  articleId?: string;
  buyerId?: string;
  sellerId?: string;
  amount: number;
  status: OfferStatus;
  message?: string;
  shippingAddress?: ShippingAddress;
  shippingEstimate?: ShippingEstimate;
  totalAmount?: number; // amount + shipping
}

export interface MessageImage {
  url: string;
  generation?: string;
  thumbnailGeneration?: string;
  width?: number;
  height?: number;
  thumbnail?: string;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  receiverId: string;
  type: MessageType;
  content: string;
  timestamp: Date;
  status: MessageStatus;
  isRead: boolean;
  // Optional metadata based on message type
  offer?: MessageOffer;
  image?: MessageImage;
  contentModeration?: {protocol:'content_visibility_v1';state:'hidden'|'visible';caseId:string;decisionId:string;version:number};
}

export interface ChatParticipant {
  userId: string;
  userName: string;
  userImage?: string;
  /** Backend trigger uses profileImage for map-format participantsInfo */
  profileImage?: string;
}

export interface Chat {
  id: string;
  participants: string[];
  participantsInfo: ChatParticipant[];
  sellerId?: string;
  articleId?: string;
  articleTitle?: string;
  articleImage?: string;
  articlePrice?: number;
  lastMessage?: string;
  lastMessageType?: MessageType;
  contentPreviewRestricted?: boolean;
  lastMessageTimestamp?: Date;
  unreadCount: { [userId: string]: number };
  createdAt: Date;
  updatedAt: Date;
}
