/** Actual Admin SDK Standard demo-second. No live provider: only IO simulated. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
const enabled=process.env.SECOND_WALLET_PURCHASE_SDK==='1';
if(enabled && (process.env.GCLOUD_PROJECT!=='demo-second'||!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')))throw new Error('Only demo-second loopback');
const h=vi.hoisted(()=>({db:null as FirebaseFirestore.Firestore|null,retrieve:null as any,get:null as any,analytics:null as any,piCreate:null as any,labels:0}));
vi.mock('../config/firebase',()=>({get db(){return h.db!;},FieldValue}));
vi.mock('../config/stripe',()=>({getStripe:()=>({accounts:{retrieve:(...a:any[])=>h.retrieve(...a)},paymentIntents:{create:(...a:any[])=>h.piCreate(...a)}})}));
vi.mock('../config/shipEngine',()=>({getShipEngine:()=>({getPurchaseRates:async()=>purchaseRates(),getPurchaseRatesForShipment:(...a:any[])=>h.get(...a)})}));
vi.mock('../utils/labelFulfillment',async original=>({...await original<any>(),createLabelIdempotent:async()=>{h.labels++;return 'failed';}}));
vi.mock('../lib/analytics',()=>({captureServerEvent:(...a:any[])=>h.analytics(...a)}));
vi.mock('../utils/rateLimit',()=>({checkRateLimit:async()=>{},resolveCallerKey:(r:any)=>({callerKey:r.auth?.uid,isAuthenticated:!!r.auth})}));
import { quoteShippingPurchase } from './payments/shippingPurchase';
import { createTransaction,createStripeCheckout } from './payments/checkout';
import { cancelPendingTransaction } from './payments/disputes';
import { payWithWallet } from './wallet';
import { purchaseAddress,purchaseParcel,purchaseAccount,purchaseRates,personalProfile } from '../utils/testHelpers/shippingPurchaseFixture';
import { invalidateConnectObservation } from '../utils/connectEligibility';
const seller='author_03b3b_seller',buyer='author_03b3b_buyer',articleId='author_03b3b_article',legacyId='author_03b3b_legacy';
const call=(fn:any,data:any,uid=buyer)=>fn.run({auth:{uid,token:{}},data});
const pay=(id:string)=>call(payWithWallet,{transactionId:id});
const read=async(path:string)=>(await h.db!.doc(path).get()).data();
const orders=()=>h.db!.collection('transactions').where('articleId','==',articleId).get();
async function reserved(){const q=await call(quoteShippingPurchase,{articleId,shippingAddress:purchaseAddress});const r=await call(createTransaction,{deliveryType:'shipping',quoteId:q.quoteId,rateId:q.rates[0].rateId,expectedTotal:q.rates[0].totalAmount});return{q,id:r.transactionId as string};}
describe.skipIf(!enabled)('03B3B real wallet admission/commit/receipts',()=>{
  const app=enabled?initializeApp({projectId:'demo-second'},'author_03b3b'):null;
  beforeAll(()=>{if(app)h.db=getFirestore(app);});
  async function clean(){if(!h.db)return;
    for(const uid of[buyer,seller])for(const d of(await h.db.collection(`wallets/${uid}/ledger`).get()).docs)await d.ref.delete();
    for(const c of['transactions','shipping_quotes'])for(const d of(await h.db.collection(c).where('articleId','==',articleId).get()).docs)await d.ref.delete();
    for(const p of[`articles/${articleId}`,`shipping_packages/${articleId}`,`wallets/${buyer}`,`wallets/${seller}`,`transactions/${legacyId}`,`shops/author_03b3b_shop`,...['bank_sale','buyer_sale'].map(id=>`transactions/author_03b3b_${id}`),...[buyer,seller].flatMap(uid=>[`users/${uid}`,`eligibility_profiles/${uid}`])])await h.db.doc(p).delete();
  }
  beforeEach(async()=>{await clean();vi.stubEnv('PAYMENTS_ENABLED','true');vi.stubEnv('SHIPPING_ENABLED','true');h.labels=0;h.retrieve=async()=>purchaseAccount(seller);h.get=async()=>purchaseRates();h.analytics=async()=>{};
    await h.db!.doc(`articles/${articleId}`).set({sellerId:seller,price:50,title:'Manteau',isActive:true,isShipping:true,isSold:false});
    await h.db!.doc(`users/${buyer}`).set({dateOfBirth:'2000-01-01',isActive:true,addresses:[{...purchaseAddress,province:'ON',postalCode:'M5V1A1'}]});
    await h.db!.doc(`users/${seller}`).set({dateOfBirth:'2000-01-01',isActive:true,displayName:'Seller',stripeAccountId:'acct_purchase',stripeChargesEnabled:true,addresses:[{...purchaseAddress,name:'Seller',isDefault:true}]});
    await h.db!.doc(`eligibility_profiles/${seller}`).set(personalProfile(seller));
    await h.db!.doc(`shipping_packages/${articleId}`).set({schemaVersion:1,articleId,ownerId:seller,version:1,source:'seller_declared',measurementVerified:false,parcel:purchaseParcel});
    await h.db!.doc(`wallets/${buyer}`).set({balance:10000,pendingBalance:700,heldBalance:800,status:'active',currency:'cad'});
    await h.db!.doc(`wallets/${seller}`).set({balance:2500,pendingBalance:9000,heldBalance:4500,status:'active',currency:'cad',sellerDebt:0});
    await h.db!.doc(`wallets/${seller}/ledger/old`).set({type:'sale_pending',transactionId:legacyId,amount:9000,createdAt:FieldValue.serverTimestamp(),description:'Exact old data'});
    await h.db!.doc(`transactions/${legacyId}`).set({buyerId:buyer,sellerId:seller,articleId:'author_03b3b_old_article',status:'delivered',shippingAddress:{province:'ON',country:'CA'},stripePaymentIntentId:'pi_legacy',totalAmount:90});
  });
  afterAll(async()=>{await clean();if(app)await deleteApp(app);vi.unstubAllEnvs();});
  async function conserved(id:string){const paths=[`wallets/${buyer}`,`wallets/${seller}`,`wallets/${seller}/ledger/old`,`transactions/${legacyId}`,`articles/${articleId}`,`transactions/${id}`];const before=await Promise.all(paths.map(read));const ledger=await h.db!.collection(`wallets/${buyer}/ledger`).get();
    return async()=>{expect(await Promise.all(paths.map(read))).toEqual(before);expect((await h.db!.collection(`wallets/${buyer}/ledger`).get()).docs.map(d=>d.data())).toEqual(ledger.docs.map(d=>d.data()));expect(h.labels).toBe(0);};}
  it.each(['minor','professional_seller','source_price'])('SDK isolated changed %s after real V4 claim refuses and conserves full native documents',async kind=>{
    const {id}=await reserved();
    if(kind==='minor')await h.db!.doc(`users/${buyer}`).update({dateOfBirth:String(new Date().getUTCFullYear()-16)+'-01-01'});
    if(kind==='professional_seller')await h.db!.doc(`eligibility_profiles/${seller}`).set(personalProfile(seller,'professional'));
    if(kind==='source_price')await h.db!.doc(`articles/${articleId}`).update({price:51});
    const check=await conserved(id);await expect(pay(id)).rejects.toBeDefined();await check();expect((await orders()).size).toBe(1);
  });
  it.each(['partial','unknown_type'])('SDK native %s ledger and PI-independent pending wallet exposure cannot be debited again',async kind=>{
    const {id}=await reserved();await h.db!.doc(`wallets/${buyer}`).update({balance:9000});
    await h.db!.doc(`wallets/${buyer}/ledger/partial`).set({transactionId:id,type:kind==='partial'?'purchase_debit':'manual_adjustment',amount:1000,balanceAfter:9000,createdAt:FieldValue.serverTimestamp()});
    await h.db!.doc(`transactions/${id}`).update({walletAmountUsed:kind==='partial'?1000:0});const check=await conserved(id);
    await expect(pay(id)).rejects.toMatchObject({details:{reason:'wallet_payment_reconciliation_required'}});await check();
  });
  it('SDK real source write while GET suspended is re-read before money; original accepted price unchanged',async()=>{
    const {id}=await reserved();const check=await conserved(id);let reached=false;
    h.get=async()=>{reached=true;await h.db!.doc(`users/${buyer}`).update({dateOfBirth:String(new Date().getUTCFullYear()-16)+'-01-01'});return purchaseRates();};
    await expect(pay(id)).rejects.toMatchObject({code:'permission-denied'});expect(reached).toBe(true);await check();
  });
  it('SDK new bank freeze activation on paid-seller funds is read before new debit',async()=>{
    const {id}=await reserved();const check=await conserved(id);let reached=false;
    h.get=async()=>{reached=true;await h.db!.doc('transactions/author_03b3b_bank_sale').set({sellerId:buyer,status:'completed',disputeFreezeCents:4500});return purchaseRates();};
    await expect(pay(id)).rejects.toMatchObject({details:{reason:'wallet_funds_blocked'}});expect(reached).toBe(true);await check();
  });
  it('SDK positive professional ON buyer: exactly one debit, current receipt after flags OFF/profile missing, full old money preserved',async()=>{
    await h.db!.doc(`eligibility_profiles/${buyer}`).set(personalProfile(buyer,'professional'));const {id}=await reserved();
    const paths=[`wallets/${seller}`,`wallets/${seller}/ledger/old`,`transactions/${legacyId}`],before=await Promise.all(paths.map(read));
    expect(await pay(id)).toMatchObject({success:true,newBalance:3525});
    const ledger=(await h.db!.collection(`wallets/${buyer}/ledger`).where('transactionId','==',id).get());expect(ledger.size).toBe(1);expect(ledger.docs[0].data()).toMatchObject({type:'purchase_debit',amount:6475,balanceAfter:3525});
    expect(await read(`transactions/${id}`)).toMatchObject({status:'paid',walletAmountUsed:6475,labelCreationPending:true});expect(await Promise.all(paths.map(read))).toEqual(before);
    await h.db!.doc(`users/${buyer}`).update({dateOfBirth:null});await h.db!.doc(`eligibility_profiles/${seller}`).delete();vi.stubEnv('PAYMENTS_ENABLED','false');vi.stubEnv('SHIPPING_ENABLED','false');
    const refs=[h.db!.doc(`transactions/${id}`),h.db!.doc(`wallets/${buyer}`),ledger.docs[0].ref];const versions=await Promise.all(refs.map(async ref=>(await ref.get()).updateTime));const labels=h.labels;
    expect(await pay(id)).toMatchObject({replay:true,paymentCommitted:true,currentStatus:'paid',newBalance:3525});
    expect(await Promise.all(refs.map(async ref=>(await ref.get()).updateTime))).toEqual(versions);expect(h.labels).toBe(labels);expect(await Promise.all(paths.map(read))).toEqual(before);
  });
  it('SDK concurrent callers either commit or return stale/receipt; retry returns exact receipt, never two debits',async()=>{
    const {id}=await reserved();const results=await Promise.allSettled([pay(id),pay(id)]);
    expect(results.some(r=>r.status==='fulfilled')).toBe(true);for(const r of results)if(r.status==='rejected')expect(r.reason.code).toBe('aborted');
    expect((await h.db!.collection(`wallets/${buyer}/ledger`).where('transactionId','==',id).get()).size).toBe(1);expect((await read(`wallets/${buyer}`))!.balance).toBe(3525);
    expect(await pay(id)).toMatchObject({replay:true,paymentCommitted:true,newBalance:3525});
  });
  it('SDK post-commit process/analytics failure leaves atomic paid+ledger+sweep flag, read-only retry no second debit',async()=>{
    const {id}=await reserved();h.analytics=async()=>{throw new Error('Interrupted before label');};await expect(pay(id)).rejects.toMatchObject({code:'internal'});
    expect(await read(`transactions/${id}`)).toMatchObject({status:'paid',labelCreationPending:true,walletAmountUsed:6475});expect(h.labels).toBe(0);
    const pending=await h.db!.collection('transactions').where('labelCreationPending','==',true).where('status','==','paid').get();expect(pending.docs.some(d=>d.id===id)).toBe(true);
    expect(await pay(id)).toMatchObject({replay:true,newBalance:3525});expect((await h.db!.collection(`wallets/${buyer}/ledger`).where('transactionId','==',id).get()).size).toBe(1);expect(h.labels).toBe(0);
  });
  it('SDK expired shop benefit: no silent repricing, explicit unengaged cancel then new quote/claim/consent succeeds',async()=>{
    await h.db!.doc('shops/author_03b3b_shop').set({ownerId:seller,status:'approved',tier:'premium',tierPaidUntil:new Date(Date.now()+86400000)});
    const {id,q}=await reserved();expect(q.rates[0].totalAmount).toBe(60.75);
    await h.db!.doc('shops/author_03b3b_shop').update({tierPaidUntil:new Date(Date.now()-1000)});const check=await conserved(id);
    await expect(pay(id)).rejects.toMatchObject({code:'aborted',details:{reason:'wallet_purchase_stale'}});await check();expect((await read(`transactions/${id}`))!.totalAmount).toBe(60.75);
    const cancel=await call(cancelPendingTransaction,{transactionId:id});expect(cancel.success).toBe(true);expect((await read(`wallets/${buyer}`))!.balance).toBe(10000);
    expect((await read(`shipping_quotes/${q.quoteId}`))!.state).toBe('claimed');expect((await read(`transactions/${id}`))!.status).toBe('cancelled');
    const fresh=await reserved();expect(fresh.id).not.toBe(id);expect(fresh.q.rates[0].totalAmount).toBe(64.75);
    expect(await pay(fresh.id)).toMatchObject({newBalance:3525,paymentCommitted:true});expect((await h.db!.collection(`wallets/${buyer}/ledger`).get()).size).toBe(1);
  });
  it('SDK signed account invalidation during GET fences the last debit, preserves native money/order',async()=>{
    const {id}=await reserved();const check=await conserved(id);let reached=false;h.get=async()=>{reached=true;await invalidateConnectObservation(seller,'acct_purchase',{stripeChargesEnabled:false});return purchaseRates();};
    await expect(pay(id)).rejects.toBeDefined();expect(reached).toBe(true);await check();
  });
  it('SDK refundBlocked activated while provider GET waits blocks new consumption, native money preserved',async()=>{
    const {id}=await reserved();const check=await conserved(id);let reached=false;
    h.get=async()=>{reached=true;await h.db!.doc('transactions/author_03b3b_buyer_sale').set({sellerId:buyer,status:'refunded',refundBlocked:true,refund:{state:'reconciliation_required'}});return purchaseRates();};
    await expect(pay(id)).rejects.toMatchObject({details:{reason:'wallet_funds_blocked'}});expect(reached).toBe(true);await check();
  });

  it('SDK real card checkout preparation suspended before PI response prevents independent wallet debit; simulated request completes',async()=>{
    const {id}=await reserved();let enter!:()=>void,release!:(value:any)=>void;const entered=new Promise<void>(resolve=>{enter=resolve;});
    h.piCreate=async()=>{enter();return new Promise(resolve=>{release=resolve;});};
    const card=call(createStripeCheckout,{transactionId:id,walletAmount:0});
    await Promise.race([entered,card.then(()=>{throw new Error('Card never reached IO');})]);
    const prepared=await read(`transactions/${id}`);expect(Object.prototype.hasOwnProperty.call(prepared,'serviceFeePercent')).toBe(true);expect(prepared!.stripePaymentIntentId).toBeUndefined();
    const check=await conserved(id);
    try{await expect(pay(id)).rejects.toMatchObject({details:{reason:'wallet_payment_reconciliation_required'}});await check();}
    finally{release({id:'pi_03b3b_simulated',client_secret:'fake_local_not_returned_by_wallet'});}
    expect(await card).toMatchObject({success:true});expect((await read(`transactions/${id}`))!.stripePaymentIntentId).toBe('pi_03b3b_simulated');
    expect((await read(`wallets/${buyer}`))!.balance).toBe(10000);expect((await h.db!.collection(`wallets/${buyer}/ledger`).get()).size).toBe(0);expect(h.labels).toBe(0);
  });

});
