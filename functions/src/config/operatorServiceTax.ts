/** Deployment-controlled documentary policy for NEW Seconde service charges.
 * No official registration or tax treatment has been supplied for launch.
 * This is not the Part XX seller-reporting assessment, nor legal certification.
 * Never populate this value from a callable, shop or article/category field. */
import {createHash} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {normalizeCanadianAddress} from '../shared/canadianAddress';
import {isDevCommerceTestRuntime,isDevCommerceStripeTestRuntime} from './runtimeEnvironment';

const RAW_POLICY=process.env.OPERATOR_SERVICE_TAX_POLICY_JSON;
type Treatment='taxable'|'zero_rated'|'exempt';
type DecisionTreatment=Treatment|'not_collecting';
type NonCollectionReason='documented_non_registration'|'documented_other_legal_basis'|'sandbox_test_only';
export interface ServiceFeeTaxContext {
  recipientUid:string;
  source:'shipping_destination'|'payer_declared_primary_address';
  /** Server-read/accepted source, never a separate client tax address. */
  address:unknown;
  nativeSourceReference:string;
  transport:'native_carrier_total'|'none';
}
export interface LegacyServiceFeeTaxAdmission {
  protocol:'service_fee_tax_admission_v1';scope:'service_fee_only';
  policyVersion:string;policySourceHash:string;contextHash:string;
  jurisdiction:'CA-QC';gstTreatment:Treatment;qstTreatment:Treatment;
  gstRate:number;qstRate:number;transportTreatment:'documented_no_additional_platform_tax'|'no_transport_charge';
  legalCorrectnessVerified:false;registrationAuthorityVerified:false;
}
export interface OperatorTaxDecision {
  protocol:'operator_tax_decision_v2';scope:'service_fee_only'|'shop_tier_subscription';policyVersion:string;
  policySourceHash:string;contextHash:string;jurisdiction:'CA-QC';
  gstTreatment:DecisionTreatment;qstTreatment:DecisionTreatment;gstRate:number;qstRate:number;
  gstNonCollectionReason:NonCollectionReason|null;qstNonCollectionReason:NonCollectionReason|null;
  technicalConfiguration:{enabled:boolean;gstRate:number;qstRate:number};
  priceMode:'exclusive'|'inclusive';rounding:'separate_taxes_half_up_cents_v1';
  transportTreatment:'documented_no_additional_platform_tax'|'no_transport_charge'|'sandbox_test_only';
  testMode?:'seconde_dev_commerce_v1';
  legalCorrectnessVerified:false;registrationAuthorityVerified:false;
}
export type ServiceFeeTaxAdmission=LegacyServiceFeeTaxAdmission|OperatorTaxDecision;
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const oneOf=(v:unknown,values:readonly string[]):v is string=>typeof v==='string'&&values.includes(v);
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function exact(v:unknown,keys:string[]):v is Record<string,unknown> {
  return obj(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
}
const text=(v:unknown,max=160):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&v.trim()===v&&!/[\u0000-\u001f\u007f]/.test(v);
const unknown=()=>new HttpsError('failed-precondition','Le traitement fiscal du service doit être documenté avant un nouveau montant taxé.',
  {reason:'service_fee_tax_qualification_required',taxQualification:'unknown',paymentPermissionGranted:false});
function reference(v:unknown) {
  if(!exact(v,['reference','contentHash'])||!text(v.reference,240)||!hash(v.contentHash))throw unknown();
  return {reference:v.reference,contentHash:v.contentHash};
}
function instant(v:unknown):number {
  if(typeof v!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v))throw unknown();
  const n=Date.parse(v);if(!Number.isSafeInteger(n)||new Date(n).toISOString()!==v)throw unknown();return n;
}
function tax(v:unknown,name:'gst'|'qst',configuredRate:number,enabled:boolean,at:number) {
  if(!exact(v,['treatment','rate','reasonReference','registration','nonCollectionReason'])||
    !oneOf(v.treatment,['taxable','zero_rated','exempt','not_collecting'])||typeof v.rate!=='string'||
    !/^(?:0|1)(?:\.\d{1,6})?$/.test(v.rate)||Number(v.rate)>1)throw unknown();
  const rate=Number(v.rate),reasonReference=reference(v.reasonReference),r=v.registration;
  if(v.treatment==='taxable'&&(!enabled||rate<=0||rate!==configuredRate)||
    v.treatment!=='taxable'&&rate!==0||enabled&&rate!==configuredRate||
    v.treatment==='not_collecting'&&(enabled||!oneOf(v.nonCollectionReason,['documented_non_registration','documented_other_legal_basis']))||
    v.treatment!=='not_collecting'&&v.nonCollectionReason!==null)throw unknown();
  let registration:{status:'documented_active';number:string;effectiveFrom:string;sourceReference:ReturnType<typeof reference>}|null=null;
  if(r!==null){
    if(!exact(r,['status','number','effectiveFrom','sourceReference'])||r.status!=='documented_active'||typeof r.number!=='string'||
      !(name==='gst'?/^\d{9}RT\d{4}$/:/^\d{10}TQ\d{4}$/).test(r.number)||instant(r.effectiveFrom)>at)throw unknown();
    registration={status:'documented_active',number:r.number,effectiveFrom:new Date(instant(r.effectiveFrom)).toISOString(),sourceReference:reference(r.sourceReference)};
  }
  if(v.treatment==='taxable'&&!registration||v.nonCollectionReason==='documented_non_registration'&&registration!==null)throw unknown();
  return {treatment:v.treatment as DecisionTreatment,rate:v.rate,reasonReference,registration,
    nonCollectionReason:v.nonCollectionReason as NonCollectionReason|null};
}
/** Shared mechanics, with separate deployment policies and exact service scope.
 * Neither the fee policy nor Part XX reporting can authorize a shop forfait. */
