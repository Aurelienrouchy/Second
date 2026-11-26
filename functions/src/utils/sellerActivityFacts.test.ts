import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
import {createFirestoreMock, type MockFirestore} from './testHelpers/firestoreMock';

const h = vi.hoisted(() => ({fs: null as MockFirestore | null, sessions: 0, admins: [] as boolean[], inTx: false,
  retries: 1, queries: [] as string[], beforeRetry: null as (() => void) | null}));
vi.mock('../config/firebase', async () => {
  const {Timestamp: NativeTimestamp} = await import('firebase-admin/firestore');
  const sourceRevision = NativeTimestamp.fromMillis(1_700_000_000_000);
  const annotate = (snap: any) => ({...snap, updateTime: snap.exists === false ? undefined : sourceRevision});
  return {auth:{getUser:async(uid:string)=>{if(h.inTx)h.sessions++;return {uid,disabled:false,tokensValidAfterTime:new Date(0).toISOString()};}},db: {
    collection: (path: string) => h.fs!.db.collection(path),
    runTransaction: async (fn: any) => {
      let result;
      for (let attempt = 0; attempt < h.retries; attempt++) {
        if (attempt) h.beforeRetry?.();
        h.inTx = true;
        try {result = await h.fs!.db.runTransaction(async tx => fn({get: async (ref: any) => {
          h.queries.push(ref.path ?? 'query');
          const snap = await tx.get(ref);
          return 'docs' in snap ? {...snap, docs: snap.docs.map(annotate)} : annotate(snap);
        }}));} finally {h.inTx = false;}
      }
      return result;
    },
  }};
});
vi.mock('./supportRequest', async () => {
  const {createHash} = await import('node:crypto');
  const {HttpsError} = await import('firebase-functions/v2/https');
  return {
    supportUid: (request: any) => {
      if (!request.auth) throw new HttpsError('unauthenticated', 'auth');
      if (request.auth.uid !== request.data.expectedUid) throw new HttpsError('permission-denied', 'session');
      return request.auth.uid;
    },
    supportObject: (value: any, keys: string[]) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k)))
        throw new HttpsError('invalid-argument', 'shape');
      return value;
    },
    supportId: (value: any) => {
      if (typeof value !== 'string' || !value || value.length > 128 || value.includes('/')) throw new HttpsError('invalid-argument', 'id');
      return value;
    },
    supportRevision: (s: any) => s.updateTime ? `${s.updateTime.seconds}:${s.updateTime.nanoseconds}` : null,
    supportSourceHash: (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex'),
    supportCurrentAdminSession: async () => {expect(h.inTx).toBe(true); h.sessions++; return true;},
    supportAdmin: async (tx: any, uid: string, claim: boolean) => {
      h.admins.push(claim);
      const d = (await tx.get(h.fs!.db.collection('users').doc(uid))).data();
      if (d?.isAdmin !== true || d?.isActive === false) throw new HttpsError('permission-denied', 'private role');
    },
  };
});
import {readSellerActivityFacts} from './sellerActivityFacts';

const time = () => Timestamp.fromMillis(Date.now() - 30_000);
const order = (extra: Record<string, unknown> = {}) => ({buyerId: 'buyer', sellerId: 'seller', currency: 'CAD',
  amount: 40, sellerPayout: 40, totalAmount: 50, status: 'paid', createdAt: time(), ...extra});
const request = (extra: Record<string, unknown> = {}) => ({auth: {uid: 'admin', token: {auth_time: Math.floor(Date.now() / 1000)}},
  data: {expectedUid: 'admin', expectedAdminUid: 'admin', mode: 'seller_activity_facts_observe', capability: 'seller_activity_facts_v1', transactionId: 'anchor', ...extra}});
const fs = createFirestoreMock({enforceReadBeforeWrite: true});
function seed(extra: Record<string, unknown> = {}) {fs.setDoc('transactions/anchor', order(extra));}
function entry(owner: string, id: string, type: string, amount: number, extra: Record<string, unknown> = {}) {
  fs.setDoc(`wallets/${owner}/ledger/${id}`, {transactionId: 'anchor', type, amount, createdAt: time(), ...extra});
}
async function first(extra: Record<string, unknown> = {}) {return readSellerActivityFacts(request(extra));}
beforeEach(() => {fs.reset(); h.fs = fs; h.sessions = 0; h.admins = []; h.queries = []; h.retries = 1; h.beforeRetry = null;
  fs.setDoc('users/admin', {isAdmin: true}); fs.setDoc('users/seller', {createdAt: time(), email: 'private@example.test', fullName: 'Private'}); seed();});

