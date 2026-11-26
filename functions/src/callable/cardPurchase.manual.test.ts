/** Author 03B3C: real quote/claim handlers, explicit eligible fixtures. Provider IO simulated. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFirestoreMock, type MockFirestore } from '../utils/testHelpers/firestoreMock';
const h = vi.hoisted(() => ({ fs: null as MockFirestore | null, relationshipAllowed:true,nativeTimestamps:false,authGet:null as any, retrieve: null as any, get: null as any, analytics: null as any, create: null as any, piRetrieve: null as any, params: [] as any[], labels: 0, confirm: null as any, cancel: null as any, list: null as any, pis: new Map<string,any>(), confirms: 0, cancels: 0 }));
const fs = h.fs??createFirestoreMock({ enforceReadBeforeWrite: true }); h.fs = fs;
vi.mock('../config/firebase', async () => {
  const {createFirestoreMock:makeFirestore}=await import('../utils/testHelpers/firestoreMock');
  const {Timestamp:NativeTimestamp}=await import('firebase-admin/firestore');
  h.fs??=makeFirestore({enforceReadBeforeWrite:true});
  return { get db() { return h.fs!.db; },get auth(){return {getUser:(uid:string)=>h.authGet(uid)};}, get FieldValue() { return { ...h.fs!.FieldValue, serverTimestamp: () => h.nativeTimestamps?NativeTimestamp.now():new Date() }; } };
});
vi.mock('../config/stripe', () => ({ getStripe: () => ({ accounts: { retrieve: (...args: any[]) => h.retrieve(...args) }, paymentIntents: { create: (...args:any[]) => h.create(...args), retrieve: (...args:any[]) => h.piRetrieve(...args), confirm: (...args:any[]) => h.confirm(...args), cancel: (...args:any[]) => h.cancel(...args), list: (...args:any[]) => h.list(...args) } }) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({ getPurchaseRates: async () => purchaseRates(), getPurchaseRatesForShipment: (...args: any[]) => h.get(...args) }) }));
vi.mock('../utils/labelFulfillment', async original => ({ ...await original<any>(), createLabelIdempotent: async () => { h.labels++; return 'failed'; } }));
vi.mock('../utils/rateLimit', () => ({ checkRateLimit: async () => {}, resolveCallerKey: (r: any) => ({ callerKey: r.auth?.uid, isAuthenticated: !!r.auth }) }));
vi.mock('../lib/analytics', () => ({ captureServerEvent: (...args:any[]) => h.analytics(...args) }));
import { quoteShippingPurchase } from './payments/shippingPurchase';
import { createTransaction } from './payments/checkout';
import { payWithWallet } from './wallet';
import { createStripeCheckout, confirmStripeCheckout, retireLegacyStripeCheckout } from './payments/checkout';
import { purchaseAddress, purchaseAccount, purchaseRates, seedPurchase, personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
import { invalidateConnectObservation } from '../utils/connectEligibility';
import { createHash } from 'node:crypto';
import { eligibilityVersion } from '../shared/eligibility';
import { Timestamp } from 'firebase-admin/firestore';
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
beforeEach(async () => {
  h.relationshipAllowed=true;h.nativeTimestamps=false;h.authGet=async(uid:string)=>({uid,disabled:false,tokensValidAfterTime:null,customClaims:{}});
  // The financial harness isolates the native authority gate; its actual proof
  // implementation is independently reviewed, not simulated by PI status.
  const relation=await import('../utils/accountRelationshipReview');
  vi.spyOn(relation,'assertRelationshipPurchaseRetirement').mockImplementation(async(tx:any,request:any)=>{
    const role=(await tx.get(fs.db.collection('users').doc(request.auth.uid))).data();
    if(!h.relationshipAllowed||role?.isAdmin!==true||role.isActive===false){const {HttpsError}=await import('firebase-functions/v2/https');throw new HttpsError('permission-denied','current native authority');}
    return relationshipReference;
  });
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
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const confirm=(id:string,version:number,pm?:string)=>call(confirmStripeCheckout,{transactionId:id,expectedIntentVersion:version,...(pm?{paymentMethodId:pm}:{})});
async function legacy(mixed=false){const {id}=await reserved();change(`transactions/${id}`,{stripePaymentIntentId:'pi_legacy',serviceFeePercent:5,...(mixed?{paidVia:'wallet_and_card',walletAmountUsed:1000,walletCheckoutAttemptId:'legacy_attempt'}:{})});
 h.pis.set('pi_legacy',{id:'pi_legacy',amount:mixed?5475:6475,amount_received:0,amount_capturable:0,currency:'cad',status:'requires_payment_method',confirmation_method:'automatic',capture_method:'automatic_async',metadata:{transactionId:id,buyerId:'buyer',sellerId:'seller',...(mixed?{walletAmountUsed:'1000',paymentType:'wallet_and_card'}:{})},client_secret:'legacy_secret'});
 if(mixed){change('wallets/buyer',{balance:9000});fs.setDoc('wallets/buyer/ledger/legacy_debit',{type:'purchase_debit',amount:1000,balanceAfter:9000,transactionId:id,createdAt:new Date(),currency:'CAD'});}return id;}
const retire=async(id:string,version?:string)=>{const r=await checkout(id);return call(retireLegacyStripeCheckout,{transactionId:id,expectedPaymentIntentId:'pi_legacy',expectedRetirementVersion:version??r.retirementVersion});};
it('card only has no wallet prerequisite, no debit, no autonomous secret, platform manual configuration',async()=>{
 fs.setDoc('wallets/buyer',null);const {id}=await reserved();const r=await checkout(id);expect(r).toMatchObject({protocol:'server_manual_v1',confirmationRequired:true,walletCents:0,cardCents:6475,paymentPermissionGranted:false});expect(r).not.toHaveProperty('clientSecret');expect(h.params[0]).toMatchObject({confirmation_method:'manual',payment_method_types:['card']});expect(h.params[0]).not.toHaveProperty('capture_method');expect(h.params[0]).not.toHaveProperty('transfer_data');expect(h.params[0]).not.toHaveProperty('application_fee_amount');expect(fs.getDoc(`transactions/${id}`)!.status).toBe('pending_payment');
});
it('mixed preparation has no debit; first manual confirmation debits exact once; replay never marks paid or labels',async()=>{
 const {id}=await reserved();const before=structuredClone(fs.getDoc('wallets/buyer'));const r=await checkout(id,1000);expect(fs.getDoc('wallets/buyer')).toEqual(before);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs).toHaveLength(0);const c=await confirm(id,r.intentVersion,'pm_good');expect(c).toMatchObject({providerStatus:'succeeded',settlementPending:true,paymentPermissionGranted:false});expect(fs.getDoc('wallets/buyer')).toEqual({...before,balance:9000,updatedAt:new Date()});expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs).toHaveLength(1);expect(fs.getDoc(`transactions/${id}`)!.status).toBe('pending_payment');expect(h.labels).toBe(0);const after=structuredClone(fs.getDoc('wallets/buyer'));vi.stubEnv('PAYMENTS_ENABLED','false');change('users/buyer',{dateOfBirth:null});await confirm(id,r.intentVersion,'pm_good');expect(fs.getDoc('wallets/buyer')).toEqual(after);expect(h.confirms).toBe(1);
});
it('SCA secret is only an action on a manual PI; each server reconfirm requalifies and never repeats wallet debit',async()=>{
 const {id}=await reserved();const r=await checkout(id,1000);const a=await confirm(id,r.intentVersion,'pm_action');expect(a).toMatchObject({providerStatus:'requires_action',action:'handleNextAction',actionClientSecret:'pi_manual_secret_local'});expect(h.confirms).toBe(1);h.pis.get('pi_manual').status='requires_confirmation';const c=await confirm(id,a.intentVersion);expect(c.providerStatus).toBe('succeeded');expect(h.confirms).toBe(2);expect(fs.getDoc('wallets/buyer')!.balance).toBe(9000);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs).toHaveLength(1);
});
it.each(['buyer','seller','price','bank','refund'])('SCA reconfirm isolated %s change refuses after actual first debit and preserves money',async kind=>{
 const {id}=await reserved();const r=await checkout(id,1000);const a=await confirm(id,r.intentVersion,'pm_action');h.pis.get('pi_manual').status='requires_confirmation';
 if(kind==='buyer')change('users/buyer',{dateOfBirth:'2009-01-01'});if(kind==='seller')fs.setDoc('eligibility_profiles/seller',personalProfile('seller','professional'));if(kind==='price')change('articles/article',{price:51});if(kind==='bank')change(`transactions/${id}`,{bankDispute:{id:'dp_open',state:'open'}});if(kind==='refund')change(`transactions/${id}`,{refundBlocked:true});const check=conservation(id);await expect(confirm(id,a.intentVersion)).rejects.toBeDefined();check();expect(h.confirms).toBe(1);
});
it('unknown confirm preserves the actual mixed debit and refuses a second confirm even after 25 hours',async()=>{
 const {id}=await reserved();const r=await checkout(id,1000);h.confirm=async()=>{h.confirms++;throw new Error('timeout after unknown execution');};await expect(confirm(id,r.intentVersion,'pm_good')).rejects.toMatchObject({code:'unavailable'});expect(fs.getDoc('wallets/buyer')!.balance).toBe(9000);vi.advanceTimersByTime(25*3600000);await expect(confirm(id,3,'pm_good')).rejects.toMatchObject({code:'unavailable'});expect(h.confirms).toBe(1);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs).toHaveLength(1);
});
it('unknown create persists before IO and cannot create again after a lost reply or 25h',async()=>{
 const {id}=await reserved();h.create=async()=>{h.params.push('lost');throw new Error('lost');};await expect(checkout(id,1000)).rejects.toMatchObject({code:'unavailable'});expect(fs.getDoc(`stripe_checkout_intents/${id}`)!.state).toBe('unknown');expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);vi.advanceTimersByTime(25*3600000);await expect(checkout(id,1000)).rejects.toMatchObject({code:'unavailable'});expect(h.params).toHaveLength(1);
});
it.each(['debt','bank','refund','balance','currency','ledger'])('new mixed authorization refuses %s but does not apply funds guards to pure card',async kind=>{
 const {id}=await reserved();const r=await checkout(id,1000);if(kind==='debt')change('wallets/buyer',{sellerDebt:100});if(kind==='bank')fs.setDoc('transactions/exposure',{sellerId:'buyer',status:'completed',bankDispute:{id:'dp_x',state:'open'},disputed:true});if(kind==='refund')fs.setDoc('transactions/exposure',{sellerId:'buyer',status:'completed',refundBlocked:true});if(kind==='balance')change('wallets/buyer',{balance:0});if(kind==='currency')change('wallets/buyer',{currency:'usd'});if(kind==='ledger')fs.setDoc('wallets/buyer/ledger/foreign',{transactionId:id,type:'manual_adjustment',amount:50});const check=conservation(id);await expect(confirm(id,r.intentVersion,'pm_good')).rejects.toBeDefined();check();expect(h.confirms).toBe(0);
});
it('card only ignores seller debt and unrelated wallet obligations, without wallet debit',async()=>{
 const {id}=await reserved();change('wallets/buyer',{sellerDebt:100});fs.setDoc('transactions/exposure',{sellerId:'buyer',refundBlocked:true});const r=await checkout(id);await confirm(id,r.intentVersion,'pm_good');expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs).toHaveLength(0);
});
it('same preparation replays its actual PI; a different wallet mode cannot be a new payment',async()=>{
 const {id}=await reserved();const r=await checkout(id,1000);const again=await checkout(id,1000);expect(again.intentVersion).toBe(r.intentVersion);expect(h.params).toHaveLength(1);await expect(checkout(id,0)).rejects.toBeDefined();
});
it('source changed during create keeps the real manual PI and no new admission or money',async()=>{
 const {id}=await reserved();const original=h.create;h.create=async(p:any)=>{const pi=await original(p);change('users/buyer',{dateOfBirth:'2009-01-01'});return pi;};await expect(checkout(id,1000)).rejects.toMatchObject({code:'aborted'});expect(fs.getDoc(`transactions/${id}`)!.stripePaymentIntentId).toBe('pi_manual');expect(fs.getDoc(`stripe_checkout_intents/${id}`)!.state).toBe('action_required');expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);expect(h.confirms).toBe(0);
});
it.each(['age','parcel','lock','bank','refund'])('change during stored-rate retrieval %s prevents confirm/debit',async kind=>{
 const {id}=await reserved();const r=await checkout(id,1000);h.get=async()=>{if(kind==='age')change('users/buyer',{dateOfBirth:'2009-01-01'});if(kind==='parcel')change('shipping_packages/article',{version:2});if(kind==='lock')change('articles/article',{activeTransactionId:'foreign'});if(kind==='bank')change(`transactions/${id}`,{bankDispute:{id:'dp_x',state:'open'}});if(kind==='refund')change(`transactions/${id}`,{refundBlocked:true});return purchaseRates();};const before=structuredClone(fs.getDoc('wallets/buyer'));await expect(confirm(id,r.intentVersion,'pm_good')).rejects.toBeDefined();expect(fs.getDoc('wallets/buyer')).toEqual(before);expect(h.confirms).toBe(0);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs).toHaveLength(0);
});
it('legacy card retirement actually cancels the attributed automatic capability, releases only its order and replays without IO',async()=>{
 const id=await legacy();const r=await retire(id);expect(r).toMatchObject({cardCapabilityNeutralized:true,walletObligationOpen:false});expect(h.pis.get('pi_legacy').status).toBe('canceled');expect(fs.getDoc(`transactions/${id}`)!.status).toBe('cancelled');expect(fs.getDoc('articles/article')!.isSold).toBe(false);const c=h.cancels;await call(retireLegacyStripeCheckout,{transactionId:id});expect(h.cancels).toBe(c);expect(fs.getDoc('transactions/old')!.status).toBe('delivered');
});
it('legacy mixed retirement neutralizes only card; native debit/markers/reservation/wallet remain obligations, exact replay no IO',async()=>{
 const id=await legacy(true);const check=conservation(id);const r=await retire(id);expect(r).toMatchObject({cardCapabilityNeutralized:true,walletObligationOpen:true,walletCents:1000});check();expect(h.pis.get('pi_legacy').status).toBe('canceled');await call(retireLegacyStripeCheckout,{transactionId:id});check();expect(h.cancels).toBe(1);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs).toHaveLength(1);
});
it.each(['received','capturable','processing','foreign','partial','refund','bank'])('legacy automatic %s never cancels or compensates blindly',async kind=>{
 const id=await legacy(true),pi=h.pis.get('pi_legacy');if(kind==='received'){pi.status='succeeded';pi.amount_received=5475;}if(kind==='capturable'){pi.status='requires_capture';pi.amount_capturable=5475;}if(kind==='processing')pi.status='processing';if(kind==='foreign')pi.metadata.buyerId='other';if(kind==='partial')change('wallets/buyer/ledger/legacy_debit',{amount:500});if(kind==='refund')change(`transactions/${id}`,{refundBlocked:true});if(kind==='bank')change(`transactions/${id}`,{bankDispute:{id:'dp_bank',state:'open'}});const check=conservation(id);await expect(retire(id)).rejects.toBeDefined();check();expect(h.cancels).toBe(0);
});
it('cancel timeout keeps real PI, native wallet debit and lock, no false neutralization',async()=>{
 const id=await legacy(true);h.cancel=async()=>{h.cancels++;throw new Error('unknown');};const check=conservation(id);await expect(retire(id)).rejects.toMatchObject({code:'unavailable'});check();expect(fs.getDoc(`stripe_checkout_intents/${id}`)!.cardCapabilityNeutralized).not.toBe(true);
});
it('real provider captured during cancel is preserved, no false release or compensation',async()=>{
 const id=await legacy();h.cancel=async()=>{const pi=h.pis.get('pi_legacy');pi.status='succeeded';pi.amount_received=6475;return {...pi};};const check=conservation(id);await expect(retire(id)).rejects.toBeDefined();check();expect(fs.getDoc(`stripe_checkout_intents/${id}`)!.cardCapabilityNeutralized).not.toBe(true);
});

it('lost successful create recovers the exact manual PI after 25h using metadata, never re-creates or debits',async()=>{
 const {id}=await reserved();const create=h.create;h.create=async(p:any)=>{await create(p);throw new Error('reply lost');};await expect(checkout(id,1000)).rejects.toMatchObject({code:'unavailable'});vi.advanceTimersByTime(25*3600000);h.list=async()=>({data:[{...h.pis.get('pi_manual')}],has_more:false});const r=await checkout(id,1000);expect(r).toMatchObject({protocol:'server_manual_v1',confirmationRequired:true,walletCents:1000});expect(h.params).toHaveLength(1);expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);expect(fs.getDoc(`transactions/${id}`)!.stripePaymentIntentId).toBe('pi_manual');expect(r).not.toHaveProperty('clientSecret');
});
it.each(['absent','foreign','ambiguous','saturated','unavailable','empty_page'])('lost-create recovery %s is not absence or permission to create',async kind=>{
 const {id}=await reserved();const create=h.create;h.create=async(p:any)=>{await create(p);throw new Error('lost');};await expect(checkout(id,1000)).rejects.toBeDefined();let reads=0;h.list=async()=>{reads++;const pi={...h.pis.get('pi_manual'),metadata:{...h.pis.get('pi_manual').metadata}};
 if(kind==='unavailable')throw new Error('offline');if(kind==='foreign')return{data:[{...pi,metadata:{...pi.metadata,buyerId:'other'}}],has_more:false};if(kind==='ambiguous')return{data:[pi,{...pi,id:'pi_duplicate'}],has_more:false};if(kind==='saturated')return{data:Array.from({length:100},(_,n)=>({...pi,id:`pi_unrelated${reads}${n}`,metadata:{checkoutIntentId:'other'}})),has_more:true};if(kind==='empty_page')return{data:[],has_more:true};return{data:[],has_more:false};};
 const check=conservation(id);await expect(checkout(id,1000)).rejects.toBeDefined();check();expect(h.params).toHaveLength(1);expect(reads).toBeLessThanOrEqual(5);expect(fs.getDoc(`transactions/${id}`)!.stripePaymentIntentId).toBeUndefined();
});
it('lost confirm with actual action is reconciled durably, SCA can later obtain a new authorized server attempt without another debit',async()=>{
 const {id}=await reserved();const r=await checkout(id,1000),confirmProvider=h.confirm;h.confirm=async(...a:any[])=>{await confirmProvider(...a);throw new Error('reply lost');};await expect(confirm(id,r.intentVersion,'pm_action')).rejects.toMatchObject({code:'unavailable'});h.confirm=confirmProvider;const recovered=await checkout(id,1000);expect(recovered).toMatchObject({providerStatus:'requires_action',actionClientSecret:'pi_manual_secret_local'});expect(fs.getDoc(`stripe_checkout_intents/${id}`)!.state).toBe('requires_action');h.pis.get('pi_manual').status='requires_confirmation';await confirm(id,recovered.intentVersion);expect(fs.getDoc('wallets/buyer')!.balance).toBe(9000);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).size).toBe(1);
});
it('real callable option bindings include provider secrets only on authorized wrappers',()=>{
 for(const fn of[createStripeCheckout,confirmStripeCheckout]){expect((fn as any).__endpoint.region).toEqual(['northamerica-northeast1']);expect((fn as any).__endpoint.availableMemoryMb).toBe(512);expect((fn as any).__endpoint.secretEnvironmentVariables.map((s:any)=>s.key)).toEqual(['STRIPE_SECRET_KEY','SHIPENGINE_API_KEY']);}
 expect((retireLegacyStripeCheckout as any).__endpoint.secretEnvironmentVariables.map((s:any)=>s.key)).toEqual(['STRIPE_SECRET_KEY']);
});

it('real quote/claim with flags OFF refuses new card before provider creation/debit, unlike proven receipt',async()=>{const {id}=await reserved();vi.stubEnv('PAYMENTS_ENABLED','false');const check=conservation(id);await expect(checkout(id,1000)).rejects.toMatchObject({code:'failed-precondition'});check();expect(h.params).toHaveLength(0);});
it('accepted wallet winner is consulted through its unchanged receipt helper before flags/DOB, never converted to card',async()=>{const {id}=await reserved();expect(await call(payWithWallet,{transactionId:id})).toMatchObject({newBalance:3525});const rows=(await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs.map((d:any)=>({id:d.id,data:d.data()}));vi.stubEnv('PAYMENTS_ENABLED','false');change('users/buyer',{dateOfBirth:null});const before=structuredClone(fs.getDoc('wallets/buyer')),labels=h.labels;const r=await checkout(id);expect(r).toMatchObject({protocol:'wallet_receipt',replay:true,paymentCommitted:true,paymentPermissionGranted:false});expect(fs.getDoc('wallets/buyer')).toEqual(before);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs.map((d:any)=>({id:d.id,data:d.data()}))).toEqual(rows);expect(h.params).toHaveLength(0);expect(h.labels).toBe(labels);});
it('explicit current card decline with complete PI proof permits a new PM, preserves one mixed reservation without compensation',async()=>{const {id}=await reserved(),r=await checkout(id,1000),provider=h.confirm;h.confirm=async(id:string)=>{h.confirms++;throw Object.assign(new Error('declined'),{type:'StripeCardError',statusCode:402,payment_intent:{...h.pis.get(id)}});};await expect(confirm(id,r.intentVersion,'pm_declined')).rejects.toMatchObject({details:{reason:'stripe_checkout_payment_method_rejected'}});const next=await checkout(id,1000);expect(next).toMatchObject({providerStatus:'requires_payment_method',confirmationRequired:true});h.confirm=provider;await confirm(id,next.intentVersion,'pm_good');expect(fs.getDoc('wallets/buyer')!.balance).toBe(9000);expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).size).toBe(1);});
it.each(['missing_received','missing_capturable','amount','currency','buyer','seller','order','wallet_metadata','automatic','unknown_status'])('current actual PI isolated %s never authorizes a confirm/debit',async kind=>{const {id}=await reserved(),r=await checkout(id,1000),pi=h.pis.get('pi_manual');if(kind==='missing_received')delete pi.amount_received;if(kind==='missing_capturable')delete pi.amount_capturable;if(kind==='amount')pi.amount++;if(kind==='currency')pi.currency='usd';if(kind==='buyer')pi.metadata.buyerId='other';if(kind==='seller')pi.metadata.sellerId='other';if(kind==='order')pi.metadata.transactionId='other';if(kind==='wallet_metadata')pi.metadata.walletAmountUsed='500';if(kind==='automatic')pi.confirmation_method='automatic';if(kind==='unknown_status')pi.status='unknown';const check=conservation(id);await expect(confirm(id,r.intentVersion,'pm_good')).rejects.toBeDefined();check();expect(h.confirms).toBe(0);expect(fs.getDoc(`stripe_checkout_intents/${id}`)!.state).toBe('action_required');});
it('SCA secret with a different PI identity is never handed to the buyer',async()=>{const {id}=await reserved(),r=await checkout(id),a=await confirm(id,r.intentVersion,'pm_action');expect(a.actionClientSecret).toBe('pi_manual_secret_local');h.pis.get('pi_manual').client_secret='pi_foreign_secret_token';await expect(checkout(id)).rejects.toBeDefined();expect(fs.getDoc(`stripe_checkout_intents/${id}`)!.reason).toBe('action_secret_identity_conflict');expect(h.confirms).toBe(1);});
it('owner DTO allowlist excludes private identity/source/proof/notes, no undefined values',async()=>{const {id}=await reserved(),r=await checkout(id,1000);expect(Object.keys(r).sort()).toEqual(['action','cardCents','confirmationRequired','currency','intentVersion','paymentPermissionGranted','preparationState','protocol','providerStatus','settlementPending','totalCents','transactionId','walletCents'].sort());expect(Object.values(r)).not.toContain(undefined);expect(JSON.stringify(r)).not.toContain('2000-01-01');expect(JSON.stringify(r)).not.toContain('999 Origine privée');});

const relationshipReference={pairId:'arp_'+'1'.repeat(64),id:'ar_'+'2'.repeat(64),contentHash:'3'.repeat(64),version:1};
const relationshipRequest=(data:any)=>({auth:{uid:'operator',token:{auth_time:Math.floor(Date.now()/1000)}},data:{expectedUid:'operator',...data}});
async function relationshipFixture(mixed=false){const id='legacy_pair_purchase';
  // Historical evidence is seeded directly. The current insurance gate must
  // remain closed; servicing never obtains a new shipping quote to bypass it.
  fs.setDoc(`transactions/${id}`,{buyerId:'buyer',sellerId:'seller',articleId:'article',status:'pending_payment',deliveryType:'shipping',
    createdAt:Timestamp.now(),currency:'CAD',totalAmount:64.75,stripePaymentIntentId:'pi_legacy',
    ...(mixed?{paidVia:'wallet_and_card',walletAmountUsed:1000,walletCheckoutAttemptId:'legacy_attempt'}:{})});
  h.pis.set('pi_legacy',{id:'pi_legacy',object:'payment_intent',amount:mixed?5475:6475,amount_received:0,amount_capturable:0,currency:'cad',
    status:'requires_payment_method',confirmation_method:'automatic',capture_method:'automatic_async',metadata:{transactionId:id,buyerId:'buyer',sellerId:'seller',
      ...(mixed?{walletAmountUsed:'1000',paymentType:'wallet_and_card'}:{})},client_secret:'legacy_secret'});
  if(mixed){change('wallets/buyer',{balance:9000});fs.setDoc('wallets/buyer/ledger/legacy_debit',{transactionId:id,type:'purchase_debit',amount:1000,balanceAfter:9000,createdAt:Timestamp.now(),currency:'CAD'});}
  fs.setDoc('users/operator',{isAdmin:true});return id;}
const relationshipPreview=async(id:string)=>(await import('../utils/stripeCheckout')).readRelationshipPurchaseRetirement(relationshipRequest({capability:'account_relationship_review_v1',operation:'purchase_legacy_preview',transactionId:id,relationshipReference}));
const relationshipExecute=(command:any,requestId='operator-retirement-0001')=>(retireLegacyStripeCheckout as any).run(relationshipRequest({capability:'relationship_purchase_retirement_v1',mode:'execute',requestId,command}));
const relationshipNeutralize=(command:any,requestId='operator-retirement-0001')=>(retireLegacyStripeCheckout as any).run(relationshipRequest({capability:'relationship_purchase_retirement_v1',mode:'neutralize',requestId,command}));
const relationshipObserve=async(command:any,requestId='operator-retirement-0001')=>(await import('../utils/stripeCheckout')).readRelationshipPurchaseRetirement(relationshipRequest({capability:'account_relationship_review_v1',operation:'purchase_legacy_observe',requestId,command}));
function relationshipConservation(id:string){const paths=[`transactions/${id}`,'articles/article','wallets/buyer','wallets/seller'];const before=paths.map(p=>JSON.stringify(fs.getDoc(p))),writes=fs.writeOps.length;
  return()=>{expect(paths.map(p=>JSON.stringify(fs.getDoc(p)))).toEqual(before);expect(fs.writeOps.slice(writes).filter(o=>/^(transactions|articles|wallets)\//.test(o.path))).toHaveLength(0);};}
it('relationship operator preview is GET only, exact opt-in retirement changes no business or money and exposes no secret',async()=>{
  const id=await relationshipFixture(),check=relationshipConservation(id),preview=await relationshipPreview(id);
  expect(preview).toMatchObject({canNeutralize:true,amounts:{walletCents:0,currency:'CAD'}});expect(h.cancels).toBe(0);check();
  expect(JSON.stringify(preview)).not.toContain('client_secret');expect(JSON.stringify(preview)).not.toContain('legacy_secret');
  expect(preview.commandTemplate).not.toHaveProperty('expectedRetirementVersion');
  const result=await relationshipExecute(preview.commandTemplate);expect(result).toMatchObject({state:'received',result:{cardCapabilityNeutralized:true,orderChanged:false,stockChanged:false,fundsMoved:false}});
  check();expect(h.cancels).toBe(1);const retrieves=h.piRetrieve;h.piRetrieve=async()=>{throw new Error('terminal replay must not read provider');};
  h.relationshipAllowed=false;expect(await relationshipExecute(preview.commandTemplate)).toMatchObject({state:'received'});expect(await relationshipObserve(preview.commandTemplate)).toMatchObject({state:'received'});h.piRetrieve=retrieves;expect(h.cancels).toBe(1);
});
it.each(['processing','succeeded','requires_capture','manual_confirmation','manual_capture','foreign','seller_credit'])('relationship operator %s exposure never becomes a cancellation or refund',async kind=>{
  const id=await relationshipFixture(),pi=h.pis.get('pi_legacy');if(['processing','succeeded','requires_capture'].includes(kind))pi.status=kind;
  if(kind==='succeeded')pi.amount_received=pi.amount;if(kind==='requires_capture')pi.amount_capturable=pi.amount;
  if(kind==='manual_confirmation')pi.confirmation_method='manual';if(kind==='manual_capture')pi.capture_method='manual';if(kind==='foreign')pi.metadata.sellerId='other';
  if(kind==='seller_credit')fs.setDoc('wallets/seller/ledger/early_credit',{transactionId:id,type:'sale_credit',amount:5000,createdAt:Timestamp.now()});
  const check=relationshipConservation(id);const value=await relationshipPreview(id).catch(()=>null);if(value)expect(value.canNeutralize).toBe(false);expect(h.cancels).toBe(0);check();
});
it('relationship operator card neutralization retains the actual mixed debit as an open obligation',async()=>{
  const id=await relationshipFixture(true),preview=await relationshipPreview(id),check=relationshipConservation(id);expect(preview.wallet).toMatchObject({qualification:'native_debit',obligationOpen:true});
  const result=await relationshipExecute(preview.commandTemplate);expect(result).toMatchObject({state:'received',result:{walletObligationOpen:true,walletCents:1000}});check();
});
it('relationship operator lost cancellation response is recovered by GET only with the exact journal, never a second POST after 25 hours',async()=>{
  const id=await relationshipFixture(),preview=await relationshipPreview(id),check=relationshipConservation(id),cancel=h.cancel;
  h.cancel=async(...args:any[])=>{await cancel(...args);throw new Error('reply lost');};const unknown=await relationshipExecute(preview.commandTemplate);expect(unknown).toMatchObject({state:'unknown',result:null});
  vi.advanceTimersByTime(25*3600_000);expect(await relationshipExecute(preview.commandTemplate)).toMatchObject({state:'unknown'});expect(h.cancels).toBe(1);
  expect(await relationshipObserve(preview.commandTemplate)).toMatchObject({state:'received',result:{providerStatus:'canceled'}});expect(h.cancels).toBe(1);check();
});
it('relationship operator role lost during GET stops authorization before any POST; changed source does the same',async()=>{
  const id=await relationshipFixture(),preview=await relationshipPreview(id),get=h.piRetrieve,check=relationshipConservation(id);
  h.piRetrieve=async(...args:any[])=>{const pi=await get(...args);h.relationshipAllowed=false;return pi;};await expect(relationshipExecute(preview.commandTemplate)).rejects.toMatchObject({code:'permission-denied'});expect(h.cancels).toBe(0);check();
  h.relationshipAllowed=true;h.piRetrieve=async(...args:any[])=>{const pi=await get(...args);change(`transactions/${id}`,{totalAmount:64.76});return pi;};
  await expect(relationshipExecute(preview.commandTemplate)).rejects.toBeDefined();expect(h.cancels).toBe(0);
});
it('relationship operator provider already canceled is observed by GET, never submitted to cancel again',async()=>{
  const id=await relationshipFixture();h.pis.get('pi_legacy').status='canceled';const preview=await relationshipPreview(id),check=relationshipConservation(id);
  expect(await relationshipExecute(preview.commandTemplate)).toMatchObject({state:'received'});expect(h.cancels).toBe(0);check();
});

async function nativeRelationshipFixture(){
  const id=await relationshipFixture();h.nativeTimestamps=true;
  const relation=await import('../utils/accountRelationshipReview');
  vi.mocked(relation.assertRelationshipPurchaseRetirement).mockRestore();
  // Add only native SDK surfaces absent from this pre-existing financial mock;
  // keep its staged writes and read-before-write enforcement intact.
  const run=fs.db.runTransaction.bind(fs.db);
  vi.spyOn(fs.db,'runTransaction').mockImplementation(((fn:any)=>run(async(tx:any)=>{
    const get=async(ref:any)=>{const snap=await tx.get(ref);return 'docs' in snap?{...snap,readTime:Timestamp.now()}:snap;};
    return fn({...tx,get,getAll:async(...refs:any[])=>Promise.all(refs.map(get))});
  })) as any);
  const {buildPurchasePolicy,buildPurchasePolicyAcceptance,acceptedOrderPurchasePolicy}=await import('../utils/purchasePolicy');
  const acceptedAt=Timestamp.fromMillis(Date.now()-120_000);
  // An already stored native V1 acceptance, before the legacy PI exposure.
  // This does not backfill old orders lacking a consent witness, or claim
  // that an actually deployed historical version produced this combination.
  const policy=buildPurchasePolicy('quote_historical',{articleId:'article',buyerId:'buyer',sellerId:'seller',hash:'4'.repeat(64)},'shipping_purchase_2026_01');
  change(`transactions/${id}`,{createdAt:acceptedAt,shippingQuoteId:policy.quoteId,shipEngineRateId:'rate_historical',purchasePolicy:policy,
    purchasePolicyAcceptance:buildPurchasePolicyAcceptance(policy,id,'rate_historical',6475,acceptedAt),articleSnapshot:{articleId:'article',sellerId:'seller',title:'Manteau'}});
  expect(acceptedOrderPurchasePolicy(fs.getDoc(`transactions/${id}`),id)).not.toBeNull();
  const {executeSupportOwnerCommand}=await import('./supportRequests');
  const ticket=await executeSupportOwnerCommand({auth:{uid:'buyer',token:{ auth_time: Math.floor(Date.now() / 1000),}},data:{expectedUid:'buyer',requestId:'native-support-submit-0001',mode:'execute',
    command:{action:'submit',kind:'account_reconciliation',narrative:'Lien déclaré à examiner sans constat automatique.',transactionId:id,relatedAccountIds:['buyer','seller']}}});
  expect(ticket.state).toBe('committed');
  const context={supportRequestId:ticket.supportRequestId,orders:[{kind:'purchase',id}]};
  const source:any=await relation.handleAccountRelationshipReview(relationshipRequest({capability:'account_relationship_review_v1',scope:'admin',operation:'preview',context}),'read');
  expect(source.canRecordReview).toBe(true);
  const decision:any=await relation.handleAccountRelationshipReview(relationshipRequest({capability:'account_relationship_review_v1',requestId:'native-relationship-review-0001',mode:'execute',command:{
    context,source:{sourceHash:source.source.sourceHash,pairId:source.source.pairId,version:source.source.version},scope:'admin',action:'record_review',
    pairAction:'restrict_new_engagements',orderAction:'retain_current',assessment:'unresolved',facts:[],privateReason:'Sources natives examinées ; lien non établi.',
    statement:null,reconsiderWhen:'À réception des précisions des parties.',partyMessages:[{userId:'buyer',message:'Un examen est ouvert.'},{userId:'seller',message:'Un examen est ouvert.'}],
    decisionReference:null,acknowledged:true}}),'admin');
  expect(decision.state).toBe('committed');
  const reader=await import('../utils/stripeCheckout');
  const preview=await reader.readRelationshipPurchaseRetirement(relationshipRequest({capability:'account_relationship_review_v1',operation:'purchase_legacy_preview',transactionId:id,relationshipReference:decision.reference}));
  expect(preview).toMatchObject({canNeutralize:true,provider:{confirmationMethod:'automatic'}});
  return {id,reference:decision.reference,context,preview,relation};
}
it('relationship native gate qualifies a possible frozen acceptance with real support/decision/notice receipts, without a mocked authority',async()=>{
  const {id,preview}=await nativeRelationshipFixture(),check=relationshipConservation(id);
  expect(await relationshipExecute(preview.commandTemplate)).toMatchObject({state:'received',result:{cardCapabilityNeutralized:true,fundsMoved:false,orderChanged:false}});
  expect(h.cancels).toBe(1);check();
});
it.each(['role','standing_null','standing_string','restriction','acceptance_absent','auth_cutoff'])('relationship native gate refuses current %s without manufacturing a payment permission',async kind=>{
  const {id,preview,reference}=await nativeRelationshipFixture();
  if(kind==='role')change('users/operator',{isAdmin:false});if(kind==='standing_null')change('users/operator',{isActive:null});if(kind==='standing_string')change('users/operator',{isActive:'false'});
  if(kind==='restriction')change(`account_relationship_pairs/${reference.pairId}`,{pairRestriction:{blocked:false,reference}});
  if(kind==='acceptance_absent')change(`transactions/${id}`,{purchasePolicyAcceptance:null});
  if(kind==='auth_cutoff')h.authGet=async(uid:string)=>({uid,disabled:false,tokensValidAfterTime:new Date(Date.now()+1000).toISOString(),customClaims:{}});
  const check=relationshipConservation(id);await expect(relationshipExecute(preview.commandTemplate)).rejects.toBeDefined();expect(h.cancels).toBe(0);check();
});
it('relationship native inventory projects a malformed historical meetup origin as unknown and keeps page progression',async()=>{
  const {reference,relation}=await nativeRelationshipFixture();
  fs.setDoc('transactions/malformed_meetup',{buyerId:'buyer',sellerId:'seller',currency:'CAD',status:'meetup_confirmed',deliveryType:'meetup',
    createdAt:Timestamp.now(),offerMessageId:'/',chatId:'',totalAmount:-1,walletAmountUsed:2});
  const page:any=await relation.handleAccountRelationshipReview(relationshipRequest({capability:'account_relationship_review_v1',operation:'legacy_inventory',
    inventoryCapability:'account_relationship_legacy_inventory_v2',scope:'admin',decisionReference:reference}),'read');
  expect(page.rows.find((r:any)=>r.id==='malformed_meetup')).toMatchObject({kind:'purchase',source:{originQualification:'unknown',originHash:null},purchase:{totalCents:null}});
  expect(page.nextCursor).toMatchObject({kind:'purchase',direction:'second_to_first',lastId:null});expect(h.cancels).toBe(0);
});
it('relationship native fence closes its obsolete unstarted draft, remains readable after role loss, and permits a separate qualified intention',async()=>{
  const {id,preview,reference}=await nativeRelationshipFixture(),check=relationshipConservation(id),pairPath=`account_relationship_pairs/${reference.pairId}`;
  const originalRoot=fs.getDoc(pairPath)!;change(pairPath,{pairRestriction:{blocked:false,reference}});
  await expect(relationshipExecute(preview.commandTemplate)).rejects.toMatchObject({code:'permission-denied'});
  expect(await relationshipObserve(preview.commandTemplate)).toMatchObject({state:'unrecorded',preAuthorizationFenceSupported:true});
  expect(await relationshipNeutralize(preview.commandTemplate)).toMatchObject({state:'not_executed',reason:'requester_neutralized_before_authorization',result:null});
  change('users/operator',{isAdmin:false});expect(await relationshipObserve(preview.commandTemplate)).toMatchObject({state:'not_executed'});
  expect(await relationshipExecute(preview.commandTemplate)).toMatchObject({state:'not_executed'});expect(h.cancels).toBe(0);check();
  change('users/operator',{isAdmin:true});fs.setDoc(pairPath,originalRoot);
  expect(await relationshipExecute(preview.commandTemplate,'operator-retirement-0002')).toMatchObject({state:'received'});
  expect(await relationshipObserve(preview.commandTemplate)).toMatchObject({state:'not_executed'});expect(h.cancels).toBe(1);check();
});
it('relationship native fence wins before a late POST authorization; a genuinely authorized unknown can never become not_executed',async()=>{
  const {id,preview}=await nativeRelationshipFixture(),check=relationshipConservation(id),get=h.piRetrieve;let fenceOnNextRead=true;
  h.piRetrieve=async(...args:any[])=>{const pi=await get(...args);if(fenceOnNextRead){fenceOnNextRead=false;expect(await relationshipNeutralize(preview.commandTemplate)).toMatchObject({state:'not_executed'});}return pi;};
  expect(await relationshipExecute(preview.commandTemplate)).toMatchObject({state:'not_executed'});expect(h.cancels).toBe(0);check();
  h.piRetrieve=get;h.cancel=async()=>{h.cancels++;throw new Error('outcome unknown');};
  expect(await relationshipExecute(preview.commandTemplate,'operator-retirement-0002')).toMatchObject({state:'unknown'});
  expect(await relationshipNeutralize(preview.commandTemplate,'operator-retirement-0002')).toMatchObject({state:'unknown',result:null});
  expect(fs.getDoc(`stripe_checkout_intents/${id}`)!.relationshipRetirementFences).toHaveProperty(createHash('sha256').update(JSON.stringify(['operator','operator-retirement-0001'])).digest('hex'));
  expect(h.cancels).toBe(1);check();
});


it('card-only definitive decline never claims a wallet reservation and keeps financial documents unchanged',async()=>{
 fs.setDoc('wallets/buyer',null);
 const {q,id}=await reserved(),r=await checkout(id);
 const paths=['wallets/buyer','wallets/seller','wallets/seller/ledger/other_sale','transactions/old','articles/article',`shipping_quotes/${q.quoteId}`];
 const before=structuredClone(paths.map(p=>fs.getDoc(p)));
 h.confirm=async(piId:string)=>{h.confirms++;throw Object.assign(new Error('declined'),{type:'StripeCardError',statusCode:402,payment_intent:{...h.pis.get(piId)}});};
 const rejection=await confirm(id,r.intentVersion,'pm_declined').catch(error=>error);
 expect(rejection).toMatchObject({code:'failed-precondition',details:{reason:'stripe_checkout_payment_method_rejected',action:'choosePaymentMethod',paymentPermissionGranted:false}});
 expect(rejection.message).toBe('Ce moyen de paiement a été refusé.');
 expect(paths.map(p=>fs.getDoc(p))).toEqual(before);
 expect((await fs.db.collection('wallets').doc('buyer').collection('ledger').get()).docs).toHaveLength(0);
 expect(fs.getDoc(`transactions/${id}`)).toMatchObject({status:'pending_payment'});
 expect(fs.getDoc(`transactions/${id}`)).not.toHaveProperty('walletAmountUsed');
 expect(fs.getDoc(`transactions/${id}`)).not.toHaveProperty('paidVia');
 expect(fs.getDoc(`stripe_checkout_intents/${id}`)).toMatchObject({state:'requires_payment_method',walletCents:0});
 expect(fs.getDoc(`stripe_checkout_intents/${id}`)).not.toHaveProperty('walletCommittedAt');
 expect(h.confirms).toBe(1);expect(h.labels).toBe(0);
 expect(await checkout(id)).toMatchObject({providerStatus:'requires_payment_method',confirmationRequired:true,walletCents:0});
});
