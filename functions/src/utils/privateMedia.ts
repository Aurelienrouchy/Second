import { HttpsError } from 'firebase-functions/v2/https';
import { db, storage } from '../config/firebase';
import { Timestamp } from 'firebase-admin/firestore';
import { exactCents } from './shippingPurchaseRate';
import { meetupLocationsEqual, meetupThreadId } from './meetupOffers';
import { qualifiedCashAgreement } from './cashMeetupContract';
export function timestampNotAfter(left: Timestamp, right: Timestamp): boolean {
  return left.seconds < right.seconds || (left.seconds === right.seconds && left.nanoseconds <= right.nanoseconds);
}

/** acceptSwap is receiver-only and freezes these two owned-item lists together
 * with acceptedAt. A proposal or a UI marker alone is never an agreement. */
export function nativeSwapAgreement(swap: FirebaseFirestore.DocumentData | undefined, ownerId: string,
  capturedAt: Timestamp, articleId?: string): boolean {
  if (!swap || typeof swap.initiatorId !== 'string' || typeof swap.receiverId !== 'string'
      || swap.initiatorId === swap.receiverId || ![swap.initiatorId, swap.receiverId].includes(ownerId)
      || !(swap.createdAt instanceof Timestamp) || !(swap.acceptedAt instanceof Timestamp)
      || !timestampNotAfter(swap.createdAt, swap.acceptedAt) || !timestampNotAfter(swap.acceptedAt, capturedAt)
      || !['payment_pending', 'accepted', 'photos_pending', 'shipping', 'completed', 'cancelled', 'expired', 'disputed'].includes(swap.status)) return false;
  const ownerItems = swap.initiatorId === ownerId
    ? swap.initiatorItems ?? (swap.initiatorItem ? [swap.initiatorItem] : [])
    : swap.receiverItems ?? (swap.receiverItem ? [swap.receiverItem] : []);
  return Array.isArray(ownerItems) && ownerItems.length > 0
    && (!articleId || ownerItems.some(item => item?.articleId === articleId));
}

/** Read only: a reservation/PI identifier alone is not an executed agreement.
 * The native witnesses are kept after cancellation/refund for actual recourse.
 */
