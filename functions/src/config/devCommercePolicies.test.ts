import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {isDevCommerceTestRuntime,isDevCommerceStripeTestRuntime,isDevCommerceShippingTestRuntime} from './runtimeEnvironment';
import {qualifyNewServiceFeeTax,qualifiedOperatorTaxDecision} from './operatorServiceTax';
import {captureShippingTransport,qualifiedShippingTransportAdmission,shippingTransportSummary,shippingTransportNativeContext,
  shippingTransportLeg,assertTransportCurrentForNewPost,shippingTransportHash} from './shippingTransportPolicy';
import {evaluateCurrentSellerEligibility,evaluatePublicationEligibility} from '../shared/eligibility';
import {getCheckoutReturnUrl} from '../shared/checkoutRedirect';
import {deriveStripeAccountState,hasUnrestrictedStripeChargeCapability} from '../utils/stripeAccount';
import {shippingTaxSourceHash,qualifiedShippingTaxSource,SHIPPING_PURCHASE_PRICING_VERSION} from '../utils/shippingSourceIdentity';

const env={GCLOUD_PROJECT:'seconde-dev',SECONDE_ENV:'development',SECONDE_COMMERCE_TEST_MODE:'true',FINANCIAL_RECOVERY_ENVIRONMENT:'test',
  STRIPE_SECRET_KEY:'sk_test_not_a_credential',SHIPENGINE_API_KEY:'TEST_not_a_credential',SHIPENGINE_SANDBOX_ENABLED:'true',SHIPENGINE_ACCOUNT_ENVIRONMENT:'sandbox'};
const address={name:'Membre test',street:'123 Exemple',city:'Montréal',province:'QC',postalCode:'H2X1A1',country:'CA'};
const parcel={weight:{value:1,unit:'kilogram'},dimensions:{length:30,width:20,height:10,unit:'centimeter'}};
const taxContext={recipientUid:'buyer',source:'shipping_destination' as const,address,nativeSourceReference:'native-test-destination',transport:'native_carrier_total' as const};
beforeEach(()=>{
  for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
  for(const key of ['GCP_PROJECT','GOOGLE_CLOUD_PROJECT','SECONDE_PROJECT_ID','FIREBASE_CONFIG','FUNCTIONS_EMULATOR',
    'OPERATOR_SERVICE_TAX_POLICY_JSON','SHIPENGINE_TRANSPORT_POLICY_JSON','SHIPENGINE_BASE_URL'])vi.stubEnv(key,undefined);
});
afterEach(()=>vi.unstubAllEnvs());
const transport=()=>captureShippingTransport({origin:address,destination:{...address,street:'456 Exemple'},parcel,
  item:{categoryIds:['women','women_clothing'],condition:'good'},amount:50,
  addressAdmission:{protocol:'ordinary_shipping_address_admission_v1',origin:{kind:'ordinary_residential'},destination:{kind:'ordinary_residential'}}});

