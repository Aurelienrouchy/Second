/** Actual Admin SDK Standard demo-second. No live provider: only IO simulated. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from '../../node_modules/firebase-admin/lib/esm/app/index.js';
import { getFirestore, FieldValue } from '../../node_modules/firebase-admin/lib/esm/firestore/index.js';
const enabled=process.env.SECOND_CARD_PURCHASE_SDK==='1';
if(enabled && (process.env.GCLOUD_PROJECT!=='demo-second'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')))throw new Error('Only demo-second loopback');
const h=vi.hoisted(()=>({db:null as FirebaseFirestore.Firestore|null,retrieve:null as any,get:null as any,analytics:null as any,piCreate:null as any,piRetrieve:null as any,confirm:null as any,cancel:null as any,list:null as any,pis:new Map<string,any>(),params:[] as any[],confirms:0,cancels:0,labels:0}));
vi.mock('../config/firebase',()=>({get db(){return h.db!;},FieldValue}));
vi.mock('../config/stripe',()=>({getStripe:()=>({accounts:{retrieve:(...a:any[])=>h.retrieve(...a)},paymentIntents:{create:(...a:any[])=>h.piCreate(...a),retrieve:(...a:any[])=>h.piRetrieve(...a),confirm:(...a:any[])=>h.confirm(...a),cancel:(...a:any[])=>h.cancel(...a),list:(...a:any[])=>h.list(...a)}})}));
vi.mock('../config/shipEngine',()=>({getShipEngine:()=>({getPurchaseRates:async()=>purchaseRates(),getPurchaseRatesForShipment:(...a:any[])=>h.get(...a)})}));
vi.mock('../utils/labelFulfillment',async original=>({...await original<any>(),createLabelIdempotent:async()=>{h.labels++;return 'failed';}}));
vi.mock('../lib/analytics',()=>({captureServerEvent:(...a:any[])=>h.analytics(...a)}));
vi.mock('../utils/rateLimit',()=>({checkRateLimit:async()=>{},resolveCallerKey:(r:any)=>({callerKey:r.auth?.uid,isAuthenticated:!!r.auth})}));
import { quoteShippingPurchase } from '../callable/payments/shippingPurchase';
import { createTransaction,createStripeCheckout,confirmStripeCheckout,retireLegacyStripeCheckout } from '../callable/payments/checkout';
import { cancelPendingTransaction } from '../callable/payments/disputes';
import { payWithWallet } from '../callable/wallet';
import { expireOrphanedTransactions } from '../scheduled/transactionExpiration';
import { purchaseAddress,purchaseParcel,purchaseAccount,purchaseRates,personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
import { invalidateConnectObservation } from '../utils/connectEligibility';
const seller='author_03b3c_v3_causal_seller',buyer='author_03b3c_v3_causal_buyer',articleId='author_03b3c_v3_causal_article',legacyId='author_03b3c_v3_causal_legacy';
const call=(fn:any,data:any,uid=buyer)=>fn.run({auth:{uid,token:{}},data});
const pay=(id:string)=>call(payWithWallet,{transactionId:id});
const read=async(path:string)=>(await h.db!.doc(path).get()).data();
const orders=()=>h.db!.collection('transactions').where('articleId','==',articleId).get();
async function reserved(){const q=await call(quoteShippingPurchase,{articleId,shippingAddress:purchaseAddress});const r=await call(createTransaction,{deliveryType:'shipping',quoteId:q.quoteId,rateId:q.rates[0].rateId,expectedTotal:q.rates[0].totalAmount});return{q,id:r.transactionId as string};}
describe.skipIf(!enabled)('03B3C native manual confirmation/retirement',()=>{
  const app=enabled?initializeApp({projectId:'demo-second'},'author_03b3c_v3_causal'):null;
  beforeAll(()=>{if(app)h.db=getFirestore(app);});
  async function clean(){if(!h.db)return;
    for(const uid of[buyer,seller])for(const d of(await h.db.collection(`wallets/${uid}/ledger`).get()).docs)await d.ref.delete();
    for(const c of['transactions','shipping_quotes'])for(const d of(await h.db.collection(c).where('articleId','==',articleId).get()).docs){if(c==='transactions')await h.db.doc(`stripe_checkout_intents/${d.id}`).delete();await d.ref.delete();}
    for(const p of[`articles/${articleId}`,`shipping_packages/${articleId}`,`wallets/${buyer}`,`wallets/${seller}`,`transactions/${legacyId}`,`shops/author_03b3c_v3_causal_shop`,...['bank_sale','buyer_sale'].map(id=>`transactions/author_03b3c_v3_causal_${id}`),...[buyer,seller].flatMap(uid=>[`users/${uid}`,`eligibility_profiles/${uid}`])])await h.db.doc(p).delete();
  }
  beforeEach(async()=>{await clean();vi.stubEnv('PAYMENTS_ENABLED','true');vi.stubEnv('SHIPPING_ENABLED','true');h.labels=0;h.retrieve=async()=>purchaseAccount(seller);h.get=async()=>purchaseRates();h.analytics=async()=>{};h.pis.clear();h.params=[];h.confirms=0;h.cancels=0;
    h.piCreate=async(p:any)=>{h.params.push(p);const pi={id:'pi_native',object:'payment_intent',amount:p.amount,amount_received:0,amount_capturable:0,currency:'cad',status:'requires_payment_method',confirmation_method:p.confirmation_method??'automatic',capture_method:'automatic_async',metadata:p.metadata,client_secret:'pi_native_secret_simulated',payment_method:null};h.pis.set(pi.id,pi);return {...pi};};
    h.piRetrieve=async(id:string)=>{const pi=h.pis.get(id);if(!pi)throw new Error('Missing PI proof');return {...pi};};
    h.confirm=async(id:string,p:any)=>{h.confirms++;const pi=h.pis.get(id);if(pi.status==='canceled')throw new Error('Canceled PI cannot confirm');pi.payment_method=p.payment_method??pi.payment_method;pi.status=pi.payment_method==='pm_action'&&pi.status!=='requires_confirmation'?'requires_action':'succeeded';if(pi.status==='succeeded')pi.amount_received=pi.amount;return {...pi};};
    h.cancel=async(id:string)=>{h.cancels++;const pi=h.pis.get(id);if(['succeeded','processing','requires_capture'].includes(pi.status))throw new Error('Not safely cancellable');pi.status='canceled';return {...pi};};
    h.list=async()=>({data:[],has_more:false});
    await h.db!.doc(`articles/${articleId}`).set({sellerId:seller,price:50,title:'Manteau',isActive:true,isShipping:true,isSold:false});
    await h.db!.doc(`users/${buyer}`).set({dateOfBirth:'2000-01-01',isActive:true,addresses:[{...purchaseAddress,province:'ON',postalCode:'M5V1A1'}]});
    await h.db!.doc(`users/${seller}`).set({dateOfBirth:'2000-01-01',isActive:true,displayName:'Seller',stripeAccountId:'acct_purchase',stripeChargesEnabled:true,addresses:[{...purchaseAddress,name:'Seller',isDefault:true}]});
    await h.db!.doc(`eligibility_profiles/${seller}`).set(personalProfile(seller));
    await h.db!.doc(`shipping_packages/${articleId}`).set({schemaVersion:1,articleId,ownerId:seller,version:1,source:'seller_declared',measurementVerified:false,parcel:purchaseParcel});
    await h.db!.doc(`wallets/${buyer}`).set({balance:10000,pendingBalance:700,heldBalance:800,status:'active',currency:'cad'});
    await h.db!.doc(`wallets/${seller}`).set({balance:2500,pendingBalance:9000,heldBalance:4500,status:'active',currency:'cad',sellerDebt:0});
    await h.db!.doc(`wallets/${seller}/ledger/old`).set({type:'sale_pending',transactionId:legacyId,amount:9000,createdAt:FieldValue.serverTimestamp(),description:'Exact old data'});
    await h.db!.doc(`transactions/${legacyId}`).set({buyerId:buyer,sellerId:seller,articleId:'author_03b3c_v3_causal_old_article',status:'delivered',shippingAddress:{province:'ON',country:'CA'},stripePaymentIntentId:'pi_legacy',totalAmount:90});
  });
  afterAll(async()=>{await clean();if(app)await deleteApp(app);vi.unstubAllEnvs();});
  async function conserved(id:string){const paths=[`wallets/${buyer}`,`wallets/${seller}`,`wallets/${seller}/ledger/old`,`transactions/${legacyId}`,`articles/${articleId}`,`transactions/${id}`];const before=await Promise.all(paths.map(read));const ledger=await h.db!.collection(`wallets/${buyer}/ledger`).get();
    return async()=>{expect(await Promise.all(paths.map(read))).toEqual(before);expect((await h.db!.collection(`wallets/${buyer}/ledger`).get()).docs.map(d=>d.data())).toEqual(ledger.docs.map(d=>d.data()));expect(h.labels).toBe(0);};}

  const prepare=(id:string,walletAmount=0)=>call(createStripeCheckout,{transactionId:id,walletAmount});
  const confirm=(id:string,version:number,pm?:string)=>call(confirmStripeCheckout,{transactionId:id,expectedIntentVersion:version,...(pm?{paymentMethodId:pm}:{})});
  const ledger=async(id:string)=>(await h.db!.collection(`wallets/${buyer}/ledger`).where('transactionId','==',id).get()).docs.map(d=>({id:d.id,data:d.data()}));
  async function oldConserved(){const paths=[`wallets/${seller}`,`wallets/${seller}/ledger/old`,`transactions/${legacyId}`];const before=await Promise.all(paths.map(read));return async()=>expect(await Promise.all(paths.map(read))).toEqual(before);}

  function gate(){let entered!:()=>void,release!:()=>void;const at=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);return{entered,release,at,wait};}
  async function snapshot(id:string,q:any){const paths=[`wallets/${buyer}`,`wallets/${seller}`,`transactions/${legacyId}`,`transactions/${id}`,`articles/${articleId}`,`shipping_quotes/${q.quoteId}`];
    const documents=await Promise.all(paths.map(async path=>{const d=await h.db!.doc(path).get();return{path,id:d.id,data:d.data(),updateTime:d.updateTime};}));
    const ledgers=await Promise.all([buyer,seller].map(async uid=>{const s=await h.db!.collection(`wallets/${uid}/ledger`).get();return{uid,docs:s.docs.map(d=>({id:d.id,data:d.data(),updateTime:d.updateTime})).sort((a,b)=>a.id.localeCompare(b.id))};}));return{documents,ledgers};}
  function monetary(s:any,id:string){return{...s,documents:s.documents.map((d:any)=>{if(d.path!==`transactions/${id}`)return d;const data={...d.data};delete data.walletCheckoutOutcome;return{path:d.path,id:d.id,data};})};}


  it.each(['timeout','valid'])('native same attempt SCA observation fences late %s and preserves complete documents',async kind=>{
    const {id,q}=await reserved(),r=await prepare(id,1000),g=gate();
    h.confirm=async(piId:string,p:any)=>{h.confirms++;const pi=h.pis.get(piId);pi.payment_method=p.payment_method;pi.status='requires_action';const reply=structuredClone(pi);g.entered();await g.wait;if(kind==='timeout')throw new Error('old timeout');return reply;};
    const first=confirm(id,r.intentVersion,'pm_action').then(value=>({value}),error=>({error}));await g.at;
    expect(await prepare(id,1000)).toMatchObject({intentVersion:4,actionClientSecret:'pi_native_secret_simulated'});
    const before=await snapshot(id,q),privateBefore=await h.db!.doc(`stripe_checkout_intents/${id}`).get();g.release();expect(await first).toMatchObject({error:{code:kind==='timeout'?'unavailable':'aborted'}});
    expect(await snapshot(id,q)).toEqual(before);const current=await h.db!.doc(`stripe_checkout_intents/${id}`).get();expect(current.data()).toEqual(privateBefore.data());expect(current.updateTime).toEqual(privateBefore.updateTime);
    expect(await prepare(id,1000)).toMatchObject({intentVersion:4,actionClientSecret:'pi_native_secret_simulated'});expect(h.confirms).toBe(1);expect(h.labels).toBe(0);
  });
  it('native stale conflicting retrieve stores bounded private evidence with native time and keeps current SCA',async()=>{
    const {id,q}=await reserved(),r=await prepare(id,1000),g=gate(),real=h.piRetrieve;let reads=0;
    h.piRetrieve=async(piId:string)=>{const pi=structuredClone(await real(piId));if(++reads===1){g.entered();await g.wait;return{...pi,id:'pi_contradictory',client_secret:'NEVER_STORE'};}return pi;};
    const first=prepare(id,1000).then(value=>({value}),error=>({error}));await g.at;expect((await confirm(id,r.intentVersion,'pm_action')).intentVersion).toBe(4);
    const before=await snapshot(id,q),proof=await read(`stripe_checkout_intents/${id}`);g.release();expect(await first).toMatchObject({error:{code:'aborted'}});
    expect(await snapshot(id,q)).toEqual(before);const current=await read(`stripe_checkout_intents/${id}`);expect(current).toMatchObject({state:proof!.state,version:proof!.version,confirmAttemptId:proof!.confirmAttemptId});
    expect(current!.lateResponseEvidence.provider).toMatchObject({expected:{version:2,state:'prepared'},current:{version:4,state:'requires_action'},observed:{paymentIntentId:'pi_contradictory'}});
    expect(current!.lateResponseEvidence.provider.observedAt.toMillis()).toBeGreaterThan(0);expect(current!.walletCommittedAt.toMillis()).toBeGreaterThan(0);expect(current!.authorizedAt.toMillis()).toBeGreaterThan(0);
    expect(Object.keys(current!.lateResponseEvidence)).toEqual(['provider']);expect(JSON.stringify(current)).not.toContain('NEVER_STORE');expect(await prepare(id,1000)).toMatchObject({actionClientSecret:'pi_native_secret_simulated'});
  });
  it('native actual cancel during confirm IO keeps both full ledgers, lifecycle and native timestamps after late timeout',async()=>{
    const {id,q}=await reserved(),r=await prepare(id,1000),g=gate();h.confirm=async()=>{h.confirms++;g.entered();await g.wait;throw new Error('old timeout');};
    const first=confirm(id,r.intentVersion,'pm_good').then(value=>({value}),error=>({error}));await g.at;await call(cancelPendingTransaction,{transactionId:id});expect((await read(`transactions/${id}`))!.status).toBe('cancelled');
    const before=await snapshot(id,q),privateBefore=await h.db!.doc(`stripe_checkout_intents/${id}`).get();g.release();expect(await first).toMatchObject({error:{code:'unavailable'}});
    expect(await snapshot(id,q)).toEqual(before);const current=await h.db!.doc(`stripe_checkout_intents/${id}`).get();expect(current.data()).toEqual(privateBefore.data());expect(current.updateTime).toEqual(privateBefore.updateTime);expect((await read(`wallets/${buyer}`))!.balance).toBe(10000);expect(h.confirms).toBe(1);expect(h.labels).toBe(0);
  });
  it('native late valid create after unlinked review retains actual ID privately without adoption or permission',async()=>{
    const {id,q}=await reserved(),g=gate(),real=h.piCreate;h.piCreate=async(p:any)=>{const pi=await real(p);g.entered();await g.wait;return pi;};
    const first=prepare(id,1000).then(value=>({value}),error=>({error}));await g.at;
    h.list=async()=>{const pi=structuredClone(h.pis.get('pi_native'));return{data:[pi,{...pi,id:'pi_duplicate'}],has_more:false};};
    await expect(prepare(id,1000)).rejects.toMatchObject({details:{reason:'stripe_checkout_reconciliation_required'}});expect(await read(`stripe_checkout_intents/${id}`)).toMatchObject({state:'action_required',version:1});
    const before=await snapshot(id,q);g.release();expect(await first).toMatchObject({error:{code:'aborted'}});expect(await snapshot(id,q)).toEqual(before);
    const current=await read(`stripe_checkout_intents/${id}`);expect(current).toMatchObject({state:'action_required',version:1,lateResponseEvidence:{create:{expected:{state:'creating'},current:{state:'action_required'},observed:{paymentIntentId:'pi_native',amountCents:5475,receivedCents:0,capturableCents:0}}}});
    expect(current!.lateResponseEvidence.create.observedAt.toMillis()).toBeGreaterThan(0);expect(current).not.toHaveProperty('paymentIntentId');expect((await read(`transactions/${id}`))).not.toHaveProperty('stripePaymentIntentId');expect(h.confirms).toBe(0);expect(h.params).toHaveLength(1);expect(h.labels).toBe(0);
  });

});
