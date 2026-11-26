/** Expo gateway transport for iOS. Tokens and receipts stay server-only. */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';
import { isProductionRuntime } from '../config/runtimeEnvironment';
import { isDevPushRuntime, readDevPushDestinations, isCurrentDevPushDestination,
  removeInvalidDevPushDestination, qualifyStoredDevPushDestination } from './devPush';

const EXPO_API = 'https://exp.host/--/api/v2/push';
const RECEIPT_COLLECTION = 'expoPushReceipts';
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEV_RECEIPT_COLLECTION = 'dev_expo_push_receipts';
const DEV_RECEIPT_RESULTS_COLLECTION = 'dev_expo_push_receipt_results';

interface ExpoNotification {
  title: string; body: string; data: Record<string, string>; badge: number; channelId: string;
}

interface ExpoResult {
  status: 'ok' | 'error';
  id?: string;
  details?: { error?: string };
}

export function isExpoPushToken(token: string): boolean {
  return /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(token);
}

async function postExpo(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${EXPO_API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Expo gateway HTTP ${response.status}`);
  return response.json();
}

async function removeToken(userId: string, token: string): Promise<void> {
  // Don't recreate a user that was deleted after the send.
  const userRef = db.collection('users').doc(userId);
  await db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (user.exists) tx.update(userRef, { expoPushTokens: FieldValue.arrayRemove(token) });
  });
}

/** Returns gateway acceptances, not confirmed device deliveries. */
export async function sendExpoPushNotifications(
  userId: string,
  tokens: string[],
  notification: ExpoNotification,
): Promise<number> {
  const validTokens = [...new Set(tokens.filter(isExpoPushToken))];
  let accepted = 0;
  for (let offset = 0; offset < validTokens.length; offset += 100) {
    const chunk = validTokens.slice(offset, offset + 100);
    try {
      const result = await postExpo('send', chunk.map((to) => ({
        to, ...notification, sound: 'default', priority: 'high',
      }))) as { data?: ExpoResult[] };
      if (!Array.isArray(result.data) || result.data.length !== chunk.length) {
        throw new Error('Invalid Expo ticket response');
      }
      for (const [index, ticket] of result.data.entries()) {
        if (ticket.status === 'ok' && ticket.id) {
          // Store before counting acceptance, so failures remain observable.
          await db.collection(RECEIPT_COLLECTION).doc(ticket.id).set({
            userId, token: chunk[index], createdAt: new Date(),
          });
          accepted++;
        } else if (ticket.details?.error === 'DeviceNotRegistered') {
          await removeToken(userId, chunk[index]);
        } else {
          logger.warn('Expo push ticket rejected', { code: ticket.details?.error ?? 'unknown' });
        }
      }
    } catch {
      // No token pruning on transport failures or unknown results.
      logger.warn('Expo push send failed; tokens retained');
    }
  }
  return accepted;
}

/** Dev transports only explicitly registered native Dev destinations. The
 * owner's UID accompanies every payload so a switched client can discard an
 * earlier, already-submitted notification. Gateway acceptance is not delivery. */
export async function sendDevExpoPushNotifications(userId: string, notification: ExpoNotification):
Promise<{eligibleDestinations: number; accepted: number}> {
  if (!isDevPushRuntime()) return {eligibleDestinations: 0, accepted: 0};
  const destinations = await readDevPushDestinations(userId);
  let eligibleDestinations = 0, accepted = 0;
  for (const destination of destinations) {
    if (!await isCurrentDevPushDestination(destination)) continue;
    eligibleDestinations++;
    try {
      const result = await postExpo('send', [{to: destination.expoPushToken, ...notification,
        data: {...notification.data, ownerId: userId, pushEnvironment: 'seconde_dev'},
        sound: 'default', priority: 'high'}]) as {data?: ExpoResult[]};
      if (!Array.isArray(result.data) || result.data.length !== 1) throw new Error('Invalid Expo ticket response');
      const ticket = result.data[0];
      if (ticket.status === 'ok' && typeof ticket.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(ticket.id)) {
        await db.collection(DEV_RECEIPT_COLLECTION).doc(ticket.id).set({
          protocol: 'seconde_dev_expo_receipt_v1', userId, destination, createdAt: new Date(),
        });
        accepted++;
      } else if (ticket.details?.error === 'DeviceNotRegistered') {
        await removeInvalidDevPushDestination(destination);
      } else logger.warn('Seconde Dev Expo push ticket rejected', {code: ticket.details?.error ?? 'unknown'});
    } catch {
      logger.warn('Seconde Dev Expo push outcome unknown; destination retained');
    }
  }
  return {eligibleDestinations, accepted};
}

async function reconcileDevExpoPushReceipts(now: number): Promise<void> {
  if (!isDevPushRuntime()) return;
  const pending = await db.collection(DEV_RECEIPT_COLLECTION)
    .where('createdAt', '<=', new Date(now - RECEIPT_DELAY_MS)).limit(1000).get();
  if (pending.empty) return;
  const ids = pending.docs.map(doc => doc.id);
  const result = await postExpo('getReceipts', {ids}) as {data?: Record<string, ExpoResult>};
  if (!result.data || typeof result.data !== 'object') throw new Error('Invalid Expo receipts');
  for (const receiptDoc of pending.docs) {
    const data = receiptDoc.data(), destination = qualifyStoredDevPushDestination(data.destination);
    if (data.protocol !== 'seconde_dev_expo_receipt_v1' || !destination || data.userId !== destination.userId) continue;
    const receipt = result.data[receiptDoc.id];
    const age = now - data.createdAt.toMillis();
    if (!receipt && age < RECEIPT_MAX_AGE_MS) continue;
    if (receipt?.details?.error === 'DeviceNotRegistered') await removeInvalidDevPushDestination(destination);
    const status = receipt?.status === 'ok' ? 'accepted_by_device_push_service' : receipt?.status === 'error' ? 'provider_error' : 'receipt_unavailable';
    // Keep a sober terminal result apart from the pending queue. No device
    // display/read is inferred from the APNs/Expo receipt.
    await db.collection(DEV_RECEIPT_RESULTS_COLLECTION).doc(receiptDoc.id).set({
      protocol: 'seconde_dev_expo_receipt_v1', userId: data.userId, installationId: destination.installationId,
      bindingId: destination.bindingId, status, code: receipt?.details?.error ?? null,
      submittedAt: data.createdAt, reconciledAt: new Date(now), deviceDisplayConfirmed: false,
    });
    await receiptDoc.ref.delete();
  }
}

/** Poll ticket receipts after 15min; prune only confirmed DeviceNotRegistered. */
export async function reconcileExpoPushReceipts(now = Date.now()): Promise<void> {
  if (!isProductionRuntime()) {
    if (isDevPushRuntime()) await reconcileDevExpoPushReceipts(now);
    return;
  }
  const pending = await db.collection(RECEIPT_COLLECTION)
    .where('createdAt', '<=', new Date(now - RECEIPT_DELAY_MS))
    .limit(1000).get();
  if (pending.empty) return;
  const ids = pending.docs.map((doc) => doc.id);
  const result = await postExpo('getReceipts', { ids }) as { data?: Record<string, ExpoResult> };
  if (!result.data || typeof result.data !== 'object') throw new Error('Invalid Expo receipts');
  for (const receiptDoc of pending.docs) {
    const data = receiptDoc.data() as { userId: string; token: string; createdAt: { toMillis(): number } };
    const receipt = result.data[receiptDoc.id];
    if (!receipt) {
      if (now - data.createdAt.toMillis() >= RECEIPT_MAX_AGE_MS) {
        logger.warn('Expo receipt unavailable after 24h; token retained');
        await receiptDoc.ref.delete();
      }
      continue;
    }
    if (receipt.details?.error === 'DeviceNotRegistered') {
      await removeToken(data.userId, data.token);
    } else if (receipt.status === 'error') {
      logger.warn('Expo push delivery failed', { code: receipt.details?.error ?? 'unknown' });
    }
    await receiptDoc.ref.delete();
  }
}
