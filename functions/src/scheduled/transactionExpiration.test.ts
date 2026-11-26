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
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { createCashAgreement, qualifiedCashAgreement } from '../utils/cashMeetup';
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

type ScheduledHandler = () => Promise<void>;
let runScheduler: ScheduledHandler;
beforeAll(async () => {
  runScheduler = (await import('./transactionExpiration')).expireOrphanedTransactions as unknown as ScheduledHandler;
});

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
      return { id: 'rf_paid', status: 'succeeded', currency: 'cad', payment_intent: (a[0] as any).payment_intent, amount: (a[0] as any).amount, metadata: (a[0] as any).metadata };
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
    stripeMock.impl.refundsCreate = (...a: unknown[]) => {
      refundCount++;
      return { id: 'rf_paid', status: 'succeeded', currency: 'cad', payment_intent: (a[0] as any).payment_intent, amount: (a[0] as any).amount, metadata: (a[0] as any).metadata };
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
      totalAmount: 50,
      paidVia: 'card',
      deliveryType: 'shipping',
      articleId: 'a',
      stripePaymentIntentId: 'pi_resume',
      refund: { intentId: 'intent_resume', attemptId: 'intent_resume', idempotencyKey: 'rf_txr', state: 'pending',
        stripeRefundId: 'rf_already', paymentIntentId: 'pi_resume', cardAmountCents: 5000, walletAmountCents: 0,
        sellerDebitCents: 4500, originalStatus: 'paid', source: 'adminRefundTransaction', relistArticle: true, reason: 'admin_partial',
        freezeCents: 0, leaseUntilMs: 0, previousRefundIds: [], fundsAppliedAt: null },
      stripeRefundId: 'rf_already', // persisted on the prior crashed run
      createdAt: new Date(Date.now() - EIGHT_DAYS_MS),
    });
    fs.setDoc('articles/a', { isSold: true });
    fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 4500, status: 'active' });

    let refundCount = 0;
    stripeMock.impl.refundsCreate = (...a: unknown[]) => {
      refundCount++;
      return { id: 'rf_new', status: 'succeeded', currency: 'cad', payment_intent: (a[0] as any).payment_intent, amount: (a[0] as any).amount, metadata: (a[0] as any).metadata };
    };

    stripeMock.impl.refundsRetrieve = async () => ({ id: 'rf_already', status: 'succeeded', currency: 'cad',
      amount: 5000, payment_intent: 'pi_resume', metadata: { refundIntentId: 'intent_resume' } });
    await runScheduler();

    // The core re-issues the Stripe refund under the SAME deterministic key
    // (a real Stripe returns the original refund — no double money movement).
    expect(refundCount).toBe(0);
    expect(stripeMock.calls.refundsRetrieve).toHaveLength(1);
    expect(fs.getDoc('transactions/txr')!.refund.reason).toBe('admin_partial');
    expect(fs.getDoc('transactions/txr')!.cancelReason).toBeUndefined();
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
      totalAmount: 50,
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

    stripeMock.impl.refundsCreate = (...a: unknown[]) => ({ id: 'rf_mixed', status: 'succeeded', currency: 'cad', payment_intent: (a[0] as any).payment_intent, amount: (a[0] as any).amount, metadata: (a[0] as any).metadata });

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
    stripeMock.impl.refundsCreate = (...a: unknown[]) => {
      refundCount++;
      return { id: 'rf', status: 'succeeded', currency: 'cad', payment_intent: (a[0] as any).payment_intent, amount: (a[0] as any).amount, metadata: (a[0] as any).metadata };
    };

    await runScheduler();

    // Not refunded here — the sweep job owns it.
    expect(refundCount).toBe(0);
    expect(fs.getDoc('transactions/txlp')!.status).toBe('paid');
  });
});

// ===========================================================================
// F22. Mixed (wallet+card) pending_payment expiry restores the wallet portion
// ===========================================================================

