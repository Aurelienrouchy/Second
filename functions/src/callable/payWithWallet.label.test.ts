/**
 * B1 — payWithWallet shipping rail must use createLabelIdempotent.
 *
 * The 100%-wallet shipping payment used to call shipEngine.createLabel directly
 * then commit in a SEPARATE runTransaction — a non-idempotent two-step flow. If
 * the instance died after the paid label call but before the commit, the label
 * was orphaned, the seller was never credited, and the tx froze in 'paid' WITHOUT
 * labelCreationPending, so sweepPendingLabels (which filters
 * labelCreationPending==true && status=='paid') never recovered it.
 *
 * These tests prove the rail now goes through createLabelIdempotent (reservation
 * BEFORE the paid call, atomic credit+persist), mirroring the webhook/sweep:
 *   - success: seller credited once, tx -> 'label_created', reservation cleared.
 *   - createLabel failure: seller NOT credited, labelCreationPending=true set
 *     (so the sweep can recover), tx stays 'paid'.
 *
 * Uses the shared in-memory harness (commits writes + supports nested
 * runTransactions, exactly what createLabelIdempotent needs).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripeMock: null as StripeMock | null,
  shipEngine: null as any,
}));

const fs: MockFirestore = createFirestoreMock({ enforceReadBeforeWrite: true });
const stripeMock: StripeMock = createStripeMock();
holder.fs = fs;
holder.stripeMock = stripeMock;

vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) },
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

vi.mock('../config/stripe', () => ({
  getStripe: () => holder.stripeMock!.client,
}));

vi.mock('../config/shipEngine', () => ({
  getShipEngine: () => holder.shipEngine,
}));

vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: (request: { auth?: { uid?: string } }) => ({
    callerKey: request.auth?.uid ?? 'anon',
    isAuthenticated: !!request.auth,
  }),
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

vi.mock('firebase-functions/v2/https', () => {
  class _HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  }
  return {
    onCall: (_opts: unknown, handler: unknown) => handler,
    HttpsError: _HttpsError,
  };
});

import { payWithWallet } from './wallet';
import { quotePurchase, reservePurchase } from '../utils/shippingPurchase';
import { creditSellerForSale } from '../utils/labelFulfillment';
import { seedPurchase, purchaseAccount, purchaseAddress, purchaseRawRates } from '../utils/testHelpers/shippingPurchaseFixture';
import { parsePurchaseRates } from '../utils/shippingPurchaseRate';
const rates = () => { const raw = purchaseRawRates(); raw.rate_response.rates[0].shipping_amount.amount = 11.25;
  for (const k of ['insurance_amount', 'confirmation_amount', 'other_amount'] as const) raw.rate_response.rates[0][k].amount = 0; return parsePurchaseRates(raw); };
const engine = (createLabel: any) => ({ createLabel, getPurchaseRates: async () => rates(), getPurchaseRatesForShipment: async () => rates() });

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callPay = payWithWallet as unknown as CallableHandler;

const okLabel = {
  labelId: 'se_label_1',
  trackingNumber: 'TRK123',
  labelDownload: { href: 'https://label/se_label_1.pdf' },
  trackingUrl: 'https://track/TRK123',
  carrierCode: 'usps',
  shipmentCost: 10,
  insuranceCost: 0,
};

/** Seed a 100%-wallet SHIPPING transaction in pending_payment + buyer wallet. */
async function seedShippingPayable(opts?: { rateId?: string | null }) {
  const seeded: Record<string, any> = {};
  seedPurchase({ setDoc: (path, data) => { seeded[path] = data; } });
  for (const [path, data] of Object.entries(seeded)) {
    const target = path.replace('/seller', '/seller1').replace('/buyer','/buyer1').replace('/article','/article1');
    fs.setDoc(target, { ...data, ...(data.sellerId ? { sellerId: 'seller1', price: 45 } : {}), ...(data.articleId ? { articleId: 'article1', ownerId: 'seller1' } : {}) });
  }
  fs.setDoc('wallets/buyer1', { balance: 10000, pendingBalance: 0, status: 'active', currency: 'cad' });
  const q = await quotePurchase('buyer1', { articleId: 'article1', shippingAddress: purchaseAddress });
  const r = await reservePurchase('buyer1', { deliveryType: 'shipping', quoteId: q.quoteId, rateId: q.rates[0].rateId, expectedTotal: q.rates[0].totalAmount });
  const order = fs.getDoc(`transactions/${r.transactionId}`)!;
  fs.setDoc('transactions/tx1', { ...order, chatId: 'chat1', ...(opts?.rateId ? { shipEngineRateId: opts.rateId } : {}) });
  fs.setDoc(`transactions/${r.transactionId}`, null);
  fs.setDoc(`shipping_quotes/${q.quoteId}`, { ...fs.getDoc(`shipping_quotes/${q.quoteId}`), transactionId: 'tx1' });
  fs.setDoc('articles/article1', { ...fs.getDoc('articles/article1'), activeTransactionId: 'tx1' });
  fs.writeOps.length = 0;
}

