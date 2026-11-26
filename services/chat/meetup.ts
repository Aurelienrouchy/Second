import { collection, doc, getDoc, getDocFromServer, getDocsFromServer, limit, query, where, Timestamp, DocumentData } from 'firebase/firestore';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { auth, firestore, functions } from '../../config/firebaseConfig';
import { MeetupSpot } from '../../types';
import { stripUndefined } from './internal';
import { sendMeetupProposal, type ProposalOptions } from './offers';
import { sendSystemMessage } from './primitives';
import { assertTradeSessionCurrent, captureTradeSession, isDefinitiveTradeRefusal, staleTradeOperation } from '../tradeOperation';

async function confirmMeetupPhase(dispatch: () => Promise<{data: unknown}>,
  target: {transactionId: string; messageId: string; chatId: string; uid: string; phase: 'confirmed' | 'completed'},
  assertCurrent: () => void): Promise<void> {
  let data: unknown;
  try {data = (await dispatch()).data;}
  catch (error) {
    assertCurrent();
    if (isDefinitiveTradeRefusal(error)) throw error;
    // A lost response never starts another phase. Read the exact agreement
    // before reporting failure, including a completion now hidden by the UI.
    const order = (await getDocFromServer(doc(firestore, 'transactions', target.transactionId))).data();
    assertCurrent();
    const date = target.phase === 'confirmed' ? order?.meetupConfirmedAt : order?.meetupCompletedAt;
    const phaseMatches = target.phase === 'confirmed'
      ? ['meetup_confirmed', 'meetup_completed'].includes(order?.status)
      : order?.status === 'meetup_completed';
    if (order?.chatId === target.chatId && order.offerMessageId === target.messageId && order.deliveryType === 'meetup' &&
        [order.buyerId, order.sellerId].includes(target.uid) && phaseMatches && date instanceof Timestamp &&
        (target.phase !== 'confirmed' || order.sellerId === target.uid)) return;
    throw error;
  }
  assertCurrent();
  const result = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  if (!result || result.success !== true || typeof result.notificationCommitted !== 'boolean' ||
      result.deviceDeliveryVerified !== false || result.readingVerified !== false ||
      target.phase === 'confirmed' && result.chatId !== target.chatId) {
    throw new Error('Impossible de confirmer le résultat. Actualisez la conversation.');
  }
}
export function meetupStoryMatches(value: unknown, uid: string, reason: string, details: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.reportedBy === uid && v.reason === reason && v.details === details && v.reportedAt instanceof Timestamp && Number.isFinite(v.reportedAt.toMillis());
}

export async function sendMeetupOffer(
    chatId: string, senderId: string, receiverId: string, amount: number,
    meetupLocation: MeetupSpot, message?: string, assertContext?: () => void, options?: ProposalOptions
  ): Promise<string> {
    if (!auth.currentUser || auth.currentUser.uid !== senderId || !receiverId || receiverId === senderId) {
      throw new Error('Session invalide. Veuillez vous reconnecter.');
    }
    return sendMeetupProposal({ chatId, amount, location: stripUndefined(meetupLocation), ...(message ? { message } : {}) }, senderId, assertContext, options);
  }

