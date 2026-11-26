/** Launch address declarations are claims by the parties, not verification of
 * a physical site, deliverability or carrier insurance. Historical address
 * normalization and servicing deliberately do not call these NEW-only guards. */
import {createHash} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {normalizeCanadianAddress} from '../shared/canadianAddress';
import {readShippingTransportPolicy} from '../config/shippingTransportPolicy';

export const ORDINARY_ADDRESS_POLICY_VERSION='ordinary_address_2026_01' as const;
export type OrdinaryAddressKind='ordinary_residential'|'ordinary_business';
export interface OrdinaryAddressDeclarationInput {
  schemaVersion:1;policyVersion:typeof ORDINARY_ADDRESS_POLICY_VERSION;kind:OrdinaryAddressKind;accepted:true;addressHash:string;
}
export interface OrdinaryAddressSource extends OrdinaryAddressDeclarationInput {
  protocol:'ordinary_shipping_address_declaration_v1';declaredBy:string;source:'seller_declared'|'buyer_declared';
  physicalSiteVerified:false;deliverabilityVerified:false;
}
export interface ShippingAddressAdmission {
  protocol:'ordinary_shipping_address_admission_v1';policyVersion:typeof ORDINARY_ADDRESS_POLICY_VERSION;
  origin:OrdinaryAddressSource;destination:OrdinaryAddressSource;
}
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const object=(v:any)=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exactKeys=(v:any,keys:string[])=>object(v)&&Object.keys(v).sort().join(',')===keys.sort().join(',');
const unknown=()=>new HttpsError('failed-precondition','Confirmez le type ordinaire de cette adresse avant une nouvelle expédition.',
  {reason:'ordinary_shipping_address_declaration_required',newPaidShippingAdmitted:false,physicalSiteVerified:false,deliverabilityVerified:false});
/** Fixed insertion order is part of the client declaration hash. Names/contact
 * details are excluded; every normalized physical address field is included. */
export function ordinaryAddressContentHash(raw:unknown):string {
  const a=normalizeCanadianAddress(raw);if(!a)throw unknown();
  return digest({street:a.street,line2:a.line2??null,city:a.city,province:a.province,postalCode:a.postalCode,country:a.country});
}
function declaration(raw:any,address:any):OrdinaryAddressDeclarationInput {
  if(!exactKeys(raw,['schemaVersion','policyVersion','kind','accepted','addressHash'])||raw.schemaVersion!==1||
    raw.policyVersion!==ORDINARY_ADDRESS_POLICY_VERSION||!['ordinary_residential','ordinary_business'].includes(raw.kind)||raw.accepted!==true||
    raw.addressHash!==ordinaryAddressContentHash(address))throw unknown();
  return {schemaVersion:1,policyVersion:ORDINARY_ADDRESS_POLICY_VERSION,kind:raw.kind,accepted:true,addressHash:raw.addressHash};
}
/** Reject explicit non-ordinary selections, without guessing site type from a
 * street regex or the provider's isResidential=false/unknown classification. */
function rejectStructuredContradiction(raw:any) {
  if(!object(raw))throw unknown();
  for(const key of ['pickupPointId','servicePointId','pudoId','flexDeliveryId','poBoxId']){
    if(raw[key]!==undefined&&raw[key]!==null&&raw[key]!=='')throw unknown();
  }
  for(const key of ['isPOBox','isPickupPoint'])if(raw[key]!==undefined&&raw[key]!==null&&raw[key]!==false)throw unknown();
  for(const key of ['deliveryType','addressType']){
    if(raw[key]===undefined||raw[key]===null)continue;
    if(typeof raw[key]!=='string')throw unknown();
    const kind=raw[key].trim().toLowerCase().replace(/[_ -]/g,'');
    if(['pickuppoint','servicepoint','pudo','locker','flexdelivery','pobox'].includes(kind))throw unknown();
  }
}
/** Actor and provenance are supplied by the server from the actual private
 * seller record or authenticated buyer, never copied from payload authority. */
