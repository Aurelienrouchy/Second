/** Bounded pages over one native Firestore point, rather than a bounded year.
 * Current identity/role authority never comes from this historical snapshot.
 * The captured native source set is not a certification of the legal universe. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportHash,supportObject,supportSourceHash} from './supportRequest';
import {taxId,taxHash,taxCents,taxCalendar,taxSellerRef,readSellerTaxCaptureEntry,SELLER_TAX_POLICY_VERSION,type SellerTaxSource} from './sellerTaxLedger';
type Data=FirebaseFirestore.DocumentData;
export type SellerTaxCaptureReference={id:string;scopeHash:string};
export const SELLER_TAX_CAPTURE_LIMITS={pageSize:10,validityMs:3600000,issues:20} as const;
const PROTOCOL='seller_tax_annual_capture_v1',phases=['events','sales','initiated','received','ledger','done'] as const;
const ref=(owner:string,year:number,id:string)=>taxSellerRef(owner).collection('years').doc(String(year)).collection('annual_captures').doc(id);
export function parseSellerTaxCaptureReference(raw:unknown):SellerTaxCaptureReference{const r=supportObject(raw,['id','scopeHash']);
  if(typeof r.id!=='string'||!/^capture_[a-f0-9]{64}$/.test(r.id)||!taxHash(r.scopeHash))throw new HttpsError('invalid-argument','Référence de capture annuelle native requise.');return {id:r.id,scopeHash:r.scopeHash};}
export function sellerTaxCaptureContext(operator:Data,identity:Data|null){return {operatorVersionHash:operator.versionHash??null,operatorStatus:operator.status??'unknown',
  timeZone:['UTC','America/Toronto'].includes(operator.timeZone)?operator.timeZone:'unqualified',identityVersionHash:identity?.versionHash??null,
  identityReady:identity?.completeForPreparation===true,policyVersion:SELLER_TAX_POLICY_VERSION};}
export function sellerTaxCapturePoint(snapshot:FirebaseFirestore.DocumentSnapshot){const t=snapshot.readTime;
  if(!(t instanceof Timestamp)||t.nanoseconds%1000!==0||t.toMillis()>Date.now()||t.toMillis()<=0)throw new HttpsError('unavailable','Point de lecture fiscal natif indisponible.');
  return {seconds:t.seconds,nanoseconds:t.nanoseconds};}
function checked(raw:Data|undefined,owner:string,year:number,r:SellerTaxCaptureReference){
  if(!raw||raw.protocol!==PROTOCOL||raw.ownerId!==owner||raw.year!==year||raw.reference?.id!==r.id||raw.reference?.scopeHash!==r.scopeHash||
    raw.scopeHash!==supportSourceHash(raw.scope)||raw.scopeHash!==r.scopeHash||raw.scope.ownerId!==owner||raw.scope.year!==year||!taxCents(raw.version)||
    !['capturing','complete','unavailable'].includes(raw.status)||!phases.includes(raw.cursor?.phase)||raw.cursor.lastId!==null&&!taxId(raw.cursor.lastId)||
    !Array.isArray(raw.cursor.refundQueue)||raw.cursor.refundQueue.length>10||raw.cursor.refundQueue.some((j:Data)=>!taxId(j.transactionId)||j.lastId!==null&&!taxId(j.lastId))||
    !taxCents(raw.pages)||!taxCents(raw.sourcesInspected)||!taxCents(raw.unknownSources)||!taxCents(raw.otherYearSources)||!taxHash(raw.entriesHash)||
    raw.unknownSources>raw.sourcesInspected||raw.otherYearSources>raw.sourcesInspected||
    !Array.isArray(raw.quarters)||raw.quarters.length!==4||raw.quarters.some((q:Data,i:number)=>!q||q.quarter!==i+1||
      ['grossConsiderationCents','platformFeesCents','platformTaxesCents','activityCount'].some(k=>!taxCents(q[k]))||
      !Number.isSafeInteger(q.adjustmentsCents)||!Number.isSafeInteger(q.considerationCents))||
    !Array.isArray(raw.issues)||raw.issues.length>SELLER_TAX_CAPTURE_LIMITS.issues||raw.issues.some((v:unknown)=>typeof v!=='string'||v.length>128)||
    raw.status==='complete'&&(raw.cursor.phase!=='done'||raw.cursor.refundQueue.length!==0||supportSourceHash(raw.summary)!==supportSourceHash(summary(raw)))||
    raw.status!=='complete'&&raw.summary!==null)
    throw new HttpsError('failed-precondition','Capture annuelle native non qualifiée.');return raw;
}
export async function readSellerTaxCapture(tx:FirebaseFirestore.Transaction,owner:string,year:number,r:SellerTaxCaptureReference,context:Data){
  const c=checked((await tx.get(ref(owner,year,r.id))).data(),owner,year,r);
  if(supportSourceHash(c.scope.context)!==supportSourceHash(context))throw new HttpsError('failed-precondition','La méthode annuelle ou l’identité a changé. Une nouvelle capture explicite est nécessaire.');return c;
}
export function sellerTaxCaptureView(c:Data){return {protocol:PROTOCOL,ownerId:c.ownerId,year:c.year,reference:c.reference,status:c.status,reason:c.reason??null,version:c.version,
  readTime:c.scope.readTime,context:c.scope.context,pages:c.pages,cursor:c.cursor,sourcesInspected:c.sourcesInspected,unknownSources:c.unknownSources,
  otherYearSources:c.otherYearSources,entriesHash:c.entriesHash,summary:c.summary??null,knownNativeSourcesOnly:true,legalSourceUniverseVerified:false,
  authorityReadMode:'current',financialEffectAuthorized:false};}
export function prepareSellerTaxCapture(tx:FirebaseFirestore.Transaction,owner:string,year:number,uid:string,rid:string,point:Data,context:Data){
  const scope={ownerId:owner,year,readTime:point,context},scopeHash=supportSourceHash(scope),id='capture_'+supportHash([uid,rid,owner,year]),reference={id,scopeHash};
  const c={protocol:PROTOCOL,ownerId:owner,year,reference,scopeHash,scope,status:'capturing',reason:null,version:0,pages:0,
    cursor:{phase:'events',lastId:null,refundQueue:[]},sourcesInspected:0,unknownSources:0,otherYearSources:0,entriesHash:supportHash([]),issues:[],
    quarters:Array.from({length:4},(_,i)=>({quarter:i+1,grossConsiderationCents:0,adjustmentsCents:0,considerationCents:0,platformFeesCents:0,platformTaxesCents:0,activityCount:0})),summary:null,createdAt:Timestamp.now()};
  return {capture:c,commit(){tx.create(ref(owner,year,id),c);}};
}
class PointUnavailable extends Error{}
async function atPoint<T>(c:Data,authorize:()=>Promise<unknown>,fn:(tx:FirebaseFirestore.Transaction)=>Promise<T>){
  const p=c.scope.readTime;if(!p||!taxCents(p.seconds)||p.seconds<1||!taxCents(p.nanoseconds)||p.nanoseconds>=1e9||p.nanoseconds%1000!==0)throw new PointUnavailable();
  const point=new Timestamp(p.seconds,p.nanoseconds),age=Date.now()-point.toMillis();if(age<0||age>SELLER_TAX_CAPTURE_LIMITS.validityMs)throw new PointUnavailable();
  await authorize();let result:T;
  try{result=await db.runTransaction(tx=>fn(new Proxy(tx,{get(target,key){
    if(key==='get')return async(resource:FirebaseFirestore.DocumentReference|FirebaseFirestore.Query)=>{let snap;try{snap=await target.get(resource as FirebaseFirestore.DocumentReference);}catch{throw new PointUnavailable();}
      if(!(snap.readTime instanceof Timestamp)||!snap.readTime.isEqual(point))throw new PointUnavailable();return snap;};
    if(['set','create','update','delete'].includes(String(key)))return ()=>{throw new PointUnavailable();};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }})),{readOnly:true,readTime:point});}catch(e){if(e instanceof PointUnavailable)throw e;throw new PointUnavailable();}
  await authorize();return result;
}
type Page={cursor:Data;entries:Data[];issues:string[];unavailable:boolean};
/** Reads only, including financial joins. No cursor is advanced on failure. */
export async function observeSellerTaxCapturePage(c:Data,authorize:()=>Promise<unknown>):Promise<Page>{
  if(c.status!=='capturing')return {cursor:c.cursor,entries:[],issues:[],unavailable:false};
  try{return await atPoint(c,authorize,async tx=>{
    const owner=c.ownerId,size=SELLER_TAX_CAPTURE_LIMITS.pageSize,job=c.cursor.refundQueue[0],phase=c.cursor.phase,entries:Data[]=[],issues:string[]=[];
    let q:FirebaseFirestore.Query;
    if(job)q=db.collection('transactions').doc(job.transactionId).collection('refund_allocations');
    else if(phase==='events')q=taxSellerRef(owner).collection('events');
    else if(phase==='sales')q=db.collection('transactions').where('sellerId','==',owner);
    else if(phase==='initiated'||phase==='received')q=db.collection('swaps').where(phase==='initiated'?'initiatorId':'receiverId','==',owner);
    else if(phase==='ledger')q=db.collection('wallets').doc(owner).collection('ledger');
    else return {cursor:c.cursor,entries,issues,unavailable:false};
    q=q.orderBy('__name__').limit(size+1);const cursor=job?job.lastId:c.cursor.lastId;if(cursor)q=q.startAfter(cursor);
    const result=await tx.get(q),selected=result.docs.slice(0,size),more=result.size>size,queue:Data[]=[...c.cursor.refundQueue];
    const add=async(s:SellerTaxSource)=>{try{const e=await readSellerTaxCaptureEntry(tx,owner,s,c.scope.context.operatorVersionHash);entries.push({...e,entryId:e.eventId,entryHash:supportSourceHash(e)});}
      catch(e){if(!(e instanceof HttpsError)||!['failed-precondition','invalid-argument','permission-denied'].includes(e.code))throw e;
        const entry={source:s,eventId:null,body:null,qualification:'unknown',reason:'native_source_or_original_unqualified',observationHash:null,versionHash:null};entries.push({...entry,entryId:'source_'+supportHash(s),entryHash:supportSourceHash(entry)});}};
    for(const row of selected){const raw=row.data();
      if(job)await add({kind:'purchase_refund',id:job.transactionId,refundIntentId:row.id});
      else if(phase==='events'){
        const s=raw.body?.source;if(s&&['purchase','purchase_refund','swap'].includes(s.kind)&&taxId(s.id)&&(s.kind!=='purchase_refund'||taxId(s.refundIntentId)))await add(s);
        else issues.push('unqualified_event_source');
      }else if(phase==='sales'){
        await add({kind:'purchase',id:row.id});queue.push({transactionId:row.id,lastId:null});
        if(raw.refund!=null){if(taxId(raw.refund.intentId))await add({kind:'purchase_refund',id:row.id,refundIntentId:raw.refund.intentId});else issues.push('legacy_refund_identity_unknown');}
      }else if(phase==='initiated'||phase==='received')await add({kind:'swap',id:row.id});
      else if(['sale_credit','debt_repayment','refund_debit'].includes(raw.type)){
        if(taxId(raw.transactionId))await add(raw.type==='refund_debit'&&taxId(raw.refundIntentId)?{kind:'purchase_refund',id:raw.transactionId,refundIntentId:raw.refundIntentId}:{kind:'purchase',id:raw.transactionId});
        else issues.push('orphan_consideration_ledger_source');
      }
    }
    let next:Data;if(job){if(more)queue[0]={...job,lastId:selected.at(-1)!.id};else queue.shift();next={...c.cursor,refundQueue:queue};}
    else next={phase:more?phase:phases[phases.indexOf(phase)+1]??'done',lastId:more?selected.at(-1)!.id:null,refundQueue:queue};
    return {cursor:next,entries,issues,unavailable:false};
  });}catch(e){if(!(e instanceof PointUnavailable))throw e;await authorize();return {cursor:c.cursor,entries:[],issues:['native_read_time_expired_or_unavailable'],unavailable:true};}
}
function summary(c:Data){const issues=[...c.issues],q=c.quarters,total=q.reduce((n:number,v:Data)=>n+v.considerationCents,0),count=q.reduce((n:number,v:Data)=>n+v.activityCount,0);
  if(!['UTC','America/Toronto'].includes(c.scope.context.timeZone))issues.push('period_policy_unknown');
  if(q.some((v:Data)=>Object.values(v).some(n=>!Number.isSafeInteger(n))||v.considerationCents<0)||!Number.isSafeInteger(total)||!Number.isSafeInteger(count))issues.push('annual_arithmetic_or_original_unknown');
  const known=!issues.length&&c.unknownSources===0;
  return {protocol:'seller_tax_annual_summary_v1',ownerId:c.ownerId,year:c.year,currency:'CAD',timeZone:c.scope.context.timeZone,policyVersion:SELLER_TAX_POLICY_VERSION,
    quarters:q,annualActivityCount:known?count:null,annualConsiderationCents:known?total:null,smallGoodsExclusionCandidate:known?count<30&&total<=280000:null,
    activityCountBasis:'one_native_agreement_per_seller',exclusionDoesNotDetermineProfessionalStatus:true,qualification:known?'fixed_native_sources':'unknown',
    issues:[...new Set(issues)].slice(0,20),sourceReferences:[],eventSetHash:c.entriesHash,completeSourceUniverseVerified:false,nativeEventSnapshotVerified:true,
    withdrawalsOrReleasesCounted:false,eventsInspected:c.sourcesInspected,hasMore:false,nextCursor:null,
    captureReference:c.reference,nativeReadTime:c.scope.readTime,knownNativeSourceSetClosed:true,legalSourceUniverseVerified:false};
}
/** Current commit prepares ALL entry reads first. A repeated canonical source
 * contributes once, including when found through event + sale + ledger. */
