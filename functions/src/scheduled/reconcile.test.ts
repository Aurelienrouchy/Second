/**
 * Tests for reconcileFinances safety-net passes.
 *  - F76: reconcilePayments detects a charge fully refunded on Stripe while the
 *    transaction is still 'paid' (lost charge.refunded webhook) and dead-letters
 *    it (the previously-dead `&& false` branch is now live).
 *  - F75: reconcileBalances scans ALL wallets (paginated), so a breach beyond the
 *    old 200-doc cap is detected and raises an admin_alert.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock, WriteOp } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripe: null as StripeMock | null,
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
  getStripe: () => holder.stripe!.client,
}));

vi.mock('../utils/payoutRecovery', () => ({
  revertFailedPayout: async () => ({ reCredited: true, transferId: null }),
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

import { reconcileFinances } from './reconcile';

type Scheduled = () => Promise<void>;
const run = reconcileFinances as unknown as Scheduled;

const OLD = new Date(Date.now() - 60 * 60 * 1000); // 1h ago (> 30 min stale)

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
});

describe('reconcilePayments — F76 charge refunded but tx still paid', () => {
  it('dead-letters a fully-refunded charge whose tx never advanced to refunded', async () => {
    fs.setDoc('transactions/tx_refunded', {
      status: 'paid',
      stripePaymentIntentId: 'pi_ref',
      // no stripeRefundId recorded → the charge.refunded webhook was lost
      createdAt: OLD,
    });

    // PI succeeded with a charge fully refunded (amount_refunded >= amount).
    stripeMock.impl.paymentIntentsRetrieve = async () => ({
      status: 'succeeded',
      amount: 5000,
      amount_received: 5000,
      latest_charge: { amount_captured: 5000, amount: 5000, amount_refunded: 5000 },
    });

    await run();

    const deadLetter = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('failed_operations/') &&
        op.data.type === 'amount_mismatch' &&
        (op.data.payload as Record<string, unknown>)?.kind === 'lost_charge_refunded_webhook'
    );
    expect(deadLetter).toBeDefined();
    expect(deadLetter!.data.refId).toBe('tx_refunded');
  });

  it('does NOT dead-letter a PARTIAL refund (deliberate gesture)', async () => {
    fs.setDoc('transactions/tx_partial', {
      status: 'paid',
      stripePaymentIntentId: 'pi_partial',
      createdAt: OLD,
    });
    stripeMock.impl.paymentIntentsRetrieve = async () => ({
      status: 'succeeded',
      amount: 5000,
      amount_received: 5000,
      latest_charge: { amount_captured: 5000, amount: 5000, amount_refunded: 500 }, // partial
    });

    await run();

    const deadLetter = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('failed_operations/') &&
        (op.data.payload as Record<string, unknown>)?.kind === 'lost_charge_refunded_webhook'
    );
    expect(deadLetter).toBeUndefined();
  });
});

describe('reconcileBalances — F75 scans all wallets (beyond the old 200 cap)', () => {
  it('detects a breach on a wallet past the old MAX_PER_RUN cap', async () => {
    // Seed 250 healthy wallets + 1 breached one at the end (index 250). The old
    // code capped at 200 and would never reach it; the paginated scan does.
    for (let i = 0; i < 250; i++) {
      fs.setDoc(`wallets/w${i.toString().padStart(4, '0')}`, {
        balance: 100,
        pendingBalance: 0,
        heldBalance: 0,
        sellerDebt: 0,
      });
    }
    fs.setDoc('wallets/w9999_breach', {
      balance: -500, // negative balance = invariant breach
      pendingBalance: 0,
      heldBalance: 0,
      sellerDebt: 0,
    });

    await run();

    const alert = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('admin_alerts/') &&
        op.data.kind === 'wallet_invariant_breach' &&
        op.data.refId === 'w9999_breach'
    );
    expect(alert).toBeDefined();
    expect(alert!.data.severity).toBe('critical');
  });
});