export async function findMeetupTransactionId(
    chatId: string,
    userId: string,
    statuses: string[],
    messageId: string,
    assertContext: () => void = () => undefined
  ): Promise<string | null> {
    if (!userId) throw staleTradeOperation();
    const session = captureTradeSession(userId);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    const messageSnap = await getDocFromServer(doc(firestore, 'messages', messageId));
    assertCurrent();
    const message = messageSnap.data();
    if (!message || message.chatId !== chatId || !message.offer?.meetup || message.offer.status !== 'accepted') {
      throw new Error('Cette proposition ne correspond pas à un accord accepté.');
    }
    const chat = (await getDocFromServer(doc(firestore, 'chats', chatId))).data(); assertCurrent();
    if (!chat || !Array.isArray(chat.participants) || chat.participants.length !== 2 || new Set(chat.participants).size !== 2 || !chat.participants.includes(userId))
      throw new Error('Les parties de cette rencontre doivent être rapprochées.');
    const location = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const v = raw as Record<string, unknown>;
      const area = v.neighborhood && typeof v.neighborhood === 'object' ? v.neighborhood as Record<string, unknown> : {};
      const coords = v.coordinates && typeof v.coordinates === 'object' ? v.coordinates as Record<string, unknown> : {};
      return JSON.stringify([v.toArrange === true, v.id ?? null, v.name ?? null, v.category ?? null, area.id ?? null, area.name ?? null,
        area.borough ?? null, v.address ?? null, coords.latitude ?? null, coords.longitude ?? null]);
    };
    const offerLocation = location(message.offer.meetup.location);
    const matches = (data: DocumentData) => data.chatId === chatId && data.articleId === chat.articleId && data.deliveryType === 'meetup' &&
      typeof data.amount === 'number' && Number.isFinite(data.amount) && data.amount > 0 && data.amount === message.offer.amount &&
      data.buyerId !== data.sellerId && chat.participants.includes(data.buyerId) && chat.participants.includes(data.sellerId) &&
      [data.buyerId, data.sellerId].includes(userId) && statuses.includes(data.status) && offerLocation !== null &&
      location(data.meetupSpot) === offerLocation && (!data.offerMessageId || data.offerMessageId === messageId);
    if (message.offer.transactionId != null) {
      if (typeof message.offer.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(message.offer.transactionId)) throw new Error('L’accord lié doit être rapproché.');
      const linked = (await getDocFromServer(doc(firestore, 'transactions', message.offer.transactionId))).data(); assertCurrent();
      if (!linked || !matches(linked) || linked.offerMessageId !== messageId) throw new Error('La proposition et son accord exact doivent être rapprochés.');
      return message.offer.transactionId;
    }
    const txCol = collection(firestore, 'transactions');
    // En tant qu'acheteur
    const asBuyer = await getDocsFromServer(
      query(
        txCol,
        where('chatId', '==', chatId),
        where('buyerId', '==', userId),
        where('status', 'in', statuses), limit(101)
      )
    );
    assertCurrent();
    // En tant que vendeur
    const asSeller = await getDocsFromServer(
      query(
        txCol,
        where('chatId', '==', chatId),
        where('sellerId', '==', userId),
        where('status', 'in', statuses), limit(101)
      )
    );
    assertCurrent();
    // Legacy display terms alone do not bind an agreement to this accepted
    // message. A protected offerMessageId is required before a mutation.
    const candidates = [...new Map([...asBuyer.docs, ...asSeller.docs].filter(snapshot => matches(snapshot.data()) && snapshot.data().offerMessageId === messageId)
      .map(snapshot => [snapshot.id, snapshot])).values()];
    if (asBuyer.size >= 101 || asSeller.size >= 101 || candidates.length > 1) throw new Error('Plusieurs accords ou une recherche incomplète nécessitent un rapprochement. Aucune première commande n’a été choisie.');
    if (candidates.length === 0 && [...asBuyer.docs, ...asSeller.docs].some(snapshot => matches(snapshot.data())))
      throw new Error('L’ancien accord n’est pas lié à cette proposition. Contactez notre équipe pour rapprocher la rencontre.');
    return candidates[0]?.id ?? null;
  }

