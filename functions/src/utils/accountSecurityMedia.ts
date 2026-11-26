/** Containment retires Seconde's old chat bearer tokens, independently of Auth
 * and money. Private conservation precedes each generation-qualified PATCH.
 * A finished live scan never proves erased caches or exhaustive old access. */
import {createHash,randomUUID} from 'node:crypto';
import {Storage} from '@google-cloud/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db,storage} from '../config/firebase';
import {sourceImageWitness,timestampNotAfter,type PrivateImageWitness} from './privateMedia';
import {contentCaseRef} from './reviewVisibility';
import {supportSourceHash} from './supportRequest';
type Data=FirebaseFirestore.DocumentData;
const P='account_security_media_v1',V='account_security_containment_v1',hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const STATEMENT='Je demande de bloquer les nouvelles opérations de ce compte et de révoquer ses sessions. Le rétablissement nécessitera un examen par l’équipe.';
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=128&&!v.includes('/')&&!['.','..'].includes(v);
const native=(v:unknown):v is Timestamp=>v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
const number=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const digits=(v:unknown)=>typeof v==='string'&&/^\d{1,30}$/.test(v);
// Installed GCS File parses generation into a number before sourceGeneration.
// Refuse unrepresentable revisions instead of silently selecting another one.
const generation=(v:unknown)=>digits(v)&&Number.isSafeInteger(Number(v))&&String(Number(v))===v;
const ref=(commandId:string)=>db.collection('eligibility_audit').doc(commandId);
const conflict=()=>new HttpsError('failed-precondition','Les médias du confinement nécessitent un rapprochement.');
export const ACCOUNT_SECURITY_MEDIA_LIMITS={chats:3,messages:5,storageTimeoutMs:2000,immediateMs:5000,scheduledMs:12000} as const;
export function initialAccountSecurityMedia(ownerId:string,commandId:string,cutoffAt:Timestamp){
  const scope={ownerId,commandId,cutoffAt},scopeHash=supportSourceHash(scope);
  return {protocol:P,...scope,scopeHash,state:'pending',cursor:{lastChatId:null,chatQueue:[],reachedEnd:false,lastObjectId:null},
    referencesInspected:0,objectsQueued:0,objectsPending:0,preserved:0,revoked:0,issues:[],pages:0,lease:null,leaseUntilMs:0,updatedAt:cutoffAt};
}
function media(raw:Data,owner:string,commandId:string,cutoffAt:Timestamp){
  if(!raw||raw.protocol!==P||raw.ownerId!==owner||raw.commandId!==commandId||!native(raw.cutoffAt)||!raw.cutoffAt.isEqual(cutoffAt)||
    raw.scopeHash!==supportSourceHash({ownerId:owner,commandId,cutoffAt})||!['pending','in_progress'].includes(raw.state)||
    !raw.cursor||raw.cursor.lastChatId!==null&&!id(raw.cursor.lastChatId)||raw.cursor.lastObjectId!==null&&!/^[a-f0-9]{64}$/.test(raw.cursor.lastObjectId)||
    typeof raw.cursor.reachedEnd!=='boolean'||!Array.isArray(raw.cursor.chatQueue)||raw.cursor.chatQueue.length>ACCOUNT_SECURITY_MEDIA_LIMITS.chats||
    raw.cursor.chatQueue.some((j:Data)=>!id(j.chatId)||j.lastMessageId!==null&&!id(j.lastMessageId))||
    ['referencesInspected','objectsQueued','objectsPending','preserved','revoked','pages','leaseUntilMs'].some(k=>!number(raw[k]))||
    raw.objectsPending>raw.objectsQueued||raw.preserved>raw.objectsQueued||raw.revoked>raw.preserved||!Array.isArray(raw.issues)||raw.issues.length>20||
    raw.issues.some((s:unknown)=>typeof s!=='string'||s.length>100))throw conflict();return raw;
}
/** Independent native authority permits ONLY the accepted containment's media
 * work; neither the caller token nor a queue locator grants another action. */
