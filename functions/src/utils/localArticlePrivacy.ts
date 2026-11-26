/** Nonfinancial withdrawal authority: one native owner intention and its exact
 * private source capture. It can redact public projections, never settle money. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {isDeepStrictEqual} from 'node:util';
import {Timestamp} from 'firebase-admin/firestore';
import {FinancialRecoveryBlocked} from '../config/recoveryControl';
import {localCataloguePrivacyFields} from './localCatalogue';
import {articlePrivacyHash,privacyMarker} from './articlePrivacyContract';
import {disposedArticleEvidence} from './accountErasureArticleDisposal';

type Data=FirebaseFirestore.DocumentData;
type Write={method:'create'|'set'|'update'|'delete';args:any[]};
type Scope={ownerId:string;articleId:string;requestId:string;operationId:string};
const scopes=new AsyncLocalStorage<Scope>();
const own=(v:unknown,k:string)=>!!v&&Object.prototype.hasOwnProperty.call(v,k);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const fail=():never=>{throw new FinancialRecoveryBlocked('article_privacy_native_unqualified');};
// Native equality also distinguishes absent/undefined and unsupported SDK
// values; the historical receipt hash alone is not an equality predicate.
const same=(a:unknown,b:unknown)=>isDeepStrictEqual(a,b);
export function withArticlePrivacyScope<T>(ownerId:string,articleId:string,requestId:string,fn:()=>Promise<T>):Promise<T>{
  if(!id(ownerId)||!id(articleId)||!id(requestId))return fail();
  return scopes.run({ownerId,articleId,requestId,operationId:articlePrivacyHash([ownerId,articleId,requestId])},fn);
}
export const activeArticlePrivacyScope=()=>scopes.getStore()??null;
export function articlePrivacyEffectRef():string{
  const s=scopes.getStore();if(!s)return fail();return 'article_privacy_evidence/'+s.articleId;
}
/** Explicit known stock fields only. No field-name regex can preserve legacy
 * free text or bearer URLs in a publicly readable withdrawal tombstone. */
const retained=['sellerId','price','originalPrice','priceDropPercent','lastPriceDropAt','isSold','soldAt','activeTransactionId',
  'isHandDelivery','isShipping','packageSize','isPromoted','shopId','views','likes','favoritesCount','createdAt','updatedAt',
  'moderationStatus','publicationRequestHash','publicationRequestVersion','popularityScore','quantity','stock','ownerId',
  'inventoryUnit','inventoryAvailability','financialRecoveryWitness','localCatalogueWitness','phase1Contract'] as const;
