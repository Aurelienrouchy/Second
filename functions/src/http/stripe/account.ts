/**
 * Webhook Stripe — Mise à jour d'un compte Stripe Connect (KYC, exigences).
 *
 * Éclaté depuis functions/src/http/webhooks.ts (2972 lignes). Le dispatcher
 * et la vérification de signature restent dans webhooks.ts.
 */
import * as logger from 'firebase-functions/logger';
import { createHash, randomUUID } from 'node:crypto';
import { db, FieldValue } from '../../config/firebase';
import { buildDeepLink, sendPushNotification } from '../../utils/notifications';
import { deriveStripeAccountState, stripeAccountFirestoreFields } from '../../utils/stripeAccount';
import { captureServerEvent } from '../../lib/analytics';
import { invalidateConnectObservationInTransaction } from '../../utils/connectEligibility';
import { ELIGIBILITY_POLICY_VERSION } from '../../shared/eligibility';

const NOTICE_TYPE = 'stripe_requirements_due';
const NOTICE_TITLE = 'Action requise sur votre compte vendeur';
const NOTICE_BODY = 'Des renseignements sont demandés pour votre compte vendeur. Consultez son statut et les informations à fournir dans l’application.';
const stringSet = (value: unknown): string[] => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string'))].sort() : [];

/** In-app delivery is already durable. Push attempts are leased and retryable;
 * gateway acceptance is never claimed to be device delivery or owner reading. */
async function retryNoticePush(userId: string, notificationId: string, data: Record<string, string>) {
  const ref = db.collection('notifications').doc(notificationId), attemptId = randomUUID();
  const claimed = await db.runTransaction(async tx => {
    const notice = (await tx.get(ref)).data();
    if (!notice) return false; // The owner may explicitly dismiss the notice.
    if (notice.userId !== userId || notice.type !== NOTICE_TYPE) throw new Error('KYC notification owner mismatch');
    if (notice.pushState === 'completed') return false;
    if (notice.pushState === 'attempting' && notice.pushLeaseUntilMs > Date.now()) throw new Error('KYC notification push attempt in progress');
    tx.update(ref, { pushState: 'attempting', pushAttemptId: attemptId, pushLeaseUntilMs: Date.now() + 2 * 60 * 1000,
      pushAttempts: (Number.isSafeInteger(notice.pushAttempts) ? notice.pushAttempts : 0) + 1 });
    return true;
  });
  if (!claimed) return;
  const result = await sendPushNotification(userId, NOTICE_TITLE, NOTICE_BODY, data, NOTICE_TYPE, { existingNotificationId: notificationId });
  await db.runTransaction(async tx => {
    const notice = (await tx.get(ref)).data();
    if (!notice) return;
    if (notice.pushAttemptId !== attemptId) throw new Error('KYC notification push attempt changed');
    tx.update(ref, { pushState: result.success ? 'completed' : 'retryable',
      pushOutcome: result.success ? (result.sentCount > 0 ? 'gateway_accepted' : 'skipped') : 'failed_or_unknown',
      pushAcceptedCount: result.sentCount, pushLeaseUntilMs: FieldValue.delete(), pushAttemptedAt: FieldValue.serverTimestamp() });
  });
  if (!result.success) throw new Error('KYC notification push retry required; in-app notice retained');
}

