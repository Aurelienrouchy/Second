import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from './testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from './testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, stripe: null as StripeMock | null }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true });
const stripe = createStripeMock();
holder.fs = fs; holder.stripe = stripe;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => holder.stripe!.client }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => null }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('./notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('./rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: () => ({ callerKey: 'test', isAuthenticated: true }) }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {}, debug() {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));

import { handleDisputeCreated, handleDisputeClosed } from '../http/stripe/disputes';
import { handleChargeRefunded } from '../http/stripe/refunds';
import { resolveDispute, adminRefundTransaction, cancelPendingTransaction, sellerCancelTransaction } from '../callable/payments/disputes';
import { walletWithdraw, refundWalletPayment, payWithWallet } from '../callable/wallet';
import { requestRefund, requestReturn, reportTransactionProblem } from '../callable/recourse';
import { releaseHeldFunds } from '../scheduled/releaseHeldFunds';
import { issueTransactionRefund } from './refund';
import { hasActiveBankDispute } from './bankDispute';

type Handler = (request: { auth: { uid: string; token: Record<string, unknown> }; data: Record<string, unknown> }) => Promise<unknown>;
const admin = (fn: unknown) => (fn as Handler)({ auth: { uid: 'admin', token: { auth_time: Math.floor(Date.now() / 1000), admin: true } }, data: { expectedUid: 'admin', transactionId: 'sale' } });
const bank = { id: 'du_bank', state: 'open', outcome: null, stripeStatus: 'needs_response', freezeCents: 4500,
  statusBeforeOpen: 'completed', commercialDisputedBeforeOpen: false, openedAt: new Date() };
const event = (status = 'needs_response', id = 'du_bank', amount = 5000) => ({ id, payment_intent: 'pi_sale', status, amount, currency: 'cad', reason: 'fraudulent' });
const sale = () => fs.getDoc('transactions/sale')!;
const seller = () => fs.getDoc('wallets/seller')!;
const equity = () => seller().balance + seller().pendingBalance + seller().heldBalance - seller().sellerDebt;

function seed(extra: Record<string, unknown> = {}) {
  fs.setDoc('transactions/sale', { status: 'completed', sellerId: 'seller', buyerId: 'buyer', deliveryType: 'shipping',
    sellerCreditedCents: 4500, sellerPendingCreditCents: 4500, sellerReleasedCents: 4500, sellerPayout: 45,
    paidVia: 'card', totalAmount: 50, stripePaymentIntentId: 'pi_sale', ...extra });
  fs.setDoc('wallets/seller', { balance: 7000, pendingBalance: 0, heldBalance: 0, sellerDebt: 0, status: 'active' });
  fs.setDoc('wallets/buyer', { balance: 300, status: 'active' });
  fs.setDoc('users/seller', { stripeAccountId: 'acct_seller', stripeChargesEnabled: true, stripePayoutsEnabled: true });
}
beforeEach(() => { fs.reset(); stripe.reset(); vi.stubEnv('PAYMENTS_ENABLED', 'true'); });

