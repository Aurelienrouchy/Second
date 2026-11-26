/**
 * Notification utilities
 * Firebase Functions v7
 *
 * Handles Android FCM + iOS Expo gateway push and in-app notifications.
 * Each notification includes a `deepLink` field for client-side routing.
 */
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { Timestamp, FieldPath } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { db, auth, FieldValue } from '../config/firebase';
import { sendExpoPushNotifications, sendDevExpoPushNotifications } from './expoPush';
import { applicationLink, isDevCommerceTestRuntime, isProductionRuntime } from '../config/runtimeEnvironment';
import {hasAccountErasureFence} from './accountErasureContract';

async function noticeErasureOpen(userId:string,data:Record<string,string>,tx?:FirebaseFirestore.Transaction){
  const ids=[...new Set([userId,data.senderId,data.actorUid].filter(v=>typeof v==='string'&&v.length>0&&v.length<=128&&!v.includes('/')))];
  const profiles=await Promise.all(ids.map(uid=>{const ref=db.collection('eligibility_profiles').doc(uid);return tx?tx.get(ref):ref.get();}));
  return profiles.every(profile=>!hasAccountErasureFence(profile.data()));
}

/** Product discovery/interest messages require explicit marketing permission.
 * Existing order, bank, safety and recourse notices remain operational. */
function isMarketingNotification(type: string): boolean {
  return ['price_drop', 'article_favorited', 'swap_zone_reminder', 'saved_search'].includes(type);
}

export interface MarketingConsentReceipt {
  protocol: 'marketing_consent_v1'; ownerId: string;
  consentState: 'granted' | 'withdrawn' | 'unrecorded' | 'unqualified';
  enabled: boolean | null; consentRecorded: boolean; consentId: string | null;
  consentRevision: number | null; policyVersion: string | null; recordedAt: string | null;
}

/** One native proof contract for both operator-free owner observation and
 * notification authorization. Client preferences are never evidence. */
export async function readMarketingConsentReceipt(
  tx: FirebaseFirestore.Transaction, userId: string,
): Promise<MarketingConsentReceipt> {
  const profile = (await tx.get(db.collection('eligibility_profiles').doc(userId))).data();
  const unknown = (consentState: 'unrecorded' | 'unqualified'): MarketingConsentReceipt => ({
    protocol: 'marketing_consent_v1', ownerId: userId, consentState, enabled: null, consentRecorded: false,
    consentId: null, consentRevision: null, policyVersion: null, recordedAt: null,
  });
  if (!Object.prototype.hasOwnProperty.call(profile ?? {}, 'marketingConsent')) return unknown('unrecorded');
  const state = profile?.marketingConsent;
  if (state?.schemaVersion !== 1 || state.ownerId !== userId || typeof state.granted !== 'boolean' || state.purpose !== 'marketing' ||
      typeof state.policyVersion !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.policyVersion) ||
      !Number.isSafeInteger(state.revision) || state.revision < 1 || !(state.recordedAt instanceof Timestamp) ||
      typeof state.consentId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(state.consentId)) return unknown('unqualified');
  const proof = (await tx.get(db.collection('users').doc(userId).collection('consents').doc(state.consentId))).data();
  const qualified = proof?.schemaVersion === 1 && proof.ownerId === userId && proof.type === 'marketing' && proof.granted === state.granted &&
    proof.purpose === 'marketing' && proof.version === state.policyVersion && proof.revision === state.revision &&
    proof.channel === 'app' && ['signup', 'privacy_settings'].includes(proof.source) && proof.acceptedAt instanceof Timestamp &&
    proof.acceptedAt.isEqual(state.recordedAt);
  if (!qualified) return unknown('unqualified');
  return { protocol: 'marketing_consent_v1', ownerId: userId, consentState: state.granted ? 'granted' : 'withdrawn',
    enabled: state.granted, consentRecorded: true, consentId: state.consentId, consentRevision: state.revision,
    policyVersion: state.policyVersion, recordedAt: state.recordedAt.toDate().toISOString() };
}

/** The client-writable map can opt OUT, never grant permission. */
async function marketingPermission(tx: FirebaseFirestore.Transaction, userId: string, type: string): Promise<boolean> {
  if (!isMarketingNotification(type)) return true;
  const receipt = await readMarketingConsentReceipt(tx, userId);
  if (!receipt.consentRecorded || receipt.consentState !== 'granted' || receipt.enabled !== true) return false;
  const user = (await tx.get(db.collection('users').doc(userId))).data();
  return user?.preferences?.marketingConsent === true && !isNotificationTypeDisabled(user.preferences?.notifications, type);
}

async function currentMarketingPermission(userId: string, type: string): Promise<boolean> {
  return db.runTransaction(tx => marketingPermission(tx, userId, type));
}

// ─── Token classification ─────────────────────────────────────────────────────

/**
 * Detect a raw APNs device token.
 *
 * `Notifications.getDevicePushTokenAsync()` returns the *native* token: on
 * Android that is an FCM registration token (long, contains a ':' separator),
 * but on iOS it is a RAW APNs device token (typically 64 hex chars, no ':').
 * A raw APNs token is NOT a valid FCM registration token — feeding it to
 * `admin.messaging().sendEach()` always fails, and the failure code
 * (`invalid-registration-token`) would otherwise cause us to delete a token
 * that is perfectly valid for APNs. We therefore detect and skip these here
 * instead of sending them or pruning them.
 *
 * iOS now stores Expo gateway tokens in expoPushTokens. This guard preserves
 * legacy APNs values without accidentally routing them through FCM.
 */
function isRawApnsToken(token: string): boolean {
  // FCM registration tokens always contain ':' (e.g. "xxxx:APA91b...").
  // Raw APNs tokens are pure hex (32 bytes = 64 chars, some variants 64-200).
  return !token.includes(':') && /^[0-9a-fA-F]{64,}$/.test(token);
}

/**
 * Split a token list into FCM registration tokens (sendable via FCM) and
 * raw APNs tokens (must NOT be sent through FCM as-is, nor pruned on failure).
 */
export function partitionTokens(tokens: string[]): {
  fcmTokens: string[];
  apnsTokens: string[];
} {
  const fcmTokens: string[] = [];
  const apnsTokens: string[] = [];
  for (const token of tokens) {
    if (isRawApnsToken(token)) {
      apnsTokens.push(token);
    } else {
      fcmTokens.push(token);
    }
  }
  return { fcmTokens, apnsTokens };
}

