import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
import type {MockFirestore} from './testHelpers/firestoreMock';

// Exercise the real bank engine and wallet callable. Only persistence/provider
// IO, private session admission and the external recovery permit are replaced.
const h = vi.hoisted(() => ({fs: null as MockFirestore | null, banks: [] as any[],
  retrieve: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), transfer: vi.fn(), payout: vi.fn(), errors: vi.fn(), diagnostics: vi.fn()}));
vi.mock('../config/firebase', async () => {
  const {Timestamp: NativeTimestamp} = await import('firebase-admin/firestore');
  const {createFirestoreMock: create} = await import('./testHelpers/firestoreMock');
  h.fs ??= create({enforceReadBeforeWrite: true});
  return {get db() {return h.fs!.db;}, get FieldValue() {return {...h.fs!.FieldValue, serverTimestamp: () => NativeTimestamp.now()};}};
});
vi.mock('../config/stripe', () => ({getStripe: () => ({accounts: {retrieve: h.retrieve, listExternalAccounts: h.list,
  retrieveExternalAccount: async (_account: string, id: string) => h.banks.find(bank => bank.id === id),
  createExternalAccount: h.create, updateExternalAccount: h.update, deleteExternalAccount: h.remove}, transfers: {create: h.transfer}, payouts: {create: h.payout}})}));
vi.mock('./financialRecoveryInterlock', () => ({FinancialRecoveryBlocked: class extends Error {},
  withFinancialRecoveryScope: (_scope: unknown, run: () => unknown) => run()}));
vi.mock('./financialRecoverySources', () => ({
  financialRecoverySourceFields: async (_family: unknown, _ref: unknown, _before: unknown, patch: unknown) => patch,
  financialRecoveryWalletFields: async (_ref: unknown, _before: unknown, patch: unknown) => patch,
  financialRecoveryCommitCheckpoint: () => async () => {}, prepareFinancialRecoverySource: async () => {},
}));
vi.mock('./privateAccountSession', () => ({withPrivateAccountSession: (_request: unknown, run: () => unknown) => run(),
  assertPrivateAccountSession: async () => {}}));
vi.mock('../config/featureFlags', () => ({assertNewPaymentsEnabled() {}, assertNewBusinessAdmission: async () => {}}));
vi.mock('./platformCashPreflight', () => ({observePlatformCash: async () => ({qualification: 'available'}),
  platformCashObservationHash: () => 'a'.repeat(64), platformCashRefusalMessage: () => 'Unavailable'}));
vi.mock('./rateLimit', () => ({checkRateLimit: async () => {}, resolveCallerKey: () => ({callerKey: 'member', isAuthenticated: true})}));
vi.mock('../lib/analytics', () => ({captureServerEvent: async () => {}}));
vi.mock('firebase-functions/logger', () => ({info() {}, warn: h.diagnostics, error: h.errors}));

import {manageBankAccount, ownerBankInventory} from './stripeBank';
import {walletWithdraw} from '../callable/wallet';
import {BANK_OWNERSHIP_STATEMENT, BANK_OWNERSHIP_STATEMENT_VERSION} from '../shared/bankConsent';

const fs = h.fs!;

const uid = 'member', accountId = 'acct_member', currentId = 'ba_current', oldId = 'ba_old';
const account = () => ({id: accountId, type: 'custom', country: 'CA', business_type: 'individual', metadata: {firebaseUserId: uid},
  payouts_enabled: true, capabilities: {transfers: 'active'}, settings: {payouts: {schedule: {interval: 'manual'}}},
  requirements: {disabled_reason: null, currently_due: [], past_due: [], pending_verification: []}});
const bank = (id: string, extra: Record<string, unknown> = {}) => ({id, account: accountId, object: 'bank_account', country: 'CA',
  currency: 'cad', last4: id === currentId ? '4242' : '1234', bank_name: 'Banque Test', status: 'verified', default_for_currency: id === currentId,
  ...extra});
const declaration = () => ({accountHolderName: 'Membre Test', accepted: true, statementVersion: BANK_OWNERSHIP_STATEMENT_VERSION,
  statement: BANK_OWNERSHIP_STATEMENT, ownershipVerified: false, proofType: 'explicit_checkbox', authTime: Math.floor(Date.now()/1000)-30,
  acceptedAt: Timestamp.now(), acceptedAtMs: Date.now()});
const token = () => ({auth_time: Math.floor(Date.now()/1000)-15});
const mutation = (mode: 'select_existing' | 'delete_existing', target = oldId, rest: Record<string, unknown> = {}) =>
  manageBankAccount(uid, {expectedUid: uid, requestId: 'request_1', mode, bankAccountId: target, ...rest},
    {accounts: {retrieve: h.retrieve, listExternalAccounts: h.list, updateExternalAccount: h.update, deleteExternalAccount: h.remove}} as any, token());
