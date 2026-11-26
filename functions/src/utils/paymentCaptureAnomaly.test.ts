import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from './testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, enabled: true, lookupFails: false,
  pi: null as any, retrieves: [] as string[], creates: [] as unknown[], event: null as any }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => holder.enabled ? {
  webhooks: { constructEvent: () => holder.event },
  paymentIntents: { retrieve: async (id: string) => { holder.retrieves.push(id); if (holder.lookupFails) throw new Error('Network unavailable'); return { ...holder.pi }; } },
  refunds: { create: async (...args: unknown[]) => { holder.creates.push(args); throw new Error('No refund authorized by an anomaly'); } },
} : null }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => null }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('./notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('./rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: () => ({ callerKey: 'test', isAuthenticated: true }) }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {}, debug() {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_: unknown, fn: unknown) => fn }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, fn: unknown) => fn, onRequest: (_: unknown, fn: unknown) => fn,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
import { handlePaymentIntentSucceeded } from '../http/stripe/payment';
import { stripeWebhook } from '../http/webhooks';
import { retryFailedOperations } from '../scheduled/retryFailedOperations';
import { inspectPaymentCaptureAnomaly } from '../callable/payments/disputes';
import { inspectPaymentCaptureAnomalyProof } from './paymentCaptureAnomaly';
const actual = (extra: any = {}) => ({ id: 'pi_observed', currency: 'cad', amount: 5000, amount_received: 5000,
  metadata: { transactionId: 'sale' }, ...extra });
function seed() {
  fs.setDoc('transactions/sale', { status: 'pending_payment', stripePaymentIntentId: 'pi_valid', buyerId: 'buyer', sellerId: 'seller',
    totalAmount: 50, paidVia: 'card', sellerCreditedCents: 0 });
  fs.setDoc('wallets/seller', { balance: 2500, pendingBalance: 9000, heldBalance: 4500, sellerDebt: 0 });
  fs.setDoc('wallets/buyer', { balance: 300 });
}
async function operation() {
  const docs = (await fs.db.collection('failed_operations').get()).docs;
  expect(docs).toHaveLength(1);
  return { id: docs[0].id, data: docs[0].data() };
}
const inspect = (id: string, auth: any = { uid: 'admin', token: { admin: true } }) => (inspectPaymentCaptureAnomaly as any)({ auth, data: { operationId: id } });
beforeEach(() => {
  fs.reset(); holder.enabled = true; holder.lookupFails = false; holder.pi = actual({ status: 'succeeded' });
  holder.creates.length = 0; holder.retrieves.length = 0; holder.event = null;
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'synthetic_test_secret');
});