// ─── Deep link builder ──────────────────────────────────────────────────────

const DEEP_LINK_HOST = 'seconde.ca';
const hasSupportOwnerUpdateMarker = (data: Record<string, string>) =>
  ['supportUpdateProtocol', 'supportCommandId', 'supportAction', 'supportRequestVersion']
    .some(key => Object.prototype.hasOwnProperty.call(data, key));

/**
 * Build a deep link URL from notification type and data.
 * Produces both scheme (seconde://) and universal (https://seconde.ca/) links.
 */
export function buildDeepLink(
  notificationType: string,
  data: Record<string, string>
): string {
  switch (notificationType) {
    case 'support_deadline':
      return `https://${DEEP_LINK_HOST}/admin/support`;
    case 'chat':
    case 'message':
    case 'new_message':
      return data.chatId ? `https://${DEEP_LINK_HOST}/chat/${data.chatId}` : '';

    case 'offer':
    case 'offer_received':
    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_counter':
      return data.chatId ? `https://${DEEP_LINK_HOST}/chat/${data.chatId}` : '';

    case 'article_favorited':
    case 'price_drop':
      return data.articleId
        ? `https://${DEEP_LINK_HOST}/article/${data.articleId}`
        : '';

    case 'article_moderation':
      return data.ownerId && data.articleId
        ? `https://${DEEP_LINK_HOST}/article/moderation/${encodeURIComponent(data.articleId)}`
        : '';

    case 'eligibility_review':
      return data.reviewId
        ? `https://${DEEP_LINK_HOST}/settings/eligibility?reviewId=${encodeURIComponent(data.reviewId)}`
        : '';

    case 'swap_zone_reminder':
      return data.partyId
        ? `https://${DEEP_LINK_HOST}/swap-party/${data.partyId}`
        : '';

    case 'swap_update':
      return data.swapId
        ? `https://${DEEP_LINK_HOST}/swap/${data.swapId}`
        : '';

    case 'meetup_confirmed':
    case 'meetup_completed':
      return data.chatId ? `https://${DEEP_LINK_HOST}/chat/${data.chatId}`
        : data.transactionId ? `https://${DEEP_LINK_HOST}/orders/${data.transactionId}` : '';

    case 'saved_search':
      return data.savedSearchId
        ? `https://${DEEP_LINK_HOST}/search?savedSearchId=${data.savedSearchId}`
        : '';

    case 'order_cancelled':
    case 'no_show_reported':
      // Une rencontre se joue dans la conversation, pas dans « Mes achats ».
      // Le signalement d'absence empruntait ce type et déposait donc la
      // personne visée sur une liste d'achats qui, pour un vendeur accusé, ne
      // contient rien — alors que le texte de la notification l'invite à
      // réagir. Quand l'émetteur fournit un `chatId`, on ouvre le fil.
      if (data.chatId) {
        return `https://${DEEP_LINK_HOST}/chat/${data.chatId}`;
      }
      return data.transactionId
        ? `https://${DEEP_LINK_HOST}/orders/${data.transactionId}`
        : `https://${DEEP_LINK_HOST}/my-orders`;

    case 'order_moderation':
      // The client must GET the current owner dossier before opening it. Older
      // clients and universal-link entry points safely land in the centre.
      if (hasSupportOwnerUpdateMarker(data)) return `https://${DEEP_LINK_HOST}/notifications`;
      return data.transactionId
        ? `https://${DEEP_LINK_HOST}/orders/${data.transactionId}`
        : `https://${DEEP_LINK_HOST}/my-orders`;

    case 'new_sale':
    case 'order_paid':
    case 'dispute_resolved':
    case 'order_shipped':
    case 'order_delivered':
    case 'buyer_receipt_declared':
    case 'order_refunded':
    case 'funds_released':
      return data.transactionId
        ? `https://${DEEP_LINK_HOST}/orders/${data.transactionId}`
        : `https://${DEEP_LINK_HOST}/my-orders`;

    case 'review_received':
      return `https://${DEEP_LINK_HOST}/notifications`;

    case 'privacy_incident':
      return `https://${DEEP_LINK_HOST}/notifications`;

    case 'withdrawal_update':
      return `https://${DEEP_LINK_HOST}/wallet`;

    case 'stripe_requirements_due':
      return `https://${DEEP_LINK_HOST}/settings/stripe-onboarding`;

    case 'shop_approved':
    case 'shop_rejected':
    case 'shop_created':
      return `https://${DEEP_LINK_HOST}/notifications`;

    default:
      return '';
  }
}

// ─── In-app notification ────────────────────────────────────────────────────

/**
 * Create in-app notification in Firestore
 */
export async function createInAppNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data: Record<string, string>
): Promise<string> {
  const deepLink = applicationLink(buildDeepLink(type, data));

  const notificationData = {
    userId,
    type,
    title,
    message,
    data: { ...data, deepLink },
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
  };

  const docRef = db.collection('notifications').doc();
  await db.runTransaction(async tx => {
    if(!await noticeErasureOpen(userId,data,tx))throw new Error('Account erasure prevents a new notice.');
    if(isMarketingNotification(type)&&!await marketingPermission(tx,userId,type))throw new Error('Marketing notification consent unavailable');
    tx.create(docRef,{...notificationData,id:docRef.id});
  });
  return docRef.id;
}

export interface OperationalNoticeInput {
  eventKey: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, string>;
}
/** No member narrative, legal conclusion, deadline or recipient identity in the message. */
export function supportDeadlineNoticeInput(userId: string, supportRequestId: string, alertId: string,
  state: 'unknown'|'due_today'|'overdue'|'pending', sourceCollection: 'support_requests'|'bank_dispute_cases' = 'support_requests'): OperationalNoticeInput {
  return {eventKey: `support_deadline_alert_v1:${supportRequestId}:${alertId}`, userId, type: 'support_deadline',
    title: 'Suivi du support à examiner', message: state === 'unknown'
      ? 'Une échéance non qualifiée nécessite un examen dans la file privée du support.'
      : 'Une échéance du support nécessite un examen dans la file privée.',
    data: {ownerId: userId, noticeSource: 'support_deadline_alert_v1', sourceCollection, supportRequestId, alertId,
      deadlineLane: sourceCollection === 'bank_dispute_cases' ? 'bank' : state === 'unknown' ? 'unknown' : 'dated'}};
}

const noticeDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validNoticeUserId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  !value.includes('/') && value !== '.' && value !== '..' && !/^__.*__$/.test(value);
function operationalNoticeIdentity(input: OperationalNoticeInput) {
  if (!input.eventKey || input.eventKey.length > 1000 || !validNoticeUserId(input.userId) ||
      !input.type || isMarketingNotification(input.type) || !input.title || !input.message ||
      Object.entries(input.data).some(([key, value]) => !key || typeof value !== 'string')) {
    throw new Error('Operational notification identity or content invalid');
  }
  const id = 'operational_' + noticeDigest([input.eventKey, input.userId]);
  const payloadHash = noticeDigest([input.eventKey, input.userId, input.type, input.title, input.message,
    Object.entries(input.data).sort(([a], [b]) => a.localeCompare(b))]);
  return { id, payloadHash, ref: db.collection('operational_notice_receipts').doc(id),
    notificationRef: db.collection('notifications').doc(id) };
}

/** Private native receipt, independent of the owner's read/dismissal state.
 * This proves an in-app commit only; neither device delivery nor human reading. */
export async function readOperationalNoticeReceipt(tx: FirebaseFirestore.Transaction, input: OperationalNoticeInput) {
  const identity = operationalNoticeIdentity(input), receipt = (await tx.get(identity.ref)).data();
  return qualifyOperationalNoticeReceipt(input, identity, receipt);
}
function qualifyOperationalNoticeReceipt(input: OperationalNoticeInput, identity: ReturnType<typeof operationalNoticeIdentity>,
  receipt: FirebaseFirestore.DocumentData | undefined) {
  if (!receipt) return null;
  if (receipt.protocol !== 'operational_notice_v1' || receipt.notificationId !== identity.id ||
      receipt.eventKey !== input.eventKey || receipt.userId !== input.userId || receipt.payloadHash !== identity.payloadHash ||
      receipt.type !== input.type || !(receipt.committedAt instanceof Timestamp) || receipt.inAppCommitted !== true) {
    throw new Error('Operational notification receipt mismatch');
  }
  return { notificationId: identity.id, committedAt: receipt.committedAt.toDate().toISOString(),
    inAppCommitted: true as const, deviceDeliveryVerified: false as const, readingVerified: false as const };
}

/** Bounded native reads for a privacy fan-out, without 1000 parallel RPCs. */
export async function readOperationalNoticeReceipts(tx: FirebaseFirestore.Transaction, inputs: OperationalNoticeInput[]) {
  const identities = inputs.map(operationalNoticeIdentity), receipts = [];
  for (let offset = 0; offset < identities.length; offset += 100) {
    const page = await tx.getAll(...identities.slice(offset, offset + 100).map(identity => identity.ref));
    for (let index = 0; index < page.length; index++) {
      receipts.push(qualifyOperationalNoticeReceipt(inputs[offset + index], identities[offset + index], page[index].data()));
    }
  }
  return receipts;
}

/** All reads happen during preparation. Call commit() only after the caller's
 * remaining business reads; both the effect and its notices then commit once. */
export async function prepareOperationalNotices(tx: FirebaseFirestore.Transaction, inputs: OperationalNoticeInput[]) {
  const identities = inputs.map(operationalNoticeIdentity);
  if (new Set(identities.map(entry => entry.id)).size !== identities.length) throw new Error('Duplicate operational notice recipient');
  const prior = await Promise.all(inputs.map(input => readOperationalNoticeReceipt(tx, input)));
  for(let index=0;index<inputs.length;index++)if(!prior[index]&&!await noticeErasureOpen(inputs[index].userId,inputs[index].data,tx))
    throw new Error('Account erasure prevents a new notice.');
  const existing = identities.length ? await tx.getAll(...identities.map(entry => entry.notificationRef)) : [];
  identities.forEach((_identity, index) => {
    // Never adopt an unrelated or previously unreceipted notification as proof.
    if (!prior[index] && existing[index].exists) throw new Error('Operational notification requires reconciliation');
  });
  return {
    notificationIds: identities.map(entry => entry.id),
    commit: (recordedAt?:Timestamp) => inputs.forEach((input, index) => {
      if (prior[index]) return; // A user-deleted notice is not resurrected.
      const identity = identities[index];
      tx.create(identity.notificationRef, { id: identity.id, userId: input.userId, type: input.type,
        title: input.title, message: input.message, data: { ...input.data, deepLink: applicationLink(buildDeepLink(input.type, input.data)) },
        operationalReceiptId: identity.id, isRead: false, createdAt: recordedAt??FieldValue.serverTimestamp() });
      tx.create(identity.ref, { protocol: 'operational_notice_v1', notificationId: identity.id,
        eventKey: input.eventKey, userId: input.userId, type: input.type, title: input.title, message: input.message,
        data: input.data, payloadHash: identity.payloadHash, inAppCommitted: true,
        committedAt: recordedAt??FieldValue.serverTimestamp(), pushState: 'pending', pushAttempts: 0 });
    }),
  };
}

/** Gateway submission is at-least-once: a process dying after submission may
 * produce another push on recovery. The in-app notice is never duplicated. */
async function dispatchOperationalNotice(id: string) {
  const ref = db.collection('operational_notice_receipts').doc(id), attemptId = randomUUID();
  const claimed = await db.runTransaction(async tx => {
    const receipt = (await tx.get(ref)).data();
    if (!receipt || receipt.pushState === 'completed') return null;
    const input = receipt as unknown as OperationalNoticeInput;
    const qualified = await readOperationalNoticeReceipt(tx, input);
    if (!qualified || qualified.notificationId !== id) throw new Error('Operational push receipt invalid');
    const notice = (await tx.get(db.collection('notifications').doc(id))).data();
    if (!notice) {
      tx.update(ref, { pushState: 'completed', pushOutcome: 'owner_dismissed', pushAttemptedAt: FieldValue.serverTimestamp() });
      return null;
    }
    if (notice.operationalReceiptId !== id || notice.userId !== receipt.userId || notice.type !== receipt.type ||
        notice.title !== receipt.title || notice.message !== receipt.message) throw new Error('Operational notice content changed');
    if (receipt.pushState === 'attempting' && typeof receipt.pushLeaseUntilMs === 'number' && receipt.pushLeaseUntilMs > Date.now()) return null;
    tx.update(ref, { pushState: 'attempting', pushAttemptId: attemptId, pushLeaseUntilMs: Date.now() + 120_000,
      pushAttempts: (Number.isSafeInteger(receipt.pushAttempts) ? receipt.pushAttempts : 0) + 1 });
    return input;
  });
  if (!claimed) return;
  // Privacy details stay in the durable in-app notice; a lock-screen preview
  // need not expose its sensitive or potentially long operator-written text.
  const pushBody = claimed.type === 'privacy_incident'
    ? 'Un avis concernant vos renseignements personnels est disponible dans le centre de notifications de l’application.'
    : claimed.message;
  const result = await sendPushNotification(claimed.userId, claimed.title, pushBody, claimed.data, claimed.type,
    { existingNotificationId: id });
  await db.runTransaction(async tx => {
    const receipt = (await tx.get(ref)).data();
    if (!receipt || receipt.pushAttemptId !== attemptId) return;
    tx.update(ref, { pushState: result.success ? 'completed' : 'retryable',
      pushOutcome: result.success ? (result.sentCount > 0 ? 'gateway_accepted' : 'skipped') : 'failed_or_unknown',
      pushAcceptedCount: result.sentCount, pushLeaseUntilMs: FieldValue.delete(), pushAttemptedAt: FieldValue.serverTimestamp() });
  });
}

