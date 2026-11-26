import { FinancialRecoveryBlocked } from "./financialRecoveryInterlock";
import { inventoryRecoverySourceFields } from './financialRecoverySources';
import {assertFinancialRecoveryEffect} from './financialRecoveryInterlock';
import {authorizeLocalCatalogueAdoption,localCatalogueSourceHash} from './localCatalogue';
/** Seller-declared identity shared by aliases. This is not physical recognition.
 * All reads are planned before the caller's writes; the private unit is authority. */
import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db, FieldValue} from '../config/firebase';
import {assertArticleNotSwapEngaged} from './articleSwapEngagement';
import {cashReservationCanBeReused} from './cashMeetup';
import {hasActiveBankDispute} from './bankDispute';
import {hasUnsettledRefund, refundHasPreSendInventoryProof, refundInventoryRequiresReview} from './refundState';
import {returnToSenderBlocksProgress} from '../shared/returnToSenderGuard';
import {lateTransportRecoveryOwnReviewQualified} from './lateTransportRecovery';

const UNIT = 'seller_inventory_unit_v1';
const LIMIT = 20;
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const refuse = (reason = 'inventory_unit_review_required') => new HttpsError('failed-precondition',
  'L’identité ou la disponibilité de cet exemplaire doit être vérifiée avant une nouvelle opération.', {reason, physicalIdentityVerified:false});
export type InventoryEngagement = {kind:'purchase'|'swap'|'manual_sale';id:string;sourceArticleId:string};
export type InventoryPlan = {commit:()=>void; commitment:Record<string,unknown>};
type UnitRead = {ref:FirebaseFirestore.DocumentReference;value:FirebaseFirestore.DocumentData;
  articles:Map<string,FirebaseFirestore.DocumentData>};
export type InventoryDeclaration = {kind:'new_unit'}|{kind:'same_unit';articleId:string};
export function inventoryDeclaration(value: unknown): InventoryDeclaration {
  const v = value as Record<string,unknown>;
  if (!v || typeof v !== 'object' || Array.isArray(v) ||
      !(v.kind === 'new_unit' && Object.keys(v).join(',') === 'kind' || v.kind === 'same_unit' && id(v.articleId) && Object.keys(v).sort().join(',') === 'articleId,kind'))
    throw refuse('inventory_unit_declaration_required');
  return v as InventoryDeclaration;
}
const unitId = (owner:string,origin:string) => 'unit_'+digest([UNIT,owner,origin]);
const same = (a:any,b:InventoryEngagement) => a?.kind===b.kind && a.id===b.id && a.sourceArticleId===b.sourceArticleId;
const articleIdentity = (owner:string,articleId:string) => digest(['seller_inventory_article_v1',owner,articleId]);
const linkRef = (owner:string,articleId:string) => db.collection('inventory_units').doc('article_'+articleIdentity(owner,articleId));
function linkMatches(articleId:string,a:any,link:any,owner:string,unit?:string) {
  return a?.sellerId===owner && a.inventoryUnit?.protocol==='seller_inventory_article_v1' &&
    a.inventoryUnit.identity===articleIdentity(owner,articleId) && Object.keys(a.inventoryUnit).sort().join(',')==='identity,protocol' &&
    link?.protocol==='seller_inventory_article_link_v1' && link.ownerId===owner && link.articleId===articleId &&
    link.identity===a.inventoryUnit.identity && /^unit_[a-f0-9]{64}$/.test(link.unitId??'') && native(link.declaredAt) && (!unit||link.unitId===unit);
}
async function read(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData):Promise<UnitRead> {
  const link=(await tx.get(linkRef(article.sellerId,articleId))).data();
  if (!id(article.sellerId) || !link || !linkMatches(articleId,article,link,article.sellerId)) throw refuse('inventory_unit_declaration_required');
  const ref=db.collection('inventory_units').doc(link.unitId), value=(await tx.get(ref)).data();
  if (!value || value.protocol!==UNIT || value.ownerId!==article.sellerId || !id(value.originArticleId) || ref.id!==unitId(value.ownerId,value.originArticleId) ||
      !Number.isSafeInteger(value.version) || value.version<1 || !Array.isArray(value.memberArticleIds) || value.memberArticleIds.length<1 || value.memberArticleIds.length>LIMIT ||
      value.memberArticleIds.some((v:unknown)=>!id(v)) || new Set(value.memberArticleIds).size!==value.memberArticleIds.length ||
      JSON.stringify(value.memberArticleIds)!==JSON.stringify([...value.memberArticleIds].sort()) || !value.memberArticleIds.includes(articleId) ||
      !native(value.createdAt) || !native(value.updatedAt) || !['available','engaged','consumed'].includes(value.state) ||
      (value.state==='available' ? value.engagement!==null : !value.engagement || !['purchase','swap','manual_sale'].includes(value.engagement.kind) ||
        !id(value.engagement.id) || !value.memberArticleIds.includes(value.engagement.sourceArticleId) || !native(value.engagement.recordedAt))) throw refuse();
  const articles=new Map<string,FirebaseFirestore.DocumentData>();
  for(const member of value.memberArticleIds) {
    const v=member===articleId?article:(await tx.get(db.collection('articles').doc(member))).data();
    const memberLink=member===articleId?link:(await tx.get(linkRef(value.ownerId,member))).data();
    if(!v || !linkMatches(member,v,memberLink,value.ownerId,ref.id))throw refuse();articles.set(member,v);
  }
  return {ref,value,articles};
}
const revision = (articleId:string,article:any,u:UnitRead|null) => digest([UNIT,articleId,article.sellerId,article.inventoryUnit??null,
  u?{id:u.ref.id,version:u.value.version,members:u.value.memberArticleIds,state:u.value.state,engagement:u.value.engagement}:null]);
