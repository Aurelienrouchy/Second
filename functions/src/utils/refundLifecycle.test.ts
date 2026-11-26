import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock } from './testHelpers/firestoreMock';
import type { MockFirestore } from './testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, status: 'succeeded' as string | null,
  creates: [] as Array<Record<string, any>>, refunds: {} as Record<string, any>, serial: 0, responseLost: false,
  beforeList: null as null | (() => Promise<void>), afterCreate: null as null | ((r: any) => Promise<void>), notifications: [] as unknown[][] }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); holder.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ refunds: {
  create: async (params: Record<string, any>, options: Record<string, any>) => {
    holder.creates.push({ params, options });
    const refund = { id: `re_${++holder.serial}`, status: holder.status, payment_intent: params.payment_intent,
      amount: params.amount ?? 5000, currency: 'cad', metadata: params.metadata ?? {} };
    holder.refunds[refund.id] = refund;
    if (holder.afterCreate) await holder.afterCreate(refund);
    if (holder.responseLost) throw new Error('Connection lost after provider accepted');
    return refund;
  },
  retrieve: async (id: string) => { if (!holder.refunds[id]) throw new Error('refund not found'); return { ...holder.refunds[id] }; },
  list: async (params: Record<string, any>) => { if (holder.beforeList) await holder.beforeList(); return { data: Object.values(holder.refunds).filter(r => r.payment_intent === params.payment_intent), has_more: false }; },
} }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => null }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('./notifications', () => ({ sendPushNotification: async (...args: unknown[]) => { holder.notifications.push(args); } }));
vi.mock('./rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: () => ({ callerKey: 'test', isAuthenticated: true }) }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {}, debug() {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, handler: unknown) => handler, onRequest: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));

import { issueTransactionRefund, observePurchaseRefund, retryPurchaseRefundAfterFailure, resumeTransactionRefund } from './refund';
import { handleDisputeCreated, handleDisputeClosed } from '../http/stripe/disputes';
import { hasUnsettledRefund, refundResult } from './refundState';
import { processReturnDelivered } from './returnRefund';
import { retryFailedOperations } from '../scheduled/retryFailedOperations';
import { reconcileFinances } from '../scheduled/reconcile';
import { handlePaymentIntentSucceeded } from '../http/stripe/payment';
import { handleRefundUpdated } from '../http/stripe/refunds';
import { adminRefundTransaction } from '../callable/payments/disputes';
const sale = () => fs.getDoc('transactions/sale')!;
const seller = () => fs.getDoc('wallets/seller')!;
function seed(extra: Record<string, any> = {}) {
  fs.setDoc('transactions/sale', { status: 'delivered', buyerId: 'buyer', sellerId: 'seller', articleId: 'article',
    paidVia: 'mixed', walletAmountUsed: 1000, totalAmount: 50, stripePaymentIntentId: 'pi_sale',
    sellerCreditedCents: 4500, sellerPendingCreditCents: 4500, sellerHeldCreditCents: 4500, ...extra });
  fs.setDoc('wallets/buyer', { balance: 300, status: 'active' });
  fs.setDoc('wallets/seller', { balance: 2500, pendingBalance: 9000, heldBalance: 4500, sellerDebt: 0, status: 'active' });
  fs.setDoc('articles/article', { isSold: true, activeTransactionId: 'sale' });
  fs.setDoc('disputes/claim', { transactionId: 'sale', status: 'open' });
}
const request = (key = 'rf_first', opts: Record<string, any> = {}) => issueTransactionRefund('sale', sale(), { idempotencyKey: key, ...opts });
beforeEach(() => { fs.reset(); holder.status = 'succeeded'; holder.creates.length = 0; holder.refunds = {};
  holder.beforeList = null; holder.afterCreate = null; holder.serial = 0; holder.responseLost = false; holder.notifications.length = 0; });

describe('durable asynchronous purchase refunds', () => {
  it.each(['pending', 'requires_action', null])('provider %s is not success and moves no buyer/seller refund money', async status => {
    seed(); holder.status = status;
    const result = await request();
    expect(result.success).toBe(false);
    expect((result as any).status).toBe(status ?? 'unknown');
    expect(sale().status).toBe('refund_in_progress');
    expect(sale().refundBlocked).toBe(true);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
    expect(seller()).toMatchObject({ pendingBalance: 9000, heldBalance: 4500, sellerDebt: 0 });
    expect(fs.getDoc('disputes/claim')!.status).toBe('open');
    expect(holder.notifications).toHaveLength(0);
  });

  it.each(['failed', 'canceled'])('provider %s preserves an explicit buyer obligation and no financial success', async status => {
    seed(); holder.status = status;
    const result = await request();
    expect(result.success).toBe(false);
    expect((result as any).status).toBe(status);
    expect((result as any).actionRequired).toBe(true);
    expect(sale().status).toBe('refund_action_required');
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
    expect(seller().pendingBalance).toBe(9000);
  });

  it('pending to succeeded applies exactly once, includes mixed alias and protects the other sale pending', async () => {
    seed(); holder.status = 'pending'; await request();
    holder.refunds.re_1.status = 'succeeded';
    await handleRefundUpdated({ ...holder.refunds.re_1 });
    await handleRefundUpdated({ ...holder.refunds.re_1 });
    expect(sale().status).toBe('refunded');
    expect(sale().refund.fundsAppliedAt).toBeTruthy();
    expect(seller()).toMatchObject({ pendingBalance: 9000, heldBalance: 0, sellerDebt: 0 });
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300);
    expect(fs.getDoc('disputes/claim')!.status).toBe('resolved');
  });

  it('late failure reopens card obligation without repeating the wallet credit or seller debit', async () => {
    seed(); await request(); const money = { ...seller() };
    holder.refunds.re_1.status = 'failed';
    await handleRefundUpdated({ ...holder.refunds.re_1 });
    expect(sale().status).toBe('refund_action_required');
    expect(sale().refund.fundsAppliedAt).toBeTruthy();
    expect(sale().refund.outstandingCardCents).toBe(4000);
    expect(seller()).toEqual(money);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300);
    await request('rf_second'); expect(holder.creates).toHaveLength(1);
  });

  it('two initiators join one durable intention and one provider request', async () => {
    seed(); holder.status = 'pending';
    await Promise.all([request('rf_admin', { reason: 'admin' }), request('rf_return', { reason: 'return', cardRefundAmountCents: 3000 })]);
    expect(holder.creates).toHaveLength(1);
    expect(sale().refund.intentId).toBeTruthy();
    expect(sale().refund.reason).toBe('admin');
  });

  it('a partial intention keeps its original amounts and relist policy on another initiator retry', async () => {
    seed(); holder.status = 'pending';
    await request('rf_return', { reason: 'return', cardRefundAmountCents: 3200, buyerWalletRefundOverrideCents: 0, relistArticle: false });
    await request('rf_expiration', { reason: 'expiration', relistArticle: true });
    expect(holder.creates).toHaveLength(1);
    expect(sale().refund).toMatchObject({ cardAmountCents: 3200, walletAmountCents: 0, reason: 'return', relistArticle: false });
  });

  it('lost response keeps a durable intention then finds the provider refund rather than issuing a second one', async () => {
    seed(); holder.responseLost = true;
    const result = await request('rf_original');
    expect(result.success).toBe(false);
    expect(sale().refund.intentId).toBeTruthy();
    expect(sale().status).toBe('refund_in_progress');
    holder.responseLost = false;
    await request('rf_retry');
    expect(holder.creates).toHaveLength(1);
    expect(sale().status).toBe('refunded');
  });

  it('admin does not close linked claims when Stripe only accepts pending', async () => {
    seed({ status: 'disputed' }); holder.status = 'pending';
    const handler = adminRefundTransaction as unknown as (r: any) => Promise<any>;
    const result = await handler({ auth: { uid: 'admin', token: { auth_time: Math.floor(Date.now() / 1000), admin: true } }, data: { expectedUid: 'admin', transactionId: 'sale' } });
    expect(result.success).toBe(false);
    expect(fs.getDoc('disputes/claim')!.status).toBe('open');
  });
});

