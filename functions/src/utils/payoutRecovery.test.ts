/**
 * Unit tests for the shared payout-failure recovery helper (F36/F99).
 *
 * revertFailedPayout is the single source of truth re-used by BOTH the
 * payout.failed webhook AND the reconciliation replay (lost webhook). These
 * tests drive it directly against the in-memory Firestore + Stripe mocks and
 * assert: (1) wallet re-credit, (2) transfer reversal with the deterministic
 * key, (3) idempotence (a second call after status flips to 'failed' is a no-op),
 * (4) dead-letter when the transfer reversal itself fails.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from './testHelpers/firestoreMock';
import type { MockFirestore, StripeMock, WriteOp } from './testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  stripeMock: null as StripeMock | null,
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

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

import { revertFailedPayout } from './payoutRecovery';

beforeEach(() => {
  fs.reset();
  stripeMock.reset();
});

describe('revertFailedPayout', () => {
  it('re-credits the wallet, marks failed, and reverses the transfer', async () => {
    fs.setDoc('withdrawal_requests/wr1', {
      userId: 'seller1',
      amount: 2500,
      status: 'processing',
      stripeTransferId: 'tr_x',
    });
    fs.setDoc('wallets/seller1', { balance: 100, status: 'active' });

    const result = await revertFailedPayout(
      { withdrawalRequestId: 'wr1', payoutId: 'po_x', failureReason: 'bank closed' },
      stripeMock.client as never
    );

    expect(result.reCredited).toBe(true);
    expect(result.transferId).toBe('tr_x');

    // Wallet re-credited by the exact amount.
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(2600);
    expect(fs.sumIncrements('wallets/seller1', 'balance')).toBe(2500);
    // Request marked failed with bookkeeping.
    const wr = fs.getDoc('withdrawal_requests/wr1')!;
    expect(wr.status).toBe('failed');
    expect(wr.stripePayoutId).toBe('po_x');

    // Transfer reversed with the deterministic idempotency key.
    expect(stripeMock.calls.transfersCreateReversal.length).toBe(1);
    expect(stripeMock.calls.transfersCreateReversal[0][0]).toBe('tr_x');
    const revOpts = stripeMock.calls.transfersCreateReversal[0][2] as Record<string, unknown>;
    expect(revOpts.idempotencyKey).toBe('rev_tr_x');
  });

  it('is idempotent: a re-drive after the request is already failed does not double-credit', async () => {
    fs.setDoc('withdrawal_requests/wr2', {
      userId: 'seller1',
      amount: 3000,
      status: 'processing',
      stripeTransferId: 'tr_y',
    });
    fs.setDoc('wallets/seller1', { balance: 0, status: 'active' });

    // First drive (webhook).
    await revertFailedPayout({ withdrawalRequestId: 'wr2', payoutId: 'po_y' }, stripeMock.client as never);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);

    // Second drive (reconcile re-drives the lost webhook). The status is now
    // 'failed' (not 'processing'), so the re-credit is skipped.
    const result2 = await revertFailedPayout(
      { withdrawalRequestId: 'wr2', payoutId: 'po_y' },
      stripeMock.client as never
    );
    expect(result2.reCredited).toBe(false);
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);
    expect(fs.sumIncrements('wallets/seller1', 'balance')).toBe(3000);
  });

  it('dead-letters when the transfer reversal fails (still re-credits)', async () => {
    fs.setDoc('withdrawal_requests/wr3', {
      userId: 'seller1',
      amount: 1000,
      status: 'processing',
      stripeTransferId: 'tr_z',
    });
    fs.setDoc('wallets/seller1', { balance: 0, status: 'active' });

    stripeMock.impl.transfersCreateReversal = async () => {
      throw new Error('reversal boom');
    };

    await revertFailedPayout({ withdrawalRequestId: 'wr3', payoutId: 'po_z' }, stripeMock.client as never);

    // Re-credit still happened (UX priority).
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(1000);
    // Reversal failure dead-lettered for replay with the matching ref.
    const dl = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('failed_operations/') &&
        op.data.type === 'transfer_reversal_failed' &&
        (op.data.payload as Record<string, unknown>).transferId === 'tr_z'
    );
    expect(dl).toBeDefined();
  });

  it('no-op (no reversal) when no stripeTransferId is recorded', async () => {
    fs.setDoc('withdrawal_requests/wr4', {
      userId: 'seller1',
      amount: 1000,
      status: 'processing',
    });
    fs.setDoc('wallets/seller1', { balance: 0, status: 'active' });

    const result = await revertFailedPayout(
      { withdrawalRequestId: 'wr4', payoutId: 'po_w' },
      stripeMock.client as never
    );

    // Re-credit happens; no transfer to reverse.
    expect(result.transferId).toBeNull();
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(1000);
    expect(stripeMock.calls.transfersCreateReversal.length).toBe(0);
  });
});