const timeFields=new Set(['lastPriceDropAt','soldAt','createdAt','updatedAt']);
const numberFields=new Set(['price','originalPrice','priceDropPercent','views','likes','favoritesCount','popularityScore','quantity','stock']);
function safeWitness(v:any,articleId:string,local:boolean):boolean{
  return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===(local?
    'epoch,financialSettlement,installationId,nativeSourceHash,protocol,ref':'epoch,installationId,nativeSourceHash,protocol,ref')&&
    v.protocol===(local?'local_catalogue_source_v1':'financial_recovery_source_witness_v1')&&
    typeof v.installationId==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(v.installationId)&&
    typeof v.epoch==='string'&&/^[A-Za-z0-9_.:-]{1,180}$/.test(v.epoch)&&v.ref==='articles/'+articleId&&digest(v.nativeSourceHash)&&
    (!local||v.financialSettlement==='not_asserted');
}
export function privacyPublicArticle(article:Data,marker:Data):Data{
  if(!privacyMarker(marker)||!id(article.sellerId))return fail();
  const result:Data={};
  for(const field of retained){
    if(!own(article,field))continue;
    const v=article[field];let safe=false;
    if(timeFields.has(field))safe=v===null||v instanceof Timestamp;
    else if(numberFields.has(field))safe=typeof v==='number'&&Number.isFinite(v);
    else if(['isSold','isHandDelivery','isShipping','isPromoted'].includes(field))safe=typeof v==='boolean';
    else if(['sellerId','ownerId','shopId','activeTransactionId'].includes(field))safe=v===null||id(v);
    else if(field==='inventoryUnit')safe=v?.protocol==='seller_inventory_article_v1'&&digest(v.identity)&&Object.keys(v).sort().join(',')==='identity,protocol';
    else if(field==='inventoryAvailability')safe=v?.protocol==='inventory_article_availability_v1'&&['available','engaged','consumed'].includes(v.state)&&Object.keys(v).sort().join(',')==='protocol,state';
    else if(field==='financialRecoveryWitness'||field==='localCatalogueWitness'){
      result[field]=safeWitness(v,marker.articleId,field==='localCatalogueWitness')?v:null;continue;
    }else if(field==='publicationRequestHash')safe=digest(v);
    else if(field==='publicationRequestVersion')safe=Number.isSafeInteger(v)&&v>0;
    else if(field==='moderationStatus')safe=['approved','pending','rejected','blocked','hidden','needs_review'].includes(v);
    else if(field==='packageSize')safe=['small','medium','large','S','M','L'].includes(v);
    else if(field==='phase1Contract')safe=v==='phase1_v2';
    if(safe)result[field]=v;
  }
  return {...result,title:'Annonce retirée pour confidentialité',description:'',images:[],sellerName:'Utilisateur',sellerImage:null,
    isActive:false,privacyWithdrawal:marker};
}
export function privacyPublicPartyItem(item:Data,marker:Data):Data{
  if(!privacyMarker(marker)||item.articleId!==marker.articleId||!id(item.sellerId))return fail();
  const result:Data={};
  for(const key of ['partyId','articleId','sellerId','swapId','pendingSwapId','swappedWith'])if(own(item,key)&&(item[key]===null||id(item[key])))result[key]=item[key];
  for(const key of ['isSwapped','isPending'])if(own(item,key)&&typeof item[key]==='boolean')result[key]=item[key];
  for(const key of ['addedAt','swappedAt'])if(item[key] instanceof Timestamp)result[key]=item[key];
  if(typeof item.price==='number'&&Number.isFinite(item.price))result.price=item.price;
  return {...result,phase1Contract:'phase1_v2',title:'Annonce retirée pour confidentialité',imageUrl:null,sellerImage:null,sellerName:'Utilisateur',privacyWithdrawal:marker};
}
export function privacyArticleProof(ref:string,before:Data,after:Data):Data{
  return process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'?localCataloguePrivacyFields(ref,before,after):{};
}
const evidenceFields=new Set(('schemaVersion ownerId articleId requestId operationId payloadHash state sourceSnapshot sourceUpdatedAt sourceSnapshotHash '+
  'media assetScanComplete assetScanNeedsReview contractCaptureComplete affectedSwapIds publicProjectionScanComplete promotionPending createdAt updatedAt completedAt').split(' '));
