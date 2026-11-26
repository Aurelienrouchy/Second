import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { firestore, functions } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';

export interface MarketingConsentReceipt {
  protocol: 'marketing_consent_v1';
  ownerId: string;
  mode: 'observed' | 'received';
  ok: boolean;
  consentState: 'granted' | 'withdrawn' | 'unrecorded' | 'unqualified';
  enabled: boolean | null;
  consentRecorded: boolean;
  consentId: string | null;
  consentRevision: number | null;
  policyVersion: string | null;
  recordedAt: string | null;
  decisionCommitted: boolean;
  requestedEnabled: boolean | null;
  requestReceiptMatched: boolean;
}

const unknown = () => new Error('Le consentement marketing doit être relu. Aucun accord n’est déduit des préférences de notification.');
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export type NotificationPreferenceKey = 'email' | 'push' | 'newMessages' | 'newOrders' | 'priceDrops' |
  'articleFavorited' | 'swapZoneReminder' | 'offerReceived' | 'offerResponse';
const preferenceKeys: NotificationPreferenceKey[] = ['email', 'push', 'newMessages', 'newOrders', 'priceDrops',
  'articleFavorited', 'swapZoneReminder', 'offerReceived', 'offerResponse'];
export const isMarketingPreference = (key: NotificationPreferenceKey) =>
  ['priceDrops', 'articleFavorited', 'swapZoneReminder'].includes(key);

function parseReceipt(value: unknown, uid: string, expected?: boolean): MarketingConsentReceipt {
  if (!record(value) || value.protocol !== 'marketing_consent_v1' || value.ownerId !== uid ||
      !['observed', 'received'].includes(String(value.mode)) || typeof value.ok !== 'boolean' ||
      !['granted', 'withdrawn', 'unrecorded', 'unqualified'].includes(String(value.consentState)) ||
      !(value.enabled === null || typeof value.enabled === 'boolean') || typeof value.consentRecorded !== 'boolean' ||
      typeof value.decisionCommitted !== 'boolean' || typeof value.requestReceiptMatched !== 'boolean' ||
      !(value.requestedEnabled === null || typeof value.requestedEnabled === 'boolean')) throw unknown();
  const qualified = value.consentState === 'granted' || value.consentState === 'withdrawn';
  if (qualified ? value.consentRecorded !== true || value.enabled !== (value.consentState === 'granted') ||
      typeof value.consentId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.consentId) ||
      typeof value.consentRevision !== 'number' || !Number.isSafeInteger(value.consentRevision) || value.consentRevision < 1 ||
      typeof value.policyVersion !== 'string' || !value.policyVersion || value.policyVersion.length > 128 ||
      typeof value.recordedAt !== 'string' || !Number.isFinite(Date.parse(value.recordedAt))
    : value.consentRecorded !== false || value.enabled !== null || value.consentId !== null ||
      value.consentRevision !== null || value.policyVersion !== null || value.recordedAt !== null) throw unknown();
  if (expected === undefined ? value.mode !== 'observed' || value.ok !== true || value.decisionCommitted ||
      value.requestedEnabled !== null || value.requestReceiptMatched
    : value.mode !== 'received' || value.ok !== true || value.decisionCommitted !== true || value.requestReceiptMatched !== true ||
      value.requestedEnabled !== expected || value.enabled !== expected || !qualified) throw unknown();
  return value as unknown as MarketingConsentReceipt;
}

export class MarketingConsentService {
  static async observe(uid: string, assertContext: () => void): Promise<MarketingConsentReceipt> {
    const session = captureTradeSession(uid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    const input = { mode: 'observe' as const, expectedUid: uid };
    const { data } = await httpsCallable<typeof input, unknown>(functions, 'setMarketingConsent')(input);
    assertCurrent();
    return parseReceipt(data, uid);
  }

  static async decide(uid: string, enabled: boolean, assertContext: () => void): Promise<MarketingConsentReceipt> {
    const session = captureTradeSession(uid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    const input = { mode: 'request' as const, expectedUid: uid, enabled };
    const { data } = await httpsCallable<typeof input, unknown>(functions, 'setMarketingConsent')(input);
    assertCurrent();
    return parseReceipt(data, uid, enabled);
  }

  /** Category preferences only restrict a current server grant; they cannot create one. */
  static async setNotificationPreference(uid: string, key: NotificationPreferenceKey, enabled: boolean, assertContext: () => void): Promise<void> {
    const session = captureTradeSession(uid);
    const assertCurrent = () => { assertTradeSessionCurrent(session); assertContext(); };
    assertCurrent();
    if (!preferenceKeys.includes(key) || typeof enabled !== 'boolean') throw unknown();
    if (enabled && isMarketingPreference(key)) {
      const receipt = await this.observe(uid, assertCurrent);
      assertCurrent();
      if (receipt.consentState !== 'granted' || receipt.enabled !== true || !receipt.consentRecorded) throw unknown();
    }
    assertCurrent();
    // One targeted preference cannot overwrite a concurrent withdrawal's map.
    // The server's send gate requalifies the consent again before marketing IO.
    await updateDoc(doc(firestore, 'users', uid), { [`preferences.notifications.${key}`]: enabled, updatedAt: serverTimestamp() });
    assertCurrent();
  }
}
