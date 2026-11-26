/** Documentary transport admission. No account/insurance contract is invented
 * from a feature flag, a carrier quote or the price charged for insurance. */
import {createHash} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {Timestamp} from 'firebase-admin/firestore';
import {qualifiedShippingTaxSource,shippingSourceFingerprint} from '../utils/shippingSourceIdentity';
import {isDevCommerceTestRuntime,isDevCommerceShippingTestRuntime} from './runtimeEnvironment';

type Data=Record<string,any>;
export type TransportLeg='forward'|'return';
type Service={carrierId:string;carrierCode:string;serviceCode:string};
type Instruction={instructions:string;officialUrl:string;documentReference:string;documentSha256:string};
type Handoff=Instruction & {mode:'ordinary_dropoff'|'member_arranged_collection';alternative:Instruction|null};
type LegTerms={confirmation:string;handoff:Handoff};
type PublicLegTerms={confirmation:string;handoff:{mode:Handoff['mode'];instructions:string;officialUrl:string;
  alternative:{instructions:string;officialUrl:string}|null;siteAvailabilityVerified:false;bookingVerified:false}};
export interface ShippingTransportPolicy {
  protocol:'shipping_transport_policy_v1';version:string;documentReference:string;documentSha256:string;effectiveFrom:string;effectiveUntil:string;
  account:{id:string;environment:'production'|'sandbox';apiBaseUrl:string;credentialSha256:string;bindingDocumentReference:string;bindingDocumentSha256:string};
  services:Service[];articleRules:{categoryIds:string[];conditions:string[];excludedMaterials:string[];exclusionsText:string};
  coverage:{valuation:'article_price_excludes_fees_shipping';currency:'CAD';maxCents:number;deductibleCents:number;beneficiary:'seconde_operator'|'seller'|'buyer';
    insuranceProvider:'carrier'|'third_party'|'none';effectiveCoverageReference:string;effectiveCoverageSha256:string;effectiveCoverageBasis:'carrier_contract'|'external_automatic_policy'|'sandbox_simulation'};
  testMode?:'seconde_dev_commerce_v1';
  forward:LegTerms;return:LegTerms;
}
/** Safe native projection for party-readable orders. Documentary account IDs,
 * credential fingerprints and private evidence references stay out of it. */
export interface ShippingTransportAdmission {
  protocol:'shipping_transport_admission_v1';policyHash:string;policyVersion:string;accountBindingHash:string;termsHash:string;
  source:{itemHash:string;valueCents:number;ordinaryAddressHash:string;forwardContextHash:string;returnContextHash:string};
  services:Service[];coverage:{currency:'CAD';declaredValueCents:number;coveredValueCents:number;maxCents:number;deductibleCents:number;
    beneficiary:string;exclusions:string;insuranceProvider:'carrier'|'third_party'|'none';effectiveCoverageBasis:string;providerCoverageApiVerified:false};
  testMode?:'seconde_dev_commerce_v1';
  forward:PublicLegTerms;return:PublicLegTerms;hash:string;
}
export interface ShippingTransportLeg {protocol:'shipping_transport_leg_v1';admission:ShippingTransportAdmission;leg:TransportLeg;hash:string}
const object=(v:any):v is Data=>!!v&&typeof v==='object'&&!Array.isArray(v);
const own=(v:any,k:string)=>Object.prototype.hasOwnProperty.call(v??{},k);
const hex=(v:any):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=(v:any,max=2000):string=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\u0000-\u001f\u007f]/.test(v))return fail('unknown','documentary_clause_unknown');return v;};
const keys=(v:any,ks:string[])=>{if(!object(v)||Object.keys(v).length!==ks.length||ks.some(k=>!own(v,k)))return fail('unknown','policy_shape_unknown');};
function canonical(v:any):any {if(v===null||typeof v==='string'||typeof v==='boolean')return v;if(typeof v==='number'&&Number.isFinite(v))return v;
  if(Array.isArray(v))return v.map(canonical);if(object(v))return Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])]));throw new Error('transport_source_unqualified');}