const resume = (requestId = 'request_1') => manageBankAccount(uid, {expectedUid: uid, requestId},
  {accounts: {retrieve: h.retrieve, listExternalAccounts: h.list, updateExternalAccount: h.update, deleteExternalAccount: h.remove}} as any, token());
const replace = () => manageBankAccount(uid, {expectedUid: uid, requestId: 'replace_request', mode: 'replace',
  accountHolderName: 'Membre Test', bankOwnershipAccepted: true, bankOwnershipStatementVersion: BANK_OWNERSHIP_STATEMENT_VERSION,
  transitNumber: '11000', institutionNumber: '000', accountNumber: '000111111116'},
  {accounts: {retrieve: h.retrieve, listExternalAccounts: h.list, createExternalAccount: h.create, updateExternalAccount: h.update}} as any, token());
const inventory = () => ownerBankInventory(uid, account(), {accounts: {listExternalAccounts: h.list}} as any);
const withdraw = () => walletWithdraw.run({auth: {uid, token: token()}, data: {expectedUid: uid, requestId: 'withdrawal_request_1',
  amount: 2000, expectedBankAccountId: currentId}, acceptsStreaming: false} as any);

beforeEach(() => {
  fs.reset(); vi.clearAllMocks();
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_bank_management');
  h.banks = [bank(currentId), bank(oldId)];
  h.retrieve.mockImplementation(async () => account());
  h.list.mockImplementation(async () => ({data: h.banks.map(value => ({...value})), has_more: false}));
  h.create.mockImplementation(async (_account, params) => {
    const candidate = bank('ba_candidate', {last4: '1116', default_for_currency: false, metadata: params.metadata});
    h.banks.push(candidate); return candidate;
  });
  h.update.mockImplementation(async (_account, id) => {
    h.banks = h.banks.map(value => ({...value, default_for_currency: value.id === id}));
    return h.banks.find(value => value.id === id);
  });
  h.remove.mockImplementation(async (_account, id) => {h.banks = h.banks.filter(value => value.id !== id); return {id, deleted: true};});
  h.transfer.mockImplementation(async (params: any) => ({...params, id: 'tr_member', object: 'transfer'}));
  h.payout.mockImplementation(async (params: any) => ({...params, id: 'po_member', object: 'payout', status: 'pending'}));
  fs.setDoc('users/'+uid, {stripeAccountId: accountId, isActive: true});
  fs.setDoc('wallets/'+uid, {balance: 5000, heldBalance: 0, pendingBalance: 0, sellerDebt: 0, status: 'active', currency: 'CAD'});
  fs.setDoc('eligibility_profiles/'+uid, {connectOperation: {id: 'connect_1', state: 'linked', providerId: accountId, bankDeclaration: declaration()},
    selectedBank: {schemaVersion: 1, accountId, bankAccountId: currentId, source: 'connect_creation_declaration', operationId: 'connect_1', observedAtMs: Date.now()}});
});
afterEach(() => vi.unstubAllEnvs());

