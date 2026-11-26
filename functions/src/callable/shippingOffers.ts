import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db, FieldValue } from '../config/firebase';
import { assertNewPaymentsEnabled, isShippingEnabled } from '../config/featureFlags';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { assertOwnPublicationEligibility, readEligibilityEvidence } from '../utils/eligibility';
import { counterpartEligibilityRefusal, evaluateCurrentSellerEligibility, evaluateEligibility } from '../shared/eligibility';
import { assertOwnTradingEligibility, assertArticleNotModerationRestricted, assertArticleChildSafetyAdmitted, commercialRequestHash } from '../utils/tradeAdmission';
import { assertArticleHygieneAdmitted } from '../utils/articleHygiene';
import { assertArticleSaleDeclaration } from '../utils/articleSaleDeclaration';
import { assertArticleNotSwapEngaged } from '../utils/articleSwapEngagement';
import { assertAccountRelationshipNewPair } from '../utils/accountRelationshipReview';
import { assertInventoryAvailable } from '../utils/inventoryUnit';
import { hasBlockedUser } from '../utils/meetupOffers';
import { exactCents } from '../utils/shippingPurchaseRate';
import { shippingOfferListingHash, shippingOfferThread, SHIPPING_OFFER_TTL_MS } from '../utils/shippingOffers';
import { withFinancialRecoveryScope } from '../utils/financialRecoveryInterlock';
import { financialRecoveryCommitCheckpoint } from '../utils/financialRecoverySources';