export async function readNativeOrderAgreement(transactionId: string, capturedAt: Timestamp,
  scope: { viewerId: string; sellerId: string; articleId: string }): Promise<FirebaseFirestore.DocumentData | null> {
  return db.runTransaction(async tx => {
    const order = (await tx.get(db.collection('transactions').doc(transactionId))).data();
    if (!order || typeof order.buyerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(order.buyerId)
        || typeof order.sellerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(order.sellerId)
        || typeof order.articleId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(order.articleId)
        || order.sellerId !== scope.sellerId || order.articleId !== scope.articleId
        || ![order.buyerId, order.sellerId].includes(scope.viewerId)
        || order.buyerId === order.sellerId || !(order.createdAt instanceof Timestamp)
        || !timestampNotAfter(order.createdAt, capturedAt) || !order.articleSnapshot
        || typeof order.articleSnapshot !== 'object' || Array.isArray(order.articleSnapshot)) return null;
    if (order.deliveryType === 'meetup') {
      if (typeof order.offerMessageId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(order.offerMessageId)
          || typeof order.chatId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(order.chatId)
          || !['meetup_pending', 'meetup_confirmed', 'meetup_completed', 'cancelled', 'disputed'].includes(order.status)
          || exactCents(order.amount) === null || exactCents(order.amount)! <= 0
          || order.shippingCost !== 0 || order.serviceFee !== 0 || order.totalAmount !== order.amount
          || order.sellerPayout !== order.amount || order.paidAt != null || order.stripePaymentIntentId != null
          || order.walletPayment != null || (order.walletAmountUsed != null && order.walletAmountUsed !== 0)) return null;
      const [messageSnap, chatSnap, threadSnap] = await Promise.all([
        tx.get(db.collection('messages').doc(order.offerMessageId)), tx.get(db.collection('chats').doc(order.chatId)),
        tx.get(db.collection('meetup_offer_threads').doc(meetupThreadId(order.articleId, order.buyerId))),
      ]);
      const message = messageSnap.data(), chat = chatSnap.data(), offer = message?.offer, thread = threadSnap.data();
      const parties = [order.buyerId, order.sellerId];
      if (!message || message.type !== 'offer' || message.chatId !== order.chatId
          || !parties.includes(message.senderId) || !parties.includes(message.receiverId) || message.senderId === message.receiverId
          || !offer?.meetup || !['accepted', 'completed', 'expired'].includes(offer.status)
          || offer.transactionId !== transactionId || !(offer.acceptedAt instanceof Timestamp)
          || !timestampNotAfter(order.createdAt, offer.acceptedAt) || !timestampNotAfter(offer.acceptedAt, capturedAt)
          || offer.amount !== order.amount || !meetupLocationsEqual(offer.meetup.location, order.meetupSpot)
          || (offer.articleId != null && offer.articleId !== order.articleId)
          || (offer.buyerId != null && offer.buyerId !== order.buyerId)
          || chat?.articleId !== order.articleId || !Array.isArray(chat.participants)
          || chat.participants.length !== 2 || !parties.every(uid => chat.participants.includes(uid))) return null;
      const nativeNew = transactionId === `meetup_${order.offerMessageId}` && order.createdAt.isEqual(offer.acceptedAt);
      const nativeLegacyAdoption = thread?.articleId === order.articleId && thread.buyerId === order.buyerId
        && thread.messageId === order.offerMessageId && thread.transactionId === transactionId && thread.status === 'accepted'
        && thread.updatedAt instanceof Timestamp && thread.updatedAt.isEqual(offer.acceptedAt);
      // A protected local marker, even malformed, cannot fall through to the
      // historical ID/timestamp qualification.
      if (!Object.prototype.hasOwnProperty.call(order, 'localAgreementWitness') && (nativeNew || nativeLegacyAdoption)) return order;
      // Previously materialized local sources can have a later offer timestamp
      // than their purchase timestamp. An advanced thread is not evidence for
      // that old agreement. Its complete immutable cash facts and current
      // installation witness must independently establish the original source.
      const agreement = order.cashAgreement;
      if (process.env.FINANCIAL_RECOVERY_ENVIRONMENT === 'unconfigured'
          && transactionId === `meetup_${order.offerMessageId}` && qualifiedCashAgreement(transactionId, order)
          && agreement.acceptedAt.isEqual(order.createdAt)
          && agreement.offeredBy === message.senderId && agreement.acceptedBy === message.receiverId) {
        const [{ readFinancialRecoveryControl }, { localAgreementWitnessMatches }] = await Promise.all([
          import('../config/recoveryControl'), import('./localAgreement'),
        ]);
        const { control } = await readFinancialRecoveryControl();
        if (control.financialEnvironment === 'unconfigured' && control.previousEpoch === null
            && localAgreementWitnessMatches('purchase', `transactions/${transactionId}`, order,
              { installationId: control.installationId, epoch: control.epoch })) return order;
      }
      return null;
    }
    if (order.deliveryType !== 'shipping' || !['paid', 'label_created', 'shipped', 'delivered', 'completed', 'delivery_failed', 'lost',
      'disputed', 'return_requested', 'cancelled', 'refund_in_progress', 'refund_action_required', 'refunded'].includes(order.status)
        || !(order.paidAt instanceof Timestamp) || !timestampNotAfter(order.createdAt, order.paidAt)
        || !timestampNotAfter(order.paidAt, capturedAt) || (order.currency != null && order.currency !== 'CAD')) return null;
    const totalCents = exactCents(order.totalAmount);
    if (!totalCents || totalCents <= 0) return null;
    const ledger = await tx.get(db.collection('wallets').doc(order.buyerId).collection('ledger').where('transactionId', '==', transactionId).limit(101));
    if (ledger.size >= 101) return null;
    const debits = ledger.docs.filter(doc => doc.data().type === 'purchase_debit');
    if (debits.length > 1) return null;
    const debit = debits[0]?.data(), walletCents = debit?.amount ?? 0;
    if (!Number.isSafeInteger(walletCents) || walletCents < 0 || walletCents > totalCents || debit &&
      (debit.transactionId !== transactionId || debit.currency !== 'CAD' || !Number.isSafeInteger(debit.balanceAfter)
       || debit.balanceAfter < 0 || !(debit.createdAt instanceof Timestamp)
       || !timestampNotAfter(debit.createdAt, order.paidAt))) return null;
    const cardCents = order.capturedCardCents ?? 0;
    if (walletCents === totalCents) {
      const proof = order.walletPayment;
      if (order.paidVia !== 'wallet' || order.walletAmountUsed !== totalCents || cardCents !== 0
          || order.stripePaymentIntentId != null || order.stripeChargeId != null
          || proof?.schemaVersion !== 1 || proof.state !== 'committed' || proof.actorUid !== order.buyerId
          || proof.amountCents !== totalCents || proof.currency !== 'CAD' || proof.ledgerId !== debits[0].id
          || proof.quoteId !== order.shippingQuoteId || proof.rateId !== order.shipEngineRateId
          || !(proof.committedAt instanceof Timestamp) || !proof.committedAt.isEqual(order.paidAt)
          || !debit.createdAt.isEqual(order.paidAt)) return null;
      return order;
    }
    if (!Number.isSafeInteger(cardCents) || cardCents <= 0 || cardCents + walletCents !== totalCents
        || !/^pi_[A-Za-z0-9]+$/.test(order.stripePaymentIntentId ?? '') || !/^ch_[A-Za-z0-9]+$/.test(order.stripeChargeId ?? '')
        || order.walletPayment != null || (walletCents > 0 &&
          (!['wallet_and_card', 'mixed'].includes(order.paidVia) || order.walletAmountUsed !== walletCents))
        || (walletCents === 0 && (['wallet', 'wallet_and_card', 'mixed'].includes(order.paidVia)
          || (order.walletAmountUsed != null && order.walletAmountUsed !== 0)))) return null;
    return order;
  });
}

