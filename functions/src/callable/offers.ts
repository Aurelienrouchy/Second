import { onCall, HttpsError } from 'firebase-functions/v2/https';
import {PHASE1_CONTRACT} from '../utils/phase1LegacyFence';
import {activeLocalAgreementScope} from '../utils/localAgreement';
import { db, FieldValue } from '../config/firebase';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { hasBlockedUser, meetupLocationsEqual, meetupThreadId, normalizeMeetupLocation, offerExpired } from '../utils/meetupOffers';
import { assertMeetupAccountsAvailable, assertNewMeetupAdmission, commercialRequestHash, PROPOSAL_INPUT_FIELDS } from '../utils/tradeAdmission';
import { cashReservationCanBeReused } from '../utils/cashMeetup';
import { assertNoLiveArticleTransaction } from './products';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../utils/privateAccountSession';
import { withFinancialRecoveryScope } from '../utils/financialRecoveryInterlock';
import { financialRecoveryCommitCheckpoint } from '../utils/financialRecoverySources';

const options = { region: 'northamerica-northeast1', memory: '512MiB' as const };
const TTL_MS = 48 * 60 * 60 * 1000;

function id(raw: unknown, name: string): string {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(raw)) throw new HttpsError('invalid-argument', `${name} invalide`);
  return raw;
}

/** Only call before any writes: permissions and roles come from stored data. */
async function readContext(tx: FirebaseFirestore.Transaction, chatId: string, caller: string) {
  const chatRef = db.collection('chats').doc(chatId);
  const chatSnap = await tx.get(chatRef);
  if (!chatSnap.exists) throw new HttpsError('not-found', 'Conversation introuvable');
  const chat = chatSnap.data()!;
  if (!Array.isArray(chat.participants) || chat.participants.length !== 2 || !chat.participants.includes(caller)) {
    throw new HttpsError('permission-denied', 'Vous ne participez pas à cette conversation');
  }
  const articleId = id(chat.articleId, 'Article');
  const articleRef = db.collection('articles').doc(articleId);
  const articleSnap = await tx.get(articleRef);
  if (!articleSnap.exists) throw new HttpsError('not-found', 'Article introuvable');
  const article = articleSnap.data()!;
  const sellerId = article.sellerId;
  if (typeof sellerId !== 'string' || !chat.participants.includes(sellerId)) throw new HttpsError('failed-precondition', 'Vendeur invalide');
  const buyerId = chat.participants.find((p: string) => p !== sellerId) as string;
  const receiverId = chat.participants.find((p: string) => p !== caller) as string;
  if (typeof buyerId !== 'string' || buyerId === sellerId || typeof receiverId !== 'string') throw new HttpsError('failed-precondition', 'Participants invalides');
  const threadRef = db.collection('meetup_offer_threads').doc(meetupThreadId(articleId, buyerId));
  const threadSnap = await tx.get(threadRef);
  return { chat, chatRef, article, articleId, articleRef, sellerId, buyerId, receiverId, threadRef, thread: threadSnap.data() };
}

