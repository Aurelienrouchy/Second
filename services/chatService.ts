/**
 * ChatService — façade publique de la messagerie.
 *
 * Le fichier faisait 1554 lignes et mêlait quatre domaines : cycle de vie
 * d'une conversation, envoi de messages, négociation d'offres, et remise en
 * main propre. Il est éclaté dans `services/chat/` ; cette façade préserve
 * l'API `ChatService.x()` telle qu'elle, donc aucun appelant n'a changé.
 *
 *   chat/internal      imports et helpers partagés (stripUndefined, fenêtre)
 *   chat/primitives    écriture de message, message système, lookup meetup
 *   chat/conversation  création/récupération, lecture, compteur non-lus
 *   chat/messages      envoi texte et image
 *   chat/offers        offre, acceptation, refus, contre-offres
 *   chat/meetup        proposition, confirmation, no-show, clôture
 *   chat/shipping      étiquette d'expédition postée dans le fil
 *   chat/listeners     abonnements temps réel Firestore
 */

import { sendSystemMessage } from './chat/primitives';
import {
  createOrGetChat,
  getChatById,
  getUnreadCount,
  markMessagesAsRead,
} from './chat/conversation';
import { sendImage, sendMessage } from './chat/messages';
import {
  acceptOffer,
  counterOfferLocation,
  counterOfferPrice,
  counterOfferTime,
  rejectOffer,
  sendOffer,
} from './chat/offers';
import {
  cancelMeetup,
  completeMeetup,
  confirmMeetup,
  reportNoShow,
  sendMeetupOffer,
} from './chat/meetup';
import { sendShippingLabel } from './chat/shipping';
import { listenToActiveOffers, listenToChat, listenToMessages, listenToUserChats } from './chat/listeners';

export const ChatService = {
  // conversation
  createOrGetChat,
  getChatById,
  markMessagesAsRead,
  getUnreadCount,
  // messages
  sendMessage,
  sendImage,
  sendSystemMessage,
  // offres
  sendOffer,
  acceptOffer,
  rejectOffer,
  counterOfferPrice,
  counterOfferLocation,
  counterOfferTime,
  // meetup
  sendMeetupOffer,
  confirmMeetup,
  reportNoShow,
  completeMeetup,
  cancelMeetup,
  // livraison
  sendShippingLabel,
  // temps réel
  listenToMessages,
  listenToActiveOffers,
  listenToChat,
  listenToUserChats,
} as const;
