/** Author 03B3B: real quote/claim handlers, explicit eligible fixtures. Provider IO simulated. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, retrieve: null as any, get: null as any, analytics: null as any, labels: 0 }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return h.fs!.db; }, get FieldValue() { return { ...h.fs!.FieldValue, serverTimestamp: () => new Date() }; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: (...args: any[]) => h.retrieve(...args) } }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({ getPurchaseRates: async () => purchaseRates(), getPurchaseRatesForShipment: (...args: any[]) => h.get(...args) }) }));
vi.mock('../utils/labelFulfillment', async original => ({ ...await original<any>(), createLabelIdempotent: async () => { h.labels++; return 'failed'; } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid, isAuthenticated: !!r.auth }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: (...args:any[]) => h.analytics(...args) }));
import { quoteShippingPurchase } from './payments/shippingPurchase';
import { createTransaction } from './payments/checkout';
import { payWithWallet } from './wallet';
import { purchaseAddress, purchaseAccount, purchaseRates, seedPurchase, personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
import { invalidateConnectObservation } from '../utils/connectEligibility';
import { createHash } from 'node:crypto';
import { eligibilityVersion } from '../shared/eligibility';
const call = (fn: any, data: any, uid = 'buyer') => fn.run({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000),} }, data });
const pay = (id: string, uid = 'buyer') => call(payWithWallet, { transactionId: id }, uid);
function change(path: string, patch: any) { fs.setDoc(path, { ...fs.getDoc(path), ...patch }); }
async function reserved() {
  const q = await call(quoteShippingPurchase, { articleId: 'article', shippingAddress: purchaseAddress });
  const r = await call(createTransaction, { deliveryType: 'shipping', quoteId: q.quoteId, rateId: q.rates[0].rateId, expectedTotal: q.rates[0].totalAmount });
  return { q, id: r.transactionId as string };
}
function conservation(id: string) {
  const paths = ['wallets/buyer', 'wallets/seller', 'wallets/seller/ledger/other_sale', 'transactions/old', `transactions/${id}`, 'articles/article'];
  const before = structuredClone(paths.map(p => fs.getDoc(p)));
  const writes = fs.writeOps.length;
  return () => { expect(paths.map(p => fs.getDoc(p))).toEqual(before); expect(fs.writeOps.slice(writes).filter(o => /^(wallets|transactions|articles)\//.test(o.path))).toHaveLength(0); expect(h.labels).toBe(0); };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T16:00:00Z')); vi.stubEnv('PAYMENTS_ENABLED', 'true'); vi.stubEnv('SHIPPING_ENABLED', 'true');
  fs.reset(); seedPurchase(fs); h.retrieve = async () => purchaseAccount(); h.get = async () => purchaseRates(); h.labels = 0; h.analytics = async () => {};
  fs.setDoc('wallets/buyer', { status: 'active', currency: 'cad', balance: 10000, pendingBalance: 700, heldBalance: 800 });
  fs.setDoc('wallets/seller', { status: 'active', currency: 'cad', balance: 2500, pendingBalance: 9000, heldBalance: 4500 });
  fs.setDoc('wallets/seller/ledger/other_sale', { type: 'sale_pending', amount: 9000, transactionId: 'old' });
  fs.setDoc('transactions/old', { buyerId: 'other', sellerId: 'seller', articleId: 'other_article', status: 'delivered', deliveryType: 'shipping', shippingAddress: { province: 'ON' } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it.each(['16','17','missing','malformed','inactive','review'])('current quote/claim does not grant changed buyer %s a new debit', async kind => {
  const { id } = await reserved();
  if (kind === '16' || kind === '17') change('users/buyer', { dateOfBirth: kind === '16' ? '2010-01-01' : '2009-01-01' });
  if (kind === 'missing') change('users/buyer', { dateOfBirth: null });
  if (kind === 'malformed') change('users/buyer', { dateOfBirth: { year: 2000 } });
  if (kind === 'inactive') change('users/buyer', { isActive: false });
  if (kind === 'review') fs.setDoc('eligibility_profiles/buyer', { activeReviews: { r: { scope: 'buy', active: true } } });
  const conserved = conservation(id); await expect(pay(id)).rejects.toMatchObject({ code: 'permission-denied' }); conserved();
});
it.each(['professional','missing','review','minor','inactive','origin_on','account_stale'])('seller %s blocks new payment with private generic refusal', async kind => {
  const { id } = await reserved();
  if (kind === 'professional') fs.setDoc('eligibility_profiles/seller', personalProfile('seller', 'professional'));
  if (kind === 'missing') fs.setDoc('eligibility_profiles/seller', {});
  if (kind === 'review') change('eligibility_profiles/seller', { activeReviews: { r: { scope: 'sell', active: true, internalNote: 'PRIVATE' } } });
  if (kind === 'minor') change('users/seller', { dateOfBirth: '2009-01-01' });
  if (kind === 'inactive') change('users/seller', { isActive: false });
  if (kind === 'origin_on') change('users/seller', { addresses: [{ ...purchaseAddress, province: 'ON', postalCode: 'M5V1A1' }] });
  if (kind === 'account_stale') h.retrieve = async () => ({ ...purchaseAccount(), charges_enabled: false });
  const conserved = conservation(id); await expect(pay(id)).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'counterparty_unavailable' } }); conserved();
});
it.each(['price','fees','total','currency','destination','item','parcel','lock','seller','quote'])('isolated %s inconsistency after canonical claim never consumes money', async kind => {
  const { id, q } = await reserved(); const path = `transactions/${id}`;
  if (kind === 'price') change('articles/article', { price: 51 });
  if (kind === 'fees') change(path, { serviceFee: 0 });
  if (kind === 'total') change(path, { totalAmount: '64.75' });
  if (kind === 'currency') change(path, { currency: 'USD' });
  if (kind === 'destination') change(path, { shippingAddress: { ...purchaseAddress, province: 'ON', postalCode: 'M5V1A1' } });
  if (kind === 'item') change('articles/article', { title: 'New agreement needed' });
  if (kind === 'parcel') change('shipping_packages/article', { version: 2 });
  if (kind === 'lock') change('articles/article', { activeTransactionId: 'other_order' });
  if (kind === 'seller') change('articles/article', { sellerId: 'other' });
  if (kind === 'quote') change(`shipping_quotes/${q.quoteId}`, { state: 'ready' });
  const conserved = conservation(id); await expect(pay(id)).rejects.toBeDefined(); conserved();
});
it.each(['pi','wallet_marker','ledger_partial','bank','refund'])('existing %s exposure is never a fresh pure-wallet debit', async kind => {
  const { id } = await reserved();
  if (kind === 'pi') change(`transactions/${id}`, { stripePaymentIntentId: 'pi_unproven' });
  if (kind === 'wallet_marker') change(`transactions/${id}`, { walletAmountUsed: 1000 });
  if (kind === 'ledger_partial') fs.setDoc('wallets/buyer/ledger/partial', { type: 'purchase_debit', transactionId: id, amount: 1000, balanceAfter: 9000, createdAt: new Date() });
  if (kind === 'bank') change(`transactions/${id}`, { bankDispute: { id: 'dp_local', state: 'open' } });
  if (kind === 'refund') change(`transactions/${id}`, { refundBlocked: true });
  const conserved = conservation(id); await expect(pay(id)).rejects.toBeDefined(); conserved();
});
it('new canonical shipping debit is exact and replay is read-only with old missing proofs and flags OFF', async () => {
  fs.setDoc('eligibility_profiles/buyer', personalProfile('buyer', 'professional'));
  const { id } = await reserved(); const sellerBefore = structuredClone(fs.getDoc('wallets/seller'));
  expect(await pay(id)).toMatchObject({ success: true, newBalance: 3525, replay: false, paymentCommitted: true });
  expect(fs.getDoc('wallets/buyer')).toMatchObject({ balance: 3525, pendingBalance: 700, heldBalance: 800 });
  expect(fs.getDoc('wallets/seller')).toEqual(sellerBefore);
  expect(fs.getDoc(`transactions/${id}`)).toMatchObject({ status: 'paid', walletAmountUsed: 6475, labelCreationPending: true });
  expect(fs.writeOps.filter(o => o.method === 'set' && o.path.startsWith('wallets/buyer/ledger/'))).toHaveLength(1);
  change('users/buyer', { dateOfBirth: null }); fs.setDoc('eligibility_profiles/seller', {}); vi.stubEnv('PAYMENTS_ENABLED','false'); vi.stubEnv('SHIPPING_ENABLED','false');
  const writes = fs.writeOps.length, labels = h.labels;
  expect(await pay(id)).toMatchObject({ success: true, replay: true, paymentCommitted: true, currentStatus: 'paid', newBalance: 3525 });
  expect(fs.writeOps).toHaveLength(writes); expect(h.labels).toBe(labels);
});
it('provider source changed during verification refuses at final debit boundary', async () => {
  const { id } = await reserved(); h.get = async () => { change('users/buyer', { dateOfBirth: '2009-01-01' }); return purchaseRates(); };
  const conserved = conservation(id); await expect(pay(id)).rejects.toMatchObject({ code: 'permission-denied' }); conserved();
});
it('causal invalidation during stored-rate retrieval refuses without resetting order or price', async () => {
  const { id } = await reserved(); h.get = async () => { await invalidateConnectObservation('seller','acct_purchase',{ stripeChargesEnabled: false }); return purchaseRates(); };
  const conserved = conservation(id); await expect(pay(id)).rejects.toBeDefined(); conserved();
});
it('actor authorization precedes bank/refund/private admission errors', async () => {
  const { id } = await reserved(); change(`transactions/${id}`, { refundBlocked: true });
  const conserved = conservation(id); await expect(pay(id,'other')).rejects.toMatchObject({ code: 'permission-denied' }); conserved();
});
it.each(['bank','reconciliation','legacy_hold','refund','commercial','saturated'])('available balance cannot bypass existing withdrawal protection %s', async kind => {
  const { id } = await reserved();
  const sale: any = { buyerId: 'other', sellerId: 'buyer', articleId: 'buyer_sale', status: 'completed', deliveryType: 'shipping' };
  if (kind === 'bank') Object.assign(sale, { disputeId:'dp_active', bankDispute:{ id:'dp_active',state:'open' } });
  if (kind === 'reconciliation') sale.bankDispute = { id:'dp_closed',state:'closed',outcome:'won',closedAt:new Date(),reconciliationRequired:true };
  if (kind === 'legacy_hold') sale.disputeFreezeCents = 4500;
  if (kind === 'refund') sale.refundBlocked = true;
  if (kind === 'commercial') sale.disputed = true;
  if (kind === 'saturated') for(let i=0;i<201;i++) fs.setDoc(`transactions/blocked_${i}`,{...sale,refundBlocked:true});
  else fs.setDoc('transactions/buyer_sale',sale);
  const conserved=conservation(id); await expect(pay(id)).rejects.toMatchObject({ details:{reason:'wallet_funds_blocked'} }); conserved();
});
it.each(['cash_meetup','closed_bank','settled_refund'])('qualified old %s imposes no new wallet freeze', async kind => {
  const { id } = await reserved();
  fs.setDoc('transactions/buyer_sale',{ sellerId:'buyer', buyerId:'old', articleId:'other',status:'completed',
    ...(kind==='cash_meetup'?{deliveryType:'meetup',disputed:true}:kind==='closed_bank'?{deliveryType:'shipping',disputeId:'dp_closed',bankDispute:{id:'dp_closed',state:'closed',outcome:'won',closedAt:new Date()}}:{deliveryType:'shipping',refundBlocked:false}) });
  expect(await pay(id)).toMatchObject({ newBalance:3525,paymentCommitted:true });
});
it('new bank obligation during GET blocks consumption before debit', async () => {
  const { id } = await reserved(); h.get=async()=>{fs.setDoc('transactions/new_bank_sale',{sellerId:'buyer',status:'completed',disputeFreezeCents:4500});return purchaseRates();};
  const conserved=conservation(id); await expect(pay(id)).rejects.toMatchObject({ details:{reason:'wallet_funds_blocked'} }); conserved();
});
it.each(['duplicate','wrong_amount','wrong_currency','no_timestamp','proof_only','pending_ledger','unknown_ledger'])('ambiguous existing money %s is review, not debit or fake receipt', async kind => {
  const { id } = await reserved();
  const entry:any={transactionId:id,type:'purchase_debit',amount:6475,balanceAfter:3525,createdAt:new Date()};
  change(`transactions/${id}`,{status:'paid',paidVia:'wallet',walletAmountUsed:6475});
  if(kind==='wrong_amount') entry.amount=1000;
  if(kind==='wrong_currency') entry.currency='USD';
  if(kind==='no_timestamp') delete entry.createdAt;
  if(kind==='pending_ledger') change(`transactions/${id}`,{status:'pending_payment'});
  if(kind==='proof_only') change(`transactions/${id}`,{walletPayment:{state:'committed'}});
  else fs.setDoc('wallets/buyer/ledger/debit',entry);
  if(kind==='duplicate') fs.setDoc('wallets/buyer/ledger/debit2',entry);
  if(kind==='unknown_ledger'){change(`transactions/${id}`,{status:'pending_payment',paidVia:null,walletAmountUsed:0});fs.setDoc('wallets/buyer/ledger/debit',{...entry,type:'manual_adjustment'});}
  const conserved=conservation(id); await expect(pay(id)).rejects.toMatchObject({ details:{reason:'wallet_payment_reconciliation_required'} }); conserved();
});
it('legacy ledger-proved meetup receipt stays read-only, flags OFF and profiles missing', async () => {
  fs.setDoc('transactions/legacy',{buyerId:'buyer',sellerId:'seller',deliveryType:'meetup',status:'completed',paidVia:'wallet',walletAmountUsed:2500,totalAmount:25,shippingAddress:{province:'ON'}});
  fs.setDoc('wallets/buyer/ledger/legacy',{transactionId:'legacy',type:'purchase_debit',amount:2500,balanceAfter:10000,createdAt:new Date()});
  change('users/buyer',{dateOfBirth:null});fs.setDoc('eligibility_profiles/seller',{});vi.stubEnv('PAYMENTS_ENABLED','false');vi.stubEnv('SHIPPING_ENABLED','false');
  const writes=fs.writeOps.length; expect(await pay('legacy')).toMatchObject({replay:true,paymentCommitted:true,currentStatus:'completed',newBalance:10000});expect(fs.writeOps).toHaveLength(writes);expect(h.labels).toBe(0);
});

it('existing sellerDebt blocks new consumption, proved receipt stays consultable', async () => {
  const { id }=await reserved(); change('wallets/buyer',{sellerDebt:250}); const conserved=conservation(id);
  await expect(pay(id)).rejects.toMatchObject({details:{reason:'wallet_funds_blocked'}});conserved();
  change('wallets/buyer',{sellerDebt:0});await pay(id);change('wallets/buyer',{sellerDebt:250});
  const writes=fs.writeOps.length;expect(await pay(id)).toMatchObject({replay:true,paymentCommitted:true});expect(fs.writeOps).toHaveLength(writes);
});
it('post-commit analytics failure leaves proved debit and atomic sweep visibility; receipt never spends twice', async () => {
  const { id }=await reserved();h.analytics=async()=>{throw new Error('simulated process interruption before label');};
  await expect(pay(id)).rejects.toMatchObject({code:'internal'});
  expect(fs.getDoc(`transactions/${id}`)).toMatchObject({status:'paid',labelCreationPending:true,walletAmountUsed:6475});
  expect(fs.getDoc('wallets/buyer')!.balance).toBe(3525);expect(h.labels).toBe(0);
  const writes=fs.writeOps.length;expect(await pay(id)).toMatchObject({replay:true,paymentCommitted:true,newBalance:3525});expect(fs.writeOps).toHaveLength(writes);expect(h.labels).toBe(0);
});
it('real produced quote uses exact archived 18-key identity and 13-field item projection; true wallet consumption matches', async () => {
  const q=await call(quoteShippingPurchase,{articleId:'article',shippingAddress:purchaseAddress});
  const stored=fs.getDoc(`shipping_quotes/${q.quoteId}`)!,s=stored.source;
  const item=Object.fromEntries(['title','description','price','images','category','categoryIds','condition','size','brand','colors','materials','packageSize','shopId']
    .filter(k=>fs.getDoc('articles/article')![k]!==undefined).map(k=>[k,fs.getDoc('articles/article')![k]]));
  const buyer={user:fs.getDoc('users/buyer'),profile:fs.getDoc('eligibility_profiles/buyer')??null},seller={user:fs.getDoc('users/seller'),profile:fs.getDoc('eligibility_profiles/seller')??null};
  const old=createHash('sha256').update(JSON.stringify({articleId:s.articleId,sellerId:s.sellerId,buyerId:s.buyerId,origin:s.origin,destination:s.destination,parcel:s.parcel,
    parcelVersion:s.parcelVersion,item,amount:s.amount,fee:s.fee,tax:s.tax,reduction:s.reduction,buyerVersion:eligibilityVersion(buyer),sellerVersion:eligibilityVersion(seller),
    accountId:seller.user!.stripeAccountId,stripeChargesEnabled:seller.user!.stripeChargesEnabled===true,proofIdentity:seller.profile?.sellerQuebecEvidence?.identityHash??null,shops:[]})).digest('hex');
  expect(s.hash).toBe(old);expect(JSON.stringify(s.item)).toBe(JSON.stringify(item));
  const r=await call(createTransaction,{deliveryType:'shipping',quoteId:q.quoteId,rateId:q.rates[0].rateId,expectedTotal:q.rates[0].totalAmount});
  expect(await pay(r.transactionId)).toMatchObject({newBalance:3525,paymentCommitted:true});
  expect(fs.getDoc(`shipping_quotes/${q.quoteId}`)!.source).toEqual(s);expect(fs.getDoc(`transactions/${r.transactionId}`)!.articleSnapshot).toEqual(item);
});

it.each([null,0,'unknown',{}])('card preparation metadata %j is ambiguity for a new debit, not proof of money',async serviceFeePercent=>{
  const {id}=await reserved();change(`transactions/${id}`,{serviceFeePercent});const conserved=conservation(id);
  await expect(pay(id)).rejects.toMatchObject({details:{reason:'wallet_payment_reconciliation_required'}});conserved();
});
it('old native ledger-proved receipt tolerates legitimate fee metadata, no admission or second debit',async()=>{
  const {id}=await reserved();await pay(id);change(`transactions/${id}`,{serviceFeePercent:5});const writes=fs.writeOps.length;
  expect(await pay(id)).toMatchObject({replay:true,paymentCommitted:true,newBalance:3525});expect(fs.writeOps).toHaveLength(writes);
});
it.each([null,'10000',10000.1,Number.NaN,Number.POSITIVE_INFINITY,-1])('invalid available balance %s cannot be spent',async balance=>{
  const {id}=await reserved();change('wallets/buyer',{balance});const conserved=conservation(id);
  await expect(pay(id)).rejects.toMatchObject({details:{reason:'wallet_payment_reconciliation_required'}});conserved();
});
