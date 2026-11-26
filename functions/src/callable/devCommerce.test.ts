/** Endpoint security: no member command can borrow another order, a native
 * carrier label, production keys, or use a return scan to release sale funds. */
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({records:new Map<string,any>(),advances:vi.fn(),release:vi.fn(),apply:vi.fn()}));
function ref(path:string):any{return {path,get:async()=>({data:()=>state.records.get(path)})};}
const tx:any={get:async(r:any)=>r.get(),update:vi.fn()};
vi.mock('../config/firebase',()=>({db:{collection:(collection:string)=>({doc:(id:string)=>ref(`${collection}/${id}`)}),runTransaction:async(cb:any)=>cb(tx)},FieldValue:{serverTimestamp:()=>({test:true})}}));
vi.mock('../utils/privateAccountSession',()=>({assertPrivateAccountSession:vi.fn(async()=>{}),withPrivateAccountSession:async(_r:any,cb:any)=>cb()}));
vi.mock('../utils/financialRecoveryInterlock',()=>({withFinancialRecoveryScope:async(_scope:any,cb:any)=>cb()}));
vi.mock('../utils/financialRecoverySources',()=>({financialRecoveryCommitCheckpoint:()=>async()=>{},financialRecoverySourceFields:async(_d:any,_r:any,_s:any,fields:any)=>fields}));
vi.mock('../utils/rateLimit',()=>({checkRateLimit:vi.fn(async()=>{})}));
vi.mock('../utils/refundState',()=>({hasUnsettledRefund:(o:any)=>o.refundInProgress===true}));
vi.mock('../utils/bankDispute',()=>({hasActiveBankDispute:(o:any)=>o.bankDisputeActive===true}));
vi.mock('../utils/returnRequest',()=>({hasUnsettledReturnRequest:(o:any)=>o.returnRequest?.state==='committed',committedReturnReceipt:(_id:any,o:any)=>o.returnRequest?.state==='committed'}));
vi.mock('../config/shippingTransportPolicy',()=>({qualifiedOrderTransportQuote:(_o:any,q:any)=>q?.testMode?{testMode:q.testMode}:null}));
vi.mock('../config/devShippingSimulation',()=>({devShippingId:(id:any)=>/^se-devsim-[a-f0-9]{32}$/.test(id),
  devShippingOrder:(order:any)=>order.carrierCode==='seconde_dev'&&order.devShippingSimulation?.realShipment===false,
  advanceDevShipping:(...args:any[])=>state.advances(...args)}));
vi.mock('../config/shipEngine',()=>({ShipEngineClient:{mapStatus:(s:string)=>s==='DE'?'DELIVERED':'IN_TRANSIT'}}));
vi.mock('../utils/trackingTransition',()=>({readQualifiedTracking:vi.fn(async()=>({statusCode:'IT',proof:{provider:'seconde_dev_simulation'}})),
  applyTrackingOutcome:(...args:any[])=>state.apply(...args),trackingOutcomeMatches:vi.fn(async()=>true)}));
vi.mock('../utils/returnRefund',()=>({processReturnDelivered:vi.fn(async()=>({refunded:false}))}));
vi.mock('../scheduled/releaseHeldFunds',()=>({releasePurchaseHeldFunds:(...args:any[])=>state.release(...args)}));
import {devAdvanceShipping} from './devCommerce';
const env={GCLOUD_PROJECT:'seconde-dev',SECONDE_ENV:'development',SECONDE_COMMERCE_TEST_MODE:'true',FINANCIAL_RECOVERY_ENVIRONMENT:'test',
  STRIPE_SECRET_KEY:'sk_test_fixture',SHIPENGINE_API_KEY:'TEST_fixture',SHIPENGINE_SANDBOX_ENABLED:'true',SHIPENGINE_ACCOUNT_ENVIRONMENT:'sandbox'};
