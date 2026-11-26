import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { createFirestoreMock, type MockFirestore } from './testHelpers/firestoreMock';

const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, block: vi.fn() }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', () => ({ get db() { return h.fs!.db; }, get FieldValue() {
  return { ...h.fs!.FieldValue, serverTimestamp: () => Timestamp.now() };
} }));
vi.mock('./financialRecoverySources', () => ({
  financialRecoverySourceFields: async (_kind: unknown, _ref: unknown, _current: unknown, patch: unknown) => patch,
  financialRecoveryWalletFields: async (_kind: unknown, _ref: unknown, _current: unknown, patch: unknown) => patch,
  financialRecoveryCommitCheckpoint: () => async () => {},
}));
vi.mock('./notifications', () => ({ prepareOperationalNotices: async () => ({ commit() {} }) }));
vi.mock('./payoutOutcome', async original => ({ ...await original<any>(), markWithdrawalReconciliation: (...args: unknown[]) => h.block(...args) }));
import { observeWithdrawalPayout } from './payoutRecovery';

const requestId = 'wr_test', path = `withdrawal_requests/${requestId}`;
const operatorPath = 'failed_operations/withdrawal_' + createHash('sha256').update(requestId).digest('hex');
const instant = Timestamp.fromMillis(Date.now() - 30_000), hash = 'a'.repeat(64);
function seed(payoutId: string | null = 'po_paid1') {
  const intent = { schemaVersion: 1, ownerId: 'seller1', withdrawalRequestId: requestId, clientRequestId: 'client1',
    amountCents: 1700, currency: 'CAD', accountId: 'acct_seller1', bankAccountId: 'ba_test1', debitLedgerId: 'debit1',
    transferKey: 'tr_debit1', payoutKey: 'po_debit1', payloadHash: hash, committedAt: instant };
  const data = { userId: 'seller1', amount: 1700, currency: 'cad', status: 'processing', createdAt: instant,
    stripeAccountId: 'acct_seller1', stripeTransferId: 'tr_test1', stripePayoutId: payoutId, ledgerEntryId: 'debit1',
    payoutDestination: { schemaVersion: 1, accountId: 'acct_seller1', bankAccountId: 'ba_test1', country: 'CA', currency: 'CAD' },
    withdrawalIntent: intent, transferOutcome: 'created', payoutOutcome: 'pending',
    providerSubmission: { schemaVersion: 1, ownerId: 'seller1', withdrawalRequestId: requestId, amountCents: 1700,
      currency: 'CAD', accountId: 'acct_seller1', bankAccountId: 'ba_test1', debitLedgerId: 'debit1', payloadHash: hash,
      transfer: { state: 'created', providerId: 'tr_test1', authorizedAt: instant, observedAt: instant },
      payout: { state: payoutId ? 'created' : 'requested', providerId: payoutId, authorizedAt: instant, observedAt: payoutId ? instant : null } } };
  fs.setDoc(path, data);
  fs.setDoc('wallets/seller1', { userId: 'seller1', balance: 0, currency: 'CAD', status: 'active' });
  fs.setDoc('wallets/seller1/ledger/debit1', { type: 'withdrawal', amount: 1700, currency: 'CAD', balanceAfter: 0,
    withdrawalRequestId: requestId, clientRequestId: 'client1', withdrawalIntentHash: hash, createdAt: instant });
  return data;
}
function payout(status = 'paid') { return { id: 'po_paid1', object: 'payout', status, amount: 1700, currency: 'cad',
  destination: 'ba_test1', method: 'standard', metadata: { firebaseUserId: 'seller1', withdrawalRequestId: requestId } }; }
function provider(options: { onList?: () => void; onRetrieve?: () => void; payoutStatus?: string; reversed?: boolean } = {}) {
  const post = vi.fn(() => { throw new Error('Observer must never mutate Stripe'); });
  const stripe = { payouts: { list: vi.fn(async () => { options.onList?.(); return { data: [payout(options.payoutStatus)], has_more: false }; }),
    retrieve: vi.fn(async () => { options.onRetrieve?.(); return payout(options.payoutStatus); }), create: post },
    transfers: { retrieve: vi.fn(async () => ({ id: 'tr_test1', object: 'transfer', amount: 1700, currency: 'cad',
      destination: 'acct_seller1', amount_reversed: options.reversed ? 1700 : 0, reversed: options.reversed === true,
      metadata: { firebaseUserId: 'seller1', withdrawalRequestId: requestId } })), create: post, createReversal: post } };
  return { stripe, post };
}
function hold(patch: Record<string, unknown> = {}) {
  fs.setDoc(path, { ...fs.getDoc(path), reconciliationRequired: true, reconciliationReason: 'payout_changed_during_recovery', ...patch });
  fs.setDoc(operatorPath, { type: 'payout_reversal_failed', refId: requestId, status: 'pending', actionRequired: true,
    error: 'payout_changed_during_recovery', payload: { kind: 'payout_identity_reconciliation', evidence: { payoutId: 'po_paid1' } } });
}
beforeEach(() => { fs.reset(); h.block.mockReset(); });