export function declaredOrdinaryAddressSource(raw:any,actorUid:string,source:OrdinaryAddressSource['source']):OrdinaryAddressSource {
  rejectStructuredContradiction(raw);
  if(typeof actorUid!=='string'||!actorUid||actorUid.includes('/'))throw unknown();
  return {...declaration(raw.shippingUseDeclaration,raw),protocol:'ordinary_shipping_address_declaration_v1',declaredBy:actorUid,source,
    physicalSiteVerified:false,deliverabilityVerified:false};
}
/** A saved quote/order source is requalified against its exact normalized
 * address and expected native party. Missing legacy data never becomes ordinary. */
export function qualifiedOrdinaryAddressSource(address:any,raw:any,actorUid:string,source:OrdinaryAddressSource['source']):OrdinaryAddressSource {
  if(!exactKeys(raw,['schemaVersion','policyVersion','kind','accepted','addressHash','protocol','declaredBy','source','physicalSiteVerified','deliverabilityVerified'])||
    raw.protocol!=='ordinary_shipping_address_declaration_v1'||raw.declaredBy!==actorUid||raw.source!==source||
    raw.physicalSiteVerified!==false||raw.deliverabilityVerified!==false)throw unknown();
  rejectStructuredContradiction(address);
  const d=declaration({schemaVersion:raw.schemaVersion,policyVersion:raw.policyVersion,kind:raw.kind,accepted:raw.accepted,addressHash:raw.addressHash},address);
  return {...d,protocol:'ordinary_shipping_address_declaration_v1',declaredBy:actorUid,source,physicalSiteVerified:false,deliverabilityVerified:false};
}
export function shippingAddressAdmission(origin:OrdinaryAddressSource,destination:OrdinaryAddressSource):ShippingAddressAdmission {
  return {protocol:'ordinary_shipping_address_admission_v1',policyVersion:ORDINARY_ADDRESS_POLICY_VERSION,origin,destination};
}
/** Firestore may reorder maps. Reconstruct both native copies in canonical
 * order rather than making their serialization order an admission authority. */
export function qualifiedShippingAddressAdmission(origin:any,destination:any,raw:any,sellerId:string,buyerId:string):ShippingAddressAdmission {
  if(!exactKeys(raw,['protocol','policyVersion','origin','destination'])||raw.protocol!=='ordinary_shipping_address_admission_v1'||
    raw.policyVersion!==ORDINARY_ADDRESS_POLICY_VERSION)throw unknown();
  return shippingAddressAdmission(qualifiedOrdinaryAddressSource(origin,raw.origin,sellerId,'seller_declared'),
    qualifiedOrdinaryAddressSource(destination,raw.destination,buyerId,'buyer_declared'));
}
/** Wrap only new source fingerprints; the published legacy fingerprint
 * function and all native historical receipts remain unchanged. */
export function ordinaryShippingSourceHash(baseHash:string,admission:ShippingAddressAdmission):string {
  return digest([baseHash,admission.protocol,admission.policyVersion,admission.origin,admission.destination]);
}
export function ordinaryAddressUseSummary(admission:ShippingAddressAdmission) {
  const view=(s:OrdinaryAddressSource)=>({kind:s.kind,source:s.source,physicalSiteVerified:false as const,deliverabilityVerified:false as const});
  return {protocol:'ordinary_shipping_address_use_v1' as const,policyVersion:admission.policyVersion,origin:view(admission.origin),destination:view(admission.destination)};
}
export function shippingCoverageReadiness() {
  return {protocol:'shipping_coverage_readiness_v1' as const,qualification:'unknown' as const,policyReference:null,
    coverageVerified:false as const,providerContractVerified:false as const,newPaidShippingAdmitted:false as const};
}
/** Documentary account/service admission only; native item/address/value and
 * exact provider echoes are additionally required by the payable quote rail.
 * Existing effects and receipts are handled BEFORE this NEW-only guard. */
export function assertNewPaidShippingCoverageQualified():void {
  readShippingTransportPolicy();
}
