import {activeLocalAgreementScope} from '../../utils/localAgreement';
import {PHASE1_CONTRACT} from '../../utils/phase1LegacyFence';
import {financialRecoverySourceFields} from "../../utils/financialRecoverySources";
import { FinancialRecoveryBlocked } from "../../utils/financialRecoveryInterlock";
import { financialRecoveryCommitCheckpoint } from "../../utils/financialRecoverySources";
import { withFinancialRecoveryScope } from "../../utils/financialRecoveryInterlock";
import {planInventoryAcquire,planInventoryFinish} from '../../utils/inventoryUnit';
import { articleReleaseUpdate, commitArticleRelease } from '../../utils/articleReservation';
import { hasBlockedUser, meetupLocationsEqual, meetupThreadId, normalizeMeetupLocation, offerExpired } from '../../utils/meetupOffers';
/**
 * Paiement — Remise en main propre : acceptation d'offre, confirmation, clôture, no-show.
 *
 * Éclaté depuis functions/src/callable/payments.ts (3881 lignes).
 * `callable/payments.ts` reste la façade : index.ts et sweepPendingLabels
 * importent depuis là, inchangés.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { assertPrivateAccountSession, withPrivateAccountSession } from '../../utils/privateAccountSession';
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../../config/firebase';
import { checkRateLimit, resolveCallerKey } from '../../utils/rateLimit';
import { prepareOperationalNotices, readOperationalNoticeReceipt, type OperationalNoticeInput } from '../../utils/notifications';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { captureServerEvent } from '../../lib/analytics';
import { RATE_LIMIT_WINDOW_MS } from './feeReduction';
import { assertMeetupAccountsAvailable, assertNewMeetupAdmission } from '../../utils/tradeAdmission';
import { shippingItemProjection } from '../../utils/shippingSourceIdentity';
import { hasActiveBankDispute } from '../../utils/bankDispute';
import { hasUnsettledRefund } from '../../utils/refundState';
import { returnToSenderBlocksProgress } from '../../shared/returnToSenderGuard';
import { createCashAgreement, createCashReservationRelease, qualifiedCashAgreement, cashReservationWasReleased,
  cashReservationCanBeReused, cashAmountsRemainUnfinanced } from '../../utils/cashMeetup';
import { recordOwnAdmissionRefusal, throwRecordedAdmissionRefusal } from '../../utils/admissionDecision';
import {captureSellerActivityAdmission} from '../../utils/eligibility';

/**
 * P1-4 / P1-7 — server-authoritative meetup offer acceptance.
 *
 * Previously the offer accept + meetup transaction creation lived entirely on
 * the client (chatService.acceptOffer → createMeetupTransaction), which trusted
 * client-supplied buyerId/sellerId. Worse, any path deriving buyer/seller from
 * `request.auth.uid` would mislabel the seller (the accepter) as the buyer.
 *
 * F9 — buyer/seller are derived from the ARTICLE, never from the offer sender:
 *   - sellerId = article.sellerId (the article owner is always the seller),
 *   - buyerId  = the OTHER chat participant.
 * Deriving the buyer from `message.senderId` broke seller counter-offers: when
 * the seller emits a counter-offer, senderId is the seller, so the old code
 * mislabelled the seller as buyer and threw permission-denied. The caller must
 * be the participant who did NOT emit the offer (the accepter) — so either side
 * can accept the other side's offer/counter-offer.
 *
 * In ONE runTransaction it:
 *   1. re-reads the offer message (must be a pending meetup offer in this chat),
 *   2. re-reads the article (must exist, seller-owned),
 *   3. flips `offer.status` to 'accepted',
 *   4. marks the article sold,
 *   5. creates the linked `meetup_pending` transaction (NO platform fee).
 *
 * F8 — idempotency for the direct-checkout meetup flow. checkout/meetup
 * pre-creates the meetup_pending tx (locking the article) THEN sends the offer,
 * so acceptMeetupOffer would otherwise reject on `isSold === true` — a 48h
 * dead-end. If a non-cancelled meetup transaction already exists for this
 * chat+buyer+article, we accept the offer and return THAT transaction id
 * instead of rejecting / creating a duplicate (no re-lock, no second tx).
 */

/**
 * Statuts de rencontre pour lesquels une transaction existante peut être
 * RÉUTILISÉE par F8 (pré-création par le checkout direct).
 *
 * Le filtre d'origine excluait seulement `cancelled` et `refunded`, donc il
 * réutilisait aussi une transaction `disputed` (gelée après un no-show) ou
 * `meetup_completed` (vente déjà conclue). Conséquences observées :
 *   - après un no-show, l'article est libéré et les deux parties peuvent
 *     convenir d'une nouvelle rencontre ; l'acceptation renvoyait alors la
 *     transaction GELÉE, sans reverrouiller l'article ni créer de transaction.
 *     Les deux parties croyaient tenir un accord infinalisable ;
 *   - après une vente conclue dans le même chat, la nouvelle offre se
 *     raccrochait à la transaction terminée.
 * Seules les deux étapes vivantes d'une rencontre sont réutilisables.
 */
/** First adoption is narrower than an exact accepted+linked replay. Current
 * cash producers omit provider/escrow/transport markers, write zero fees and
 * shipping, and total/payout equal to the agreed amount. Optional absent fields
 * remain absent; present null, malformed or contradictory values require review.
 * This does not establish any external payment or repair legacy finance. */