export async function handleAccountUpdated(account: any, eventId: string): Promise<void> {
  const stripeAccountId = account.id;

  if (!stripeAccountId) {
    logger.warn('Stripe webhook: account.updated missing account id');
    return;
  }
  if (!/^evt_[A-Za-z0-9_]{1,190}$/.test(eventId)) throw new Error('KYC account event id invalid');

  // Find the user with this Stripe account
  const usersQuery = await db
    .collection('users')
    .where('stripeAccountId', '==', stripeAccountId)
    .limit(1)
    .get();

  if (usersQuery.empty) {
    logger.info('Stripe webhook: no user found for Stripe account', { stripeAccountId });
    return;
  }

  const userDoc = usersQuery.docs[0];

  // Derive the canonical account state — works for both Standard and Custom
  // accounts and persists KYC requirements (F59) + bank status alongside the
  // charges/payouts/details booleans (F62/F117). Never undefined.
  const state = deriveStripeAccountState(account);
  const updateData = stripeAccountFirestoreFields(state);

  const nowDue = stringSet(state.requirementsCurrentlyDue), pastDue = stringSet(state.requirementsPastDue);
  const eventHash = createHash('sha256').update(JSON.stringify([userDoc.id, stripeAccountId, eventId])).digest('hex');
  const noticeId = 'stripe_kyc_' + eventHash;
  const noticeRef = db.collection('notifications').doc(noticeId), profileRef = db.collection('eligibility_profiles').doc(userDoc.id);
  // Private event receipt survives owner dismissal and a later account event.
  // Reuse the existing server-only audit collection and its retention policy.
  const receiptRef = db.collection('eligibility_audit').doc('connect_kyc_' + eventHash);
  const eventReceipt = (notificationId: string | null) => ({ action: 'connect_kyc_notification', inputHash: eventHash,
    actorUid: null, ownerId: userDoc.id, policyVersion: ELIGIBILITY_POLICY_VERSION, source: 'stripe_webhook',
    eventId, stripeAccountId, notificationId, createdAt: FieldValue.serverTimestamp() });
  const data = { type: NOTICE_TYPE, stripeAccountId, eventId,
    priority: pastDue.length ? 'past_due' : state.status === 'restricted' ? 'restricted' : 'due' };
  const committed = await db.runTransaction(async tx => {
    const receipt = (await tx.get(receiptRef)).data();
    const notice = (await tx.get(noticeRef)).data(), userData = (await tx.get(userDoc.ref)).data();
    if (!userData || userData.stripeAccountId !== stripeAccountId) throw new Error('KYC account owner changed');
    if (receipt) {
      if (receipt.action !== 'connect_kyc_notification' || receipt.ownerId !== userDoc.id || receipt.inputHash !== eventHash ||
          receipt.eventId !== eventId || receipt.stripeAccountId !== stripeAccountId ||
          (receipt.notificationId !== null && receipt.notificationId !== noticeId)) throw new Error('KYC account event receipt mismatch');
      return { userData, notificationId: receipt.notificationId, applied: false };
    }
    if (notice) {
      if (notice.userId !== userDoc.id || notice.type !== NOTICE_TYPE || notice.data?.eventId !== eventId) throw new Error('KYC notification event mismatch');
      tx.create(receiptRef, eventReceipt(noticeId));
      return { userData, notificationId: noticeId, applied: false };
    }
    const profile = (await tx.get(profileRef)).data(), previousNotice = profile?.stripeKycNotice;
    const previous = previousNotice?.accountId === stripeAccountId ? previousNotice : null;
    if (previous?.lastEventId === eventId) {
      tx.create(receiptRef, eventReceipt(null));
      return { userData, notificationId: null, applied: false };
    }
    const actionRequired = nowDue.length > 0 || pastDue.length > 0 || state.status === 'restricted';
    const notifiedDue = stringSet(previous?.due), notifiedPastDue = stringSet(previous?.pastDue);
    const changed = !previous?.actionRequired || nowDue.some(field => !notifiedDue.includes(field)) ||
      pastDue.some(field => !notifiedPastDue.includes(field)) || state.disabledReason !== previous?.disabledReason ||
      (state.status === 'restricted' && previous?.status !== 'restricted');
    const notify = actionRequired && changed;
    await invalidateConnectObservationInTransaction(tx, userDoc.id, stripeAccountId, updateData);
    if (notify) tx.create(noticeRef, { id: noticeId, userId: userDoc.id, type: NOTICE_TYPE,
      title: NOTICE_TITLE, message: NOTICE_BODY, data: { ...data, deepLink: buildDeepLink(NOTICE_TYPE, data) },
      isRead: false, createdAt: FieldValue.serverTimestamp(), pushState: 'pending', pushAttempts: 0 });
    tx.set(profileRef, { stripeKycNotice: { accountId: stripeAccountId, lastEventId: eventId,
      due: nowDue, pastDue, disabledReason: state.disabledReason, status: state.status, actionRequired } }, { merge: true });
    tx.create(receiptRef, eventReceipt(notify ? noticeId : null));
    return { userData, notificationId: notify ? noticeId : null, applied: true };
  });
  if (committed.notificationId) await retryNoticePush(userDoc.id, committed.notificationId, data);
  const { userData } = committed;
  const prevDue = stringSet(userData.stripeRequirementsCurrentlyDue);

  // Analytics (§12): seller_activated fires ONCE, the first time the account
  // reaches charges+payouts enabled (transition guard against the previously
  // persisted flags). Poses seller_onboarded=true. $insert_id = seller uid so a
  // replay can never double-count. distinct_id = seller.
  const wasActivated =
    userData.stripeChargesEnabled === true && userData.stripePayoutsEnabled === true;
  const nowActivated =
    state.chargesEnabled && state.payoutsEnabled && state.status === 'active';
  if (committed.applied && !wasActivated && nowActivated) {
    let daysSinceSignup = 0;
    const createdAt = userData.createdAt;
    if (createdAt && typeof createdAt.toMillis === 'function') {
      daysSinceSignup = Math.max(
        0,
        Math.round((Date.now() - createdAt.toMillis()) / (24 * 60 * 60 * 1000))
      );
    }
    const kycDocumentRequired = prevDue.some((r) => r.includes('document'));
    await captureServerEvent(userDoc.id, 'seller_activated', {
      seller_id: userDoc.id,
      days_since_signup: daysSinceSignup,
      kyc_document_required: kycDocumentRequired,
      $set: { seller_onboarded: true },
      $insert_id: userDoc.id,
    });
  }

  logger.info('Stripe webhook: seller account update processed', {
    userId: userDoc.id,
    eventId, notificationId: committed.notificationId, stateApplied: committed.applied,
    stripeAccountId,
    status: state.status,
    chargesEnabled: state.chargesEnabled,
    payoutsEnabled: state.payoutsEnabled,
    requirementsCurrentlyDue: nowDue,
    disabledReason: state.disabledReason,
    hasExternalAccount: state.hasExternalAccount,
  });
}