export async function readMeetupReportContext(chatId: string, messageId: string, uid: string, assertContext: () => void) {
  const session = captureTradeSession(uid), assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
  assertCurrent();
  const transactionId = await findMeetupTransactionId(chatId, uid, ['meetup_pending', 'meetup_confirmed', 'disputed', 'cancelled', 'meetup_completed', 'completed', 'expired'], messageId, assertCurrent);
  assertCurrent(); if (!transactionId) throw new Error('L’accord exact de cette rencontre doit être rapproché.');
  const order = (await getDocFromServer(doc(firestore, 'transactions', transactionId))).data(); assertCurrent();
  if (!order || order.chatId !== chatId || order.deliveryType !== 'meetup' || ![order.buyerId, order.sellerId].includes(uid)) throw new Error('Rencontre non qualifiée.');
  const initial = order.noShowReport;
  const disputeId = typeof initial?.disputeId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(initial.disputeId) ? initial.disputeId : null;
  if (initial && !disputeId) throw new Error('Le dossier initial de cette rencontre doit être rapproché.');
  return { transactionId, disputeId, initialReporterId: typeof initial?.reportedBy === 'string' ? initial.reportedBy : null,
    ownDeclaration: initial?.reportedBy === uid ? initial : order.counterReport?.reportedBy === uid ? order.counterReport : null };
}

/** Private support reads preserve completed agreements without granting a meetup action. */
export async function readMeetupSupportContext(chatId: string, messageId: string, uid: string, assertContext: () => void): Promise<{ transactionId: string }> {
  const session = captureTradeSession(uid), assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
  assertCurrent();
  const message = (await getDocFromServer(doc(firestore, 'messages', messageId))).data(); assertCurrent();
  if (!message || message.chatId !== chatId || !message.offer?.meetup || !['accepted', 'completed'].includes(message.offer.status))
    throw new Error('La proposition historique exacte de cette rencontre doit être rapprochée.');
  const matches = (order: DocumentData) => order.chatId === chatId && order.offerMessageId === messageId && order.deliveryType === 'meetup' &&
    typeof order.buyerId === 'string' && typeof order.sellerId === 'string' && order.buyerId !== order.sellerId &&
    [order.buyerId, order.sellerId].includes(session.uid) && [order.buyerId, order.sellerId].includes(message.senderId) &&
    (message.receiverId == null || [order.buyerId, order.sellerId].includes(message.receiverId) && message.receiverId !== message.senderId) &&
    (message.offer.articleId == null || message.offer.articleId === order.articleId);
  if (message.offer.transactionId != null) {
    if (typeof message.offer.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(message.offer.transactionId)) throw new Error('La référence historique de l’accord doit être rapprochée.');
    const order = (await getDocFromServer(doc(firestore, 'transactions', message.offer.transactionId))).data(); assertCurrent();
    if (!order || !matches(order)) throw new Error('La proposition et la commande historiques ne correspondent pas à ce compte.');
    return { transactionId: message.offer.transactionId };
  }
  // Legacy support may use one exact protected offerMessageId. Similar display
  // terms, a missing native link or a bounded ambiguous scan never select an agreement.
  const states = ['meetup_pending', 'meetup_confirmed', 'meetup_completed', 'completed', 'disputed', 'cancelled', 'expired'];
  const buyer = await getDocsFromServer(query(collection(firestore, 'transactions'), where('chatId', '==', chatId),
    where('buyerId', '==', session.uid), where('status', 'in', states), limit(101))); assertCurrent();
  const seller = await getDocsFromServer(query(collection(firestore, 'transactions'), where('chatId', '==', chatId),
    where('sellerId', '==', session.uid), where('status', 'in', states), limit(101))); assertCurrent();
  const candidates = [...new Map([...buyer.docs, ...seller.docs].filter(snapshot => matches(snapshot.data())).map(snapshot => [snapshot.id, snapshot])).values()];
  if (buyer.size >= 101 || seller.size >= 101 || candidates.length !== 1) throw new Error('L’accord historique unique doit être rapproché. Aucune première commande n’a été choisie.');
  return { transactionId: candidates[0].id };
}