function assertLegacyCashReservation(data: FirebaseFirestore.DocumentData, amount: number) {
  const present = (field: string) => Object.prototype.hasOwnProperty.call(data, field);
  const numeric = (field: string, expected: number) => !present(field) ||
    (typeof data[field] === 'number' && Number.isFinite(data[field]) && data[field] === expected);
  const zeroFields = ['shippingCost', 'serviceFee', 'serviceFeePercent', 'serviceFeeFixed', 'serviceFeeMin', 'buyerFeeReduction',
    'taxTotal', 'taxGst', 'taxQst', 'insuranceCost', 'actualShippingCost', 'shippingCostDelta', 'returnLabelCost',
    'walletAmountUsed', 'walletPaidAmount', 'sellerCreditedCents', 'sellerPendingCreditCents', 'sellerHeldCreditCents',
    'sellerReleasedCents', 'sellerDebtRepaidCents', 'disputeFreezeCents', 'labelAttempts'];
  const incompatibleMarkers = ['stripePaymentIntentId', 'stripeClientSecret', 'stripeChargeId', 'capturedCardCents', 'paidAt',
    'stripeCheckoutCreatedAt', 'walletCheckoutAttemptId', 'walletCheckoutOutcome', 'walletDebitedAt',
    'fundsReleaseAt', 'fundsReleasedAt', 'refund', 'stripeRefundId', 'stripeRefundIssuedAt', 'refundedAt', 'refundedVia',
    'refundStartedAt', 'refundReason', 'refundLegacyOperationId', 'bankDispute', 'disputeId', 'disputeClosedAt', 'disputeOutcome',
    'shipEngineRateId', 'shipEngineLabelId', 'carrierCode', 'shippingLabelUrl', 'trackingNumber', 'trackingStatus', 'trackingUrl',
    'shippingAddress', 'intelcomBookingId', 'labelCreatedAt', 'lastLabelAttemptAt', 'labelStaleNudgedAt',
    'shippingReconciledAt', 'shippedAt', 'deliveredAt', 'deliveryFailedAt',
    'returnLabelId', 'returnTrackingNumber', 'returnLabelUrl', 'returnRequestedAt', 'returnDeliveredAt'];
  const falseFields = ['refundBlocked', 'refundLegacyReconciliationRequired', 'disputed', 'returnLabelPending'];
  if (hasActiveBankDispute(data) || hasUnsettledRefund(data) || incompatibleMarkers.some(present) ||
      !zeroFields.every(field => numeric(field, 0)) || !['totalAmount', 'sellerPayout'].every(field => numeric(field, amount)) ||
      falseFields.some(field => present(field) && data[field] !== false) ||
      (present('paidVia') && !['cash', 'meetup'].includes(data.paidVia))) {
    throw new HttpsError('failed-precondition', 'Cette réservation nécessite un examen avant une nouvelle acceptation.');
  }
}
export const acceptMeetupOffer = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/payments/meetup.acceptMeetupOffer"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'User must be authenticated');
    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, { functionName: 'acceptMeetupOffer', maxCallsAuthenticated: 20, maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS });
    const { chatId, messageId } = request.data ?? {};
    if (typeof chatId !== 'string' || !chatId || chatId.includes('/') || typeof messageId !== 'string' || !messageId || messageId.includes('/')) {
      throw new HttpsError('invalid-argument', 'chatId et messageId sont requis');
    }
    const callerUid = request.auth.uid;
    const messageRef = db.collection('messages').doc(messageId);
    const chatRef = db.collection('chats').doc(chatId);
    try {
      const result = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const messageSnap = await tx.get(messageRef);
        const message = messageSnap.data();
        if (!message || message.type !== 'offer' || !message.offer?.meetup || message.chatId !== chatId) {
          throw new HttpsError('failed-precondition', 'Proposition de rencontre introuvable dans cette conversation');
        }
        const chatSnap = await tx.get(chatRef);
        const chat = chatSnap.data();
        const participants = chat?.participants;
        if (!Array.isArray(participants) || participants.length !== 2 || !participants.includes(callerUid)) {
          throw new HttpsError('permission-denied', 'Vous ne participez pas à cette conversation');
        }
        if (!participants.includes(message.senderId) || callerUid === message.senderId) {
          throw new HttpsError('permission-denied', 'Vous ne pouvez pas accepter votre propre proposition');
        }
        const articleId = chat?.articleId;
        if (typeof articleId !== 'string' || !articleId || articleId.includes('/')) throw new HttpsError('failed-precondition', 'Article introuvable');
        const articleRef = db.collection('articles').doc(articleId);
        const articleSnap = await tx.get(articleRef);
        const article = articleSnap.data();
        if (!article) throw new HttpsError('not-found', 'Cet article n\'existe plus');
        const sellerId = article.sellerId;
        const buyerId = participants.find((p) => p !== sellerId);
        if (typeof sellerId !== 'string' || !participants.includes(sellerId) || typeof buyerId !== 'string' || buyerId === sellerId) {
          throw new HttpsError('failed-precondition', 'Participants invalides');
        }
        const offer = message.offer;
        if ((offer.articleId != null && offer.articleId !== articleId) || (offer.buyerId != null && offer.buyerId !== buyerId) ||
            (message.receiverId != null && message.receiverId !== callerUid) ||
            (Array.isArray(message.participants) && (message.participants.length !== 2 || !participants.every(uid => message.participants.includes(uid))))) {
          throw new HttpsError('failed-precondition', 'La proposition ne correspond plus à cet article ou à ses participants.');
        }
        const amount = offer.amount;
        // The exact old acceptance is history, not permission to reserve again.
        // Qualify it before current article-price/admission guards: the seller
        // may have edited the now released listing or made a different accord.
        if (offer.status === 'accepted' && typeof offer.transactionId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(offer.transactionId)) {
          const old = (await tx.get(db.collection('transactions').doc(offer.transactionId))).data();
          if (old && cashReservationWasReleased(offer.transactionId, old) && old.offerMessageId === messageId &&
              old.articleId === articleId && old.chatId === chatId && old.buyerId === buyerId && old.sellerId === sellerId &&
              old.amount === amount && meetupLocationsEqual(old.meetupSpot, offer.meetup.location) &&
              old.cashAgreement.offeredBy === message.senderId && old.cashAgreement.acceptedBy === callerUid &&
              offer.acceptedAt instanceof Timestamp && offer.acceptedAt.isEqual(old.cashAgreement.acceptedAt)) {
            return { transactionId: offer.transactionId, buyerId, sellerId, amount, articleId, reused: true,
              negotiated: amount < article.price, historicalAcceptance: true, reservationReleased: true, newReservationCommitted: false };
          }
        }
        if (typeof article.price !== 'number' || !Number.isFinite(article.price) || article.price < 0.01 ||
            typeof amount !== 'number' || !Number.isFinite(amount) || amount < Math.min(1, article.price) || amount > 50000 ||
            Math.abs(Math.round(amount * 100) - amount * 100) > 0.0000001 ||
            amount > article.price) throw new HttpsError('failed-precondition', 'Montant de proposition invalide');
        const offerLocation = normalizeMeetupLocation(offer.meetup.location);
        const threadRef = db.collection('meetup_offer_threads').doc(meetupThreadId(articleId, buyerId));
        const thread = (await tx.get(threadRef)).data();
        // Read queries INSIDE the transaction: an old offer cannot attach to an
        // unrelated agreement, and two buyers cannot reserve the same article.
        const existingTxSnap = await tx.get(db.collection('transactions').where('articleId', '==', articleId).limit(101));
        const terminal = ['cancelled', 'refunded', 'completed', 'meetup_completed'];
        const released = new Set<string>();
        for (const candidate of existingTxSnap.docs) if (await cashReservationCanBeReused(tx, candidate.id, candidate.data())) released.add(candidate.id);
        const live = existingTxSnap.docs.filter((d) => returnToSenderBlocksProgress(d.data()) || !released.has(d.id) &&
          (d.data().cashReservationRelease != null || !terminal.includes(d.data().status) || hasActiveBankDispute(d.data()) || hasUnsettledRefund(d.data())));
        const exactTransaction = (data: FirebaseFirestore.DocumentData) => data.chatId === chatId && data.buyerId === buyerId && data.sellerId === sellerId &&
          data.deliveryType === 'meetup' && data.amount === amount && meetupLocationsEqual(data.meetupSpot, offerLocation);

        if (offer.status === 'accepted' && typeof offer.transactionId === 'string') {
          // Saturation does not erase a real exact historical agreement. A
          // direct native link is evidence of history, never a new reservation.
          const linked = live.find((d) => d.id === offer.transactionId) ?? await tx.get(db.collection('transactions').doc(offer.transactionId));
          const linkedData = linked.data();
          if (linkedData && linkedData.offerMessageId === messageId && exactTransaction(linkedData)) {
            return { transactionId: linked.id, buyerId, sellerId, amount, articleId, reused: true, negotiated: amount < article.price };
          }
          throw new HttpsError('failed-precondition', 'Cet accord ne peut plus être accepté');
        }
        if (existingTxSnap.size >= 101) throw new HttpsError('failed-precondition', 'L’historique des réservations doit être rapproché avant un nouvel accord.');
        if (existingTxSnap.docs.some(d => returnToSenderBlocksProgress(d.data()))) {
          throw new HttpsError('failed-precondition', 'Un retour à l’expéditeur signalé doit être examiné avant une nouvelle réservation de cet article.');
        }
        if (offer.status !== 'pending' || offerExpired(offer) || (thread?.messageId && thread.messageId !== messageId)) {
          throw new HttpsError('failed-precondition', 'Cette proposition a déjà reçu une réponse, a expiré ou a été remplacée');
        }
        if (!thread?.messageId) {
          const articleChats = await tx.get(db.collection('chats').where('articleId', '==', articleId));
          let pendingLegacy = 0;
          for (const candidateChat of articleChats.docs.filter((d) => d.data().participants?.includes(buyerId) && d.data().participants?.includes(sellerId))) {
            const legacyOffers = await tx.get(db.collection('messages').where('chatId', '==', candidateChat.id).where('type', '==', 'offer'));
            pendingLegacy += legacyOffers.docs.filter((d) => d.data().offer?.meetup && d.data().offer.status === 'pending' && !offerExpired(d.data().offer)).length;
          }
          if (pendingLegacy > 1) throw new HttpsError('failed-precondition', 'Plusieurs anciennes propositions sont en attente. Envoyez une nouvelle proposition pour les remplacer.');
        }
        if (article.isActive === false) throw new HttpsError('failed-precondition', 'Cet article n\'est plus disponible');
        const userSnaps = await Promise.all(participants.map((uid) => tx.get(db.collection('users').doc(uid))));
        await assertPrivateAccountSession(request, tx);
        const admissionRefusal = await recordOwnAdmissionRefusal(tx, {
          request,
          ownerId: callerUid, operation: 'acceptMeetupOffer', scope: callerUid === sellerId ? 'sell' : 'buy',
          sourceContext: { kind: 'meetup_offer', chatId, messageId, articleId,
            offerSourceHash: createHash('sha256').update(JSON.stringify({ chatId, messageId, articleId, amount,
              location: offerLocation, senderId: message.senderId, buyerId, sellerId })).digest('hex') },
        });
        if (admissionRefusal) return admissionRefusal;
        assertMeetupAccountsAvailable(userSnaps[participants.indexOf(callerUid)].data(),
          userSnaps[participants.findIndex(uid => uid !== callerUid)].data(), callerUid === sellerId ? 'sell' : 'buy');
        if (userSnaps.some(snap => !snap.exists)) throw new HttpsError('failed-precondition', 'Un participant n’est plus disponible');
        if (hasBlockedUser(userSnaps[0].data(), participants[1]) || hasBlockedUser(userSnaps[1].data(), participants[0])) {
          throw new HttpsError('permission-denied', 'Cette conversation est bloquée');
        }
        // Adopt only an unlinked legacy reservation with the SAME negotiated
        // amount and location. An already accepted transaction is immutable.
        const legacy = live.find((d) => d.data().status === 'meetup_pending' && !d.data().offerMessageId && exactTransaction(d.data()));
        if (live.some((d) => d.id !== legacy?.id) || (!legacy && article.isSold === true)) {
          throw new HttpsError('failed-precondition', 'Un accord existe déjà pour cet article');
        }
        if (article.activeTransactionId != null) {
          if (typeof article.activeTransactionId !== 'string' || article.activeTransactionId.includes('/')) throw new HttpsError('failed-precondition', 'Le lien de réservation doit être examiné.');
          if (article.activeTransactionId !== legacy?.id) {
            const linked = (await tx.get(db.collection('transactions').doc(article.activeTransactionId))).data();
            if (!linked || linked.articleId !== articleId || returnToSenderBlocksProgress(linked) || (!await cashReservationCanBeReused(tx, article.activeTransactionId, linked) &&
                (linked.cashReservationRelease != null || !terminal.includes(linked.status))) ||
                hasActiveBankDispute(linked) || hasUnsettledRefund(linked)) throw new HttpsError('failed-precondition', 'Un accord est encore lié à cet article.');
          }
        }
        if (legacy) {
          assertLegacyCashReservation(legacy.data(), amount);
        }
        // An unlinked pending reservation does not prove bilateral acceptance.
        // Only the exact accepted+linked replay above is an existing agreement.
        const admittedArticle = await assertNewMeetupAdmission(tx, callerUid, sellerId, buyerId, articleId);
        const articleSnapshot = shippingItemProjection(admittedArticle);
        const transactionRef = legacy?.ref ?? db.collection('transactions').doc(`meetup_${messageId}`);
        const cashSourceSnapshot=await tx.get(transactionRef);
        if (!legacy && cashSourceSnapshot.exists) throw new HttpsError('failed-precondition', 'Un ancien dossier porte déjà cette référence.');
        const inventory=await planInventoryAcquire(tx,articleId,admittedArticle,{kind:'purchase',id:transactionRef.id,sourceArticleId:articleId});
        const sellerActivityAdmission=await captureSellerActivityAdmission(tx,[sellerId],'sell',
          {kind:'purchase',id:transactionRef.id,phase:'cash_agreement'});
        const cashOrder = {sellerActivityAdmission, inventoryUnitCommitment:inventory.commitment, articleId, buyerId, sellerId, articleSnapshot, amount, shippingCost: 0, serviceFee: 0,
          totalAmount: amount, sellerPayout: amount, deliveryType: 'meetup', currency: 'CAD', paidVia: 'cash', chatId,
          offerMessageId: messageId, meetupSpot: offerLocation };
        if (legacy) {
          const original = legacy.data();
          // update() preserves old keys. Qualify that MERGED native document,
          // and never replace a contradictory rail/currency/provenance to make
          // it appear unfinanced. Missing placeholder facts may be completed
          // by this first bilateral acceptance; prior financial facts may not.
          if ((Object.prototype.hasOwnProperty.call(original, 'currency') && original.currency !== 'CAD') ||
              (Object.prototype.hasOwnProperty.call(original, 'paidVia') && original.paidVia !== 'cash') ||
              ['cashAgreement', 'cashReservationRelease', 'cashReservationReviewRequired', 'noShowReport', 'counterReport',
                'meetupNoShowResolution', 'meetupCompletedAt', 'meetupCompletedBy', 'completedAt'].some(k => Object.prototype.hasOwnProperty.call(original, k)) ||
              !cashAmountsRemainUnfinanced({ ...original, ...cashOrder })) {
            throw new HttpsError('failed-precondition', 'Cette ancienne réservation nécessite un rapprochement avant une acceptation cash.');
          }
        }
        // All four acceptance records describe this one business instant.
        // Local witness materialization happens before the final native flush;
        // separate serverTimestamp sentinels could otherwise become different
        // instants and invalidate the frozen agreement's later read authority.
        const acceptedAt = Timestamp.now();
        const cashAgreement = { ...createCashAgreement(transactionRef.id, cashOrder, message.senderId, callerUid), acceptedAt };
        await assertPrivateAccountSession(request, tx);
        inventory.commit();
        if (!legacy) {
          await recoveryCommit({refs: [(transactionRef).path]});
    tx.set(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,cashSourceSnapshot,{ ...cashOrder,cashAgreement,status:'meetup_pending',createdAt:acceptedAt}));
          await recoveryCommit({refs: [(articleRef).path]});
    tx.update(articleRef, { isSold: true, activeTransactionId: transactionRef.id });
        } else {
          await recoveryCommit({refs: [(transactionRef).path]});
    tx.update(transactionRef, await financialRecoverySourceFields('purchase',transactionRef,cashSourceSnapshot,{...cashOrder,cashAgreement}));
          await recoveryCommit({refs: [(articleRef).path]});
    tx.update(articleRef, { isSold: true, activeTransactionId: transactionRef.id });
        }
        await recoveryCommit({refs: [(messageRef).path]});
    tx.update(messageRef, { phase1Contract: PHASE1_CONTRACT,
      ...(activeLocalAgreementScope()?.control ? {phase1Source: {protocol: 'phase1_message_origin_v1', ...activeLocalAgreementScope()!.control!}} : {}),
      'offer.status': 'accepted', 'offer.acceptedAt': acceptedAt, 'offer.transactionId': transactionRef.id });
        await recoveryCommit({refs: [(threadRef).path]});
    tx.set(threadRef, { articleId, buyerId, chatId, messageId, status: 'accepted', transactionId: transactionRef.id, updatedAt: acceptedAt });
        return { transactionId: transactionRef.id, buyerId, sellerId, amount, articleId, reused: !!legacy, negotiated: amount < article.price };
      });
      if ('admissionRefused' in result) return await throwRecordedAdmissionRefusal(result);
      logger.info('Meetup offer accepted (server-authoritative)', { chatId, messageId, transactionId: result.transactionId, reused: result.reused });
      if (!result.reused) {
        await captureServerEvent(result.buyerId, 'order_created', { transaction_id: result.transactionId, article_id: result.articleId,
          buyer_id: result.buyerId, seller_id: result.sellerId, delivery_type: 'meetup', amount_cents: Math.round(result.amount * 100),
          negotiated: result.negotiated, source: 'offer_accept', $insert_id: `order_created_${result.transactionId}` });
      }
      return { success: true, transactionId: result.transactionId, reused: result.reused,
        ...(result.historicalAcceptance ? { historicalAcceptance: true, reservationReleased: true, newReservationCommitted: false } : {}) };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) {
        // Expiration must survive the aborted acceptance transaction without
        // overwriting an offer concurrently accepted by another invocation.
        await db.runTransaction(async tx => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
          await assertPrivateAccountSession(request, tx);
          const current = (await tx.get(messageRef)).data();
          if (current?.chatId === chatId && current.offer?.status === 'pending' && offerExpired(current.offer)) {
            await recoveryCommit({refs: [(messageRef).path]});
    tx.update(messageRef, { 'offer.status': 'expired', 'offer.expiredAt': FieldValue.serverTimestamp() });
          }
        });
        throw error;
      }
      logger.error('Error accepting meetup offer:', error);
      throw new HttpsError('internal', 'Impossible d\'accepter cette proposition');
    }
  }))
);