describe('current native payout completion', () => {
  it('accepts the submitter learning exactly the qualified payout ID during the webhook GET', async () => {
    const initial = seed(null);
    const { stripe, post } = provider({ onList() {
      fs.setDoc(path, { ...initial, stripePayoutId: 'po_paid1', providerSubmission: { ...initial.providerSubmission,
        payout: { ...initial.providerSubmission.payout, state: 'created', providerId: 'po_paid1', observedAt: instant } } });
    } });
    expect(await observeWithdrawalPayout(requestId, stripe as never, 'po_paid1')).toMatchObject({ state: 'paid', completedNow: true });
    expect(fs.getDoc(path)).toMatchObject({ status: 'completed', reconciliationRequired: false,
      payoutCompletion: { payoutId: 'po_paid1', debitLedgerId: 'debit1' } });
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(0);
    expect(fs.writeOps.every(op => !op.path.startsWith('wallets/'))).toBe(true);
    expect(post).not.toHaveBeenCalled(); expect(h.block).not.toHaveBeenCalled();
  });
  it.each([
    ['payout', { stripePayoutId: 'po_other' }], ['owner', { userId: 'other' }], ['amount', { amount: 1701 }],
    ['account', { stripeAccountId: 'acct_other' }], ['transfer', { stripeTransferId: 'tr_other' }],
    ['debit', { ledgerEntryId: 'other' }], ['bank', { payoutDestination: { schemaVersion: 1, bankAccountId: 'ba_other' } }],
    ['intention', { withdrawalIntent: { schemaVersion: 1, payloadHash: 'b'.repeat(64) } }],
  ])('does not tolerate a concurrent change of %s', async (_name, patch) => {
    const initial = seed(null);
    const { stripe, post } = provider({ onList() { fs.setDoc(path, { ...initial, stripePayoutId: 'po_paid1', ...patch }); } });
    expect(await observeWithdrawalPayout(requestId, stripe as never)).toMatchObject({ state: 'reconciliation_required' });
    expect(fs.getDoc(path)!.status).toBe('processing');
    expect(h.block).toHaveBeenCalledWith(requestId, 'payout_changed_during_recovery', { payoutId: 'po_paid1' });
    expect(post).not.toHaveBeenCalled();
  });
  it('requalifies an old CAS hold using current native GETs and original debit, without a provider POST', async () => {
    seed(); hold(); const { stripe, post } = provider();
    expect(await observeWithdrawalPayout(requestId, stripe as never, 'po_paid1')).toMatchObject({ state: 'paid', completedNow: true });
    expect(fs.getDoc(operatorPath)).toMatchObject({ status: 'resolved', actionRequired: false,
      resolution: { qualification: 'current_native_payout_transfer_and_original_debit', providerMutationSubmitted: false,
        payoutId: 'po_paid1', transferId: 'tr_test1', debitLedgerId: 'debit1' } });
    expect(fs.getDoc(path)!.status).toBe('completed'); expect(post).not.toHaveBeenCalled();
  });
  it.each(['payout_identity_conflict', 'payout_candidate_conflict', 'payout_paid_after_compensation', 'payout_paid_after_failed_status'])
    ('preserves the independent %s identity hold without contacting Stripe', async reason => {
      seed(); hold({ reconciliationReason: reason }); const { stripe, post } = provider();
      expect(await observeWithdrawalPayout(requestId, stripe as never)).toMatchObject({ state: 'reconciliation_required' });
      expect(stripe.payouts.retrieve).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
    });
  it.each(['pending', 'failed', 'canceled'])('does not clear the old hold or compensate on native %s', async payoutStatus => {
    seed(); hold(); const { stripe, post } = provider({ payoutStatus });
    expect(await observeWithdrawalPayout(requestId, stripe as never)).toMatchObject({ state: 'reconciliation_required' });
    expect(fs.getDoc(path)!.status).toBe('processing'); expect(post).not.toHaveBeenCalled();
  });
  it('keeps a paid payout with an existing compensation in review', async () => {
    seed(); hold(); fs.setDoc('wallets/seller1/ledger/credit1', { type: 'withdrawal_failed', amount: 1700,
      currency: 'CAD', balanceAfter: 1700, withdrawalRequestId: requestId, createdAt: instant });
    const { stripe, post } = provider();
    expect(await observeWithdrawalPayout(requestId, stripe as never)).toMatchObject({ state: 'reconciliation_required' });
    expect(fs.getDoc(path)!.status).toBe('processing');
    expect(h.block).toHaveBeenCalledWith(requestId, 'payout_paid_after_compensation', { payoutId: 'po_paid1' });
    expect(post).not.toHaveBeenCalled();
  });
  it('does not reopen an old hold without its exact private operator witness', async () => {
    seed(); hold(); fs.setDoc(operatorPath, null); const { stripe } = provider();
    expect(await observeWithdrawalPayout(requestId, stripe as never)).toMatchObject({ state: 'reconciliation_required' });
    expect(stripe.payouts.retrieve).not.toHaveBeenCalled();
  });
  it('does not clear another hold that appears while native GETs are in flight', async () => {
    seed(); hold(); const { stripe } = provider({ onRetrieve() {
      fs.setDoc(path, { ...fs.getDoc(path), reconciliationReason: 'payout_identity_conflict' });
    } });
    expect(await observeWithdrawalPayout(requestId, stripe as never)).toMatchObject({ state: 'reconciliation_required' });
    expect(fs.getDoc(path)!.status).toBe('processing');
    expect(fs.getDoc(operatorPath)!.status).toBe('pending');
    expect(h.block).not.toHaveBeenCalled();
  });
  it('preserves the original hold and witness when a fresh native proof is unavailable', async () => {
    seed(); hold(); const { stripe } = provider();
    stripe.payouts.retrieve.mockRejectedValueOnce(new Error('Provider timeout'));
    expect(await observeWithdrawalPayout(requestId, stripe as never)).toMatchObject({ state: 'reconciliation_required' });
    expect(h.block).not.toHaveBeenCalled();
    expect(fs.getDoc(operatorPath)!.error).toBe('payout_changed_during_recovery');
  });
});
