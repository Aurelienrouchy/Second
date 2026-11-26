/** Strict documentary scopes. They never qualify a financial or stock source,
 * including when a shared trigger observes an older TEST source. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {Timestamp} from 'firebase-admin/firestore';
import {articlePrivacyWithdrawn,publicProfileImage} from './publicProfile';
import {applicationLink} from '../config/runtimeEnvironment';
import {assertArticlePrivacyMarkers} from './localArticlePrivacy';
import {hasAccountErasureFence} from './accountErasureContract';
import {validateArticleReportCaptureProjection} from './reportEvidence';

type Data=FirebaseFirestore.DocumentData;
type Write={method:'create'|'set'|'update'|'delete';args:any[]};
type Notice={eventKey:string;userId:string;type:string;title:string;message:string;data:Record<string,string>};
export type DocumentaryProjection={kind:'identity';ownerId:string;path:string}|{kind:'favorite';articleId:string;userId:string}|
  {kind:'swap_notice';swapId:string;eventId:string;sourceAt:Timestamp;before:Data|null;after:Data}|
  {kind:'article_report';articleId:string;reportId:string;reporterId:string}|
  {kind:'swap_dispute_review';swapId:string;requestId:string;request:any;command:unknown;mode:string};
type Attempt={reads:Map<string,{data:Data|undefined;exists:boolean;updateTime:unknown}>;aggregate:number|null;producerIds:string[]|null};
const scopes=new AsyncLocalStorage<DocumentaryProjection>(),attempts=new AsyncLocalStorage<Attempt>();
const fail=():never=>{throw new Error('Documentary projection native source or write unqualified.');};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id=(v:unknown):v is string=>typeof v==='string'&&!!v&&Buffer.byteLength(v,'utf8')<=1500&&!v.includes('/')&&v!=='.'&&v!=='..'&&!/^__[\s\S]*__$/.test(v);
const timestamp=(v:unknown):v is Timestamp=>v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now()+60000;
export const activeDocumentaryProjection=()=>!!scopes.getStore();
export function withDocumentaryProjection<T>(scope:DocumentaryProjection,fn:()=>Promise<T>):Promise<T>{
  if(scope.kind==='identity'&&(!id(scope.ownerId)||!/^(articles|avis|swapPartyItems|chats)\/[^/]+$/.test(scope.path))||
    scope.kind==='favorite'&&(!id(scope.articleId)||!id(scope.userId))||scope.kind==='swap_notice'&&
    (!id(scope.swapId)||typeof scope.eventId!=='string'||!scope.eventId||scope.eventId.length>500||!timestamp(scope.sourceAt))||
    scope.kind==='article_report'&&(!id(scope.articleId)||!id(scope.reportId)||!id(scope.reporterId))||
    scope.kind==='swap_dispute_review'&&(!id(scope.swapId)||!id(scope.requestId)||!id(scope.request?.auth?.uid)))return fail();
  if(scopes.getStore())return fail();
  return scopes.run(scope,fn);
}
export function withDocumentaryProjectionAttempt<T>(fn:()=>Promise<T>):Promise<T>{
  return scopes.getStore()?attempts.run({reads:new Map(),aggregate:null,producerIds:null},fn):fn();
}
export function captureDocumentaryRead(snapshot:any):void{
  const attempt=attempts.getStore();if(!scopes.getStore()||!attempt)return;
  if(Array.isArray(snapshot)){snapshot.forEach(captureDocumentaryRead);return;}
  if(!snapshot?.ref?.path||typeof snapshot.data!=='function')return;
  const value={data:snapshot.data(),exists:snapshot.exists,updateTime:snapshot.updateTime};
  const old=attempt.reads.get(snapshot.ref.path);if(old&&!same(old,value))return fail();
  attempt.reads.set(snapshot.ref.path,value);
}
export function recordFavoriteProjectionCount(value:number):void{
  const scope=scopes.getStore(),attempt=attempts.getStore();
  if(scope?.kind!=='favorite'||!attempt||!Number.isSafeInteger(value)||value<0)return fail();attempt.aggregate=value;
}
export function recordProducerNoticeIds(ids:string[]):void{
  const scope=scopes.getStore(),attempt=attempts.getStore();if(scope?.kind!=='swap_notice'||!attempt||ids.length!==2||new Set(ids).size!==2||
    ids.some(v=>!/^operational_[a-f0-9]{64}$/.test(v)))return fail();attempt.producerIds=[...ids];
}
export function favoriteProjectionIds(value:unknown):Set<string>{return new Set(Array.isArray(value)?value.filter(id):[]);}
const name=(user:Data|undefined)=>typeof user?.displayName==='string'&&user.displayName.length>0&&user.displayName.length<=150?user.displayName:'Utilisateur';
/** The live owner controls public visibility; event payloads never do. */
export function identityProjectionFields(path:string,ownerId:string,target:Data,user:Data|undefined):Data{
  const root=path.split('/')[0],withdrawn=articlePrivacyWithdrawn(target);
  if(root==='chats'){
    if(!Array.isArray(target.participants)||!target.participants.includes(ownerId)||!Array.isArray(target.participantsInfo))return fail();
    return {participantsInfo:target.participantsInfo.map((p:any)=>p.userId!==ownerId?p:{...p,userName:name(user),
      userImage:typeof user?.profileImage==='string'&&user.profileImage?user.profileImage:null})};
  }
  const reviewer=root==='avis',field=reviewer?'reviewerId':'sellerId';if(target[field]!==ownerId)return fail();
  return {[reviewer?'reviewerName':'sellerName']:withdrawn?'Utilisateur':name(user),[reviewer?'reviewerImage':'sellerImage']:withdrawn?null:publicProfileImage(user)};
}