const call=(data:any,uid='buyer')=>devAdvanceShipping.run({auth:{uid,token:{auth_time:Math.floor(Date.now()/1000)}},data:{transactionId:'purchase',expectedUid:uid,...data}} as any);
beforeEach(()=>{vi.clearAllMocks();state.records.clear();for(const[k,v]of Object.entries(env))vi.stubEnv(k,v);
  for(const k of ['GCP_PROJECT','GOOGLE_CLOUD_PROJECT','SECONDE_PROJECT_ID','FIREBASE_CONFIG','FUNCTIONS_EMULATOR','SHIPENGINE_BASE_URL'])vi.stubEnv(k,undefined);
  state.records.set('transactions/purchase',{buyerId:'buyer',sellerId:'seller',deliveryType:'shipping',carrierCode:'seconde_dev',shipEngineLabelId:'se-devsim-'+'a'.repeat(32),
    shippingQuoteId:'quote',status:'label_created',devShippingSimulation:{realShipment:false}});
  state.records.set('shipping_quotes/quote',{testMode:'seconde_dev_commerce_v1'});
  state.apply.mockImplementation(async(_id:any,_status:any,_source:any,_proof:any,guard:any)=>{await guard(tx);return {kind:'shipped',changed:true};});
  state.release.mockImplementation(async(_id:any,_seller:any,guard:any)=>{await guard(tx);return true;});
});
afterEach(()=>vi.unstubAllEnvs());
it('refuses production even when the sandbox flags were accidentally copied',async()=>{
  vi.stubEnv('GCLOUD_PROJECT','seconde-b47a6');vi.stubEnv('SECONDE_ENV','production');
  await expect(call({action:'in_transit'})).rejects.toThrow('uniquement');expect(state.advances).not.toHaveBeenCalled();
});
it('rejects an outsider and a mismatched UID before any scan or money operation',async()=>{
  await expect(call({action:'in_transit'},'outsider')).rejects.toThrow('appartient');
  await expect(call({action:'in_transit',expectedUid:'seller'})).rejects.toThrow('exacts');
  expect(state.advances).not.toHaveBeenCalled();expect(state.release).not.toHaveBeenCalled();
});
it('requires both the simulated order and the saved accepted Dev quote',async()=>{
  state.records.set('shipping_quotes/quote',{testMode:null});await expect(call({action:'in_transit'})).rejects.toThrow('devis');
  state.records.get('transactions/purchase').carrierCode='canada_post';await expect(call({action:'in_transit'})).rejects.toThrow('simulée');
  expect(state.advances).not.toHaveBeenCalled();
});
it('cannot release before delivery or use a return action to release sale funds',async()=>{
  await expect(call({action:'release_funds'})).rejects.toThrow('livraison');
  await expect(call({action:'release_funds',leg:'return'})).rejects.toThrow('exacts');expect(state.release).not.toHaveBeenCalled();
});
it('blocks forward simulation when a refund or dispute is engaged',async()=>{
  state.records.get('transactions/purchase').refundInProgress=true;
  await expect(call({action:'in_transit'})).rejects.toThrow('réclamation');expect(state.advances).not.toHaveBeenCalled();
});
it('uses the guarded shared release routine and never receives a user-provided virtual timestamp',async()=>{
  state.records.get('transactions/purchase').status='delivered';
  expect(await call({action:'release_funds'})).toMatchObject({success:true,simulated:true,realShipment:false});
  expect(state.release).toHaveBeenCalledWith('purchase','seller',expect.any(Function),{actorId:'buyer'});
  await expect(call({action:'release_funds',now:999999999999999})).rejects.toThrow('exacts');
});
it('return progression requires its committed simulated return label instead of borrowing the outbound label',async()=>{
  const order=state.records.get('transactions/purchase');order.returnRequest={state:'committed'};order.status='return_requested';order.disputed=true;
  await expect(call({action:'in_transit',leg:'return'})).rejects.toThrow('retour');
  order.returnLabelId='se-devsim-'+'b'.repeat(32);order.returnCarrierCode='seconde_dev';
  expect(await call({action:'in_transit',leg:'return'})).toMatchObject({success:true,simulated:true});
  expect(state.advances).toHaveBeenCalledWith(tx,order.returnLabelId,'in_transit','buyer');expect(state.apply).not.toHaveBeenCalled();
});
