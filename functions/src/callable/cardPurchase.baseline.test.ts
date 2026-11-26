/** Author 03B3C: real quote/claim handlers, explicit eligible fixtures. Provider IO simulated. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, retrieve: null as any, get: null as any, analytics: null as any, create: null as any, piRetrieve: null as any, params: [] as any[], labels: 0 }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return h.fs!.db; }, get FieldValue() { return { ...h.fs!.FieldValue, serverTimestamp: () => new Date() }; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: (...args: any[]) => h.retrieve(...args) }, paymentIntents: { create: (...args:any[]) => h.create(...args), retrieve: (...args:any[]) => h.piRetrieve(...args) } }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({ getPurchaseRates: async () => purchaseRates(), getPurchaseRatesForShipment: (...args: any[]) => h.get(...args) }) }));
vi.mock('../utils/labelFulfillment', async original => ({ ...await original<any>(), createLabelIdempotent: async () => { h.labels++; return 'failed'; } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid, isAuthenticated: !!r.auth }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: (...args:any[]) => h.analytics(...args) }));
import { quoteShippingPurchase } from './payments/shippingPurchase';
import { createTransaction } from './payments/checkout';
import { createStripeCheckout } from './payments/checkout';
import { purchaseAddress, purchaseAccount, purchaseRates, seedPurchase, personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
import { invalidateConnectObservation } from '../utils/connectEligibility';
import { createHash } from 'node:crypto';
import { eligibilityVersion } from '../shared/eligibility';
const call = (fn: any, data: any, uid = 'buyer') => fn.run({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000),} }, data });
const checkout = (id: string, walletAmount:unknown=0, uid='buyer') => call(createStripeCheckout, {transactionId:id,walletAmount},uid);
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
  fs.reset(); seedPurchase(fs); h.retrieve = async () => purchaseAccount(); h.get = async () => purchaseRates(); h.labels = 0; h.analytics = async () => {}; h.params=[]; h.create=async(p:any)=>{h.params.push(p);return {id:'pi_cardbaseline',object:'payment_intent',amount:p.amount,amount_received:0,amount_capturable:0,currency:'cad',status:'requires_payment_method',confirmation_method:p.confirmation_method??'automatic',capture_method:'automatic_async',metadata:p.metadata,client_secret:'pi_cardbaseline_secret_local',payment_method:null,latest_charge:null};}; h.piRetrieve=async()=>{throw new Error('Unset PI proof');};
  fs.setDoc('wallets/buyer', { status: 'active', currency: 'cad', balance: 10000, pendingBalance: 700, heldBalance: 800 });
  fs.setDoc('wallets/seller', { status: 'active', currency: 'cad', balance: 2500, pendingBalance: 9000, heldBalance: 4500 });
  fs.setDoc('wallets/seller/ledger/other_sale', { type: 'sale_pending', amount: 9000, transactionId: 'old' });
  fs.setDoc('transactions/old', { buyerId: 'other', sellerId: 'seller', articleId: 'other_article', status: 'delivered', deliveryType: 'shipping', shippingAddress: { province: 'ON' } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
it.each(['16','17','missing','invalid','inactive'])('new current claim does not authorize card for changed buyer %s',async kind=>{
  const {id}=await reserved();change('users/buyer',{dateOfBirth:kind==='16'?'2010-01-01':kind==='17'?'2009-01-01':kind==='missing'?null:kind==='invalid'?{}:'2000-01-01',...(kind==='inactive'?{isActive:false}:{})});
  const check=conservation(id);await expect(checkout(id)).rejects.toMatchObject({code:'permission-denied'});check();expect(h.params).toHaveLength(0);
});
it.each(['professional','missing','review','origin_on','provider_dob'])('new mixed reservation refuses isolated seller %s before money/PI',async kind=>{
  const {id}=await reserved();
  if(kind==='professional')fs.setDoc('eligibility_profiles/seller',personalProfile('seller','professional'));
  if(kind==='missing')fs.setDoc('eligibility_profiles/seller',{});
  if(kind==='review')change('eligibility_profiles/seller',{activeReviews:{r:{scope:'sell',active:true}}});
  if(kind==='origin_on')change('users/seller',{addresses:[{...purchaseAddress,province:'ON',postalCode:'M5V1A1'}]});
  if(kind==='provider_dob')h.retrieve=async()=>{const a=purchaseAccount();a.individual.dob.year=2009;return a;};
  const check=conservation(id);await expect(checkout(id,1000)).rejects.toMatchObject({code:'failed-precondition'});check();expect(h.params).toHaveLength(0);
});
it.each(['price','fees','total','destination','parcel','quote','lock'])('accepted pending %s changed never authorizes another card amount or reservation',async kind=>{
  const {id,q}=await reserved();
  if(kind==='price')change('articles/article',{price:51});
  if(kind==='fees')change(`transactions/${id}`,{serviceFee:0});
  if(kind==='total')change(`transactions/${id}`,{totalAmount:'64.75'});
  if(kind==='destination')change(`transactions/${id}`,{shippingAddress:{...purchaseAddress,province:'ON',postalCode:'M5V1A1'}});
  if(kind==='parcel')change('shipping_packages/article',{version:2});
  if(kind==='quote')change(`shipping_quotes/${q.quoteId}`,{state:'ready'});
  if(kind==='lock')change('articles/article',{activeTransactionId:'foreign'});
  const check=conservation(id);await expect(checkout(id)).rejects.toBeDefined();check();expect(h.params).toHaveLength(0);
});
it.each([-1,'1000',1.5,Number.NaN])('invalid wallet amount %s is rejected, never coerced to another mode',async amount=>{
  const {id}=await reserved();const check=conservation(id);await expect(checkout(id,amount)).rejects.toMatchObject({code:'invalid-argument'});check();expect(h.params).toHaveLength(0);
});
it('new card preparation uses manual server confirmation and never returns an autonomous PaymentSheet secret',async()=>{
  const {id}=await reserved();const result=await checkout(id);expect(h.params).toHaveLength(1);expect(h.params[0]).toMatchObject({amount:6475,currency:'cad',confirmation_method:'manual'});
  expect(result).not.toHaveProperty('clientSecret');expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);expect(h.labels).toBe(0);
});
it('unknown foreign PaymentIntent existing reference never returns its client secret as a payment permission',async()=>{
  const {id}=await reserved();change(`transactions/${id}`,{stripePaymentIntentId:'pi_existing'});h.piRetrieve=async()=>({id:'pi_existing',amount:6475,amount_received:0,amount_capturable:0,currency:'cad',status:'requires_payment_method',confirmation_method:'automatic',metadata:{transactionId:'foreign',buyerId:'other',sellerId:'other'},client_secret:'foreign_secret'});
  const check=conservation(id);await expect(checkout(id)).rejects.toBeDefined();check();expect(h.params).toHaveLength(0);
});