describe('Owner bank inventory and mutations', () => {
  it('omits explicit default false when creating a bank, then selects it separately', async () => {
    h.banks = [bank(currentId)];
    expect(await replace()).toMatchObject({success: true, bankAccountId: 'ba_candidate'});
    expect(h.create.mock.calls[0][1]).not.toHaveProperty('default_for_currency');
    expect(h.update).toHaveBeenCalledWith(accountId, 'ba_candidate', {default_for_currency: true}, expect.anything());
    expect(h.banks.map(value => value.id)).toEqual([currentId, 'ba_candidate']);
    expect(fs.getDoc('eligibility_profiles/'+uid)?.selectedBank).toMatchObject({bankAccountId: 'ba_candidate'});
  });
  it('keeps only safe provider diagnostics, never raw messages or bank coordinates', async () => {
    h.create.mockRejectedValueOnce({type: 'StripeInvalidRequestError', rawType: 'invalid_request_error', statusCode: 400,
      param: 'default_for_currency', requestId: 'req_safe123', code: 'unrecognized_code_000111111116',
      message: 'SENSITIVE bank 000111111116 Membre Test', raw: {account_number: '000111111116', routing_number: '11000-000'}});
    expect(await replace()).toMatchObject({success: false, operationState: 'rejected'});
    expect(h.diagnostics).toHaveBeenCalledWith('Bank provider operation failed', expect.objectContaining({providerType: 'StripeInvalidRequestError',
      providerRawType: 'invalid_request_error', providerCode: null, providerParam: 'default_for_currency', providerRequestId: 'req_safe123', providerHttpStatus: 400}));
    expect(JSON.stringify(h.diagnostics.mock.calls)).not.toMatch(/SENSITIVE|000111111116|11000-000|Membre Test/);
  });
  it('paginates the provider inventory and returns only masked verified identities', async () => {
    h.list.mockImplementation(async (_account, params) => params.starting_after ? {data: [bank(oldId)], has_more: false} :
      {data: [bank(currentId)], has_more: true});
    const result = await inventory();
    expect(h.list.mock.calls[1][1].starting_after).toBe(currentId);
    expect(result.bankAccounts).toHaveLength(2);
    expect(result.bankAccounts[0]).toMatchObject({id: currentId, isDefault: true, isSelected: true, canDelete: false});
    expect(result.bankAccounts[1]).toMatchObject({id: oldId, canDelete: true, canSelect: true, selectionDeclarationRequired: true});
    expect(JSON.stringify(result)).not.toMatch(/routing_number|account_number|accountHolderName/);
  });
  it('refuses incomplete pages and a foreign bank instead of manufacturing an inventory', async () => {
    h.list.mockResolvedValueOnce({data: [], has_more: true});
    await expect(inventory()).rejects.toMatchObject({code: 'failed-precondition'});
    h.banks[1].account = 'acct_other';
    await expect(inventory()).rejects.toMatchObject({code: 'failed-precondition'});
    await expect(mutation('delete_existing')).rejects.toMatchObject({code: 'failed-precondition'});
    expect(h.remove).not.toHaveBeenCalled();
  });
  it('preserves current and default banks; an inactive old bank can be deleted', async () => {
    await expect(mutation('delete_existing', currentId)).rejects.toMatchObject({details: {reason: 'bank_selected_protected'}});
    h.banks[0].default_for_currency = false; h.banks[1].default_for_currency = true;
    await expect(mutation('delete_existing')).rejects.toMatchObject({details: {reason: 'bank_default_protected'}});
    h.banks[1].default_for_currency = false; h.banks[1].status = 'errored';
    expect((await inventory()).bankAccounts[1]).toMatchObject({canSelect: false, canDelete: true});
    expect(await mutation('delete_existing')).toMatchObject({success: true, operationState: 'completed', mode: 'delete_existing'});
    expect(fs.getDoc('eligibility_profiles/'+uid)?.selectedBank).toMatchObject({bankAccountId: currentId});
    expect(fs.getDoc('users/'+uid)?.stripeAccountId).toBe(accountId);
  });
  it('requires a declaration for this exact bank; another bank declaration is not borrowed', async () => {
    await expect(mutation('select_existing', oldId, {accountHolderName: 'Membre Test'})).rejects.toMatchObject({details: {reason: 'bank_ownership_declaration_required'}});
    expect(h.update).not.toHaveBeenCalled();
    expect(await mutation('select_existing', oldId, {accountHolderName: 'Membre Test', bankOwnershipAccepted: true,
      bankOwnershipStatementVersion: BANK_OWNERSHIP_STATEMENT_VERSION})).toMatchObject({success: true, bankAccountId: oldId});
    expect(fs.getDoc('eligibility_profiles/'+uid)?.selectedBank).toMatchObject({bankAccountId: oldId, declared: true});
  });
  it('reuses only the native completed declaration bound to the same bank and owner', async () => {
    const nativeId = 'bank_'+'b'.repeat(64);
    h.banks[1].metadata = {firebaseUserId: uid, secondBankOperationId: nativeId};
    fs.setDoc('eligibility_audit/'+nativeId, {action: 'account_bank_operation', schemaVersion: 1, ownerId: uid, id: nativeId,
      mode: 'replace', accountId, bankAccountId: oldId, state: 'completed', declaration: declaration()});
    expect((await inventory()).bankAccounts[1].selectionDeclarationRequired).toBe(false);
    expect(await mutation('select_existing')).toMatchObject({success: true});
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(await resume()).toMatchObject({success: true});
    expect(h.update).toHaveBeenCalledTimes(1);
  });
  it('declares the exact native selection when it differs from the provider default', async () => {
    h.banks[0].default_for_currency = false; h.banks[1].default_for_currency = true;
    fs.setDoc('eligibility_profiles/'+uid, {selectedBank: {schemaVersion: 1, accountId, bankAccountId: currentId,
      source: 'legacy', operationId: 'legacy_source', observedAtMs: Date.now()}});
    const result = await manageBankAccount(uid, {expectedUid: uid, requestId: 'declaration_exact', mode: 'declare_current',
      bankAccountId: currentId, accountHolderName: 'Membre Test', bankOwnershipAccepted: true,
      bankOwnershipStatementVersion: BANK_OWNERSHIP_STATEMENT_VERSION},
      {accounts: {retrieve: h.retrieve, listExternalAccounts: h.list}} as any, token());
    expect(result).toMatchObject({success: true, bankAccountId: currentId});
    expect(fs.getDoc('eligibility_profiles/'+uid)?.selectedBank).toMatchObject({bankAccountId: currentId, declared: true});
    expect(h.update).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
  });
  it('observes a lost DELETE response without re-sending it or altering the current bank', async () => {
    h.remove.mockImplementationOnce(async (_account, id) => {h.banks = h.banks.filter(value => value.id !== id); throw new Error('connection lost');});
    expect(await mutation('delete_existing')).toMatchObject({success: false, operationState: 'deletion_unknown'});
    expect(await resume()).toMatchObject({success: true, operationState: 'completed'});
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect(fs.getDoc('eligibility_profiles/'+uid)?.selectedBank).toMatchObject({bankAccountId: currentId});
    expect(fs.getDoc('wallets/'+uid)?.balance).toBe(5000);
  });
  it('keeps an unobserved DELETE unknown and never treats a still-attached bank as deleted', async () => {
    h.remove.mockRejectedValueOnce(new Error('connection lost'));
    await mutation('delete_existing');
    expect(await resume()).toMatchObject({success: false, operationState: 'deletion_unknown'});
    expect(h.remove).toHaveBeenCalledTimes(1);
    expect((await inventory()).bankAccounts).toContainEqual(expect.objectContaining({id: oldId, canDelete: false}));
  });
  it('observes a lost default-selection response without a second provider mutation', async () => {
    h.update.mockImplementationOnce(async (_account, id) => {
      h.banks = h.banks.map(value => ({...value, default_for_currency: value.id === id}));
      throw new Error('connection lost');
    });
    expect(await mutation('select_existing', oldId, {accountHolderName: 'Membre Test', bankOwnershipAccepted: true,
      bankOwnershipStatementVersion: BANK_OWNERSHIP_STATEMENT_VERSION})).toMatchObject({success: false, operationState: 'selection_unknown'});
    expect(await resume()).toMatchObject({success: true, bankAccountId: oldId});
    expect(h.update).toHaveBeenCalledTimes(1);
  });
  it('refuses stale authentication and pending withdrawals before a provider mutation', async () => {
    await expect(manageBankAccount(uid, {expectedUid: uid, requestId: 'old_auth', mode: 'delete_existing', bankAccountId: oldId},
      {} as any, {auth_time: 1})).rejects.toMatchObject({code: 'unauthenticated'});
    fs.setDoc('withdrawal_requests/other', {userId: uid, status: 'processing', payoutDestination: {bankAccountId: currentId}});
    await expect(mutation('delete_existing')).rejects.toMatchObject({details: {reason: 'bank_withdrawal_in_progress'}});
    expect(h.remove).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled();
  });
});