async function context(tx:FirebaseFirestore.Transaction,commandId:string){
  const command=(await tx.get(ref(commandId))).data(),uid=command?.ownerId;
  if(!command||!id(uid)||command.schemaVersion!==1||command.action!=='account_security_containment'||command.actorUid!==uid||!id(command.requestId)||
    !/^[A-Za-z0-9_-]{1,128}$/.test(command.requestId)||command.statementVersion!==V||command.statement!==STATEMENT||command.accepted!==true||!native(command.receivedAt)||
    command.receivedAtMs!==command.receivedAt.toMillis()||command.commandId!==commandId||commandId!=='security_'+hash([uid,command.requestId])||
    command.inputHash!==hash([uid,command.requestId,V,true])||!['revocation_pending','revocation_unknown','contained'].includes(command.state))throw conflict();
  const profile=(await tx.get(db.collection('eligibility_profiles').doc(uid))).data(),b=profile?.accountSecurityBarrier;
  if(!b||b.schemaVersion!==1||b.ownerId!==uid||b.commandId!==commandId||b.requestId!==command.requestId||b.inputHash!==command.inputHash||b.source!=='owner_security_request'||
    b.statementVersion!==V||b.accepted!==true||b.newEffectsBlocked!==true||!native(b.recordedAt)||!b.recordedAt.isEqual(command.receivedAt))throw conflict();
  return {command,ownerId:uid,cutoffAt:b.recordedAt,media:command.mediaSecurity===undefined?null:media(command.mediaSecurity,uid,commandId,b.recordedAt)};
}
export function accountSecurityMediaView(command:Data|undefined,profile?:Data){
  const absent=command?.state==='neutralized'||!command&&!Object.prototype.hasOwnProperty.call(profile??{},'accountSecurityBarrier');let value:Data|null=null;
  try{if(!absent&&Object.prototype.hasOwnProperty.call(command!,'mediaSecurity'))value=media(command!.mediaSecurity,command!.ownerId,command!.commandId,command!.receivedAt);}catch{/* unknown native body, no invented zeros */}
  const ended=!!value&&value.cursor.reachedEnd&&value.cursor.chatQueue.length===0,issue=!!value&&value.issues.length>0;
  return {protocol:P,state:absent?'not_requested':!value?'unknown':!value.pages?'pending':!ended||value.objectsPending>0?'in_progress':issue?'review_required':'observed_for_scanned_references',
    cutoffAt:!absent&&native(command?.receivedAt)?command!.receivedAt.toDate().toISOString():null,
    nativeReferencesInspected:value?.referencesInspected??null,objectsQueued:value?.objectsQueued??null,privatelyPreservedCount:value?.preserved??null,observedRevokedCount:value?.revoked??null,
    scanReachedEnd:ended,referenceCoverage:value&&!issue&&value.objectsQueued>0?'native_references_only':'unknown',globalCoverageVerified:false,historicalCopiesErased:false,
    newMediaPermissionGranted:false,lastObservedAt:native(value?.updatedAt)?value!.updatedAt.toDate().toISOString():null};
}
function pathFrom(value:unknown,chatId:string){
  const bucket=storage.bucket().name;let path:string;
  try{if(typeof value!=='string')return null;if(value.startsWith(`gs://${bucket}/`))path=value.slice(bucket.length+6).split(/[?#]/,1)[0];
    else{const u=new URL(value),r=/^https?:\/\/[^/?#]+([^?#]*)/.exec(value)?.[1],m=r?/^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(r):null;
      if(u.origin!=='https://firebasestorage.googleapis.com'||u.username||u.password||!m||decodeURIComponent(m[1])!==bucket)return null;path=decodeURIComponent(m[2]);}
    if(!path.startsWith(`chat_images/${chatId}/`)||Buffer.byteLength(path,'utf8')>1500||/[\u0000-\u001f\u007f-\u009f]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'||p.includes('\\')))return null;
    return path;
  }catch{return null;}
}
async function messageSource(tx:FirebaseFirestore.Transaction,owner:string,cutoff:Timestamp,chatId:string,messageId:string){
  const chat=(await tx.get(db.collection('chats').doc(chatId))).data(),current=(await tx.get(db.collection('messages').doc(messageId))).data(),parties=chat?.participants;
  if(!Array.isArray(parties)||parties.length!==2||new Set(parties).size!==2||parties.some(p=>!id(p))||!parties.includes(owner)||!current||current.chatId!==chatId)throw conflict();
  let body=current;
  if(current.contentModeration?.state==='hidden'){
    const root=(await tx.get(contentCaseRef('message',messageId))).data(),h=root?.original;
    const original=typeof h==='string'&&/^[a-f0-9]{64}$/.test(h)?(await tx.get(contentCaseRef('message',messageId).collection('originals').doc(h))).data():null;
    if(!original||original.protocol!=='content_original_v1'||original.targetType!=='message'||original.targetId!==messageId||original.sourceHash!==h||supportSourceHash(original.body)!==h||
      original.body?.chatId!==chatId)throw conflict();body=original.body;
  }
  const at=Object.prototype.hasOwnProperty.call(body,'timestamp')?body.timestamp:body.createdAt;
  if(body.type!=='image')return null;
  if(!parties.includes(body.senderId)||body.receiverId!=null&&body.receiverId!==parties.find(p=>p!==body.senderId)||
    body.participants!=null&&(!Array.isArray(body.participants)||supportSourceHash([...body.participants].sort())!==supportSourceHash([...parties].sort()))||!native(at))throw conflict();
  if(!timestampNotAfter(at,cutoff))return null;
  const paths=['image','thumbnail'].map(kind=>({kind,path:pathFrom(body.image?.[kind==='image'?'url':'thumbnail'],chatId)}));
  const source={ownerId:owner,chatId,messageId,parties:[...parties].sort(),senderId:body.senderId,receiverId:body.receiverId??null,messageAt:at,
    paths};return {sourceHash:supportSourceHash(source),paths};
}
function issues(value:Data,reason:string){return [...new Set([...value.issues,reason])].slice(0,20);}
async function scan(commandId:string,lease:string){return db.runTransaction(async tx=>{
  const c=await context(tx,commandId),m=c.media;if(!m||m.lease!==lease||m.leaseUntilMs<=Date.now())throw conflict();
  const queue=[...m.cursor.chatQueue],job=queue[0],writes:{ref:FirebaseFirestore.DocumentReference;value:Data}[]=[],next:Data={...m,cursor:{...m.cursor},issues:[...m.issues],pages:m.pages+1,updatedAt:Timestamp.now(),state:'in_progress'};
  if(job){let q:FirebaseFirestore.Query=db.collection('messages').where('chatId','==',job.chatId).orderBy('__name__').limit(ACCOUNT_SECURITY_MEDIA_LIMITS.messages+1);if(job.lastMessageId)q=q.startAfter(job.lastMessageId);
    const page=await tx.get(q),selected=page.docs.slice(0,ACCOUNT_SECURITY_MEDIA_LIMITS.messages);
    for(const row of selected){if(row.data().type!=='image')continue;let s;try{s=await messageSource(tx,c.ownerId,c.cutoffAt,job.chatId,row.id);}catch(error){
        if(!(error instanceof HttpsError)||error.code!=='failed-precondition')throw error;
        next.issues=issues(next,'native_message_source_unknown');continue;}if(!s)continue;
      for(const p of s.paths){next.referencesInspected++;if(!p.path){next.issues=issues(next,'unmanaged_or_missing_image_reference');continue;}
        const mid=hash(p.path),workRef=ref(commandId).collection('media_work').doc(mid),old=(await tx.get(workRef)).data();if(old||writes.some(w=>w.ref.path===workRef.path))continue;
        const source={chatId:job.chatId,messageId:row.id,fileKind:p.kind,path:p.path,sourceHash:s.sourceHash},value={protocol:'account_security_media_object_v1',commandId,ownerId:c.ownerId,mediaId:mid,source,
          sourceBindingHash:supportSourceHash(source),state:'pending',preservation:null,revocation:null,createdAt:Timestamp.now()};
        writes.push({ref:workRef,value});next.objectsQueued++;next.objectsPending++;
      }
    }
    if(page.size>selected.length)queue[0]={...job,lastMessageId:selected.at(-1)!.id};else queue.shift();next.cursor.chatQueue=queue;
  }else if(!m.cursor.reachedEnd){let q:FirebaseFirestore.Query=db.collection('chats').where('participants','array-contains',c.ownerId).orderBy('__name__').limit(ACCOUNT_SECURITY_MEDIA_LIMITS.chats+1);if(m.cursor.lastChatId)q=q.startAfter(m.cursor.lastChatId);
    const page=await tx.get(q),selected=page.docs.slice(0,ACCOUNT_SECURITY_MEDIA_LIMITS.chats);for(const row of selected){const p=row.data().participants;
      if(!Array.isArray(p)||p.length!==2||new Set(p).size!==2||!p.includes(c.ownerId)||p.some(v=>!id(v)))next.issues=issues(next,'native_chat_participants_unknown');else queue.push({chatId:row.id,lastMessageId:null});}
    next.cursor.chatQueue=queue;next.cursor.reachedEnd=page.size<=selected.length;next.cursor.lastChatId=selected.at(-1)?.id??m.cursor.lastChatId;
    if(page.empty&&m.referencesInspected===0)next.issues=issues(next,'empty_live_listing_not_exhaustive');
  }
  if(next.cursor.reachedEnd&&!next.cursor.chatQueue.length&&next.referencesInspected===0)next.issues=issues(next,'empty_or_unqualified_reference_set');
  for(const w of writes)tx.create(w.ref,w.value);tx.update(ref(commandId),{mediaSecurity:next});return next;
});}
function sourceCreatedAt(value:unknown){if(typeof value!=='string')return null;const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);if(!m)return null;
  const ms=Date.parse(m[1]+'Z');if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,19)!==m[1])return null;
  return new Timestamp(Math.floor(ms/1000),Number((m[2]??'').padEnd(9,'0')));}
function witnessMatches(metadata:Data,w:PrivateImageWitness){return String(metadata.generation)===w.sourceGeneration&&metadata.crc32c===w.sourceCrc32c&&Number(metadata.size)===w.size&&metadata.contentType===w.contentType;}
async function objectStep(commandId:string,lease:string,deadline:number){
  const start=await db.runTransaction(async tx=>{const c=await context(tx,commandId),m=c.media;if(!m||m.lease!==lease)throw conflict();
    let q:FirebaseFirestore.Query=ref(commandId).collection('media_work').where('state','==','pending').orderBy('__name__').limit(1);if(m.cursor.lastObjectId)q=q.startAfter(m.cursor.lastObjectId);
    let p=await tx.get(q);if(p.empty&&m.cursor.lastObjectId)p=await tx.get(ref(commandId).collection('media_work').where('state','==','pending').orderBy('__name__').limit(1));
    const row=p.docs[0];if(!row)return null;const w=row.data();
    tx.update(ref(commandId),{mediaSecurity:{...m,cursor:{...m.cursor,lastObjectId:row.id}}});return {work:w,workRef:row.ref};});
  if(!start)return;let work=start.work;const workRef=start.workRef,mid=workRef.id;
  if(['revoked','review_required'].includes(work.state))return;
  if(work.protocol!=='account_security_media_object_v1'||work.commandId!==commandId||work.mediaId!==mid||mid!==hash(work.source?.path)||work.sourceBindingHash!==supportSourceHash(work.source))throw conflict();
  const checkpoint=async(patch?:Data,requalifySource=false)=>db.runTransaction(async tx=>{if(Date.now()>deadline)throw new Error('media_budget_exhausted');const c=await context(tx,commandId),m=c.media,current=(await tx.get(workRef)).data();
    if(!m||m.lease!==lease||m.leaseUntilMs<=Date.now()||!current||supportSourceHash(current)!==supportSourceHash(work))throw conflict();
    if(requalifySource){const s=await messageSource(tx,c.ownerId,c.cutoffAt,work.source.chatId,work.source.messageId);if(!s||s.sourceHash!==work.source.sourceHash||!s.paths.some(p=>p.kind===work.source.fileKind&&p.path===work.source.path))throw conflict();}
    if(!patch)return {cutoffAt:c.cutoffAt};
    const next:Data={...work,...patch,updatedAt:Timestamp.now()},preserved=!work.preservation&&!!next.preservation,revoked=work.state!=='revoked'&&next.state==='revoked',review=work.state!=='review_required'&&next.state==='review_required';
    tx.set(workRef,next);tx.update(ref(commandId),{mediaSecurity:{...m,preserved:m.preserved+(preserved?1:0),revoked:m.revoked+(revoked?1:0),objectsPending:m.objectsPending-(revoked||review?1:0),
      issues:review?issues(m,next.reason??'media_requires_review'):m.issues,updatedAt:Timestamp.now()}});work=next;return {cutoffAt:c.cutoffAt};});
  const reader=new Storage({timeout:ACCOUNT_SECURITY_MEDIA_LIMITS.storageTimeoutMs,retryOptions:{autoRetry:false,maxRetries:0}}),bucket=reader.bucket(storage.bucket().name),source=bucket.file(work.source.path),privatePath=`account_security_media/${commandId}/${mid}`,destination=bucket.file(privatePath);
  const get=async(file:ReturnType<typeof bucket.file>)=>{await checkpoint();const [m]=await file.getMetadata();await checkpoint();return m;};
  const observePrivate=async(w:PrivateImageWitness)=>{const m=await get(destination);if(!generation(String(m.generation))||m.crc32c!==w.sourceCrc32c||Number(m.size)!==w.size||m.contentType!==w.contentType||m.cacheControl!=='private, no-store'||
      m.metadata?.firebaseStorageDownloadTokens!=null||m.metadata?.privacyOperationId!==commandId||m.metadata?.privacyMediaId!==mid||m.metadata?.privacySourceGeneration!==w.sourceGeneration)throw conflict();
    await checkpoint();const [bytes]=await bucket.file(privatePath,{generation:m.generation}).download({validation:'crc32c',decompress:false});await checkpoint();if(bytes.length!==w.size)throw conflict();
    return {...w,privatePath,privateGeneration:String(m.generation),sha256:createHash('sha256').update(bytes).digest('hex'),observedAt:Timestamp.now()};};
  try{
    if(!work.copyAuthorization){const m=await get(source),w=sourceImageWitness(m),created=sourceCreatedAt(m.timeCreated),c=await checkpoint();
      if(!generation(String(m.generation))||!digits(String(m.metageneration))||!created||!timestampNotAfter(created,c.cutoffAt)){
        await checkpoint({state:'review_required',reason:'source_generation_after_cutoff_or_unknown'});return;}
      const authorization={protocol:'account_security_media_copy_v1',sourceGeneration:w.sourceGeneration,sourceCreatedAt:created,sourceMetageneration:String(m.metageneration),witness:w,privatePath,authorizedAt:Timestamp.now()};
      await checkpoint({copyAuthorization:{...authorization,proofHash:supportSourceHash(authorization)}},true);
    }
    const a=work.copyAuthorization,w=a.witness,cutoff=(await checkpoint()).cutoffAt;
    if(a.protocol!=='account_security_media_copy_v1'||a.privatePath!==privatePath||a.sourceGeneration!==w?.sourceGeneration||!generation(w?.sourceGeneration)||!native(a.sourceCreatedAt)||!timestampNotAfter(a.sourceCreatedAt,cutoff)||
      !digits(a.sourceMetageneration)||a.proofHash!==supportSourceHash(Object.fromEntries(Object.entries(a).filter(([k])=>k!=='proofHash'))))throw conflict();
    if(!work.preservation){
      // GET first after every stop. Repeating the SAME pinned copy, only when
      // destination is absent, uses ifGenerationMatch:0; late competing copies
      // cannot replace one another or another original generation.
      let p;try{p=await observePrivate(w);}catch(error){if(Number((error as {code?:unknown}).code)!==404)throw error;
        const current=await get(source);if(!witnessMatches(current,w)){await checkpoint({state:'review_required',reason:'source_generation_or_bytes_changed'});return;}
        await checkpoint(undefined,true);try{await bucket.file(work.source.path,{generation:w.sourceGeneration}).copy(destination,{preconditionOpts:{ifGenerationMatch:0},cacheControl:'private, no-store',
          metadata:{firebaseStorageDownloadTokens:null,privacyOperationId:commandId,privacyMediaId:mid,privacySourceGeneration:w.sourceGeneration}});}catch(e){if(Number((e as {code?:unknown}).code)!==412)throw e;}
        p=await observePrivate(w);
      }
      await checkpoint({preservation:p});
    }
    const proof=await observePrivate(w);if(proof.privateGeneration!==work.preservation.privateGeneration||proof.sha256!==work.preservation.sha256)throw conflict();
    let current=await get(source);if(!witnessMatches(current,w)){await checkpoint({state:'review_required',reason:'source_generation_or_bytes_changed'});return;}
    const patch={cacheControl:'private, no-store',metadata:{firebaseStorageDownloadTokens:null}};
    if(!work.revocationAuthorization){if(!digits(String(current.metageneration)))throw conflict();const authorization={protocol:'account_security_media_revoke_v1',sourceGeneration:w.sourceGeneration,metageneration:String(current.metageneration),bodyHash:supportSourceHash(patch),authorizedAt:Timestamp.now()};
      await checkpoint({revocationAuthorization:{...authorization,proofHash:supportSourceHash(authorization)}},true);}
    const r=work.revocationAuthorization;if(r.protocol!=='account_security_media_revoke_v1'||r.sourceGeneration!==w.sourceGeneration||!digits(r.metageneration)||r.bodyHash!==supportSourceHash(patch)||r.proofHash!==supportSourceHash(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='proofHash'))))throw conflict();
    // A stopped PATCH is reconciled by GET. If still at the ORIGINAL CAS, the
    // same patch may race its late delivery: at most one metageneration wins.
    if(current.metadata?.firebaseStorageDownloadTokens!=null||current.cacheControl!=='private, no-store'){
      if(String(current.metageneration)!==r.metageneration){await checkpoint({state:'review_required',reason:'source_metadata_changed_after_authorization'});return;}
      await checkpoint(undefined,true);try{await source.setMetadata(patch,{ifGenerationMatch:w.sourceGeneration,ifMetagenerationMatch:r.metageneration});}catch(e){if(Number((e as {code?:unknown}).code)!==412)throw e;}
      current=await get(source);
    }
    if(!witnessMatches(current,w)||current.metadata?.firebaseStorageDownloadTokens!=null||current.cacheControl!=='private, no-store'||!digits(String(current.metageneration)))throw conflict();
    await checkpoint({state:'revoked',revocation:{sourceGeneration:w.sourceGeneration,metageneration:String(current.metageneration),observedAt:Timestamp.now()}});
  }catch{/* Preserve native authorizations/proofs. No missing GET proves success. */}
}
/** Legacy accepted commands are adopted from their exact existing barrier;
 * nothing creates a new containment, changes Auth or repeats money. */