function qualifiedEvidence(op:Data|undefined,articleId:string,owner?:string):op is Data{
  if(disposedArticleEvidence(op))return op!.articleId===articleId&&(!owner||op!.ownerId===owner);
  return !!op&&Object.keys(op).every(k=>evidenceFields.has(k))&&op.schemaVersion===1&&op.articleId===articleId&&id(op.ownerId)&&(!owner||op.ownerId===owner)&&id(op.requestId)&&
    op.operationId===articlePrivacyHash([op.ownerId,articleId,op.requestId])&&op.payloadHash===articlePrivacyHash([op.ownerId,articleId,op.requestId,'withdraw_public'])&&
    op.createdAt instanceof Timestamp&&op.sourceSnapshot?.sellerId===op.ownerId&&op.sourceUpdatedAt instanceof Timestamp&&
    op.updatedAt instanceof Timestamp&&['pending','needs_review','completed'].includes(op.state)&&
    ['assetScanComplete','contractCaptureComplete','publicProjectionScanComplete'].every(k=>typeof op[k]==='boolean')&&
    ['assetScanNeedsReview','promotionPending'].every(k=>!own(op,k)||typeof op[k]==='boolean')&&
    Array.isArray(op.affectedSwapIds)&&op.affectedSwapIds.length<=100&&op.affectedSwapIds.every(id)&&new Set(op.affectedSwapIds).size===op.affectedSwapIds.length&&
    Array.isArray(op.media)&&op.media.length<=200&&op.media.every((m:any)=>m&&digest(m.mediaId)&&['pending','copied','revoked','needs_review'].includes(m.state))&&
    (op.completedAt===null||op.completedAt instanceof Timestamp)&&
    (op.state!=='completed'||op.completedAt instanceof Timestamp&&op.assetScanComplete&&op.contractCaptureComplete&&op.publicProjectionScanComplete&&
      op.promotionPending===false&&op.media.every((m:any)=>m.state==='revoked'))&&
    op.sourceSnapshotHash===articlePrivacyHash([op.sourceSnapshot,op.sourceUpdatedAt]);
}
const remove=(v:Data,key:string)=>{const out={...v};delete out[key];return out;};
const currentMarkers=(root:string,value:Data|undefined):Data=>{
  const key=root==='transactions'?'articlePrivacyWithdrawal':'articlePrivacyWithdrawals';
  if(!own(value,key))return {};
  if(root==='transactions')return {[value?.articleId??'invalid']:value![key]};
  const markers=value![key];
  if(!markers||typeof markers!=='object'||Array.isArray(markers))return fail();
  return markers;
};
/** Every later local lifecycle preserves the exact documentary overlay and
 * validates its native owner evidence. The overlay is never financial proof. */
export async function assertArticlePrivacyMarkers(root:string,before:Data|undefined,after:Data|undefined,
  read:(path:string)=>Promise<Data|undefined>):Promise<void>{
  if(!['transactions','swaps'].includes(root))return;
  const key=root==='transactions'?'articlePrivacyWithdrawal':'articlePrivacyWithdrawals';
  if(own(before,key)!==own(after,key))return fail();
  const a=currentMarkers(root,before),b=currentMarkers(root,after);
  if(!same(a,b))return fail();
  for(const [articleId,marker] of Object.entries(b)){
    const op=await read('article_privacy_evidence/'+articleId);
    if(!privacyMarker(marker,articleId)||!qualifiedEvidence(op,articleId)||op.operationId!==marker.operationId||
      !same(op.createdAt,marker.withdrawnAt)||root==='transactions'&&op.ownerId!==after?.sellerId||
      root==='swaps'&&![after?.initiatorId,after?.receiverId].includes(op.ownerId))return fail();
  }
}
/** Public tombstones are irreversible outside the exact owner withdrawal.
 * Stock-neutral counters must not erase the barrier and permit republication. */
export async function assertArticlePrivacyPublicMarker(path:string,before:Data|undefined,after:Data|undefined,
  read:(path:string)=>Promise<Data|undefined>):Promise<void>{
  const [root,documentId,...rest]=path.split('/');
  if(!['articles','swapPartyItems'].includes(root)||rest.length)return;
  if(own(before,'privacyWithdrawal')!==own(after,'privacyWithdrawal')||!same(before?.privacyWithdrawal,after?.privacyWithdrawal))return fail();
  if(!own(after,'privacyWithdrawal'))return;
  const articleId=root==='articles'?documentId:after!.articleId,marker=after!.privacyWithdrawal;
  if(!id(articleId)||!privacyMarker(marker,articleId))return fail();
  const op=await read('article_privacy_evidence/'+articleId);
  if(!qualifiedEvidence(op,articleId,after!.sellerId)||op.operationId!==marker.operationId||!same(op.createdAt,marker.withdrawnAt))return fail();
}
/** Validate the WHOLE staged native transaction before any SDK write. This
 * authorizes exact documentary overlays even on legacy/paid sources without
 * adopting their value, changing contracts or trusting caller snapshots. */
