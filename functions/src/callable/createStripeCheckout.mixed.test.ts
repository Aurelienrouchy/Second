/** Author 03B3C: real quote/claim handlers, explicit eligible fixtures. Provider IO simulated. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, retrieve: null as any, get: null as any, analytics: null as any, create: null as any, piRetrieve: null as any, params: [] as any[], labels: 0, confirm: null as any, cancel: null as any, list: null as any, pis: new Map<string,any>(), confirms: 0, cancels: 0 }));
const fs = createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) }, get db() { return h.fs!.db; }, get FieldValue() { return { ...h.fs!.FieldValue, serverTimestamp: () => new Date() }; } }));
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: (...args: any[]) => h.retrieve(...args) }, paymentIntents: { create: (...args:any[]) => h.create(...args), retrieve: (...args:any[]) => h.piRetrieve(...args), confirm: (...args:any[]) => h.confirm(...args), cancel: (...args:any[]) => h.cancel(...args), list: (...args:any[]) => h.list(...args) } }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({ getPurchaseRates: async () => purchaseRates(), getPurchaseRatesForShipment: (...args: any[]) => h.get(...args) }) }));
vi.mock('../utils/labelFulfillment', async original => ({ ...await original<any>(), createLabelIdempotent: async () => { h.labels++; return 'failed'; } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid, isAuthenticated: !!r.auth }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: (...args:any[]) => h.analytics(...args) }));
import { quoteShippingPurchase } from './payments/shippingPurchase';
import { createTransaction } from './payments/checkout';
import { createStripeCheckout, confirmStripeCheckout, retireLegacyStripeCheckout } from './payments/checkout';
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
  fs.reset(); seedPurchase(fs); h.retrieve = async () => purchaseAccount(); h.get = async () => purchaseRates(); h.labels = 0; h.analytics = async () => {}; h.params=[]; h.create=async(p:any)=>{h.params.push(p);return {id:'pi_cardbaseline',object:'payment_intent',amount:p.amount,amount_received:0,amount_capturable:0,currency:'cad',status:'requires_payment_method',confirmation_method:p.confirmation_method??'automatic',capture_method:'automatic_async',metadata:p.metadata,client_secret:'pi_cardbaseline_secret_local',payment_method:null,latest_charge:null};}; h.list=async()=>({data:[],has_more:false});h.pis.clear();h.confirms=0;h.cancels=0;
  h.create=async(p:any)=>{h.params.push(p);const pi={id:'pi_manual',object:'payment_intent',amount:p.amount,amount_received:0,amount_capturable:0,currency:'cad',status:'requires_payment_method',confirmation_method:p.confirmation_method,capture_method:'automatic_async',metadata:p.metadata,client_secret:'pi_manual_secret_local',payment_method:null,latest_charge:null};h.pis.set(pi.id,pi);return {...pi};};
  h.piRetrieve=async(id:string)=>{const pi=h.pis.get(id);if(!pi)throw new Error('Unknown PI');return {...pi};};
  h.confirm=async(id:string,p:any)=>{h.confirms++;const pi=h.pis.get(id);if(pi.status==='canceled')throw new Error('Canceled');pi.payment_method=p.payment_method??pi.payment_method;pi.status=pi.payment_method==='pm_action'&&pi.status!=='requires_confirmation'?'requires_action':'succeeded';if(pi.status==='succeeded')pi.amount_received=pi.amount;return {...pi};};
  h.cancel=async(id:string)=>{h.cancels++;const pi=h.pis.get(id);if(['succeeded','processing','requires_capture'].includes(pi.status))throw new Error('Engaged');pi.status='canceled';return {...pi};};
  fs.setDoc('wallets/buyer', { status: 'active', currency: 'cad', balance: 10000, pendingBalance: 700, heldBalance: 800 });
  fs.setDoc('wallets/seller', { status: 'active', currency: 'cad', balance: 2500, pendingBalance: 9000, heldBalance: 4500 });
  fs.setDoc('wallets/seller/ledger/other_sale', { type: 'sale_pending', amount: 9000, transactionId: 'old' });
  fs.setDoc('transactions/old', { buyerId: 'other', sellerId: 'seller', articleId: 'other_article', status: 'delivered', deliveryType: 'shipping', shippingAddress: { province: 'ON' } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });


const confirm=(id:string,version:number,pm='pm_good')=>call(confirmStripeCheckout,{transactionId:id,expectedIntentVersion:version,paymentMethodId:pm});
it('F24 below CAD50 card remainder refuses before PI or any wallet debit with real canonical total',async()=>{const {id}=await reserved();const check=conservation(id);await expect(checkout(id,6445)).rejects.toMatchObject({code:'invalid-argument'});check();expect(h.params).toHaveLength(0);});
it('F24 CAD50 remainder is payable through manual confirm, exact wallet debit once',async()=>{const {id}=await reserved(),r=await checkout(id,6425);expect(r).toMatchObject({cardCents:50,walletCents:6425});expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);await confirm(id,r.intentVersion);expect(fs.getDoc('wallets/buyer')!.balance).toBe(3575);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs[0].data()).toMatchObject({amount:6425,balanceAfter:3575});});
it.each([0,1000])('platform direct charge preserves full/remainder amount %s, no transfers/application fee/on behalf',async wallet=>{const {id}=await reserved();await checkout(id,wallet);expect(h.params[0]).toMatchObject({amount:6475-wallet,currency:'cad',confirmation_method:'manual'});for(const key of['transfer_data','application_fee_amount','on_behalf_of','capture_method'])expect(h.params[0]).not.toHaveProperty(key);expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);});
it('F23 changed protocol: rejected create never first debits; no compensating credit or phantom mixed markers',async()=>{const {id}=await reserved(),check=conservation(id);h.create=async()=>{throw Object.assign(new Error('rejected'),{type:'StripeInvalidRequestError',statusCode:400});};await expect(checkout(id,1000)).rejects.toBeDefined();expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).size).toBe(0);expect(fs.getDoc(`transactions/${id}`)).not.toHaveProperty('walletAmountUsed');expect(fs.getDoc(`transactions/${id}`)).not.toHaveProperty('paidVia');expect(fs.getDoc(`stripe_checkout_intents/${id}`)!.state).toBe('unknown');});
it.each(['missing_user','missing_account','disabled_account'])('B3 seller %s refuses before debit and provider creation',async kind=>{const {id}=await reserved();if(kind==='missing_user')fs.setDoc('users/seller',null);if(kind==='missing_account')change('users/seller',{stripeAccountId:null});if(kind==='disabled_account')h.retrieve=async()=>({...purchaseAccount(),charges_enabled:false});const check=conservation(id);await expect(checkout(id,1000)).rejects.toMatchObject({code:'failed-precondition'});check();expect(h.params).toHaveLength(0);});
it.each([false,true])('F137 shipping flag %s governs new manual preparation from real quote',async enabled=>{const {id}=await reserved();vi.stubEnv('SHIPPING_ENABLED',String(enabled));if(enabled){expect((await checkout(id)).protocol).toBe('server_manual_v1');expect(h.params).toHaveLength(1);}else{const check=conservation(id);await expect(checkout(id)).rejects.toMatchObject({code:'failed-precondition'});check();expect(h.params).toHaveLength(0);}});
it('two create timeouts have no shared wallet reservation to compensate, one durable intention',async()=>{const {id}=await reserved();h.create=async()=>{h.params.push('submitted');throw new Error('timeout');};const r=await Promise.allSettled([checkout(id,1000),checkout(id,1000)]);expect(r.every(r=>r.status==='rejected')).toBe(true);expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).size).toBe(0);expect(h.params).toHaveLength(1);});
it('older failed create cannot compensate or replace durable intent; explicitly changed mode refused',async()=>{const {id}=await reserved();let enter!:()=>void,reject!:(e:any)=>void;const entered=new Promise<void>(r=>enter=r);h.create=async()=>{h.params.push('first');enter();return new Promise((_,r)=>reject=r);};const old=checkout(id,1000);await entered;await expect(checkout(id,500)).rejects.toMatchObject({code:'failed-precondition'});reject(new Error('old failure'));await expect(old).rejects.toMatchObject({code:'unavailable'});expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).size).toBe(0);expect(h.params).toHaveLength(1);});
it('create timeout persists unknown without debit and cannot retry same or omitted mode blindly',async()=>{const {id}=await reserved();h.create=async()=>{h.params.push('first');throw new Error('lost');};await expect(checkout(id,1000)).rejects.toMatchObject({code:'unavailable'});await expect(call(createStripeCheckout,{transactionId:id})).rejects.toMatchObject({code:'unavailable'});expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);expect(h.params).toHaveLength(1);});