/** Partial progress matters even while the shared status stays unchanged.
 * Only the counterpart is notified; a declaration is not a carrier scan. */
function progressNotices(swapId: string, before: FirebaseFirestore.DocumentData, after: FirebaseFirestore.DocumentData,
  eventId: string): Notice[] {
  const notices: Notice[] = [];
  for (const side of ['initiator', 'receiver'] as const) {
    const other = side === 'initiator' ? 'receiver' : 'initiator';
    const facts = [
      {field: `${side}Photos`, date: after[`${side}Photos`]?.uploadedAt, previous: before[`${side}Photos`],
        title: 'Les photos du troc sont prêtes', message: 'L’autre membre a ajouté les photos de ses articles. Retrouvez-les dans votre troc.'},
      {field: `${side}ShippedAt`, date: after[`${side}ShippedAt`], previous: before[`${side}ShippedAt`],
        title: 'Vos articles ont été envoyés', message: 'L’autre membre a confirmé son envoi. Vous pourrez confirmer la réception dans votre troc.'},
      {field: `${side}ReceivedAt`, date: after[`${side}ReceivedAt`], previous: before[`${side}ReceivedAt`],
        title: 'Vos articles ont été reçus', message: 'L’autre membre a confirmé la réception de vos articles.'},
    ];
    for (const fact of facts) {
      if (fact.previous != null || !(fact.date instanceof Timestamp) || fact.date.toMillis() <= 0 || fact.date.toMillis() > Date.now() ||
          fact.field.endsWith('Photos') && after[fact.field]?.userId !== after[`${side}Id`] ||
          fact.field.endsWith('ShippedAt') && after.exchangeMode !== 'shipping') continue;
      notices.push({eventKey: `swap_event:${swapId}:${eventId}:${fact.field}`, userId: after[`${other}Id`], type: 'swap_update',
        title: fact.title, message: fact.message, data: {ownerId: after[`${other}Id`], actorUid: after[`${side}Id`], swapId,
          status: after.status, source: 'native_swap_event', progressField: fact.field}});
    }
  }
  return notices;
}