// =============================================================================
// CONFIRM MEETUP TRANSACTION — Seller confirms the meetup appointment (atomic)
// =============================================================================

function meetupPhaseNotices(data: FirebaseFirestore.DocumentData, transactionId: string,
  phase: 'confirmed' | 'completed', declaredBy: string): OperationalNoticeInput[] {
  if (typeof data.buyerId !== 'string' || !data.buyerId || typeof data.sellerId !== 'string' || !data.sellerId ||
      data.buyerId === data.sellerId || ![data.buyerId, data.sellerId].includes(declaredBy)) {
    throw new HttpsError('failed-precondition', 'Les participants de cet accord nécessitent un examen.');
  }
  return [data.buyerId, data.sellerId].map(userId => ({
    eventKey: `meetup:${transactionId}:${phase}`, userId, type: `meetup_${phase}`,
    title: phase === 'confirmed' ? 'Rencontre confirmée' : 'Rencontre déclarée terminée',
    message: phase === 'confirmed'
      ? 'Le vendeur a confirmé le rendez-vous. Consultez votre accord dans la conversation. Cet avis ne prouve aucun encaissement, paiement en main propre ou remise physique.'
      : 'Un participant a déclaré la rencontre terminée. Seconde ne vérifie ni le paiement en main propre ni la remise physique. Vous pouvez consulter cet accord ou demander de l’aide.',
    data: { transactionId, ownerId: userId, declaredBy, phase,
      ...(typeof data.chatId === 'string' && data.chatId ? { chatId: data.chatId } : {}) },
  }));
}