export async function inventoryUnitView(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData) {
  let u:UnitRead|null=null, qualification='legacy_missing';
  if(Object.prototype.hasOwnProperty.call(article,'inventoryUnit'))try{u=await read(tx,articleId,article);qualification='native_current';}catch(e){
      if (e instanceof FinancialRecoveryBlocked) throw e;if(!(e instanceof HttpsError))throw e;qualification='review_required';}
  else if((await tx.get(linkRef(article.sellerId,articleId))).exists)qualification='review_required';
  return {protocol:'article_inventory_unit_view_v1',articleId,qualification,revision:revision(articleId,article,u),inventoryUnitId:u?.ref.id??null,
    memberArticleIds:u?.value.memberArticleIds??[],availability:u?.value.state??'unknown'};
}
export async function inventoryUnitReceipt(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData) {
  const link=(await tx.get(linkRef(article.sellerId,articleId))).data(),r=link?.receipt;
  return link && linkMatches(articleId,article,link,article.sellerId) && r?.protocol==='article_inventory_unit_receipt_v1' && r.articleId===articleId && r.ownerId===article.sellerId &&
    r.unitId===link.unitId && /^[a-f0-9]{64}$/.test(r.requestHash??'') &&
    (r.previousRevision===null || /^[a-f0-9]{64}$/.test(r.previousRevision??'')) && native(r.recordedAt)
    ?{protocol:r.protocol,articleId,unitId:r.unitId,requestHash:r.requestHash,previousRevision:r.previousRevision,recordedAt:r.recordedAt.toDate().toISOString()}:null;
}
/** Explicit adoption never rewrites an old agreement or fabricates its identity. */
async function legacyAvailable(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData) {
  if(article.isSold===true || article.activeTransactionId!=null && !id(article.activeTransactionId))throw refuse('inventory_unit_legacy_history_required');
  await assertArticleNotSwapEngaged(tx,articleId);
  const rows=await tx.get(db.collection('transactions').where('articleId','==',articleId).limit(101));
  if(rows.size>=101)throw refuse('inventory_unit_legacy_history_required');
  const history:FirebaseFirestore.DocumentSnapshot[]=[...rows.docs];
  if(article.activeTransactionId!=null && !history.some(row=>row.id===article.activeTransactionId)) {
    const linked=await tx.get(db.collection('transactions').doc(article.activeTransactionId));
    if(!linked.exists || linked.data()?.articleId!==articleId)throw refuse('inventory_unit_legacy_history_required');history.push(linked);
  }
  for(const row of history) {
    const order=row.data()!;
    const physical=await lateTransportRecoveryOwnReviewQualified(tx,row.id,order,article);
    const cashReleased=await cashReservationCanBeReused(tx,row.id,order);
    // Defer this existing financial reader to avoid an initialization cycle
    // (refund uses articleReservation, which uses this unit helper).
    const cancelled=order.status==='cancelled' && await (await import('./refund')).readPendingCancellationReceipt(tx,row.id,order);
    if(order.sellerId!==article.sellerId || returnToSenderBlocksProgress(order) || hasActiveBankDispute(order) || hasUnsettledRefund(order) ||
        refundInventoryRequiresReview(order,physical) || !(['cancelled','refunded'].includes(order.status) || cashReleased) ||
        !(physical || refundHasPreSendInventoryProof(order) || cashReleased || cancelled)) throw refuse('inventory_unit_legacy_history_required');
  }
}
/** Declaration read plan. Existing native receipts are recognized by products FIRST. */
export async function planInventoryDeclaration(tx:FirebaseFirestore.Transaction,owner:string,articleId:string,article:FirebaseFirestore.DocumentData,
  choice:unknown,requestHash:string,expectedRevision:string|null,isNew=false) {
  return planInventoryBinding(tx,owner,articleId,article,inventoryDeclaration(choice),requestHash,expectedRevision,isNew);
}
/** A newly published listing gets one internal stock record. This creates no
 * claim that it is physically distinct from another listing, and links no
 * other listing. There is no seller questionnaire or fabricated declaration. */
