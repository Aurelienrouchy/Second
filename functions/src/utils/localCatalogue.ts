/** Initial catalogue observations are not financial reconciliation. Only the
 * inventory planner may admit an existing, natively available legacy listing. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {FieldValue,Timestamp} from 'firebase-admin/firestore';
import {localOperationAllows} from './localAgreement';
import {FinancialRecoveryBlocked} from '../config/recoveryControl';

type Data=FirebaseFirestore.DocumentData;
export type LocalCatalogueDomain='inventory_article'|'inventory_unit';
type Control={installationId:string;epoch:string;mode:string;financialEnvironment:string;previousEpoch:string|null};
type Scope={operation:string;control:Control|null};
type Transaction={adoptions:Map<string,string>};
export type LocalCatalogueWitness={protocol:'local_catalogue_source_v1';installationId:string;epoch:string;ref:string;
  nativeSourceHash:string;financialSettlement:'not_asserted'};
const scopes=new AsyncLocalStorage<Scope>(),transactions=new AsyncLocalStorage<Transaction>();
const own=(v:unknown,k:string):boolean=>!!v&&Object.prototype.hasOwnProperty.call(v,k);
const fail=():never=>{throw new FinancialRecoveryBlocked('local_catalogue_unqualified');};
const allowed=(operation:string)=>localOperationAllows(operation)||[
  'callable/products.createArticle','callable/products.updateArticle','callable/products.toggleArticleSold',
  'callable/products.incrementProductView','callable/articlePrivacy.withdrawArticlePrivacy'].includes(operation);
export function withLocalCatalogueScope<T>(operation:string,fn:()=>Promise<T>):Promise<T>{
  return process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'&&allowed(operation)?scopes.run({operation,control:null},fn):fn();
}
export function bindLocalCatalogueControl(control:Control):void{const s=scopes.getStore();if(s)s.control={
  installationId:control.installationId,epoch:control.epoch,mode:control.mode,financialEnvironment:control.financialEnvironment,previousEpoch:control.previousEpoch};}
export function withLocalCatalogueTransaction<T>(fn:()=>Promise<T>):Promise<T>{return transactions.run({adoptions:new Map()},fn);}
export function activeLocalCatalogueScope():boolean{return !!scopes.getStore();}
function qualified():Control{
  const s=scopes.getStore(),c=s?.control;
  if(!s||!allowed(s.operation)||!transactions.getStore()||!c||c.mode!=='normal'||c.financialEnvironment!=='unconfigured'||
    c.previousEpoch!==null||process.env.FINANCIAL_RECOVERY_ENVIRONMENT!=='unconfigured')return fail();
  return c;
}
function domainAt(ref:string):LocalCatalogueDomain|null{
  return /^articles\/[^/]+$/.test(ref)?'inventory_article':/^inventory_units\/unit_[a-f0-9]{64}$/.test(ref)?'inventory_unit':null;
}
export function localCatalogueDomainAt(ref:string):LocalCatalogueDomain|null{return domainAt(ref);}
/** Absence of a provider is never permission to erase or supersede a present
 * financial marker, including null/invalid markers and stock-neutral writes. */
export function assertCatalogueFinancialIsolation(ref:string,before:Data|undefined,after:Data|undefined):void{
  if(domainAt(ref)&&process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'&&
    (own(before,'financialRecoveryWitness')||own(after,'financialRecoveryWitness')))return fail();
}
function canonical(v:any):any{
  if(v instanceof Timestamp)return {seconds:v.seconds,nanoseconds:v.nanoseconds};
  if(v===undefined||v instanceof FieldValue||typeof v==='number'&&!Number.isFinite(v))return fail();
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==='object'){
    if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))return fail();
    return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));
  }
  return v;
}
/** Exact inventory authority, including unknown stock/reservation extensions,
 * is bound. Listing content has its own saleDeclaration and moderation guards;
 * view/like counters and root updatedAt cannot become stock authority. */