async function meetupPhaseReceipt(tx: FirebaseFirestore.Transaction, data: FirebaseFirestore.DocumentData,
  transactionId: string, phase: 'confirmed' | 'completed') {
  const noticeState = phase === 'confirmed' ? data.meetupConfirmationNotice : data.meetupCompletionNotice;
  if (noticeState?.protocol !== 'meetup_phase_notice_v1' || noticeState.transactionId !== transactionId ||
      noticeState.phase !== phase || typeof noticeState.declaredBy !== 'string' ||
      noticeState.declaredBy !== (phase === 'confirmed' ? data.meetupConfirmedBy : data.meetupCompletedBy) ||
      !((phase === 'confirmed' ? data.meetupConfirmedAt : data.meetupCompletedAt) instanceof Timestamp)) return false;
  const notices = meetupPhaseNotices(data, transactionId, phase, noticeState.declaredBy);
  const receipts = await Promise.all(notices.map(input => readOperationalNoticeReceipt(tx, input)));
  if (receipts.some(receipt => !receipt)) throw new HttpsError('failed-precondition', 'Les avis de cet accord nécessitent un examen.');
  return true;
}

/**
 * P1-5 — server-authoritative meetup confirmation.
 *
 * Previously the client (chatService.confirmMeetup) wrote
 * `updateDoc(txRef, { status: 'meetup_confirmed' })` directly and relied on
 * Firestore rules to gate the seller. That left the message timestamp
 * (`offer.meetup.confirmedAt`) and the transaction status update as two
 * non-atomic client writes that could diverge.
 *
 * This callable performs the `meetup_pending → meetup_confirmed` transition
 * atomically together with the message confirmation timestamp, inside a single
 * runTransaction. buyer/seller are derived from the transaction document; only
 * the SELLER may confirm (they own the appointment slot). The matching Firestore
 * rule tightening is carried by be-firestore-rules.
 */

/**
 * P1-5 — server-authoritative meetup confirmation.
 *
 * Previously the client (chatService.confirmMeetup) wrote
 * `updateDoc(txRef, { status: 'meetup_confirmed' })` directly and relied on
 * Firestore rules to gate the seller. That left the message timestamp
 * (`offer.meetup.confirmedAt`) and the transaction status update as two
 * non-atomic client writes that could diverge.
 *
 * This callable performs the `meetup_pending → meetup_confirmed` transition
 * atomically together with the message confirmation timestamp, inside a single
 * runTransaction. buyer/seller are derived from the transaction document; only
 * the SELLER may confirm (they own the appointment slot). The matching Firestore
 * rule tightening is carried by be-firestore-rules.
 */