describe('refund proof, repair and competing financial operations', () => {
  it.each([undefined, '', 'bogus', 8])('normalizes malformed local state %s without undefined messages', state => {
    const result = refundResult({ state });
    expect(result.status).toBe('unknown'); expect(typeof result.message).toBe('string'); expect(result.success).toBe(false);
  });
  it('legacy refunded without provider and ledger proof stays manual, never creates another refund', async () => {
    seed({ status: 'refunded', refundedAt: new Date() });
    const result = await request(); expect(result.success).toBe(false);
    expect(holder.creates).toHaveLength(0); expect(seller().heldBalance).toBe(4500);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300); expect(hasUnsettledRefund(sale())).toBe(true);
  });
  it('legacy partial provider refund with unknown options is not recreated as a full refund', async () => {
    seed({ status: 'refunded', refundedAt: new Date(), stripeRefundId: 're_old' });
    holder.refunds.re_old = { id: 're_old', status: 'succeeded', amount: 2000, currency: 'cad', payment_intent: 'pi_sale', metadata: {} };
    const result = await request(); expect(result.status).toBe('reconciliation_required'); expect(result.success).toBe(false);
    expect(holder.creates).toHaveLength(0); expect(seller().heldBalance).toBe(4500); expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
  });
  it('proves a full legacy refund using current Stripe and both local ledgers without repeating money', async () => {
    seed({ status: 'refunded', refundedAt: new Date(), stripeRefundId: 're_old' });
    fs.setDoc('wallets/seller/ledger/old_debit', { type: 'refund_debit', amount: 4500, transactionId: 'sale' });
    fs.setDoc('wallets/buyer/ledger/old_credit', { type: 'refund_credit', amount: 1000, transactionId: 'sale' });
    holder.refunds.re_old = { id: 're_old', status: 'succeeded', amount: 4000, currency: 'cad', payment_intent: 'pi_sale', metadata: {} };
    const before = { ...seller() }; const result = await request();
    expect(result.success).toBe(true); expect(holder.creates).toHaveLength(0); expect(seller()).toEqual(before);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
  });
  it('requires manual reconciliation beyond the key retention horizon when lookup finds no refund', async () => {
    seed(); holder.responseLost = true; await request(); holder.responseLost = false; holder.refunds = {};
    fs.setDoc('transactions/sale', { ...sale(), refund: { ...sale().refund, leaseUntilMs: 0, externalAttemptedAtMs: Date.now() - 25 * 3600000 } });
    const result = await request('new_key');
    expect(result.success).toBe(false); expect(result.status).toBe('unknown'); expect(holder.creates).toHaveLength(1);
  });
  it('a webhook before the create response settles once and stale pending response cannot reverse it', async () => {
    seed(); holder.status = 'pending';
    holder.afterCreate = async refund => { holder.refunds[refund.id] = { ...refund, status: 'succeeded' }; await handleRefundUpdated(refund); };
    const result = await request();
    expect(result.success).toBe(true); expect(sale().refund.state).toBe('succeeded');
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300); expect(seller().heldBalance).toBe(0);
    expect(fs.writeOps.filter(op => op.path.startsWith('wallets/seller/ledger/') && op.data.type === 'refund_debit')).toHaveLength(1);
  });
  it('stale failed webhook uses current succeeded proof, without another financial application', async () => {
    seed(); await request(); const money = { ...seller() };
    await handleRefundUpdated({ ...holder.refunds.re_1, status: 'failed' });
    expect(sale().refund.state).toBe('succeeded'); expect(seller()).toEqual(money);
  });
  it.each(['won', 'lost'])('refund reserve then bank %s never freezes or consumes another sale', async outcome => {
    seed({ status: 'completed', sellerReleasedCents: 4500, sellerHeldCreditCents: 4500 });
    fs.setDoc('wallets/seller', { balance: 7000, pendingBalance: 9000, heldBalance: 0, sellerDebt: 0, status: 'active' });
    holder.status = 'pending'; await request();
    expect(seller()).toMatchObject({ balance: 2500, pendingBalance: 9000, heldBalance: 4500 });
    const bank = { id: 'du_refund', payment_intent: 'pi_sale', amount: 4000, currency: 'cad', status: 'needs_response' };
    await handleDisputeCreated(bank);
    expect(sale().bankDispute.freezeCents).toBe(0); expect(seller().balance).toBe(2500);
    await handleDisputeClosed({ ...bank, status: outcome });
    holder.refunds.re_1.status = 'succeeded'; await handleRefundUpdated(holder.refunds.re_1);
    expect(seller()).toMatchObject({ balance: 2500, pendingBalance: 9000, heldBalance: 0, sellerDebt: 0 });
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300); expect(sale().refund.freezeCents).toBe(0);
    expect(sale().refund.state).toBe(outcome === 'won' ? 'succeeded' : 'reconciliation_required');
    expect(fs.writeOps.filter(op => op.path.startsWith('wallets/seller/ledger/') && op.data.type === 'refund_debit')).toHaveLength(1);
  });
  it('explicit retry repairs a late card failure while preserving local money and ignoring old refund events', async () => {
    seed(); await request(); holder.refunds.re_1.status = 'failed'; await handleRefundUpdated(holder.refunds.re_1);
    const before = { ...seller() }; holder.status = 'succeeded';
    const result = await retryPurchaseRefundAfterFailure('sale', 'admin');
    expect(result.success).toBe(true); expect(holder.creates).toHaveLength(2); expect(sale().refund.previousRefundIds).toEqual(['re_1']);
    expect(seller()).toEqual(before); expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300);
    await handleRefundUpdated(holder.refunds.re_1); expect(sale().refund.state).toBe('succeeded'); expect(sale().refund.stripeRefundId).toBe('re_2');
  });
  it('a failed first request can be explicitly retried, with one local reconciliation only', async () => {
    seed(); holder.status = 'failed'; await request(); holder.status = 'succeeded';
    const result = await retryPurchaseRefundAfterFailure('sale', 'admin'); expect(result.success).toBe(true);
    expect(seller().heldBalance).toBe(0); expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300);
    expect(fs.writeOps.filter(op => op.data.type === 'refund_debit')).toHaveLength(1);
  });
  it('explicit retry refuses unknown provider outcome and bank exposure', async () => {
    seed(); holder.status = 'pending'; await request();
    await expect(retryPurchaseRefundAfterFailure('sale', 'admin')).rejects.toMatchObject({ code: 'failed-precondition' });
    holder.refunds.re_1.status = 'failed'; await handleRefundUpdated(holder.refunds.re_1);
    fs.setDoc('transactions/sale', { ...sale(), bankDispute: { id: 'du_bank', state: 'open' } });
    await expect(retryPurchaseRefundAfterFailure('sale', 'admin')).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(holder.creates).toHaveLength(1);
  });
  it('zero card return settles wallet portion locally and recreates a missing buyer wallet', async () => {
    seed({ status: 'return_requested', returnLabelCost: 42, returnReason: 'damaged', paidVia: 'wallet', walletAmountUsed: 5000, stripePaymentIntentId: null }); fs.setDoc('wallets/buyer', null);
    const result = await processReturnDelivered('sale', 'webhook');
    expect(result.refunded).toBe(true); expect(holder.creates).toHaveLength(0);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(800); expect(seller().pendingBalance).toBe(9000);
  });
  it('pending return records carrier reception without claiming a confirmed refund', async () => {
    seed({ status: 'return_requested', returnLabelCost: 8 }); holder.status = 'pending';
    const result = await processReturnDelivered('sale', 'webhook');
    expect(result.refunded).toBe(false); expect(sale().returnDeliveredAt).toBeTruthy();
    expect(fs.getDoc('disputes/claim')!.status).toBe('open'); expect(holder.notifications).toHaveLength(0);
  });
  it('wallet-only payment uses one durable intention and protects another sale pending', async () => {
    seed({ paidVia: 'wallet', walletAmountUsed: 5000, stripePaymentIntentId: null });
    const result = await request(); expect(result.success).toBe(true); expect(holder.creates).toHaveLength(0);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(5300); expect(seller().pendingBalance).toBe(9000);
  });
  it('missing seller wallet records debt, while missing buyer wallet is recreated once', async () => {
    seed(); fs.setDoc('wallets/seller', null); fs.setDoc('wallets/buyer', null);
    await request(); await request();
    expect(seller().sellerDebt).toBe(4500); expect(fs.getDoc('wallets/buyer')!.balance).toBe(1000);
    expect(fs.writeOps.filter(op => op.data.type === 'refund_debit')).toHaveLength(1);
  });
  it.each(['completed', 'disputed', 'return_requested'])('PI.succeeded replay keeps %s monotone', async status => {
    seed({ status }); await handlePaymentIntentSucceeded({ id: 'pi_sale', currency: 'cad', amount_received: 4000, metadata: { transactionId: 'sale' } });
    expect(sale().status).toBe(status); expect(seller().heldBalance).toBe(4500); expect(holder.creates).toHaveLength(0);
  });
  it.each([{ id: 'pi_foreign', currency: 'cad' }, { id: 'pi_sale', currency: 'usd' }])('payment identity/currency mismatch changes no money', async invalid => {
    seed({ status: 'pending_payment' });
    await handlePaymentIntentSucceeded({ ...invalid, amount_received: 4000, metadata: { transactionId: 'sale' } });
    expect(sale().status).toBe('pending_payment'); expect(holder.creates).toHaveLength(0);
  });
  it.each([{ received: 6000, reason: 'overpaid' }, { received: 3000, reason: 'underpaid' }, { received: 4000, reason: 'cancelled' }])('authentic late $reason proof refunds actual captured amount and retains PI', async ({ received, reason }) => {
    seed({ status: reason === 'cancelled' ? 'cancelled' : 'pending_payment', stripePaymentIntentId: null, sellerCreditedCents: 0 });
    await handlePaymentIntentSucceeded({ id: 'pi_live', currency: 'cad', amount_received: received, metadata: { transactionId: 'sale' } });
    expect(holder.creates[0].params).toMatchObject({ payment_intent: 'pi_live', amount: received });
    expect(sale().stripePaymentIntentId).toBe('pi_live'); expect(sale().status).toBe('refunded');
  });
});