export function localCatalogueSourceHash(domain:LocalCatalogueDomain,ref:string,value:Data):string{
  if(domainAt(ref)!==domain||!value||Array.isArray(value))return fail();
  const keys=Object.keys(value).filter(k=>!['localCatalogueWitness','financialRecoveryWitness','updatedAt'].includes(k)&&
    (domain==='inventory_unit'||/inventory|stock|quantity|transaction|reservation|reserved|swap|trade|supersed|sold|ArticleIds?$|^saleUnit$|^status$|^state$|^availability$|^isActive$|^sellerId$|^ownerId$/i.test(k))).sort();
  return createHash('sha256').update(JSON.stringify(['local_catalogue_native_source_v1',domain,ref,
    keys.map(k=>[k,canonical(value[k])])])).digest('hex');
}
const id=(v:unknown):v is string=>typeof v==='string'&&!!v&&v.length<=200&&!v.includes('/');
function shape(domain:LocalCatalogueDomain,value:Data):boolean{
  if(domain==='inventory_article')return id(value.sellerId)&&(!own(value,'quantity')||value.quantity===1)&&(!own(value,'stock')||value.stock===1)&&
    (!own(value,'ownerId')||value.ownerId===value.sellerId)&&
    (!own(value,'isSold')||typeof value.isSold==='boolean')&&(!own(value,'isActive')||typeof value.isActive==='boolean')&&
    (value.activeTransactionId==null||id(value.activeTransactionId))&&(!own(value,'inventoryUnit')||
      value.inventoryUnit?.protocol==='seller_inventory_article_v1'&&/^[a-f0-9]{64}$/.test(value.inventoryUnit.identity??'')&&
      Object.keys(value.inventoryUnit).sort().join(',')==='identity,protocol');
  return value.protocol==='seller_inventory_unit_v1'&&id(value.ownerId)&&id(value.originArticleId)&&
    Number.isSafeInteger(value.version)&&value.version>=1&&Array.isArray(value.memberArticleIds)&&value.memberArticleIds.length>0&&
    value.memberArticleIds.length<=20&&value.memberArticleIds.every(id)&&new Set(value.memberArticleIds).size===value.memberArticleIds.length&&
    JSON.stringify(value.memberArticleIds)===JSON.stringify([...value.memberArticleIds].sort())&&value.memberArticleIds.includes(value.originArticleId)&&
    ['available','engaged','consumed'].includes(value.state);
}
function identity(domain:LocalCatalogueDomain,value:Data):unknown{
  return domain==='inventory_article'?[value.sellerId,own(value,'ownerId')?value.ownerId:null,value.inventoryUnit??null]:[value.ownerId,value.originArticleId,value.createdAt];
}
export function localCatalogueWitnessMatches(domain:LocalCatalogueDomain,ref:string,value:Data,control=qualified()):boolean{
  const w=value.localCatalogueWitness;
  return shape(domain,value)&&!own(value,'financialRecoveryWitness')&&!!w&&typeof w==='object'&&!Array.isArray(w)&&
    Object.keys(w).sort().join(',')==='epoch,financialSettlement,installationId,nativeSourceHash,protocol,ref'&&
    w.protocol==='local_catalogue_source_v1'&&w.installationId===control.installationId&&w.epoch===control.epoch&&
    w.ref===ref&&w.financialSettlement==='not_asserted'&&w.nativeSourceHash===localCatalogueSourceHash(domain,ref,value);
}
/** Called only after inventoryUnit's owner/revision/link/history checks. The
 * adapter rereads this exact before-state before forwarding any native write.
 * A retry has a new transaction scope and cannot reuse this admission. */
