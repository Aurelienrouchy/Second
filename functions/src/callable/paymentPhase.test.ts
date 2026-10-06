import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFirestoreMock, createStripeMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore, StripeMock } from '../utils/testHelpers/firestoreMock';
const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, stripe: null as StripeMock | null }));
const fs = createFirestoreMock(); const stripe = createStripeMock(); holder.fs = fs; holder.stripe = stripe;
vi.mock('../config/firebase', () => ({ get db() { return holder.fs!.db; }, get FieldValue() { return holder.fs!.FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => holder.stripe!.client }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => null }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: () => ({ callerKey: 'user1', isAuthenticated: true }) }));
vi.mock('firebase-functions/logger', () => ({ info() {}, warn() {}, error() {}, debug() {} }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_: unknown, handler: unknown) => handler }));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (_: unknown, handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));

import { walletWithdraw, payWithWallet } from './wallet';
import { purchaseShopTier } from './shopTier';
import { createSwapTopUpCheckout, proposeMultiSwap } from './swaps';
import { createStripeCheckout } from './payments';
import { isPaymentsEnabled } from '../config/featureFlags';

beforeEach(() => { fs.reset(); stripe.reset(); vi.stubEnv('PAYMENTS_ENABLED', 'false'); });
type Call = (r: { auth: { uid: string }, data: Record<string, unknown> }) => Promise<unknown>;

describe('free MVP server policy', () => {
  it.each([walletWithdraw, payWithWallet, purchaseShopTier, createSwapTopUpCheckout, createStripeCheckout])('closes a new financial rail before external work', async callable => {
    await expect((callable as unknown as Call)({ auth: { uid: 'user1' }, data: {} })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(stripe.calls.paymentIntentsCreate).toHaveLength(0);
    expect(stripe.calls.transfersCreate).toHaveLength(0);
    expect(stripe.calls.payoutsCreate).toHaveLength(0);
    expect(fs.writeOps).toHaveLength(0);
  });
  it('keeps shipping closed for wallet-only checkout even when payments are enabled', async () => {
    vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'false');
    fs.setDoc('wallets/user1', { balance: 5000, status: 'active' });
    fs.setDoc('transactions/order', { buyerId: 'user1', sellerId: 'user2', deliveryType: 'shipping', status: 'pending_payment', totalAmount: 25 });
    await expect((payWithWallet as unknown as Call)({ auth: { uid: 'user1' }, data: { transactionId: 'order' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('wallets/user1')!.balance).toBe(5000);
  });
  it('rejects a top-up proposal without creating a swap', async () => {
    await expect((proposeMultiSwap as unknown as Call)({ auth: { uid: 'user1' }, data: {
      initiatorId: 'user1', initiatorName: 'Buyer', receiverId: 'user2', receiverName: 'Seller',
      initiatorItems: [{ articleId: 'a1' }], receiverItems: [{ articleId: 'a2' }], cashTopUp: { payerId: 'user1', amount: 100 },
    } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.writeOps).toHaveLength(0);
  });
  it.each([undefined, '', 'false', '1', 'yes'])('defaults closed for value %s', value => {
    vi.stubEnv('PAYMENTS_ENABLED', value);
    expect(isPaymentsEnabled()).toBe(false);
  });
  it('requires explicit server enablement', () => {
    vi.stubEnv('PAYMENTS_ENABLED', 'true'); expect(isPaymentsEnabled()).toBe(true);
  });
});
