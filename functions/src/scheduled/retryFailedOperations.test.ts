/**
 * Tests for retryFailedOperations dead-letter replay (F77 + F85).
 *
 *  - F77: a 'lost_pi_succeeded_webhook' dead-letter is auto-replayed by re-driving
 *    the canonical PI.succeeded handler (redrivePaymentIntentSucceeded). On a
 *    successful re-drive the op is marked 'resolved'.
 *  - F85: when an op exhausts MAX_ATTEMPTS, a critical admin_alert is written in
 *    addition to the CRITICAL log.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock, WriteOp } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripe: null as StripeMock | null,
  recoveryCalls: [] as string[],
  redriveResult: true,
  redriveCalls: [] as string[],
}));

const fs: MockFirestore = createFirestoreMock();
const stripeMock: StripeMock = createStripeMock();
holder.fs = fs;
holder.stripe = stripeMock;

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));

vi.mock('../config/stripe', () => ({
  getStripe: () => holder.stripe?.client ?? null,
}));

// Mock the webhook re-drive so we don't pull the whole webhook module graph.
vi.mock('../http/webhooks', () => ({
  redrivePaymentIntentSucceeded: async (pi: string) => {
    holder.redriveCalls.push(pi);
    return holder.redriveResult;
  },
}));

vi.mock('../utils/payoutRecovery', () => ({
  revertFailedPayout: async (input: { withdrawalRequestId: string }) => { holder.recoveryCalls.push(input.withdrawalRequestId); return { reCredited: true, transferId: null }; },
}));

vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

import { retryFailedOperations } from './retryFailedOperations';

type Scheduled = () => Promise<void>;
const run = retryFailedOperations as unknown as Scheduled;

beforeEach(() => {
  holder.stripe = stripeMock;
  holder.recoveryCalls.length = 0;
  fs.reset();
  stripeMock.reset();
  holder.redriveResult = true;
  holder.redriveCalls.length = 0;
});

describe('retryFailedOperations — lost PI.succeeded replay (F77)', () => {
  it('re-drives a lost_pi_succeeded_webhook op and marks it resolved', async () => {
    fs.setDoc('failed_operations/op1', {
      type: 'amount_mismatch',
      refId: 'tx1',
      payload: { kind: 'lost_pi_succeeded_webhook', paymentIntentId: 'pi_lost' },
      attempts: 0,
      status: 'pending',
      lastTriedAt: null,
    });

    await run();

    // The canonical PI.succeeded handler was re-driven with the persisted PI id.
    expect(holder.redriveCalls).toEqual(['pi_lost']);
    expect(fs.getDoc('failed_operations/op1')!.status).toBe('resolved');
  });

  it('keeps the op pending when the re-drive reports the PI is not (yet) succeeded', async () => {
    holder.redriveResult = false;
    fs.setDoc('failed_operations/op2', {
      type: 'amount_mismatch',
      refId: 'tx2',
      payload: { kind: 'lost_pi_succeeded_webhook', paymentIntentId: 'pi_pending' },
      attempts: 0,
      status: 'pending',
      lastTriedAt: null,
    });

    await run();

    expect(holder.redriveCalls).toEqual(['pi_pending']);
    // Not resolved — bumped attempts, still pending (will retry).
    expect(fs.getDoc('failed_operations/op2')!.status).toBe('pending');
    expect(fs.getDoc('failed_operations/op2')!.attempts).toBe(1);
  });
});

describe('retryFailedOperations — exhaustion alert (F85)', () => {
  it('writes a critical admin_alert when an op exhausts MAX_ATTEMPTS', async () => {
    // An unknown type always returns 'retry'; seed it at attempts=5 so the next
    // (6th) attempt exhausts it.
    fs.setDoc('failed_operations/op_exhaust', {
      type: 'some_unknown_type',
      refId: 'ref_x',
      payload: {},
      attempts: 5, // MAX_ATTEMPTS = 6
      status: 'pending',
      lastTriedAt: null,
    });

    await run();

    expect(fs.getDoc('failed_operations/op_exhaust')!.status).toBe('exhausted');
    const alert = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('admin_alerts/') && op.data.kind === 'dead_letter_exhausted'
    );
    expect(alert).toBeDefined();
    expect(alert!.data.severity).toBe('critical');
  });
});


describe('withdrawal recovery certifies the external outcome before compensation', () => {
  it.each(['unknown', 'pending', 'paid', 'failed', 'canceled'])('handles %s without guessing failure', async status => {
    fs.setDoc('wallets/seller1', { balance: 100, pendingBalance: 0, heldBalance: 0 });
    fs.setDoc('withdrawal_requests/withdrawal1', { status: 'processing', userId: 'seller1', amount: 2500,
      currency: 'cad', stripeAccountId: 'acct_seller1', stripeTransferId: 'tr1', createdAt: new Date(Date.now() - 7200000) });
    fs.setDoc('failed_operations/op_withdrawal', { type: 'payout_reversal_failed', refId: 'withdrawal1',
      payload: { kind: 'processing_no_payout_id' }, attempts: 0, status: 'pending', lastTriedAt: null });
    stripeMock.impl.payoutsList = async () => ({ data: status === 'unknown' ? [] : [{ id: 'po_recovered', status,
      amount: 2500, currency: 'cad', metadata: { withdrawalRequestId: 'withdrawal1', firebaseUserId: 'seller1' } }], has_more: false });
    await run();
    expect(holder.recoveryCalls).toEqual(status === 'failed' || status === 'canceled' ? ['withdrawal1'] : []);
    expect(fs.getDoc('withdrawal_requests/withdrawal1')!.status).toBe(status === 'paid' ? 'completed' : 'processing');
    expect(stripeMock.calls.payoutsCreate).toHaveLength(0);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(100);
  });
});

// Waiting for a bank decision is not a Stripe infrastructure failure.
describe('retryFailedOperations — independent bank control', () => {
  const bank = { id: 'du_open', state: 'open', outcome: null, stripeStatus: 'needs_response', closedAt: null };
  function seedRefund(type = 'stripe_refund_failed', extra: Record<string, unknown> = {}) {
    fs.setDoc('transactions/sale', { stripePaymentIntentId: 'pi_bank', status: 'delivered', sellerCreditedCents: 4500,
      bankDispute: bank, disputeId: 'du_open', disputed: false });
    fs.setDoc('failed_operations/refund', { type, refId: 'sale', payload: { paymentIntentId: 'pi_bank', autoRefund: true, idempotencyKey: 'rf_original' },
      attempts: 5, status: 'pending', lastTriedAt: null, ...extra });
  }

  it.each(['stripe_refund_failed', 'label_refund_failed', 'admin_refund_failed', 'amount_mismatch'])('keeps %s pending without using attempts or calling Stripe through a long bank wait', async type => {
    seedRefund(type);
    for (let i = 0; i < 10; i++) await run();
    expect(fs.getDoc('failed_operations/refund')).toMatchObject({ status: 'pending', attempts: 5, waitingReason: 'waiting_bank' });
    expect(stripeMock.calls.refundsCreate).toHaveLength(0);
    expect(fs.writeOps.some(op => op.data.kind === 'dead_letter_exhausted')).toBe(false);
  });

  it('lookup uses PaymentIntent even when the legacy refId is stale', async () => {
    seedRefund('stripe_refund_failed', { refId: 'obsolete_ref' }); await run();
    expect(stripeMock.calls.refundsCreate).toHaveLength(0);
    expect(fs.getDoc('failed_operations/refund')!.attempts).toBe(5);
  });

  it('bank waits do not consume attempts even while Stripe is unavailable', async () => {
    seedRefund('amount_mismatch'); holder.stripe = null;
    await run();
    expect(fs.getDoc('failed_operations/refund')).toMatchObject({ attempts: 5, status: 'pending', waitingReason: 'waiting_bank' });
  });

  it('unknown bank state and commercial-dismissed legacy bank identity stay waiting', async () => {
    seedRefund();
    fs.setDoc('transactions/sale', { stripePaymentIntentId: 'pi_bank', status: 'delivered', disputeId: 'du_legacy', disputeOutcome: 'dismissed', disputeClosedAt: new Date() });
    await run();
    expect(stripeMock.calls.refundsCreate).toHaveLength(0);
    expect(fs.getDoc('failed_operations/refund')!.waitingReason).toBe('waiting_bank');
  });

  const durable = (pi: string, key = 'rf_original') => ({ intentId: 'intent_' + pi, attemptId: 'intent_' + pi, idempotencyKey: key,
    state: 'unknown', paymentIntentId: pi, cardAmountCents: 5000, walletAmountCents: 0, sellerDebitCents: 0,
    originalStatus: 'delivery_failed', reason: 'repair', source: 'adminRefundTransaction', relistArticle: false,
    stripeRefundId: null, previousRefundIds: [], leaseUntilMs: 0, externalAttemptedAtMs: null, fundsAppliedAt: null, freezeCents: 0 });

  it('won closure allows the original repair to resume with its original idempotency key', async () => {
    seedRefund(); await run();
    fs.setDoc('transactions/sale', { stripePaymentIntentId: 'pi_bank', status: 'delivered', buyerId: 'buyer', sellerId: 'seller', refund: durable('pi_bank'), bankDispute: { ...bank, state: 'closed', outcome: 'won', closedAt: new Date() } });
    await run();
    expect(stripeMock.calls.refundsCreate).toHaveLength(1);
    expect(stripeMock.calls.refundsCreate[0][1]).toMatchObject({ idempotencyKey: 'rf_original' });
    expect(fs.getDoc('failed_operations/refund')!.status).toBe('resolved');
    expect(fs.getDoc('failed_operations/refund')!.waitingReason).toBeUndefined();
  });

  it.each(['stripe_refund_failed', 'amount_mismatch'])('a ledger-reconciled chargeback resolves %s repair without a second refund', async type => {
    seedRefund(type);
    fs.setDoc('transactions/sale', { stripePaymentIntentId: 'pi_bank', status: 'refunded', refundedVia: 'chargeback',
      bankDispute: { ...bank, state: 'closed', outcome: 'lost', closedAt: new Date(), ledgerReconciledAt: new Date() } });
    await run(); await run();
    expect(stripeMock.calls.refundsCreate).toHaveLength(0);
    expect(fs.getDoc('failed_operations/refund')!.status).toBe('resolved');
    expect(fs.writeOps.some(op => op.path.startsWith('wallets/'))).toBe(false);
  });

  it('legacy bank loss with no ledger reconciliation proof stays pending for one persistent operator alert', async () => {
    seedRefund();
    fs.setDoc('transactions/sale', { stripePaymentIntentId: 'pi_bank', status: 'refunded', refundedVia: 'chargeback',
      disputeOutcome: 'lost', disputeClosedAt: new Date() });
    await run(); await run();
    expect(fs.getDoc('failed_operations/refund')).toMatchObject({ status: 'pending', attempts: 5, waitingReason: 'waiting_bank_reconciliation' });
    expect(stripeMock.calls.refundsCreate).toHaveLength(0);
    expect(fs.writeOps.filter(op => op.path === 'admin_alerts/bank_retry_refund')).toHaveLength(1);
  });

  it('closed bank history requiring reconciliation remains waiting even with an older ledger marker', async () => {
    seedRefund();
    fs.setDoc('transactions/sale', { stripePaymentIntentId: 'pi_bank', status: 'refunded', refundedVia: 'chargeback', disputed: false,
      bankDispute: { ...bank, state: 'closed', outcome: 'lost', closedAt: new Date(), ledgerReconciledAt: new Date(),
        freezeCents: 4500, reconciliationRequired: true } });
    await run(); await run();
    expect(fs.getDoc('failed_operations/refund')).toMatchObject({ status: 'pending', attempts: 5, waitingReason: 'waiting_bank' });
    expect(stripeMock.calls.refundsCreate).toHaveLength(0);
    expect(fs.writeOps.some(op => op.data.kind === 'dead_letter_exhausted')).toBe(false);
  });

  it('bank opening during a durable refund replay leaves the repair waiting without exhausting attempts', async () => {
    seedRefund();
    fs.setDoc('transactions/sale', { stripePaymentIntentId: 'pi_bank', status: 'delivered', buyerId: 'buyer', sellerId: 'seller', refund: durable('pi_bank') });
    stripeMock.impl.refundsCreate = async (params: any) => {
      fs.setDoc('transactions/sale', { ...fs.getDoc('transactions/sale'), status: 'disputed', bankDispute: bank, disputeId: 'du_open' });
      return { id: 're_pending', status: 'pending', amount: params.amount, currency: 'cad', payment_intent: params.payment_intent, metadata: params.metadata };
    };
    await run();
    expect(fs.getDoc('failed_operations/refund')).toMatchObject({ status: 'pending', attempts: 5, waitingReason: 'waiting_bank' });
    expect(fs.writeOps.some(op => op.data.kind === 'dead_letter_exhausted')).toBe(false);
  });

  it('rotates past 100 bank waits to the next due legacy operation without a timestamp cursor', async () => {
    seedRefund(); fs.setDoc('failed_operations/refund', null);
    for (let i = 0; i < 100; i++) {
      fs.setDoc(`failed_operations/wait_${String(i).padStart(3, '0')}`, { type: 'stripe_refund_failed', refId: 'sale',
        payload: { paymentIntentId: 'pi_bank' }, attempts: 5, status: 'pending', lastTriedAt: null });
    }
    fs.setDoc('transactions/next_sale', { stripePaymentIntentId: 'pi_next', status: 'delivery_failed', buyerId: 'buyer', sellerId: 'seller', refund: durable('pi_next', 'rf_next') });
    fs.setDoc('failed_operations/zzz_next', { type: 'stripe_refund_failed', transactionId: 'next_sale', paymentIntentId: 'pi_next',
      attempts: 0, status: 'pending', lastTriedAt: null }); // legacy: no createdAt/payload
    await run();
    expect(stripeMock.calls.refundsCreate).toHaveLength(0);
    expect(fs.getDoc('job_locks/retryFailedOperations_cursor')!.lastPendingId).toBe('wait_099');
    await run();
    expect(stripeMock.calls.refundsCreate).toHaveLength(1);
    expect(fs.getDoc('failed_operations/zzz_next')!.status).toBe('resolved');
    expect(fs.getDoc('failed_operations/wait_099')).toMatchObject({ status: 'pending', attempts: 5 });
    await run(); // wrap at queue end; waits stay eligible without provider attempts
    expect(stripeMock.calls.refundsCreate).toHaveLength(1);
    expect(fs.getDoc('failed_operations/wait_000')!.attempts).toBe(5);
  });

  it('100 durable requires_action waits do not starve the next due refund or consume failure attempts', async () => {
    fs.setDoc('transactions/wait_sale', { stripePaymentIntentId: 'pi_wait', buyerId: 'buyer', sellerId: 'seller', status: 'refund_in_progress',
      refund: { ...durable('pi_wait'), state: 'requires_action', stripeRefundId: 're_wait' } });
    for (let i = 0; i < 100; i++) fs.setDoc('failed_operations/wait_' + String(i).padStart(3, '0'), {
      type: 'stripe_refund_failed', refId: 'wait_sale', payload: { paymentIntentId: 'pi_wait' }, attempts: 5, status: 'pending', lastTriedAt: null });
    fs.setDoc('transactions/ready', { stripePaymentIntentId: 'pi_ready', buyerId: 'buyer', sellerId: 'seller', status: 'refund_in_progress', refund: durable('pi_ready') });
    fs.setDoc('failed_operations/zzz_ready', { type: 'stripe_refund_failed', refId: 'ready', payload: { paymentIntentId: 'pi_ready' }, attempts: 0, status: 'pending', lastTriedAt: null });
    stripeMock.impl.refundsRetrieve = async () => ({ id: 're_wait', status: 'requires_action', currency: 'cad', amount: 5000,
      payment_intent: 'pi_wait', metadata: { refundIntentId: 'intent_pi_wait' } });
    await run(); expect(stripeMock.calls.refundsCreate).toHaveLength(0);
    await run(); expect(stripeMock.calls.refundsCreate).toHaveLength(1);
    expect(fs.getDoc('failed_operations/zzz_ready')!.status).toBe('resolved');
    expect(fs.getDoc('failed_operations/wait_000')).toMatchObject({ status: 'pending', attempts: 5, waitingReason: 'waiting_refund_action' });
    expect(fs.writeOps.some(op => op.data.kind === 'dead_letter_exhausted')).toBe(false);
  });

  it('legacy purchase retry without options never issues a second full refund or exhausts waiting', async () => {
    fs.setDoc('transactions/legacy', { stripePaymentIntentId: 'pi_legacy', status: 'refunded', totalAmount: 50 });
    fs.setDoc('failed_operations/legacy', { type: 'stripe_refund_failed', refId: 'legacy', paymentIntentId: 'pi_legacy',
      attempts: 5, status: 'pending', lastTriedAt: null });
    await run(); await run();
    expect(stripeMock.calls.refundsCreate).toHaveLength(0);
    expect(fs.getDoc('failed_operations/legacy')).toMatchObject({ status: 'pending', attempts: 5, waitingReason: 'waiting_refund_action' });
    expect(fs.writeOps.filter(op => op.path === 'admin_alerts/refund_legacy_retry_legacy')).toHaveLength(1);
  });

  it('total work stays bounded to 100 documents per run and wraps for new lower document IDs', async () => {
    for (let i = 0; i < 105; i++) {
      fs.setDoc(`failed_operations/op_${String(i).padStart(3, '0')}`, { type: 'stripe_refund_failed', refId: `sale_${i}`,
        payload: { paymentIntentId: `pi_${i}` }, attempts: 0, status: 'pending', lastTriedAt: null });
    }
    await run(); expect(stripeMock.calls.refundsCreate).toHaveLength(100);
    await run(); expect(stripeMock.calls.refundsCreate).toHaveLength(105);
    fs.setDoc('failed_operations/a_new_legacy', { type: 'stripe_refund_failed', refId: 'new',
      paymentIntentId: 'pi_new', attempts: 0, status: 'pending', lastTriedAt: null });
    await run(); expect(stripeMock.calls.refundsCreate).toHaveLength(106);
    expect(fs.getDoc('failed_operations/a_new_legacy')!.status).toBe('resolved');
  });
});