export const sendMeetupProposal = onCall(options, async (request) => withFinancialRecoveryScope({ operation: 'callable/offers.sendMeetupProposal' }, async () => withPrivateAccountSession(request, async () => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  const caller = request.auth.uid;
  const { callerKey, isAuthenticated } = resolveCallerKey(request);
  await checkRateLimit(callerKey, isAuthenticated, { functionName: 'sendMeetupProposal', maxCallsAuthenticated: 20, maxCallsUnauthenticated: 0, windowMs: 60000 });
  await assertPrivateAccountSession(request);
  const input = request.data ?? {};
  const chatId = id(input.chatId, 'Conversation');
  const requestId = id(input.requestId, 'Requête');
  const originalId = input.originalMessageId == null ? null : id(input.originalMessageId, 'Offre');
  const counterKind = input.counterKind;
  if (originalId && !['price', 'location', 'time'].includes(counterKind)) throw new HttpsError('invalid-argument', 'Contre-offre invalide');
  const note = typeof input.message === 'string' ? input.message.trim() : '';
  if (note.length > 2000) throw new HttpsError('invalid-argument', 'Message trop long');
  const messageRef = db.collection('messages').doc(requestId);
  const requestRef = db.collection('meetup_offer_requests').doc(requestId);
  const inputHash = commercialRequestHash(input, PROPOSAL_INPUT_FIELDS);

  return db.runTransaction(async (tx) => {
    await assertPrivateAccountSession(request, tx);
    const context = await readContext(tx, chatId, caller);
    const { article, articleId, sellerId, buyerId, receiverId, threadRef, thread } = context;
    const previousRequest = await tx.get(requestRef);
    if (previousRequest.exists) {
      const previous = previousRequest.data()!;
      if (previous.chatId !== chatId || previous.senderId !== caller) throw new HttpsError('already-exists', 'Requête déjà utilisée');
      const linked = typeof previous.messageId === 'string' ? (await tx.get(db.collection('messages').doc(previous.messageId))).data() : null;
      if (!linked || linked.chatId !== chatId || linked.senderId !== caller || linked.type !== 'offer') throw new HttpsError('failed-precondition', 'La proposition liée doit être examinée.');
      if (!previous.inputHash) throw new HttpsError('failed-precondition', 'Cette proposition existe déjà. Consultez le message enregistré.',
        { reason: 'legacy_proposal_review', action: 'openExistingOffer', messageId: previous.messageId });
      if (previous.inputHash !== inputHash) throw new HttpsError('already-exists', 'Cette requête désigne déjà une proposition avec d’autres données.');
      if (previous.articleId !== articleId || previous.buyerId !== buyerId || previous.sellerId !== sellerId ||
          (linked.offer?.articleId != null && linked.offer.articleId !== articleId) ||
          (linked.offer?.buyerId != null && linked.offer.buyerId !== buyerId)) throw new HttpsError('failed-precondition', 'Le contexte de cette proposition a changé. Consultez le dossier enregistré.');
      return { success: true, messageId: previous.messageId, reused: true, replaced: false };
    }
    const duplicate = await tx.get(messageRef);
    if (duplicate.exists) {
      const data = duplicate.data()!;
      if (data.chatId !== chatId || data.senderId !== caller || data.type !== 'offer') throw new HttpsError('already-exists', 'Requête déjà utilisée');
      throw new HttpsError('failed-precondition', 'Cette ancienne proposition existe déjà. Consultez le message enregistré.',
        { reason: 'legacy_proposal_review', action: 'openExistingOffer', messageId: duplicate.id });
    }
    const users = await Promise.all([tx.get(db.collection('users').doc(caller)), tx.get(db.collection('users').doc(receiverId))]);
    assertMeetupAccountsAvailable(users[0].data(), users[1].data(), caller === sellerId ? 'sell' : 'buy');
    if (hasBlockedUser(users[0].data(), receiverId) || hasBlockedUser(users[1].data(), caller)) throw new HttpsError('permission-denied', 'Cette conversation est bloquée');
    if (article.isSold === true || article.isActive === false) throw new HttpsError('failed-precondition', 'Un accord accepté doit être annulé explicitement avant toute nouvelle proposition');
    await assertNoLiveArticleTransaction(tx, articleId, article);

    // On first use, adopt legacy/duplicate chats. Later writes touch one
    // contention document and one current proposal rather than all history.
    const offerDocs: FirebaseFirestore.DocumentSnapshot[] = [];
    if (thread?.messageId) {
      const current = await tx.get(db.collection('messages').doc(thread.messageId));
      if (current.exists) offerDocs.push(current);
    } else {
      const chatSnaps = await tx.get(db.collection('chats').where('articleId', '==', articleId));
      const relevantChats = chatSnaps.docs.filter((d) => d.data().participants?.includes(buyerId) && d.data().participants?.includes(sellerId));
      for (const chat of relevantChats) {
        const messages = await tx.get(db.collection('messages').where('chatId', '==', chat.id).where('type', '==', 'offer'));
        offerDocs.push(...messages.docs.filter((d) => d.data()!.offer?.meetup));
      }
    }
    // Cancellation is explicit and server-authoritative. Accepted terms remain
    // immutable unless their exact linked agreement was cancelled/refunded.
    for (const accepted of offerDocs.filter((d) => d.data()!.offer?.status === 'accepted')) {
      const linkedId = accepted.data()!.offer.transactionId;
      const agreement = typeof linkedId === 'string' ? (await tx.get(db.collection('transactions').doc(linkedId))).data() : null;
      if (!agreement || ((agreement.cashReservationRelease != null || !['cancelled', 'refunded'].includes(agreement.status)) && !await cashReservationCanBeReused(tx, linkedId, agreement))) {
        throw new HttpsError('failed-precondition', 'Un accord accepté existe déjà pour cet article');
      }
    }
    const pending = offerDocs.filter((d) => d.data()!.offer?.status === 'pending');
    let original: FirebaseFirestore.DocumentData | undefined;
    if (originalId) {
      const originalSnap = await tx.get(db.collection('messages').doc(originalId));
      original = originalSnap.data();
      if (!original || original.chatId !== chatId || !original.offer?.meetup || original.offer.status !== 'pending' || offerExpired(original.offer) ||
          original.senderId === caller || !context.chat.participants.includes(original.senderId) ||
          (original.offer.articleId != null && original.offer.articleId !== articleId) || (original.offer.buyerId != null && original.offer.buyerId !== buyerId) ||
          (thread?.messageId && thread.messageId !== originalId)) {
        throw new HttpsError('failed-precondition', 'Cette proposition a déjà reçu une réponse ou a été remplacée');
      }
    }
    const amount = counterKind === 'price' || !original ? input.amount : original.offer.amount;
    if (typeof article.price !== 'number' || !Number.isFinite(article.price) || article.price < 0.01 ||
        typeof amount !== 'number' || !Number.isFinite(amount) || amount < Math.min(1, article.price) || amount > 50000 ||
        Math.abs(Math.round(amount * 100) - amount * 100) > 0.0000001 || amount > article.price) {
      throw new HttpsError('invalid-argument', 'Montant de proposition invalide');
    }
    const location = normalizeMeetupLocation(counterKind === 'location' || !original ? input.location : original.offer.meetup.location);
    const dateTimeRaw = counterKind === 'time' ? input.dateTime : original?.offer.meetup.dateTime;
    const dateTime = dateTimeRaw?.toDate?.() ?? (dateTimeRaw ? new Date(dateTimeRaw) : null);
    if (dateTime && (!Number.isFinite(dateTime.getTime()) || dateTime.getTime() <= Date.now())) throw new HttpsError('invalid-argument', 'Horaire de rencontre invalide');
    const existingSame = pending.find((d) => {
      const previous = d.data()!;
      return !originalId && previous.chatId === chatId && previous.senderId === caller && previous.offer.amount === amount && previous.offer.message === (note || undefined) &&
        (previous.offer.articleId == null || previous.offer.articleId === articleId) && (previous.offer.buyerId == null || previous.offer.buyerId === buyerId) &&
        !offerExpired(previous.offer) && meetupLocationsEqual(previous.offer.meetup.location, location) &&
        (previous.offer.meetup.dateTime?.toDate?.()?.getTime() ?? (previous.offer.meetup.dateTime ? new Date(previous.offer.meetup.dateTime).getTime() : null)) === (dateTime?.getTime() ?? null);
    });
    if (existingSame && pending.length === 1) {
      await assertPrivateAccountSession(request, tx);
      await financialRecoveryCommitCheckpoint()({ refs: [requestRef.path] });
      tx.set(requestRef, { chatId, articleId, buyerId, sellerId, senderId: caller, messageId: existingSame.id, inputHash, createdAt: FieldValue.serverTimestamp() });
      return { success: true, messageId: existingSame.id, reused: true, replaced: false };
    }
    await assertNewMeetupAdmission(tx, caller, sellerId, buyerId, articleId);

    const now = new Date();
    const offer: FirebaseFirestore.DocumentData = { amount, status: 'pending', buyerId, articleId, offerId: requestId,
      meetup: { location, proposedBy: caller === sellerId ? 'seller' : 'buyer', ...(dateTime ? { dateTime } : {}) },
      expiresAt: new Date(now.getTime() + TTL_MS), ...(note ? { message: note } : {}),
      ...(originalId ? { originalOfferId: original?.offer.offerId ?? originalId } : {}) };
    await assertPrivateAccountSession(request, tx);
    await financialRecoveryCommitCheckpoint()({ refs: [messageRef.path, threadRef.path, requestRef.path] });
    const phase1Control = activeLocalAgreementScope()?.control;
    for (const previous of pending) tx.update(previous.ref, {
      'offer.status': previous.id === originalId ? `counter_${counterKind}` : 'expired',
      'offer.expiredReason': 'replaced', 'offer.replacedByMessageId': requestId, 'offer.respondedAt': FieldValue.serverTimestamp(),
    });
    tx.set(messageRef, { phase1Contract: PHASE1_CONTRACT,
      ...(phase1Control ? {phase1Source: {protocol: 'phase1_message_origin_v1', ...phase1Control}} : {}),
      type: 'offer', chatId, senderId: caller, receiverId, participants: context.chat.participants,
      content: `${originalId ? 'Contre-proposition' : 'Proposition'} de ${amount} $`, offer, timestamp: FieldValue.serverTimestamp(), status: 'sent', isRead: false });
    tx.set(threadRef, { articleId, buyerId, chatId, messageId: requestId, status: 'pending', updatedAt: FieldValue.serverTimestamp() });
    tx.set(requestRef, { chatId, articleId, buyerId, sellerId, senderId: caller, messageId: requestId, inputHash, createdAt: FieldValue.serverTimestamp() });
    // Chat metadata/unread are maintained once by the existing message trigger.
    return { success: true, messageId: requestId, reused: false, replaced: pending.length > 0 };
  });
})));