/** Interactive notices dispatch as soon as their durable outbox commits. The
 * same transactional lease excludes the scheduled retry worker concurrently. */
export const dispatchOperationalNoticeOnCreate = onDocumentCreated({ document: 'operational_notice_receipts/{receiptId}',
  region: 'northamerica-northeast1', memory: '512MiB', retry: true }, async event => {
  if (!event.data) return;
  await dispatchOperationalNotice(event.params.receiptId);
});

/** Documentary return milestone, independent of contents/refund decisions.
 * Firestore redelivery and repeated tracking reads share one durable outbox
 * identity for each native order/return label/recipient. */
export const notifyReturnDelivered = onDocumentUpdated({document: 'transactions/{transactionId}',
  region: 'northamerica-northeast1', memory: '512MiB', retry: true}, async event => {
  const after = event.data?.after.data(), before = event.data?.before.data(), id = event.params.transactionId;
  if (!after || !/^[A-Za-z0-9_-]{1,200}$/.test(id) || !(after.returnDeliveredAt instanceof Timestamp) || !after.returnDeliveryProof ||
      before?.returnDeliveredAt instanceof Timestamp && before.returnDeliveredAt.isEqual(after.returnDeliveredAt) &&
      before.returnTrackingObservation?.readId === after.returnTrackingObservation?.readId) return;
  // Load qualification only in this handler, avoiding a notification/payment
  // import cycle for every caller that uses the shared outbox utilities.
  const [{committedReturnReceipt}, {trackingIdentity}] = await Promise.all([import('./returnRequest'), import('../config/shipEngine')]);
  await db.runTransaction(async tx => {
    const order = (await tx.get(db.collection('transactions').doc(id))).data();
    if (!order || !committedReturnReceipt(id, order) || !(order.returnDeliveredAt instanceof Timestamp) ||
        order.returnTrackingStatus !== 'DELIVERED' || order.returnTrackingObservation?.statusCode !== 'DE') return;
    const identity = trackingIdentity(id, order, 'return'), proof = order.returnDeliveryProof;
    const nonnegative = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
    if (!identity || proof?.schemaVersion !== 1 || proof.transactionId !== id || proof.leg !== 'return' || proof.statusCode !== 'DE' ||
        proof.labelId !== identity.labelId || proof.sourceHash !== identity.sourceHash || proof.trackingNumber !== identity.trackingNumber ||
        proof.carrierCode !== identity.carrierCode || proof.shipmentId !== identity.shipmentId ||
        !(proof.recordedAt instanceof Timestamp) || !proof.recordedAt.isEqual(order.returnDeliveredAt) ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(proof.readId ?? '') || !nonnegative(proof.readVersion) || proof.readVersion < 1 ||
        !nonnegative(proof.requestedAtMs) || !nonnegative(proof.observedAtMs) || !nonnegative(proof.providerEventAtMs) ||
        proof.requestedAtMs > proof.observedAtMs || proof.providerEventAtMs > proof.observedAtMs ||
        proof.observedAtMs > proof.recordedAt.toMillis() || proof.recordedAt.toMillis() > Date.now()) return;
    const simulated = proof.provider === 'seconde_dev_simulation' && proof.identitySource === 'member_test_action' &&
      isDevCommerceTestRuntime() && order.carrierCode === 'seconde_dev' && order.returnCarrierCode === 'seconde_dev' &&
      order.devShippingSimulation?.protocol === 'seconde_dev_shipping_simulation_v1' && order.devShippingSimulation.realShipment === false;
    if (!simulated && !(proof.provider === 'shipengine' && proof.identitySource === 'saved_label_get_and_label_track' &&
        order.returnCarrierCode !== 'seconde_dev')) return;
    const capture = await tx.get(db.collection('transactions').doc(id).collection('tracking_history').where('info.readId', '==', proof.readId).limit(2));
    const saved = capture.size === 1 ? capture.docs[0].data() : null, info = saved?.info;
    if (!saved || saved.protocol !== 'tracking_history_v1' || saved.buyerId !== order.buyerId || saved.sellerId !== order.sellerId ||
        !(saved.recordedAt instanceof Timestamp) || saved.recordedAt.toMillis() > proof.recordedAt.toMillis() ||
        info?.transactionId !== id || info.leg !== 'return' || info.sourceHash !== identity.sourceHash ||
        info.readId !== proof.readId || info.readVersion !== proof.readVersion || info.providerStatusCode !== 'DE' ||
        info.providerObservedAtMs !== proof.observedAtMs || info.providerEventAtMs !== proof.providerEventAtMs ||
        info.observationSource !== proof.provider || info.financialEffectAuthorized !== false) return;
    const [forward, returned] = await Promise.all([
      tx.get(db.collection('transactions').where('shipEngineLabelId', '==', identity.labelId).limit(2)),
      tx.get(db.collection('transactions').where('returnLabelId', '==', identity.labelId).limit(2)),
    ]);
    if (forward.size !== 0 || returned.size !== 1 || returned.docs[0].id !== id) return;
    const notice = await prepareOperationalNotices(tx, [order.buyerId, order.sellerId].map(userId => ({
      eventKey: `return_delivered_v1:${id}:${identity.labelId}`, userId, type: 'order_delivered', title: 'Retour livré',
      message: 'Le suivi indique que le colis de retour est livré.',
      data: {ownerId: userId, transactionId: id, trackingLeg: 'return', returnRequestId: order.returnRequest.requestId,
        returnLabelId: identity.labelId, contentsReceivedConfirmed: 'false', refundDecisionGranted: 'false'},
    })));
    notice.commit();
  });
});