export async function planSellerTaxCapturePage(tx:FirebaseFirestore.Transaction,c:Data,page:Page){
  const captureRef=ref(c.ownerId,c.year,c.reference.id),unique=new Map<string,Data>();for(const e of page.entries){const old=unique.get(e.entryId);if(old&&old.entryHash!==e.entryHash)throw new HttpsError('failed-precondition','Source fiscale contradictoire au même point.');unique.set(e.entryId,e);}
  const candidates=[...unique.values()],existing=await Promise.all(candidates.map(e=>tx.get(captureRef.collection('entries').doc(e.entryId))));
  const next:Data={...c,version:c.version+1,pages:c.pages+(c.status==='capturing'?1:0),cursor:page.cursor,quarters:c.quarters.map((v:Data)=>({...v})),issues:[...c.issues],updatedAt:Timestamp.now()};
  const writes:Data[]=[];for(let i=0;i<candidates.length;i++){const e=candidates[i],old=existing[i].data();if(old){if(old.entryHash!==e.entryHash)throw new HttpsError('failed-precondition','Entrée fiscale fixe contradictoire.');continue;}
    writes.push(e);next.sourcesInspected++;next.entriesHash=supportHash([next.entriesHash,e.entryId,e.entryHash]);
    const b=e.body,period=taxCalendar(b?.effectiveAt,c.scope.context.timeZone);
    if(e.qualification==='unknown'||!period||!b||!Number.isSafeInteger(b.considerationDeltaCents)){next.unknownSources++;next.issues.push(e.reason??'native_consideration_or_period_unknown');continue;}
    if(period.year!==c.year){next.otherYearSources++;continue;}const quarter=next.quarters[period.quarter-1];
    if(b.eventKind==='paid_or_credited'){
      if(!taxCents(b.grossConsiderationCents)||!taxCents(b.platformFeesCents)||!taxCents(b.platformTaxesCents)){next.unknownSources++;next.issues.push('native_components_unknown');continue;}
      quarter.grossConsiderationCents+=b.grossConsiderationCents;quarter.platformFeesCents+=b.platformFeesCents;quarter.platformTaxesCents+=b.platformTaxesCents;quarter.activityCount++;
    }else quarter.adjustmentsCents+=b.considerationDeltaCents;
    quarter.considerationCents+=b.considerationDeltaCents;
  }
  next.issues=[...new Set([...next.issues,...page.issues])].slice(0,20);
  if(page.unavailable){next.status='unavailable';next.reason='native_read_time_expired_or_unavailable';}
  else if(next.cursor.phase==='done'&&!next.cursor.refundQueue.length){next.status='complete';next.reason=null;next.summary=summary(next);}
  for(const n of [next.sourcesInspected,next.pages,next.version,next.unknownSources,next.otherYearSources])if(!Number.isSafeInteger(n))throw new HttpsError('resource-exhausted','Capture fiscale à rapprocher.');
  return {capture:next,commit(){for(const e of writes)tx.create(captureRef.collection('entries').doc(e.entryId),e);tx.set(captureRef,next);}};
}
