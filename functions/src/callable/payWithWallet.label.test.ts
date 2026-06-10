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
  shipEngine: null as { createLabel: (...a: unknown[]) => unknown } | null,
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock: StripeMock = createStripeMock();
holder.fs = fs;
holder.stripeMock = stripeMock;

vi.mock('../config/firebase', () => ({
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
function seedShippingPayable(opts?: { rateId?: string | null }) {
  const { rateId = 'rate_1' } = opts ?? {};
  fs.setDoc('transactions/tx1', {
    buyerId: 'buyer1',
    sellerId: 'seller1',
    status: 'pending_payment',
    deliveryType: 'shipping',
    totalAmount: 60, // dollars -> 6000 cents
    sellerPayout: 45, // dollars -> 4500 cents credited to seller
    amount: 45,
    shippingCost: 10,
    articleId: 'article1',
    chatId: 'chat1',
    shipEngineRateId: rateId,
  });
  fs.setDoc('wallets/buyer1', {
    balance: 10000,
    pendingBalance: 0,
    status: 'active',
    currency: 'cad',
  });
  fs.setDoc('articles/article1', { isSold: false });
}

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  holder.shipEngine = { createLabel: async () => okLabel };
});

describe('payWithWallet — shipping label (B1, createLabelIdempotent)', () => {
  it('on success: credits seller once, advances to label_created, clears reservation', async () => {
    seedShippingPayable();

    const result = await callPay({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } });
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
    seedShippingPayable();
    holder.shipEngine = {
      createLabel: async () => {
        throw new Error('ShipEngine 500');
      },
    };

    const result = await callPay({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } });
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

  it('fallback rateId: deferred to sweep without calling createLabel', async () => {
    seedShippingPayable({ rateId: 'fallback_xyz' });
    let createLabelCalls = 0;
    holder.shipEngine = {
      createLabel: async () => {
        createLabelCalls++;
        return okLabel;
      },
    };

    await callPay({ auth: { uid: 'buyer1' }, data: { transactionId: 'tx1' } });

    expect(createLabelCalls).toBe(0);
    const tx = fs.getDoc('transactions/tx1')!;
    expect(tx.status).toBe('paid');
    expect(tx.labelCreationPending).toBe(true);
    expect(fs.getDoc('wallets/seller1')).toBeUndefined();
  });
});
