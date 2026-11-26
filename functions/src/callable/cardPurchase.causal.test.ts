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
import { quoteShippingPurchase } from '../callable/payments/shippingPurchase';
import { createTransaction } from '../callable/payments/checkout';
import { payWithWallet } from '../callable/wallet';
import { createStripeCheckout, confirmStripeCheckout, retireLegacyStripeCheckout } from '../callable/payments/checkout';
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

const confirm=(id:string,version:number,pm?:string)=>call(confirmStripeCheckout,{transactionId:id,expectedIntentVersion:version,...(pm?{paymentMethodId:pm}:{})});
function gate(){let entered!:()=>void,release!:()=>void;const at=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);return{entered,release,at,wait};}
function economic(id:string){const paths=['wallets/buyer','wallets/seller','wallets/seller/ledger/other_sale','transactions/old',`transactions/${id}`,'articles/article'];
 const docs=()=>structuredClone(paths.map(p=>fs.getDoc(p)));const fullLedger=async()=>{const s=await fs.db.collection('wallets').doc('buyer').collection('ledger').get();return s.docs.map(d=>({id:d.id,data:structuredClone(d.data())})).sort((a,b)=>a.id.localeCompare(b.id));};return{docs,fullLedger};}
import { cancelPendingTransaction } from './payments/disputes';
async function money(id:string,q:any){
 const paths=['wallets/buyer','wallets/seller','transactions/old',`transactions/${id}`,'articles/article',`shipping_quotes/${q.quoteId}`];
 return{docs:structuredClone(paths.map(path=>({path,data:fs.getDoc(path)}))),ledgers:await Promise.all(['buyer','seller'].map(async uid=>({uid,docs:(await fs.db.collection('wallets').doc(uid).collection('ledger').get()).docs.map(d=>({id:d.id,data:structuredClone(d.data())})).sort((a,b)=>a.id.localeCompare(b.id))})))};
}
const intent=(id:string)=>structuredClone(fs.getDoc(`stripe_checkout_intents/${id}`));
it.each(['timeout','valid','decline'])('same attempt advanced by SCA observation fences its late %s',async kind=>{
 const {id,q}=await reserved(),r=await checkout(id,1000),g=gate();
 h.confirm=async(piId:string,p:any)=>{h.confirms++;const pi=h.pis.get(piId);pi.payment_method=p.payment_method;pi.status='requires_action';const reply=structuredClone(pi);g.entered();await g.wait;
 if(kind==='timeout')throw new Error('old timeout');if(kind==='decline')throw Object.assign(new Error('old decline'),{type:'StripeCardError',statusCode:402,payment_intent:{...reply,status:'requires_payment_method',payment_method:null}});return reply;};
 const first=confirm(id,r.intentVersion,'pm_action').then(value=>({value}),error=>({error}));await g.at;
 expect(await checkout(id,1000)).toMatchObject({intentVersion:4,actionClientSecret:'pi_manual_secret_local'});
 const before=await money(id,q),proof=intent(id);g.release();expect(await first).toMatchObject({error:{code:kind==='timeout'?'unavailable':'aborted'}});
 expect(intent(id)).toEqual(proof);expect(await money(id,q)).toEqual(before);expect(await checkout(id,1000)).toMatchObject({intentVersion:4,actionClientSecret:'pi_manual_secret_local'});expect(h.confirms).toBe(1);expect(h.labels).toBe(0);
});
it('old contradictory provider read retains a private proof without replacing newer SCA',async()=>{
 const {id,q}=await reserved(),r=await checkout(id,1000),g=gate(),real=h.piRetrieve;let reads=0;
 h.piRetrieve=async(piId:string)=>{const pi=structuredClone(await real(piId));if(++reads===1){g.entered();await g.wait;return{...pi,id:'pi_contradictory',client_secret:'pi_contradictory_secret_NEVER_STORE'};}return pi;};
 const old=checkout(id,1000).then(value=>({value}),error=>({error}));await g.at;expect((await confirm(id,r.intentVersion,'pm_action')).intentVersion).toBe(4);
 const before=await money(id,q),proof=intent(id);g.release();expect(await old).toMatchObject({error:{code:'aborted'}});
 expect(intent(id)).toMatchObject({state:proof.state,version:proof.version,confirmAttemptId:proof.confirmAttemptId});
 expect(intent(id)!.lateResponseEvidence.provider).toMatchObject({reason:'payment_intent_evidence_conflict',observed:{paymentIntentId:'pi_contradictory'}});
 expect(JSON.stringify(intent(id))).not.toContain('NEVER_STORE');expect(await money(id,q)).toEqual(before);expect(await checkout(id,1000)).toMatchObject({actionClientSecret:'pi_manual_secret_local'});
});
it('old ambiguous recovery after create commits retains linked PI and its private context',async()=>{
 const {id,q}=await reserved(),cg=gate(),lg=gate(),real=h.create;h.create=async(p:any)=>{const pi=await real(p);cg.entered();await cg.wait;return pi;};
 const first=checkout(id,1000).then(value=>({value}),error=>({error}));await cg.at;
 h.list=async()=>{lg.entered();await lg.wait;const pi=structuredClone(h.pis.get('pi_manual'));return{data:[pi,{...pi,id:'pi_duplicate'}],has_more:false};};
 const scan=checkout(id,1000).then(value=>({value}),error=>({error}));await lg.at;cg.release();expect(await first).toMatchObject({value:{intentVersion:2,preparationState:'prepared'}});
 const before=await money(id,q);lg.release();expect(await scan).toMatchObject({error:{code:'aborted'}});expect(intent(id)).toMatchObject({state:'prepared',version:2,paymentIntentId:'pi_manual'});
 expect(intent(id)!.lateResponseEvidence.recovery.reason).toBe('create_recovery_ambiguous');expect(await money(id,q)).toEqual(before);expect(h.params).toHaveLength(1);expect(await checkout(id,1000)).toMatchObject({confirmationRequired:true});
});
it('current contradictory confirm remains action-required with actual identity and no compensation',async()=>{
 const {id}=await reserved(),r=await checkout(id,1000);h.confirm=async()=>{h.confirms++;return{...h.pis.get('pi_manual'),id:'pi_contradictory'};};
 await expect(confirm(id,r.intentVersion,'pm_good')).rejects.toMatchObject({details:{reason:'stripe_checkout_reconciliation_required'}});
 expect(intent(id)).toMatchObject({state:'action_required',reason:'confirmation_response_conflict',observedPaymentIntentId:'pi_contradictory'});expect(fs.getDoc('wallets/buyer')!.balance).toBe(9000);expect(await economic(id).fullLedger()).toHaveLength(1);expect(h.confirms).toBe(1);expect(h.labels).toBe(0);
});
it('real cancellation during confirm IO fences timeout without overwriting lifecycle or refunded funds',async()=>{
 const {id,q}=await reserved(),r=await checkout(id,1000),g=gate();h.confirm=async()=>{h.confirms++;g.entered();await g.wait;throw new Error('old timeout');};
 const first=confirm(id,r.intentVersion,'pm_good').then(value=>({value}),error=>({error}));await g.at;await call(cancelPendingTransaction,{transactionId:id});expect(fs.getDoc(`transactions/${id}`)!.status).toBe('cancelled');
 const before=await money(id,q),proof=intent(id);g.release();expect(await first).toMatchObject({error:{code:'unavailable'}});expect(intent(id)).toEqual(proof);expect(await money(id,q)).toEqual(before);expect(fs.getDoc('wallets/buyer')!.balance).toBe(10000);expect(h.confirms).toBe(1);
});
it('late valid create after an unlinked ambiguity preserves real identity privately without adopting it',async()=>{
 const {id,q}=await reserved(),g=gate(),real=h.create;h.create=async(p:any)=>{const pi=await real(p);g.entered();await g.wait;return pi;};
 const first=checkout(id,1000).then(value=>({value}),error=>({error}));await g.at;
 h.list=async()=>{const pi=structuredClone(h.pis.get('pi_manual'));return{data:[pi,{...pi,id:'pi_duplicate'}],has_more:false};};
 await expect(checkout(id,1000)).rejects.toMatchObject({details:{reason:'stripe_checkout_reconciliation_required'}});expect(intent(id)).toMatchObject({state:'action_required',version:1});
 const before=await money(id,q);g.release();expect(await first).toMatchObject({error:{code:'aborted'}});
 expect(intent(id)).toMatchObject({lateResponseEvidence:{create:{reason:'create_response_conflict',expected:{state:'creating'},current:{state:'action_required'},observed:{paymentIntentId:'pi_manual',amountCents:5475,receivedCents:0,capturableCents:0}}}});
 expect(intent(id)).toMatchObject({state:'action_required',version:1});expect(fs.getDoc(`transactions/${id}`)).not.toHaveProperty('stripePaymentIntentId');expect(await money(id,q)).toEqual(before);expect(h.params).toHaveLength(1);expect(h.confirms).toBe(0);
});