describe('seller native activity facts', () => {
  it('qualifies a mixed capture/debit and one original gross credit, separately from release', async () => {
    const released = time();
    seed({paidVia: 'wallet_and_card', walletAmountUsed: 1000, stripePaymentIntentId: 'pi_native', stripeChargeId: 'ch_native',
      capturedCardCents: 4000, paidAt: time(), sellerCreditedCents: 4000, sellerPendingCreditCents: 3000, sellerDebtRepaidCents: 1000,
      sellerReleasedCents: 3000, fundsReleasedAt: released});
    entry('buyer', 'debit', 'purchase_debit', 1000);
    entry('seller', 'credit', 'sale_credit', 3000);
    entry('seller', 'debt', 'debt_repayment', 1000, {description: 'Vente — régularisation du solde dû'});
    entry('seller', 'release', 'funds_released', 3000, {createdAt: released});
    entry('seller', 'release_debt', 'debt_repayment', 500, {description: 'Fonds libérés — régularisation du solde dû'});
    const page = await first(), item = page.items[0];
    expect(item.amounts.orderTotal.amountCents).toBe(5000);
    expect(item.amounts.articlePrice.amountCents).toBe(4000);
    expect(item.amounts.cardCaptured.amountCents).toBe(4000);
    expect(item.amounts.walletDebited.amountCents).toBe(1000);
    expect(item.amounts.sellerCredit.amountCents).toBe(4000);
    expect(item.amounts.release.amountCents).toBe(3000);
    expect(item.paidAt.qualification).toBe('native_timestamp');
    expect(page.profile.authCreatedAt.at).toBeNull();
    expect(JSON.stringify(page)).not.toContain('private@example.test');
    expect(JSON.stringify(page)).not.toContain('balanceAfter');
    expect(page.pageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.writeOps).toEqual([]);
  });

  it('qualifies a native full-wallet receipt and exact settled wallet refund', async () => {
    const paid = time(), refunded = time();
    seed({paidVia: 'wallet', walletAmountUsed: 5000, paidAt: paid, walletPayment: {schemaVersion: 1, state: 'committed',
      actorUid: 'buyer', amountCents: 5000, currency: 'CAD', committedAt: paid, ledgerId: 'debit'},
      refund: {intentId: 'rf_native', attemptId: 'attempt', buyerId: 'buyer', sellerId: 'seller', currency: 'cad', state: 'succeeded',
        requestedAt: refunded, requestedAtMs: refunded.toMillis(), fundsAppliedAt: refunded, outstandingCardCents: 0,
        cardAmountCents: 0, capturedCardCents: 0, walletAmountCents: 5000, sellerDebitCents: 0, paymentIntentId: null}});
    entry('buyer', 'debit', 'purchase_debit', 5000, {createdAt: paid});
    entry('buyer', 'refund_credit_rf_native', 'refund_credit', 5000, {refundIntentId: 'rf_native', createdAt: refunded});
    const {amounts} = (await first()).items[0];
    expect(amounts.walletDebited.amountCents).toBe(5000);
    expect(amounts.cardCaptured.amountCents).toBeNull();
    expect(amounts.nativeRefund.total.amountCents).toBe(5000);
    expect(amounts.nativeRefund.wallet.amountCents).toBe(5000);
    expect(amounts.nativeRefund.card.amountCents).toBe(0);
  });

  it('never qualifies a status, non-native date, unknown currency, or conflicting PI', async () => {
    seed({paidAt: new Date(), capturedCardCents: 5000, stripePaymentIntentId: 'pi_same', stripeChargeId: 'ch_native'});
    fs.setDoc('transactions/other', order({stripePaymentIntentId: 'pi_same', currency: 'USD'}));
    const page = await first();
    expect(page.items[0].amounts.cardCaptured.amountCents).toBeNull();
    expect(page.items[0].paidAt.at).toBeNull();
    expect(page.items[1].amounts.orderTotal).toMatchObject({qualification: 'unknown', amountCents: null, currency: null});
    fs.setDoc('transactions/other', null); seed({status: 'paid'});
    expect((await first()).items[0].amounts.cardCaptured.amountCents).toBeNull();
  });

  it('qualifies native full-card capture without requiring a legacy paidVia placeholder, and rejects one-cent drift', async () => {
    seed({stripePaymentIntentId: 'pi_native', stripeChargeId: 'ch_native', capturedCardCents: 5000, paidAt: time()});
    entry('buyer', 'unrelated', 'purchase_debit', 1, {transactionId: 'other_order'});
    expect((await first()).items[0].amounts.cardCaptured.amountCents).toBe(5000);
    seed({stripePaymentIntentId: 'pi_native', stripeChargeId: 'ch_native', capturedCardCents: 4999, paidAt: time()});
    expect((await first()).items[0].amounts.cardCaptured.amountCents).toBeNull();
    seed({totalAmount: 50.001});
    expect((await first()).items[0].amounts.orderTotal.amountCents).toBeNull();
  });

  it('keeps unknown legacy rows, advances by the last inspected ID and ends on an empty page', async () => {
    fs.setDoc('transactions/anchor', order({sellerId: 'anchor_seller'}));
    for (let i = 19; i >= 0; i--) fs.setDoc(`transactions/legacy_${String(i).padStart(2, '0')}`, {sellerId: 'anchor_seller'});
    // First page includes anchor and 19 unknowns; a second page has the final unknown.
    const page = await first();
    expect(page.items.filter(i => i.qualification === 'unknown')).toHaveLength(19);
    expect(page.pagination.nextCursor?.lastId).toBe('legacy_18');
    const next = await first({cursor: page.pagination.nextCursor, expectedSource: page.source});
    expect(next.items.map(i => i.transactionId)).toEqual(['legacy_19']);
    expect(next.pagination.hasMore).toBe(false);
    const empty = await first({cursor: {lastId: 'zzzz', scopeHash: page.source.scopeHash}, expectedSource: page.source});
    expect(empty.pagination.inspected).toBe(0); expect(empty.pagination.nextCursor).toBeNull();
  });

  it('rejects client seller selection, another source/cursor, changed anchor and stale session', async () => {
    await expect(first({sellerId: 'another'})).rejects.toMatchObject({code: 'invalid-argument'});
    await expect(first({expectedAdminUid: 'other'})).rejects.toMatchObject({code: 'permission-denied'});
    const page = await first();
    await expect(first({cursor: {lastId: 'x', scopeHash: '0'.repeat(64)}, expectedSource: page.source})).rejects.toMatchObject({code: 'invalid-argument'});
    seed({amount: 41});
    await expect(first({expectedSource: page.source})).rejects.toMatchObject({code: 'failed-precondition'});
    const stale = request(); stale.auth.token.auth_time -= 301;
    await expect(readSellerActivityFacts(stale)).rejects.toMatchObject({code: 'unauthenticated'});
  });

  it('rechecks native session and private role inside each transaction retry', async () => {
    h.retries = 2; h.beforeRetry = () => fs.setDoc('users/admin', {isAdmin: false});
    await expect(first()).rejects.toMatchObject({code: 'permission-denied'});
    expect(h.sessions).toBe(2); expect(h.admins).toEqual([false, false]);
    expect(fs.writeOps).toEqual([]);
  });

  it('saturation, duplicate original credits and refund fragments remain unknown', async () => {
    seed({sellerCreditedCents: 4000, sellerPendingCreditCents: 4000, sellerDebtRepaidCents: 0,
      refund: {allocation: {fragment: true}, state: 'succeeded', fundsAppliedAt: time()}});
    entry('seller', 'credit1', 'sale_credit', 2000); entry('seller', 'credit2', 'sale_credit', 2000);
    let item = (await first()).items[0];
    expect(item.amounts.sellerCredit.amountCents).toBeNull();
    expect(item.amounts.nativeRefund.total).toMatchObject({amountCents: null, reason: 'refund_fragment_not_complete_history'});
    for (let i = 0; i < 21; i++) entry('seller', `extra_${i}`, 'unknown', 1);
    item = (await first()).items[0];
    expect(item.financialSources.sellerLedger?.hasMore).toBe(true);
    expect(item.amounts.sellerCredit.amountCents).toBeNull();
  });
});