export const shippingTransportHash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function fail(qualification:'unknown'|'unsupported',reason:string):never {throw new HttpsError('failed-precondition',
  'Les conditions de couverture ou de dépôt doivent être qualifiées pour ce transport. Contactez notre équipe.',
  {reason:'shipping_transport_'+reason,qualification,newPaidShippingAdmitted:false,coverageApiVerified:false,action:'contactSupport'});}
const cents=(v:any,positive=false)=>{if(!Number.isSafeInteger(v)||v<(positive?1:0))return fail('unknown','money_unknown');return v as number;};
const documentHash=(v:any)=>{if(!hex(v))return fail('unknown','document_hash_unknown');return v;};
const list=(v:any,max:number)=>{if(!Array.isArray(v)||v.length>max)return fail('unknown','article_rule_unknown');const a=v.map(x=>text(x,150));if(new Set(a).size!==a.length)return fail('unknown','ambiguous_rule');return a.sort();};
const url=(v:any)=>{text(v,2000);try{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error();return v as string;}catch{return fail('unknown','official_instructions_unknown');}};
function instruction(v:any):Instruction {keys(v,['instructions','officialUrl','documentReference','documentSha256']);return{instructions:text(v.instructions,3000),officialUrl:url(v.officialUrl),documentReference:text(v.documentReference,300),documentSha256:documentHash(v.documentSha256)};}
function legTerms(v:any):LegTerms {
  keys(v,['confirmation','handoff']);if(!['none','delivery','signature','adult_signature','direct_signature','delivery_mailed','verbal_confirmation'].includes(v.confirmation))return fail('unsupported','confirmation_unknown');
  const h=v.handoff;keys(h,['mode','instructions','officialUrl','documentReference','documentSha256','alternative']);
  if(!['ordinary_dropoff','member_arranged_collection'].includes(h.mode))return fail('unsupported','handoff_unknown');
  return{confirmation:v.confirmation,handoff:{mode:h.mode,...instruction({instructions:h.instructions,officialUrl:h.officialUrl,documentReference:h.documentReference,documentSha256:h.documentSha256}),alternative:h.alternative===null?null:instruction(h.alternative)}};
}
function publicLeg(v:LegTerms):PublicLegTerms {const h=v.handoff;return{confirmation:v.confirmation,handoff:{mode:h.mode,instructions:h.instructions,officialUrl:h.officialUrl,
  alternative:h.alternative?{instructions:h.alternative.instructions,officialUrl:h.alternative.officialUrl}:null,siteAvailabilityVerified:false,bookingVerified:false}};}
function qualifiedPublicLeg(v:any):PublicLegTerms {
  keys(v,['confirmation','handoff']);if(!['none','delivery','signature','adult_signature','direct_signature','delivery_mailed','verbal_confirmation'].includes(v.confirmation))return fail('unknown','confirmation_unknown');
  const h=v.handoff;keys(h,['mode','instructions','officialUrl','alternative','siteAvailabilityVerified','bookingVerified']);
  if(!['ordinary_dropoff','member_arranged_collection'].includes(h.mode)||h.siteAvailabilityVerified!==false||h.bookingVerified!==false)return fail('unknown','handoff_capture_unknown');
  let alternative:null|{instructions:string;officialUrl:string}=null;if(h.alternative!==null){keys(h.alternative,['instructions','officialUrl']);alternative={instructions:text(h.alternative.instructions,3000),officialUrl:url(h.alternative.officialUrl)};}
  return{confirmation:v.confirmation,handoff:{mode:h.mode,instructions:text(h.instructions,3000),officialUrl:url(h.officialUrl),alternative,siteAvailabilityVerified:false,bookingVerified:false}};
}
const summaryBody=(v:Pick<ShippingTransportAdmission,'policyVersion'|'coverage'|'forward'|'return'|'testMode'>)=>({protocol:'shipping_transport_terms_v1' as const,
  policyVersion:v.policyVersion,coverage:v.coverage,forward:v.forward,return:v.return,accountIdentityApiVerified:false as const,...(v.testMode?{testMode:v.testMode}:{})});