export const confirmMeetupTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/payments/meetup.confirmMeetupTransaction"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    if (request.data?.expectedUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'La session de cette confirmation a changé.');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'confirmMeetupTransaction',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, messageId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const callerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);
    const messageRef =
      typeof messageId === 'string' && messageId.length > 0
        ? db.collection('messages').doc(messageId)
        : null;

    try {
      const result = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        // ── ALL READS FIRST ──
        const txSnap = await tx.get(txRef);
        if (!txSnap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }
        const data = txSnap.data()!;

        // Only the SELLER (derived from the tx doc) may confirm the appointment.
        if (data.sellerId !== callerUid) {
          throw new HttpsError('permission-denied', 'Seul le vendeur peut confirmer la rencontre');
        }

        if (data.deliveryType !== 'meetup') {
          throw new HttpsError('failed-precondition', 'Cette transaction n\'est pas une rencontre');
        }

        // Gate on the TRANSACTION status, not a message field.
        if (!['meetup_pending', 'meetup_confirmed'].includes(data.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de confirmer la rencontre depuis le statut ${data.status}`
          );
        }

        // Validate the linked message belongs to this transaction's chat (if any).
        let messageSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (messageRef) {
          messageSnap = await tx.get(messageRef);
          if (messageSnap.exists) {
            const msg = messageSnap.data()!;
            if (msg.chatId !== data.chatId || msg.type !== 'offer' || msg.offer?.status !== 'accepted' ||
                !msg.offer.meetup || msg.offer.amount !== data.amount ||
                !meetupLocationsEqual(msg.offer.meetup.location, data.meetupSpot) ||
                (data.offerMessageId && data.offerMessageId !== messageRef.id) ||
                (msg.offer.transactionId && msg.offer.transactionId !== transactionId)) {
              throw new HttpsError('failed-precondition', 'Le message ne correspond pas à cet accord accepté');
            }
          } else {
            throw new HttpsError('not-found', 'Proposition introuvable');
          }
        } else if (data.offerMessageId) {
          throw new HttpsError('invalid-argument', 'La proposition liée est requise');
        }
        if (data.status === 'meetup_confirmed') return { chatId: data.chatId ?? null,
          notificationCommitted: await meetupPhaseReceipt(tx, data, transactionId, 'confirmed') };
        const notices = await prepareOperationalNotices(tx, meetupPhaseNotices(data, transactionId, 'confirmed', callerUid));

        // ── ALL WRITES AFTER ALL READS ──
        await assertPrivateAccountSession(request, tx);
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{
          status: 'meetup_confirmed',
          meetupConfirmedAt: FieldValue.serverTimestamp(),
          meetupConfirmedBy: callerUid,
          meetupConfirmationNotice: { protocol: 'meetup_phase_notice_v1', transactionId, phase: 'confirmed', declaredBy: callerUid },
          ...(messageRef ? { offerMessageId: messageRef.id } : {}),
        }));

        if (messageRef && messageSnap && messageSnap.exists) {
          await recoveryCommit({refs: [(messageRef).path]});
    tx.update(messageRef, {
            'offer.meetup.confirmedAt': FieldValue.serverTimestamp(),
          });
        }

        notices.commit();
        return { chatId: data.chatId ?? null, notificationCommitted: true };
      });

      logger.info('Meetup transaction confirmed (server-authoritative)', {
        transactionId,
        sellerId: callerUid,
      });

      return { success: true, chatId: result.chatId, notificationCommitted: result.notificationCommitted,
        deviceDeliveryVerified: false, readingVerified: false };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error confirming meetup transaction:', error);
      throw new HttpsError('internal', `Failed to confirm meetup: ${message}`);
    }
  }))
);

// =============================================================================
// COMPLETE MEETUP TRANSACTION — Either party confirms the cash exchange
// =============================================================================

/**
 * Either party confirms the meetup exchange was completed. This transitions the
 * transaction from `meetup_confirmed` → `meetup_completed`, sets
 * `meetupCompletedAt`, and thereby unlocks review eligibility.
 *
 * Meetup is a pure cash-in-hand exchange: NO money flows through the platform,
 * so this NEVER credits the seller wallet and writes NO ledger entry.
 *
 * A3 FIX: completion was previously buyer-only. A meetup is a two-sided in-person
 * exchange — if the buyer ghosts after the seller confirmed the appointment, the
 * transaction would sit in `meetup_confirmed` forever (zombie) and the article
 * stays locked (toggleArticleSold/createTransaction block on meetup_confirmed).
 * Both the buyer AND the seller can now mark the meetup completed; the scheduler
 * additionally auto-cancels abandoned `meetup_confirmed` transactions (see
 * expireOrphanedTransactions), so the article can never be stuck unsellable.
 */

/**
 * Either party confirms the meetup exchange was completed. This transitions the
 * transaction from `meetup_confirmed` → `meetup_completed`, sets
 * `meetupCompletedAt`, and thereby unlocks review eligibility.
 *
 * Meetup is a pure cash-in-hand exchange: NO money flows through the platform,
 * so this NEVER credits the seller wallet and writes NO ledger entry.
 *
 * A3 FIX: completion was previously buyer-only. A meetup is a two-sided in-person
 * exchange — if the buyer ghosts after the seller confirmed the appointment, the
 * transaction would sit in `meetup_confirmed` forever (zombie) and the article
 * stays locked (toggleArticleSold/createTransaction block on meetup_confirmed).
 * Both the buyer AND the seller can now mark the meetup completed; the scheduler
 * additionally auto-cancels abandoned `meetup_confirmed` transactions (see
 * expireOrphanedTransactions), so the article can never be stuck unsellable.
 */

export const completeMeetupTransaction = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/payments/meetup.completeMeetupTransaction"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    if (request.data?.expectedUid !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'La session de cette déclaration de fin a changé.');
    }

    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'completeMeetupTransaction',
      maxCallsAuthenticated: 20,
      maxCallsUnauthenticated: 0,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { transactionId, messageId } = request.data ?? {};
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }

    const callerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);

    try {
      const transactionData = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const txSnap = await tx.get(txRef);
        if (!txSnap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }

        const data = txSnap.data()!;

        if (data.deliveryType !== 'meetup') throw new HttpsError('failed-precondition', 'Cette transaction n’est pas une rencontre.');

        // A3 FIX: either party (buyer or seller) can confirm the in-person
        // exchange happened. Both were physically present at the meetup, so
        // either can release it — this prevents a zombie transaction when one
        // side never taps "completed".
        if (data.buyerId !== callerUid && data.sellerId !== callerUid) {
          throw new HttpsError('permission-denied', 'Only the buyer or seller can complete the meetup');
        }

        // Must be in meetup_confirmed status
        if (!['meetup_confirmed', 'meetup_completed'].includes(data.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Cannot complete meetup from status ${data.status}`
          );
        }

        const sellerId = data.sellerId;

        // La bulle de chat décide d'afficher « Confirmer » / « Signaler une
        // absence » d'après le MESSAGE d'offre, pas d'après la transaction.
        // La finalisation n'était propagée au message que par une écriture
        // client postérieure à la callable (services/chat/meetup.ts) : si elle
        // échouait — perte de réseau, application tuée, règle refusée — la
        // transaction était `meetup_completed` côté serveur mais la bulle
        // continuait d'offrir des boutons dont chaque appel était refusé.
        // On stampe donc le message DANS la même transaction, comme le fait
        // déjà reportMeetupNoShow. `messageId` est accepté en secours pour les
        // transactions pré-créées par le checkout direct, qui ne portent pas
        // d'`offerMessageId`.
        const linkedMessageId =
          typeof data.offerMessageId === 'string' && data.offerMessageId.length > 0
            ? data.offerMessageId
            : typeof messageId === 'string' && messageId.length > 0
              ? messageId
              : null;
        let offerRef: FirebaseFirestore.DocumentReference | null = null;
        let offerSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (linkedMessageId) {
          offerRef = db.collection('messages').doc(linkedMessageId);
          offerSnap = await tx.get(offerRef);
          if (offerSnap.exists) {
            const msg = offerSnap.data()!;
            if (msg.chatId !== data.chatId || msg.type !== 'offer' || !['accepted', 'completed'].includes(msg.offer?.status) || msg.offer.amount !== data.amount || !meetupLocationsEqual(msg.offer.meetup?.location, data.meetupSpot) || (msg.offer.transactionId && msg.offer.transactionId !== transactionId)) {
              throw new HttpsError(
                'failed-precondition',
                'Le message ne correspond pas à cette transaction'
              );
            }
          }
        }

        if (messageId && data.offerMessageId && messageId !== data.offerMessageId) throw new HttpsError('failed-precondition', 'Cette proposition ne correspond pas à cet accord');
        if (data.status === 'meetup_completed') return { ...data, reused: true,
          notificationCommitted: await meetupPhaseReceipt(tx, data, transactionId, 'completed') };

        // Le message système de clôture est écrit DANS la transaction, via une
        // référence pré-allouée. Il était posté après coup, sans garde : son
        // échec laissait une rencontre finalisée côté serveur sans la seule
        // trace que les deux parties voient dans le fil. Les participants sont
        // lus ici, avant toute écriture.
        let sysParticipants: string[] = [];
        if (typeof data.chatId === 'string' && data.chatId.length > 0) {
          const chatSnap = await tx.get(db.collection('chats').doc(data.chatId));
          if (chatSnap.exists) {
            const p = chatSnap.data()?.participants;
            if (Array.isArray(p)) sysParticipants = p as string[];
          }
        }

        const notices = await prepareOperationalNotices(tx, meetupPhaseNotices(data, transactionId, 'completed', callerUid));

        const inventoryArticleId=typeof data.articleId==='string'?data.articleId:null;
        const inventoryArticle=inventoryArticleId?(await tx.get(db.collection('articles').doc(inventoryArticleId))).data():null;
        const inventory=inventoryArticleId&&inventoryArticle?await planInventoryFinish(tx,inventoryArticleId,inventoryArticle,{kind:'purchase',id:transactionId,sourceArticleId:inventoryArticleId},true):null;
        if(inventoryArticle?.inventoryUnit&&!inventory)throw new HttpsError('failed-precondition','Le verrou commun de cet exemplaire doit être rapproché.');
        // Meetup = paiement cash hors-ligne pur. AUCUN argent n'a transité par
        // la plateforme, donc on NE crédite JAMAIS le wallet vendeur
        // (balance / pendingBalance) et on n'écrit AUCUN ledger de vente.
        // Le runTransaction se limite à : passer le statut à meetup_completed,
        // poser meetupCompletedAt, et débloquer l'éligibilité à l'avis (review),
        // qui est dérivée du statut terminal + meetupCompletedAt dans reviews.ts.
        await assertPrivateAccountSession(request, tx);
        inventory?.commit();
        await recoveryCommit({refs: [(txRef).path]});
    tx.update(txRef, await financialRecoverySourceFields('purchase',txRef,data,{
          status: 'meetup_completed',
          completedAt: FieldValue.serverTimestamp(),
          meetupCompletedAt: FieldValue.serverTimestamp(),
          meetupCompletedBy: callerUid,
          meetupCompletionNotice: { protocol: 'meetup_phase_notice_v1', transactionId, phase: 'completed', declaredBy: callerUid },
        }));

        if (offerRef && offerSnap && offerSnap.exists) {
          await recoveryCommit({refs: [(offerRef).path]});
    tx.update(offerRef, {
            'offer.status': 'completed',
            'offer.meetup.completedAt': FieldValue.serverTimestamp(),
          });
        }

        if (typeof data.chatId === 'string' && data.chatId.length > 0) {
          await recoveryCommit({refs: [(db.collection('messages').doc()).path]});
    tx.set(db.collection('messages').doc(), {
            chatId: data.chatId,
            senderId: 'system',
            receiverId: 'system',
            type: 'system',
            content:
              'Un participant a déclaré la rencontre terminée. Seconde ne vérifie pas le paiement en main propre ni la remise physique.',
            participants: sysParticipants,
            timestamp: FieldValue.serverTimestamp(),
            status: 'sent',
            isRead: true,
          });
        }

        notices.commit();
        return {
          reused: false,
          notificationCommitted: true,
          chatId: data.chatId,
          sellerId,
          buyerId: data.buyerId,
          sellerPayout: typeof data.sellerPayout === 'number' ? data.sellerPayout : data.amount,
          createdAt: data.createdAt,
        };
      });

      if (transactionData.reused) return { success: true, reused: true,
        notificationCommitted: transactionData.notificationCommitted, deviceDeliveryVerified: false, readingVerified: false };

      // Analytics (§12): order_completed follows the BUYER. Meetup is cash-in-
      // hand — seller_net_cents reflects the sale value (no platform ledger move).
      if (transactionData.buyerId) {
        let daysToComplete = 0;
        const createdAt = transactionData.createdAt;
        if (createdAt && typeof createdAt.toMillis === 'function') {
          daysToComplete =
            Math.round(((Date.now() - createdAt.toMillis()) / (24 * 60 * 60 * 1000)) * 100) / 100;
        }
        await captureServerEvent(transactionData.buyerId, 'order_completed', {
          transaction_id: transactionId,
          delivery_type: 'meetup',
          seller_net_cents: Math.round((transactionData.sellerPayout ?? 0) * 100),
          days_to_complete: daysToComplete,
          $insert_id: `order_completed_${transactionId}`,
        });
      }

      logger.info('Meetup transaction completed', { transactionId, sellerId: transactionData.sellerId });

      return { success: true, notificationCommitted: transactionData.notificationCommitted,
        deviceDeliveryVerified: false, readingVerified: false };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error completing meetup transaction:', error);
      throw new HttpsError('internal', `Failed to complete meetup: ${message}`);
    }
  }))
);

