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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  authDeleted: [] as string[],
  stripe: null as Record<string, unknown> | null,
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
  getStripe: () => holder.stripe,
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
  auth?: { uid: string; token: { auth_time?: number; firebase: { sign_in_provider: string } } } | null;
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
  holder.stripe = null;
  process.env.STRIPE_SECRET_KEY = 'sk_test';
});

describe('deleteUserAccount — native withdrawal non-execution qualification', () => {
  const input = {expectedUid: UID, requestId: 'closure_native_refusal_001', amount: 2000, expectedBankAccountId: 'ba_original'};
  const ownerAuth = () => ({uid: UID, token: {auth_time: Math.floor(Date.now() / 1000), firebase: {sign_in_provider: 'password'}}});
  let withdraw: CallableHandler;
  beforeEach(async () => {
    vi.stubEnv('PAYMENTS_ENABLED', 'true');
    // Isolate the bank GET boundary. The withdrawal callable itself produces
    // the native refusal and its private proof; no hand-made positive receipt.
    holder.stripe = {};
    const stripeBank = await import('../utils/stripeBank');
    vi.spyOn(stripeBank, 'qualifyWithdrawalBank').mockResolvedValue({destination: {accountId: 'acct_original',
      bankAccountId: input.expectedBankAccountId, country: 'CA', currency: 'CAD', payoutMethod: 'standard', last4: '4242'},
      selectionIdentity: 'qualified_for_this_test'} as Awaited<ReturnType<typeof stripeBank.qualifyWithdrawalBank>>);
    withdraw = (await import('./wallet')).walletWithdraw as unknown as CallableHandler;
  });
  afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});
  async function nativeRefusal() {
    seedCleanAccount();
    // The unknown preflight is still a proved refusal: the server commits it
    // before authorizing any debit or provider POST.
    const result = await withdraw({auth: ownerAuth(), data: input});
    expect(result).toMatchObject({status: 'not_executed', debitCommitted: false, nonExecutionReceiptQualified: true});
    const ref = `withdrawal_requests/${result.withdrawalRequestId}`;
    expect(fs.writeOps.filter(op => op.path.startsWith(`wallets/${UID}`))).toHaveLength(0);
    const replay = await withdraw({auth: ownerAuth(), data: {...input, mode: 'observe'}});
    expect(replay).toMatchObject({status: 'not_executed', replay: true, nonExecutionReceiptQualified: true});
    return ref;
  }
  it('does not invent an unsettled payout for the exact native refusal, while destructive erasure remains closed', async () => {
    const ref = await nativeRefusal(), receipt = fs.getDoc(ref);
    const result = await callDelete({auth: ownerAuth()});
    expect(result.blockers).not.toContain('withdrawal_unsettled');
    expect(result.blockers).toContain('external_erasure_retention_review_required');
    expect(result.deletionComplete).toBe(false);
    expect(fs.getDoc(ref)).toEqual(receipt);
    expect(holder.authDeleted).toHaveLength(0);
  });
  it.each(['missing_private_proof', 'contradictory_debit', 'contradictory_provider'] as const)(
    'keeps an unqualified refusal blocking: %s', async contradiction => {
      const ref = await nativeRefusal(), record = fs.getDoc(ref)!;
      if (contradiction === 'missing_private_proof') fs.setDoc(`${ref}/private_preflight/observation`, null);
      if (contradiction === 'contradictory_debit') fs.setDoc(`wallets/${UID}/ledger/withdrawal_${ref.split('/')[1].slice(3)}`, {type: 'withdrawal', amount: input.amount});
      if (contradiction === 'contradictory_provider') fs.setDoc(ref, {...record, stripePayoutId: 'po_contradictory'});
      const result = await callDelete({auth: ownerAuth()});
      expect(result.blockers).toContain('withdrawal_unsettled');
      expect(result.deletionComplete).toBe(false);
      expect(holder.authDeleted).toHaveLength(0);
    });
  it('keeps independent privacy preservation even when non-execution is qualified', async () => {
    await nativeRefusal();
    fs.setDoc(`privacy_retention_guards/${UID}`, {protocol: 'privacy_retention_guard_v1', ownerId: UID, version: 1,
      recordedAt: Timestamp.now(), legacyCoverage: 'bounded_complete', releaseAuthorized: false,
      protection: {allPersonalData: true, categories: {}}});
    const result = await callDelete({auth: ownerAuth()});
    expect(result.blockers).not.toContain('withdrawal_unsettled');
    expect(result.blockers).toContain('privacy_retention_review_required');
    expect(result.deletionComplete).toBe(false);
    expect(holder.authDeleted).toHaveLength(0);
  });
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

    const res = await callDelete({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } } });
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

    await expect(callDelete({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } } })).rejects.toMatchObject({
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

    await expect(callDelete({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } } })).rejects.toMatchObject({
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

    const res = await callDelete({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } } });
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

    await expect(callDelete({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } } })).rejects.toMatchObject({
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

    await expect(callDelete({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } } })).rejects.toMatchObject({
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

    const res = await callDelete({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } } });
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

    const res = await callDelete({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } } });
    expect(res.success).toBe(true);
    expect(holder.authDeleted).toContain(UID);
  });
});