export async function articlePrivacyNativePlan(database:FirebaseFirestore.Firestore,writes:readonly Write[],
  readSnapshot:(path:string)=>Promise<FirebaseFirestore.DocumentSnapshot>,project:(before:Data|undefined,write:Write)=>Data|undefined):Promise<Set<Write>>{
  const s=scopes.getStore(),allowed=new Set<Write>();if(!s||!writes.length)return allowed;
  const epath='article_privacy_evidence/'+s.articleId,apath='articles/'+s.articleId;
  const evidence=(await readSnapshot(epath)).data(),articleSnap=await readSnapshot(apath),article=articleSnap.data();
  if(!article||article.sellerId!==s.ownerId)return fail();
  const projected=new Map<string,Data|undefined>();
  for(const w of writes){const path=w.args[0]?.path;if(typeof path!=='string')return fail();
    const old=projected.has(path)?projected.get(path):(await readSnapshot(path)).data();projected.set(path,project(old,w));}
  const op=projected.has(epath)?projected.get(epath):evidence;
  if(!qualifiedEvidence(op,s.articleId,s.ownerId))return fail();
  if(op.operationId!==s.operationId){
    const cpath='article_privacy_commands/'+s.operationId;
    const c=projected.get(cpath);
    if(!evidence||!same(op,evidence)||article.privacyWithdrawal?.operationId!==op.operationId||writes.length!==1||writes[0].method!=='create'||writes[0].args[0].path!==cpath||
      !c||c.schemaVersion!==1||c.ownerId!==s.ownerId||c.articleId!==s.articleId||c.requestId!==s.requestId||c.operationId!==s.operationId||
      c.payloadHash!==articlePrivacyHash([s.ownerId,s.articleId,s.requestId,'withdraw_public'])||c.state!=='not_executed'||c.blockingOperationId!==op.operationId||
      c.noWithdrawalEffectsCommitted!==true||c.lateRequestBlocked!==true||!(c.committedAt instanceof Timestamp))return fail();
    allowed.add(writes[0]);return allowed;
  }
  if(!evidence){
    if(!same(op.sourceSnapshot,article)||!same(op.sourceUpdatedAt,articleSnap.updateTime)||article.privacyWithdrawal!=null||
      writes.filter(w=>w.args[0]?.path===epath).length!==1||!writes.some(w=>w.args[0]?.path===epath&&w.method==='create')||
      !writes.some(w=>w.args[0]?.path===apath)||op.state!=='pending'||op.completedAt!==null||op.assetScanComplete!==false||
      op.publicProjectionScanComplete!==false||!same(op.createdAt,op.updatedAt))return fail();
    if(!same(op.affectedSwapIds,writes.filter(w=>/^swaps\/[^/]+$/.test(w.args[0]?.path??'')).map(w=>w.args[0].id)))return fail();
  }else{
    if(!qualifiedEvidence(evidence,s.articleId,s.ownerId)||article.privacyWithdrawal?.operationId!==s.operationId||
      ['schemaVersion','ownerId','articleId','requestId','operationId','payloadHash','sourceSnapshot','sourceUpdatedAt','sourceSnapshotHash','createdAt','affectedSwapIds','contractCaptureComplete']
        .some(k=>!same(evidence[k],op[k])))return fail();
  }
  const marker={schemaVersion:1,articleId:s.articleId,operationId:s.operationId,withdrawnAt:op.createdAt};
  for(const w of writes){
    const path=w.args[0].path as string,parts=path.split('/'),before=(await readSnapshot(path)).data(),after=projected.get(path);
    if(path===epath){
      if(!after||!qualifiedEvidence(after,s.articleId,s.ownerId)||w.method==='delete')return fail();
    }else if(path===apath){
      if(!after||!before)return fail();
      const expected=privacyPublicArticle(before,marker),proof=privacyArticleProof(path,before,expected);
      if(!same(after,{...expected,...proof}))return fail();
    }else if(['search_index','embeddings'].includes(parts[0])&&parts.length===2&&parts[1]===s.articleId){if(w.method!=='delete')return fail();}
    else if(parts[0]==='transactions'&&parts.length===2){
      if(!before||!after||before.articleId!==s.articleId||before.sellerId!==s.ownerId||
        !same(remove(before,'articlePrivacyWithdrawal'),remove(after,'articlePrivacyWithdrawal'))||!same(after.articlePrivacyWithdrawal,marker)||
        own(before,'articlePrivacyWithdrawal')&&!same(before.articlePrivacyWithdrawal,marker))return fail();
    }else if(parts[0]==='swaps'&&parts.length===2){
      const items=[...(before?.initiatorItems??(before?.initiatorItem?[before.initiatorItem]:[])),...(before?.receiverItems??(before?.receiverItem?[before.receiverItem]:[]))];
      if(!before||!after||![before.initiatorId,before.receiverId].includes(s.ownerId)||!items.some(item=>item.articleId===s.articleId)||
        !same(remove(before,'articlePrivacyWithdrawals'),remove(after,'articlePrivacyWithdrawals'))||
        !same(after.articlePrivacyWithdrawals,{...(before.articlePrivacyWithdrawals??{}),[s.articleId]:marker})||
        own(before.articlePrivacyWithdrawals,s.articleId)&&!same(before.articlePrivacyWithdrawals[s.articleId],marker))return fail();
    }else if(parts[0]==='swapPartyItems'&&parts.length===2){
      if(!before||!after||before.articleId!==s.articleId||before.sellerId!==s.ownerId||!same(after,privacyPublicPartyItem(before,marker)))return fail();
      const capture=projected.get(epath+'/public_projection_evidence/'+articlePrivacyHash([path]))??
        (await readSnapshot(epath+'/public_projection_evidence/'+articlePrivacyHash([path]))).data();
      if(!capture||capture.operationId!==s.operationId||capture.sourcePath!==path||capture.sourceSnapshotHash!==articlePrivacyHash([capture.sourceSnapshot,capture.sourceUpdatedAt]))return fail();
    }else if(parts[0]==='avis'&&parts.length===2){
      if(!before||!after||!same(remove(before,'articleTitle'),remove(after,'articleTitle'))||after.articleTitle!=='Annonce retirée pour confidentialité'||
        !(before.articleId===s.articleId||before.transactionType==='swap'&&op.affectedSwapIds?.includes(before.transactionId)))return fail();
      const capture=projected.get(epath+'/public_projection_evidence/'+articlePrivacyHash([path]))??
        (await readSnapshot(epath+'/public_projection_evidence/'+articlePrivacyHash([path]))).data();
      if(!capture||capture.operationId!==s.operationId||!same(capture.sourceSnapshot,before)&&!same(after,before))return fail();
    }else if(parts[0]==='article_privacy_evidence'&&parts[1]===s.articleId&&parts[2]==='public_projection_evidence'&&parts.length===4){
      if(!after||w.method!=='create'||before||after.operationId!==s.operationId||after.articleId!==s.articleId||
        typeof after.sourcePath!=='string'||!/^(avis|swapPartyItems)\/[^/]+$/.test(after.sourcePath)||parts[3]!==articlePrivacyHash([after.sourcePath])||
        after.sourceSnapshotHash!==articlePrivacyHash([after.sourceSnapshot,after.sourceUpdatedAt])||
        !same(after.sourceSnapshot,(await readSnapshot(after.sourcePath)).data())||
        !same(after.sourceUpdatedAt,(await readSnapshot(after.sourcePath)).updateTime))return fail();
    }else return fail();
    allowed.add(w);
  }
  return allowed;
}