export const PRIVATE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export interface PrivateImageWitness {
  sourceGeneration: string;
  sourceCrc32c: string;
  contentType: string;
  size: number;
  privateGeneration?: string;
}
export function sourceImageWitness(metadata: Record<string, any>): PrivateImageWitness {
  const size = Number(metadata.size);
  if (!metadata.generation || !metadata.crc32c || !metadata.contentType?.startsWith('image/')
      || !Number.isSafeInteger(size) || size <= 0 || size >= PRIVATE_IMAGE_MAX_BYTES) {
    throw new HttpsError('failed-precondition', 'Source média non qualifiée.');
  }
  return { sourceGeneration: String(metadata.generation), sourceCrc32c: metadata.crc32c, contentType: metadata.contentType, size };
}
function assertPrivateImage(metadata: Record<string, any>, witness: PrivateImageWitness, operationId: string, mediaId: string) {
  if (!metadata.generation || (witness.privateGeneration && String(metadata.generation) !== witness.privateGeneration)
      || metadata.crc32c !== witness.sourceCrc32c || Number(metadata.size) !== witness.size
      || metadata.contentType !== witness.contentType || !metadata.contentType?.startsWith('image/')
      || !Number.isSafeInteger(witness.size) || witness.size <= 0 || witness.size >= PRIVATE_IMAGE_MAX_BYTES
      || metadata.cacheControl !== 'private, no-store' || metadata.metadata?.firebaseStorageDownloadTokens
      || metadata.metadata?.privacyOperationId !== operationId || metadata.metadata?.privacyMediaId !== mediaId
      || metadata.metadata?.privacySourceGeneration !== witness.sourceGeneration) {
    throw new HttpsError('failed-precondition', 'Copie privée non qualifiée.');
  }
}
export async function preservePrivateImage(sourcePath: string, privatePath: string, witness: PrivateImageWitness,
  operationId: string, mediaId: string): Promise<string> {
  const bucket = storage.bucket(), destination = bucket.file(privatePath);
  const [exists] = await destination.exists();
  if (!exists) {
    try {
      await bucket.file(sourcePath, { generation: witness.sourceGeneration }).copy(destination, {
        preconditionOpts: { ifGenerationMatch: 0 }, cacheControl: 'private, no-store', contentType: witness.contentType,
        metadata: { firebaseStorageDownloadTokens: null, privacyOperationId: operationId,
          privacySourceGeneration: witness.sourceGeneration, privacyMediaId: mediaId },
      });
    } catch (error: unknown) {
      if (!(typeof error === 'object' && error && 'code' in error && Number(error.code) === 412)) throw error;
    }
  }
  let [metadata] = await destination.getMetadata();
  if (metadata.contentType === undefined) {
    // An extensionless rewrite made before contentType was explicit can lack
    // only that header. Qualify every other original invariant before repair.
    assertPrivateImage({ ...metadata, contentType: witness.contentType }, witness, operationId, mediaId);
    const generation = String(metadata.generation ?? ''), metageneration = String(metadata.metageneration ?? '');
    if (!/^[1-9][0-9]{0,31}$/.test(generation) || !/^[1-9][0-9]{0,31}$/.test(metageneration)
        || metadata.metadata?.firebaseStorageDownloadTokens !== undefined) {
      throw new HttpsError('failed-precondition', 'Copie privée non qualifiée.');
    }
    await destination.setMetadata({ contentType: witness.contentType },
      { ifGenerationMatch: generation, ifMetagenerationMatch: metageneration });
    [metadata] = await destination.getMetadata();
    // Never accept a replacement, nor merely a successful patch response.
    assertPrivateImage(metadata, { ...witness, privateGeneration: generation }, operationId, mediaId);
  }
  assertPrivateImage(metadata, witness, operationId, mediaId);
  return String(metadata.generation);
}
export async function readPrivateImage(privatePath: string, witness: PrivateImageWitness,
  operationId: string, mediaId: string): Promise<Buffer> {
  if (!witness.privateGeneration) throw new HttpsError('failed-precondition', 'Génération privée absente.');
  const file = storage.bucket().file(privatePath, { generation: witness.privateGeneration });
  const [metadata] = await file.getMetadata();
  assertPrivateImage(metadata, witness, operationId, mediaId);
  const [bytes] = await file.download();
  if (bytes.length !== witness.size || bytes.length >= PRIVATE_IMAGE_MAX_BYTES) throw new HttpsError('failed-precondition', 'Copie privée incohérente.');
  return bytes;
}