describe('expireOrphanedTransactions — F22 mixed wallet portion restitution', () => {
  function seedMixedPending(opts?: { walletCents?: number; paidVia?: string }) {
    const { walletCents = 2500, paidVia = 'wallet_and_card' } = opts ?? {};
    fs.setDoc('transactions/txmix', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'pending_payment',
      deliveryType: 'shipping',
      articleId: 'article1',
      walletAmountUsed: walletCents,
      paidVia,
      stripePaymentIntentId: 'pi_mix',
      createdAt: new Date(Date.now() - TWO_HOURS_MS), // older than 1h cutoff
    });
    fs.setDoc('articles/article1', { isSold: true });
    fs.setDoc('wallets/buyer1', { balance: 0, status: 'active', currency: 'cad' });
    // Abandoned PI: cancelable.
    stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'requires_payment_method' });
  }

  it('restores the debited wallet part exactly once and expires the tx', async () => {
    seedMixedPending({ walletCents: 2500 });

    await runScheduler();

    // PI cancelled, tx expired, article released.
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(1);
    expect(fs.getDoc('transactions/txmix')!.status).toBe('cancelled');
    expect(fs.getDoc('articles/article1')!.isSold).toBe(false);

    // Wallet credited back the exact debited amount, once.
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(2500);

    // A refund_credit ledger entry was written.
    const ledger = fs.writeOps.find(
      (w) =>
        w.path.startsWith('wallets/buyer1/ledger/') &&
        (w.data as Record<string, unknown>).type === 'refund_credit'
    );
    expect(ledger).toBeDefined();
    expect((ledger!.data as Record<string, unknown>).amount).toBe(2500);

    // The wallet markers were purged from the transaction.
    const tx = fs.getDoc('transactions/txmix')!;
    expect(tx.walletAmountUsed).toBeUndefined();
    expect(tx.paidVia).toBeUndefined();
  });

  it('restores a 100% wallet pending_payment portion', async () => {
    seedMixedPending({ walletCents: 5000, paidVia: 'wallet' });

    await runScheduler();

    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(5000);
    expect(fs.getDoc('transactions/txmix')!.status).toBe('cancelled');
  });

  it('is idempotent: a 2nd scheduler run does not re-credit the wallet', async () => {
    seedMixedPending({ walletCents: 2500 });

    await runScheduler();
    // Re-arm the PI retrieve for the (now cancelled) tx — it won't be queried
    // again since status != pending_payment, but keep the mock consistent.
    await runScheduler();

    // Still exactly one credit of 2500.
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(2500);
  });

  it('does NOT credit the wallet when the PI is still in flight (succeeded)', async () => {
    seedMixedPending({ walletCents: 2500 });
    stripeMock.impl.paymentIntentsRetrieve = async () => ({ status: 'succeeded' });

    await runScheduler();

    // Not expired (captured payment) -> wallet untouched, tx untouched.
    expect(fs.sumIncrements('wallets/buyer1', 'balance')).toBe(0);
    expect(fs.getDoc('transactions/txmix')!.status).toBe('pending_payment');
    expect(stripeMock.calls.paymentIntentsCancel.length).toBe(0);
  });
});