// ===========================================================================
// Signalement d'absence — ne bloque plus l'effacement
//
// Une rencontre est un échange comptant : aucun argent sur la plateforme, donc
// rien à protéger. Ouvrir un tel litige coûtait un clic à n'importe qui et
// bloquait indéfiniment le droit à l'effacement de sa cible. Les litiges à
// exposition financière continuent de bloquer.
// ===========================================================================

describe("deleteUserAccount — un no-show de rencontre ne bloque plus", () => {
  it('autorise la suppression malgré un litige meetup_no_show ouvert', async () => {
    seedCleanAccount();
    fs.setDoc('disputes/d1', {
      transactionId: 'tx1',
      type: 'meetup_no_show',
      buyerId: 'other',
      sellerId: UID,
      status: 'open',
      details: 'récit libre à purger',
    });
    fs.setDoc('transactions/tx1', {
      buyerId: 'other',
      sellerId: UID,
      deliveryType: 'meetup',
      status: 'disputed',
    });

    const res = await callDelete({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: UID } });
    expect(res.success).toBe(true);
    expect(holder.authDeleted).toContain(UID);
  });

  it('anonymise le dossier et efface le récit libre', async () => {
    seedCleanAccount();
    fs.setDoc('disputes/d1', {
      transactionId: 'tx1',
      type: 'meetup_no_show',
      buyerId: 'other',
      sellerId: UID,
      reportedBy: 'other',
      reportedAgainst: UID,
      status: 'open',
      details: 'il ne s’est pas présenté au métro Berri',
    });
    fs.setDoc('transactions/tx1', {
      buyerId: 'other',
      sellerId: UID,
      deliveryType: 'meetup',
      status: 'disputed',
    });

    await callDelete({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: UID } });

    const dispute = fs.getDoc('disputes/d1') as any;
    expect(dispute.details).toBeUndefined();
    expect(dispute.sellerId).not.toBe(UID);
    expect(dispute.reportedAgainst).not.toBe(UID);
    // Le squelette d'audit survit.
    expect(dispute.type).toBe('meetup_no_show');
    expect(dispute.transactionId).toBe('tx1');
    // La partie survivante n'est jamais touchée.
    expect(dispute.buyerId).toBe('other');
  });

  it('BLOQUE toujours sur un litige à exposition financière', async () => {
    seedCleanAccount();
    fs.setDoc('disputes/d1', {
      transactionId: 'tx1',
      type: 'return_not_delivered',
      buyerId: UID,
      sellerId: 'other',
      status: 'open',
    });

    await expect(callDelete({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: UID } })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });
});

describe('deleteUserAccount — independent financial obligations before anonymization', () => {
  it.each([
    { status: 'refunded', refundBlocked: true },
    { status: 'completed', refund: { state: 'pending', intentId: 'intent' } },
    { status: 'refunded', refund: { state: 'failed', fundsAppliedAt: new Date(), outstandingCardCents: 4000 } },
    { status: 'completed', bankDispute: { id: 'du', state: 'open' } },
    { status: 'refunded', bankDispute: { id: 'du', state: 'closed', outcome: 'won', closedAt: new Date(), reconciliationRequired: true } },
    { status: 'meetup_completed', refundBlocked: true },
  ])('blocks terminal-looking financial obligation %j and keeps recovery identities/ledger', async data => {
    seedCleanAccount();
    fs.setDoc('transactions/financial', { buyerId: UID, sellerId: 'seller', stripePaymentIntentId: 'pi_keep', ...data });
    fs.setDoc('wallets/' + UID + '/ledger/payment', { type: 'purchase_debit', amount: 4000, transactionId: 'financial' });
    await expect(callDelete({ auth: { uid: UID, token: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(holder.authDeleted).toHaveLength(0); expect(fs.writeOps).toHaveLength(0);
    expect(fs.getDoc('transactions/financial')!.stripePaymentIntentId).toBe('pi_keep');
    expect(fs.getDoc('wallets/' + UID + '/ledger/payment')).toBeDefined();
  });
});
