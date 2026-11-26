import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    increment,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    updateDoc,
    where,
} from 'firebase/firestore';
import type { DocumentData, FieldValue } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import * as ImageManipulator from 'expo-image-manipulator';
import { auth, firestore, functions, storage } from '../../config/firebaseConfig';
import { APP_LOCALE } from '../../constants/locale';
import {
  Chat,
  ChatParticipant,
  Message,
  MessageStatus,
  MessageType,
  MeetupDetails,
  MeetupSpot,
  OfferHistoryEntry,
  OfferStatus,
  ShippingAddress,
  ShippingEstimate,
} from '../../types';
import { ModerationService } from '../moderationService';
import { TransactionService } from '../transactionService';

/** Shape of a new chat document before it is written to Firestore. */
export interface NewChatData {
  participants: string[];
  participantsInfo: ChatParticipant[];
  sellerId?: string;
  unreadCount: Record<string, number>;
  createdAt: FieldValue;
  updatedAt: FieldValue;
  articleId?: string;
  articleTitle?: string;
  articleImage?: string;
  articlePrice?: number;
}

/** Shape of the offer metadata attached to an offer message. */
export interface OfferData {
  amount: number;
  status: OfferStatus;
  totalAmount?: number;
  message?: string;
  shippingAddress?: ShippingAddress;
  shippingEstimate?: ShippingEstimate;
  meetup?: MeetupDetails;
  history?: OfferHistoryEntry[];
  expiresAt?: Date;
  offerId?: string;
  originalOfferId?: string;
}

/**
 * Recursively remove undefined values from an object.
 * Firestore rejects documents containing undefined fields.
 */
export function stripUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as unknown as T;
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) {
        result[key] = stripUndefined(value);
      }
    }
    return result as T;
  }
  return obj;
}

// `toDate` / `formatMeetupDateTime` vivent dans la couche partagée
// (`utils/firestoreDate`) : `features/offers` en a besoin pour AFFICHER le même
// champ que ces services COMPOSENT. Réexportés ici pour ne pas casser les
// importeurs existants.
export { toDate, formatMeetupDateTime } from '../../utils/firestoreDate';

/**
 * Longueur maximale de l'aperçu écrit sur le document de conversation.
 *
 * L'aperçu s'affiche sur UNE ligne dans la liste ; rien d'autre ne le lit. Le
 * tronquer borne ce que chaque écriture de message ajoute à un document que les
 * deux parties gardent en écoute permanente, et empêche qu'un message collé dans
 * une contre-offre y verse plusieurs milliers de caractères.
 *
 * Les marqueurs que `getLastMessagePreview` cherche (« contre-offre », « meetup »)
 * sont en tête du contenu construit : la troncature les préserve.
 */
export const CHAT_PREVIEW_MAX_LENGTH = 200;

/**
 * Maximum number of recent messages loaded per chat snapshot. Bounds the
 * read so we never pull an entire conversation history at once. Incremental
 * load-more (fetching older messages beyond this window) is not yet wired.
 */
export const MESSAGES_WINDOW = 50;