export async function confirmMeetup(
    chatId: string,
    messageId: string,
    userId: string,
    assertContext: () => void = () => undefined,
  ): Promise<void> {
    if (!userId) throw staleTradeOperation();
    const session = captureTradeSession(userId);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    try {
      const messageRef = doc(firestore, 'messages', messageId);
      const messageDoc = await getDoc(messageRef);
      assertCurrent();

      if (!messageDoc.exists()) {
        throw new Error('Message non trouvé');
      }

      const messageData = messageDoc.data();
      const offer = messageData?.offer;

      if (!offer?.meetup) {
        throw new Error('Détails du meetup non trouvés');
      }

      // Résout la transaction meetup_pending pour ce chat (en tant que vendeur :
      // seul le vendeur peut confirmer, et la callable revérifie ce rôle).
      const transactionId = await findMeetupTransactionId(chatId, userId, [
        'meetup_pending', 'meetup_confirmed',
      ], messageId, assertCurrent);
      assertCurrent();

      if (!transactionId) {
        if (__DEV__) console.warn('[ChatService] confirmMeetup: no meetup_pending transaction found for chatId', chatId);
        throw new Error('Aucune transaction de rencontre à confirmer.');
      }

      // Transition atomique tx + message via la callable server-authoritative.
      const confirmMeetupTransactionFn = httpsCallable<
        { transactionId: string; messageId: string; expectedUid: string },
        { success: boolean; chatId: string | null; notificationCommitted: boolean; deviceDeliveryVerified: false; readingVerified: false }
      >(functions, 'confirmMeetupTransaction');
      await confirmMeetupPhase(() => confirmMeetupTransactionFn({transactionId, messageId, expectedUid: session.uid}),
        {transactionId, messageId, chatId, uid: session.uid, phase: 'confirmed'}, assertCurrent);
      assertCurrent();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors de la confirmation du meetup: ${message}`);
    }
  }

export async function reportNoShow(
    chatId: string,
    messageId: string,
    reporterId: string,
    reason?: string,
    details?: string,
    assertContext: () => void = () => undefined,
    expectedDisputeId?: string | null,
  ): Promise<void> {
    if (!reporterId) throw staleTradeOperation();
    const session = captureTradeSession(reporterId);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    try {
      const context = await readMeetupReportContext(chatId, messageId, reporterId, assertCurrent);
      const { transactionId } = context;
      assertCurrent();

      if (!transactionId) {
        if (__DEV__) {
          console.warn('[ChatService] reportNoShow: no reportable transaction for chatId', chatId);
        }
        throw new Error("Aucune transaction de rencontre à signaler n'a été trouvée.");
      }

      if (typeof details !== 'string' || !details.trim() || details.trim().length > 1000) throw new Error('Décrivez vos faits en 1 à 1000 caractères.');
      const expectedCase = expectedDisputeId === undefined ? context.disputeId : expectedDisputeId;
      const ownReplay = meetupStoryMatches(context.ownDeclaration, session.uid, reason ?? 'other_party_no_show', details.trim());
      if (context.disputeId !== expectedCase && !(expectedCase === null && ownReplay)) throw new Error('Le dossier ciblé a changé. Le récit est conservé pour rapprochement.');
      const reportMeetupNoShowFn = httpsCallable<Record<string, unknown>, unknown>(functions, 'reportMeetupNoShow');
      // Pas d'undefined vers la callable : on omet `details` s'il est vide.
      const { data } = await reportMeetupNoShowFn({
        transactionId,
        expectedUid: reporterId,
        ...(reason ? { reason } : {}),
        ...(details && details.trim().length > 0 ? { details: details.trim() } : {}),
        expectedDisputeId: expectedCase,
      });
      assertCurrent();
      const result = data && typeof data === 'object' ? data as Record<string, unknown> : null;
      const current = await readMeetupReportContext(chatId, messageId, reporterId, assertCurrent); assertCurrent();
      if (!result || result.success !== true || typeof result.disputeId !== 'string' || result.disputeId !== current.disputeId ||
          expectedCase != null && result.disputeId !== expectedCase || result.notificationCommitted !== true ||
          result.deviceDeliveryVerified !== false || result.readingVerified !== false ||
          !meetupStoryMatches(current.ownDeclaration, session.uid, reason ?? 'other_party_no_show', details.trim())) throw new Error('Le récit et son dossier doivent être relus. Le brouillon reste conservé.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors du signalement no-show: ${message}`);
    }
  }

