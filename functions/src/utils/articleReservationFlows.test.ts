/** Real refund/cancel/expiry/webhook handlers, strict in-memory Firestore, no external I/O. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, createStripeMock, type MockFirestore, type StripeMock } from './testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, stripe: null as StripeMock | null }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true });
const stripe = createStripeMock();
holder.fs = fs; holder.stripe = stripe;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => holder.stripe!.client }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => null }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../callable/automatedDecisions', () => ({ logAutomatedDecision: async () => {} }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: () => ({ callerKey: 'mock', isAuthenticated: true }) }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {}, debug() {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, handler: unknown) => handler, onRequest: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
import { cancelPendingTransaction, reportMeetupNoShow } from '../callable/payments';
import { refundWalletPayment } from '../callable/wallet';
import { issueTransactionRefund } from './refund';
import { expireOrphanedTransactions } from '../scheduled/transactionExpiration';
import { stripeWebhook } from '../http/webhooks';

beforeEach(() => { fs.reset(); stripe.reset(); vi.stubEnv('PAYMENTS_ENABLED', 'false'); vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'synthetic_test_value'); });
type Callable = (request: unknown) => Promise<unknown>;
const buyerRequest = { auth: { uid: 'buyer', token: {} }, data: { transactionId: 'old' } };
async function event(type: string, object: Record<string, unknown>) {
  stripe.impl.constructEvent = () => ({ id: `event_${type}`, type, data: { object } });
  const res = { code: 200, status(code: number) { this.code = code; return this; }, send() { return this; }, json() { return this; } };
  await (stripeWebhook as unknown as (req: unknown, res: unknown) => Promise<void>)({ method: 'POST', headers: { 'stripe-signature': 'synthetic' }, rawBody: Buffer.from('{}') }, res);
  expect(res.code).toBe(200);
}
const cases = [
  { name: 'cancel', status: 'meetup_pending', run: () => (cancelPendingTransaction as unknown as Callable)(buyerRequest), terminal: 'cancelled' },
  { name: 'noShow', status: 'meetup_confirmed', run: () => (reportMeetupNoShow as unknown as Callable)(buyerRequest), terminal: 'disputed' },
  { name: 'walletRefund', status: 'paid', run: () => (refundWalletPayment as unknown as Callable)({ ...buyerRequest, auth: { uid: 'admin', token: { admin: true } } }), terminal: 'refunded' },
  { name: 'coreRefund', status: 'paid', run: () => issueTransactionRefund('old', fs.getDoc('transactions/old')!, { idempotencyKey: 'mock_refund' }), terminal: 'refunded' },
  { name: 'expirePendingMeetup', status: 'meetup_pending', run: () => (expireOrphanedTransactions as unknown as () => Promise<void>)(), terminal: 'cancelled' },
  { name: 'expireConfirmedMeetup', status: 'meetup_confirmed', run: () => (expireOrphanedTransactions as unknown as () => Promise<void>)(), terminal: 'cancelled' },
  { name: 'expirePayment', status: 'pending_payment', run: () => (expireOrphanedTransactions as unknown as () => Promise<void>)(), terminal: 'cancelled' },
  { name: 'paymentFailed', status: 'pending_payment', run: () => event('payment_intent.payment_failed', { id: 'pi_old', metadata: { transactionId: 'old' } }), terminal: 'cancelled' },
  { name: 'chargeRefunded', status: 'paid', run: () => event('charge.refunded', { id: 'ch_old', payment_intent: 'pi_old', amount: 4500, amount_refunded: 4500, refunds: { data: [{ id: 'rf_old' }] } }), terminal: 'refunded' },
];

describe('old terminal transitions preserve the current accepted article agreement', () => {
  it.each(cases.flatMap(c => ['otherPointer', 'legacyOther', 'ownPointer'].map(owner => ({ ...c, owner }))))
    ('$name with $owner', async ({ name, status, run, terminal, owner }) => {
      fs.setDoc('articles/item', { isSold: true, soldAt: new Date(), ...(owner === 'legacyOther' ? {} : { activeTransactionId: owner === 'ownPointer' ? 'old' : 'new' }) });
      const money = status === 'paid';
      fs.setDoc('transactions/old', { buyerId: 'buyer', sellerId: 'seller', articleId: 'item', status,
        deliveryType: 'meetup', totalAmount: 45, amount: 45, sellerPayout: 45,
        paidVia: money ? 'wallet' : undefined, walletAmountUsed: money ? 4500 : 0,
        sellerCreditedCents: money ? 4500 : 0,
        ...(name === 'chargeRefunded' || name === 'paymentFailed' ? { stripePaymentIntentId: 'pi_old' } : {}),
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) });
      if (owner !== 'ownPointer') fs.setDoc('transactions/new', { articleId: 'item', status: 'meetup_pending', amount: 30, createdAt: new Date() });
      fs.setDoc('wallets/buyer', { balance: 0, status: 'active' });
      fs.setDoc('wallets/seller', { balance: 0, pendingBalance: money ? 4500 : 0, heldBalance: 0, status: 'active' });
      stripe.impl.paymentIntentsRetrieve = async () => ({ id: 'pi_old', status: 'canceled' });
      await run();
      expect(fs.getDoc('transactions/old')!.status).toBe(terminal);
      const article = fs.getDoc('articles/item')!;
      expect(article.isSold).toBe(owner !== 'ownPointer');
      if (owner === 'otherPointer') expect(article.activeTransactionId).toBe('new');
      if (owner === 'ownPointer') expect(article.activeTransactionId).toBeUndefined();
      if (owner !== 'ownPointer') expect(fs.getDoc('transactions/new')).toMatchObject({ status: 'meetup_pending', amount: 30 });
      if (money) expect(fs.getDoc('wallets/buyer')!.balance).toBe(4500);
    });
});