// =============================================================================
// REPORT MEETUP NO-SHOW — A party signals the other never showed up
// =============================================================================

/** Reason codes accepted for a meetup no-show report. */

/** Reason codes accepted for a meetup no-show report. */

export const MEETUP_NO_SHOW_REASONS = new Set([
  'other_party_no_show',
  'cancelled_last_minute',
  'unsafe_situation',
  'other',
]);

/** A meetup no-show can only be reported while the meetup is still open. */

/** A meetup no-show can only be reported while the meetup is still open. */

export const MEETUP_REPORTABLE_STATUSES = new Set(['meetup_pending', 'meetup_confirmed']);

/**
 * A2 FIX — server-side no-show handling for a meetup.
 *
 * Previously the client (chatService.reportNoShow) only wrote a cosmetic
 * `offer.meetup.noShow` field on a chat message that NOTHING consumed: the
 * article stayed locked (isSold=true), the transaction kept blocking re-listing
 * (meetup_pending / meetup_confirmed are "active" in toggleArticleSold), and
 * neither party had a real recourse.
 *
 * This callable gives the report teeth. A meetup is a PURE cash-in-hand exchange:
 * NO money flows through the platform, so there is nothing to refund here. What a
 * no-show needs is:
 *   1. Unlock the article (isSold=false) so the seller can re-list / re-sell it.
 *   2. Move the transaction to `disputed` (frozen, terminal-for-meetup) so it can
 *      no longer be completed and no longer counts as an "active" transaction
 *      blocking the article.
 *   3. Open a `disputes` doc for human review — this is the recourse for BOTH
 *      sides: the reporter states their case, and the accused party can contest
 *      with the admin (Loi 25 human-review path). The dispute records both
 *      parties + who reported whom.
 *
 * Either the buyer or the seller may file it (a no-show can be on either side).
 * Idempotent: refuses a second report on an already-disputed/cancelled tx.
 */

/**
 * A2 FIX — server-side no-show handling for a meetup.
 *
 * Previously the client (chatService.reportNoShow) only wrote a cosmetic
 * `offer.meetup.noShow` field on a chat message that NOTHING consumed: the
 * article stayed locked (isSold=true), the transaction kept blocking re-listing
 * (meetup_pending / meetup_confirmed are "active" in toggleArticleSold), and
 * neither party had a real recourse.
 *
 * This callable gives the report teeth. A meetup is a PURE cash-in-hand exchange:
 * NO money flows through the platform, so there is nothing to refund here. What a
 * no-show needs is:
 *   1. Unlock the article (isSold=false) so the seller can re-list / re-sell it.
 *   2. Move the transaction to `disputed` (frozen, terminal-for-meetup) so it can
 *      no longer be completed and no longer counts as an "active" transaction
 *      blocking the article.
 *   3. Open a `disputes` doc for human review — this is the recourse for BOTH
 *      sides: the reporter states their case, and the accused party can contest
 *      with the admin (Loi 25 human-review path). The dispute records both
 *      parties + who reported whom.
 *
 * Either the buyer or the seller may file it (a no-show can be on either side).
 * Idempotent: refuses a second report on an already-disputed/cancelled tx.
 */

function meetupNoShowNotices(data: FirebaseFirestore.DocumentData, transactionId: string, disputeId: string,
  counterDeclaration: boolean, declaration: { reportedBy: string; reason: string; details?: string | null }): OperationalNoticeInput[] {
  const declarationHash = createHash('sha256').update(JSON.stringify([declaration.reportedBy, declaration.reason, declaration.details ?? null])).digest('hex');
  return [data.buyerId, data.sellerId].map(userId => ({
    eventKey: `meetup_no_show:${transactionId}:${disputeId}:${counterDeclaration ? 'counter' : 'initial'}`, userId,
    type: 'no_show_reported', title: counterDeclaration ? 'Contre-déclaration enregistrée' : 'Signalement de rencontre manquée',
    message: counterDeclaration
      ? 'Une contre-déclaration est enregistrée sur ce signalement. Les deux versions sont conservées dans le dossier ; consultez la conversation ou contactez le support.'
      : 'Un signalement de rencontre manquée est enregistré. Il reste à examiner et ne constitue pas une preuve de faute. La personne concernée peut donner sa version dans la conversation ou contacter le support.',
    data: { transactionId, disputeId, declaredBy: declaration.reportedBy, declarationHash,
      ...(typeof data.chatId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.chatId) ? { chatId: data.chatId } : {}) },
  }));
}