describe('bank dispute is independent of commercial status', () => {
  it('a resolved historical buyer report never retains the new bank hold', async () => {
    seed({ buyerReport: { reason: 'damaged' }, disputeOutcome: 'dismissed', disputeResolvedAt: new Date(), disputed: false });
    await handleDisputeCreated(event());
    expect(sale().bankDispute.commercialDisputedBeforeOpen).toBe(false);
    await handleDisputeClosed(event('won'));
    expect(sale().status).toBe('completed');
    expect(seller().heldBalance).toBe(0);
    expect(seller().balance).toBe(7000);
  });

  it('a bank case on a held sale never freezes or consumes the other sale pending/balance', async () => {
    seed({ status: 'delivered', sellerReleasedCents: 0, sellerHeldCreditCents: 4500, fundsReleaseAt: new Date() });
    fs.setDoc('transactions/other_pending', { sellerId: 'seller', status: 'paid', sellerCreditedCents: 9000, sellerPendingCreditCents: 9000 });
    fs.setDoc('transactions/other_released', { sellerId: 'seller', status: 'completed', sellerCreditedCents: 7000, sellerReleasedCents: 7000 });
    fs.setDoc('wallets/seller', { balance: 7000, pendingBalance: 9000, heldBalance: 4500, sellerDebt: 0 });
    await handleDisputeCreated(event());
    expect(seller().balance).toBe(7000);
    expect(sale().bankDispute.freezeCents).toBe(0);
    await handleDisputeClosed(event('lost'));
    expect(seller()).toMatchObject({ balance: 7000, pendingBalance: 9000, heldBalance: 0, sellerDebt: 0 });
  });

  it('a released sale loss cannot consume another sale pending/held when funds were withdrawn', async () => {
    seed(); fs.setDoc('wallets/seller', { balance: 0, pendingBalance: 9000, heldBalance: 9000, sellerDebt: 0 });
    await handleDisputeCreated(event());
    await handleDisputeClosed(event('lost'));
    expect(seller()).toMatchObject({ balance: 0, pendingBalance: 9000, heldBalance: 9000, sellerDebt: 4500 });
  });

  it('a pre-delivery sale loss consumes only its own pending credit', async () => {
    seed({ status: 'shipped', sellerReleasedCents: 0 });
    fs.setDoc('wallets/seller', { balance: 0, pendingBalance: 13500, heldBalance: 9000, sellerDebt: 0 });
    await handleDisputeCreated(event()); await handleDisputeClosed(event('lost'));
    expect(seller()).toMatchObject({ balance: 0, pendingBalance: 9000, heldBalance: 9000, sellerDebt: 0 });
  });

  it.each(['disputed', 'return_requested'])('captures bank opening over commercial %s and preserves its context', async status => {
    seed({ status, disputed: true, statusBeforeDispute: 'delivered', disputeReason: 'commercial_reason' });
    await handleDisputeCreated(event());
    expect(sale().bankDispute).toMatchObject({ id: 'du_bank', state: 'open', commercialDisputedBeforeOpen: true });
    expect(sale().status).toBe(status);
    expect(sale().statusBeforeDispute).toBe('delivered');
    expect(sale().disputeReason).toBe('commercial_reason');
    expect(seller().balance).toBe(2500);
    await handleDisputeClosed(event('won'));
    expect(sale().status).toBe(status);
    expect(sale().disputed).toBe(true);
    expect(seller().balance).toBe(2500); // commercial case still reserves the hold
    expect(seller().heldBalance).toBe(4500);
    await admin(resolveDispute);
    expect(sale().status).toBe('delivered');
    expect(seller().balance).toBe(7000);
    expect(seller().heldBalance).toBe(0);
  });

  it.each([resolveDispute, adminRefundTransaction])('refuses admin commercial resolution/refund while bank is active', async fn => {
    seed({ status: 'disputed', disputed: true, disputeId: 'du_bank', bankDispute: bank, disputeFreezeCents: 4500 });
    fs.setDoc('disputes/commercial', { transactionId: 'sale', status: 'open' });
    await expect(admin(fn)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(0);
    expect(stripe.calls.refundsCreate).toHaveLength(0);
  });

  it.each([requestRefund, requestReturn])('buyer financial recourse is refused before any mutation when the bank is active', async fn => {
    seed({ status: 'delivery_failed', bankDispute: bank, disputeId: 'du_bank' });
    await expect((fn as unknown as Handler)({ auth: { uid: 'buyer', token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: 'buyer', transactionId: 'sale', reason: 'damaged' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(0);
    expect(stripe.calls.refundsCreate).toHaveLength(0);
  });

  it.each([requestRefund, requestReturn, payWithWallet])('authorizes the actor before revealing an open bank case', async fn => {
    seed({ status: 'pending_payment', bankDispute: bank, disputeId: 'du_bank' });
    await expect((fn as unknown as Handler)({ auth: { uid: 'third_party', token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: 'third_party', transactionId: 'sale', reason: 'damaged' } })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(fs.writeOps).toHaveLength(0);
  });

  it('commercial evidence can be filed after bank opening and survives a won bank decision', async () => {
    seed({ status: 'delivered', sellerReleasedCents: 0, sellerHeldCreditCents: 4500 });
    await handleDisputeCreated(event());
    await (reportTransactionProblem as unknown as Handler)({ auth: { uid: 'buyer', token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: 'buyer', transactionId: 'sale', reason: 'damaged', details: 'Article endommagé' } });
    expect(sale().bankDispute).toMatchObject({ state: 'open', commercialDisputedBeforeOpen: true });
    expect(sale().statusBeforeDispute).toBe('delivered');
    await handleDisputeClosed(event('won'));
    expect(sale().status).toBe('disputed');
    expect(sale().disputed).toBe(true);
    expect(fs.writeOps.some(op => op.path.startsWith('disputes/') && op.data.status === 'open')).toBe(true);
  });

  it('bank loss leaves commercial review explicit and admin can close it without another refund', async () => {
    seed({ status: 'disputed', disputed: true, statusBeforeDispute: 'delivered' });
    fs.setDoc('disputes/commercial', { transactionId: 'sale', status: 'open' });
    await handleDisputeCreated(event()); await handleDisputeClosed(event('lost'));
    expect(fs.getDoc('disputes/commercial')!.status).toBe('open');
    expect(fs.writeOps.some(op => op.path.startsWith('admin_alerts/') && (op.data.context as Record<string, unknown>)?.reason === 'commercial_after_loss')).toBe(true);
    const before = equity();
    await admin(adminRefundTransaction);
    expect(fs.getDoc('disputes/commercial')).toMatchObject({ status: 'resolved', resolution: 'refunded', resolvedBy: 'admin' });
    expect(stripe.calls.refundsCreate).toHaveLength(0);
    expect(equity()).toBe(before);
  });

  it('refuses the real shared refund core even with stale preData', async () => {
    seed(); const stale = sale();
    fs.setDoc('transactions/sale', { ...stale, bankDispute: bank, disputeId: 'du_bank' });
    await expect(issueTransactionRefund('sale', stale, { idempotencyKey: 'rf_sale' })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripe.calls.refundsCreate).toHaveLength(0);
    expect(fs.writeOps).toHaveLength(0);
  });

  it('refuses settlement if bank opens during the external Stripe call', async () => {
    seed(); const stale = sale();
    stripe.impl.refundsCreate = async (params: any) => { await handleDisputeCreated(event()); return { id: 're_ok', status: 'succeeded', payment_intent: params.payment_intent, currency: 'cad', amount: params.amount, metadata: params.metadata }; };
    expect(await issueTransactionRefund('sale', stale, { idempotencyKey: 'rf_sale' })).toMatchObject({ success: false, status: 'reconciliation_required', actionRequired: true });
    expect(sale().status).toBe('refund_action_required');
    expect(sale().bankDispute.state).toBe('open');
    expect(equity()).toBe(7000);
  });

  it('full bank loss after a refund reservation consumes its own pending credit and preserves other sale escrow', async () => {
    seed({ status: 'delivery_failed', sellerReleasedCents: 0 });
    fs.setDoc('wallets/seller', { balance: 0, pendingBalance: 13500, heldBalance: 9000, sellerDebt: 0 });
    stripe.impl.refundsCreate = async (params: any) => { await handleDisputeCreated(event()); return { id: 're_pending', status: 'pending', payment_intent: params.payment_intent, currency: 'cad', amount: params.amount, metadata: params.metadata }; };
    expect(await (requestRefund as unknown as Handler)({ auth: { uid: 'buyer', token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: 'buyer', transactionId: 'sale' } })).toMatchObject({ success: false, status: 'pending', bankWaiting: true });
    expect(sale().bankDispute.reconciliationRequired).not.toBe(true);
    await handleDisputeClosed(event('lost'));
    expect(seller()).toMatchObject({ pendingBalance: 9000, heldBalance: 9000, sellerDebt: 0 });
  });

  it('blocks release even when disputed flag and lifecycle status changed', async () => {
    seed({ status: 'delivered', disputed: false, bankDispute: bank, disputeId: 'du_bank', sellerHeldCreditCents: 4500,
      fundsReleaseAt: new Date(Date.now() - 1000) });
    fs.setDoc('wallets/seller', { balance: 2500, pendingBalance: 0, heldBalance: 4500, sellerDebt: 0 });
    await (releaseHeldFunds as unknown as () => Promise<void>)();
    expect(seller().balance).toBe(2500);
    expect(sale().fundsReleasedAt).toBeUndefined();
  });

  it('blocks withdrawal for legacy bank identity even if disputed was cleared', async () => {
    seed({ disputed: false, disputeId: 'du_legacy' });
    await expect((walletWithdraw as unknown as Handler)({ auth: { uid: 'seller', token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: 'seller', amount: 1000 } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripe.calls.transfersCreate).toHaveLength(0);
    expect(fs.writeOps).toHaveLength(0);
  });

  it('many new closed bank dossiers do not permanently block withdrawals', async () => {
    seed();
    for (let i = 0; i < 250; i++) {
      fs.setDoc(`transactions/history_${i}`, { sellerId: 'seller', status: 'completed', disputed: false,
        bankDispute: { ...bank, id: `du_closed_${i}`, state: 'closed', outcome: 'won', freezeCents: 0, closedAt: new Date() } });
    }
    await (walletWithdraw as unknown as Handler)({ auth: { uid: 'seller', token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: 'seller', amount: 1000 } });
    expect(stripe.calls.transfersCreate).toHaveLength(1);
  });

  it('guards the wallet refund against a legacy bank identity', async () => {
    seed({ status: 'delivered', paidVia: 'wallet', disputeId: 'du_legacy' });
    await expect(admin(refundWalletPayment)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(0);
  });

  it.each([{ fn: cancelPendingTransaction, status: 'pending_payment', caller: 'buyer' },
    { fn: sellerCancelTransaction, status: 'paid', caller: 'seller' }])('bank guard blocks $status cancellation', async ({ fn, status, caller }) => {
    seed({ status, bankDispute: bank, disputeId: 'du_bank' });
    await expect((fn as unknown as Handler)({ auth: { uid: caller, token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: caller, transactionId: 'sale' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripe.calls.refundsCreate).toHaveLength(0);
    expect(fs.writeOps).toHaveLength(0);
  });

  it.each([{ disputeId: 'du_legacy', disputeOutcome: 'dismissed' }, { disputeFreezeCents: 4500 }])('legacy ambiguity cannot be dismissed by an admin', async legacy => {
    seed({ status: 'disputed', disputed: true, ...legacy });
    await expect(admin(resolveDispute)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(0);
  });
});

describe('independent review — unresolved bank reconciliation', () => {
  it('a closed bank dossier requiring local reconciliation remains blocked', () => {
    expect(hasActiveBankDispute({ bankDispute: { ...bank, state: 'closed', outcome: 'won', closedAt: new Date(),
      freezeCents: 0, reconciliationRequired: true }, disputed: false, disputeFreezeCents: 0 })).toBe(true);
  });

  it('a closed bank dossier with an empty identity remains blocked as malformed', () => {
    expect(hasActiveBankDispute({ bankDispute: { ...bank, id: '', state: 'closed', outcome: 'won', closedAt: new Date(),
      freezeCents: 0 }, disputed: false })).toBe(true);
  });

  it('keeps the unresolved freeze when charge.refunded drains another sale pending before WON', async () => {
    seed();
    fs.setDoc('transactions/other_pending', { sellerId: 'seller', status: 'paid', sellerCreditedCents: 9000, sellerPendingCreditCents: 9000 });
    fs.setDoc('wallets/seller', { balance: 7000, pendingBalance: 9000, heldBalance: 0, sellerDebt: 0, status: 'active' });
    await handleDisputeCreated(event());
    expect(seller().heldBalance).toBe(4500);
    // Historical pre-P02 charge.refunded consumed another sale's pending.
    fs.setDoc('wallets/seller', { ...seller(), pendingBalance: 4500 });
    fs.setDoc('transactions/sale', { ...sale(), status: 'refunded', refundedAt: new Date(), disputed: false });
    expect(seller().heldBalance).toBe(4500);
    await handleDisputeClosed(event('won'));
    expect(sale().bankDispute).toMatchObject({ state: 'closed', reconciliationRequired: true, freezeCents: 4500, id: 'du_bank' });
    expect(sale().disputeFreezeCents).toBe(4500);
    expect(sale().disputeId).toBe('du_bank');
    expect(hasActiveBankDispute(sale())).toBe(true);
  });

  it('a refunded non-disputed bank dossier requiring reconciliation is not withdrawable', async () => {
    seed({ status: 'refunded', refundedAt: new Date(), disputed: false, bankDispute: bank, disputeId: 'du_bank', disputeFreezeCents: 4500 });
    fs.setDoc('wallets/seller', { balance: 2500, pendingBalance: 0, heldBalance: 4500, sellerDebt: 0, status: 'active' });
    await handleDisputeClosed(event('won'));
    expect(sale().bankDispute.reconciliationRequired).toBe(true);
    const withdraw = (walletWithdraw as unknown as { run?: Handler }).run ?? walletWithdraw as unknown as Handler;
    await expect(withdraw({ auth: { uid: 'seller', token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: 'seller', amount: 2500 } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripe.calls.transfersCreate).toHaveLength(0);
    expect(stripe.calls.payoutsCreate).toHaveLength(0);
    const writes = fs.writeOps.length;
    await handleDisputeClosed(event('won'));
    expect(fs.writeOps).toHaveLength(writes);
    expect(fs.writeOps.filter(op => op.path.startsWith('admin_alerts/') &&
      (op.data.context as Record<string, unknown>)?.reason === 'refund_race_hold')).toHaveLength(1);
  });

  it('withdrawal discovers closed reconciliation history even when legacy projections are missing', async () => {
    seed({ status: 'refunded', disputed: false, bankDispute: { ...bank, state: 'closed', outcome: 'won', closedAt: new Date(),
      freezeCents: 0, reconciliationRequired: true } });
    await expect((walletWithdraw as unknown as Handler)({ auth: { uid: 'seller', token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: 'seller', amount: 2500 } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripe.calls.transfersCreate).toHaveLength(0);
    expect(stripe.calls.payoutsCreate).toHaveLength(0);
    expect(fs.writeOps).toHaveLength(0);
  });

  it('closed reconciliation still blocks the refund core and automatic held release', async () => {
    seed({ status: 'delivered', disputed: false, sellerHeldCreditCents: 4500, fundsReleaseAt: new Date(Date.now() - 1000),
      bankDispute: { ...bank, state: 'closed', outcome: 'won', closedAt: new Date(), freezeCents: 0, reconciliationRequired: true } });
    fs.setDoc('wallets/seller', { balance: 2500, pendingBalance: 0, heldBalance: 4500, sellerDebt: 0 });
    await expect(issueTransactionRefund('sale', sale(), { idempotencyKey: 'rf_sale' })).rejects.toMatchObject({ code: 'failed-precondition' });
    await (releaseHeldFunds as unknown as () => Promise<void>)();
    expect(seller()).toMatchObject({ balance: 2500, heldBalance: 4500 });
    expect(sale().fundsReleasedAt).toBeUndefined();
    expect(stripe.calls.refundsCreate).toHaveLength(0);
  });

  it.each([resolveDispute, adminRefundTransaction, requestRefund, requestReturn, refundWalletPayment])('closed unresolved reconciliation blocks commercial resolution and refund/return callables', async fn => {
    seed({ status: 'disputed', disputed: false, bankDispute: { ...bank, state: 'closed', outcome: 'won', closedAt: new Date(),
      freezeCents: 0, reconciliationRequired: true } });
    const actor = fn === requestRefund || fn === requestReturn ? 'buyer' : 'admin';
    await expect((fn as unknown as Handler)({ auth: { uid: actor, token: { auth_time: Math.floor(Date.now() / 1000), admin: true } }, data: { expectedUid: actor, transactionId: 'sale', reason: 'damaged' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripe.calls.refundsCreate).toHaveLength(0);
    expect(fs.writeOps).toHaveLength(0);
  });
});

describe('bank lifecycle, identity and money conservation', () => {
  it('handles recognized closure after the lifecycle status has changed', async () => {
    seed(); await handleDisputeCreated(event());
    fs.setDoc('transactions/sale', { ...sale(), status: 'delivery_failed', disputed: false });
    await handleDisputeClosed(event('won'));
    expect(sale().bankDispute).toMatchObject({ state: 'closed', outcome: 'won', freezeCents: 0 });
    expect(sale().status).toBe('delivery_failed');
    expect(seller().balance).toBe(7000);
  });

  it('does not reopen or freeze again after closed then created replay', async () => {
    seed(); await handleDisputeClosed(event('won'));
    await handleDisputeCreated(event());
    expect(sale().bankDispute).toMatchObject({ state: 'closed', outcome: 'won' });
    expect(sale().status).toBe('completed');
    expect(seller().balance).toBe(7000);
  });

  it('a first unknown closure creates a guard and blocks the real refund core', async () => {
    seed(); await handleDisputeClosed(event('unknown'));
    expect(sale().bankDispute.state).toBe('open');
    await expect(issueTransactionRefund('sale', sale(), { idempotencyKey: 'rf_sale' })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripe.calls.refundsCreate).toHaveLength(0);
  });

  it('settles full lost closure before created exactly once', async () => {
    seed(); await handleDisputeClosed(event('lost'));
    const writes = fs.writeOps.length;
    await handleDisputeCreated(event());
    await handleDisputeClosed(event('lost'));
    expect(fs.writeOps).toHaveLength(writes);
    expect(sale().bankDispute).toMatchObject({ state: 'closed', outcome: 'lost' });
    expect(equity()).toBe(2500);
  });

  it('adopts a replayed legacy opening without freezing twice', async () => {
    seed({ status: 'disputed', disputed: true, statusBeforeDispute: 'completed', disputeId: 'du_bank', disputeFreezeCents: 4500 });
    fs.setDoc('wallets/seller', { balance: 2500, pendingBalance: 0, heldBalance: 4500, sellerDebt: 0 });
    await handleDisputeCreated(event());
    expect(sale().bankDispute).toMatchObject({ id: 'du_bank', state: 'open', freezeCents: 4500 });
    expect(seller().heldBalance).toBe(4500);
    await handleDisputeClosed(event('won'));
    expect(seller().balance).toBe(7000);
  });

  it('created and closed replays and foreign dossier closures make no duplicate movement', async () => {
    seed(); await handleDisputeCreated(event());
    await handleDisputeCreated(event());
    expect(seller().heldBalance).toBe(4500);
    const beforeForeign = fs.writeOps.length;
    await handleDisputeClosed(event('lost', 'du_other'));
    expect(fs.writeOps.slice(beforeForeign).every(op => op.path.startsWith('admin_alerts/'))).toBe(true);
    expect(sale().bankDispute.state).toBe('open');
    await handleDisputeClosed(event('lost'));
    const afterClosed = fs.writeOps.length;
    await handleDisputeClosed(event('lost'));
    expect(fs.writeOps).toHaveLength(afterClosed);
    expect(equity()).toBe(2500);
  });

  it('new bank identity after a closed dossier persists an exception and blocks withdrawal', async () => {
    seed(); await handleDisputeClosed(event('won'));
    await handleDisputeCreated(event('needs_response', 'du_new'));
    expect(sale().bankDispute).toMatchObject({ state: 'open', reconciliationRequired: true, conflictingDisputeId: 'du_new' });
    expect(fs.writeOps.some(op => op.path.startsWith('admin_alerts/') && op.data.kind === 'bank_dispute_reconciliation_required')).toBe(true);
    await expect((walletWithdraw as unknown as Handler)({ auth: { uid: 'seller', token: { auth_time: Math.floor(Date.now() / 1000),} }, data: { expectedUid: 'seller', amount: 1000 } })).rejects.toMatchObject({ code: 'failed-precondition' });
    const before = equity();
    await handleDisputeClosed(event('won', 'du_new'));
    expect(sale().bankDispute.state).toBe('open');
    expect(equity()).toBe(before);
  });

  it('unmatched signed bank event creates one operator alert across replays', async () => {
    await handleDisputeCreated(event()); await handleDisputeCreated(event());
    expect(fs.writeOps.filter(op => op.path.startsWith('admin_alerts/'))).toHaveLength(1);
    expect(fs.writeOps.some(op => op.path.startsWith('wallets/'))).toBe(false);
  });

  it.each(['under_review', 'new_unknown', undefined])('unknown closure %s never releases the hold', async status => {
    seed(); await handleDisputeCreated(event());
    await handleDisputeClosed({ ...event(), status });
    expect(sale().bankDispute.state).toBe('open');
    expect(seller().heldBalance).toBe(4500);
    expect(seller().balance).toBe(2500);
  });

  it('partial lost chargeback remains reserved for reconciliation without marking refunded', async () => {
    seed(); await handleDisputeCreated(event('needs_response', 'du_bank', 1000));
    await handleDisputeClosed(event('lost', 'du_bank', 1000));
    expect(sale().bankDispute).toMatchObject({ state: 'open', reconciliationRequired: true });
    expect(sale().status).toBe('disputed');
    expect(equity()).toBe(7000);
    expect(seller().heldBalance).toBe(4500);
  });

  it('never freezes an uncredited payout estimate from other sales', async () => {
    seed({ sellerCreditedCents: 0, sellerPendingCreditCents: 0 });
    await handleDisputeCreated(event());
    expect(seller().balance).toBe(7000);
    expect(sale().bankDispute.freezeCents).toBe(0);
    await handleDisputeClosed(event('lost'));
    expect(equity()).toBe(7000);
  });

  it('debits gross exposure including debt repaid but freezes only net credited funds', async () => {
    seed({ sellerPendingCreditCents: 3000, sellerDebtRepaidCents: 1500, sellerReleasedCents: 3000 });
    fs.setDoc('wallets/seller', { balance: 3000, pendingBalance: 0, heldBalance: 0, sellerDebt: 0 });
    await handleDisputeCreated(event());
    expect(sale().bankDispute.freezeCents).toBe(3000);
    await handleDisputeClosed(event('lost'));
    expect(seller().sellerDebt).toBe(1500);
    expect(equity()).toBe(-1500);
  });

  it('legacy release ledgers and release-time debt repayment prove only the withdrawable net', async () => {
    seed({ sellerReleasedCents: undefined, sellerPendingCreditCents: 3000, sellerHeldCreditCents: undefined, sellerDebtRepaidCents: 1500 });
    const legacy = sale(); delete legacy.sellerReleasedCents; delete legacy.sellerHeldCreditCents;
    fs.setDoc('transactions/sale', legacy);
    fs.setDoc('wallets/seller/ledger/held', { type: 'funds_held', amount: 3000, transactionId: 'sale' });
    fs.setDoc('wallets/seller/ledger/release', { type: 'funds_released', amount: 3000, transactionId: 'sale' });
    fs.setDoc('wallets/seller/ledger/debt', { type: 'debt_repayment', amount: 1000, description: 'Fonds libérés — régularisation du solde dû', transactionId: 'sale' });
    await handleDisputeCreated(event());
    expect(sale().bankDispute.freezeCents).toBe(2000);
    await handleDisputeClosed(event('lost'));
    expect(equity()).toBe(2500);
    expect(seller().heldBalance).toBe(0);
  });

  it('records but never double-debits or recredits an already refunded mixed transaction', async () => {
    seed({ status: 'refunded', refundedAt: new Date(), paidVia: 'mixed', walletAmountUsed: 1000 });
    await handleDisputeCreated(event('needs_response', 'du_bank', 4000));
    expect(sale().bankDispute.state).toBe('open');
    await handleDisputeClosed(event('lost', 'du_bank', 4000));
    expect(sale().bankDispute).toMatchObject({ state: 'closed', outcome: 'lost' });
    expect(sale().status).toBe('refunded');
    expect(equity()).toBe(7000);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
  });

  it('full external refund under bank requires reconciliation before money, then bank loss settles own exposure once', async () => {
    seed({ paidVia: 'wallet_and_card', walletAmountUsed: 1000 });
    await handleDisputeCreated(event('needs_response', 'du_bank', 4000));
    stripe.impl.refundsRetrieve = async () => ({ id: 're_external', payment_intent: 'pi_sale', amount: 4000, currency: 'cad', status: 'succeeded', metadata: {} });
    await handleChargeRefunded({ id: 'ch_sale', payment_intent: 'pi_sale', amount: 4000, amount_refunded: 4000, refunds: { data: [{ id: 're_external' }] } });
    expect(equity()).toBe(7000); expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
    expect(sale().refund.state).toBe('reconciliation_required'); expect(sale().bankDispute.reconciliationRequired).toBe(true);
    await handleDisputeClosed(event('lost', 'du_bank', 4000));
    expect(equity()).toBe(2500); expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300);
    const writes = fs.writeOps.length; await handleDisputeClosed(event('lost', 'du_bank', 4000));
    expect(fs.writeOps).toHaveLength(writes); expect(sale().refundBlocked).toBe(true);
    expect(hasActiveBankDispute(sale())).toBe(true);
  });

  it('lost mixed closure recreates a missing buyer wallet and records missing seller exposure as debt', async () => {
    seed({ paidVia: 'mixed', walletAmountUsed: 1000 });
    fs.setDoc('wallets/buyer', null); fs.setDoc('wallets/seller', null);
    await handleDisputeClosed(event('lost', 'du_bank', 4000));
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(1000);
    expect(seller().sellerDebt).toBe(4500);
    const debit = fs.writeOps.find(op => op.path.startsWith('wallets/seller/ledger/') && op.data.type === 'refund_debit');
    expect(debit?.data).toMatchObject({ amount: 0, debtRecorded: 4500, balanceAfter: 0 });
  });

  it('a won closure cannot discard a frozen hold whose wallet disappeared', async () => {
    seed(); await handleDisputeCreated(event()); fs.setDoc('wallets/seller', null);
    await handleDisputeClosed(event('won'));
    expect(sale().bankDispute).toMatchObject({ state: 'open', freezeCents: 4500, reconciliationRequired: true });
    expect(fs.writeOps.some(op => op.path.startsWith('admin_alerts/') && (op.data.context as Record<string, unknown>)?.reason === 'missing_frozen_wallet')).toBe(true);
  });

  it.each([{ sellerId: null }, { buyerId: null }])('missing party identity cannot be stamped ledger-reconciled', async party => {
    seed({ paidVia: 'wallet_and_card', walletAmountUsed: 1000, ...party });
    await handleDisputeClosed(event('lost', 'du_bank', 4000));
    expect(sale().bankDispute).toMatchObject({ state: 'open', reconciliationRequired: true });
    expect(sale().bankDispute.ledgerReconciledAt).toBeUndefined();
    expect(sale().status).toBe('completed');
    expect(fs.writeOps.some(op => op.path.startsWith('wallets/'))).toBe(false);
  });

  it('settles legacy bank closure despite cleared disputed status once and preserves commercial dispute', async () => {
    seed({ status: 'return_requested', disputed: true, disputeId: 'du_bank', disputeFreezeCents: 4500,
      statusBeforeDispute: 'delivered' });
    fs.setDoc('wallets/seller', { balance: 2500, pendingBalance: 0, heldBalance: 4500, sellerDebt: 0 });
    await handleDisputeClosed(event('won'));
    expect(sale().bankDispute).toMatchObject({ state: 'closed', outcome: 'won' });
    expect(sale().status).toBe('return_requested');
    expect(sale().disputed).toBe(true);
    expect(seller().heldBalance).toBe(4500);
  });
});