describe('durable payment capture anomalies', () => {
  it('stores mismatched signed PI and exact collected amount idempotently without touching the original sale', async () => {
    seed(); const sale = { ...fs.getDoc('transactions/sale')! }; const seller = { ...fs.getDoc('wallets/seller')! };
    const pi = actual({ amount_received: 4300 });
    await handlePaymentIntentSucceeded(pi, { eventId: 'evt_capture' });
    await handlePaymentIntentSucceeded(pi, { eventId: 'evt_capture' });
    const op = await operation();
    expect(op.data).toMatchObject({ type: 'payment_capture_reconciliation', status: 'pending', actionRequired: true, attempts: 0,
      payload: { reasons: ['payment_identity_mismatch'], eventIds: ['evt_capture'], signedEvidence: {
        observedPaymentIntentId: 'pi_observed', originalPaymentIntentId: 'pi_valid', currency: 'cad', collectedAmountCents: 4300,
        requestedAmountCents: 5000, candidateTransactionId: 'sale' } } });
    expect(fs.getDoc('transactions/sale')).toEqual(sale); expect(fs.getDoc('wallets/seller')).toEqual(seller);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300); expect(holder.creates).toHaveLength(0);
  });
  it.each([
    { metadata: {}, reason: 'missing_reference' },
    { metadata: { transactionId: 'sale/other' }, reason: 'invalid_reference' },
    { metadata: { transactionId: 'absent' }, reason: 'transaction_not_found' },
    { id: '', reason: 'invalid_payment_intent' },
    { currency: 'usd', reason: 'invalid_currency' },
    { amount_received: undefined, reason: 'invalid_capture_amount' },
    { amount_received: -100, reason: 'invalid_capture_amount' },
    { amount_received: 0, reason: 'invalid_capture_amount' },
    { amount_received: '5000', reason: 'invalid_capture_amount' },
    { amount_received: Number.MAX_SAFE_INTEGER + 1, reason: 'invalid_capture_amount' },
  ])('keeps an operator case for non-applicable capture $reason', async ({ reason, ...extra }) => {
    seed(); await handlePaymentIntentSucceeded(actual(extra), { eventId: 'evt_invalid' });
    const op = await operation(); expect(op.data.payload.reasons).toContain(reason);
    expect(fs.getDoc('transactions/sale')!.stripePaymentIntentId).toBe('pi_valid');
    expect(fs.writeOps.some(w => w.path.startsWith('wallets/') || w.path.startsWith('transactions/'))).toBe(false);
    expect(holder.creates).toHaveLength(0);
  });
  it('does not substitute planned amount for absent collection; inspection can discover actual partial collection without refunding it', async () => {
    seed(); await handlePaymentIntentSucceeded(actual({ amount_received: undefined }));
    const op = await operation(); expect(op.data.payload.signedEvidence.collectedAmountCents).toBeNull();
    expect(op.data.payload.signedEvidence.requestedAmountCents).toBe(5000);
    holder.pi = actual({ status: 'succeeded', amount_received: 3500 });
    const view = await inspect(op.id);
    expect(view).toMatchObject({ actionRequired: true, status: 'pending', automaticRefundAllowed: false,
      providerLookupState: 'verified', currentProviderProof: { paymentIntentId: 'pi_observed', collectedAmountCents: 3500 } });
    expect(holder.retrieves).toEqual(['pi_observed']); expect(holder.creates).toHaveLength(0);
    expect(fs.getDoc('transactions/sale')!.stripePaymentIntentId).toBe('pi_valid');
  });
  it('requires administrator auth before revealing or refreshing the private financial case', async () => {
    seed(); await handlePaymentIntentSucceeded(actual()); const op = await operation();
    await expect(inspect(op.id, null)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(inspect(op.id, { uid: 'buyer', token: {} })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(holder.retrieves).toHaveLength(0);
  });
  it('a replay retains administrator proof inspection attribution', async () => {
    seed(); await handlePaymentIntentSucceeded(actual()); const op = await operation();
    fs.setDoc('users/admin_from_doc', { isAdmin: true });
    await inspect(op.id, { uid: 'admin_from_doc', token: {} });
    await handlePaymentIntentSucceeded(actual(), { eventId: 'evt_replay' });
    expect(fs.getDoc('failed_operations/' + op.id)).toMatchObject({ lastProofCheckedBy: 'admin_from_doc',
      payload: { providerLookupState: 'verified', eventIds: ['evt_replay'] } });
    expect(holder.creates).toHaveLength(0);
  });
  it.each([{ id: 'pi_wrong' }, { currency: 'usd' }, { amount_received: undefined }, { status: 'requires_payment_method' }])('current invalid provider proof %j never repairs the wrong PI', async extra => {
    seed(); await handlePaymentIntentSucceeded(actual()); const op = await operation();
    holder.pi = actual({ status: 'succeeded', ...extra });
    const view = await inspect(op.id);
    expect(view.providerLookupState).toBe('invalid'); expect(view.actionRequired).toBe(true);
    expect(fs.getDoc('failed_operations/' + op.id)!.status).toBe('pending'); expect(holder.creates).toHaveLength(0);
  });
  it.each(['client_missing', 'lookup_failed'])('keeps $mode pending through repeated queue checks without exhaustion', async mode => {
    seed(); await handlePaymentIntentSucceeded(actual()); const op = await operation();
    holder.enabled = mode !== 'client_missing'; holder.lookupFails = mode === 'lookup_failed';
    for (let i = 0; i < 8; i++) await (retryFailedOperations as any)();
    expect(fs.getDoc('failed_operations/' + op.id)).toMatchObject({ status: 'pending', attempts: 0,
      waitingReason: 'waiting_payment_reconciliation', payload: { providerLookupState: 'unavailable' } });
    expect(fs.writeOps.some(w => w.data.kind === 'dead_letter_exhausted')).toBe(false); expect(holder.creates).toHaveLength(0);
  });
  it('persists mandatory capture action before webhook ACK; failed persistence leaves no event marker and is replayable', async () => {
    seed(); holder.event = { id: 'evt_capture_persistence', type: 'payment_intent.succeeded', data: { object: actual() } };
    const run = fs.db.runTransaction.bind(fs.db);
    const spy = vi.spyOn(fs.db, 'runTransaction').mockImplementation(async fn => run(async tx => {
      const set = tx.set.bind(tx);
      (tx as any).set = (ref: any, ...args: any[]) => { if (ref.path.startsWith('failed_operations/capture_')) throw new Error('Firestore unavailable'); return (set as any)(ref, ...args); };
      return fn(tx);
    }));
    const response = () => ({ code: 200, status(code: number) { this.code = code; return this; }, send() { return this; }, json() { return this; } });
    const req = { method: 'POST', headers: { 'stripe-signature': 'synthetic_signature' }, rawBody: Buffer.from('{}') };
    const failed = response();
    try { await (stripeWebhook as any)(req, failed); } finally { spy.mockRestore(); }
    expect(failed.code).toBe(500); expect(fs.getDoc('stripe_events/evt_capture_persistence')).toBeUndefined();
    expect((await fs.db.collection('failed_operations').get()).docs).toHaveLength(0);
    const retried = response(); await (stripeWebhook as any)(req, retried);
    expect(retried.code).toBe(200); expect(fs.getDoc('stripe_events/evt_capture_persistence')).toBeDefined();
    expect((await operation()).data.payload.eventIds).toEqual(['evt_capture_persistence']);
    expect(holder.creates).toHaveLength(0);
  });
  it('failed inspection persistence propagates instead of fabricating a fresh proof result', async () => {
    seed(); await handlePaymentIntentSucceeded(actual()); const op = await operation();
    const run = fs.db.runTransaction.bind(fs.db);
    const spy = vi.spyOn(fs.db, 'runTransaction').mockImplementation(async fn => run(async tx => {
      (tx as any).update = () => { throw new Error('Firestore unavailable'); }; return fn(tx);
    }));
    try { await expect(inspectPaymentCaptureAnomalyProof(op.id, 'admin')).rejects.toThrow('Firestore unavailable'); }
    finally { spy.mockRestore(); }
    expect(fs.getDoc('failed_operations/' + op.id)!.payload.providerLookupState).toBe('not_checked');
  });
  it('an unavailable sale lookup cannot be acknowledged as processed or rerouted to a blind refund', async () => {
    seed(); holder.event = { id: 'evt_capture_read_unavailable', type: 'payment_intent.succeeded', data: { object: actual() } };
    const spy = vi.spyOn(fs.db, 'runTransaction').mockRejectedValueOnce(new Error('Firestore read unavailable'));
    const failed = { code: 200, status(code: number) { this.code = code; return this; }, send() { return this; }, json() { return this; } };
    try { await (stripeWebhook as any)({ method: 'POST', headers: { 'stripe-signature': 'synthetic_signature' }, rawBody: Buffer.from('{}') }, failed); }
    finally { spy.mockRestore(); }
    expect(failed.code).toBe(500); expect(fs.getDoc('stripe_events/evt_capture_read_unavailable')).toBeUndefined();
    expect(holder.creates).toHaveLength(0);
    await handlePaymentIntentSucceeded(actual(), { eventId: 'evt_capture_read_unavailable' });
    expect((await operation()).data.payload.eventIds).toEqual(['evt_capture_read_unavailable']);
  });
});