/** Persistent document-ID rotation prevents one failed recipient starving the
 * rest. pushState IN uses equality index scans; __name__ ASC is the automatic
 * index's final ordering, not a second application sort field.
 * https://firebase.google.com/docs/firestore/query-data/index-overview#default_ordering_and_the__name__field */
export const deliverOperationalNotices = onSchedule({ schedule: 'every 5 minutes', region: 'northamerica-northeast1',
  memory: '512MiB' }, async () => {
  const cursorRef = db.collection('_system').doc('operational_notice_cursor');
  const cursor = (await cursorRef.get()).data()?.afterId;
  let query = db.collection('operational_notice_receipts').where('pushState', 'in', ['pending', 'retryable', 'attempting'])
    .orderBy(FieldPath.documentId()).limit(50);
  // A malformed receipt can have a valid Firestore ID outside our UID regex.
  // Resume AFTER it too, so a poisoned last row cannot reset the rotation.
  if (typeof cursor === 'string' && cursor.length > 0 && !cursor.includes('/')) query = query.startAfter(cursor);
  const page = await query.get();
  for (const entry of page.docs) {
    try { await dispatchOperationalNotice(entry.id); }
    catch (error) { logger.error('Operational push remains resumable; in-app receipt retained',
      { receiptId: entry.id, error: error instanceof Error ? error.message : 'unknown' }); }
  }
  await cursorRef.set({ afterId: page.size === 50 ? page.docs[page.size - 1].id : null, updatedAt: FieldValue.serverTimestamp() });
});

// ─── Notification preferences ─────────────────────────────────────────────────

/**
 * Map a server notification type to the matching key in
 * `users/{uid}.preferences.notifications` (see UserPreferences in types/index.ts).
 *
 * Returns `null` for types that have NO dedicated per-type toggle — those are
 * treated as operational (default allow). This deliberately covers transactional
 * / safety-critical notifications (review_received, privacy_incident, and any
 * unmapped type): a missing toggle must never silently drop a notification the
 * user can't re-enable.
 */
export function getPreferenceKey(notificationType: string): string | null {
  switch (notificationType) {
    case 'chat':
    case 'message':
    case 'new_message':
      return 'newMessages';

    case 'offer':
    case 'offer_received':
      return 'offerReceived';

    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_counter':
      return 'offerResponse';

    case 'new_sale':
    case 'order_paid':
    case 'dispute_resolved':
    case 'order_shipped':
    case 'order_delivered':
    case 'buyer_receipt_declared':
    case 'order_cancelled':
    case 'order_refunded':
    case 'funds_released':
    case 'withdrawal_update':
    case 'delivery_failed':
    case 'label_stale_reminder':
    case 'order_moderation':
      return 'newOrders';

    case 'article_favorited':
      return 'articleFavorited';

    case 'price_drop':
      return 'priceDrops';

    case 'swap_zone_reminder':
      return 'swapZoneReminder';

    // RECOURS ET CYCLE DE RENCONTRE — aucun réglage, toujours délivrés.
    // `no_show_reported` partait auparavant sous le type `order_cancelled`,
    // donc sous la préférence « Nouvelles ventes ». Une personne qui a coupé
    // cette catégorie — un choix banal — n'apprenait jamais qu'elle est accusée
    // de ne pas s'être présentée, ni qu'elle peut donner sa version. Le droit de
    // réponse ouvert par `reportMeetupNoShow` ne peut pas dépendre d'un réglage
    // de confort.
    case 'no_show_reported':
    case 'meetup_confirmed':
    case 'meetup_completed':
    case 'meetup_cancelled':
      return null;

    default:
      // review_received, privacy_incident, shop_*, swap_update, and any unknown
      // type → no dedicated toggle → always delivered.
      return null;
  }
}

/**
 * Whether the user opted OUT of a given notification type.
 *
 * A type is suppressed ONLY when it maps to a known preference key AND that key
 * is explicitly `false`. Absent prefs, absent key, or unmapped types default to
 * ALLOW (privacy-by-default opt-outs are encoded in the client defaults, not by
 * silently swallowing notifications here).
 */
function isNotificationTypeDisabled(
  prefs: Record<string, unknown> | undefined,
  notificationType: string
): boolean {
  if (!prefs) return false;
  const key = getPreferenceKey(notificationType);
  if (!key) return false;
  return prefs[key] === false;
}

// ─── Badge count ──────────────────────────────────────────────────────────────

/**
 * Compute the user's REAL unread badge count for the APNs payload:
 * unread in-app notifications + unread chat messages.
 *
 * - Unread notifications: `notifications` docs where userId == uid && !isRead.
 * - Unread messages: sum of `chats/{id}.unreadCount[uid]` across the user's
 *   chats (server-maintained map; see chatService + firestore-schema.md).
 *
 * `array-contains` on `participants` is a single-field query (auto-indexed, no
 * composite index needed). Best-effort: on any read error we fall back to 1 so
 * the push still surfaces a badge rather than crashing the send.
 */
async function computeBadgeCount(userId: string): Promise<number> {
  try {
    const [notifSnap, chatsSnap] = await Promise.all([
      db
        .collection('notifications')
        .where('userId', '==', userId)
        .where('isRead', '==', false)
        .count()
        .get(),
      db
        .collection('chats')
        .where('participants', 'array-contains', userId)
        .get(),
    ]);

    const unreadNotifications = notifSnap.data().count;

    let unreadMessages = 0;
    chatsSnap.forEach((doc) => {
      const raw = doc.data()?.unreadCount?.[userId];
      if (typeof raw === 'number' && raw > 0) {
        unreadMessages += raw;
      }
    });

    return unreadNotifications + unreadMessages;
  } catch (error) {
    logger.warn('Failed to compute badge count, falling back to 1', {
      userId,
      error: error instanceof Error ? error.message : error,
    });
    return 1;
  }
}

// ─── FCM push notification ──────────────────────────────────────────────────

/**
 * Resolve Android notification channel from notification type
 */
function getAndroidChannel(notificationType: string): string {
  switch (notificationType) {
    case 'chat':
    case 'message':
    case 'new_message':
      return 'messages';

    case 'offer':
    case 'offer_received':
    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_counter':
      return 'offers';

    case 'swap_zone_reminder':
    case 'swap_update':
      return 'swaps';

    case 'new_sale':
    case 'order_paid':
    case 'dispute_resolved':
    case 'order_shipped':
    case 'order_delivered':
    case 'buyer_receipt_declared':
    case 'order_cancelled':
    case 'order_refunded':
    case 'funds_released':
      return 'orders';

    case 'saved_search':
      return 'saved_searches';

    case 'review_received':
      return 'notifications';

    case 'privacy_incident':
      return 'notifications';

    default:
      return 'notifications';
  }
}

