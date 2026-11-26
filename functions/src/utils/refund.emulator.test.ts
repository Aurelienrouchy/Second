/** Real Admin SDK transactions against demo-second only; Stripe remains simulated. */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const enabled = process.env.SECOND_REFUND_SDK_TESTS === '1';
if (enabled && (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host) || process.env.GCLOUD_PROJECT !== 'demo-second')) {
  throw new Error('Refund SDK tests require explicit localhost emulator + demo-second; real project forbidden');
}
const holder = vi.hoisted(() => ({ db: null as FirebaseFirestore.Firestore | null,
  refunds: {} as Record<string, any>, creates: 0, status: 'pending', paymentIntents: {} as Record<string, any> }));
vi.mock('../config/firebase', () => ({ get db() { return holder.db!; }, get FieldValue() { return FieldValue; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ refunds: {
  create: async (params: any) => {
    holder.creates++;
    const result = { id: 're_sdk', payment_intent: params.payment_intent, currency: 'cad', amount: params.amount,
      metadata: params.metadata, status: holder.status };
    holder.refunds[result.id] = result;
    return result;
  },
  retrieve: async (id: string) => ({ ...holder.refunds[id] }),
  list: async (params: any) => ({ data: Object.values(holder.refunds).filter(r => r.payment_intent === params.payment_intent), has_more: false }),
}, paymentIntents: { retrieve: async (id: string) => ({ ...holder.paymentIntents[id] }) } }) }));
vi.mock('./notifications', () => ({ sendPushNotification: async () => {} }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
import { walletWithdraw } from '../callable/wallet';
import { issueTransactionRefund, observePurchaseRefund, resumeTransactionRefund } from './refund';
import { recordPaymentCaptureAnomaly, inspectPaymentCaptureAnomalyProof } from './paymentCaptureAnomaly';
import { handleDisputeCreated, handleDisputeClosed } from '../http/stripe/disputes';

describe.skipIf(!enabled)('durable refund with real Firestore Admin SDK', () => {
  const app = enabled ? initializeApp({ projectId: 'demo-second' }, 'refund-sdk-tests') : null;
  beforeAll(() => { if (app) holder.db = getFirestore(app); });
  const paths = ['transactions/sdk_refund_sale', 'wallets/sdk_refund_seller', 'wallets/sdk_refund_buyer',
    'articles/sdk_refund_article', 'disputes/sdk_refund_claim', 'users/sdk_refund_seller', 'rate_limits/sdk_refund_seller_walletWithdraw'];
  const captureOperations = new Set<string>();
  async function clean() {
    if (!holder.db) return;
    const data = (await holder.db.doc(paths[0]).get()).data();
    if (data?.refund?.intentId) {
      await holder.db.doc('failed_operations/refund_' + data.refund.intentId).delete();
    }
    for (const id of captureOperations) await holder.db.doc('failed_operations/' + id).delete();
    captureOperations.clear();
    for (const path of paths) await holder.db.recursiveDelete(holder.db.doc(path));
  }
  beforeEach(async () => {
    await clean(); holder.creates = 0; holder.status = 'pending'; holder.refunds = {}; holder.paymentIntents = {};
    await holder.db!.doc(paths[0]).set({ status: 'delivered', buyerId: 'sdk_refund_buyer', sellerId: 'sdk_refund_seller',
      articleId: 'sdk_refund_article', paidVia: 'mixed', walletAmountUsed: 1000, totalAmount: 50,
      stripePaymentIntentId: 'pi_sdk', sellerCreditedCents: 4500, sellerPendingCreditCents: 4500, sellerHeldCreditCents: 4500 });
    await holder.db!.doc(paths[1]).set({ balance: 2500, pendingBalance: 9000, heldBalance: 4500, sellerDebt: 0, status: 'active' });
    await holder.db!.doc(paths[2]).set({ balance: 300, status: 'active' });
    await holder.db!.doc(paths[3]).set({ isSold: true, activeTransactionId: 'sdk_refund_sale' });
    await holder.db!.doc(paths[4]).set({ status: 'open', transactionId: 'sdk_refund_sale' });
  });
  afterAll(async () => { await clean(); if (app) await deleteApp(app); });
  const sale = async () => (await holder.db!.doc(paths[0]).get()).data()!;
  const refund = (key: string) => issueTransactionRefund('sdk_refund_sale', {}, { idempotencyKey: key, source: key });

  it('two concurrent initiators join one intention and one external request', async () => {
    const results = await Promise.all([refund('rf_sdk_admin'), refund('rf_sdk_return')]);
    const data = await sale();
    expect((await holder.db!.doc('failed_operations/refund_' + data.refund.intentId).get()).exists).toBe(true);
    expect(holder.creates).toBe(1); expect(results.map(r => r.intentId)).toEqual([data.refund.intentId, data.refund.intentId]);
    expect(results.every(r => !r.success)).toBe(true); expect(data.refundBlocked).toBe(true);
    expect((await holder.db!.doc(paths[2]).get()).data()!.balance).toBe(300);
  });

  it('concurrent success webhook/replay reconciles each ledger and commercial claim exactly once', async () => {
    await refund('rf_sdk'); holder.refunds.re_sdk.status = 'succeeded';
    await Promise.all([observePurchaseRefund('sdk_refund_sale', 're_sdk'), observePurchaseRefund('sdk_refund_sale', 're_sdk'), refund('rf_sdk_other')]);
    expect((await sale()).refund.fundsAppliedAt).toBeTruthy(); expect((await sale()).refundBlocked).toBe(false);
    expect((await holder.db!.doc(paths[1]).get()).data()).toMatchObject({ pendingBalance: 9000, heldBalance: 0, balance: 2500, sellerDebt: 0 });
    expect((await holder.db!.doc(paths[2]).get()).data()!.balance).toBe(1300);
    const debits = await holder.db!.doc(paths[1]).collection('ledger').where('type', '==', 'refund_debit').get();
    const credits = await holder.db!.doc(paths[2]).collection('ledger').where('type', '==', 'refund_credit').get();
    expect(debits.size).toBe(1); expect(credits.size).toBe(1);
    expect((await holder.db!.doc(paths[4]).get()).data()!.status).toBe('resolved'); expect(holder.creates).toBe(1);
  });

  it('released reserve, ledger reads, article ownership query and financial guards obey SDK read-before-write', async () => {
    await holder.db!.doc(paths[0]).update({ status: 'completed', sellerReleasedCents: 4500 });
    await holder.db!.doc(paths[1]).update({ balance: 7000, heldBalance: 0 });
    await refund('rf_sdk_reserve');
    await holder.db!.doc('users/sdk_refund_seller').set({ stripeAccountId: 'acct_sdk', stripeChargesEnabled: true, stripePayoutsEnabled: true });
    vi.stubEnv('PAYMENTS_ENABLED', 'true');
    try {
      // Run the actual callable guard: all five targeted Firestore queries and
      // the wallet lock execute with the Admin SDK, no Firestore double.
      await expect(walletWithdraw.run({ auth: { uid: 'sdk_refund_seller', token: {} },
        data: { amount: 1000 } } as any)).rejects.toMatchObject({ code: 'failed-precondition' });
      await expect(walletWithdraw.run({ auth: { uid: 'sdk_refund_seller', token: {} },
        data: { amount: 1000 } } as any)).rejects.toThrow('Un litige financier');
    } finally { vi.unstubAllEnvs(); }
    const guarded = (await holder.db!.doc(paths[1]).get()).data();
    expect(guarded).toMatchObject({ balance: 2500, heldBalance: 4500, pendingBalance: 9000 });
    holder.refunds.re_sdk.status = 'succeeded'; const settled = await observePurchaseRefund('sdk_refund_sale', 're_sdk');
    expect(settled.success).toBe(true);
    expect((await holder.db!.doc(paths[1]).get()).data()).toMatchObject({ balance: 2500, heldBalance: 0, pendingBalance: 9000 });
  });

  it('pending bank overlap followed by WON resumes its same reserve exactly once using real SDK transactions', async () => {
    await holder.db!.doc(paths[0]).update({ status: 'completed', sellerReleasedCents: 4500 });
    await holder.db!.doc(paths[1]).update({ balance: 7000, heldBalance: 0 });
    const initial = await refund('rf_sdk_bank_wait');
    const dispute = { id: 'du_sdk_refund_wait', payment_intent: 'pi_sdk', currency: 'cad', amount: 4000, status: 'needs_response' };
    await handleDisputeCreated(dispute);
    expect(await observePurchaseRefund('sdk_refund_sale', 're_sdk')).toMatchObject({ status: 'pending', bankWaiting: true });
    expect((await sale()).bankDispute.reconciliationRequired).not.toBe(true);
    await handleDisputeClosed({ ...dispute, status: 'won' });
    holder.refunds.re_sdk.status = 'succeeded';
    const results = await Promise.all([resumeTransactionRefund('sdk_refund_sale'), observePurchaseRefund('sdk_refund_sale', 're_sdk')]);
    expect(results.every(r => r.success && r.intentId === initial.intentId)).toBe(true);
    expect((await holder.db!.doc(paths[1]).get()).data()).toMatchObject({ balance: 2500, pendingBalance: 9000, heldBalance: 0, sellerDebt: 0 });
    expect((await holder.db!.doc(paths[2]).get()).data()!.balance).toBe(1300);
    expect((await holder.db!.doc(paths[1]).collection('ledger').where('type', '==', 'refund_debit').get()).size).toBe(1);
    expect((await holder.db!.doc(paths[2]).collection('ledger').where('type', '==', 'refund_credit').get()).size).toBe(1);
    expect(holder.creates).toBe(1);
  });

  it('concurrent capture anomalies keep one immutable signed case and a provider-only refresh using real SDK transactions', async () => {
    const evidence = { id: 'pi_sdk_anomaly', currency: 'cad', amount: 5000, amount_received: 3500,
      metadata: { transactionId: 'sdk_refund_sale' }, status: 'succeeded' };
    const ids = await Promise.all(['evt_sdk_capture_1', 'evt_sdk_capture_2'].map(eventId =>
      recordPaymentCaptureAnomaly(evidence, 'payment_identity_mismatch', { eventId }, 'pi_sdk')));
    ids.forEach(id => captureOperations.add(id));
    expect(ids[0]).toBe(ids[1]);
    holder.paymentIntents.pi_sdk_anomaly = evidence;
    const inspected = await inspectPaymentCaptureAnomalyProof(ids[0], 'sdk_operator');
    expect(inspected).toMatchObject({ status: 'pending', actionRequired: true, automaticRefundAllowed: false,
      providerLookupState: 'verified', currentProviderProof: { paymentIntentId: 'pi_sdk_anomaly', collectedAmountCents: 3500 } });
    const op = (await holder.db!.doc('failed_operations/' + ids[0]).get()).data()!;
    expect(op.payload.eventIds.sort()).toEqual(['evt_sdk_capture_1', 'evt_sdk_capture_2']);
    expect(op.payload.signedEvidence.originalPaymentIntentId).toBe('pi_sdk');
    expect((await sale()).stripePaymentIntentId).toBe('pi_sdk');
    expect((await holder.db!.doc(paths[2]).get()).data()!.balance).toBe(300);
    expect(holder.creates).toBe(0);
  });
});
