import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
const state = vi.hoisted(() => ({records:new Map<string,any>(),files:new Map<string,Buffer>()}));
function reference(path:string):any {return {path,get:async()=>({data:()=>state.records.get(path),exists:state.records.has(path)})};}
const transaction:any = {
  get:async(r:any)=>r.get(),
  create:(r:any,value:any)=>{if(state.records.has(r.path))throw new Error('already exists');state.records.set(r.path,value);},
  set:(r:any,value:any)=>state.records.set(r.path,value),
  update:(r:any,value:any)=>{const next={...state.records.get(r.path)};for(const[k,v]of Object.entries(value)) {
    if(k.includes('.')) {const [a,b]=k.split('.');next[a]={...next[a],[b]:v};}else next[k]=v;
  }state.records.set(r.path,next);},
};
vi.mock('./firebase',()=>({db:{collection:(name:string)=>({doc:(key:string)=>reference(`${name}/${key}`)}),
  runTransaction:async(callback:any)=>callback(transaction)},storage:{bucket:()=>({name:'seconde-dev.firebasestorage.app',file:(path:string)=>({save:async(buffer:Buffer)=>{state.files.set(path,buffer);}})})}}));
vi.mock('../utils/financialRecoveryInterlock',()=>({assertFinancialRecoveryEffect:vi.fn(async()=>{}),preserveFinancialRecoveryEffectResponse:vi.fn(async()=>{}),FinancialRecoveryBlocked:class extends Error {}}));
import {devShippingRequest,advanceDevShipping,devShippingOrder,devShippingPdf,DEV_SHIPPING_PROTOCOL} from './devShippingSimulation';
import {ShipEngineClient,trackingIdentity,trackingProofMatches} from './shipEngine';
import {parsePurchaseRates,hasCurrentRateQualification} from '../utils/shippingPurchaseRate';
const env={GCLOUD_PROJECT:'seconde-dev',SECONDE_ENV:'development',SECONDE_COMMERCE_TEST_MODE:'true',FINANCIAL_RECOVERY_ENVIRONMENT:'test',
  STRIPE_SECRET_KEY:'sk_test_fixture',SHIPENGINE_API_KEY:'TEST_fixture',SHIPENGINE_SANDBOX_ENABLED:'true',SHIPENGINE_ACCOUNT_ENVIRONMENT:'sandbox'};
const address={name:'Test',address_line1:'123 Exemple',city_locality:'Montréal',state_province:'QC',postal_code:'H2X1A1',country_code:'CA'};
const parcel={weight:{value:1,unit:'kilogram'},dimensions:{length:30,width:20,height:10,unit:'centimeter'}};
const shipment={ship_from:address,ship_to:{...address,address_line1:'456 Exemple'},packages:[parcel]};
const context={shipFrom:{name:'Test',addressLine1:'123 Exemple',cityLocality:'Montréal',stateProvince:'QC',postalCode:'H2X1A1',countryCode:'CA'},
  shipTo:{name:'Test',addressLine1:'456 Exemple',cityLocality:'Montréal',stateProvince:'QC',postalCode:'H2X1A1',countryCode:'CA'},parcel:parcel as any};