describe('current-proof neighbors found in parent review', () => {
  it.each([undefined, 0])('a card PI with total %s and no captured proof cannot become a local success', async totalAmount => {
    seed({ totalAmount });
    await expect(request()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(holder.creates).toHaveLength(0); expect(fs.writeOps).toHaveLength(0);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
  });
  it('explicit partial zero with known capture is legitimate and applies the persisted wallet amount only', async () => {
    seed(); const result = await request('rf_zero', { cardRefundAmountCents: 0, buyerWalletRefundOverrideCents: 500 });
    expect(result.success).toBe(true); expect(holder.creates).toHaveLength(0);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(800); expect(sale().refund.cardAmountCents).toBe(0);
  });
  it('provider success under an open bank records card confirmed, wallet/seller still to reconcile', async () => {
    seed(); holder.status = 'pending'; await request();
    await handleDisputeCreated({ id: 'du', payment_intent: 'pi_sale', amount: 4000, status: 'needs_response' });
    holder.refunds.re_1.status = 'succeeded'; await handleRefundUpdated(holder.refunds.re_1);
    expect(sale().refund).toMatchObject({ state: 'reconciliation_required', cardConfirmedCents: 4000, outstandingCardCents: 0,
      localOutstandingWalletCents: 1000, localOutstandingSellerCents: 4500 });
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
  });
  it('current succeeded to requires_action reopens only the card obligation and commercial case', async () => {
    seed(); await request(); const money = { ...seller() };
    holder.refunds.re_1.status = 'requires_action'; await handleRefundUpdated({ ...holder.refunds.re_1, status: 'succeeded' });
    expect(sale().refund).toMatchObject({ state: 'requires_action', outstandingCardCents: 4000,
      localOutstandingWalletCents: 0, localOutstandingSellerCents: 0 });
    expect(fs.getDoc('disputes/claim')!.status).toBe('open');
    expect(seller()).toEqual(money); expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300);
  });
  it('long pending has no success deadline; its first actual success starts a fresh failure watch', async () => {
    seed(); holder.status = 'pending'; await request();
    expect(sale().refund.watchUntilMs).toBeNull();
    fs.setDoc('transactions/sale', { ...sale(), refund: { ...sale().refund, requestedAtMs: Date.now() - 60 * 86400000 } });
    holder.refunds.re_1.status = 'succeeded'; await handleRefundUpdated(holder.refunds.re_1);
    expect(sale().refund.watchUntilMs).toBeGreaterThan(Date.now() + 30 * 86400000);
  });
  it('last watch retrieves current provider failure even if the failure webhook was lost before retirement', async () => {
    seed(); await request();
    fs.setDoc('transactions/sale', { ...sale(), refund: { ...sale().refund, watchUntilMs: Date.now() - 1000 } });
    holder.refunds.re_1.status = 'failed';
    await (reconcileFinances as unknown as () => Promise<void>)();
    expect(sale().refund.state).toBe('failed'); expect(sale().refund.watch).toBe(true);
    expect(sale().refund.outstandingCardCents).toBe(4000); expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300);
  });
  it('first authenticated initiator remains attributable when another initiator joins', async () => {
    seed(); holder.status = 'pending';
    await (adminRefundTransaction as any)({ auth: { uid: 'admin_first', token: { auth_time: Math.floor(Date.now() / 1000), admin: true } }, data: { expectedUid: 'admin_first', transactionId: 'sale' } });
    await request('rf_other', { initiatedByUid: 'other', source: 'another' });
    expect(sale().refund.actor).toEqual({ kind: 'user', uid: 'admin_first' });
    holder.refunds.re_1.status = 'succeeded'; await handleRefundUpdated(holder.refunds.re_1);
    expect(fs.getDoc('disputes/claim')!.resolvedBy).toBe('admin_first');
  });
});