describe('Shared bank / withdrawal serialization with the actual wallet callable', () => {
  it('does not reserve funds when a bank mutation already owns the shared profile', async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;});
    const held = new Promise<void>(resolve => {release = resolve;});
    h.remove.mockImplementationOnce(async (_account, id) => {entered(); await held; h.banks = h.banks.filter(value => value.id !== id); return {id, deleted: true};});
    const changing = mutation('delete_existing'); await started;
    await expect(withdraw()).rejects.toMatchObject({details: {reason: 'bank_operation_in_progress'}});
    expect(fs.getDoc('wallets/'+uid)?.balance).toBe(5000); expect(h.transfer).not.toHaveBeenCalled();
    release(); expect(await changing).toMatchObject({success: true});
  });
  it('does not change a bank after a withdrawal reservation/authorization wins first', async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;});
    const held = new Promise<void>(resolve => {release = resolve;});
    h.transfer.mockImplementationOnce(async (params: any) => {entered(); await held; return {...params, id: 'tr_member', object: 'transfer'};});
    const withdrawing = withdraw();
    await Promise.race([started, withdrawing.then(() => {throw new Error('Withdrawal finished before provider gate');})]);
    expect(fs.getDoc('wallets/'+uid)?.balance).toBe(3000);
    expect(fs.getDoc('eligibility_profiles/'+uid)?.bankWithdrawalRevision).toBeGreaterThanOrEqual(2);
    await expect(mutation('delete_existing')).rejects.toMatchObject({details: {reason: 'bank_withdrawal_in_progress'}});
    expect(h.remove).not.toHaveBeenCalled();
    release(); expect(await withdrawing).toMatchObject({intentCommitted: true, transferId: 'tr_member', payoutId: 'po_member'});
    expect(fs.getDoc('wallets/'+uid)?.balance).toBe(3000);
  });
});