export function qualifyDocumentedOperatorTax(rawPolicy:string|undefined,scope:OperatorTaxDecision['scope'],
  gstRate:number,qstRate:number,enabled:boolean,context?:ServiceFeeTaxContext):OperatorTaxDecision {
  // Test amounts are not a documentary claim about registration or a legal
  // exemption. Keep their exact context and distinct provenance in receipts.
  if (!rawPolicy && isDevCommerceStripeTestRuntime()) {
    const address=normalizeCanadianAddress(context?.address);
    if(enabled||!context||!text(context.recipientUid,128)||context.recipientUid.includes('/')||
      !oneOf(context.source,['shipping_destination','payer_declared_primary_address'])||!text(context.nativeSourceReference,300)||
      !oneOf(context.transport,['native_carrier_total','none'])||!address||address.country!=='CA'||address.province!=='QC')throw unknown();
    return {protocol:'operator_tax_decision_v2',scope,policyVersion:'seconde_dev_no_tax_v1',
      policySourceHash:sha({protocol:'seconde_dev_tax_exercise_v1',scope,enabled:false}),
      contextHash:sha({recipientUid:context.recipientUid,source:context.source,nativeSourceReference:context.nativeSourceReference,address,transport:context.transport}),
      jurisdiction:'CA-QC',gstTreatment:'not_collecting',qstTreatment:'not_collecting',gstRate:0,qstRate:0,
      gstNonCollectionReason:'sandbox_test_only',qstNonCollectionReason:'sandbox_test_only',
      technicalConfiguration:{enabled:false,gstRate,qstRate},priceMode:'exclusive',rounding:'separate_taxes_half_up_cents_v1',
      transportTreatment:context.transport==='none'?'no_transport_charge':'sandbox_test_only',
      legalCorrectnessVerified:false,registrationAuthorityVerified:false,testMode:'seconde_dev_commerce_v1'};
  }
  if(!rawPolicy||Buffer.byteLength(rawPolicy,'utf8')>16000||!context||typeof context.recipientUid!=='string'||!context.recipientUid||
    context.recipientUid.length>128||context.recipientUid.includes('/')||!oneOf(context.source,['shipping_destination','payer_declared_primary_address'])||
    !text(context.nativeSourceReference,300)||!oneOf(context.transport,['native_carrier_total','none']))throw unknown();
  let p:unknown;try{p=JSON.parse(rawPolicy);}catch{throw unknown();}
  if(!exact(p,['protocol','policyVersion','legalName','scope','effectiveFrom','effectiveUntil','assessmentReference',
    'serviceClassification','placeOfSupply','transport','gst','qst','priceMode','rounding'])||p.protocol!=='operator_service_tax_policy_v2'||
    !text(p.policyVersion)||p.legalName!=='Seconde Technologies inc.'||p.scope!==scope||
    p.serviceClassification!==(scope==='service_fee_only'?'seconde_buyer_protection_service':'seconde_shop_subscription_service')||
    !oneOf(p.priceMode,['exclusive','inclusive'])||scope==='service_fee_only'&&p.priceMode!=='exclusive'||
    p.rounding!=='separate_taxes_half_up_cents_v1')throw unknown();
  const now=Date.now(),from=instant(p.effectiveFrom),until=p.effectiveUntil===null?null:instant(p.effectiveUntil);
  if(from>now||until!==null&&(until<=from||now>=until))throw unknown();
  const place=p.placeOfSupply,address=normalizeCanadianAddress(context.address);
  if(!exact(place,['country','region','documentedRule','allowedNativeAddressSources'])||place.country!=='CA'||place.region!=='QC'||
    place.documentedRule!=='native_recipient_address_ca_qc_v1'||!Array.isArray(place.allowedNativeAddressSources)||
    !place.allowedNativeAddressSources.length||place.allowedNativeAddressSources.length>2||
    new Set(place.allowedNativeAddressSources).size!==place.allowedNativeAddressSources.length||
    place.allowedNativeAddressSources.some(v=>!oneOf(v,['shipping_destination','payer_declared_primary_address']))||
    !place.allowedNativeAddressSources.includes(context.source)||!address||!obj(context.address)||context.address.country!=='CA'||address.province!=='QC')throw unknown();
  const transport=p.transport;
  if(!exact(transport,['treatment','reasonReference'])||!oneOf(transport.treatment,['unknown','documented_no_additional_platform_tax']))throw unknown();
  const transportReference=transport.treatment==='unknown'&&transport.reasonReference===null?null:reference(transport.reasonReference);
  if(context.transport==='native_carrier_total'&&transport.treatment!=='documented_no_additional_platform_tax')throw unknown();
  const gst=tax(p.gst,'gst',gstRate,enabled,now),qst=tax(p.qst,'qst',qstRate,enabled,now);
  const canonical={protocol:p.protocol,policyVersion:p.policyVersion,legalName:p.legalName,scope:p.scope,
    effectiveFrom:p.effectiveFrom,effectiveUntil:p.effectiveUntil,assessmentReference:reference(p.assessmentReference),
    serviceClassification:p.serviceClassification,priceMode:p.priceMode,rounding:p.rounding,
    placeOfSupply:{country:place.country,region:place.region,documentedRule:place.documentedRule,
      allowedNativeAddressSources:[...place.allowedNativeAddressSources].sort()},
    transport:{treatment:transport.treatment,reasonReference:transportReference},gst,qst};
  return {protocol:'operator_tax_decision_v2',scope,policyVersion:p.policyVersion,policySourceHash:sha(canonical),
    contextHash:sha({recipientUid:context.recipientUid,source:context.source,nativeSourceReference:context.nativeSourceReference,address,transport:context.transport}),
    jurisdiction:'CA-QC',gstTreatment:gst.treatment,qstTreatment:qst.treatment,gstRate:Number(gst.rate),qstRate:Number(qst.rate),
    gstNonCollectionReason:gst.nonCollectionReason,qstNonCollectionReason:qst.nonCollectionReason,
    technicalConfiguration:{enabled,gstRate,qstRate},priceMode:p.priceMode as OperatorTaxDecision['priceMode'],rounding:'separate_taxes_half_up_cents_v1',
    transportTreatment:context.transport==='none'?'no_transport_charge':'documented_no_additional_platform_tax',
    legalCorrectnessVerified:false,registrationAuthorityVerified:false};
}
export function qualifyNewServiceFeeTax(gstRate:number,qstRate:number,context?:ServiceFeeTaxContext,enabled=true):OperatorTaxDecision {
  return qualifyDocumentedOperatorTax(RAW_POLICY,'service_fee_only',gstRate,qstRate,enabled,context);
}
/** Canonical original decision. Historical reads use recorded facts only. */
export function qualifiedOperatorTaxDecision(raw:unknown):OperatorTaxDecision|null {
  const sandbox=obj(raw)&&Object.prototype.hasOwnProperty.call(raw,'testMode');
  if(!exact(raw,['protocol','scope','policyVersion','policySourceHash','contextHash','jurisdiction','gstTreatment','qstTreatment','gstRate','qstRate',
    'gstNonCollectionReason','qstNonCollectionReason','technicalConfiguration','priceMode','rounding','transportTreatment','legalCorrectnessVerified','registrationAuthorityVerified',...(sandbox?['testMode']:[])])||
    raw.protocol!=='operator_tax_decision_v2'||!oneOf(raw.scope,['service_fee_only','shop_tier_subscription'])||!text(raw.policyVersion)||
    !hash(raw.policySourceHash)||!hash(raw.contextHash)||raw.jurisdiction!=='CA-QC'||!oneOf(raw.priceMode,['exclusive','inclusive'])||
    raw.scope==='service_fee_only'&&raw.priceMode!=='exclusive'||raw.rounding!=='separate_taxes_half_up_cents_v1'||
    !oneOf(raw.transportTreatment,['documented_no_additional_platform_tax','no_transport_charge',...(sandbox?['sandbox_test_only']:[])])||raw.legalCorrectnessVerified!==false||raw.registrationAuthorityVerified!==false||
    !exact(raw.technicalConfiguration,['enabled','gstRate','qstRate'])||typeof raw.technicalConfiguration.enabled!=='boolean')return null;
  const c=raw.technicalConfiguration;
  if(sandbox&&(!isDevCommerceTestRuntime()||raw.testMode!=='seconde_dev_commerce_v1'||raw.policyVersion!=='seconde_dev_no_tax_v1'||
    c.enabled!==false||raw.gstTreatment!=='not_collecting'||raw.qstTreatment!=='not_collecting'||raw.gstRate!==0||raw.qstRate!==0||
    raw.gstNonCollectionReason!=='sandbox_test_only'||raw.qstNonCollectionReason!=='sandbox_test_only'||
    raw.policySourceHash!==sha({protocol:'seconde_dev_tax_exercise_v1',scope:raw.scope,enabled:false})))return null;
  for(const [t,r,n,configured] of [[raw.gstTreatment,raw.gstRate,raw.gstNonCollectionReason,c.gstRate],[raw.qstTreatment,raw.qstRate,raw.qstNonCollectionReason,c.qstRate]]){
    if(!oneOf(t,['taxable','zero_rated','exempt','not_collecting'])||typeof r!=='number'||!Number.isFinite(r)||r<0||r>1||
      typeof configured!=='number'||!Number.isFinite(configured)||configured<0||configured>1||
      !/^(?:0|1)(?:\.\d{1,6})?$/.test(String(r))||!/^(?:0|1)(?:\.\d{1,6})?$/.test(String(configured))||
      t==='taxable'&&(!c.enabled||r<=0)||t!=='taxable'&&r!==0||c.enabled&&r!==configured||
      t==='not_collecting'&&(c.enabled||!oneOf(n,['documented_non_registration','documented_other_legal_basis',...(sandbox?['sandbox_test_only']:[])]))||t!=='not_collecting'&&n!==null)return null;
  }
  return {protocol:'operator_tax_decision_v2',scope:raw.scope as OperatorTaxDecision['scope'],policyVersion:raw.policyVersion,
    policySourceHash:raw.policySourceHash,contextHash:raw.contextHash,jurisdiction:'CA-QC',gstTreatment:raw.gstTreatment as DecisionTreatment,
    qstTreatment:raw.qstTreatment as DecisionTreatment,gstRate:raw.gstRate as number,qstRate:raw.qstRate as number,
    gstNonCollectionReason:raw.gstNonCollectionReason as NonCollectionReason|null,qstNonCollectionReason:raw.qstNonCollectionReason as NonCollectionReason|null,
    technicalConfiguration:{enabled:c.enabled as boolean,gstRate:c.gstRate as number,qstRate:c.qstRate as number},priceMode:raw.priceMode as OperatorTaxDecision['priceMode'],
    rounding:'separate_taxes_half_up_cents_v1',transportTreatment:raw.transportTreatment as OperatorTaxDecision['transportTreatment'],
    legalCorrectnessVerified:false,registrationAuthorityVerified:false,...(sandbox?{testMode:'seconde_dev_commerce_v1' as const}:{})};
}
export function operatorTaxDecisionHash(raw:OperatorTaxDecision):string {
  const canonical=qualifiedOperatorTaxDecision(raw);if(!canonical)throw unknown();return sha(canonical);
}
/** Historical structural proof only. Never reclassifies an accepted amount
 * against today's deployment policy or implies actual registration validity. */