beforeEach(()=>{state.records.clear();state.files.clear();for(const[key,value]of Object.entries(env))vi.stubEnv(key,value);
  for(const key of ['GCP_PROJECT','GOOGLE_CLOUD_PROJECT','SECONDE_PROJECT_ID','FIREBASE_CONFIG','FUNCTIONS_EMULATOR','SHIPENGINE_BASE_URL'])vi.stubEnv(key,undefined);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('cannot enter the shipping simulator on production, with live keys, or without its explicit isolated switch',async()=>{
  for(const change of [{GCLOUD_PROJECT:'seconde-b47a6',SECONDE_ENV:'production'},{SHIPENGINE_API_KEY:'live_fixture'},
    {SECONDE_COMMERCE_TEST_MODE:'false'},{FINANCIAL_RECOVERY_ENVIRONMENT:'live'}]) {
    for(const[key,value]of Object.entries({...env,...change}))vi.stubEnv(key,value);
    await expect(devShippingRequest('POST','/v1/rates',{shipment})).rejects.toThrow();
    expect(state.records.size).toBe(0);
  }
});
it('creates a full CAD Quebec quote and recovers the same private quote without a provider request',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const client=new ShipEngineClient({apiKey:'TEST_fixture',baseUrl:'https://api.shipengine.com'});
  const quoted=await client.getPurchaseRates(context.shipFrom,context.shipTo,context.parcel);
  expect(quoted.rates[0]).toMatchObject({carrierCode:'seconde_dev',shippingCents:850,carrierFriendlyName:'Livraison de test — Seconde Dev'});
  expect(hasCurrentRateQualification(quoted,context)).toBe(true);
  expect(await client.getPurchaseRatesForShipment(quoted.shipmentId,context)).toEqual({...quoted,qualification:{...quoted.qualification,contexts:[quoted.qualification.contexts[1]]}});
  expect(fetch).not.toHaveBeenCalled();
});
it('does not admit Canadian destinations outside Quebec into the simulation',async()=>{
  await expect(devShippingRequest('POST','/v1/rates',{shipment:{...shipment,ship_to:{...address,state_province:'ON',postal_code:'M5V1A1'}}})).rejects.toThrow();
  expect(state.records.size).toBe(0);
});
it('keeps one non-dispatchable label per quote, allows void before dispatch and never after a scan',async()=>{
  const rates=parsePurchaseRates(await devShippingRequest('POST','/v1/rates',{shipment}),undefined,context);
  const label:any=await devShippingRequest('POST',`/v1/labels/rates/${rates.rates[0].rateId}`,{});
  expect(await devShippingRequest('POST',`/v1/labels/rates/${rates.rates[0].rateId}`,{})).toEqual(label);
  expect(label.simulation).toMatchObject({protocol:DEV_SHIPPING_PROTOCOL,realShipment:false,provider:'seconde_dev_simulation'});
  expect(state.files.size).toBe(1);const pdf=[...state.files.values()][0].toString();
  expect(pdf).toContain('NON EXPEDIABLE');expect(pdf).not.toContain('123 Exemple');expect(pdf).toMatch(/^%PDF-1.4/);
  await expect(advanceDevShipping(transaction,label.label_id,'delivered','buyer')).rejects.toThrow('Simulez d’abord');
  expect(await advanceDevShipping(transaction,label.label_id,'in_transit','seller')).toBe(true);
  expect(await advanceDevShipping(transaction,label.label_id,'in_transit','seller')).toBe(false);
  expect(await devShippingRequest('PUT',`/v1/labels/${label.label_id}/void`)).toMatchObject({approved:false});
  expect(await advanceDevShipping(transaction,label.label_id,'delivered','buyer')).toBe(true);
  expect(await advanceDevShipping(transaction,label.label_id,'delivered','buyer')).toBe(false);
  expect(await advanceDevShipping(transaction,label.label_id,'in_transit','buyer')).toBe(false);
});
it('tracking explicitly identifies member simulation and loses qualification outside the isolated Dev runtime',async()=>{
  const rates=parsePurchaseRates(await devShippingRequest('POST','/v1/rates',{shipment}),undefined,context);
  const label:any=await devShippingRequest('POST',`/v1/labels/rates/${rates.rates[0].rateId}`,{});
  await advanceDevShipping(transaction,label.label_id,'in_transit','seller');
  const order:any={buyerId:'buyer',sellerId:'seller',shipEngineLabelId:label.label_id,trackingNumber:label.tracking_number,carrierCode:'seconde_dev',
    labelCreatedAt:Timestamp.fromMillis(Date.parse(label.created_at)),shippingSnapshot:{schemaVersion:1,shipmentId:label.shipment_id,rate:rates.rates[0]},
    devShippingSimulation:{protocol:DEV_SHIPPING_PROTOCOL,realShipment:false,trackingSource:'member_test_action'}};
  const identity=trackingIdentity('order',order,'forward')!;
  order.trackingRead={schemaVersion:1,readId:'read',version:1,sourceHash:identity.sourceHash,labelId:label.label_id,leg:'forward',authorizedAt:Timestamp.now()};
  const client=new ShipEngineClient({apiKey:'TEST_fixture',baseUrl:'https://api.shipengine.com'});
  const tracking=await client.getQualifiedTracking('order',order,'forward',{readId:'read',version:1});
  expect(tracking.proof).toMatchObject({provider:'seconde_dev_simulation',identitySource:'member_test_action',statusCode:'IT'});
  expect(devShippingOrder(order)).toBe(true);expect(trackingProofMatches('order',order,tracking.proof,'forward')).toBe(true);
  expect(trackingProofMatches('order',order,{...tracking.proof,provider:'shipengine',identitySource:'saved_label_get_and_label_track'},'forward')).toBe(false);
  vi.stubEnv('GCLOUD_PROJECT','seconde-b47a6');vi.stubEnv('SECONDE_ENV','production');
  expect(devShippingOrder(order)).toBe(false);expect(trackingProofMatches('order',order,tracking.proof,'forward')).toBe(false);
});
it('rejects an arbitrary label identifier before generating a PDF',()=>{expect(()=>devShippingPdf('se-live-label')).toThrow();});

it('quotes and recovers a simulated return label through the same saved outbound service, without buying a real label',async()=>{
  const client=new ShipEngineClient({apiKey:'TEST_fixture',baseUrl:'https://api.shipengine.com'});
  const forward=parsePurchaseRates(await devShippingRequest('POST','/v1/rates',{shipment}),undefined,context);
  const outbound:any=await devShippingRequest('POST',`/v1/labels/rates/${forward.rates[0].rateId}`,{});
  const returning={...context,shipFrom:context.shipTo,shipTo:context.shipFrom,isReturn:true as const,externalShipmentId:'sr_'+ 'a'.repeat(40),
    carrierId:'se-dev-simulation',carrierCode:'seconde_dev',serviceCode:'seconde_dev_standard',outboundLabelId:outbound.label_id};
  const quote=await client.getReturnPurchaseRates(returning);
  expect(quote.rates[0].shippingCents).toBe(850);
  const external='sr_'+'b'.repeat(40);
  const label=await client.createReturnLabel(returning,quote.rates[0].rateId,external);
  expect(label.qualification).toMatchObject({totalCents:850,rateIdentitySource:'return_shipment',simulation:{protocol:DEV_SHIPPING_PROTOCOL,realShipment:false}});
  expect(await client.readReturnPurchasedLabel(returning,quote.rates[0].rateId,external,label.labelId)).toEqual(label);
  expect(await client.createReturnLabel(returning,quote.rates[0].rateId,external)).toEqual(label);
  expect(state.files.size).toBe(2);
  expect(await client.readCurrentLabelDocument({labelId:label.labelId,direction:'return',trackingNumber:label.trackingNumber,carrierCode:'seconde_dev',
    shipmentId:label.shipmentId!,carrierId:'se-dev-simulation',serviceCode:'seconde_dev_standard',outboundLabelId:outbound.label_id,
    rateId:null,providerCreatedAtMs:null})).toMatchObject({observation:'document_available'});
});
