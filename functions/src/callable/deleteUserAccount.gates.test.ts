/**
 * Tests for the deleteUserAccount DELETION GATES (wave 4):
 *
 *  - F87: 'meetup_completed' is terminal — a user who completed a meetup can
 *    still delete their account (Loi 25 / RGPD art. 17).
 *  - F89: a withdrawal in 'processing' BLOCKS deletion (the payout.failed
 *    re-credit needs the withdrawal_requests doc + wallet).
 *  - F90 (+F56): a non-terminal swap — or one with a paid-but-unsettled top-up —
 *    BLOCKS deletion (hard-deleting it would orphan the refund/escrow path).
 *
 * The gates are read-only precondition checks that throw BEFORE any mutation, so
 * we only need the in-memory Firestore harness (no auth/storage exercised on the
 * blocking paths). The "happy" gate-pass case is asserted by reaching the
 * Auth-delete step (auth.deleteUser is mocked).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  authDeleted: [] as string[],
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
  auth: {
    deleteUser: async (uid: string) => {
      holder.authDeleted.push(uid);
    },
  },
  storage: {
    bucket: () => ({
      deleteFiles: async () => {},
    }),
  },
}));

vi.mock('../config/stripe', () => ({
  getStripe: () => null,
}));

vi.mock('./privacyIncidents', () => ({
  recordPrivacyIncident: async () => {},
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

import { deleteUserAccount } from './users';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callDelete = deleteUserAccount as unknown as CallableHandler;

const UID = 'user1';

/** Seed a minimal clean account (no blockers) so the deletion proceeds. */
function seedCleanAccount() {
  fs.setDoc(`users/${UID}`, { username: null });
  fs.setDoc(`wallets/${UID}`, { balance: 0, pendingBalance: 0, heldBalance: 0, sellerDebt: 0 });
}

beforeEach(() => {
  fs.reset();
  holder.authDeleted.length = 0;
  process.env.STRIPE_SECRET_KEY = 'sk_test';
});

describe('deleteUserAccount — auth', () => {
  it('requires authentication', async () => {
    await expect(callDelete({ auth: null })).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

// ===========================================================================
// F87 — meetup_completed is terminal
// ===========================================================================

describe('deleteUserAccount — F87 meetup_completed terminal', () => {
  it('allows deletion when the only transaction is meetup_completed', async () => {
    seedCleanAccount();
    fs.setDoc('transactions/tx1', {
      buyerId: UID,
      sellerId: 's1',
      status: 'meetup_completed',
    });

    const res = await callDelete({ auth: { uid: UID } });
    expect(res.success).toBe(true);
    // Reached the final Auth-delete step → gates passed.
    expect(holder.authDeleted).toContain(UID);
  });

  it('still BLOCKS on a genuinely active transaction (e.g. meetup_pending)', async () => {
    seedCleanAccount();
    fs.setDoc('transactions/tx1', {
      buyerId: UID,
      sellerId: 's1',
      status: 'meetup_pending',
    });

    await expect(callDelete({ auth: { uid: UID } })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(holder.authDeleted).not.toContain(UID);
  });
});

// ===========================================================================
// F89 — withdrawal in 'processing' blocks deletion
// ===========================================================================

describe('deleteUserAccount — F89 processing withdrawal gate', () => {
  it('BLOCKS deletion while a withdrawal is processing', async () => {
    seedCleanAccount();
    fs.setDoc('withdrawal_requests/wr1', {
      userId: UID,
      status: 'processing',
      amount: 2000,
    });

    await expect(callDelete({ auth: { uid: UID } })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(holder.authDeleted).not.toContain(UID);
  });

  it('allows deletion when the withdrawal is already settled (paid)', async () => {
    seedCleanAccount();
    fs.setDoc('withdrawal_requests/wr1', {
      userId: UID,
      status: 'paid',
      amount: 2000,
    });

    const res = await callDelete({ auth: { uid: UID } });
    expect(res.success).toBe(true);
    expect(holder.authDeleted).toContain(UID);
  });
});

// ===========================================================================
// F90 (+F56) — swap gate
// ===========================================================================

describe('deleteUserAccount — F90 swap gate', () => {
  it('BLOCKS deletion when a non-terminal swap involves the user', async () => {
    seedCleanAccount();
    fs.setDoc('swaps/sw1', {
      initiatorId: UID,
      receiverId: 'other',
      status: 'accepted',
    });

    await expect(callDelete({ auth: { uid: UID } })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(holder.authDeleted).not.toContain(UID);
  });

  it('BLOCKS deletion on a paid-but-unsettled top-up even if status looks terminal', async () => {
    seedCleanAccount();
    fs.setDoc('swaps/sw1', {
      initiatorId: UID,
      receiverId: 'other',
      status: 'completed',
      topUpPaidAt: { __ts: true },
      // never released nor refunded → still escrowed
    });

    await expect(callDelete({ auth: { uid: UID } })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(holder.authDeleted).not.toContain(UID);
  });

  it('allows deletion when a swap is terminal AND the top-up was released', async () => {
    seedCleanAccount();
    fs.setDoc('swaps/sw1', {
      initiatorId: UID,
      receiverId: 'other',
      status: 'completed',
      topUpPaidAt: { __ts: true },
      topUpReleasedAt: { __ts: true },
    });

    const res = await callDelete({ auth: { uid: UID } });
    expect(res.success).toBe(true);
    expect(holder.authDeleted).toContain(UID);
  });

  it('allows deletion when a swap is terminal AND the top-up was refunded', async () => {
    seedCleanAccount();
    fs.setDoc('swaps/sw1', {
      receiverId: UID,
      initiatorId: 'other',
      status: 'cancelled',
      topUpPaidAt: { __ts: true },
      topUpRefundedAt: { __ts: true },
    });

    const res = await callDelete({ auth: { uid: UID } });
    expect(res.success).toBe(true);
    expect(holder.authDeleted).toContain(UID);
  });
});