export const reportMeetupNoShow = onCall(
  { region: 'northamerica-northeast1', memory: '512MiB' },
  async (request) => withFinancialRecoveryScope({operation: "callable/payments/meetup.reportMeetupNoShow"}, async () => withPrivateAccountSession(request, async () => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    const { transactionId, reason, details, expectedUid, expectedDisputeId } = request.data ?? {};
    if (expectedUid !== request.auth.uid) throw new HttpsError('permission-denied', 'La session de cette déclaration a changé.');
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new HttpsError('invalid-argument', 'Transaction ID is required');
    }
    if (expectedDisputeId != null && (typeof expectedDisputeId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(expectedDisputeId))) {
      throw new HttpsError('invalid-argument', 'Référence du dossier examiné invalide.');
    }
    const reportReason = typeof reason === 'string' ? reason : null;
    const trimmedDetails =
      typeof details === 'string' && details.trim().length > 0
        ? details.trim()
        : null;
    const validNewDeclaration = reportReason !== null && MEETUP_NO_SHOW_REASONS.has(reportReason) &&
      trimmedDetails !== null && trimmedDetails.length <= 1000;
    // An old exact receipt with no narrative stays readable. Invalid NEW input
    // does not write even quota metadata; the transaction below only reads an
    // own historical receipt before rejecting any first effect.
    if (validNewDeclaration) {
      const { callerKey, isAuthenticated } = resolveCallerKey(request);
      await checkRateLimit(callerKey, isAuthenticated, {
        functionName: 'reportMeetupNoShow', maxCallsAuthenticated: 5,
        maxCallsUnauthenticated: 0, windowMs: RATE_LIMIT_WINDOW_MS,
      });
    }

    const callerUid = request.auth.uid;
    const txRef = db.collection('transactions').doc(transactionId);

    try {
      const result = await db.runTransaction(async (tx) => {
    const recoveryCommit = financialRecoveryCommitCheckpoint();
        await assertPrivateAccountSession(request, tx);
        const snap = await tx.get(txRef);
        if (!snap.exists) {
          throw new HttpsError('not-found', 'Transaction not found');
        }
        const data = snap.data()!;

        // Caller must be a party to the transaction.
        const isBuyer = data.buyerId === callerUid;
        const isSeller = data.sellerId === callerUid;
        if (!isBuyer && !isSeller) {
          throw new HttpsError('permission-denied', 'Only the buyer or seller can report a no-show');
        }

        // Only meetup transactions still in an open meetup state.
        if (data.deliveryType !== 'meetup') {
          throw new HttpsError(
            'failed-precondition',
            'Le signalement de no-show est réservé aux rencontres en personne.'
          );
        }
        // CONTRE-DÉCLARATION. Un signalement gèle la transaction en `disputed`,
        // ce qui rendait tout second signalement impossible : la personne visée
        // n'avait alors AUCUN moyen, dans l'app, de donner sa version — la
        // notification l'invitait pourtant à réagir, et l'administrateur ne
        // recevait qu'un seul récit. On accepte donc une déclaration de la
        // partie ACCUSÉE, une seule fois, sans toucher au statut, au verrou de
        // l'article ni au dossier déjà ouvert : elle vient s'ajouter au dossier.
        const existingReport = data.noShowReport;
        const alreadyReportedBy =
          existingReport && typeof existingReport === 'object'
            ? existingReport.reportedBy
            : null;
        const isCounterDeclaration =
          data.status === 'disputed' &&
          typeof alreadyReportedBy === 'string' &&
          alreadyReportedBy !== callerUid;

        // Bind both a replay and a new counter-declaration to the exact
        // native original ticket. Never choose the first open complaint.
        let existingClaim: FirebaseFirestore.DocumentSnapshot | null = null;
        if (typeof alreadyReportedBy === 'string') {
          if (typeof existingReport.disputeId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(existingReport.disputeId)) {
            existingClaim = await tx.get(db.collection('disputes').doc(existingReport.disputeId));
          } else {
            const candidates = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
            const matches = candidates.docs.filter(document => document.data().type === 'meetup_no_show' &&
              document.data().reportedBy === alreadyReportedBy && document.data().createdAt instanceof Timestamp &&
              existingReport.reportedAt instanceof Timestamp && document.data().createdAt.isEqual(existingReport.reportedAt));
            if (candidates.size >= 101 || matches.length !== 1) throw new HttpsError('failed-precondition', 'Le signalement initial doit être rapproché.');
            existingClaim = matches[0];
          }
          const claim = existingClaim?.data();
          if (!claim || claim.transactionId !== transactionId || claim.type !== 'meetup_no_show' ||
              claim.buyerId !== data.buyerId || claim.sellerId !== data.sellerId || claim.reportedBy !== alreadyReportedBy ||
              ![data.buyerId, data.sellerId].includes(alreadyReportedBy) || claim.reportedAgainst !== existingReport.reportedAgainst ||
              ![data.buyerId, data.sellerId].includes(claim.reportedAgainst) || claim.reportedAgainst === alreadyReportedBy ||
              claim.reason !== existingReport.reason || (claim.details ?? null) !== (existingReport.details ?? null) ||
              !(claim.createdAt instanceof Timestamp) || !(existingReport.reportedAt instanceof Timestamp) ||
              !claim.createdAt.isEqual(existingReport.reportedAt)) {
            throw new HttpsError('failed-precondition', 'Le dossier exact de cette rencontre doit être vérifié.');
          }
          if (expectedDisputeId != null && expectedDisputeId !== existingClaim!.id) {
            throw new HttpsError('failed-precondition', 'Le dossier examiné a changé. Relisez le signalement avant de transmettre votre récit.',
              { reason: 'meetup_dispute_source_changed', action: 'rereadOriginalClaim' });
          }
          const ownPrior = alreadyReportedBy === callerUid ? existingReport : data.counterReport;
          if (ownPrior?.reportedBy === callerUid) {
            if (ownPrior.reason !== reportReason || (details != null && typeof details !== 'string') ||
                (ownPrior.details ?? null) !== trimmedDetails || !(ownPrior.reportedAt instanceof Timestamp)) {
              throw new HttpsError('failed-precondition', 'Cette déclaration a déjà été enregistrée avec une autre version.');
            }
            const counter = alreadyReportedBy !== callerUid;
            if (counter && (claim.counterReportedBy !== callerUid || claim.counterReason !== ownPrior.reason ||
                (claim.counterDetails ?? null) !== (ownPrior.details ?? null) || !(claim.counterReportedAt instanceof Timestamp) ||
                !claim.counterReportedAt.isEqual(ownPrior.reportedAt))) {
              throw new HttpsError('unavailable', 'Le contre-récit natif doit être retrouvé dans ce dossier.');
            }
            const receipts = await Promise.all(meetupNoShowNotices(data, transactionId, existingClaim!.id, counter, ownPrior)
              .map(notice => readOperationalNoticeReceipt(tx, notice)));
            if (receipts.some(receipt => !receipt || receipt.committedAt !== ownPrior.reportedAt.toDate().toISOString()))
              throw new HttpsError('unavailable', 'La déclaration historique et ses avis doivent être retrouvés.');
            return { counterDeclaration: counter, disputeId: existingClaim!.id, replay: true,
              reservationReleased: cashReservationWasReleased(transactionId, data),
              buyerId: data.buyerId, sellerId: data.sellerId, articleId: data.articleId ?? '',
              articleTitle: data.articleTitle ?? 'la rencontre', reportedAgainst: existingReport.reportedAgainst, chatId: data.chatId ?? null };
          }
        }

        if (reportReason === null || !MEETUP_NO_SHOW_REASONS.has(reportReason) || trimmedDetails === null || trimmedDetails.length > 1000) {
          throw new HttpsError('invalid-argument', 'Un motif reconnu et votre récit de 1 à 1 000 caractères sont requis.');
        }

        if (isCounterDeclaration) {
          // An initial report racing another party's submission is not their
          // consent to attach their narrative as a counter-declaration.
          if (expectedDisputeId == null) throw new HttpsError('failed-precondition',
            'Un signalement a été ouvert pendant votre envoi. Relisez ce dossier avant de transmettre votre version.',
            { reason: 'meetup_dispute_source_changed', action: 'rereadOriginalClaim' });
          if (data.counterReport || !existingClaim?.exists || existingClaim.data()?.status !== 'open') {
            throw new HttpsError('failed-precondition', 'Le dossier n’autorise plus une nouvelle contre-déclaration.');
          }
          const counterTime=process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'?Timestamp.now():undefined;
          const counter = { reportedBy: callerUid, reason: reportReason,
            ...(trimmedDetails !== null ? { details: trimmedDetails } : {}), reportedAt: counterTime??FieldValue.serverTimestamp() };
          const notices = await prepareOperationalNotices(tx, meetupNoShowNotices(data, transactionId, existingClaim.id, true, counter));
          await assertPrivateAccountSession(request, tx);
    tx.update(txRef,counterTime?await financialRecoverySourceFields('purchase',txRef,data,{counterReport:counter}):{counterReport:counter});
    tx.update(existingClaim.ref, { counterReportedBy: callerUid, counterReason: reportReason,
            ...(trimmedDetails !== null ? { counterDetails: trimmedDetails } : {}), counterReportedAt: counter.reportedAt });
          notices.commit(counterTime);
          return { counterDeclaration: true, disputeId: existingClaim.id, replay: false,
            reservationReleased: cashReservationWasReleased(transactionId, data),
            buyerId: data.buyerId, sellerId: data.sellerId, articleId: data.articleId ?? '', articleTitle: data.articleTitle ?? 'la rencontre',
            reportedAgainst: alreadyReportedBy, chatId: data.chatId ?? null };
        }

        if (expectedDisputeId != null) throw new HttpsError('failed-precondition',
          'Le dossier attendu n’est plus qualifié sur cette rencontre. Conservez votre récit et relisez le dossier.',
          { reason: 'meetup_dispute_source_changed', action: 'rereadOriginalClaim' });

        if (!MEETUP_REPORTABLE_STATUSES.has(data.status)) {
          throw new HttpsError(
            'failed-precondition',
            `Impossible de signaler un no-show pour une transaction au statut ${data.status}.`
          );
        }

        // Read the article BEFORE writing (Firestore: all reads first).
        let articleRef: FirebaseFirestore.DocumentReference | null = null;
        let articleSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (typeof data.articleId === 'string' && data.articleId.length > 0) {
          articleRef = db.collection('articles').doc(data.articleId);
          articleSnap = await tx.get(articleRef);
        }

        // La bulle de chat décide d'afficher « Confirmer » / « Finaliser »
        // d'après le message d'offre, pas d'après la transaction. Sans ce
        // marqueur, les deux parties continuent de voir ces boutons après un
        // signalement d'absence, et l'appel échoue côté serveur.
        let offerRef: FirebaseFirestore.DocumentReference | null = null;
        let offerSnap: FirebaseFirestore.DocumentSnapshot | null = null;
        if (typeof data.offerMessageId === 'string' && data.offerMessageId.length > 0) {
          offerRef = db.collection('messages').doc(data.offerMessageId);
          offerSnap = await tx.get(offerRef);
        }

        // A report alone does not prove there is no platform obligation. Only
        // the native accepted cash contract can release its own reservation.
        const priorCases = await tx.get(db.collection('disputes').where('transactionId', '==', transactionId).limit(101));
        const cashQualified = qualifiedCashAgreement(transactionId, data) && priorCases.empty;
        const articleUnlock = cashQualified && articleRef && articleSnap?.exists && articleSnap.data()?.sellerId === data.sellerId
          ? await articleReleaseUpdate(tx, articleRef, articleSnap.data()!, transactionId) : null;

        const reportedAgainst = isBuyer ? data.sellerId : data.buyerId;
        const disputeRef = db.collection('disputes').doc();
        const notices = await prepareOperationalNotices(tx, meetupNoShowNotices(data, transactionId, disputeRef.id, false,
          { reportedBy: callerUid, reason: reportReason, details: trimmedDetails }));

        // Record the complaint without moving money. Unknown historical
        // obligations remain under review; the report never certifies cash.
        await assertPrivateAccountSession(request, tx);
    const reportTime=process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'?Timestamp.now():undefined;
    const reportFields={
          status: 'disputed',
          disputed: true,
          statusBeforeDispute: data.status,
          noShowReport: {
            disputeId: disputeRef.id,
            reportedBy: callerUid,
            reportedAgainst: typeof reportedAgainst === 'string' ? reportedAgainst : null,
            reason: reportReason,
            ...(trimmedDetails !== null ? { details: trimmedDetails } : {}),
            reportedAt: reportTime??FieldValue.serverTimestamp(),
          },
          disputedAt: reportTime??FieldValue.serverTimestamp(),
          ...(articleUnlock ? { cashReservationRelease: {...createCashReservationRelease(transactionId, data, disputeRef.id,
            callerUid, reportReason, trimmedDetails),...(reportTime?{releasedAt:reportTime}:{})} } : { cashReservationReviewRequired: true }),
        };
        if(articleUnlock)await recoveryCommit({refs:[txRef.path]});
        tx.update(txRef,articleUnlock?await financialRecoverySourceFields('purchase',txRef,data,reportFields):reportFields);

        // 2. Unlock the article so the seller can re-list / re-sell it.
        if (articleRef && articleUnlock) {
          commitArticleRelease(tx,articleRef,articleUnlock);
        }

        // 2 bis. Éteindre les actions de la bulle d'offre (voir la lecture
        //        ci-dessus). L'offre garde son statut `accepted` — la rencontre
        //        a bien été convenue — mais le marqueur suffit à masquer les
        //        boutons devenus inopérants.
        if (offerRef && offerSnap && offerSnap.exists) {
    tx.update(offerRef, {
            'offer.meetup.noShow': {
              reportedBy: callerUid,
              reportedAt: FieldValue.serverTimestamp(),
              reason: reportReason,
            },
          });
        }

        // 3. Open a dispute doc for admin (human-review) — the recourse for both
        //    sides. Records who reported whom so the accused can contest.
    tx.set(disputeRef, {
          transactionId,
          type: 'meetup_no_show',
          buyerId: data.buyerId ?? null,
          sellerId: data.sellerId ?? null,
          articleId: data.articleId ?? null,
          articleTitle: data.articleTitle ?? null,
          reportedBy: callerUid,
          reportedAgainst: typeof reportedAgainst === 'string' ? reportedAgainst : null,
          reason: reportReason,
          ...(trimmedDetails !== null ? { details: trimmedDetails } : {}),
          status: 'open',
          statusBeforeDispute: data.status,
          createdAt: reportTime??FieldValue.serverTimestamp(),
          ...(articleUnlock ? { cashAgreementId: data.cashAgreement.agreementId, reservationReleaseId:
            createCashReservationRelease(transactionId, data, disputeRef.id, callerUid, reportReason, trimmedDetails).releaseId } : {}),
        });

        notices.commit(reportTime);
        return {
          replay: false,
          reservationReleased: !!articleUnlock,
          counterDeclaration: false as const,
          disputeId: disputeRef.id,
          buyerId: data.buyerId,
          sellerId: data.sellerId,
          articleId: data.articleId ?? '',
          articleTitle: data.articleTitle ?? 'la rencontre',
          reportedAgainst: typeof reportedAgainst === 'string' ? reportedAgainst : null,
          chatId: data.chatId ?? null,
        };
      });

      if (result.replay) return { success: true, counterDeclaration: result.counterDeclaration, disputeId: result.disputeId,
        replay: true, notificationCommitted: true, deviceDeliveryVerified: false, readingVerified: false };
      if (result.counterDeclaration) {
        logger.warn('ADMIN_REVIEW — meetup no-show CONTESTED', { transactionId, disputeId: result.disputeId, contestedBy: callerUid });
        return { success: true, counterDeclaration: true, disputeId: result.disputeId,
          reservationReleased: result.reservationReleased, reservationReviewRequired: !result.reservationReleased,
          notificationCommitted: true, deviceDeliveryVerified: false, readingVerified: false };
      }

      // Best-effort admin signal (ingested by the on-call dashboard).
      logger.warn('ADMIN_REVIEW — meetup no-show reported', {
        disputeId: result.disputeId,
        transactionId,
        reportedBy: callerUid,
        reason: reportReason,
      });

      // Analytics (§12): dispute_opened(type=no_show) — distinct_id = the
      // signaler. Meetup is cash-in-hand → no funds held on the platform.
      await captureServerEvent(callerUid, 'dispute_opened', {
        transaction_id: transactionId,
        type: 'no_show',
        reason_code: reportReason,
        ...(result.reservationReleased ? { held_cents: 0 } : { cash_qualification: 'review_required' }),
        $insert_id: `dispute_opened_${result.disputeId}`,
      });

      // Both party notices were committed with the exact ticket. Push is
      // resumed independently, and never described as device delivery.
      return { success: true, disputeId: result.disputeId, notificationCommitted: true,
        reservationReleased: result.reservationReleased, reservationReviewRequired: !result.reservationReleased,
        deviceDeliveryVerified: false, readingVerified: false };
    } catch (error: unknown) {
      if (error instanceof FinancialRecoveryBlocked) throw error;
      if (error instanceof HttpsError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error reporting meetup no-show:', error);
      throw new HttpsError('internal', `Failed to report no-show: ${message}`);
    }
  }))
);

