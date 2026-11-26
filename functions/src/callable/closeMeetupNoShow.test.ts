import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, stripeCalls: 0 }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => { holder.stripeCalls++; throw new Error('Cash case must not call Stripe'); } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: () => ({ callerKey: 'admin', isAuthenticated: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {} }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, fn: unknown) => fn,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
import { closeMeetupNoShow } from './payments/disputes';
const call = (auth: any = { uid: 'admin', token: { admin: true } }) => (closeMeetupNoShow as any)({ auth, data: { transactionId: 'meetup', note: 'Décision humaine' } });
beforeEach(() => { fs.reset(); holder.stripeCalls = 0; });
function seed(extra: Record<string, any> = {}) {
  fs.setDoc('transactions/meetup', { deliveryType: 'meetup', status: 'disputed', disputed: true, buyerId: 'buyer', sellerId: 'seller',
    statusBeforeDispute: 'meetup_confirmed', noShowReport: { reportedBy: 'buyer', reportedAgainst: 'seller' }, articleId: 'item',
    offerMessageId: 'offer', ...extra });
  fs.setDoc('disputes/claim', { transactionId: 'meetup', type: 'meetup_no_show', status: 'open', buyerId: 'buyer', sellerId: 'seller' });
  fs.setDoc('articles/item', { isSold: true, activeTransactionId: 'meetup' });
  fs.setDoc('messages/offer', { offer: { status: 'accepted', meetup: { noShow: { reportedBy: 'buyer' } } } });
  fs.setDoc('wallets/seller', { balance: 1000, pendingBalance: 9000, heldBalance: 4500, sellerDebt: 0 });
  fs.setDoc('wallets/buyer', { balance: 100 });
}
describe('closeMeetupNoShow — distinct nonfinancial buyer decision', () => {
  it('requires auth and administrator authorization before reading the case', async () => {
    await expect(call(null)).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(call({ uid: 'buyer', token: {} })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(0);
  });
  it('atomically cancels the cash agreement and closes claims, with no wallet/debt/Stripe movement', async () => {
    seed(); const result = await call();
    expect(result).toMatchObject({ success: true, moneyMoved: false, status: 'cancelled' });
    expect(fs.getDoc('transactions/meetup')).toMatchObject({ status: 'cancelled', disputed: false,
      meetupNoShowResolution: { outcome: 'buyer_upheld', resolvedBy: 'admin', note: 'Décision humaine' } });
    expect(fs.getDoc('disputes/claim')).toMatchObject({ status: 'resolved', resolution: 'buyer_upheld', resolvedBy: 'admin' });
    expect(fs.getDoc('articles/item')!.isSold).toBe(false);
    expect(fs.getDoc('messages/offer')!.offer.status).toBe('expired');
    expect(fs.writeOps.filter(op => op.path.startsWith('wallets/'))).toHaveLength(0); expect(holder.stripeCalls).toBe(0);
  });
  it.each(['other_pointer', 'legacy_other'])('keeps an article already reserved by %s', async owner => {
    seed();
    fs.setDoc('articles/item', { isSold: true, ...(owner === 'other_pointer' ? { activeTransactionId: 'other' } : {}) });
    fs.setDoc('transactions/other', { articleId: 'item', status: 'meetup_confirmed' });
    await call(); expect(fs.getDoc('articles/item')!.isSold).toBe(true); expect(holder.stripeCalls).toBe(0);
  });
  it('replay preserves the first operator decision and performs no second mutation', async () => {
    seed(); await call(); const writes = fs.writeOps.length;
    const result = await call({ uid: 'another_admin', token: { admin: true } });
    expect(result.alreadyClosed).toBe(true); expect(fs.writeOps).toHaveLength(writes);
    expect(fs.getDoc('transactions/meetup')!.meetupNoShowResolution.resolvedBy).toBe('admin');
  });
  it.each([{ stripePaymentIntentId: 'pi_paid' }, { walletAmountUsed: 5000 }, { sellerCreditedCents: 4500 },
    { deliveryType: 'shipping' }, { refundBlocked: true }, { bankDispute: { id: 'du', state: 'open' } },
    { noShowReport: null }])('refuses a financial or unproven case %j', async extra => {
    seed(extra); await expect(call()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(0); expect(holder.stripeCalls).toBe(0);
  });
});