/** Push previews never relay a member/operator-authored body. The durable
 * notice and its receipt remain byte-for-byte unchanged. A qualified route is
 * separate from attribution; unknown provenance falls back to the private centre. */
async function privatePushPreview(userId: string, type: string, title: string, body: string,
  data: Record<string, string>, notificationId?: string) {
  const validId = (v: unknown): v is string => typeof v === 'string' && !!v && !v.includes('/') &&
    v !== '.' && v !== '..' && !/^__.*__$/.test(v) && Buffer.byteLength(v, 'utf8') <= 1500;
  const neutral = {title: 'Nouvelle notification', body: 'Une mise à jour est disponible dans votre espace privé.',
    data: {ownerId: userId} as Record<string, string>, deepLink: `https://${DEEP_LINK_HOST}/notifications`};
  if (type === 'support_deadline') {
    if (data.noticeSource !== 'support_deadline_alert_v1' || !['support_requests', 'bank_dispute_cases'].includes(data.sourceCollection) || !validId(data.supportRequestId) ||
        !/^deadline_[a-f0-9]{64}$/.test(data.alertId ?? '') || !notificationId) return neutral;
    const s = await import('./supportRequest');
    const qualified = await db.runTransaction(async tx => {
      const actor = (await tx.get(db.collection('users').doc(userId))).data();
      if (actor?.isAdmin !== true || Object.prototype.hasOwnProperty.call(actor, 'isActive') && actor.isActive !== true ||
          (await auth.getUser(userId)).disabled) return false;
      const ticket = await tx.get(db.collection(data.sourceCollection).doc(data.supportRequestId)),
        item = data.sourceCollection === 'bank_dispute_cases' ? await (await import('./supportBankDeadline')).readSupportBankDeadlineItem(tx, ticket) : s.supportDeadlineItem(ticket);
      const alert = (await tx.get(ticket.ref.collection('deadline_alerts').doc(data.alertId))).data();
      if (!item || s.supportDeadlineAlertId(item) !== data.alertId || alert?.protocol !== 'support_deadline_alert_v1' ||
          alert.alertId !== data.alertId || alert.supportRequestId !== ticket.id || alert.clockState !== item.clock.state) return false;
      const receipt = await readOperationalNoticeReceipt(tx, supportDeadlineNoticeInput(userId, ticket.id, data.alertId,
        item.clock.state as 'unknown'|'due_today'|'overdue'|'pending', data.sourceCollection as 'support_requests'|'bank_dispute_cases'));
      return receipt?.notificationId === notificationId;
    }).catch(() => false);
    return qualified ? {title: 'Suivi du support à examiner', body: 'Une échéance du support nécessite un examen dans la file privée.',
      data: {ownerId: userId, noticeSource: 'support_deadline_alert_v1', deadlineLane: data.deadlineLane},
      deepLink: `https://${DEEP_LINK_HOST}/admin/support`} : neutral;
  }
  if (['chat', 'message', 'new_message'].includes(type)) {
    if (!validId(data.chatId) || !validId(data.senderId) || data.senderId === userId) return neutral;
    const chat = (await db.collection('chats').doc(data.chatId).get()).data(), members = chat?.participants;
    if (!Array.isArray(members) || members.length !== 2 || new Set(members).size !== 2 ||
        !members.includes(userId) || !members.includes(data.senderId)) return neutral;
    // Historical messages need no arbitrary display name or user-provided URL
    // in the push payload. The conversation itself is the native route proof.
    const safe: Record<string, string> = {ownerId: userId, chatId: data.chatId, senderId: data.senderId,
      noticeSource: 'chat_participant_push_v1'};
    return {title: 'Nouveau message', body: 'Un membre vous a envoyé un message.', data: safe,
      deepLink: `https://${DEEP_LINK_HOST}/chat/${encodeURIComponent(data.chatId)}`};
  }
  if (type !== 'order_moderation') return {title, body, data, deepLink: buildDeepLink(type, data)};
  if (hasSupportOwnerUpdateMarker(data)) {
    if (data.supportUpdateProtocol !== 'support_owner_update_v1') return neutral;
    const version = Number(data.supportRequestVersion);
    if (data.ownerId !== userId || !validId(data.supportRequestId) || data.supportRequestId.length > 128 ||
        data.supportRequestId !== data.supportRequestId.trim() || !/^[a-f0-9]{64}$/.test(data.supportCommandId ?? '') ||
        !['request_details', 'respond'].includes(data.supportAction) || !/^[1-9][0-9]*$/.test(data.supportRequestVersion ?? '') ||
        !Number.isSafeInteger(version) || !notificationId || !/^operational_[a-f0-9]{64}$/.test(notificationId)) return neutral;
    // A safe locator needs the exact committed command AND its durable notice
    // receipt, plus the current ordinary dossier's owner. No authored content
    // or agent identity leaves this private read.
    const safe: Record<string, string> = {supportUpdateProtocol: 'support_owner_update_v1', ownerId: userId,
      supportRequestId: data.supportRequestId, supportCommandId: data.supportCommandId,
      supportAction: data.supportAction, supportRequestVersion: data.supportRequestVersion};
    const qualified = await db.runTransaction(async tx => {
      const ref = db.collection('support_requests').doc(data.supportRequestId);
      const ticket = (await tx.get(ref)).data(), command = (await tx.get(ref.collection('commands').doc(data.supportCommandId))).data();
      const notice = (await tx.get(db.collection('notifications').doc(notificationId))).data();
      if (!ticket || ticket.schemaVersion !== 1 || ticket.ownerId !== userId || ticket.kind === 'authority_request_private' ||
          !Number.isSafeInteger(ticket.version) || ticket.version < version || command?.protocol !== 'support_command_v1' ||
          command.ownerId !== userId || command.supportRequestId !== data.supportRequestId || command.actorRole !== 'admin' ||
          command.state !== 'committed' || command.action !== data.supportAction || command.resultVersion !== version ||
          !validNoticeUserId(command.actorId) || typeof command.requestId !== 'string' ||
          !Number.isSafeInteger(command.recordedAtMs) || command.recordedAtMs <= 0 || command.recordedAtMs > Date.now() ||
          data.supportCommandId !== noticeDigest([command.actorId, command.requestId]) ||
          command.ownerSnapshot?.id !== data.supportRequestId || command.ownerSnapshot.ownerId !== userId ||
          command.ownerSnapshot.kind !== ticket.kind || command.ownerSnapshot.version !== version ||
          notice?.userId !== userId || notice.type !== type || notice.operationalReceiptId !== notificationId ||
          Object.entries(safe).some(([key, value]) => notice.data?.[key] !== value)) return false;
      const receipt = await readOperationalNoticeReceipt(tx, {
        eventKey: `support_owner_update_v1:${noticeDigest([data.supportRequestId, command.actorId, command.requestId])}`,
        userId, type, title: 'Mise à jour du support',
        message: 'Une mise à jour de votre dossier de support est disponible dans votre espace privé.', data: safe,
      });
      return receipt?.notificationId === notificationId;
    }).catch(() => false);
    return qualified ? {title: 'Mise à jour du support',
      body: 'Une mise à jour de votre dossier de support est disponible dans votre espace privé.', data: safe,
      deepLink: `https://${DEEP_LINK_HOST}/notifications`} : neutral;
  }
  if (!validId(data.transactionId)) return neutral;
  const order = (await db.collection('transactions').doc(data.transactionId).get()).data();
  if (!order || ![order.buyerId, order.sellerId].includes(userId)) return neutral;
  // New explicit provenance, or the exact deterministic native old notice.
  // Never attribute a free-text instruction from type/title/date alone.
  const articleId = data.noticeSource === 'order_moderation_instruction_v1' ? data.articleId : order.articleId;
  const legacyDecision = data.noticeSource !== 'order_moderation_instruction_v1' && validId(articleId)
    ? (await db.collection('article_moderation').doc(articleId).get()).data() : null;
  const decisionId = data.noticeSource === 'order_moderation_instruction_v1' ? data.decisionId
    : order.moderationInstruction?.decisionId ?? legacyDecision?.orderRestrictionDecisionId ?? legacyDecision?.decisionId;
  const key = data.noticeSource === 'order_moderation_instruction_v1' ? data.instructionId : order.moderationInstruction?.id ?? 'initial_pause';
  if (validId(articleId) && validId(decisionId) && validId(key) && articleId === order.articleId && notificationId) {
    const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    const receipt = (await db.collection('article_moderation').doc(articleId).collection('decisions').doc(decisionId)
      .collection('orders').doc(data.transactionId).collection('notices').doc(digest(key)).get()).data();
    if (receipt?.transactionId === data.transactionId && receipt.articleId === articleId && receipt.decisionId === decisionId &&
        (receipt.instructionId ?? 'initial_pause') === key && [receipt.buyerId, receipt.sellerId].includes(userId) &&
        receipt.buyerId === order.buyerId && receipt.sellerId === order.sellerId && receipt.createdAt instanceof Timestamp &&
        notificationId === digest(['order_moderation', decisionId, data.transactionId, key, userId])) {
      const safe: Record<string, string> = {ownerId: userId, transactionId: data.transactionId,
        articleId, decisionId, instructionId: key, noticeSource: 'order_moderation_instruction_v1'};
      return {title: 'Instruction concernant votre commande',
        body: 'Une instruction concernant votre commande est disponible dans son dossier privé.', data: safe,
        deepLink: `https://${DEEP_LINK_HOST}/orders/${encodeURIComponent(data.transactionId)}`};
    }
  }
  // Other order notices keep their private record, without claiming that an
  // unqualified historical body is a current instruction or marketing consent.
  return {...neutral, data: {ownerId: userId, transactionId: data.transactionId},
    deepLink: `https://${DEEP_LINK_HOST}/orders/${encodeURIComponent(data.transactionId)}`};
}