// =============================================================================
// ADMIN REFUND TRANSACTION — Resolve disputes / lost / failed deliveries
// =============================================================================

/**
 * Admin-only refund for a card/destination-charge or mixed transaction
 * (the wallet-only path is handled by refundWalletPayment). Used to resolve
 * `delivery_failed`, `lost`, `disputed`, `delivered` (within the dispute
 * window) and any still-paid order where the buyer must be reimbursed.
 *
 * Flow:
 *   1. Stripe refund OUTSIDE the runTransaction, with a deterministic
 *      idempotency key (`rf_admin_<txId>`) so re-invocations never double-refund.
 *      Single-rail model: every charge is a platform charge, so this is a plain
 *      refunds.create — no transfer to reverse, no application fee to claw back.
 *      The seller is debited via the wallet cascade in stage 2.
 *   2. Atomic Firestore reconciliation: re-credit any wallet portion to the
 *      buyer, debit the seller EXACTLY what was credited
 *      (pendingBalance -> heldBalance -> balance, shortfall -> sellerDebt),
 *      release the article, mark the transaction 'refunded'.
 *
 * Return-label cost policy: when the refund is the result of a dispute ruled
 * against the seller (`chargeReturnToSeller: true`), the return label cost
 * (if a return label was created) is also debited from the seller; by default
 * the buyer bears the return cost. The label itself is created via the
 * createReturnLabel ShipEngine method when requested.
 */