it('admits only the explicitly isolated commerce test installation with provider test keys',()=>{
  expect(isDevCommerceTestRuntime()).toBe(true);expect(isDevCommerceStripeTestRuntime()).toBe(true);expect(isDevCommerceShippingTestRuntime()).toBe(true);
  for(const changed of [{SECONDE_COMMERCE_TEST_MODE:'false'},{SECONDE_ENV:'production'},{GCLOUD_PROJECT:'other-project'},
    {FUNCTIONS_EMULATOR:'true'},{FINANCIAL_RECOVERY_ENVIRONMENT:'live'}])expect(isDevCommerceTestRuntime({...env,...changed})).toBe(false);
  expect(isDevCommerceStripeTestRuntime({...env,STRIPE_SECRET_KEY:'sk_live_refused'})).toBe(false);
  expect(isDevCommerceShippingTestRuntime({...env,SHIPENGINE_API_KEY:'live_refused'})).toBe(false);
});
it('captures zero test tax without inventing a registration or legal exemption',()=>{
  const decision=qualifyNewServiceFeeTax(0.05,0.09975,taxContext,false);
  expect(decision).toMatchObject({testMode:'seconde_dev_commerce_v1',gstTreatment:'not_collecting',gstNonCollectionReason:'sandbox_test_only',
    qstNonCollectionReason:'sandbox_test_only',gstRate:0,qstRate:0,transportTreatment:'sandbox_test_only',registrationAuthorityVerified:false});
  expect(qualifiedOperatorTaxDecision(decision)).toEqual(decision);
  expect(()=>qualifyNewServiceFeeTax(0.05,0.09975,taxContext,true)).toThrow();
  expect(()=>qualifyNewServiceFeeTax(0.05,0.09975,{...taxContext,address:{...address,province:'ON',postalCode:'M5V1A1'}},false)).toThrow();
});
it('keeps the original Dev tax source hash valid after Firestore reorders all map keys',()=>{
  const taxAdmission=qualifyNewServiceFeeTax(0.05,0.09975,taxContext,false);
  const taxSnapshot={schemaVersion:1 as const,protocol:'service_fee_tax_v1' as const,currency:'CAD' as const,taxableServiceFee:4,
    gst:0,qst:0,taxTotal:0,technicalConfiguration:{enabled:false,gstRate:0.05,qstRate:0.09975},registrationStatusVerified:false as const};
  const base='a'.repeat(64),source={fee:4,tax:0,pricingVersion:SHIPPING_PURCHASE_PRICING_VERSION,pricingBaseHash:base,taxSnapshot,taxAdmission,
    hash:shippingTaxSourceHash(base,taxSnapshot,taxAdmission)};
  const reorder=(value:any):any=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,reorder(value[key])])):value;
  expect(qualifiedShippingTaxSource(source)).toEqual(taxSnapshot);
  expect(qualifiedShippingTaxSource(reorder(source))).toEqual(taxSnapshot);
});
it('compares a provider rate to Firestore-sorted maps without accepting a changed cent',()=>{
  const apiRate={rateId:'se-rate',shipmentId:'se-shipment',carrierId:'se-carrier',carrierCode:'seconde_dev',
    carrierFriendlyName:'Livraison de test',serviceCode:'seconde_dev_standard',serviceType:'Test',
    componentsCents:{shipping:850,insurance:0,confirmation:0,other:0},shippingCents:850,estimatedDeliveryDays:3};
  const storedRate=Object.fromEntries(Object.keys(apiRate).sort().map(key=>[key,key==='componentsCents'
    ?Object.fromEntries(Object.entries(apiRate.componentsCents).sort(([a],[b])=>a.localeCompare(b))):apiRate[key as keyof typeof apiRate]]));
  expect(JSON.stringify(storedRate)).not.toBe(JSON.stringify(apiRate));
  expect(shippingTransportHash(storedRate)).toBe(shippingTransportHash(apiRate));
  expect(shippingTransportHash({...storedRate,shippingCents:851})).not.toBe(shippingTransportHash(apiRate));
});
it('cannot create or adopt Dev tax decisions in production or after the test switch is withdrawn',()=>{
  const decision=qualifyNewServiceFeeTax(0.05,0.09975,taxContext,false);
  vi.stubEnv('GCLOUD_PROJECT','seconde-b47a6');vi.stubEnv('SECONDE_ENV','production');
  expect(()=>qualifyNewServiceFeeTax(0.05,0.09975,taxContext,false)).toThrow();expect(qualifiedOperatorTaxDecision(decision)).toBeNull();
  vi.stubEnv('GCLOUD_PROJECT','seconde-dev');vi.stubEnv('SECONDE_ENV','development');vi.stubEnv('SECONDE_COMMERCE_TEST_MODE','false');
  expect(qualifiedOperatorTaxDecision(decision)).toBeNull();
});
it('freezes truthful Dev transport terms and round-trips their hashes without insurance claims',()=>{
  const {admission,policy}=transport();
  expect(policy.testMode).toBe('seconde_dev_commerce_v1');
  expect(admission.coverage).toMatchObject({declaredValueCents:5000,coveredValueCents:0,insuranceProvider:'none',effectiveCoverageBasis:'sandbox_simulation'});
  expect(qualifiedShippingTransportAdmission(admission)).toEqual(admission);
  expect(shippingTransportSummary(admission)).toMatchObject({testMode:'seconde_dev_commerce_v1'});
  const context=shippingTransportNativeContext(address,{...address,street:'456 Exemple'},parcel);
  expect(()=>assertTransportCurrentForNewPost(shippingTransportLeg(admission,context,'forward'))).not.toThrow();
  expect(()=>qualifiedShippingTransportAdmission({...admission,coverage:{...admission.coverage,coveredValueCents:5000}})).toThrow();
  vi.stubEnv('SHIPENGINE_API_KEY','TEST_rotated');
  expect(()=>assertTransportCurrentForNewPost(shippingTransportLeg(admission,context,'forward'))).toThrow();
});
it('production cannot create or adopt a sandbox transport admission even when its switch is accidentally true',()=>{
  const {admission}=transport();vi.stubEnv('GCLOUD_PROJECT','seconde-b47a6');vi.stubEnv('SECONDE_ENV','production');
  expect(()=>transport()).toThrow();expect(()=>qualifiedShippingTransportAdmission(admission)).toThrow();
});
it('new seller accounts need no historical activity questionnaire while age and professional restrictions remain enforced',()=>{
  const evidence={ownerId:'seller',user:{dateOfBirth:'2000-01-01',isActive:true},profile:null};
  expect(evaluateCurrentSellerEligibility(evidence,'sell').allowed).toBe(true);
  expect(evaluatePublicationEligibility(evidence).allowed).toBe(true);
  expect(evaluateCurrentSellerEligibility(evidence,'new_paid_shipping')).toMatchObject({allowed:false,reasons:['seller_qc_missing']});
  expect(evaluateCurrentSellerEligibility({...evidence,user:{dateOfBirth:'2015-01-01'}},'sell').reasons).toContain('underage');
  expect(evaluateCurrentSellerEligibility({...evidence,profile:{activityDeclaration:{kind:'professional'}}},'sell').reasons).toContain('professional_declared');
});
it('3DS return schemes keep installed Dev and production applications separate',()=>{
  expect(getCheckoutReturnUrl('development')).toBe('seconde-dev://checkout/success');
  expect(getCheckoutReturnUrl('production')).toBe('seconde://checkout/success');
});
it('native charge permission can coexist with pending KYC while payout permission remains false',()=>{
  const native={charges_enabled:true,payouts_enabled:false,details_submitted:true,
    requirements:{currently_due:[],past_due:[],pending_verification:['individual.verification.document'],disabled_reason:'requirements.pending_verification'}};
  const state=deriveStripeAccountState(native);
  expect(state.status).toBe('pending_verification');expect(state.payoutsEnabled).toBe(false);
  expect(hasUnrestrictedStripeChargeCapability(state)).toBe(true);
  expect(hasUnrestrictedStripeChargeCapability({...state,chargesEnabled:false})).toBe(false);
  expect(hasUnrestrictedStripeChargeCapability({...state,requirementsPastDue:['individual.email']})).toBe(false);
  expect(hasUnrestrictedStripeChargeCapability({...state,disabledReason:'rejected.fraud'})).toBe(false);
});