export async function planNewArticleInventory(tx:FirebaseFirestore.Transaction,owner:string,articleId:string,
  article:FirebaseFirestore.DocumentData,requestHash:string) {
  return planInventoryBinding(tx,owner,articleId,article,null,requestHash,null,true);
}
/** Existing stock stays authoritative. A legacy listing without a stock
 * record can acquire its own record only after its native history is clear. */
export async function planArticleInventoryForEdit(tx:FirebaseFirestore.Transaction,owner:string,articleId:string,
  article:FirebaseFirestore.DocumentData,requestHash:string) {
  if (Object.prototype.hasOwnProperty.call(article, 'inventoryUnit')) {
    await assertInventoryAvailable(tx,articleId,article);
    return null;
  }
  return planInventoryBinding(tx,owner,articleId,article,null,requestHash,revision(articleId,article,null));
}
async function planInventoryBinding(tx:FirebaseFirestore.Transaction,owner:string,articleId:string,article:FirebaseFirestore.DocumentData,
  c:InventoryDeclaration|null,requestHash:string,expectedRevision:string|null,isNew=false) {
  const current=Object.prototype.hasOwnProperty.call(article,'inventoryUnit')?await read(tx,articleId,article):null;
  const articleLinkRef=linkRef(owner,articleId),previousLink=(await tx.get(articleLinkRef)).data();
  if(!current&&previousLink)throw refuse();
  if(!isNew && (typeof expectedRevision!=='string' || !/^[a-f0-9]{64}$/.test(expectedRevision)))throw refuse('inventory_unit_observation_required');
  if(!isNew && revision(articleId,article,current)!==expectedRevision)throw new HttpsError('aborted','L’exemplaire a changé ; relisez-le.',{reason:'inventory_unit_observation_stale'});
  if(article.sellerId!==owner || current && current.value.state!=='available')throw refuse('inventory_unit_engaged');
  if(!isNew)await legacyAvailable(tx,articleId,article);
  let target:UnitRead|null=null;
  if(c?.kind==='same_unit') {
    if(c.articleId===articleId)throw refuse('inventory_unit_reference_invalid');
    const refArticle=(await tx.get(db.collection('articles').doc(c.articleId))).data();
    if(!refArticle || refArticle.sellerId!==owner)throw refuse('inventory_unit_reference_invalid');
    target=await read(tx,c.articleId,refArticle);
    if(target.value.state!=='available')throw refuse('inventory_unit_engaged');
    for(const [member,data] of target.articles)await legacyAvailable(tx,member,data);
  } else if(current?.ref.id===unitId(owner,articleId))target=current;
  const ref=target?.ref??db.collection('inventory_units').doc(unitId(owner,articleId));
  // Identity is immutable after its first native declaration. This avoids an
  // empty orphan group and keeps all existing aliases on their declared unit.
  if(current && current.ref.id!==ref.id)throw refuse('inventory_unit_identity_already_declared');
  const targetSnapshot = !target ? await tx.get(ref) : null;
  if(targetSnapshot?.exists)throw refuse();
  const members=[...new Set([...(target?.value.memberArticleIds??[]),articleId])].sort();
  if(members.length>LIMIT)throw refuse('inventory_unit_member_limit');
  const now=Timestamp.now(), identity=articleIdentity(owner,articleId),marker={protocol:'seller_inventory_article_v1',identity};
  const link={protocol:'seller_inventory_article_link_v1',unitId:ref.id,ownerId:owner,articleId,identity,declaredAt:now};
  const receipt={protocol:'article_inventory_unit_receipt_v1',articleId,ownerId:owner,unitId:ref.id,requestHash,previousRevision:expectedRevision,recordedAt:now};
  const value={protocol:UNIT,ownerId:owner,originArticleId:target?.value.originArticleId??articleId,memberArticleIds:members,
    version:(target?.value.version??0)+1,state:'available',engagement:null,createdAt:target?.value.createdAt??now,updatedAt:now};
  const unitFields=await inventoryRecoverySourceFields('inventory_unit',ref.path,target?.value,value,targetSnapshot??undefined);
  const articleSnapshot=await tx.get(db.collection('articles').doc(articleId));
  const nextArticle={...article,inventoryUnit:marker};
  if(!isNew&&process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'&&!Object.prototype.hasOwnProperty.call(article,'localCatalogueWitness')){
    if(!articleSnapshot.exists||localCatalogueSourceHash('inventory_article',articleSnapshot.ref.path,articleSnapshot.data()!)!==
      localCatalogueSourceHash('inventory_article',articleSnapshot.ref.path,article))throw refuse('inventory_unit_observation_stale');
    await assertFinancialRecoveryEffect('firestore_commit',{refs:[articleSnapshot.ref.path]});
    authorizeLocalCatalogueAdoption(articleSnapshot.ref.path,articleSnapshot.data()!);
  }
  const articleFields=await inventoryRecoverySourceFields('inventory_article',articleSnapshot.ref.path,articleSnapshot.data(),nextArticle,articleSnapshot);
  return {articleFields:{inventoryUnit:marker,...articleFields},commit:()=>{
    const savedLink={...link,receipt};if(previousLink)tx.update(articleLinkRef,savedLink);else tx.create(articleLinkRef,savedLink);
    if(target)tx.update(ref,{...value,...unitFields});else tx.create(ref,{...value,...unitFields});
  }};
}
const membershipHash = (u:UnitRead) => digest(['inventory_unit_membership_v1',u.ref.id,u.value.ownerId,u.value.memberArticleIds]);
const commitment = (u:UnitRead,e:InventoryEngagement,version:number) => ({protocol:'inventory_unit_commitment_v2',unitId:u.ref.id,ownerId:u.value.ownerId,
  membershipHash:membershipHash(u),membershipRevision:version,...e});
