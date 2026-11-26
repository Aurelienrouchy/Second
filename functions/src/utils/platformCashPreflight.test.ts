import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
vi.mock('../config/stripe',()=>({getStripe:()=>null}));
import {observePlatformCash,platformCashObservationHash} from './platformCashPreflight';

const platformId='acct_platform_test',destination='acct_seller_test';
const env={GCLOUD_PROJECT:'seconde-dev',SECONDE_ENV:'development',SECONDE_COMMERCE_TEST_MODE:'true',
  FINANCIAL_RECOVERY_ENVIRONMENT:'test',FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID:platformId,STRIPE_SECRET_KEY:'sk_test_fixture_only'};
beforeEach(()=>{
  for(const [name,value]of Object.entries(env))vi.stubEnv(name,value);
  for(const name of ['GCP_PROJECT','GOOGLE_CLOUD_PROJECT','SECONDE_PROJECT_ID','FIREBASE_CONFIG','FUNCTIONS_EMULATOR'])vi.stubEnv(name,undefined);
});
afterEach(()=>vi.unstubAllEnvs());
const nativeAccount=(extra:Record<string,unknown>={})=>({id:platformId,object:'account',charges_enabled:false,payouts_enabled:false,
  lastResponse:{requestId:'req_native_account'},...extra});
const nativeBalance=(amount=2852)=>({object:'balance',livemode:false,available:[{currency:'cad',amount}],lastResponse:{requestId:'req_native_balance'}});
const read=(account:any=nativeAccount(),balance:any=nativeBalance())=>observePlatformCash({accounts:{retrieveCurrent:async()=>account},
  balance:{retrieve:async()=>balance}} as any,1000,destination);

it('qualifies the actual sandbox CAD balance while recording unexposed platform restrictions truthfully',async()=>{
  const observation=await read();
  expect(observation).toMatchObject({qualification:'available',availableCents:2852,livemode:false,platformAccountId:platformId,
    testMode:'seconde_dev_commerce_v1',accountRestrictionsQualification:'not_exposed_in_stripe_test_mode',cashReserved:false,concurrentCapacityGuaranteed:false});
  const {testMode,accountRestrictionsQualification,...legacy}=observation;
  expect(testMode).toBeDefined();expect(accountRestrictionsQualification).toBeDefined();
  expect(platformCashObservationHash(observation)).not.toBe(platformCashObservationHash(legacy));
});
it.each([
  ['SECONDE_COMMERCE_TEST_MODE','false'],['SECONDE_ENV','production'],['GCLOUD_PROJECT','another-project'],
  ['FINANCIAL_RECOVERY_ENVIRONMENT','live'],['FINANCIAL_RECOVERY_STRIPE_ACCOUNT_ID','acct_other_platform'],
  ['FUNCTIONS_EMULATOR','true'],['STRIPE_SECRET_KEY','sk_live_fixture_only'],
])('does not adopt omitted requirements after %s changes',async(name,value)=>{
  vi.stubEnv(name,value);expect(await read()).toMatchObject({qualification:'unknown',availableCents:null});
});
it('production keeps omitted platform requirements unknown even with a test key and accidentally enabled switch',async()=>{
  vi.stubEnv('GCLOUD_PROJECT','seconde-b47a6');vi.stubEnv('SECONDE_ENV','production');
  expect(await read()).toMatchObject({qualification:'unknown',availableCents:null});
});
it.each([null,{},[],{disabled_reason:undefined},{disabled_reason:''}])('never treats exposed malformed requirements %j as the omission case',async requirements=>{
  expect(await read(nativeAccount({requirements}))).toMatchObject({qualification:'unknown',availableCents:null});
});
it('preserves explicit native restrictions in Dev',async()=>{
  expect(await read(nativeAccount({requirements:{disabled_reason:'requirements.past_due'}})))
    .toMatchObject({qualification:'unavailable',reason:'platform_cash_unavailable',availableCents:null});
});
it('does not inflate insufficient actual sandbox funds',async()=>{
  expect(await read(nativeAccount(),nativeBalance(999)))
    .toMatchObject({qualification:'insufficient',reason:'platform_cash_insufficient',availableCents:999,requestedCents:1000});
});
it('still requires matching native mode, both request IDs, a CAD row and separate platform/destination accounts',async()=>{
  expect((await read(nativeAccount(),{...nativeBalance(),livemode:true})).qualification).toBe('unknown');
  expect((await read(nativeAccount({lastResponse:{}}))).qualification).toBe('unknown');
  expect((await read(nativeAccount(),{...nativeBalance(),lastResponse:{}})).qualification).toBe('unknown');
  expect((await read(nativeAccount(),{...nativeBalance(),available:[{currency:'usd',amount:9000}]})).qualification).toBe('unknown');
  expect((await read(nativeAccount({id:destination}))).qualification).toBe('unknown');
});
it('keeps historical observation hashes byte-for-byte unchanged when no new marker is present',async()=>{
  const p=await read(nativeAccount({requirements:{disabled_reason:null}}));
  expect(p.qualification).toBe('available');expect(p).not.toHaveProperty('testMode');
  const historical=createHash('sha256').update(JSON.stringify([p.protocol,p.qualification,p.reason,p.requestedCents,p.currency,p.platformAccountId,p.livemode,
    p.availableCents,p.accountRequestId,p.balanceRequestId,p.observedAt.seconds,p.observedAt.nanoseconds,p.cashReserved,p.concurrentCapacityGuaranteed])).digest('hex');
  expect(platformCashObservationHash(p)).toBe(historical);
});