const options = { region: 'northamerica-northeast1', memory: '512MiB' as const };
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) throw new HttpsError('invalid-argument', `${field} invalide`);
  return value;
}
async function guard(request: any, name: string) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  await assertPrivateAccountSession(request);
  const caller = resolveCallerKey(request);
  await checkRateLimit(caller.callerKey, caller.isAuthenticated, { functionName: name, maxCallsAuthenticated: 20, maxCallsUnauthenticated: 0, windowMs: 60_000 });
}
async function context(tx: FirebaseFirestore.Transaction, chatId: string, caller: string) {
  const chat = (await tx.get(db.collection('chats').doc(chatId))).data();
  if (!chat || !Array.isArray(chat.participants) || chat.participants.length !== 2 || new Set(chat.participants).size !== 2 ||
      !chat.participants.includes(caller)) throw new HttpsError('permission-denied', 'Conversation non autorisée');
  const articleId = id(chat.articleId, 'Article'), article = (await tx.get(db.collection('articles').doc(articleId))).data();
  if (!article || !chat.participants.includes(article.sellerId)) throw new HttpsError('failed-precondition', 'Article ou vendeur indisponible');
  const sellerId = id(article.sellerId, 'Vendeur'), buyerId = id(chat.participants.find((uid: string) => uid !== sellerId), 'Acheteur');
  const receiverId = caller === sellerId ? buyerId : sellerId, threadRef = shippingOfferThread(articleId, buyerId);
  const thread = (await tx.get(threadRef)).data();
  return { article, articleId, sellerId, buyerId, receiverId, chat, chatId, threadRef, thread };
}
async function admission(tx: FirebaseFirestore.Transaction, current: Awaited<ReturnType<typeof context>>, caller: string) {
  assertNewPaymentsEnabled();
  if (!isShippingEnabled()) throw new HttpsError('failed-precondition', 'Les offres avec livraison sont indisponibles.');
  const { article, articleId, buyerId, sellerId } = current;
  if (article.isActive !== true || article.isShipping !== true || article.isSold === true || article.activeTransactionId != null) {
    throw new HttpsError('failed-precondition', 'Cet article est déjà réservé ou indisponible.');
  }
  await assertAccountRelationshipNewPair(tx, buyerId, sellerId);
  await assertArticleNotSwapEngaged(tx, articleId); await assertInventoryAvailable(tx, articleId, article);
  assertArticleNotModerationRestricted(article); assertArticleHygieneAdmitted(article); assertArticleSaleDeclaration(articleId, article);
  await assertArticleChildSafetyAdmitted(tx, articleId, article);
  const buyer = await readEligibilityEvidence(tx, buyerId), seller = await readEligibilityEvidence(tx, sellerId);
  if (hasBlockedUser(buyer.user ?? undefined, sellerId) || hasBlockedUser(seller.user ?? undefined, buyerId)) throw new HttpsError('permission-denied', 'Cette conversation est bloquée.');
  if (caller === sellerId) await assertOwnPublicationEligibility(seller, tx, sellerId);
  else await assertOwnTradingEligibility(buyer, 'buy', tx, buyerId);
  const other = caller === sellerId ? evaluateEligibility(buyer, 'buy') : evaluateCurrentSellerEligibility(seller, 'sell');
  if (!other.allowed) { const refusal = counterpartEligibilityRefusal(caller === sellerId ? 'buy' : 'sell'); throw new HttpsError('failed-precondition', refusal.message, refusal); }
}
function currentOffer(data: FirebaseFirestore.DocumentData | undefined, ctx: Awaited<ReturnType<typeof context>>, messageId: string) {
  return data?.type === 'offer' && data.chatId === ctx.chatId && data.offer?.protocol === 'shipping_offer_v1' &&
    data.offer.deliveryType === 'shipping' && data.offer.meetup == null && data.offer.articleId === ctx.articleId &&
    data.offer.buyerId === ctx.buyerId && data.offer.sellerId === ctx.sellerId && data.offer.offerId === messageId &&
    [ctx.buyerId, ctx.sellerId].includes(data.senderId) && data.receiverId === (data.senderId === ctx.sellerId ? ctx.buyerId : ctx.sellerId);
}
export const sendShippingOffer = onCall(options, async request => withFinancialRecoveryScope({ operation: 'callable/shippingOffers.sendShippingOffer' }, async () => withPrivateAccountSession(request, async () => {
  await guard(request, 'sendShippingOffer');
  const caller = request.auth!.uid, input = request.data ?? {}, chatId = id(input.chatId, 'Conversation'), requestId = id(input.requestId, 'Requête');
  const originalId = input.originalMessageId == null ? null : id(input.originalMessageId, 'Offre');
  const note = typeof input.message === 'string' ? input.message.trim() : '';
  if (note.length > 2000 || Object.keys(input).some(key => !['chatId','requestId','amount','message','originalMessageId'].includes(key))) throw new HttpsError('invalid-argument', 'Offre invalide');
  const inputHash = commercialRequestHash(input, ['chatId','amount','message','originalMessageId']);
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const ctx = await context(tx, chatId, caller), ref = db.collection('messages').doc(requestId), existing = (await tx.get(ref)).data();
    if (existing) {
      if (!currentOffer(existing, ctx, requestId) || existing.senderId !== caller || existing.offer.inputHash !== inputHash) throw new HttpsError('already-exists', 'Cette requête désigne une autre offre.');
      return { success: true, messageId: requestId, chatId, articleId: ctx.articleId, amount: existing.offer.amount, reused: true };
    }
    const amountCents = exactCents(input.amount), listCents = exactCents(ctx.article.price);
    if (!amountCents || !listCents || amountCents < Math.min(100, listCents) || amountCents > listCents || amountCents > 5_000_000) throw new HttpsError('invalid-argument', 'Montant de proposition invalide');
    const previousRef = ctx.thread?.messageId ? db.collection('messages').doc(id(ctx.thread.messageId, 'Offre précédente')) : null;
    const previous = previousRef ? (await tx.get(previousRef)).data() : undefined;
    if (originalId && (!previous || ctx.thread?.messageId !== originalId || !currentOffer(previous, ctx, originalId) ||
        previous.senderId === caller || previous.offer.status !== 'pending' || !(previous.offer.expiresAt instanceof Timestamp) ||
        previous.offer.expiresAt.toMillis() <= Date.now())) throw new HttpsError('failed-precondition', 'Cette proposition ne peut plus recevoir de contre-offre.');
    if (previous?.offer?.status === 'accepted' && previous.offer.transactionId == null && previous.offer.expiresAt instanceof Timestamp && previous.offer.expiresAt.toMillis() > Date.now()) {
      throw new HttpsError('failed-precondition', 'Une offre acceptée est déjà disponible. Passez à son achat.');
    }
    await admission(tx, ctx, caller);
    const now = Timestamp.now(), amount = amountCents / 100;
    await assertPrivateAccountSession(request, tx);
    await financialRecoveryCommitCheckpoint()({ refs: [ref.path, ctx.threadRef.path] });
    if (previousRef && previous?.offer?.status === 'pending') tx.update(previousRef, {
      'offer.status': originalId ? 'counter_price' : 'expired', 'offer.expiredReason': 'replaced',
      'offer.replacedByMessageId': requestId, 'offer.respondedAt': FieldValue.serverTimestamp(),
    });
    tx.create(ref, { chatId, senderId: caller, receiverId: ctx.receiverId, participants: ctx.chat.participants,
      type: 'offer', content: `Proposition de ${amount} $`, timestamp: now, status: 'sent', isRead: false,
      offer: { protocol: 'shipping_offer_v1', deliveryType: 'shipping', offerId: requestId, articleId: ctx.articleId,
        buyerId: ctx.buyerId, sellerId: ctx.sellerId, amount, status: 'pending', inputHash,
        listingSourceHash: shippingOfferListingHash(ctx.article), expiresAt: Timestamp.fromMillis(now.toMillis() + SHIPPING_OFFER_TTL_MS),
        ...(note ? { message: note } : {}), ...(originalId ? { originalOfferId: previous!.offer.offerId } : {}) } });
    tx.set(ctx.threadRef, { articleId: ctx.articleId, buyerId: ctx.buyerId, chatId, messageId: requestId, status: 'pending', updatedAt: now });
    return { success: true, messageId: requestId, chatId, articleId: ctx.articleId, amount, reused: false };
  });
})));
export const respondShippingOffer = onCall(options, async request => withFinancialRecoveryScope({ operation: 'callable/shippingOffers.respondShippingOffer' }, async () => withPrivateAccountSession(request, async () => {
  await guard(request, 'respondShippingOffer');
  const caller = request.auth!.uid, input = request.data ?? {}, chatId = id(input.chatId, 'Conversation'), messageId = id(input.messageId, 'Offre');
  if (!['accept','reject'].includes(input.action) || Object.keys(input).some(key => !['chatId','messageId','action'].includes(key))) throw new HttpsError('invalid-argument', 'Réponse invalide');
  return db.runTransaction(async tx => {
    await assertPrivateAccountSession(request, tx);
    const ctx = await context(tx, chatId, caller), ref = db.collection('messages').doc(messageId), message = (await tx.get(ref)).data();
    if (!currentOffer(message, ctx, messageId) || message!.senderId === caller || message!.receiverId !== caller) throw new HttpsError('permission-denied', 'Cette offre ne vous est pas adressée.');
    const offer = message!.offer, status = input.action === 'accept' ? 'accepted' : 'rejected';
    const result = (reused: boolean) => ({ success: true, messageId, chatId, articleId: ctx.articleId, amount: offer.amount, accepted: status === 'accepted', reused });
    if (offer.status === status) return result(true);
    if (offer.status !== 'pending' || ctx.thread?.messageId !== messageId || !(offer.expiresAt instanceof Timestamp) || offer.expiresAt.toMillis() <= Date.now()) throw new HttpsError('failed-precondition', 'Cette offre a expiré ou a déjà reçu une réponse.');
    if (input.action === 'accept') {
      await admission(tx, ctx, caller);
      if (offer.listingSourceHash !== shippingOfferListingHash(ctx.article) || !exactCents(offer.amount) || exactCents(offer.amount)! > exactCents(ctx.article.price)!) throw new HttpsError('failed-precondition', 'L’annonce a changé. Demandez une nouvelle offre.');
    }
    const now = Timestamp.now(); await assertPrivateAccountSession(request, tx);
    await financialRecoveryCommitCheckpoint()({ refs: [ref.path, ctx.threadRef.path] });
    tx.update(ref, { 'offer.status': status, 'offer.respondedAt': now, ...(status === 'accepted' ? {
      'offer.acceptedAt': now, 'offer.acceptedBy': caller, 'offer.expiresAt': Timestamp.fromMillis(now.toMillis() + SHIPPING_OFFER_TTL_MS),
    } : {}) });
    tx.update(ctx.threadRef, { status, updatedAt: now });
    return result(false);
  });
})));
