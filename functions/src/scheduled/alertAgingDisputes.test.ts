/**
 * B9 — alertAgingDisputes: ops visibility on disputes stuck awaiting admin.
 *
 * A `disputed` swap (openSwapDispute) or `disputed` transaction has no automatic
 * exit — only an admin callable resolves it. Without surveillance a forgotten
 * dispute freezes funds + articles sine die. This job does NOT auto-decide; it
 * writes ONE admin_alert per aging dispute, idempotent + non-spammy via a
 * `disputeAlertedAt` stamp.
 *
 * Tests:
 *  - an OLD disputed swap (> threshold) raises a swap_dispute_aging alert + stamps.
 *  - an OLD disputed transaction raises a transaction_dispute_aging alert + stamps.
 *  - a RECENT dispute (within threshold) is not alerted.
 *  - a SECOND run does not re-alert an already-stamped dispute (idempotent).
 *  - a non-disputed doc is never alerted.
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

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    fromMillis: (ms: number) => ({ toMillis: () => ms, __ts: true }),
  },
}));

vi.mock('../config/stripe', () => ({ getStripe: () => null }));

vi.mock('../callable/wallet', () => ({
  getOrCreateSellerWallet: async () => ({ walletRef: null, walletData: {}, isNew: false }),
}));

vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: () => ({ callerKey: 'x', isAuthenticated: true }),
}));

vi.mock('../utils/notifications', () => ({
  sendPushNotification: async () => {},
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

import { alertAgingDisputes } from './swaps';
import type { WriteOp } from '../utils/testHelpers/firestoreMock';

type Scheduled = () => Promise<void>;
const run = alertAgingDisputes as unknown as Scheduled;

const OLD = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000); // 6 days ago (> 5d)
const RECENT = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

beforeEach(() => {
  fs.reset();
});

describe('alertAgingDisputes (B9)', () => {
  it('raises a swap_dispute_aging alert and stamps disputeAlertedAt for an old disputed swap', async () => {
    fs.setDoc('swaps/s1', {
      initiatorId: 'P',
      receiverId: 'Q',
      status: 'disputed',
      disputeReason: 'item not received',
      disputeOpenedBy: 'P',
      statusBeforeDispute: 'shipping',
      disputeOpenedAt: OLD,
    });

    await run();

    const alert = fs.writeOps.find(
      (op: WriteOp) => op.path.startsWith('admin_alerts/') && op.data.kind === 'swap_dispute_aging'
    );
    expect(alert).toBeDefined();
    expect(alert!.data.severity).toBe('warning');
    expect(alert!.data.refId).toBe('s1');

    // The swap is stamped so it is not re-alerted.
    expect(fs.getDoc('swaps/s1')!.disputeAlertedAt).toBeDefined();
  });

  it('raises a transaction_dispute_aging alert for an old disputed transaction', async () => {
    fs.setDoc('transactions/tx1', {
      buyerId: 'B',
      sellerId: 'S',
      status: 'disputed',
      deliveryType: 'shipping',
      statusBeforeDispute: 'delivered',
      disputedAt: OLD,
    });

    await run();

    const alert = fs.writeOps.find(
      (op: WriteOp) =>
        op.path.startsWith('admin_alerts/') && op.data.kind === 'transaction_dispute_aging'
    );
    expect(alert).toBeDefined();
    expect(alert!.data.refId).toBe('tx1');
    expect(fs.getDoc('transactions/tx1')!.disputeAlertedAt).toBeDefined();
  });

  it('does NOT alert a dispute within the threshold', async () => {
    fs.setDoc('swaps/sRecent', {
      initiatorId: 'P',
      receiverId: 'Q',
      status: 'disputed',
      disputeOpenedAt: RECENT,
    });

    await run();

    expect(
      fs.writeOps.find((op: WriteOp) => op.path.startsWith('admin_alerts/'))
    ).toBeUndefined();
    expect(fs.getDoc('swaps/sRecent')!.disputeAlertedAt).toBeUndefined();
  });

  it('is idempotent: a second run does not re-alert an already-stamped dispute', async () => {
    fs.setDoc('swaps/s2', {
      initiatorId: 'P',
      receiverId: 'Q',
      status: 'disputed',
      disputeOpenedAt: OLD,
    });

    await run();
    await run();

    const alerts = fs.writeOps.filter(
      (op: WriteOp) => op.path.startsWith('admin_alerts/') && op.data.kind === 'swap_dispute_aging'
    );
    expect(alerts.length).toBe(1);
  });

  it('never alerts a non-disputed doc', async () => {
    fs.setDoc('swaps/sActive', {
      initiatorId: 'P',
      receiverId: 'Q',
      status: 'accepted',
      disputeOpenedAt: OLD,
    });
    fs.setDoc('transactions/txDelivered', {
      buyerId: 'B',
      sellerId: 'S',
      status: 'delivered',
      disputedAt: OLD,
    });

    await run();

    expect(
      fs.writeOps.find((op: WriteOp) => op.path.startsWith('admin_alerts/'))
    ).toBeUndefined();
  });
});
