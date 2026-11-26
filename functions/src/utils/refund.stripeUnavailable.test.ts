/**
 * P0-2: the shared refund core must FAIL FAST when a card refund is due but the
 * Stripe client is unavailable (STRIPE_SECRET_KEY not bound to the calling
 * function, e.g. shipEngineWebhook before the secret was added).
 *
 * Without the guard, `stripe` being null silently skipped the Stripe refund
 * while the Firestore stage still marked the transaction 'refunded' and debited
 * the seller — the buyer's card was never refunded and no replay was recorded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from './testHelpers/firestoreMock';
import type { MockFirestore } from './testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripe: null as unknown,
}));

const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

vi.mock('../config/stripe', () => ({
  getStripe: () => holder.stripe,
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

vi.mock('./notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));

import { issueTransactionRefund } from './refund';

const PRE = {
  status: 'delivered',
  buyerId: 'buyer1',
  sellerId: 'seller1',
  articleId: 'art1',
  totalAmount: 50,
  paidVia: 'card',
  stripePaymentIntentId: 'pi_123',
  sellerCreditedCents: 4500,
};

beforeEach(() => {
  fs.reset();
  holder.stripe = null;
});

describe('issueTransactionRefund — Stripe client unavailable', () => {
  it('records an unknown durable obligation and no financial success when Stripe is unavailable', async () => {
    fs.setDoc('transactions/tx1', { ...PRE });
    fs.setDoc('wallets/seller1', { balance: 10000, pendingBalance: 0, heldBalance: 0 });
    const result = await issueTransactionRefund('tx1', PRE, { idempotencyKey: 'rf_return_tx1', source: 'returnRefund', relistArticle: false });
    expect(result).toMatchObject({ success: false, status: 'unknown', actionRequired: true });
    const pending = fs.writeOps.find(op => op.path.startsWith('failed_operations/'))!;
    expect(pending.data).toMatchObject({ type: 'stripe_refund_failed', refId: 'tx1', status: 'pending' });
    expect((pending.data.payload as any).idempotencyKey).toBe('rf_return_tx1');
    expect(fs.getDoc('transactions/tx1')!.status).toBe('refund_in_progress');
    expect(fs.getDoc('transactions/tx1')!.refundBlocked).toBe(true);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(10000);
    expect(fs.countWrites(op => op.path.startsWith('wallets/'))).toBe(0);
  });

  it('still reconciles when there is nothing to refund on the card (cardRefundAmountCents = 0)', async () => {
    fs.setDoc('transactions/tx2', { ...PRE });
    fs.setDoc('wallets/seller1', { balance: 10000, pendingBalance: 0, heldBalance: 0 });

    const res = await issueTransactionRefund('tx2', { ...PRE }, {
      idempotencyKey: 'rf_return_tx2',
      source: 'returnRefund',
      relistArticle: false,
      cardRefundAmountCents: 0,
    });

    expect(res.success).toBe(true);
    const intentId = fs.getDoc('transactions/tx2')!.refund.intentId;
    expect(fs.getDoc('failed_operations/refund_' + intentId)).toMatchObject({ status: 'resolved', attempts: 0 });
    expect(fs.getDoc('transactions/tx2')!.status).toBe('refunded');
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(5500);
  });
});