export function qualifiedServiceFeeTaxAdmission(raw:unknown):ServiceFeeTaxAdmission|null {
  if(obj(raw)&&raw.protocol==='operator_tax_decision_v2'){const decision=qualifiedOperatorTaxDecision(raw);return decision?.scope==='service_fee_only'?decision:null;}
  if(!exact(raw,['protocol','scope','policyVersion','policySourceHash','contextHash','jurisdiction','gstTreatment','qstTreatment','gstRate','qstRate',
    'transportTreatment','legalCorrectnessVerified','registrationAuthorityVerified'])||raw.protocol!=='service_fee_tax_admission_v1'||raw.scope!=='service_fee_only'||
    !text(raw.policyVersion)||!hash(raw.policySourceHash)||!hash(raw.contextHash)||raw.jurisdiction!=='CA-QC'||
    !oneOf(raw.transportTreatment,['documented_no_additional_platform_tax','no_transport_charge'])||
    raw.legalCorrectnessVerified!==false||raw.registrationAuthorityVerified!==false)return null;
  for(const [t,r] of [[raw.gstTreatment,raw.gstRate],[raw.qstTreatment,raw.qstRate]]){
    if(!oneOf(t,['taxable','zero_rated','exempt'])||typeof r!=='number'||!Number.isFinite(r)||r<0||r>1||
      !/^(?:0|1)(?:\.\d{1,6})?$/.test(String(r))||t!=='taxable'&&r!==0||t==='taxable'&&r<=0)return null;
  }
  return {protocol:'service_fee_tax_admission_v1',scope:'service_fee_only',policyVersion:raw.policyVersion,
    policySourceHash:raw.policySourceHash,contextHash:raw.contextHash,jurisdiction:'CA-QC',gstTreatment:raw.gstTreatment as Treatment,
    qstTreatment:raw.qstTreatment as Treatment,gstRate:raw.gstRate as number,qstRate:raw.qstRate as number,
    transportTreatment:raw.transportTreatment as LegacyServiceFeeTaxAdmission['transportTreatment'],legalCorrectnessVerified:false,registrationAuthorityVerified:false};
}