beforeEach(() => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true');
  vi.stubEnv('SHIPPING_ENABLED', 'true');
  fs.reset();
  stripeMock.reset();
  stripeMock.impl.accountsRetrieve = async () => purchaseAccount('seller1');
  holder.shipEngine = engine(async () => okLabel);
});

describe('payWithWallet — shipping label (B1, createLabelIdempotent)', () => {
  it('on success: credits seller once, advances to label_created, clears reservation', async () => {
    await seedShippingPayable();

    const result = await callPay({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: 'buyer1' }, data: { expectedUid: 'buyer1', transactionId: 'tx1' } });
    expect(result.success).toBe(true);

    const tx = fs.getDoc('transactions/tx1')!;
    // The idempotent helper advances the tx to 'label_created' (NOT 'shipped').
    expect(tx.status).toBe('label_created');
    expect(tx.shipEngineLabelId).toBe('se_label_1');
    expect(tx.trackingNumber).toBe('TRK123');
    expect(tx.labelCreationPending).toBe(false);
    // The reservation lock is cleared on commit (delete sentinel -> field gone).
    expect(tx.labelReservationAt).toBeUndefined();

    // Seller credited EXACTLY sellerPayout (45$ -> 4500 cents) into pendingBalance,
    // exactly once (deferred credit happens in the label commit, not at debit).
    // The seller wallet is created on the fly, so the credit is the initial value.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(4500);
    // sellerCreditedCents stamped once (idempotence marker).
    expect(tx.sellerCreditedCents).toBe(4500);
  });

  it('on createLabel failure: NOT credited, labelCreationPending=true (sweep-visible), stays paid', async () => {
    await seedShippingPayable();
    holder.shipEngine = { ...holder.shipEngine,
      createLabel: async () => {
        throw new Error('ShipEngine 500');
      },
    };

    const result = await callPay({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: 'buyer1' }, data: { expectedUid: 'buyer1', transactionId: 'tx1' } });
    expect(result.success).toBe(true);

    const tx = fs.getDoc('transactions/tx1')!;
    // The label was never created — the tx stays 'paid' AND is flagged for the
    // sweep (the bug was: invisible to sweep because the flag was never set).
    expect(tx.status).toBe('paid');
    expect(tx.labelCreationPending).toBe(true);

    // The createLabelIdempotent reservation was cleared so the sweep can retry.
    expect(tx.labelReservationAt).toBeUndefined();

    // Seller NOT credited (deferred-credit model: no label = no credit).
    expect(fs.getDoc('wallets/seller1')).toBeUndefined();
    expect(tx.sellerCreditedCents).toBeUndefined();

    // Buyer WAS debited (payment succeeded) — 60$ -> 6000 cents.
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(4000);
  });

  it('fallback rateId cannot authorize a new debit or label', async () => {
    await seedShippingPayable({ rateId: 'fallback_xyz' });
    let createLabelCalls = 0;
    holder.shipEngine = { ...holder.shipEngine,
      createLabel: async () => {
        createLabelCalls++;
        return okLabel;
      },
    };

    await expect(callPay({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: 'buyer1' }, data: { expectedUid: 'buyer1', transactionId: 'tx1' } })).rejects.toMatchObject({ code: 'aborted' });
    expect(createLabelCalls).toBe(0);
    expect(fs.getDoc('transactions/tx1')!.status).toBe('pending_payment');
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(10000);
    expect(fs.getDoc('wallets/seller1')).toBeUndefined();
    expect(fs.writeOps).toHaveLength(0);
  });
});


describe('existing legacy non-shipping seller credit helper preserves Firestore read ordering', () => {
  it.each([true, false])('reads before writes with seller wallet existing=%s', async existing => {
    await seedShippingPayable();
    await fs.db.collection('transactions').doc('tx1').update({ deliveryType: 'legacy_local' });
    if (existing) fs.setDoc('wallets/seller1', { balance: 100, pendingBalance: 200, sellerDebt: 1000, status: 'active' });
    await fs.db.collection('transactions').doc('tx1').update({ status: 'paid', paidVia: 'wallet', walletAmountUsed: 6000 });
    fs.setDoc('wallets/buyer1', { balance: 4000, status: 'active', currency: 'cad' });
    await fs.db.runTransaction(async tx => { const ref = fs.db.collection('transactions').doc('tx1'); const order = (await tx.get(ref)).data()!; await creditSellerForSale(tx, ref, order, 'tx1'); });
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(4000);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(existing ? 3700 : 4500);
    expect(fs.getDoc('transactions/tx1')!.sellerCreditedCents).toBe(4500);
    expect(fs.getDoc('transactions/tx1')!.status).toBe('paid');
  });
});
