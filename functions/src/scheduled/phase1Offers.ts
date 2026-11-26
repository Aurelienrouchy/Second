import {onSchedule} from 'firebase-functions/v2/scheduler';
import {Timestamp} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import {db, FieldValue} from '../config/firebase';
import {readFinancialRecoveryControl} from '../config/recoveryControl';
import {FinancialRecoveryBlocked, withFinancialRecoveryScope} from '../utils/financialRecoveryInterlock';
import {financialRecoveryCommitCheckpoint} from '../utils/financialRecoverySources';
import {PHASE1_CONTRACT} from '../utils/phase1LegacyFence';
import {activeLocalAgreementScope} from '../utils/localAgreement';

const TTL_MS = 48 * 60 * 60 * 1000;
const operation = 'scheduled/offerExpiration.expirePhase1LocalOffers';
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);

/** A producer receipt and native origin qualify only this never-accepted
 * proposal's existing deadline. This is not a financial source witness. */
export function phase1OfferCanExpire(messageId: string, message: FirebaseFirestore.DocumentData,
  receipt: FirebaseFirestore.DocumentData | undefined, control: {installationId: string; epoch: string}, now: Timestamp): boolean {
  const offer = message.offer, source = message.phase1Source;
  return id(messageId) && message.phase1Contract === PHASE1_CONTRACT && source?.protocol === 'phase1_message_origin_v1' &&
    source.installationId === control.installationId && source.epoch === control.epoch && message.type === 'offer' &&
    id(message.senderId) && id(message.receiverId) && message.senderId !== message.receiverId && id(message.chatId) &&
    Array.isArray(message.participants) && message.participants.length === 2 &&
    message.participants.includes(message.senderId) && message.participants.includes(message.receiverId) &&
    !!offer && offer.status === 'pending' && !Object.prototype.hasOwnProperty.call(offer, 'acceptedAt') &&
    !Object.prototype.hasOwnProperty.call(offer, 'transactionId') && offer.offerId === messageId && id(offer.articleId) &&
    offer.expiresAt instanceof Timestamp && message.timestamp instanceof Timestamp &&
    message.timestamp.toMillis() > 0 && offer.expiresAt.toMillis() > message.timestamp.toMillis() &&
    offer.expiresAt.toMillis() <= message.timestamp.toMillis() + TTL_MS && offer.expiresAt.toMillis() < now.toMillis() &&
    receipt?.messageId === messageId && receipt.chatId === message.chatId && receipt.articleId === offer.articleId &&
    receipt.senderId === message.senderId && receipt.buyerId === offer.buyerId &&
    [receipt.buyerId, receipt.sellerId].includes(message.senderId) && [receipt.buyerId, receipt.sellerId].includes(message.receiverId) &&
    /^[a-f0-9]{64}$/.test(receipt.inputHash ?? '') && receipt.createdAt instanceof Timestamp && receipt.createdAt.isEqual(message.timestamp);
}

export const expirePhase1LocalOffers = onSchedule({schedule: 'every 1 hours', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120},
  async () => {
    const qualified = await readFinancialRecoveryControl();
    if (qualified.control.mode !== 'normal' || qualified.control.financialEnvironment !== 'unconfigured') return;
    const now = Timestamp.now();
    const page = await db.collection('messages').where('phase1Contract', '==', PHASE1_CONTRACT)
      .where('phase1Source.installationId', '==', qualified.control.installationId).where('phase1Source.epoch', '==', qualified.control.epoch)
      .where('type', '==', 'offer').where('offer.status', '==', 'pending').where('offer.expiresAt', '<', now).limit(300).get();
    let expired = 0;
    for (const candidate of page.docs) {
      const changed = await withFinancialRecoveryScope({operation}, () => db.runTransaction(async tx => {
        const message = (await tx.get(candidate.ref)).data();
        if (!message) return false;
        const receipt = (await tx.get(db.collection('meetup_offer_requests').doc(candidate.id))).data();
        if (!phase1OfferCanExpire(candidate.id, message, receipt, qualified.control, now)) return false;
        await financialRecoveryCommitCheckpoint()({refs: [candidate.ref.path]});
        const admitted = activeLocalAgreementScope()?.control;
        if (!admitted || admitted.installationId !== qualified.control.installationId || admitted.epoch !== qualified.control.epoch) {
          throw new FinancialRecoveryBlocked('phase1_offer_control_changed');
        }
        tx.update(candidate.ref, {'offer.status': 'expired', 'offer.expiredAt': FieldValue.serverTimestamp()});
        return true;
      }));
      if (changed) expired++;
    }
    logger.info('phase1_local_offers_expired', {examined: page.size, expired});
  });