export async function advanceAccountSecurityMedia(commandId:string,options:{deadlineMs?:number;maxSteps?:number}={}){
  if(!/^security_[a-f0-9]{64}$/.test(commandId))throw conflict();const lease=randomUUID(),deadline=options.deadlineMs??Date.now()+ACCOUNT_SECURITY_MEDIA_LIMITS.immediateMs;
  const claimed=await db.runTransaction(async tx=>{const c=await context(tx,commandId),m=c.media??initialAccountSecurityMedia(c.ownerId,commandId,c.cutoffAt);
    if(m.leaseUntilMs>Date.now())return false;tx.update(ref(commandId),{mediaSecurity:{...m,lease,leaseUntilMs:Date.now()+20000}});return true;});
  if(!claimed)return;
  try{for(let i=0;i<(options.maxSteps??3)&&Date.now()<deadline;i++){
    const c=await db.runTransaction(tx=>context(tx,commandId)),m=c.media;if(!m||m.lease!==lease)break;
    if(m.objectsPending>0&&(i%2===0||m.cursor.reachedEnd&&m.cursor.chatQueue.length===0))await objectStep(commandId,lease,deadline);
    else if(!m.cursor.reachedEnd||m.cursor.chatQueue.length)await scan(commandId,lease);else break;
  }}finally{await db.runTransaction(async tx=>{const c=await context(tx,commandId);if(c.media?.lease===lease)tx.update(ref(commandId),{mediaSecurity:{...c.media,lease:null,leaseUntilMs:0,updatedAt:Timestamp.now()}});});}
}
/** Existing scheduled job's bounded independent phase. Rotating the native
 * audit locators also finds pre-feature commands. No root collection/index. */
export async function retryAccountSecurityMedia(){
  const deadline=Date.now()+ACCOUNT_SECURITY_MEDIA_LIMITS.scheduledMs,cursorRef=db.collection('job_locks').doc('accountSecurityMedia_cursor'),cursor=(await cursorRef.get()).data()?.lastId;
  let q:FirebaseFirestore.Query=db.collection('eligibility_audit').where('action','==','account_security_containment').orderBy('__name__').limit(3);if(typeof cursor==='string')q=q.startAfter(cursor);
  let page=await q.get();if(page.empty&&typeof cursor==='string')page=await db.collection('eligibility_audit').where('action','==','account_security_containment').orderBy('__name__').limit(3).get();
  for(const row of page.docs){if(Date.now()>=deadline)break;try{if(row.data().state!=='neutralized')await advanceAccountSecurityMedia(row.id,{deadlineMs:deadline,maxSteps:8});}catch{/* an unknown/malformed old row never blocks money */}
    await cursorRef.set({lastId:row.id,updatedAt:Timestamp.now()},{merge:true});}
}