export function authorizeLocalCatalogueAdoption(ref:string,before:Data):void{
  qualified();
  if(domainAt(ref)!=='inventory_article'||!shape('inventory_article',before)||before.isSold===true||
    ['inventoryUnit','financialRecoveryWitness','localCatalogueWitness'].some(k=>own(before,k)))return fail();
  transactions.getStore()!.adoptions.set(ref,localCatalogueSourceHash('inventory_article',ref,before));
}
function transition(domain:LocalCatalogueDomain,ref:string,before:Data|undefined,after:Data,provedAbsent:boolean):void{
  const control=qualified();
  if(!shape(domain,after)||own(after,'financialRecoveryWitness'))return fail();
  if(!before){if(!provedAbsent)return fail();return;}
  if(own(before,'localCatalogueWitness')){
    if(!localCatalogueWitnessMatches(domain,ref,before,control)||
      JSON.stringify(canonical(identity(domain,before)))!==JSON.stringify(canonical(identity(domain,after))))return fail();
    if(domain==='inventory_unit'&&localCatalogueSourceHash(domain,ref,before)!==localCatalogueSourceHash(domain,ref,after)&&after.version!==before.version+1)return fail();
    return;
  }
  if(domain!=='inventory_article'||own(before,'financialRecoveryWitness')||
    transactions.getStore()!.adoptions.get(ref)!==localCatalogueSourceHash(domain,ref,before)||before.sellerId!==after.sellerId||
    !after.inventoryUnit)return fail();
  // The initial stock plan may add its individual declaration, normalize an
  // absent single-unit quantity and change listing visibility. It cannot use
  // adoption to consume/release/reserve the item or replace a native link.
  const stable=(v:Data)=>{const out={...v};for(const k of ['inventoryUnit','isActive','quantity','stock','saleUnit'])delete out[k];return out;};
  if(localCatalogueSourceHash(domain,ref,stable(before))!==localCatalogueSourceHash(domain,ref,stable(after)))return fail();
}
export function localCatalogueFields(domain:LocalCatalogueDomain,ref:string,before:Data|undefined,after:Data,provedAbsent=false):LocalCatalogueWitness{
  transition(domain,ref,before,after,provedAbsent);
  const c=qualified();
  return {protocol:'local_catalogue_source_v1',installationId:c.installationId,epoch:c.epoch,ref,
    nativeSourceHash:localCatalogueSourceHash(domain,ref,after),financialSettlement:'not_asserted'};
}
/** Only the dedicated native privacy transaction may refresh a valid local
 * stock proof after removing its public visibility. Unknown stock extensions
 * are preserved privately and leave a closed marker, never new authority. */
export function localCataloguePrivacyFields(ref:string,before:Data,after:Data):Data{
  qualified();
  if(scopes.getStore()!.operation!=='callable/articlePrivacy.withdrawArticlePrivacy')return fail();
  if(!own(before,'localCatalogueWitness'))return {};
  const omit=(v:Data)=>{const out={...v};delete out.isActive;return out;};
  if(!localCatalogueWitnessMatches('inventory_article',ref,before)||
    localCatalogueSourceHash('inventory_article',ref,omit(before))!==localCatalogueSourceHash('inventory_article',ref,omit(after)))
    return {localCatalogueWitness:null};
  return {localCatalogueWitness:localCatalogueFields('inventory_article',ref,before,after)};
}
/** Hiding an unadopted listing does not release any reservation or certify its
 * history. No witness is minted, and no later sale can rely on this action. */
export function localCatalogueRestrictionOnly(ref:string,before:Data|undefined,after:Data|undefined):boolean{
  qualified();
  if(scopes.getStore()!.operation!=='callable/products.updateArticle'||domainAt(ref)!=='inventory_article'||!before||!after||
    !id(before.sellerId)||before.sellerId!==after.sellerId||after.isActive!==false||
    ['inventoryUnit','localCatalogueWitness','financialRecoveryWitness'].some(k=>own(before,k)||own(after,k)))return false;
  const omit=(v:Data)=>{const out={...v};delete out.isActive;return out;};
  return localCatalogueSourceHash('inventory_article',ref,omit(before))===localCatalogueSourceHash('inventory_article',ref,omit(after));
}
export function assertLocalCatalogueMutation(ref:string,before:Data|undefined,after:Data|undefined):void{
  const domain=domainAt(ref);if(!domain)return;
  assertCatalogueFinancialIsolation(ref,before,after);
  const marked=own(before,'localCatalogueWitness')||own(after,'localCatalogueWitness');
  // Unchanged legacy view/like updates do not adopt a source. Any stock change
  // or present local proof must go through the catalogue plan and exact proof.
  if(!marked&&before&&after&&localCatalogueSourceHash(domain,ref,before)===localCatalogueSourceHash(domain,ref,after))return;
  if(!marked&&localCatalogueRestrictionOnly(ref,before,after))return;
  if(!after)return fail();
  transition(domain,ref,before,after,!before);
  if(!localCatalogueWitnessMatches(domain,ref,after))return fail();
}
