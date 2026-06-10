/**
 * Integration-style tests for expireOrphanedTransactions (scheduled refunds).
 *
 * Drives the REAL onSchedule handler against an in-memory Firestore + a Stripe
 * mock. Focus (per chantier brief, item 5):
 *  - Refund is idempotent: a 2nd run does NOT issue a 2nd Stripe refund nor
 *    double-debit/credit wallets.
 *  - A 'pending_payment' tx whose PaymentIntent is 'succeeded' is NOT expired
 *    (expiry must never race a captured payment).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from '../utils/testHelpers/firestoreMock';

// See webhooks.test.ts for the lazy-holder rationale (avoids top-level await
// under module:commonjs while keeping vi.mock factories hoist-safe).
const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripeMock: null as StripeMock | null,
  pushCalls: [] as unknown[][],
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock: StripeMock = createStripeMock();
const pushCalls = holder.pushCalls;
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

vi.mock('../utils/notifications', () => ({
  sendPushNotification: (...a: unknown[]) => {
    holder.pushCalls.push(a);
    return Promise.resolve();
  },
}));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

import { expireOrphanedTransactions } from './transactionExpiration';

type ScheduledHandler = () => Promise<void>;
const runScheduler = expireOrphanedTransactions as unknown as ScheduledHandler;

const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
  pushCalls.length = 0;
  process.env.STRIPE_SECRET_KEY = 'sk_test';
  // Default: PI retrieve returns a non-in-flight status (safe to expire).
  stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'requires_payment_method' });
  stripeMock.impl.paymentIntentsCancel = async () => ({ id: 'pi_cancelled' });
});

// ===========================================================================
// 5a. paid-not-shipped refund is idempotent across runs
// ===========================================================================

describe('expireOrphanedTransactions — paid-not-shipped refund idempotency', () => {
  function seedPaidNotShipped() {
    const createdAt = new Date(Date.now() - EIGHT_DAYS_MS);
    fs.setDoc('transactions/txp', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'paid',
      sellerPayout: 45, // dollars
      // Durci ledger model: the seller credit persists the EXACT amount credited
      // as sellerCreditedCents (creditSellerForSale). The refund core debits this
      // precise figure (not the legacy derived sellerPayout) — matching the
      // hardened charge.refunded / dispute.closed handlers.
      sellerCreditedCents: 4500,
      totalAmount: 50,
      paidVia: 'card',
      deliveryType: 'shipping',
      articleId: 'article1',
      stripePaymentIntentId: 'pi_paid',
      createdAt,
    });
    fs.setDoc('articles/article1', { isSold: true });
    fs.setDoc('wallets/seller1', {
      balance: 0,
      pendingBalance: 4500, // seller credited at label time
      status: 'active',
    });
  }

  it('refunds once and finalizes to refunded', async () => {
    seedPaidNotShipped();

    let refundCount = 0;
    stripeMock.impl.refundsCreate = (...a: unknown[]) => {
      refundCount++;
      return { id: 'rf_paid' };
    };

    await runScheduler();

    // One plain Stripe refund for a (now platform) card charge — single-rail
    // model has no transfer to reverse.
    expect(refundCount).toBe(1);
    const refundArgs = stripeMock.calls.refundsCreate[0][0] as Record<string, unknown>;
    expect(refundArgs.payment_intent).toBe('pi_paid');
    expect(refundArgs.reverse_transfer).toBeUndefined();
    const refundOpts = stripeMock.calls.refundsCreate[0][1] as Record<string, unknown>;
    expect(refundOpts.idempotencyKey).toBe('rf_txp');

    // Final state: refunded, article released, seller pending debited.
    expect(fs.getDoc('transactions/txp')!.status).toBe('refunded');
    expect(fs.getDoc('articles/article1')!.isSold).toBe(false);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);
  });

  it('a 2nd scheduled run does NOT double-refund nor double-debit', async () => {
    seedPaidNotShipped();

    let refundCount = 0;
    stripeMock.impl.refundsCreate = () => {
      refundCount++;
      return { id: 'rf_paid' };
    };

    await runScheduler();
    expect(refundCount).toBe(1);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);

    // Second run: the tx is now 'refunded' — no status matches the 'paid' query,
    // so refundPaidNotShipped never runs again.
    await runScheduler();
    expect(refundCount).toBe(1); // still one
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500); // unchanged
    expect(fs.getDoc('transactions/txp')!.status).toBe('refunded');
  });

  it('resumes a refund_in_progress and never double-debits (Stripe key dedups)', async () => {
    // Crash recovery: tx already flagged refund_in_progress on a prior run.
    // The durci refund core (issueTransactionRefund) does NOT rely on a persisted
    // stripeRefundId to decide whether to call Stripe — it ALWAYS calls
    // refunds.create with the deterministic idempotency key `rf_<txId>`, so a
    // real Stripe dedups a replay to a no-op (covering even the crash window
    // BETWEEN the refund and persisting its id). The invariant that matters is:
    // the wallet is debited EXACTLY once (no double-debit), the refund call is
    // keyed deterministically, and the tx finalizes to 'refunded'.
    fs.setDoc('transactions/txr', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'refund_in_progress',
      sellerPayout: 45,
      sellerCreditedCents: 4500,
      paidVia: 'card',
      deliveryType: 'shipping',
      articleId: 'a',
      stripePaymentIntentId: 'pi_resume',
      stripeRefundId: 'rf_already', // persisted on the prior crashed run
      createdAt: new Date(Date.now() - EIGHT_DAYS_MS),
    });
    fs.setDoc('articles/a', { isSold: true });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 4500, status: 'active' });

    let refundCount = 0;
    stripeMock.impl.refundsCreate = () => {
      refundCount++;
      return { id: 'rf_new' };
    };

    await runScheduler();

    // The core re-issues the Stripe refund under the SAME deterministic key
    // (a real Stripe returns the original refund — no double money movement).
    expect(refundCount).toBe(1);
    const refundOpts = stripeMock.calls.refundsCreate[0][1] as Record<string, unknown>;
    expect(refundOpts.idempotencyKey).toBe('rf_txr');
    expect(fs.getDoc('transactions/txr')!.status).toBe('refunded');
    // Seller debited EXACTLY once across the run — no double-debit.
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
    expect(fs.sumIncrements('wallets/seller1', 'pendingBalance')).toBe(-4500);
  });

  it('passes NO reverse_transfer for a mixed wallet+card charge', async () => {
    fs.setDoc('transactions/txm', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'paid',
      sellerPayout: 45,
      paidVia: 'wallet_and_card',
      walletAmountUsed: 2000, // cents
      deliveryType: 'shipping',
      articleId: 'a',
      stripePaymentIntentId: 'pi_mixed',
      createdAt: new Date(Date.now() - EIGHT_DAYS_MS),
    });
    fs.setDoc('articles/a', { isSold: true });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 4500, status: 'active' });
    fs.setDoc('wallets/buyer1', { balance: 500, status: 'active' });

    stripeMock.impl.refundsCreate = () => ({ id: 'rf_mixed' });

    await runScheduler();

    const refundArgs = stripeMock.calls.refundsCreate[0][0] as Record<string, unknown>;
    expect(refundArgs.payment_intent).toBe('pi_mixed');
    // Mixed charge is a direct platform charge — nothing to reverse.
    expect(refundArgs.reverse_transfer).toBeUndefined();
    expect(refundArgs.refund_application_fee).toBeUndefined();

    // Buyer wallet portion (2000 cents) refunded.
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(2500);
  });
});

// ===========================================================================
// 5b. pending_payment with a succeeded PI is NOT expired
// ===========================================================================

describe('expireOrphanedTransactions — does not expire in-flight payments', () => {
  function seedPendingPayment(piStatus: string) {
    fs.setDoc('transactions/txpend', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      deliveryType: 'shipping',
      articleId: 'article1',
      stripePaymentIntentId: 'pi_pend',
      createdAt: new Date(Date.now() - TWO_HOURS_MS), // older than 1h cutoff
    });
    fs.setDoc('articles/article1', { isSold: true });
    stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: piStatus });
  }

  it('does NOT cancel a pending_payment whose PI is succeeded', async () => {
    seedPendingPayment('succeeded');

    await runScheduler();

    // Left untouched — the PI.succeeded webhook will finish the job.
    expect(fs.getDoc('transactions/txpend')!.status).toBe('pending_payment');
    expect(fs.getDoc('articles/article1')!.isSold).toBe(true);
    // The PI is NOT cancelled (it already captured).
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(0);
  });

  it('does NOT cancel a pending_payment whose PI requires_capture', async () => {
    seedPendingPayment('requires_capture');
    await runScheduler();
    expect(fs.getDoc('transactions/txpend')!.status).toBe('pending_payment');
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(0);
  });

  it('DOES cancel + expire a pending_payment whose PI is abandoned', async () => {
    seedPendingPayment('requires_payment_method');

    await runScheduler();

    // PI cancelled to block any late capture, then tx expired + article released.
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(1);
    expect(fs.getDoc('transactions/txpend')!.status).toBe('cancelled');
    expect(fs.getDoc('transactions/txpend')!.cancelReason).toBe('pending_payment_expired_1h');
    expect(fs.getDoc('articles/article1')!.isSold).toBe(false);
  });

  it('skips a labelCreationPending paid tx (owned by sweepPendingLabels)', async () => {
    fs.setDoc('transactions/txlp', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'paid',
      sellerPayout: 45,
      paidVia: 'card',
      deliveryType: 'shipping',
      articleId: 'a',
      labelCreationPending: true,
      stripePaymentIntentId: 'pi_lp',
      createdAt: new Date(Date.now() - EIGHT_DAYS_MS),
    });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, status: 'active' });

    let refundCount = 0;
    stripeMock.impl.refundsCreate = () => {
      refundCount++;
      return { id: 'rf' };
    };

    await runScheduler();

    // Not refunded here — the sweep job owns it.
    expect(refundCount).toBe(0);
    expect(fs.getDoc('transactions/txlp')!.status).toBe('paid');
  });
});