export function swapEventNoticeInputs(swapId: string, before: FirebaseFirestore.DocumentData | null, after: FirebaseFirestore.DocumentData,
  eventId: string): Notice[] {
  if (before && before.status === after.status) return progressNotices(swapId, before, after, eventId);
  let title: string, message: string;
  switch (after.status) {
    case 'proposed':
      if (before) return [];
      title = 'Nouvelle proposition de troc'; message = 'Un membre vous propose un troc. Découvrez ses articles et sa proposition.'; break;
    case 'accepted':
      title = 'Votre troc est accepté'; message = 'Vous pouvez maintenant préparer votre échange et convenir des derniers détails.'; break;
    case 'payment_pending':
      title = 'Votre troc est accepté'; message = 'Un complément reste à régler avant de préparer l’échange. Retrouvez la prochaine étape dans votre troc.'; break;
    case 'disputed':
      title = 'Signalement sur l’échange enregistré'; message = 'Un signalement est enregistré pour cet échange. Consultez le dossier pour les versions conservées et contactez le support si nécessaire.'; break;
    case 'declined':
      title = 'Refus de la proposition enregistré'; message = 'Un refus est enregistré pour cette proposition d’échange. Consultez le dossier pour son état courant.'; break;
    case 'cancelled':
      title = 'Annulation de l’échange enregistrée'; message = 'Une annulation est enregistrée pour cet échange. Consultez le dossier et le suivi d’un éventuel complément ou contactez le support.'; break;
    case 'expired':
      title = 'Expiration de l’échange enregistrée'; message = 'Une expiration est enregistrée pour cet échange. Consultez le dossier et le suivi d’un éventuel complément ou contactez le support.'; break;
    case 'photos_pending':
      title = 'Préparez vos articles'; message = 'Ajoutez les photos de vos articles avant l’envoi.'; break;
    case 'shipping':
      title = 'Votre troc est prêt'; message = after.exchangeMode === 'shipping' ? 'Les photos sont prêtes. Vous pouvez maintenant organiser vos envois.' : 'Vous pouvez maintenant vous retrouver pour échanger vos articles.'; break;
    case 'completed':
      title = 'Votre troc est terminé'; message = 'Vous avez tous les deux reçu vos articles. Vous pouvez maintenant vous laisser un avis.'; break;
    default: return [];
  }
  const targets = after.status === 'proposed' ? [after.receiverId] : [after.initiatorId, after.receiverId];
  return targets.map(userId => ({ eventKey: `swap_event:${swapId}:${eventId}`, userId, type: 'swap_update', title, message,
    data: { ownerId: userId, swapId, status: after.status, source: 'native_swap_event' } }));
}



export function swapEventSourceHash(scope:Extract<DocumentaryProjection,{kind:'swap_notice'}>):string{
  const {swapId,eventId,sourceAt,before,after}=scope,inputs=swapEventNoticeInputs(swapId,before,after,eventId);
  const source=[swapId,eventId,sourceAt.toMillis(),before?.status??null,after.status,after.initiatorId,after.receiverId];
  return digest(before?.status===after.status?[...source,'partial_progress_v1',...inputs.map(i=>[i.userId,i.data.progressField??null])]:source);
}
const noticeIdentity=(input:Notice)=>({id:'operational_'+digest([input.eventKey,input.userId]),
  payloadHash:digest([input.eventKey,input.userId,input.type,input.title,input.message,Object.entries(input.data).sort(([a],[b])=>a.localeCompare(b))])});
function validReceipt(value:Data|undefined,input:Notice):boolean{
  const identity=noticeIdentity(input);
  return !!value&&value.protocol==='operational_notice_v1'&&value.notificationId===identity.id&&value.eventKey===input.eventKey&&value.userId===input.userId&&
    value.type===input.type&&value.payloadHash===identity.payloadHash&&value.title===input.title&&value.message===input.message&&same(value.data,input.data)&&
    value.inAppCommitted===true&&timestamp(value.committedAt);
}
/** Every captured callback read is rechecked in this SAME native transaction.
 * Only the exact listed patches are exempted from financial/stock admission. */