describe('current proof keeps exact card obligations', () => {
  it.each([undefined, 1000])('a lost bank marker with amount %s does not erase the unproven card obligation', async amountCents => {
    seed(); holder.status = 'pending'; await request();
    fs.setDoc('transactions/sale', { ...sale(), bankDispute: { id: 'du_unqualified', state: 'closed', outcome: 'lost', closedAt: new Date(),
      ledgerReconciledAt: new Date(), amountCents } });
    await handleRefundUpdated(holder.refunds.re_1);
    expect(sale().refund).toMatchObject({ state: 'reconciliation_required', outstandingCardCents: 4000, cardSatisfiedVia: null });
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
  });
  it('current requires_action before an old pending create response remains visible', async () => {
    seed(); holder.status = 'pending';
    holder.afterCreate = async refund => { holder.refunds[refund.id] = { ...refund, status: 'requires_action' }; await handleRefundUpdated(refund); };
    const result = await request();
    expect(result).toMatchObject({ success: false, status: 'requires_action', actionRequired: true });
    expect(sale().refund.outstandingCardCents).toBe(4000);
    expect(holder.notifications).toHaveLength(0);
  });
});

describe('public refund evidence is fail-closed', () => {
  it('never announces confirmed for a malformed succeeded intention', () => {
    const result = refundResult({ state: 'succeeded', fundsAppliedAt: new Date() });
    expect(result).toMatchObject({ success: false, status: 'reconciliation_required', outstandingCardCents: null, actionRequired: true });
    expect(result.message).not.toContain('confirmé');
  });
  it('repairs a provider failure proved currently, even when its failure event was lost locally', async () => {
    seed(); holder.status = 'pending'; await request();
    holder.refunds.re_1.status = 'failed'; holder.status = 'succeeded';
    const result = await retryPurchaseRefundAfterFailure('sale', 'admin');
    expect(result.success).toBe(true); expect(holder.creates).toHaveLength(2);
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300);
  });
});

