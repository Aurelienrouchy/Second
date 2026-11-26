import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth.uid, isAuthenticated: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {} }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: any, handler: any) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: any) { super(message); } } }));
import { sendMeetupProposal, rejectMeetupProposal } from './offers';
import { acceptMeetupOffer } from './payments/meetup';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';
const call = (fn: any, data: any, uid: string) => fn({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000), email_verified: true } }, data });
const send = (uid = 'buyer', extra = {}) => call(sendMeetupProposal, { chatId: 'chat', requestId: 'offer', amount: 40, location: { toArrange: true }, ...extra }, uid);
const accept = (uid = 'seller', messageId = 'offer') => call(acceptMeetupOffer, { chatId: 'chat', messageId }, uid);
const inactive = (uid: string) => fs.setDoc('users/' + uid, { ...fs.getDoc('users/' + uid), isActive: false });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z')); fs.reset();
  for (const uid of ['seller', 'buyer']) fs.setDoc('users/' + uid, { dateOfBirth: '2000-01-01', isActive: true });
  fs.setDoc('eligibility_profiles/seller', { version: 1, activityDeclaration: { kind: 'personal', actorUid: 'seller', recordedAt: new Date(),
    statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION, declarationVersion: 1, statement: SELLER_ACTIVITY_STATEMENTS.personal } });
  fs.setDoc('articles/article', { sellerId: 'seller', price: 50, isActive: true, isSold: false });
  fs.setDoc('chats/chat', { participants: ['buyer', 'seller'], articleId: 'article' });
  fs.setDoc('wallets/seller', { balance: 1234 }); fs.setDoc('wallets/buyer', { balance: 4321 });
});
afterEach(() => vi.useRealTimers());
async function legacy(extra: Record<string, unknown> = {}, full = true) {
  const sent = await send(); const message = fs.getDoc('messages/' + sent.messageId)!;
  fs.setDoc('transactions/legacy', { articleId: 'article', chatId: 'chat', buyerId: 'buyer', sellerId: 'seller',
    deliveryType: 'meetup', status: 'meetup_pending', amount: 40, meetupSpot: message.offer.meetup.location,
    ...(full ? { totalAmount: 40, sellerPayout: 40, serviceFee: 0, shippingCost: 0, taxTotal: 0, paidVia: 'cash' } : {}), ...extra });
  fs.setDoc('articles/article', { ...fs.getDoc('articles/article'), isSold: true, activeTransactionId: 'legacy' });
  return sent.messageId;
}
describe('03B1 V2 financial qualification before first legacy adoption', () => {
  it.each([
    { capturedCardCents: 4000, stripeChargeId: 'ch_observed', paidAt: new Date() },
    { capturedCardCents: 0 }, { capturedCardCents: null }, { stripeChargeId: '' }, { stripePaymentIntentId: false },
    { stripeClientSecret: 'secret_not_for_cash' }, { stripeCheckoutCreatedAt: new Date() }, { paidAt: 'unknown' },
    { walletCheckoutOutcome: 'unknown' }, { walletCheckoutAttemptId: 'attempt' }, { walletPaidAmount: 1 },
    { totalAmount: 42, serviceFee: 2 }, { totalAmount: '40' }, { totalAmount: null }, { totalAmount: 40.001 },
    { sellerPayout: 39 }, { sellerPayout: '40' }, { sellerPayout: null }, { serviceFee: -1 }, { serviceFee: NaN }, { shippingCost: Infinity },
    { serviceFeePercent: 5 }, { serviceFeeFixed: 1.5 }, { taxTotal: 1 }, { taxGst: 0.1 }, { buyerFeeReduction: 0.5 },
    { shippingCost: 2 }, { shippingCost: '0' }, { insuranceCost: 1 }, { actualShippingCost: 2 }, { shippingCostDelta: -2 },
    { shipEngineRateId: 'rate' }, { shippingLabelUrl: 'label' }, { shippingAddress: {} }, { trackingNumber: '' },
    { labelAttempts: 1 }, { lastLabelAttemptAt: new Date() },
    { returnLabelCost: 1 }, { sellerDebtRepaidCents: 10 }, { sellerHeldCreditCents: null },
    { fundsReleasedAt: new Date() }, { refundBlocked: 'unknown' }, { refundedVia: 'stripe' },
    { refund: { state: 'succeeded', intentId: 'old', fundsAppliedAt: new Date(), outstandingCardCents: 0 } },
    { bankDispute: { state: 'closed', id: 'du_old', closedAt: new Date(), outcome: 'won' } },
  ])('preserves ambiguous persisted cash evidence for examination %j', async extra => {
    const id = await legacy(extra); const original = fs.getDoc('transactions/legacy'); const article = fs.getDoc('articles/article');
    const message = fs.getDoc('messages/' + id), writes = fs.writeOps.length;
    await expect(accept('seller', id)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(writes); expect(fs.getDoc('transactions/legacy')).toEqual(original);
    expect(fs.getDoc('articles/article')).toEqual(article); expect(fs.getDoc('messages/' + id)).toEqual(message);
    expect(fs.getDoc('wallets/seller')).toEqual({ balance: 1234 }); expect(fs.getDoc('wallets/buyer')).toEqual({ balance: 4321 });
  });
  it.each([true, false])('coherent cash may be adopted with optional money fields present=%s', async full => {
    const id = await legacy({}, full); const result = await accept('seller', id);
    expect(result).toMatchObject({ transactionId: 'legacy', reused: true }); expect(fs.getDoc('transactions/legacy')!.offerMessageId).toBe(id);
    expect((await fs.db.collection('transactions').get()).size).toBe(1);
    expect(fs.getDoc('wallets/seller')).toEqual({ balance: 1234 }); expect(fs.getDoc('wallets/buyer')).toEqual({ balance: 4321 });
    if (!full) expect(fs.getDoc('transactions/legacy')).not.toHaveProperty('totalAmount');
  });
  it('producer-shaped zero projections are compatible without inferring any external payment', async () => {
    const id = await legacy({ buyerFeeReduction: 0, taxGst: 0, taxQst: 0, serviceFeePercent: 0, sellerDebtRepaidCents: 0,
      walletAmountUsed: 0, sellerPendingCreditCents: 0, sellerHeldCreditCents: 0, disputeFreezeCents: 0, refundBlocked: false });
    expect(await accept('seller', id)).toMatchObject({ transactionId: 'legacy', reused: true });
    expect(fs.getDoc('wallets/seller')).toEqual({ balance: 1234 }); expect(fs.getDoc('wallets/buyer')).toEqual({ balance: 4321 });
  });
  it('new financial qualification never reclassifies an already accepted exact linked replay', async () => {
    const sent = await send(), accepted = await accept('seller', sent.messageId);
    fs.setDoc('transactions/' + accepted.transactionId, { ...fs.getDoc('transactions/' + accepted.transactionId), capturedCardCents: 4000,
      stripeChargeId: 'ch_unproven', totalAmount: 42, serviceFee: 2 }); inactive('seller'); inactive('buyer');
    const before = fs.getDoc('transactions/' + accepted.transactionId), writes = fs.writeOps.length;
    expect(await accept('seller', sent.messageId)).toMatchObject({ transactionId: accepted.transactionId, reused: true });
    expect(fs.writeOps).toHaveLength(writes); expect(fs.getDoc('transactions/' + accepted.transactionId)).toEqual(before);
  });
});
describe('03B1 V2 own inactivity and confidential counterpart', () => {
  for (const uid of ['buyer', 'seller']) {
    const other = uid === 'seller' ? 'buyer' : 'seller', scope = uid === 'seller' ? 'sell' : 'buy';
    it(uid + ' new proposal gets own structured account refusal', async () => {
      inactive(uid); await expect(send(uid)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
      expect(fs.writeOps).toHaveLength(0);
    });
    it(uid + ' counter-offer gets own structured account refusal, original terms survive', async () => {
      const original = await send(other); inactive(uid); const writes = fs.writeOps.length;
      await expect(send(uid, { requestId: 'counter', originalMessageId: original.messageId, counterKind: 'price', amount: 39 }))
        .rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
      expect(fs.writeOps).toHaveLength(writes); expect(fs.getDoc('messages/' + original.messageId)!.offer.status).toBe('pending');
    });
    it(uid + ' first acceptance gets own structured account refusal', async () => {
      const sent = await send(other); inactive(uid); const writes = fs.writeOps.length;
      await expect(accept(uid, sent.messageId)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
      expect(fs.writeOps).toHaveLength(writes); expect((await fs.db.collection('transactions').get()).size).toBe(0);
    });
    it(uid + ' inactive counterpart is generic for proposal and acceptance', async () => {
      const sent = await send(other); inactive(other); const writes = fs.writeOps.length;
      for (const run of [() => send(uid, { requestId: 'new' }), () => accept(uid, sent.messageId)]) {
        const error = await run().catch(e => e);
        expect(error).toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } });
        expect(JSON.stringify(error.details)).not.toMatch(/account_unavailable|isActive|2000|dateOfBirth/);
      }
      expect(fs.writeOps).toHaveLength(writes);
    });
    it(uid + ' exact proposal receipt replays but a fresh alias cannot bypass inactivity', async () => {
      const sent = await send(uid); inactive(uid); const writes = fs.writeOps.length;
      expect(await send(uid)).toMatchObject({ messageId: sent.messageId, reused: true }); expect(fs.writeOps).toHaveLength(writes);
      await expect(send(uid, { requestId: 'alias' })).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
      expect(fs.writeOps).toHaveLength(writes);
    });
    it(uid + ' own inactivity is explained first when both parties are inactive', async () => {
      inactive(uid); inactive(other);
      await expect(send(uid)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account_unavailable', scope } });
      expect(fs.writeOps).toHaveLength(0);
    });
  }
  it.each(['buyer', 'seller'])('relationship blocking by %s still prevents proposal and acceptance', async blocked => {
    const sent = await send(); fs.setDoc('users/' + blocked, { ...fs.getDoc('users/' + blocked), blockedUserIds: [blocked === 'buyer' ? 'seller' : 'buyer'] });
    const writes = fs.writeOps.length;
    await expect(send('seller', { requestId: 'new' })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(accept('seller', sent.messageId)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(writes);
  });
  it('actor authorization still precedes private account checks and rejection keeps historical access', async () => {
    const sent = await send(); inactive('seller'); const writes = fs.writeOps.length;
    await expect(accept('other', sent.messageId)).rejects.toMatchObject({ code: 'permission-denied' }); expect(fs.writeOps).toHaveLength(writes);
    await call(rejectMeetupProposal, { chatId: 'chat', messageId: sent.messageId }, 'seller');
    expect(fs.getDoc('messages/' + sent.messageId)!.offer.status).toBe('rejected');
  });
});