export async function documentaryProjectionNativePlan(database:FirebaseFirestore.Firestore,writes:readonly Write[],
  read:(path:string)=>Promise<FirebaseFirestore.DocumentSnapshot>,aggregate:(articleId:string)=>Promise<number>,native?:FirebaseFirestore.Transaction):Promise<Set<Write>>{
  const scope=scopes.getStore(),allowed=new Set<Write>();if(!scope||!writes.length)return allowed;
  const attempt=attempts.getStore();if(!attempt)return fail();
  for(const [path,source] of attempt.reads){const current=await read(path);
    if(!same(source,{data:current.data(),exists:current.exists,updateTime:current.updateTime}))return fail();}
  const required=async(path:string)=>{if(!attempt.reads.has(path))return fail();return (await read(path)).data();};
  const byPath=new Map<string,Write>();for(const w of writes){const path=w.args[0]?.path;if(typeof path!=='string'||byPath.has(path))return fail();byPath.set(path,w);}
  const exact=(path:string,method:Write['method'],value:Data)=>{const w=byPath.get(path);if(!w||w.method!==method||w.args.length!==2||!same(w.args[1],value))return fail();allowed.add(w);};
  if(scope.kind==='swap_dispute_review'){
    if(!native)return fail();
    const {qualifyLocalSwapReviewWrites}=await import('./swapDisputeReview');
    const expected=await qualifyLocalSwapReviewWrites(native,scope,writes);
    for(const row of expected)exact(row.path,row.method,row.value);
  }else if(scope.kind==='identity'){
    const target=await required(scope.path),user=await required('users/'+scope.ownerId);if(!target||writes.length!==1)return fail();
    exact(scope.path,'update',identityProjectionFields(scope.path,scope.ownerId,target,user));
    // The current profile may outlive Auth for safe cross-service retries.
    // After erasure admission an old user event can project only a neutral
    // identity; the fence read joins the SAME native transaction.
    if(hasAccountErasureFence((await read('eligibility_profiles/'+scope.ownerId)).data()))
      byPath.get(scope.path)!.args[1]=identityProjectionFields(scope.path,scope.ownerId,target,undefined);
  }else if(scope.kind==='favorite'){
    const {articleId,userId}=scope,apath='articles/'+articleId,mpath='favorite_memberships/'+articleId+'/users/'+userId,ipath='search_index/'+articleId;
    const source=await required('favorites/'+userId),article=await required(apath),member=await required(mpath),index=await required(ipath);
    const count=await aggregate(articleId);if(!Number.isSafeInteger(count)||count<0||count!==attempt.aggregate)return fail();
    if(member&&Object.keys(member).some(k=>!['counted','updatedAt'].includes(k)))return fail();
    const date=byPath.get(mpath)?.args[1]?.updatedAt;if(!timestamp(date))return fail();
    exact(mpath,'set',{counted:favoriteProjectionIds(source?.articleIds).has(articleId),updatedAt:date});
    if(article){exact(apath,'update',{favoritesCount:count,likes:count});if(index)exact(ipath,'update',{likes:count});}
  }else if(scope.kind==='article_report'){
    const apath='articles/'+scope.articleId,rpath='reports/'+scope.reportId,epath=rpath+'/native_evidence/capture',
      article=await required(apath),reporter=await required('users/'+scope.reporterId),report=byPath.get(rpath)?.args[1],anchor=byPath.get(epath)?.args[1];
    if(!article||!report||!anchor||(await read(rpath)).exists||(await read(epath)).exists||
      hasAccountErasureFence((await read('eligibility_profiles/'+scope.reporterId)).data())||
      hasAccountErasureFence((await read('eligibility_profiles/'+article.sellerId)).data()))return fail();
    const evidence=validateArticleReportCaptureProjection(await read(apath),report,anchor),prior=article.articleReportEvidenceReportIds??[];
    if(!Array.isArray(prior)||prior.some(v=>!id(v))||prior.length>=40||new Set(prior).size!==prior.length||prior.includes(scope.reportId)||
      evidence.reporterId!==scope.reporterId||evidence.capturedAt.toMillis()>Date.now()||evidence.capturedAt.toMillis()<Date.now()-60000)return fail();
    exact(apath,'update',{articleReportEvidenceReportIds:[...prior,scope.reportId]});
    exact(rpath,'create',{id:scope.reportId,reporterId:scope.reporterId,reporterName:name(reporter),targetType:'article',targetId:scope.articleId,
      targetOwnerId:article.sellerId,reason:report.reason,description:report.description,status:'pending',createdAt:evidence.capturedAt,articleEvidence:evidence});
    exact(epath,'create',{schemaVersion:1,writer:'submitReport_capture_v1',reportId:scope.reportId,articleId:scope.articleId,sellerId:article.sellerId,
      reporterId:scope.reporterId,requestId:evidence.requestId,tupleHash:evidence.tupleHash,contentHash:evidence.contentHash,
      articleRevision:evidence.articleRevision,capturedAt:evidence.capturedAt});
  }else{
    const {swapId,eventId,sourceAt,before,after}=scope,parentPath='swaps/'+swapId,eventPath=parentPath+'/notice_events/'+digest(eventId);
    const parent=await required(parentPath),prior=await required(eventPath),w=byPath.get(eventPath),value=w?.args[1];
    if(!parent||prior||parent.initiatorId!==after.initiatorId||parent.receiverId!==after.receiverId||!id(parent.initiatorId)||!id(parent.receiverId)||parent.initiatorId===parent.receiverId)return fail();
    await assertArticlePrivacyMarkers('swaps',parent,parent,async path=>(await read(path)).data());
    const inputs=swapEventNoticeInputs(swapId,before,after,eventId);if(!inputs.length||!timestamp(value?.committedAt))return fail();
    const notificationIds=attempt.producerIds??inputs.map(i=>noticeIdentity(i).id);
    exact(eventPath,'create',{protocol:'swap_notice_event_v1',swapId,eventId,sourceHash:swapEventSourceHash(scope),sourceAt,sourceStatus:before?.status??null,
      recordedStatus:after.status,initiatorId:after.initiatorId,receiverId:after.receiverId,notificationIds,
      noticeSource:attempt.producerIds?'native_producer_receipts':'native_event',deviceDeliveryVerified:false,readingVerified:false,committedAt:value.committedAt});
    if(attempt.producerIds){
      for(let n=0;n<notificationIds.length;n++){
        const receipt=await required('operational_notice_receipts/'+notificationIds[n]),input=receipt as Notice;
        if(!receipt||!validReceipt(receipt,input)||receipt.userId!==[after.initiatorId,after.receiverId][n]||receipt.data.swapId!==swapId||
          receipt.type!=='swap_update'||!receipt.committedAt.isEqual(sourceAt)||!receipt.eventKey.startsWith('swap_dispute_decision:'+swapId+':')&&!receipt.eventKey.startsWith('swap_expired:'+swapId+':'))return fail();
      }
    }else for(const input of inputs){
      const identity=noticeIdentity(input),rpath='operational_notice_receipts/'+identity.id,npath='notifications/'+identity.id;
      const receipt=await required(rpath),notification=await required(npath);if(receipt){if(!validReceipt(receipt,input))return fail();continue;}if(notification)return fail();
      const date=byPath.get(rpath)?.args[1]?.committedAt;if(!timestamp(date))return fail();
      exact(rpath,'create',{protocol:'operational_notice_v1',notificationId:identity.id,eventKey:input.eventKey,userId:input.userId,type:input.type,title:input.title,message:input.message,
        data:input.data,payloadHash:identity.payloadHash,inAppCommitted:true,committedAt:date,pushState:'pending',pushAttempts:0});
      exact(npath,'create',{id:identity.id,userId:input.userId,type:input.type,title:input.title,message:input.message,
        data:{...input.data,deepLink:applicationLink('https://seconde.ca/swap/'+swapId)},operationalReceiptId:identity.id,isRead:false,createdAt:date});
    }
  }
  if(allowed.size!==writes.length)return fail();return allowed;
}