// ===========================================================================
// V1 ne contient aucune clause d'expiration acceptée. Les anciens tests
// demandaient une annulation sur le seul âge : ce comportement est précisément
// le défaut corrigé. Accord, stock et message doivent rester cohérents/intacts.
// ===========================================================================
describe('expireOrphanedTransactions — rencontre sans expiration contractuelle qualifiée', () => {
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

  it('préserve un accord V1 tout récent adopté sur une réservation vieille de trois jours', async () => {
    const order = {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'meetup_pending',
      deliveryType: 'meetup',
      articleId: 'article1',
      chatId: 'chat1',
      offerMessageId: 'msg1',
      amount: 80, totalAmount: 80, sellerPayout: 80, shippingCost: 0, serviceFee: 0, currency: 'CAD', paidVia: 'cash',
      meetupSpot: { name: 'Café X' }, articleSnapshot: { id: 'article1', title: 'Robe' },
      createdAt: Timestamp.fromMillis(Date.now() - THREE_DAYS_MS),
    };
    const acceptedAt = Timestamp.now();
    const agreement = { ...createCashAgreement('txmp', order, 'buyer1', 'seller1'), acceptedAt };
    const transaction = { ...order, cashAgreement: agreement };
    expect(qualifiedCashAgreement('txmp', transaction)).toBe(true);
    fs.setDoc('transactions/txmp', transaction);
    fs.setDoc('articles/article1', { isSold: true });
    fs.setDoc('messages/msg1', {
      type: 'offer',
      chatId: 'chat1',
      senderId: 'buyer1',
      offer: { status: 'accepted', amount: 80, meetup: { location: { name: 'Café X' } } },
    });

    await runScheduler();

    expect(fs.getDoc('transactions/txmp')!.status).toBe('meetup_pending');
    expect(fs.getDoc('transactions/txmp')!.cashAgreement.acceptedAt).toEqual(acceptedAt);
    expect(fs.getDoc('transactions/txmp')!.createdAt).toEqual(order.createdAt);
    expect(fs.getDoc('articles/article1')!.isSold).toBe(true);
    expect(fs.getDoc('messages/msg1')!.offer.status).toBe('accepted');
  });

  it('préserve une ancienne rencontre confirmée et son offre acceptée', async () => {
    fs.setDoc('transactions/txmc', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'meetup_confirmed',
      deliveryType: 'meetup',
      articleId: 'article2',
      chatId: 'chat2',
      offerMessageId: 'msg2',
      createdAt: new Date(Date.now() - EIGHT_DAYS_MS),
    });
    fs.setDoc('articles/article2', { isSold: true });
    fs.setDoc('messages/msg2', {
      type: 'offer',
      chatId: 'chat2',
      senderId: 'buyer1',
      offer: {
        status: 'accepted',
        amount: 80,
        meetup: { location: { name: 'Café X' }, confirmedAt: new Date() },
      },
    });

    await runScheduler();

    expect(fs.getDoc('transactions/txmc')!.status).toBe('meetup_confirmed');
    expect(fs.getDoc('articles/article2')!.isSold).toBe(true);
    expect(fs.getDoc('messages/msg2')!.offer.status).toBe('accepted');
  });

  it("ne touche pas a une rencontre confirmee hier, meme creee il y a un mois", async () => {
    fs.setDoc('transactions/txfresh', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'meetup_confirmed',
      deliveryType: 'meetup',
      articleId: 'articleF',
      chatId: 'chatF',
      offerMessageId: 'msgF',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      meetupConfirmedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    fs.setDoc('articles/articleF', { isSold: true });
    fs.setDoc('messages/msgF', {
      type: 'offer',
      chatId: 'chatF',
      senderId: 'buyer1',
      offer: { status: 'accepted', amount: 80, meetup: { location: { name: 'Café X' } } },
    });

    await runScheduler();

    expect(fs.getDoc('transactions/txfresh')!.status).toBe('meetup_confirmed');
    expect(fs.getDoc('articles/articleF')!.isSold).toBe(true);
    expect(fs.getDoc('messages/msgF')!.offer.status).toBe('accepted');
  });

  it("préserve aussi une rencontre confirmée il y a dix jours sans clause de délai", async () => {
    fs.setDoc('transactions/txold10', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'meetup_confirmed',
      deliveryType: 'meetup',
      articleId: 'articleG',
      chatId: 'chatG',
      offerMessageId: 'msgG',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      meetupConfirmedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });
    fs.setDoc('articles/articleG', { isSold: true });
    fs.setDoc('messages/msgG', {
      type: 'offer',
      chatId: 'chatG',
      senderId: 'buyer1',
      offer: { status: 'accepted', amount: 80, meetup: { location: { name: 'Café X' } } },
    });

    await runScheduler();

    expect(fs.getDoc('transactions/txold10')!.status).toBe('meetup_confirmed');
    expect(fs.getDoc('articles/articleG')!.isSold).toBe(true);
    expect(fs.getDoc('messages/msgG')!.offer.status).toBe('accepted');
  });

  it("laisse vivre une rencontre qu un administrateur vient de restaurer", async () => {
    fs.setDoc('transactions/txrestored', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'meetup_confirmed',
      deliveryType: 'meetup',
      articleId: 'articleH',
      chatId: 'chatH',
      offerMessageId: 'msgH',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      meetupConfirmedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      disputeResolvedAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    fs.setDoc('articles/articleH', { isSold: true });
    fs.setDoc('messages/msgH', {
      type: 'offer',
      chatId: 'chatH',
      senderId: 'buyer1',
      offer: { status: 'accepted', amount: 80, meetup: { location: { name: 'Café X' } } },
    });

    await runScheduler();

    // Sinon l administrateur tranche en faveur du vendeur et le balayage
    // reannule la rencontre dans l heure qui suit, sans que personne comprenne.
    expect(fs.getDoc('transactions/txrestored')!.status).toBe('meetup_confirmed');
  });

  it('préserve une ancienne réservation sans preuve de son horloge ni offerMessageId', async () => {
    fs.setDoc('transactions/txold', {
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'meetup_pending',
      deliveryType: 'meetup',
      articleId: 'article3',
      chatId: 'chat3',
      createdAt: new Date(Date.now() - THREE_DAYS_MS),
    });
    fs.setDoc('articles/article3', { isSold: true });

    await runScheduler();

    expect(fs.getDoc('transactions/txold')!.status).toBe('meetup_pending');
    expect(fs.getDoc('articles/article3')!.isSold).toBe(true);
  });
});

describe('pending checkout with unconfirmed external outcome', () => {
  it.each(['creating', 'unknown'])('retains wallet reservation for outcome %s without a PI id', async walletCheckoutOutcome => {
    fs.setDoc('transactions/unknown_pi', { buyerId: 'buyer1', sellerId: 'seller1', status: 'pending_payment',
      createdAt: new Date(Date.now() - TWO_HOURS_MS), walletAmountUsed: 600, paidVia: 'wallet_and_card', walletCheckoutOutcome });
    fs.setDoc('wallets/buyer1', { balance: 9400, status: 'active' });
    await runScheduler();
    expect(fs.getDoc('transactions/unknown_pi')!.status).toBe('pending_payment');
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(9400);
    expect(stripeMock.calls.paymentIntentsCancel).toHaveLength(0);
    expect(fs.writeOps.filter(op => op.data.type === 'refund_credit')).toHaveLength(0);
  });
});