function publicPolicyTerms(p:ShippingTransportPolicy,value:number) {
  return{policyVersion:p.version,...(p.testMode?{testMode:p.testMode}:{}),coverage:{currency:'CAD' as const,declaredValueCents:value,coveredValueCents:p.testMode?0:value,maxCents:p.coverage.maxCents,deductibleCents:p.coverage.deductibleCents,
    beneficiary:p.coverage.beneficiary,exclusions:p.articleRules.exclusionsText,insuranceProvider:p.coverage.insuranceProvider,effectiveCoverageBasis:p.coverage.effectiveCoverageBasis,providerCoverageApiVerified:false as const},
    forward:publicLeg(p.forward),return:publicLeg(p.return)};
}
function services(v:any):Service[] {if(!Array.isArray(v)||!v.length||v.length>20)return fail('unknown','services_unknown');const result=v.map(s=>{keys(s,['carrierId','carrierCode','serviceCode']);
  if(!/^se-[A-Za-z0-9-]+$/.test(s.carrierId??'')||!/^[a-z0-9_-]{1,100}$/.test(s.carrierCode??'')||!/^[A-Za-z0-9_-]{1,100}$/.test(s.serviceCode??''))return fail('unknown','service_identity_unknown');
  return{carrierId:s.carrierId,carrierCode:s.carrierCode,serviceCode:s.serviceCode};}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(new Set(result.map(s=>shippingTransportHash(s))).size!==result.length)return fail('unknown','service_identity_ambiguous');return result;}
function policy(v:any):ShippingTransportPolicy {
  keys(v,['protocol','version','documentReference','documentSha256','effectiveFrom','effectiveUntil','account','services','articleRules','coverage','forward','return']);
  if(v.protocol!=='shipping_transport_policy_v1')return fail('unknown','policy_version_unknown');
  const from=Date.parse(v.effectiveFrom),until=Date.parse(v.effectiveUntil);
  if(!Number.isSafeInteger(from)||!Number.isSafeInteger(until)||from<0||until<=from||new Date(from).toISOString()!==v.effectiveFrom||new Date(until).toISOString()!==v.effectiveUntil)return fail('unknown','effective_dates_unknown');
  const a=v.account;keys(a,['id','environment','apiBaseUrl','credentialSha256','bindingDocumentReference','bindingDocumentSha256']);
  if(!['production','sandbox'].includes(a.environment)||a.apiBaseUrl!=='https://api.shipengine.com')return fail('unsupported','account_environment_unknown');
  const r=v.articleRules;keys(r,['categoryIds','conditions','excludedMaterials','exclusionsText']);
  const categories=list(r.categoryIds,100),conditions=list(r.conditions,30);if(!categories.length||!conditions.length)return fail('unknown','article_scope_unknown');
  const c=v.coverage;keys(c,['valuation','currency','maxCents','deductibleCents','beneficiary','insuranceProvider','effectiveCoverageReference','effectiveCoverageSha256','effectiveCoverageBasis']);
  if(c.valuation!=='article_price_excludes_fees_shipping'||c.currency!=='CAD'||!['seconde_operator','seller','buyer'].includes(c.beneficiary)||
    !['carrier','third_party'].includes(c.insuranceProvider)||c.effectiveCoverageBasis!==(c.insuranceProvider==='carrier'?'carrier_contract':'external_automatic_policy'))return fail('unknown','effective_coverage_unknown');
  const max=cents(c.maxCents,true),deductible=cents(c.deductibleCents);if(deductible>max)return fail('unknown','deductible_unknown');
  return{protocol:v.protocol,version:text(v.version,100),documentReference:text(v.documentReference,300),documentSha256:documentHash(v.documentSha256),effectiveFrom:v.effectiveFrom,effectiveUntil:v.effectiveUntil,
    account:{id:text(a.id,200),environment:a.environment,apiBaseUrl:a.apiBaseUrl,credentialSha256:documentHash(a.credentialSha256),bindingDocumentReference:text(a.bindingDocumentReference,300),bindingDocumentSha256:documentHash(a.bindingDocumentSha256)},
    services:services(v.services),articleRules:{categoryIds:categories,conditions,excludedMaterials:list(r.excludedMaterials,100),exclusionsText:text(r.exclusionsText,3000)},
    coverage:{valuation:c.valuation,currency:'CAD',maxCents:max,deductibleCents:deductible,beneficiary:c.beneficiary,insuranceProvider:c.insuranceProvider,
      effectiveCoverageReference:text(c.effectiveCoverageReference,300),effectiveCoverageSha256:documentHash(c.effectiveCoverageSha256),effectiveCoverageBasis:c.effectiveCoverageBasis},
    forward:legTerms(v.forward),return:legTerms(v.return)};
}
const currentBinding=()=>{
  const key=process.env.SHIPENGINE_API_KEY,environment=process.env.SHIPENGINE_ACCOUNT_ENVIRONMENT,baseUrl=process.env.SHIPENGINE_BASE_URL||'https://api.shipengine.com';
  if(typeof key!=='string'||!key||!['production','sandbox'].includes(environment??'')||baseUrl!=='https://api.shipengine.com')return fail('unknown','account_binding_unknown');
  const credentialSha256=createHash('sha256').update(key,'utf8').digest('hex');return{credentialSha256,environment,baseUrl};
};
const bindingHash=(a:{credentialSha256:string;environment:unknown;baseUrl:string},policyHash:string,source:ShippingTransportAdmission['source'])=>shippingTransportHash(['shipping_account_binding_v1',a.credentialSha256,a.environment,a.baseUrl,policyHash,source]);
export function readShippingTransportPolicy():ShippingTransportPolicy {
  const raw=process.env.SHIPENGINE_TRANSPORT_POLICY_JSON;
  if(!raw&&isDevCommerceShippingTestRuntime())return devTransportPolicy();
  if(!raw||Buffer.byteLength(raw,'utf8')>64000)return fail('unknown','policy_missing');
  let p:ShippingTransportPolicy;try{p=policy(JSON.parse(raw));}catch(e){if(e instanceof HttpsError)throw e;return fail('unknown','policy_malformed');}
  const now=Date.now(),binding=currentBinding();if(now<Date.parse(p.effectiveFrom)||now>=Date.parse(p.effectiveUntil))return fail('unknown','policy_not_effective');
  if(binding.credentialSha256!==p.account.credentialSha256||binding.environment!==p.account.environment||binding.baseUrl!==p.account.apiBaseUrl)return fail('unknown','account_binding_changed');
  return p;
}
/** An exercise contract is generated from isolated runtime configuration, not
 * accepted from a member or represented as a carrier/insurance agreement. */
function devTransportPolicy():ShippingTransportPolicy {
  const binding=currentBinding(),reference='seconde-dev:commerce-exercise-v1';
  const instructions='Simulation Seconde Dev : ne déposez aucun colis réel. Faites avancer le suivi depuis les outils de test de la commande.';
  const leg:LegTerms={confirmation:'none',handoff:{mode:'ordinary_dropoff',instructions,officialUrl:'https://www.shipengine.com/docs/sandbox/',
    documentReference:reference,documentSha256:shippingTransportHash(instructions),alternative:null}};
  return {protocol:'shipping_transport_policy_v1',version:'seconde_dev_transport_v1',testMode:'seconde_dev_commerce_v1',
    documentReference:reference,documentSha256:shippingTransportHash(reference),effectiveFrom:'2026-01-01T00:00:00.000Z',effectiveUntil:'2100-01-01T00:00:00.000Z',
    account:{id:'seconde-dev-simulation',environment:'sandbox',apiBaseUrl:'https://api.shipengine.com',credentialSha256:binding.credentialSha256,
      bindingDocumentReference:reference,bindingDocumentSha256:shippingTransportHash(reference)},
    services:[{carrierId:'se-dev-simulation',carrierCode:'seconde_dev',serviceCode:'seconde_dev_standard'}],
    articleRules:{categoryIds:['*'],conditions:['*'],excludedMaterials:[],exclusionsText:'Simulation Seconde Dev : aucun colis réel ni couverture d’assurance.'},
    coverage:{valuation:'article_price_excludes_fees_shipping',currency:'CAD',maxCents:1000000,deductibleCents:0,beneficiary:'seconde_operator',
      insuranceProvider:'none',effectiveCoverageReference:reference,effectiveCoverageSha256:shippingTransportHash(reference),effectiveCoverageBasis:'sandbox_simulation'},
    forward:leg,return:leg};
}
/** Context hash intentionally excludes the additive capture itself. */
export function transportContextHash(c:any):string {return shippingTransportHash({shipFrom:c.shipFrom,shipTo:c.shipTo,parcel:c.parcel,isReturn:c.isReturn===true});}
const address=(a:any)=>({name:a.name,addressLine1:a.street,...(a.line2?{addressLine2:a.line2}:{}),cityLocality:a.city,stateProvince:a.province,postalCode:a.postalCode,countryCode:a.country,...(a.phone?{phone:a.phone}:{}),...(a.email?{email:a.email}:{})});
export function shippingTransportNativeContext(origin:any,destination:any,parcel:any,isReturn=false) {
  return{shipFrom:address(isReturn?destination:origin),shipTo:address(isReturn?origin:destination),parcel,...(isReturn?{isReturn:true as const}:{})};
}
export function captureShippingTransport(input:{origin:any;destination:any;parcel:any;item:any;amount:number;addressAdmission:any}) {
  const p=readShippingTransportPolicy(),a=input.addressAdmission;
  if(input.origin.country!=='CA'||input.destination.country!=='CA'||input.origin.province!=='QC'||input.destination.province!=='QC'||
    a?.protocol!=='ordinary_shipping_address_admission_v1'||![a.origin?.kind,a.destination?.kind].every(k=>['ordinary_residential','ordinary_business'].includes(k)))return fail('unsupported','route_or_address_unknown');
  const value=Math.round(input.amount*100);if(!Number.isSafeInteger(value)||value<1||Math.abs(input.amount*100-value)>1e-7)return fail('unknown','article_value_unknown');
  if(value>p.coverage.maxCents)return fail('unsupported','value_above_limit');
  const categories=Array.isArray(input.item?.categoryIds)?input.item.categoryIds:typeof input.item?.category==='string'?[input.item.category]:null;
  if(!categories?.length||!categories.every((c:any)=>typeof c==='string'))return fail('unknown','article_category_unknown');
  if(!p.testMode&&(!categories.every((c:string)=>p.articleRules.categoryIds.includes(c))||!p.articleRules.conditions.includes(input.item?.condition)))return fail('unsupported','article_excluded');
  const materials=input.item.materials;
  if(p.articleRules.excludedMaterials.length&&(!Array.isArray(materials)||!materials.every((m:any)=>typeof m==='string')))return fail('unknown','article_material_unknown');
  if(Array.isArray(materials)&&materials.some(m=>p.articleRules.excludedMaterials.includes(m)))return fail('unsupported','article_material_excluded');
  const source={itemHash:shippingTransportHash(input.item),valueCents:value,ordinaryAddressHash:shippingTransportHash(a),
    forwardContextHash:transportContextHash(shippingTransportNativeContext(input.origin,input.destination,input.parcel)),
    returnContextHash:transportContextHash(shippingTransportNativeContext(input.origin,input.destination,input.parcel,true))};
  const safeTerms=publicPolicyTerms(p,value);
  const body={protocol:'shipping_transport_admission_v1' as const,policyHash:shippingTransportHash(p),policyVersion:p.version,termsHash:shippingTransportHash(summaryBody(safeTerms)),
    accountBindingHash:bindingHash({credentialSha256:p.account.credentialSha256,environment:p.account.environment,baseUrl:p.account.apiBaseUrl},shippingTransportHash(p),source),source,services:p.services,
    coverage:safeTerms.coverage,forward:safeTerms.forward,return:safeTerms.return,...(p.testMode?{testMode:p.testMode}:{})};
  return{admission:{...body,hash:shippingTransportHash(body)},policy:p};
}
export function qualifiedShippingTransportAdmission(v:any):ShippingTransportAdmission {
  const sandbox=own(v,'testMode');
  if(sandbox&&(!isDevCommerceTestRuntime()||v.testMode!=='seconde_dev_commerce_v1'||v.policyVersion!=='seconde_dev_transport_v1'))return fail('unsupported','sandbox_runtime_mismatch');
  keys(v,['protocol','policyHash','policyVersion','accountBindingHash','termsHash','source','services','coverage','forward','return','hash',...(sandbox?['testMode']:[])]);
  if(v.protocol!=='shipping_transport_admission_v1'||!hex(v.policyHash)||!hex(v.accountBindingHash))return fail('unknown','capture_unknown');
  const s=v.source;keys(s,['itemHash','valueCents','ordinaryAddressHash','forwardContextHash','returnContextHash']);
  for(const k of ['itemHash','ordinaryAddressHash','forwardContextHash','returnContextHash'])documentHash(s[k]);
  const c=v.coverage;keys(c,['currency','declaredValueCents','coveredValueCents','maxCents','deductibleCents','beneficiary','exclusions','insuranceProvider','effectiveCoverageBasis','providerCoverageApiVerified']);
  if(c.currency!=='CAD'||c.declaredValueCents!==cents(s.valueCents,true)||c.coveredValueCents!==(sandbox?0:s.valueCents)||cents(c.maxCents,true)<s.valueCents||cents(c.deductibleCents)>c.maxCents||
    !['seconde_operator','seller','buyer'].includes(c.beneficiary)||
    (sandbox?c.insuranceProvider!=='none'||c.effectiveCoverageBasis!=='sandbox_simulation':!['carrier','third_party'].includes(c.insuranceProvider)||c.effectiveCoverageBasis!==(c.insuranceProvider==='carrier'?'carrier_contract':'external_automatic_policy'))||
    c.providerCoverageApiVerified!==false)return fail('unknown','coverage_capture_unknown');
  const body={protocol:'shipping_transport_admission_v1' as const,policyHash:v.policyHash,policyVersion:text(v.policyVersion,100),accountBindingHash:v.accountBindingHash,termsHash:documentHash(v.termsHash),
    source:{itemHash:s.itemHash,valueCents:s.valueCents,ordinaryAddressHash:s.ordinaryAddressHash,forwardContextHash:s.forwardContextHash,returnContextHash:s.returnContextHash},services:services(v.services),
    coverage:{currency:'CAD' as const,declaredValueCents:c.declaredValueCents,coveredValueCents:c.coveredValueCents,maxCents:c.maxCents,deductibleCents:c.deductibleCents,beneficiary:c.beneficiary,exclusions:text(c.exclusions,3000),insuranceProvider:c.insuranceProvider,effectiveCoverageBasis:c.effectiveCoverageBasis,providerCoverageApiVerified:false as const},forward:qualifiedPublicLeg(v.forward),return:qualifiedPublicLeg(v.return),...(sandbox?{testMode:'seconde_dev_commerce_v1' as const}:{})};
  if(v.hash!==shippingTransportHash(body)||v.termsHash!==shippingTransportHash(summaryBody(body)))return fail('unknown','capture_hash_changed');return{...body,hash:v.hash};
}
export function shippingTransportLeg(raw:any,context:any,leg:TransportLeg):ShippingTransportLeg {
  const admission=qualifiedShippingTransportAdmission(raw);
  if(transportContextHash(context)!==admission.source[leg==='forward'?'forwardContextHash':'returnContextHash'])return fail('unknown','frozen_context_changed');
  const body={protocol:'shipping_transport_leg_v1' as const,admission,leg};return{...body,hash:shippingTransportHash(body)};
}
export function qualifiedShippingTransportLeg(raw:any,context?:any):ShippingTransportLeg {
  keys(raw,['protocol','admission','leg','hash']);if(raw.protocol!=='shipping_transport_leg_v1'||!['forward','return'].includes(raw.leg))return fail('unknown','leg_unknown');
  const admission=qualifiedShippingTransportAdmission(raw.admission),body={protocol:'shipping_transport_leg_v1' as const,admission,leg:raw.leg as TransportLeg};
  if(raw.hash!==shippingTransportHash(body)||context&&transportContextHash(context)!==admission.source[raw.leg==='forward'?'forwardContextHash':'returnContextHash'])return fail('unknown','leg_source_changed');
  return{...body,hash:raw.hash};
}
export function assertTransportAccountBinding(v:ShippingTransportLeg) {if(bindingHash(currentBinding(),v.admission.policyHash,v.admission.source)!==v.admission.accountBindingHash)return fail('unknown','account_binding_changed');}
export function assertTransportCurrentForNewPost(v:ShippingTransportLeg) {
  assertTransportAccountBinding(v);const p=readShippingTransportPolicy();
  if(shippingTransportHash(p)!==v.admission.policyHash||v.admission.source.valueCents>p.coverage.maxCents||
    shippingTransportHash(p.services)!==shippingTransportHash(v.admission.services)||
    shippingTransportHash(summaryBody(publicPolicyTerms(p,v.admission.source.valueCents)))!==v.admission.termsHash)return fail('unknown','accepted_policy_changed');
}
export function transportServiceAllowed(v:ShippingTransportLeg,rate:any):boolean {return v.admission.services.some(s=>s.carrierId===rate.carrierId&&s.carrierCode===rate.carrierCode&&s.serviceCode===rate.serviceCode);}
export function shipmentTransportOptions(raw:any,context?:any) {const v=qualifiedShippingTransportLeg(raw,context),c=v.admission.coverage;return{insurance_provider:c.insuranceProvider,confirmation:v.admission[v.leg].confirmation,insured_value:{currency:'cad',amount:c.declaredValueCents/100}};}
export function shipmentTransportMatches(raw:any,capture:any,context?:any):boolean {try{const expected=shipmentTransportOptions(capture,context),p=raw?.packages;
  return raw?.insurance_provider===expected.insurance_provider&&raw?.confirmation===expected.confirmation&&Array.isArray(p)&&p.length===1&&p[0]?.insured_value?.currency?.toLowerCase()==='cad'&&
    typeof p[0].insured_value.amount==='number'&&Math.round(p[0].insured_value.amount*100)===Math.round(expected.insured_value.amount*100)&&Math.abs(p[0].insured_value.amount*100-Math.round(p[0].insured_value.amount*100))<1e-7;
  }catch{return false;}}
export function transportSourceHash(base:string,admission:ShippingTransportAdmission) {return shippingTransportHash([base,admission.protocol,admission.hash]);}
export function shippingTransportSummary(v:any) {const c=qualifiedShippingTransportAdmission(v);return{...summaryBody(c),termsHash:c.termsHash};}
/** Rebuild the original transport -> pricing -> accepted-source chain, without
 * consulting today's policy. Replacing two coherent capture copies cannot
 * acquire the old purchasePolicy.sourceHash (also pinned by recovery). */
export function qualifiedOrderTransportAdmission(order:any):ShippingTransportAdmission {
  const admission=qualifiedShippingTransportAdmission(order?.transportAdmission),mirror=qualifiedShippingTransportAdmission(order?.shippingSnapshot?.transportAdmission);
  if(admission.hash!==mirror.hash)return fail('unknown','order_capture_changed');
  const p=order.purchasePolicy,a=order.purchasePolicyAcceptance,t=order.transportTermsAcceptance;
  const total=Math.round(order.totalAmount*100),value=Math.round(order.amount*100);
  if(order.currency!=='CAD'||order.deliveryType!=='shipping'||!hex(order.transportBaseHash)||!hex(p?.hash)||!hex(p?.sourceHash)||
    p.quoteId!==order.shippingQuoteId||p.articleId!==order.articleId||p.buyerId!==order.buyerId||p.sellerId!==order.sellerId||
    a?.schemaVersion!==1||typeof a.transactionId!=='string'||!a.transactionId||a.transactionId.includes('/')||a.quoteId!==order.shippingQuoteId||
    a.acceptedBy!==order.buyerId||a.policyHash!==p.hash||a.policyVersion!==p.policyVersion||a.rateId!==order.shipEngineRateId||
    !Number.isSafeInteger(total)||total<=0||Math.abs(order.totalAmount*100-total)>1e-7||a.totalCents!==total||!(a.acceptedAt instanceof Timestamp)||
    !Number.isSafeInteger(value)||value<=0||Math.abs(order.amount*100-value)>1e-7||admission.source.valueCents!==value||
    admission.source.itemHash!==shippingTransportHash(order.articleSnapshot)||admission.source.ordinaryAddressHash!==shippingTransportHash(order.addressAdmission))return fail('unknown','accepted_item_source_changed');
  keys(t,['protocol','termsHash','acceptedBy','quoteId','rateId','policyHash','acceptedAt']);
  if(t.protocol!=='shipping_transport_acceptance_v1'||t.termsHash!==admission.termsHash||t.acceptedBy!==order.buyerId||t.quoteId!==order.shippingQuoteId||
    t.rateId!==order.shipEngineRateId||t.policyHash!==p.hash||!(t.acceptedAt instanceof Timestamp)||!t.acceptedAt.isEqual(a.acceptedAt))return fail('unknown','accepted_terms_changed');
  if(!qualifiedShippingTaxSource({pricingVersion:order.pricingVersion,taxSnapshot:order.taxSnapshot,...(own(order,'taxAdmission')?{taxAdmission:order.taxAdmission}:{}),
    fee:order.serviceFee,tax:order.taxTotal,pricingBaseHash:transportSourceHash(order.transportBaseHash,admission),hash:p.sourceHash}))return fail('unknown','accepted_pricing_source_changed');
  return admission;
}
const orderHasTransport=(order:any)=>['transportAdmission','transportBaseHash','transportTermsAcceptance'].some(k=>own(order,k))||own(order?.shippingSnapshot,'transportAdmission');
/** Exact native quote join before a NEW leg effect. This detects a partial
 * restore which removed every public transport marker. No marker is added to
 * an old order, and no current account/policy configuration is consulted. */
export function qualifiedOrderTransportQuote(order:any,quote:any,transactionId:string):ShippingTransportAdmission|null {
  const recorded=orderHasTransport(order)||own(quote,'transportTermsAcceptance')||['transportAdmission','transportBaseHash','transportPolicy'].some(k=>own(quote?.source,k));
  if(!quote||quote.state!=='claimed'||quote.transactionId!==transactionId||quote.ownerId!==order.buyerId||quote.sellerId!==order.sellerId||
    quote.articleId!==order.articleId||quote.acceptedRateId!==order.shipEngineRateId||quote.acceptedTotal!==order.totalAmount||
    quote.purchasePolicy?.hash!==order.purchasePolicy?.hash||quote.source?.hash!==order.purchasePolicy?.sourceHash||
    quote.purchasePolicy?.sourceHash!==quote.source?.hash||shippingTransportHash(quote.purchasePolicyAcceptance)!==shippingTransportHash(order.purchasePolicyAcceptance))return fail('unknown','original_quote_unknown');
  if(!recorded) {
    // A missing new envelope is not legacy merely because all its markers
    // disappeared together. Prove the historical unwrapped source instead.
    const source=quote.source,base=shippingSourceFingerprint(source),a=source.addressAdmission;
    const legacyBase=a?.protocol==='ordinary_shipping_address_admission_v1'
      ?createHash('sha256').update(JSON.stringify([base,a.protocol,a.policyVersion,a.origin,a.destination])).digest('hex'):base;
    if(source.hash!==legacyBase&&!(qualifiedShippingTaxSource(source)&&source.pricingBaseHash===legacyBase))return fail('unknown','legacy_transport_absence_unknown');
    return null;
  }
  const cap=qualifiedOrderTransportAdmission(order);
  if(qualifiedShippingTransportAdmission(quote.source?.transportAdmission).hash!==cap.hash||shippingTransportHash(quote.source?.transportPolicy)!==cap.policyHash||
    quote.source.transportBaseHash!==order.transportBaseHash||quote.source.pricingBaseHash!==transportSourceHash(order.transportBaseHash,cap)||
    !qualifiedShippingTaxSource(quote.source)||cap.source.itemHash!==shippingTransportHash(quote.source.item)||
    shippingTransportHash(quote.transportTermsAcceptance)!==shippingTransportHash(order.transportTermsAcceptance))return fail('unknown','original_transport_quote_changed');
  return cap;
}
/** Missing legacy capture stays missing. A present malformed/mismatched copy
 * never falls back to the historical option-free request. */
export function attachOrderTransport<T extends Record<string,any>>(order:any,context:T,leg:TransportLeg):T & {transport?:ShippingTransportLeg} {
  if(!orderHasTransport(order))return context;
  const admission=qualifiedOrderTransportAdmission(order);
  const transport=shippingTransportLeg(admission,context,leg);
  if(own(context,'transport')&&qualifiedShippingTransportLeg(context.transport,context).hash!==transport.hash)return fail('unknown','leg_capture_changed');
  return{...context,transport};
}