async function plan(tx:FirebaseFirestore.Transaction,u:UnitRead,e:InventoryEngagement,state:'engaged'|'consumed'|'available'):Promise<InventoryPlan> {
  const version=u.value.version+1, now=Timestamp.now();
  const unitUpdate={state,engagement:state==='available'?null:{...e,recordedAt:u.value.engagement?.recordedAt??now},version,updatedAt:now};
  const unitFields=await inventoryRecoverySourceFields('inventory_unit',u.ref.path,u.value,{...u.value,...unitUpdate});
  const articleUpdates: {ref:FirebaseFirestore.DocumentReference;fields:Record<string,unknown>}[]=[];
  for(const [articleId,article] of u.articles){
    const fields={isSold:state!=='available',inventoryAvailability:{protocol:'inventory_article_availability_v1',state},
      ...(state==='engaged'&&e.kind==='purchase'?{activeTransactionId:e.id}:{}),
      ...(state==='consumed'&&e.kind==='swap'?{isActive:false}:{}),...(state==='available'&&article.activeTransactionId===e.id?{activeTransactionId:FieldValue.delete(),soldAt:FieldValue.delete()}:{}),updatedAt:now};
    const next={...article,...fields};if(state==='available'&&article.activeTransactionId===e.id){delete next.activeTransactionId;delete next.soldAt;}
    const ref=db.collection('articles').doc(articleId),proof=await inventoryRecoverySourceFields('inventory_article',ref.path,article,next);
    articleUpdates.push({ref,fields:{...fields,...proof}});
  }
  return {commitment:commitment(u,e,version),commit:()=>{
    tx.update(u.ref,{...unitUpdate,...unitFields});
    for(const article of articleUpdates)tx.update(article.ref,article.fields);
  }};
}
export async function assertInventoryAvailable(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData) {
  const u=await read(tx,articleId,article);if(u.value.state!=='available')throw refuse('inventory_unit_engaged');return u.ref.id;
}
export async function planInventoryAcquire(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData,e:InventoryEngagement):Promise<InventoryPlan> {
  const u=await read(tx,articleId,article);if(u.value.state!=='available')throw refuse('inventory_unit_engaged');
  for(const data of u.articles.values())if(data.isSold===true)throw refuse('inventory_unit_engaged');
  return plan(tx,u,e,'engaged');
}
export async function inventoryEngagementMatches(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData,e:InventoryEngagement,capture?:any) {
  if(!Object.prototype.hasOwnProperty.call(article,'inventoryUnit'))return capture==null;
  try{const u=await read(tx,articleId,article);return u.value.state!=='available' && same(u.value.engagement,e) &&
    (!capture || ['inventory_unit_commitment_v1','inventory_unit_commitment_v2'].includes(capture.protocol) && capture.unitId===u.ref.id && capture.ownerId===u.value.ownerId &&
      capture.membershipRevision===u.value.version && same(capture,e) && (capture.protocol==='inventory_unit_commitment_v2'
        ? capture.membershipHash===membershipHash(u) && !Object.prototype.hasOwnProperty.call(capture,'memberArticleIds')
        : JSON.stringify(capture.memberArticleIds)===JSON.stringify(u.value.memberArticleIds)));
  }catch(error){
      if (error instanceof FinancialRecoveryBlocked) throw error;if(error instanceof HttpsError)return false;throw error;}
}
export async function planInventoryFinish(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData,e:InventoryEngagement,
  consume=false):Promise<InventoryPlan|null> {
  if(!Object.prototype.hasOwnProperty.call(article,'inventoryUnit'))return null;
  try{const u=await read(tx,articleId,article);if(u.value.state!=='engaged'||!same(u.value.engagement,e))return null;return plan(tx,u,e,consume?'consumed':'available');}
  catch(error){
      if (error instanceof FinancialRecoveryBlocked) throw error;if(error instanceof HttpsError)return null;throw error;}
}
export async function planInventoryManualSale(tx:FirebaseFirestore.Transaction,articleId:string,article:FirebaseFirestore.DocumentData,requestId:string,sold:boolean):Promise<InventoryPlan> {
  const u=await read(tx,articleId,article);
  if(sold) {if(u.value.state!=='available')throw refuse('inventory_unit_engaged');return plan(tx,u,{kind:'manual_sale',id:requestId,sourceArticleId:articleId},'consumed');}
  if(u.value.state==='available')return plan(tx,u,{kind:'manual_sale',id:requestId,sourceArticleId:articleId},'available');
  const e=u.value.engagement as InventoryEngagement;
  if(e.kind==='manual_sale' && u.value.state==='consumed')return plan(tx,u,e,'available');
  if(e.kind==='purchase') {
    const order=(await tx.get(db.collection('transactions').doc(e.id))).data(), source=u.articles.get(e.sourceArticleId);
    const physical=order&&source?await lateTransportRecoveryOwnReviewQualified(tx,e.id,order,source):false;
    if(order && source && order.articleId===e.sourceArticleId && order.sellerId===u.value.ownerId && !hasActiveBankDispute(order) && !hasUnsettledRefund(order) &&
        !returnToSenderBlocksProgress(order) && !refundInventoryRequiresReview(order,physical) &&
        (physical || refundHasPreSendInventoryProof(order) || await cashReservationCanBeReused(tx,e.id,order)))return plan(tx,u,e,'available');
  }
  throw refuse('inventory_unit_physical_recovery_required');
}