/** Rejecting a pending proposal never alters a transaction or accepted terms. */
export const rejectMeetupProposal = onCall(options, async (request) => withFinancialRecoveryScope({operation:'callable/offers.rejectMeetupProposal'},()=>withPrivateAccountSession(request, async () => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  const caller = request.auth.uid;
  const chatId = id(request.data?.chatId, 'Conversation');
  const messageId = id(request.data?.messageId, 'Offre');
  return db.runTransaction(async (tx) => {
    await assertPrivateAccountSession(request, tx);
    const context = await readContext(tx, chatId, caller);
    const messageRef = db.collection('messages').doc(messageId);
    const snap = await tx.get(messageRef);
    const message = snap.data();
    if (!message || message.chatId !== chatId || message.type !== 'offer' || !message.offer) throw new HttpsError('not-found', 'Proposition introuvable');
    if (message.senderId === caller || !context.chat.participants.includes(message.senderId)) throw new HttpsError('permission-denied', 'Vous ne pouvez pas refuser votre propre proposition');
    if (message.offer.status === 'rejected') return { success: true, reused: true };
    if (message.offer.status !== 'pending' || offerExpired(message.offer) ||
        (message.offer.meetup && context.thread?.messageId && context.thread.messageId !== messageId)) {
      throw new HttpsError('failed-precondition', 'Cette proposition a déjà reçu une réponse ou a été remplacée');
    }
    await assertPrivateAccountSession(request, tx);
    await financialRecoveryCommitCheckpoint()({refs:[messageRef.path,context.threadRef.path]});
    tx.update(messageRef, { 'offer.status': 'rejected', 'offer.respondedAt': FieldValue.serverTimestamp() });
    if (context.thread?.messageId === messageId) tx.update(context.threadRef, { status: 'rejected', updatedAt: FieldValue.serverTimestamp() });
    return { success: true, reused: false };
  });
})));
