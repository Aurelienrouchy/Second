/**
 * Tests for expireStaleProposedSwaps TOCTOU guard (F78).
 *
 * The job cancels stale 'proposed'/'payment_pending' swaps. The fix replaced the
 * blind batch.update with a PER-DOC transaction that re-checks the status, so a
 * 'payment_pending' swap whose top-up was PAID (webhook → 'accepted') between the
 * query and the write is NOT clobbered to 'cancelled' (which would trap the
 * payer's funds). The query is also bounded with .limit() (F81).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
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

vi.mock('../utils/notifications', () => ({
  sendPushNotification: async () => {},
}));

vi.mock('../callable/swaps', () => ({
  refundSwapTopUpIfPaid: async () => {},
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

import { expireStaleProposedSwaps } from './swaps';

type Scheduled = () => Promise<void>;
const run = expireStaleProposedSwaps as unknown as Scheduled;

const OLD = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000); // 8 days ago (> 7d)

beforeEach(() => {
  fs.reset();
});

describe('expireStaleProposedSwaps — TOCTOU guard (F78)', () => {
  it('cancels genuinely stale proposed/payment_pending swaps transactionally', async () => {
    fs.setDoc('swaps/s_prop', {
      initiatorId: 'P',
      receiverId: 'Q',
      status: 'proposed',
      createdAt: OLD,
    });
    fs.setDoc('swaps/s_pp', {
      initiatorId: 'P',
      receiverId: 'Q',
      status: 'payment_pending',
      createdAt: OLD,
    });

    await run();

    expect(fs.getDoc('swaps/s_prop')!.status).toBe('cancelled');
    expect(fs.getDoc('swaps/s_prop')!.cancelReason).toBe('proposed_expired_7d');
    expect(fs.getDoc('swaps/s_pp')!.status).toBe('cancelled');
    expect(fs.getDoc('swaps/s_pp')!.cancelReason).toBe('payment_pending_expired_7d');
  });

  it('does NOT clobber a payment_pending swap whose top-up was paid between query and write', async () => {
    fs.setDoc('swaps/s_paid', {
      initiatorId: 'P',
      receiverId: 'Q',
      status: 'payment_pending',
      createdAt: OLD,
    });

    // Simulate the top-up webhook advancing the swap to 'accepted' AFTER the
    // query snapshot but BEFORE the per-doc transaction re-reads it: wrap
    // runTransaction so the first call flips the status in the store first.
    const realRunTransaction = fs.db.runTransaction.bind(fs.db);
    let flipped = false;
    (fs.db as unknown as { runTransaction: typeof fs.db.runTransaction }).runTransaction = (
      fn: never
    ) => {
      if (!flipped) {
        flipped = true;
        fs.setDoc('swaps/s_paid', {
          initiatorId: 'P',
          receiverId: 'Q',
          status: 'accepted', // top-up paid in the meantime
          createdAt: OLD,
          topUpPaidAt: { __ts: true },
        });
      }
      return realRunTransaction(fn);
    };

    await run();

    // The status re-check inside the transaction saw 'accepted' (not expirable),
    // so the swap was NOT cancelled — the payer's funds stay safe.
    expect(fs.getDoc('swaps/s_paid')!.status).toBe('accepted');
  });
});