/**
 * Send FCM push notification and create in-app notification
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  data: Record<string, string>,
  notificationType: string,
  options: { existingNotificationId?: string } = {},
): Promise<{ success: boolean; sentCount: number }> {
  try {
    if(!await noticeErasureOpen(userId,data))return {success:true,sentCount:0};
    // Get user's FCM tokens
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists) {
      if (isMarketingNotification(notificationType)) return { success: true, sentCount: 0 };
      if (options.existingNotificationId) {
        const existing = (await db.collection('notifications').doc(options.existingNotificationId).get()).data();
        if (!existing || existing.userId !== userId || existing.type !== notificationType) return { success: false, sentCount: 0 };
      } else await createInAppNotification(userId, notificationType, title, body, data);
      logger.info('Operational in-app notice retained without a current push destination', { userId, notificationType });
      return { success: true, sentCount: 0 };
    }

    const userData = userDoc.data()!;
    if (notificationType === 'support_deadline' && (userData.isAdmin !== true ||
        Object.prototype.hasOwnProperty.call(userData, 'isActive') && userData.isActive !== true || (await auth.getUser(userId)).disabled)) {
      return {success: true, sentCount: 0}; // Historical sober notice remains; no new admin push after role loss.
    }
    if (isMarketingNotification(notificationType) && !await currentMarketingPermission(userId, notificationType)) {
      logger.info('Marketing notification skipped without current explicit consent', { userId, notificationType });
      return { success: true, sentCount: 0 };
    }
    const production = isProductionRuntime();
    const storedTokens: string[] = production ? userData.fcmTokens || [] : [];
    const expoTokens: string[] = production ? userData.expoPushTokens || [] : [];

    // Check notification preferences (preferences.notifications.*)
    const prefs = userData.preferences?.notifications as
      | Record<string, unknown>
      | undefined;
    const retainInAppNotification = async () => {
      if (!options.existingNotificationId) return createInAppNotification(userId, notificationType, title, body, data);
      const existing = await db.collection('notifications').doc(options.existingNotificationId).get();
      if (!existing.exists || existing.data()?.userId !== userId || existing.data()?.type !== notificationType) {
        throw new Error('Durable notification unavailable or owner changed');
      }
      return existing.id;
    };

    // Operational history remains in-app. A convenience category toggle only
    // suppresses its optional push transport; marketing is gated above.
    if (isNotificationTypeDisabled(prefs, notificationType)) {
      if (!isMarketingNotification(notificationType)) await retainInAppNotification();
      logger.info('Notification push disabled by user preference', {
        userId,
        notificationType,
      });
      return { success: true, sentCount: 0 };
    }

    // Global push toggle: still create the in-app notification (bell badge /
    // unread count) but skip the FCM push.
    if (prefs?.push === false) {
      console.log(`User ${userId} has push notifications disabled`);
      // Still create in-app notification
      await retainInAppNotification();
      return { success: true, sentCount: 0 };
    }

    // Create in-app notification regardless of push
    await retainInAppNotification();

    // Dev accepts only its newly registered private destinations. Legacy user
    // tokens are neither adopted nor sent; client app identity is a declaration,
    // and the helper requalifies the exact current account/installation binding.
    if (!production) {
      const preview = await privatePushPreview(userId, notificationType, title, body, data, options.existingNotificationId);
      const badge = await computeBadgeCount(userId);
      const result = await sendDevExpoPushNotifications(userId, { title: preview.title, body: preview.body,
        data: { ...preview.data, type: notificationType, deepLink: preview.deepLink }, badge, channelId: getAndroidChannel(notificationType) });
      return { success: result.eligibleDestinations === 0 || result.accepted > 0, sentCount: result.accepted };
    }

    if (storedTokens.length === 0 && expoTokens.length === 0) {
      console.log(`No FCM tokens for user ${userId}`);
      return { success: true, sentCount: 0 };
    }

    // Only FCM registration tokens can be sent through FCM. Raw APNs device
    // tokens (iOS, current client) must be skipped — sending them fails and
    // would otherwise trigger deletion of valid tokens.
    const { fcmTokens, apnsTokens } = partitionTokens(storedTokens);
    if (apnsTokens.length > 0) {
      logger.warn('Skipping raw APNs tokens not sendable via FCM', {
        userId,
        notificationType,
        skippedCount: apnsTokens.length,
      });
    }

    if (fcmTokens.length === 0 && expoTokens.length === 0) {
      console.log(`No FCM-routable tokens for user ${userId}`);
      return { success: true, sentCount: 0 };
    }

    // Build deep link for this notification
    const preview = await privatePushPreview(userId, notificationType, title, body, data, options.existingNotificationId);
    const deepLink = preview.deepLink;
    const channelId = getAndroidChannel(notificationType);

    // Real APNs badge = unread notifications (incl. the one just created above)
    // + unread chat messages. Computed after createInAppNotification so the
    // freshly-created notification is reflected in the count.
    const badge = await computeBadgeCount(userId);

    // Recheck immediately before each external transport. An already submitted
    // push cannot be recalled; each later submission needs a fresh decision.
    if(!await noticeErasureOpen(userId,data))return {success:true,sentCount:0};
    if (isMarketingNotification(notificationType) && !await currentMarketingPermission(userId, notificationType)) {
      return { success: true, sentCount: 0 };
    }
    const expoPayload = { title: preview.title, body: preview.body,
      data: { ...preview.data, type: notificationType, deepLink }, badge, channelId };
    let expoAccepted = 0;
    if (isMarketingNotification(notificationType)) {
      // The gateway helper batches at 100 tokens. Authorize each batch here so
      // its internal loop cannot drain old promotional work after withdrawal.
      const uniqueTokens = [...new Set(expoTokens)];
      for (let offset = 0; offset < uniqueTokens.length; offset += 100) {
        if (!await noticeErasureOpen(userId,data)||!await currentMarketingPermission(userId, notificationType)) break;
        expoAccepted += await sendExpoPushNotifications(userId, uniqueTokens.slice(offset, offset + 100), expoPayload);
      }
    } else {
      const uniqueTokens=[...new Set(expoTokens)];
      for(let offset=0;offset<uniqueTokens.length;offset+=100){
        if(!await noticeErasureOpen(userId,data))break;
        expoAccepted+=await sendExpoPushNotifications(userId,uniqueTokens.slice(offset,offset+100),expoPayload);
      }
    }
    if (fcmTokens.length === 0) return { success: !options.existingNotificationId || expoAccepted > 0, sentCount: expoAccepted };

    // Build FCM messages
    const messages = fcmTokens.map((token: string) => ({
      token,
      notification: { title: preview.title, body: preview.body },
      data: { ...preview.data, type: notificationType, deepLink },
      android: {
        priority: 'high' as const,
        notification: {
          sound: 'default',
          channelId,
          priority: 'high' as const,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge,
          },
        },
      },
    }));

    // Send notifications
    if(!await noticeErasureOpen(userId,data))return {success:true,sentCount:expoAccepted};
    if (isMarketingNotification(notificationType) && !await currentMarketingPermission(userId, notificationType)) {
      return { success: true, sentCount: expoAccepted };
    }
    let results;
    try {
      results = await admin.messaging().sendEach(messages);
    } catch {
      // The in-app notice already exists and Expo may have accepted its copy.
      // Do not make callers repeat the notice after an Android transport error.
      logger.warn('FCM send failed; in-app notification retained');
      return { success: !options.existingNotificationId || expoAccepted > 0, sentCount: expoAccepted };
    }

    let successCount = 0;
    const staleTokens: string[] = [];
    results.responses.forEach((response, index) => {
      if (response.success) {
        successCount++;
      } else {
        console.error(`Failed to send to token ${index}:`, response.error);
        if (
          response.error?.code === 'messaging/invalid-registration-token' ||
          response.error?.code === 'messaging/registration-token-not-registered'
        ) {
          staleTokens.push(fcmTokens[index]);
        }
      }
    });

    // La purge est ATTENDUE, et en UNE écriture. Elle était lancée sans `await`,
    // une par jeton : une Cloud Function peut être gelée dès son retour, si bien
    // que la suppression n'aboutissait pas. Les jetons morts s'accumulaient donc
    // sur le document utilisateur et chaque envoi ultérieur recommençait à
    // échouer dessus — indéfiniment.
    if (staleTokens.length > 0) {
      await db
        .collection('users')
        .doc(userId)
        .update({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(...staleTokens),
        })
        .catch((err) => console.error('Error removing invalid tokens:', err));
    }

    return { success: !options.existingNotificationId || successCount + expoAccepted > 0, sentCount: successCount + expoAccepted };
  } catch (error) {
    console.error('Error sending push notification:', error);
    return { success: false, sentCount: 0 };
  }
}

// ─── Swap notification ──────────────────────────────────────────────────────

/**
 * Send swap notification helper
 */
export async function sendSwapNotification(
  userId: string,
  swapId: string,
  title: string,
  body: string,
  swapData: Record<string, unknown>
): Promise<void> {
  await sendPushNotification(userId, title, body, {
    swapId, status: String(swapData.status || ''),
  }, 'swap_update');
}