describe('atomic durable replay before any external response', () => {
  it('a process suspended immediately after reserve is recoverable from the queue with its original partial options', async () => {
    seed({ status: 'completed', sellerReleasedCents: 4500 });
    fs.setDoc('wallets/seller', { balance: 7000, heldBalance: 0, pendingBalance: 9000, sellerDebt: 0, status: 'active' });
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    holder.beforeList = async () => { holder.beforeList = null; enter(); await paused; };
    const interrupted = request('rf_partial_first', { reason: 'return_partial', cardRefundAmountCents: 3200, buyerWalletRefundOverrideCents: 0, relistArticle: false });
    await entered;
    const intent = sale().refund;
    expect(intent.state).toBe('requested'); expect(intent.stripeRefundId).toBeNull();
    expect(fs.getDoc('failed_operations/refund_' + intent.intentId)).toMatchObject({ status: 'pending', attempts: 0,
      payload: { refundIntentId: intent.intentId, idempotencyKey: 'rf_partial_first' } });
    expect(seller()).toMatchObject({ balance: 2500, heldBalance: 4500, pendingBalance: 9000 });
    fs.setDoc('transactions/sale', { ...sale(), refund: { ...intent, leaseUntilMs: 0 } });
    try { await (retryFailedOperations as unknown as () => Promise<void>)(); }
    finally { release(); await interrupted; }
    expect(holder.creates).toHaveLength(1); expect(holder.creates[0].params.amount).toBe(3200);
    expect(sale().refund.reason).toBe('return_partial'); expect(sale().refund.relistArticle).toBe(false);
    expect(seller()).toMatchObject({ balance: 2500, heldBalance: 0, pendingBalance: 9000 });
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
  });
});

