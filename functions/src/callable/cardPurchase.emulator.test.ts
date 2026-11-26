/** Actual Admin SDK Standard demo-second. No live provider: only IO simulated. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const enabled=process.env.SECOND_CARD_PURCHASE_SDK==='1';
if(enabled && (process.env.GCLOUD_PROJECT!=='demo-second'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')))throw new Error('Only demo-second loopback');
const h=vi.hoisted(()=>({db:null as FirebaseFirestore.Firestore|null,retrieve:null as any,get:null as any,analytics:null as any,piCreate:null as any,piRetrieve:null as any,confirm:null as any,cancel:null as any,list:null as any,pis:new Map<string,any>(),params:[] as any[],confirms:0,cancels:0,labels:0}));
vi.mock('../config/firebase',()=>({get db(){return h.db!;},FieldValue}));
vi.mock('../config/stripe',()=>({getStripe:()=>({accounts:{retrieve:(...a:any[])=>h.retrieve(...a)},paymentIntents:{create:(...a:any[])=>h.piCreate(...a),retrieve:(...a:any[])=>h.piRetrieve(...a),confirm:(...a:any[])=>h.confirm(...a),cancel:(...a:any[])=>h.cancel(...a),list:(...a:any[])=>h.list(...a)}})}));
vi.mock('../config/shipEngine',()=>({getShipEngine:()=>({getPurchaseRates:async()=>purchaseRates(),getPurchaseRatesForShipment:(...a:any[])=>h.get(...a)})}));
vi.mock('../utils/labelFulfillment',async original=>({...await original<any>(),createLabelIdempotent:async()=>{h.labels++;return 'failed';}}));
vi.mock('../lib/analytics',()=>({captureServerEvent:(...a:any[])=>h.analytics(...a)}));
vi.mock('../utils/rateLimit',()=>({checkRateLimit:async()=>{},resolveCallerKey:(r:any)=>({callerKey:r.auth?.uid,isAuthenticated:!!r.auth})}));
import { quoteShippingPurchase } from './payments/shippingPurchase';
import { createTransaction,createStripeCheckout,confirmStripeCheckout,retireLegacyStripeCheckout } from './payments/checkout';
import { cancelPendingTransaction } from './payments/disputes';
import { payWithWallet } from './wallet';
import { expireOrphanedTransactions } from '../scheduled/transactionExpiration';
import { purchaseAddress,purchaseParcel,purchaseAccount,purchaseRates,personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
import { invalidateConnectObservation } from '../utils/connectEligibility';
const seller='author_03b3c_seller',buyer='author_03b3c_buyer',articleId='author_03b3c_article',legacyId='author_03b3c_legacy';
const call=(fn:any,data:any,uid=buyer)=>fn.run({auth:{uid,token:{}},data});
const pay=(id:string)=>call(payWithWallet,{transactionId:id});
const read=async(path:string)=>(await h.db!.doc(path).get()).data();
const orders=()=>h.db!.collection('transactions').where('articleId','==',articleId).get();
async function reserved(){const q=await call(quoteShippingPurchase,{articleId,shippingAddress:purchaseAddress});const r=await call(createTransaction,{deliveryType:'shipping',quoteId:q.quoteId,rateId:q.rates[0].rateId,expectedTotal:q.rates[0].totalAmount});return{q,id:r.transactionId as string};}
describe.skipIf(!enabled)('03B3C native manual confirmation/retirement',()=>{
  const app=enabled?initializeApp({projectId:'demo-second'},'author_03b3c'):null;
  beforeAll(()=>{if(app)h.db=getFirestore(app);});
  async function clean(){if(!h.db)return;
    for(const uid of[buyer,seller])for(const d of(await h.db.collection(`wallets/${uid}/ledger`).get()).docs)await d.ref.delete();
    for(const c of['transactions','shipping_quotes'])for(const d of(await h.db.collection(c).where('articleId','==',articleId).get()).docs){if(c==='transactions')await h.db.doc(`stripe_checkout_intents/${d.id}`).delete();await d.ref.delete();}
    for(const p of[`articles/${articleId}`,`shipping_packages/${articleId}`,`wallets/${buyer}`,`wallets/${seller}`,`transactions/${legacyId}`,`shops/author_03b3c_shop`,...['bank_sale','buyer_sale'].map(id=>`transactions/author_03b3c_${id}`),...[buyer,seller].flatMap(uid=>[`users/${uid}`,`eligibility_profiles/${uid}`])])await h.db.doc(p).delete();
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
    await h.db!.doc(`transactions/${legacyId}`).set({buyerId:buyer,sellerId:seller,articleId:'author_03b3c_old_article',status:'delivered',shippingAddress:{province:'ON',country:'CA'},stripePaymentIntentId:'pi_legacy',totalAmount:90});
  });
  afterAll(async()=>{await clean();if(app)await deleteApp(app);vi.unstubAllEnvs();});
  async function conserved(id:string){const paths=[`wallets/${buyer}`,`wallets/${seller}`,`wallets/${seller}/ledger/old`,`transactions/${legacyId}`,`articles/${articleId}`,`transactions/${id}`];const before=await Promise.all(paths.map(read));const ledger=await h.db!.collection(`wallets/${buyer}/ledger`).get();
    return async()=>{expect(await Promise.all(paths.map(read))).toEqual(before);expect((await h.db!.collection(`wallets/${buyer}/ledger`).get()).docs.map(d=>d.data())).toEqual(ledger.docs.map(d=>d.data()));expect(h.labels).toBe(0);};}

  const prepare=(id:string,walletAmount=0)=>call(createStripeCheckout,{transactionId:id,walletAmount});
  const confirm=(id:string,version:number,pm?:string)=>call(confirmStripeCheckout,{transactionId:id,expectedIntentVersion:version,...(pm?{paymentMethodId:pm}:{})});
  const ledger=async(id:string)=>(await h.db!.collection(`wallets/${buyer}/ledger`).where('transactionId','==',id).get()).docs.map(d=>({id:d.id,data:d.data()}));
  async function oldConserved(){const paths=[`wallets/${seller}`,`wallets/${seller}/ledger/old`,`transactions/${legacyId}`];const before=await Promise.all(paths.map(read));return async()=>expect(await Promise.all(paths.map(read))).toEqual(before);}
  it('SDK card only professional ON buyer needs no wallet; prepare/confirm grant no fulfillment or labels',async()=>{
    await h.db!.doc(`wallets/${buyer}`).delete();await h.db!.doc(`eligibility_profiles/${buyer}`).set(personalProfile(buyer,'professional'));
    const {id}=await reserved(),old=await oldConserved();const r=await prepare(id);expect(r).toMatchObject({walletCents:0,cardCents:6475,protocol:'server_manual_v1'});expect(r).not.toHaveProperty('clientSecret');const c=await confirm(id,r.intentVersion,'pm_good');expect(c).toMatchObject({providerStatus:'succeeded',paymentPermissionGranted:false,settlementPending:true});expect((await read(`transactions/${id}`))!.status).toBe('pending_payment');expect(await ledger(id)).toEqual([]);await old();expect(h.labels).toBe(0);
  });
  it('SDK mixed SCA reconfirm consumes exact wallet once with native ID/Timestamp; replay after missing profile/flags OFF is read-only',async()=>{
    const {id}=await reserved(),old=await oldConserved();const r=await prepare(id,1000);expect((await read(`wallets/${buyer}`))!.balance).toBe(10000);const action=await confirm(id,r.intentVersion,'pm_action');expect(action.actionClientSecret).toBe('pi_native_secret_simulated');const committed=await ledger(id);expect(committed).toHaveLength(1);expect(committed[0].data.createdAt.toMillis()).toBeGreaterThan(0);expect(committed[0].data).toMatchObject({amount:1000,balanceAfter:9000,currency:'CAD'});
    h.pis.get('pi_native').status='requires_confirmation';const result=await confirm(id,action.intentVersion);expect(result.providerStatus).toBe('succeeded');expect(await ledger(id)).toEqual(committed);expect((await read(`wallets/${buyer}`))!).toMatchObject({balance:9000,pendingBalance:700,heldBalance:800});await old();
    vi.stubEnv('PAYMENTS_ENABLED','false');vi.stubEnv('SHIPPING_ENABLED','false');await h.db!.doc(`users/${buyer}`).update({dateOfBirth:null});await h.db!.doc(`eligibility_profiles/${seller}`).delete();const check=await conserved(id);const replay=await prepare(id,1000);expect(replay.providerStatus).toBe('succeeded');await check();expect(h.confirms).toBe(2);
  });
  it('SDK first mixed debit then SCA then minor buyer refuses the actually reached second authorization',async()=>{
    const {id}=await reserved();const r=await prepare(id,1000),a=await confirm(id,r.intentVersion,'pm_action');h.pis.get('pi_native').status='requires_confirmation';await h.db!.doc(`users/${buyer}`).update({dateOfBirth:String(new Date().getUTCFullYear()-16)+'-01-01'});const check=await conserved(id);await expect(confirm(id,a.intentVersion)).rejects.toMatchObject({code:'permission-denied'});await check();expect(h.confirms).toBe(1);expect((await read(`wallets/${buyer}`))!.balance).toBe(9000);
  });
  it('SDK two preparations join one private intent: one provider create, no debit',async()=>{
    const {id}=await reserved();const results=await Promise.allSettled([prepare(id,1000),prepare(id,1000)]);expect(results.some(r=>r.status==='fulfilled')).toBe(true);expect(h.params).toHaveLength(1);expect(await ledger(id)).toEqual([]);expect((await read(`wallets/${buyer}`))!.balance).toBe(10000);const replay=await prepare(id,1000);expect(replay.protocol).toBe('server_manual_v1');expect(h.params).toHaveLength(1);
  });
  it('SDK two confirmations cannot create two mixed debits or independent provider authorizations',async()=>{
    const {id}=await reserved(),r=await prepare(id,1000);const results=await Promise.allSettled([confirm(id,r.intentVersion,'pm_good'),confirm(id,r.intentVersion,'pm_good')]);expect(results.some(r=>r.status==='fulfilled')).toBe(true);expect(h.confirms).toBe(1);expect(await ledger(id)).toHaveLength(1);expect((await read(`wallets/${buyer}`))!.balance).toBe(9000);
  });
  it('SDK card preparation durable before suspended create blocks accepted wallet handler; complete actual manual response',async()=>{
    const {id}=await reserved();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),released=new Promise<void>(r=>release=r),create=h.piCreate;
    h.piCreate=async(p:any)=>{enter();await released;return create(p);};const pending=prepare(id);await Promise.race([entered,pending.then(()=>{throw new Error('IO not reached');})]);const check=await conserved(id);try{await expect(pay(id)).rejects.toMatchObject({details:{reason:'wallet_payment_reconciliation_required'}});await check();}finally{release();}expect((await pending).protocol).toBe('server_manual_v1');expect(await ledger(id)).toEqual([]);
  });
  it('SDK wallet GET suspended before final debit loses to card durable preparation; no two rails debit',async()=>{
    const {id}=await reserved();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),released=new Promise<void>(r=>release=r);let gets=0;h.get=async()=>{gets++;if(gets===1){enter();await released;}return purchaseRates();};const wallet=pay(id);await Promise.race([entered,wallet.then(()=>{throw new Error('GET not reached');})]);const card=await prepare(id);expect(card.protocol).toBe('server_manual_v1');release();await expect(wallet).rejects.toBeDefined();expect(await ledger(id)).toEqual([]);expect((await read(`wallets/${buyer}`))!.balance).toBe(10000);expect(h.labels).toBe(0);
  });
  it.each(['cancel','expiration'])('SDK authorization/debit committed, confirm IO suspended, real %s neutralizes PI before restitution',async kind=>{
    const {id}=await reserved(),r=await prepare(id,1000);if(kind==='expiration')await h.db!.doc(`transactions/${id}`).update({createdAt:new Date(Date.now()-2*3600000)});
    const old=await oldConserved();let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),released=new Promise<void>(r=>release=r),providerConfirm=h.confirm;
    h.confirm=async(...a:any[])=>{enter();await released;return providerConfirm(...a);};const payment=confirm(id,r.intentVersion,'pm_good');await Promise.race([entered,payment.then(()=>{throw new Error('confirm IO not reached');})]);
    expect((await read(`wallets/${buyer}`))!.balance).toBe(9000);expect(await ledger(id)).toHaveLength(1);expect((await read(`stripe_checkout_intents/${id}`))!.state).toBe('confirming');
    try {if(kind==='cancel')expect(await call(cancelPendingTransaction,{transactionId:id})).toMatchObject({success:true});else await (expireOrphanedTransactions as any).run({});}finally{release();}
    await expect(payment).rejects.toMatchObject({code:'unavailable'});expect(h.pis.get('pi_native').status).toBe('canceled');expect((await read(`wallets/${buyer}`))!).toMatchObject({balance:10000,pendingBalance:700,heldBalance:800});const movements=await ledger(id);expect(movements.map(r=>r.data.type).sort()).toEqual(['purchase_debit','refund_credit']);expect(movements.every(r=>r.data.amount===1000&&r.data.createdAt.toMillis()>0)).toBe(true);expect((await read(`transactions/${id}`))!.status).toBe('cancelled');expect((await read(`articles/${articleId}`))!.isSold).toBe(false);await old();expect(h.labels).toBe(0);
  });
  it('SDK lost create reply recovers exact metadata/PI, never another request or debit',async()=>{
    const {id}=await reserved(),create=h.piCreate;h.piCreate=async(p:any)=>{await create(p);throw new Error('response lost');};await expect(prepare(id,1000)).rejects.toMatchObject({code:'unavailable'});const check=await conserved(id);h.list=async()=>({data:[{...h.pis.get('pi_native')}],has_more:false});const result=await prepare(id,1000);expect(result.protocol).toBe('server_manual_v1');expect(h.params).toHaveLength(1);expect((await read(`wallets/${buyer}`))!.balance).toBe(10000);expect(await ledger(id)).toEqual([]);expect((await read(`transactions/${id}`))!.stripePaymentIntentId).toBe('pi_native');const old=await oldConserved();await old();expect(h.labels).toBe(0);
  });
  it.each(['absent','foreign','ambiguous','saturated'])('SDK lost create %s remains action/unknown, full native money/order preserved',async kind=>{
    const {id}=await reserved(),create=h.piCreate;h.piCreate=async(p:any)=>{await create(p);throw new Error('response lost');};await expect(prepare(id,1000)).rejects.toBeDefined();const check=await conserved(id);let pages=0;h.list=async()=>{pages++;const pi=h.pis.get('pi_native');if(kind==='foreign')return{data:[{...pi,metadata:{...pi.metadata,buyerId:'other'}}],has_more:false};if(kind==='ambiguous')return{data:[pi,{...pi,id:'pi_duplicate'}],has_more:false};if(kind==='saturated')return{data:Array.from({length:100},(_,n)=>({...pi,id:`pi_foreign${pages}${n}`,metadata:{checkoutIntentId:'other'}})),has_more:true};return{data:[],has_more:false};};await expect(prepare(id,1000)).rejects.toBeDefined();await check();expect(h.params).toHaveLength(1);expect(pages).toBeLessThanOrEqual(5);expect((await read(`transactions/${id}`))!.stripePaymentIntentId).toBeUndefined();
  });
  it.each(['buyer','bank','refund'])('SDK isolated %s written during real rate IO is read before confirm money',async kind=>{
    const {id}=await reserved(),r=await prepare(id,1000),before=await read(`wallets/${buyer}`),old=await oldConserved();let reached=false;h.get=async()=>{reached=true;if(kind==='buyer')await h.db!.doc(`users/${buyer}`).update({dateOfBirth:String(new Date().getUTCFullYear()-16)+'-01-01'});if(kind==='bank')await h.db!.doc(`transactions/${id}`).update({bankDispute:{id:'dp_open',state:'open'}});if(kind==='refund')await h.db!.doc(`transactions/${id}`).update({refundBlocked:true});return purchaseRates();};await expect(confirm(id,r.intentVersion,'pm_good')).rejects.toBeDefined();expect(reached).toBe(true);expect(await read(`wallets/${buyer}`)).toEqual(before);expect(await ledger(id)).toEqual([]);await old();expect(h.confirms).toBe(0);
  });
  it('SDK exact archived historical mixed handler produces native debit, then explicit retirement preserves obligation after flags OFF/missing profiles',async()=>{
    const {id}=await reserved();const historical:any=await vi.importActual('03b3c-historical-checkout');
    const oldResult=await call(historical.createStripeCheckout,{transactionId:id,walletAmount:1000});expect(oldResult).toMatchObject({success:true,clientSecret:'pi_native_secret_simulated'});expect(h.params[0].confirmation_method).toBeUndefined();expect(h.pis.get('pi_native').confirmation_method).toBe('automatic');expect((await read(`wallets/${buyer}`))!.balance).toBe(9000);const movements=await ledger(id);expect(movements).toHaveLength(1);expect(movements[0].data).toMatchObject({type:'purchase_debit',amount:1000,balanceAfter:9000});expect(movements[0].data.createdAt.toMillis()).toBeGreaterThan(0);
    await h.db!.doc(`users/${buyer}`).update({dateOfBirth:null});await h.db!.doc(`eligibility_profiles/${seller}`).delete();vi.stubEnv('PAYMENTS_ENABLED','false');vi.stubEnv('SHIPPING_ENABLED','false');const snapshot=await prepare(id,1000);expect(snapshot).toMatchObject({protocol:'legacy',legacyCardCapabilityOpen:true,walletCents:1000});const check=await conserved(id);
    const result=await call(retireLegacyStripeCheckout,{transactionId:id,expectedPaymentIntentId:'pi_native',expectedRetirementVersion:snapshot.retirementVersion});expect(result).toMatchObject({cardCapabilityNeutralized:true,walletObligationOpen:true});await check();expect(h.pis.get('pi_native').status).toBe('canceled');expect(await ledger(id)).toEqual(movements);const cancels=h.cancels;expect(await call(retireLegacyStripeCheckout,{transactionId:id})).toMatchObject({replay:true,walletObligationOpen:true});await check();expect(h.cancels).toBe(cancels);expect((await read(`transactions/${id}`))!.status).toBe('pending_payment');
  });

  it('SDK DISTINCT full native snapshot: historical mixed retirement and replay preserve quote/claim, full ledger IDs/Timestamps/updateTimes and all money/locks',async()=>{
    const {id,q}=await reserved();const historical:any=await vi.importActual('03b3c-historical-checkout');await call(historical.createStripeCheckout,{transactionId:id,walletAmount:1000});
    const paths=[`wallets/${buyer}`,`wallets/${seller}`,`wallets/${seller}/ledger/old`,`transactions/${legacyId}`,`transactions/${id}`,`articles/${articleId}`,`shipping_quotes/${q.quoteId}`];
    async function snapshot(){const documents=await Promise.all(paths.map(async path=>{const d=await h.db!.doc(path).get();return{path,id:d.id,data:d.data(),updateTime:d.updateTime};}));const ledgers=await h.db!.collection(`wallets/${buyer}/ledger`).get();return{documents,ledger:ledgers.docs.map(d=>({id:d.id,data:d.data(),updateTime:d.updateTime})).sort((a,b)=>a.id.localeCompare(b.id))};}
    const before=await snapshot();expect(before.ledger).toHaveLength(1);expect(before.ledger[0].data.createdAt.toMillis()).toBeGreaterThan(0);expect(before.documents.find(d=>d.path.startsWith('shipping_quotes/'))!.data!.state).toBe('claimed');
    const r=await prepare(id,1000);await call(retireLegacyStripeCheckout,{transactionId:id,expectedPaymentIntentId:'pi_native',expectedRetirementVersion:r.retirementVersion});expect(await snapshot()).toEqual(before);const calls=h.cancels;await call(retireLegacyStripeCheckout,{transactionId:id});expect(await snapshot()).toEqual(before);expect(h.cancels).toBe(calls);expect(h.pis.get('pi_native').status).toBe('canceled');
  });
});
