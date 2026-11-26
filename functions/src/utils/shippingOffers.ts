import { HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../config/firebase';
import { shippingTransportHash } from '../config/shippingTransportPolicy';
import { shippingItemProjection } from './shippingSourceIdentity';
import { meetupThreadId } from './meetupOffers';
import { exactCents } from './shippingPurchaseRate';

export const SHIPPING_OFFER_TTL_MS = 48 * 60 * 60 * 1000;
export const shippingOfferListingHash = (article: FirebaseFirestore.DocumentData) => shippingTransportHash(shippingItemProjection(article));
export const shippingOfferThread = (articleId: string, buyerId: string) => db.collection('shipping_offer_threads').doc(meetupThreadId(articleId, buyerId));
export interface ShippingPriceAgreement {
  protocol: 'shipping_price_agreement_v1'; messageId: string; chatId: string; articleId: string;
  buyerId: string; sellerId: string; amountCents: number; listingSourceHash: string;
  acceptedAtMs: number; expiresAtMs: number; hash: string;
}
export function shippingPriceSourceHash(baseHash: string, agreement?: ShippingPriceAgreement): string {
  return agreement ? shippingTransportHash(['shipping_price_agreement_v1', baseHash, agreement.hash]) : baseHash;
}
const invalid = () => new HttpsError('failed-precondition', 'Cette offre doit être acceptée et toujours disponible dans votre conversation.',
  { reason: 'shipping_offer_unavailable', action: 'reviewShippingOffer' });
function id(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value); }

/** An exact server-owned postal agreement, never a free amount or meetup price.
 * Reservation consumes it atomically; payment then reads that exact consumption
 * without expiring an already engaged order. No provider IO or writes here. */
export async function readAcceptedShippingOffer(tx: FirebaseFirestore.Transaction, input: {
  buyerId: string; articleId: string; article: FirebaseFirestore.DocumentData; messageId: unknown;
  chatId?: unknown; transactionId?: string;
}): Promise<ShippingPriceAgreement> {
  if (!id(input.messageId) || input.chatId != null && !id(input.chatId)) throw invalid();
  const message = (await tx.get(db.collection('messages').doc(input.messageId))).data(), offer = message?.offer;
  if (!message || !id(message.chatId) || input.chatId != null && input.chatId !== message.chatId ||
      message.type !== 'offer' || offer?.protocol !== 'shipping_offer_v1' || offer.deliveryType !== 'shipping' || offer.meetup != null ||
      offer.status !== 'accepted' || offer.articleId !== input.articleId || offer.buyerId !== input.buyerId ||
      offer.sellerId !== input.article.sellerId || offer.offerId !== input.messageId ||
      ![input.buyerId, input.article.sellerId].includes(message.senderId) ||
      message.receiverId !== (message.senderId === input.buyerId ? input.article.sellerId : input.buyerId) ||
      !(offer.acceptedAt instanceof Timestamp) || !(offer.expiresAt instanceof Timestamp) ||
      offer.acceptedBy !== message.receiverId || offer.listingSourceHash !== shippingOfferListingHash(input.article) ||
      !Number.isSafeInteger(offer.acceptedAt.toMillis()) || offer.acceptedAt.toMillis() < 0 || offer.acceptedAt.toMillis() > Date.now() ||
      offer.expiresAt.toMillis() - offer.acceptedAt.toMillis() !== SHIPPING_OFFER_TTL_MS) throw invalid();
  const amountCents = exactCents(offer.amount), listCents = exactCents(input.article.price);
  if (!amountCents || !listCents || amountCents > listCents ||
      (input.transactionId ? offer.transactionId !== input.transactionId : offer.transactionId != null || offer.expiresAt.toMillis() <= Date.now())) throw invalid();
  const chat = (await tx.get(db.collection('chats').doc(message.chatId))).data();
  const thread = (await tx.get(shippingOfferThread(input.articleId, input.buyerId))).data();
  if (!chat || chat.articleId !== input.articleId || !Array.isArray(chat.participants) || chat.participants.length !== 2 ||
      !chat.participants.includes(input.buyerId) || !chat.participants.includes(input.article.sellerId) ||
      !thread || thread.articleId !== input.articleId || thread.buyerId !== input.buyerId || thread.messageId !== input.messageId ||
      thread.chatId !== message.chatId || thread.status !== 'accepted') throw invalid();
  const body = { protocol: 'shipping_price_agreement_v1' as const, messageId: input.messageId, chatId: message.chatId as string,
    articleId: input.articleId, buyerId: input.buyerId, sellerId: input.article.sellerId as string, amountCents,
    listingSourceHash: offer.listingSourceHash as string, acceptedAtMs: offer.acceptedAt.toMillis(), expiresAtMs: offer.expiresAt.toMillis() };
  return { ...body, hash: shippingTransportHash(body) };
}
