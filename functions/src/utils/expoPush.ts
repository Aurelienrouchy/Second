/** Expo gateway transport for iOS. Tokens and receipts stay server-only. */
import * as logger from 'firebase-functions/logger';
import { db, FieldValue } from '../config/firebase';

const EXPO_API = 'https://exp.host/--/api/v2/push';
const RECEIPT_COLLECTION = 'expoPushReceipts';
const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
  notification: {
    title: string;
    body: string;
    data: Record<string, string>;
    badge: number;
    channelId: string;
  },
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

/** Poll ticket receipts after 15min; prune only confirmed DeviceNotRegistered. */
export async function reconcileExpoPushReceipts(now = Date.now()): Promise<void> {
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
