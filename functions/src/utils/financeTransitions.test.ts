import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from './testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from './testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, stripe: null as StripeMock | null }));
const fs = createFirestoreMock();
const stripe = createStripeMock();
holder.fs = fs;
holder.stripe = stripe;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => holder.stripe!.client }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => null }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('../utils/notifications', () => ({ sendNotification: async () => {} }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {}, debug() {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));

import { creditSellerForSale, recordTransactionRevenue } from './labelFulfillment';
import { applyTrackingOutcome } from './trackingTransition';
import { releaseHeldFunds } from '../scheduled/releaseHeldFunds';
import { issueTransactionRefund } from './refund';

beforeEach(() => { fs.reset(); stripe.reset(); vi.stubEnv('PAYMENTS_ENABLED', 'false'); });

const equity = () => {
  const w = fs.getDoc('wallets/seller1')!;
  return (w.balance ?? 0) + (w.pendingBalance ?? 0) + (w.heldBalance ?? 0) - (w.sellerDebt ?? 0);
};

async function credit(debt: number, extraHeld = 0) {
  fs.setDoc('wallets/seller1', { balance: 0, pendingBalance: 0, heldBalance: extraHeld, sellerDebt: debt, status: 'active' });
  fs.setDoc('wallets/buyer1', { balance: 0, status: 'active' });
  fs.setDoc('transactions/sale1', { sellerId: 'seller1', buyerId: 'buyer1', status: 'label_created', amount: 45,
    sellerPayout: 45, totalAmount: 45, deliveryType: 'shipping', paidVia: 'wallet', walletAmountUsed: 4500 });
  await fs.db.runTransaction(async tx => {
    const ref = fs.db.collection('transactions').doc('sale1');
    await creditSellerForSale(tx as never, ref as never, (await tx.get(ref)).data()!, 'sale1');
  });
}

async function deliverAndRelease() {
  await applyTrackingOutcome('sale1', 'DELIVERED', 'test');
  await fs.db.collection('transactions').doc('sale1').update({ fundsReleaseAt: new Date(Date.now() - 1000) });
  await (releaseHeldFunds as unknown as () => Promise<void>)();
}

describe('seller debt conservation across escrow, release and refund', () => {
  it('moves and releases only net escrow, preserving unrelated held funds', async () => {
    await credit(1500, 777);
    expect(fs.getDoc('transactions/sale1')!.sellerPendingCreditCents).toBe(3000);
    expect(fs.getDoc('transactions/sale1')!.sellerCreditedCents).toBe(4500);
    expect(equity()).toBe(3777);
    await applyTrackingOutcome('sale1', 'DELIVERED', 'test');
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(3777);
    expect(fs.getDoc('wallets/seller1')!.pendingBalance).toBe(0);
    await fs.db.collection('transactions').doc('sale1').update({ fundsReleaseAt: new Date(Date.now() - 1000) });
    await (releaseHeldFunds as unknown as () => Promise<void>)();
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);
    expect(fs.getDoc('wallets/seller1')!.heldBalance).toBe(777);
    expect(equity()).toBe(3777);
  });

  it('derives net escrow for a legacy transaction from the debt repayment ledger', async () => {
    await credit(1500);
    const data = fs.getDoc('transactions/sale1')!;
    delete data.sellerPendingCreditCents;
    delete data.sellerDebtRepaidCents;
    fs.setDoc('transactions/sale1', data);
    await deliverAndRelease();
    expect(fs.getDoc('wallets/seller1')!.balance).toBe(3000);
    expect(fs.getDoc('transactions/sale1')!.sellerPendingCreditCents).toBe(3000);
    expect(equity()).toBe(3000);
  });

  it.each([0, 1500, 4500, 6000].flatMap(debt => ['credited', 'delivered', 'released'].map(stage => ({ debt, stage }))))('conserves and restores debt $debt after refund at $stage', async ({ debt, stage }) => {
    await credit(debt);
    expect(equity()).toBe(4500 - debt);
    if (stage === 'delivered') await applyTrackingOutcome('sale1', 'DELIVERED', 'test');
    if (stage === 'released') await deliverAndRelease();
    expect(equity()).toBe(4500 - debt);
    const data = fs.getDoc('transactions/sale1')!;
    await issueTransactionRefund('sale1', data, { idempotencyKey: 'refund_sale1', relistArticle: false });
    expect(equity()).toBe(0 - debt);
    expect(fs.getDoc('wallets/buyer1')!.balance).toBe(4500);
    expect(fs.getDoc('transactions/sale1')!.status).toBe('refunded');
  });
});

describe('platform margin excludes tax and includes shipping collected', () => {
  it.each([[10, 10, 4], [10, 12, 2], [10, 8, 6]])('collected %i, carrier %i gives margin %i', async (collected, carrier, margin) => {
    stripe.impl.chargesRetrieve = async () => ({ balance_transaction: { fee: 100 } });
    await recordTransactionRevenue({ transactionId: 'sale1', sellerId: 'seller1', serviceFee: 5,
      shippingCost: collected, actualShippingCost: carrier, taxTotal: 2, chargeId: 'ch_test' });
    const revenue = fs.getDoc('platform_ledger/service_fee_revenue_sale1')!;
    expect(revenue.netMargin).toBe(margin);
    expect(revenue.carrierCost).toBe(carrier);
    expect(revenue.shippingCostCollected).toBe(collected);
    expect(revenue.taxCollected).toBe(2);
  });
});