describe('P02 independent review R01 — temporary bank waiting', () => {
  it.each(['webhook_after_won', 'queue_after_won'])('current pending before WON resumes the same intent once via %s', async path => {
    seed({ status: 'completed', sellerReleasedCents: 4500, sellerHeldCreditCents: 4500 });
    fs.setDoc('wallets/seller', { balance: 7000, pendingBalance: 9000, heldBalance: 0, sellerDebt: 0, status: 'active' });
    holder.status = 'pending'; await request('rf_bank_wait'); const intentId = sale().refund.intentId;
    const bank = { id: 'du_pending_only', payment_intent: 'pi_sale', amount: 4000, currency: 'cad', status: 'needs_response' };
    await handleDisputeCreated(bank); await handleRefundUpdated(holder.refunds.re_1);
    expect(sale().bankDispute.reconciliationRequired).not.toBe(true);
    expect(sale().refund).toMatchObject({ state: 'pending', bankWaiting: true, freezeCents: 4500 });
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
    await handleDisputeClosed({ ...bank, status: 'won' }); holder.refunds.re_1.status = 'succeeded';
    if (path === 'webhook_after_won') await handleRefundUpdated(holder.refunds.re_1);
    else await (retryFailedOperations as any)();
    expect((await resumeTransactionRefund('sale')).success).toBe(true);
    expect(sale().refund).toMatchObject({ intentId, bankWaiting: false, freezeCents: 0 });
    expect(seller()).toMatchObject({ balance: 2500, pendingBalance: 9000, heldBalance: 0, sellerDebt: 0 });
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(1300); expect(holder.creates).toHaveLength(1);
    expect(fs.writeOps.filter(w => w.data.type === 'refund_debit')).toHaveLength(1);
  });
  it('verified success under an open bank remains explicitly manual after WON, without releasing the hold', async () => {
    seed({ status: 'completed', sellerReleasedCents: 4500, sellerHeldCreditCents: 4500 });
    fs.setDoc('wallets/seller', { balance: 7000, pendingBalance: 9000, heldBalance: 0, sellerDebt: 0, status: 'active' });
    holder.status = 'pending'; await request();
    const bank = { id: 'du_success_overlap', payment_intent: 'pi_sale', amount: 4000, status: 'needs_response' };
    await handleDisputeCreated(bank); holder.refunds.re_1.status = 'succeeded'; await handleRefundUpdated(holder.refunds.re_1);
    expect(sale().bankDispute.reconciliationRequired).toBe(true);
    await handleDisputeClosed({ ...bank, status: 'won' });
    const result = await resumeTransactionRefund('sale');
    expect(result).toMatchObject({ success: false, status: 'reconciliation_required', bankWaiting: false });
    expect(seller()).toMatchObject({ balance: 2500, pendingBalance: 9000, heldBalance: 4500, sellerDebt: 0 });
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300);
  });
  it.each(['legacy', 'existing_reconciliation', 'identity_conflict'])('pending does not downgrade a real bank anomaly: %s', async kind => {
    seed({ status: 'completed', sellerReleasedCents: 4500, sellerHeldCreditCents: 4500 });
    fs.setDoc('wallets/seller', { balance: 7000, pendingBalance: 9000, heldBalance: 0, sellerDebt: 0, status: 'active' });
    holder.status = 'pending'; await request();
    const bank = kind === 'legacy' ? null : { id: 'du_anomaly', state: 'open', outcome: null,
      ...(kind === 'existing_reconciliation' ? { reconciliationRequired: true } : { conflictingDisputeId: 'du_other' }) };
    fs.setDoc('transactions/sale', { ...sale(), bankDispute: bank, disputeId: 'du_anomaly' });
    expect(await observePurchaseRefund('sale', 're_1')).toMatchObject({ status: 'reconciliation_required', bankWaiting: false });
    expect((await resumeTransactionRefund('sale')).success).toBe(false);
    expect(sale().disputeId).toBe('du_anomaly'); expect(sale().refund.freezeCents).toBe(4500);
    if (bank) expect(sale().bankDispute.reconciliationRequired).toBe(true);
    expect(seller()).toMatchObject({ balance: 2500, pendingBalance: 9000, heldBalance: 4500, sellerDebt: 0 });
    expect(fs.getDoc('wallets/buyer')!.balance).toBe(300); expect(holder.creates).toHaveLength(1);
  });
});
