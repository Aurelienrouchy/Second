import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
import type {MockFirestore} from './testHelpers/firestoreMock';
const h=vi.hoisted(()=>({fs:null as MockFirestore|null,pi:null as any,charge:null as any,user:null as any,
  onRetrieve:null as null|(()=>void),unknown:false,gets:[] as string[],retryAdmission:null as any,
  realRetry:false,refund:null as any}));
vi.mock('../config/firebase',async()=>{const {FieldValue}=await vi.importActual<any>('firebase-admin/firestore');
  const {createFirestoreMock}=await import('./testHelpers/firestoreMock');h.fs=createFirestoreMock({enforceReadBeforeWrite:true});return {
  get db(){return h.fs!.db;},get FieldValue(){return {...h.fs!.FieldValue,vector:FieldValue.vector};},
  auth:{getUser:async(uid:string)=>({uid,...h.user})}};});
vi.mock('../config/stripe',()=>({getStripe:()=>({paymentIntents:{retrieve:async(id:string)=>{
  h.gets.push(id);h.onRetrieve?.();if(h.unknown)throw new Error('unavailable');return h.pi;
}},charges:{retrieve:async(id:string)=>{h.gets.push(id);return h.charge;}},refunds:{retrieve:async(id:string)=>{
  h.gets.push(id);h.onRetrieve?.();return h.refund;
}}})}));
vi.mock('./refund',()=>({retryPurchaseRefundAfterFailure:async(id:string,uid:string,admit:any,expectedId?:string)=>{
  if(h.realRetry){const actual=await vi.importActual<typeof import('./refund')>('./refund');
    return actual.retryPurchaseRefundAfterFailure(id,uid,admit,expectedId);}
  h.retryAdmission=admit;return {status:'pending'};
}}));
vi.mock('firebase-functions/v2/https',async()=>({...await vi.importActual<any>('firebase-functions/v2/https'),onCall:(_:unknown,fn:unknown)=>fn}));
import {recordPaymentCaptureAnomaly,inspectPaymentCaptureAnomalyProof} from './paymentCaptureAnomaly';
import {inspectPaymentCaptureAnomaly,retryPurchaseRefund} from '../callable/payments/disputes';
const fs=h.fs!;
const context={source:'signed_event' as const,eventId:'evt_Original',accountId:null,stripeContext:null};
const auth={uid:'admin',token:{admin:true,auth_time:Math.floor(Date.now()/1000)-60}};
const revision=Timestamp.fromMillis(1700000000000),run=fs.db.runTransaction.bind(fs.db);
function version(s:any):any{if(Array.isArray(s.docs))s.docs.forEach(version);else s.updateTime=revision;return s;}
beforeEach(()=>{
  fs.reset();h.user={disabled:false,customClaims:{admin:true}};h.gets=[];h.unknown=false;h.onRetrieve=null;
  h.realRetry=false;h.refund=null;h.retryAdmission=null;
  vi.spyOn(fs.db,'runTransaction').mockImplementation(async fn=>run(async tx=>{
    const get=tx.get.bind(tx);(tx as any).get=async(ref:any)=>version(await get(ref));return fn(tx);
  }));
  h.pi={id:'pi_Exact',object:'payment_intent',currency:'cad',amount:5000,amount_received:5000,amount_capturable:0,
    confirmation_method:'manual',status:'succeeded',livemode:false,latest_charge:'ch_Exact',
    metadata:{transactionId:'sale',buyerId:'buyer',sellerId:'seller',checkoutIntentId:'checkoutIntent'}};
  h.charge={id:'ch_Exact',object:'charge',currency:'cad',livemode:false,payment_intent:'pi_Exact',status:'succeeded',
    paid:true,captured:true,amount:5000,amount_captured:5000,amount_refunded:0,refunded:false,disputed:false};
  fs.setDoc('users/admin',{isAdmin:true,isActive:true});
  fs.setDoc('transactions/sale',{status:'paid',buyerId:'buyer',sellerId:'seller',deliveryType:'shipping',currency:'CAD',totalAmount:50,
    stripePaymentIntentId:'pi_Exact',stripeChargeId:'ch_Exact',capturedCardCents:5000,paidAt:new Date(1700000000000),
    shippingQuoteId:'quote',shipEngineRateId:'rate'});
  fs.setDoc('stripe_checkout_intents/sale',{schemaVersion:1,protocol:'server_manual_v1',transactionId:'sale',ownerId:'buyer',sellerId:'seller',
    intentId:'checkoutIntent',version:4,state:'succeeded',paymentIntentId:'pi_Exact',totalCents:5000,walletCents:0,cardCents:5000,currency:'CAD',
    quoteId:'quote',rateId:'rate',sourceHash:'a'.repeat(64),sourceRevision:1,createdAt:new Date(1699999998000),authorizedAt:new Date(1699999999000)});
});
afterEach(()=>vi.restoreAllMocks());
const record=()=>recordPaymentCaptureAnomaly(h.pi,'missing_reference',context);
const inspect=(operationId:string)=>(inspectPaymentCaptureAnomaly as any)({auth,data:{operationId,expectedAdminUid:'admin'}});
describe('capture documentary settlement and current admission',()=>{
  it('recognizes an existing exact native commit and writes only the dossier',async()=>{
    const id=await record();fs.writeOps.length=0;const result=await inspect(id);
    expect(result).toMatchObject({status:'resolved',actionRequired:false,resolution:'purchase_payment_committed',paymentCommitted:true,
      paymentPermissionGranted:false,automaticCaptureAllowed:false,automaticRefundAllowed:false,
      currentOrderProof:{transactionId:'sale',currency:'CAD',capturedCardCents:5000,walletCents:0}});
    expect(h.gets).toEqual(['pi_Exact','ch_Exact']);expect(fs.writeOps.every(w=>w.path==='failed_operations/'+id)).toBe(true);
  });
  it('does not select from metadata or ambiguous native PI links',async()=>{
    const id=await record();fs.setDoc('transactions/other',{...fs.getDoc('transactions/sale')});
    expect(await inspect(id)).toMatchObject({status:'pending',reason:'native_order_not_unique',currentOrderProof:null});
  });
  it('keeps unavailable or contradicted provider capture proof open',async()=>{
    const id=await record();h.unknown=true;
    expect(await inspect(id)).toMatchObject({status:'pending',actionRequired:true,providerLookupState:'unavailable'});
    h.unknown=false;h.charge.amount_captured=4999;
    expect(await inspect(id)).toMatchObject({status:'pending',reason:'provider_capture_unqualified'});
  });
  it('keeps a source changed during platform GET open',async()=>{
    const id=await record();h.onRetrieve=()=>fs.setDoc('transactions/sale',{...fs.getDoc('transactions/sale'),status:'shipped'});
    expect(await inspect(id)).toMatchObject({status:'pending',reason:'native_source_changed_during_observation'});
  });
  it('preserves exact resolved duplicate and reopens contradictory evidence or changed native source',async()=>{
    const id=await record();await inspect(id);
    await recordPaymentCaptureAnomaly(h.pi,'missing_reference',{...context,eventId:'evt_Duplicate'});
    expect(fs.getDoc('failed_operations/'+id)).toMatchObject({status:'resolved',actionRequired:false});
    await recordPaymentCaptureAnomaly(h.pi,'late_capture_refund_unqualified',context);
    expect(fs.getDoc('failed_operations/'+id)).toMatchObject({status:'pending',actionRequired:true,resolution:null});
    await inspect(id);
    await recordPaymentCaptureAnomaly({...h.pi,amount_received:4900},'amount_mismatch',context);
    expect(fs.getDoc('failed_operations/'+id)).toMatchObject({status:'pending',actionRequired:true,resolution:null});
    await inspect(id);fs.setDoc('transactions/sale',{...fs.getDoc('transactions/sale'),refundBlocked:true});
    await recordPaymentCaptureAnomaly({...h.pi,amount_received:4900},'amount_mismatch',context);
    expect(fs.getDoc('failed_operations/'+id)).toMatchObject({status:'pending',actionRequired:true,resolution:null});
  });
  it('refuses disabled, revoked, private-inactive admins or wrong expected identity before GET',async()=>{
    const id=await record();for(const user of [{disabled:true},{tokensValidAfterTime:new Date().toISOString()}]){
      h.user=user;await expect(inspect(id)).rejects.toMatchObject({code:'permission-denied'});
    }
    h.user={};for(const privateUser of [{isAdmin:false,isActive:true},{isAdmin:true,isActive:false}]){
      fs.setDoc('users/admin',privateUser);await expect(inspect(id)).rejects.toMatchObject({code:'permission-denied'});
    }
    await expect((inspectPaymentCaptureAnomaly as any)({auth,data:{operationId:id,expectedAdminUid:'other'}})).rejects.toMatchObject({code:'permission-denied'});
    expect(h.gets).toHaveLength(0);
  });
  it('revalidates authority at final commit and passes it to refund retry',async()=>{
    const id=await record();fs.writeOps.length=0;h.onRetrieve=()=>fs.setDoc('users/admin',{isAdmin:false,isActive:true});
    await expect(inspect(id)).rejects.toMatchObject({code:'permission-denied'});expect(fs.writeOps).toHaveLength(0);
    fs.setDoc('users/admin',{isAdmin:true,isActive:true});h.onRetrieve=null;
    await (retryPurchaseRefund as any)({auth,data:{transactionId:'sale',expectedAdminUid:'admin',expectedRefundIntentId:'originalIntent'}});
    fs.setDoc('users/admin',{isAdmin:false,isActive:true});await expect(run(h.retryAdmission)).rejects.toMatchObject({code:'permission-denied'});
  });
  it('rejects a ledger conflict instead of inferring a native debit',async()=>{
    const id=await record();fs.setDoc('wallets/buyer/ledger/unexplained',{transactionId:'sale',type:'purchase_debit',amount:200,
      createdAt:new Date(1700000000000),balanceAfter:100});
    expect(await inspectPaymentCaptureAnomalyProof(id,'internal')).toMatchObject({status:'pending',reason:'wallet_debit_unqualified'});
  });
  it('qualifies the exact native mixed debit without moving it again',async()=>{
    h.pi={...h.pi,amount:4000,amount_received:4000,metadata:{...h.pi.metadata,walletAmountUsed:'1000',paymentType:'wallet_and_card'}};
    h.charge={...h.charge,amount:4000,amount_captured:4000};
    fs.setDoc('transactions/sale',{...fs.getDoc('transactions/sale'),paidVia:'wallet_and_card',walletAmountUsed:1000,capturedCardCents:4000});
    fs.setDoc('stripe_checkout_intents/sale',{...fs.getDoc('stripe_checkout_intents/sale'),walletCents:1000,cardCents:4000,
      walletLedgerId:'originalDebit',walletCommittedAt:new Date(1699999999000)});
    fs.setDoc('wallets/buyer/ledger/originalDebit',{transactionId:'sale',type:'purchase_debit',amount:1000,
      createdAt:new Date(1699999999000),balanceAfter:100,currency:'CAD'});
    const id=await record();fs.writeOps.length=0;
    expect(await inspect(id)).toMatchObject({status:'resolved',paymentCommitted:true,currentOrderProof:{walletCents:1000,capturedCardCents:4000}});
    expect(fs.writeOps.every(w=>w.path==='failed_operations/'+id)).toBe(true);
  });
  it('rejects a replaced refund intention in the real helper before provider IO',async()=>{
    const actual=await vi.importActual<typeof import('./refund')>('./refund');
    fs.setDoc('transactions/sale',{...fs.getDoc('transactions/sale'),refund:{stripeRefundId:'re_Exact',intentId:'otherIntent'}});
    await expect(actual.retryPurchaseRefundAfterFailure('sale','admin',undefined,'originalIntent')).rejects.toMatchObject({code:'aborted'});
    expect(h.gets).toHaveLength(0);expect(fs.writeOps).toHaveLength(0);
  });
  it.each([null,{},'malformed'])('blocks a present private security barrier %j before refund provider IO',async barrier=>{
    h.realRetry=true;fs.setDoc('eligibility_profiles/admin',{accountSecurityBarrier:barrier});
    await expect((retryPurchaseRefund as any)({auth,data:{transactionId:'sale',expectedAdminUid:'admin',
      expectedRefundIntentId:'originalIntent'}})).rejects.toMatchObject({code:'failed-precondition',details:{reason:'account_security_contained'}});
    expect(h.gets).toHaveLength(0);expect(fs.writeOps).toHaveLength(0);
  });
  it('blocks a new real retry attempt when private containment appears during GET with unchanged Auth cutoff',async()=>{
    h.realRetry=true;fs.setDoc('eligibility_profiles/admin',{});
    fs.setDoc('transactions/sale',{...fs.getDoc('transactions/sale'),refund:{stripeRefundId:'re_Exact',intentId:'originalIntent',
      attemptId:'originalAttempt',paymentIntentId:'pi_Exact',currency:'cad',cardAmountCents:5000,state:'failed',previousRefundIds:[]}});
    h.refund={id:'re_Exact',payment_intent:'pi_Exact',currency:'cad',amount:5000,status:'failed'};
    h.onRetrieve=()=>fs.setDoc('eligibility_profiles/admin',{accountSecurityBarrier:{revocationOutcome:'unknown'}});
    await expect((retryPurchaseRefund as any)({auth,data:{transactionId:'sale',expectedAdminUid:'admin',
      expectedRefundIntentId:'originalIntent'}})).rejects.toMatchObject({code:'failed-precondition',details:{reason:'account_security_contained'}});
    expect(h.gets).toEqual(['re_Exact']);
    expect(fs.getDoc('transactions/sale')!.refund).toMatchObject({attemptId:'originalAttempt',stripeRefundId:'re_Exact',previousRefundIds:[]});
    expect(fs.writeOps.some(w=>w.data.refund?.authorizedRetryBy!=null)).toBe(false);
  });
  it('admits an open private profile through the initial and final retry callback',async()=>{
    fs.setDoc('eligibility_profiles/admin',{});
    await expect((retryPurchaseRefund as any)({auth,data:{transactionId:'sale',expectedAdminUid:'admin',
      expectedRefundIntentId:'originalIntent'}})).resolves.toMatchObject({status:'pending'});
    await expect(run(h.retryAdmission)).resolves.toBeUndefined();
  });
});