export async function completeMeetup(
    chatId: string,
    messageId: string,
    userId: string,
    assertContext: () => void = () => undefined
  ): Promise<void> {
    if (!userId) throw staleTradeOperation();
    const session = captureTradeSession(userId);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    try {
      // Find the transaction linked to this chat FIRST. L'acheteur OU le vendeur
      // peut compléter (les deux étaient présents), donc on résout la
      // transaction selon le rôle du caller. Le backend
      // (`completeMeetupTransaction`) exige le statut `meetup_confirmed`.
      const transactionId = await findMeetupTransactionId(chatId, userId, [
        'meetup_confirmed',
      ], messageId, assertCurrent);
      assertCurrent();

      if (!transactionId) {
        if (__DEV__) console.warn('[ChatService] completeMeetup: no meetup_confirmed transaction found for chatId', chatId);
        throw new Error('Aucune transaction de rencontre à finaliser.');
      }

      // Appel server-authoritative D'ABORD. En cas d'échec (tx annulée,
      // disputée, statut incompatible…), on propage l'erreur sans toucher au
      // message — le badge « terminée » ne doit jamais précéder le backend.
      const completeMeetupFn = httpsCallable(functions, 'completeMeetupTransaction');
      await confirmMeetupPhase(() => completeMeetupFn({transactionId, messageId, expectedUid: session.uid}),
        {transactionId, messageId, chatId, uid: session.uid, phase: 'completed'}, assertCurrent);
      assertCurrent();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Erreur lors de la completion du meetup: ${message}`);
    }
  }

export async function cancelMeetup(
  chatId: string,
  messageId: string,
  userId: string,
  assertContext: () => void = () => undefined
): Promise<void> {
  if (!userId) throw staleTradeOperation();
  const session = captureTradeSession(userId);
  const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
  assertCurrent();
  try {
    const transactionId = await findMeetupTransactionId(chatId, userId, [
      'meetup_pending',
      'meetup_confirmed',
    ], messageId, assertCurrent);
    assertCurrent();

    if (!transactionId) {
      throw new Error('Aucune rencontre en cours à annuler.');
    }

    const cancel = httpsCallable<
      {transactionId: string; expectedUid: string},
      {success: boolean; currentStatus: string; cancellationCommitted: boolean; walletRefundCommitted: boolean}
    >(functions, 'cancelPendingTransaction');
    try {
      const {data} = await cancel({transactionId, expectedUid: session.uid});
      assertCurrent();
      if (data?.success !== true || data.currentStatus !== 'cancelled' || data.cancellationCommitted !== true || data.walletRefundCommitted !== true) {
        throw new Error('Impossible de confirmer cette annulation. Actualisez la conversation.');
      }
    } catch (error) {
      assertCurrent();
      if (isDefinitiveTradeRefusal(error)) throw error;
      const native = (await getDocFromServer(doc(firestore, 'transactions', transactionId))).data();
      assertCurrent();
      const receipt = native?.pendingCancellation;
      if (!native || native.status !== 'cancelled' || native.deliveryType !== 'meetup' || native.chatId !== chatId ||
          native.offerMessageId !== messageId || ![native.buyerId, native.sellerId].includes(session.uid) ||
          receipt?.state !== 'committed' || receipt.transactionId !== transactionId ||
          receipt.buyerId !== native.buyerId || receipt.sellerId !== native.sellerId || receipt.walletRefundCents !== 0 ||
          receipt.cardCapabilityNeutralized !== true) throw error;
    }
    assertCurrent();
    // The cancellation is now confirmed. An unavailable conversation notice
    // must not tell the member that their already cancelled meeting is live.
    try {await sendSystemMessage(chatId, 'meetup_cancelled');}
    catch (noticeError) {
      assertCurrent();
      if (__DEV__) console.warn('[ChatService] Rencontre annulée ; avis conversationnel indisponible.', noticeError);
    }
    assertCurrent();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Erreur lors de l'annulation de la rencontre: ${message}`);
  }
}
