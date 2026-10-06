import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, FieldValue } from '../config/firebase';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { hasBlockedUser, meetupLocationsEqual, meetupThreadId, normalizeMeetupLocation, offerExpired } from '../utils/meetupOffers';

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
  const threadRef = db.collection('meetup_offer_threads').doc(meetupThreadId(articleId, buyerId));
  const threadSnap = await tx.get(threadRef);
  return { chat, chatRef, article, articleId, articleRef, sellerId, buyerId, receiverId, threadRef, thread: threadSnap.data() };
}

export const sendMeetupProposal = onCall(options, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  const caller = request.auth.uid;
  const { callerKey, isAuthenticated } = resolveCallerKey(request);
  await checkRateLimit(callerKey, isAuthenticated, { functionName: 'sendMeetupProposal', maxCallsAuthenticated: 20, maxCallsUnauthenticated: 0, windowMs: 60000 });
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

  return db.runTransaction(async (tx) => {
    const context = await readContext(tx, chatId, caller);
    const { article, articleId, sellerId, buyerId, receiverId, threadRef, thread } = context;
    const previousRequest = await tx.get(requestRef);
    if (previousRequest.exists) {
      const previous = previousRequest.data()!;
      if (previous.chatId !== chatId || previous.senderId !== caller) throw new HttpsError('already-exists', 'Requête déjà utilisée');
      return { success: true, messageId: previous.messageId, reused: true, replaced: false };
    }
    const duplicate = await tx.get(messageRef);
    if (duplicate.exists) {
      const data = duplicate.data()!;
      if (data.chatId !== chatId || data.senderId !== caller || data.type !== 'offer') throw new HttpsError('already-exists', 'Requête déjà utilisée');
      return { success: true, messageId: duplicate.id, reused: true, replaced: false };
    }
    const users = await Promise.all([tx.get(db.collection('users').doc(caller)), tx.get(db.collection('users').doc(receiverId))]);
    if (hasBlockedUser(users[0].data(), receiverId) || hasBlockedUser(users[1].data(), caller)) throw new HttpsError('permission-denied', 'Cette conversation est bloquée');
    if (article.isSold === true || article.isActive === false) throw new HttpsError('failed-precondition', 'Un accord accepté doit être annulé explicitement avant toute nouvelle proposition');

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
      if (!agreement || !['cancelled', 'refunded'].includes(agreement.status)) {
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
          (thread?.messageId && thread.messageId !== originalId)) {
        throw new HttpsError('failed-precondition', 'Cette proposition a déjà reçu une réponse ou a été remplacée');
      }
    }
    const amount = counterKind === 'price' || !original ? input.amount : original.offer.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 1 || amount > 50000 || Math.abs(Math.round(amount * 100) - amount * 100) > 0.0000001 ||
        typeof article.price !== 'number' || amount > article.price) throw new HttpsError('invalid-argument', 'Montant de proposition invalide');
    const location = normalizeMeetupLocation(counterKind === 'location' || !original ? input.location : original.offer.meetup.location);
    const dateTimeRaw = counterKind === 'time' ? input.dateTime : original?.offer.meetup.dateTime;
    const dateTime = dateTimeRaw?.toDate?.() ?? (dateTimeRaw ? new Date(dateTimeRaw) : null);
    if (dateTime && (!Number.isFinite(dateTime.getTime()) || dateTime.getTime() <= Date.now())) throw new HttpsError('invalid-argument', 'Horaire de rencontre invalide');
    const existingSame = pending.find((d) => {
      const previous = d.data()!;
      return !originalId && previous.senderId === caller && previous.offer.amount === amount && previous.offer.message === (note || undefined) &&
        !offerExpired(previous.offer) && meetupLocationsEqual(previous.offer.meetup.location, location);
    });
    if (existingSame && pending.length === 1) {
      tx.set(requestRef, { chatId, senderId: caller, messageId: existingSame.id, createdAt: FieldValue.serverTimestamp() });
      return { success: true, messageId: existingSame.id, reused: true, replaced: false };
    }

    const now = new Date();
    const offer: FirebaseFirestore.DocumentData = { amount, status: 'pending', buyerId, articleId, offerId: requestId,
      meetup: { location, proposedBy: caller === sellerId ? 'seller' : 'buyer', ...(dateTime ? { dateTime } : {}) },
      expiresAt: new Date(now.getTime() + TTL_MS), ...(note ? { message: note } : {}),
      ...(originalId ? { originalOfferId: original?.offer.offerId ?? originalId } : {}) };
    for (const previous of pending) tx.update(previous.ref, {
      'offer.status': previous.id === originalId ? `counter_${counterKind}` : 'expired',
      'offer.expiredReason': 'replaced', 'offer.replacedByMessageId': requestId, 'offer.respondedAt': FieldValue.serverTimestamp(),
    });
    tx.set(messageRef, { type: 'offer', chatId, senderId: caller, receiverId, participants: context.chat.participants,
      content: `${originalId ? 'Contre-proposition' : 'Proposition'} de ${amount} $`, offer, timestamp: FieldValue.serverTimestamp(), status: 'sent', isRead: false });
    tx.set(threadRef, { articleId, buyerId, chatId, messageId: requestId, status: 'pending', updatedAt: FieldValue.serverTimestamp() });
    tx.set(requestRef, { chatId, senderId: caller, messageId: requestId, createdAt: FieldValue.serverTimestamp() });
    // Chat metadata/unread are maintained once by the existing message trigger.
    return { success: true, messageId: requestId, reused: false, replaced: pending.length > 0 };
  });
});

/** Rejecting a pending proposal never alters a transaction or accepted terms. */
export const rejectMeetupProposal = onCall(options, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connexion requise');
  const caller = request.auth.uid;
  const chatId = id(request.data?.chatId, 'Conversation');
  const messageId = id(request.data?.messageId, 'Offre');
  return db.runTransaction(async (tx) => {
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
    tx.update(messageRef, { 'offer.status': 'rejected', 'offer.respondedAt': FieldValue.serverTimestamp() });
    if (context.thread?.messageId === messageId) tx.update(context.threadRef, { status: 'rejected', updatedAt: FieldValue.serverTimestamp() });
    return { success: true, reused: false };
  });
});
