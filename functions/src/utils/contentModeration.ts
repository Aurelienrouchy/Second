/** Source-bound content decisions. No refund, identity sanction or finding of fault. */
import {Timestamp} from 'firebase-admin/firestore';
import {createHash, randomUUID} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {db, storage} from '../config/firebase';
import {supportUid, supportObject, supportRequestId, supportText, supportHash, supportSourceHash, supportRevision,
  supportCurrentAdminSession, supportAdmin} from './supportRequest';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from './eligibility';
import {prepareOperationalNotices, readOperationalNoticeReceipts} from './notifications';
import {messageReportProjection} from './messageReportEvidence';
import {sourceImageWitness, preservePrivateImage, readPrivateImage} from './privateMedia';
import {CONTENT_SAFETY_CAPABILITY, CONTENT_SAFETY_ENABLED, contentCaseId, contentCaseRef, readNativeReview,
  publicReviewVisible, prepareVisibleRating} from './reviewVisibility';
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
export const CONTENT_MODERATION_OPERATIONS = new Set(['contentModerationPreview','contentModerationCommand','contentModerationHistory','readContentOriginalFile','readChatMessageImage']);
const reasons = ['review_pressure','refund_pressure','threat','personal_information'];
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const native = (v: unknown): v is Timestamp => v instanceof Timestamp && v.toMillis() > 0 && v.toMillis() <= Date.now();
const id = (v: unknown): string => {
  if (typeof v !== 'string' || !v || v.includes('/') || ['.','..'].includes(v) || /^__.*__$/.test(v) || Buffer.byteLength(v,'utf8') > 1500)
    throw new HttpsError('invalid-argument','Référence native requise.'); return v;
};
const effects = {refundAuthorized:false, banAuthorized:false, faultEstablished:false, physicalReceiptVerified:false,
  deliveredCopiesErasureVerified:false, bearerUrlRevocation:'unknown'} as const;
type Target = {targetType:'review'|'message'; targetId:string};
type Reference = {id:string;contentHash:string;version:number};
type Command = Target & {scope:'own'|'admin';action:'report'|'maintain'|'hide'|'restore'|'contest';reportId:string|null;
  sourceHash:string;previewId:string;reason:string;description:string|null;urgency:'yes'|'no'|'unknown';
  privateNote:string|null;ownerMessage:string|null;decisionReference:Reference|null;acknowledged:true;ratingAloneIsNotRemovalGround:true};
export type ContentModerationCommand = Command;
export type ContentModerationDecisionReference = Reference;
const receiptRef = (uid:string,requestId:string) => db.collection('content_moderation_commands').doc(supportHash([uid,requestId]));
const entryId = (uid:string,requestId:string) => 'cd_'+supportHash([uid,requestId]);
function target(raw:any):Target {if (!['review','message'].includes(raw.targetType)) throw new HttpsError('invalid-argument','Contenu exact requis.'); return {targetType:raw.targetType,targetId:id(raw.targetId)};}
function reference(raw:unknown):Reference {const r=supportObject(raw,['id','contentHash','version']);
  if(!/^cd_[a-f0-9]{64}$/.test(r.id??'')||!hash(r.contentHash)||!Number.isSafeInteger(r.version)||r.version<1) throw new HttpsError('invalid-argument','Version exacte de décision requise.');
  return {id:r.id,contentHash:r.contentHash,version:r.version};}
function commandInput(raw:unknown):Command {
  const c=supportObject(raw,['targetType','targetId','scope','action','reportId','sourceHash','previewId','reason','description','urgency','privateNote','ownerMessage','decisionReference','acknowledged','ratingAloneIsNotRemovalGround']);
  if(!['own','admin'].includes(c.scope)||!hash(c.sourceHash)||!hash(c.previewId)||!reasons.includes(c.reason)||!['yes','no','unknown'].includes(c.urgency)||
    c.acknowledged!==true||c.ratingAloneIsNotRemovalGround!==true||!(c.scope==='admin'?['maintain','hide','restore']:['report','contest']).includes(c.action)||
    (c.action==='report'?(c.reportId!==null||c.targetType!=='review'):c.reportId===null)||
    (c.action==='contest'?c.decisionReference===null:c.decisionReference!==null)||
    (c.scope==='own'?(c.privateNote!==null||c.ownerMessage!==null):c.privateNote===null||c.ownerMessage===null)) throw new HttpsError('invalid-argument','Intention de contenu et motif explicites requis.');
  return {...target(c),scope:c.scope,action:c.action,reportId:c.reportId===null?null:id(c.reportId),sourceHash:c.sourceHash,previewId:c.previewId,
    reason:c.reason,description:c.description===null?null:supportText(c.description,'Description sans recopier de renseignements sensibles',1000),urgency:c.urgency,
    privateNote:c.privateNote===null?null:supportText(c.privateNote,'Motivation privée',4000),ownerMessage:c.ownerMessage===null?null:supportText(c.ownerMessage,'Message communiqué',2000),
    decisionReference:c.decisionReference===null?null:reference(c.decisionReference),acknowledged:true,ratingAloneIsNotRemovalGround:true};
}
async function operator(tx:FirebaseFirestore.Transaction,request:any,uid:string) {
  await assertPrivateAccountSession(request,tx);
  await supportCurrentAdminSession(request); await supportAdmin(tx,uid,false); assertRecentAccountAuthentication(request.auth.token);
  if(request.auth.token.auth_time*1000>Date.now())throw new HttpsError('permission-denied','Horloge de session opérateur non qualifiée.');
  await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);
}

const CHAT_IMAGE_PROTOCOL='chat_message_image_v1';
const CHAT_IMAGE_MAX_BYTES=10*1024*1024;
const chatImageRefHash=(bucket:string,path:string)=>createHash('sha256').update(JSON.stringify(['chat_message_image_reference_v1',bucket,path])).digest('hex');
const chatPath=(path:string,chatId:string)=>path.startsWith(`chat_images/${chatId}/`) && Buffer.byteLength(path,'utf8')<=1500 &&
  !/[\u0000-\u001f\u007f-\u009f]/.test(path) && !path.split('/').some(p=>!p||p==='.'||p==='..'||p.includes('\\'));
function chatImageReference(value:unknown,chatId:string) {
  const bucket=storage.bucket().name;let path:string;
  try {
    if(typeof value!=='string')throw new Error();
    if(value.startsWith(`gs://${bucket}/`))path=value.slice(bucket.length+6).split(/[?#]/,1)[0];
    else {
      const url=new URL(value),rawPath=/^https?:\/\/[^/?#]+([^?#]*)/.exec(value)?.[1];
      const match=rawPath?/^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(rawPath):null;
      const emulator=process.env.FUNCTIONS_EMULATOR==='true'&&process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      const emulatorOrigin=emulator?new URL(/^https?:\/\//.test(emulator)?emulator:`http://${emulator}`).origin:null;
      if(!match || !["https://firebasestorage.googleapis.com",emulatorOrigin].includes(url.origin) || url.username || url.password ||
          decodeURIComponent(match[1])!==bucket)throw new Error();path=decodeURIComponent(match[2]);
    }
    if(!chatPath(path,chatId))throw new Error();
  }catch{throw new HttpsError('failed-precondition','Référence de photo native non qualifiée.',{reason:'chat_image_reference_unqualified'});}
  return {bucket,path,referenceHash:chatImageRefHash(bucket,path)};
}
async function chatImageSource(tx:FirebaseFirestore.Transaction,request:any,chatId:string,messageId:string,fileKind:string,expectedHash:string) {
  await assertPrivateAccountSession(request,tx);const uid=request.auth.uid;
  const chat=(await tx.get(db.collection('chats').doc(chatId))).data(),parties=chat?.participants;
  if(!Array.isArray(parties)||parties.length!==2||new Set(parties).size!==2||!parties.includes(uid)||parties.some(p=>typeof p!=='string'||!p||p.includes('/')))
    throw new HttpsError('permission-denied','Conversation participante indisponible.');
  const message=(await tx.get(db.collection('messages').doc(messageId))).data();
  if(!message||message.chatId!==chatId||message.type!=='image'||!parties.includes(message.senderId)||
      message.receiverId!=null&&message.receiverId!==parties.find(p=>p!==message.senderId)||
      message.participants!=null&&(!Array.isArray(message.participants)||message.participants.length!==2||new Set(message.participants).size!==2||message.participants.some((p:any)=>!parties.includes(p))))
    throw new HttpsError('permission-denied','Photo du message indisponible.');
  const reference=chatImageReference(message.image?.[fileKind==='image'?'url':'thumbnail'],chatId);
  if(reference.referenceHash!==expectedHash)throw new HttpsError('aborted','La référence de cette photo a changé.',{reason:'chat_image_reference_changed'});
  const restriction=(await tx.get(db.collection('chat_media_restrictions').doc(chatId))).data();
  if(restriction) {
    const holds=restriction.holds,blocked=restriction.blockedPaths;
    if(restriction.protocol!=='content_chat_restrictions_v1'||restriction.chatId!==chatId||!holds||typeof holds!=='object'||Array.isArray(holds)||
        Object.keys(holds).length>500||!Array.isArray(blocked)||blocked.length>1000||blocked.some(p=>typeof p!=='string'||!chatPath(p,chatId))||
        Object.values(holds).some(paths=>!Array.isArray(paths)||paths.length>2||paths.some(p=>typeof p!=='string'||!chatPath(p,chatId)))||
        supportHash([...new Set(Object.values(holds).flat())].sort())!==supportHash([...blocked].sort())||blocked.includes(reference.path))
      throw new HttpsError('permission-denied','Cette photo fait l’objet d’une restriction de visibilité.');
  }
  const root=(await tx.get(contentCaseRef('message',messageId))).data(),marker=message.contentModeration,current=root?.current;
  if(root&&(root.protocol!=='content_moderation_case_v1'||root.targetType!=='message'||root.targetId!==messageId||!Number.isSafeInteger(root.version)||root.version<1)||
      Object.prototype.hasOwnProperty.call(message,'contentModeration')&&(!marker||marker.protocol!=='content_visibility_v1'||marker.state!=='visible'||
        marker.caseId!==contentCaseId('message',messageId)||!/^cd_[a-f0-9]{64}$/.test(marker.decisionId??'')||!Number.isSafeInteger(marker.version)||marker.version<1)||
      root&&Object.prototype.hasOwnProperty.call(root,'current')&&(!current||current.state!=='visible'||!hash(current.contentHash)||
        !/^cd_[a-f0-9]{64}$/.test(current.decisionId??'')||!Number.isSafeInteger(current.version)||current.version<1||current.version>root.version||
        !marker||current.version<marker.version)||marker&&!current)
    throw new HttpsError('permission-denied','Cette photo ne permet pas de lecture participante.');
  if(current) {
    const decision=await proof(tx,{targetType:'message',targetId:messageId},{id:current.decisionId,contentHash:current.contentHash,version:current.version});
    if(!decision||!['maintain','restore'].includes(decision.command.action)||decision.visibilityAtCommit!=='visible')
      throw new HttpsError('permission-denied','La visibilité native de cette photo doit être requalifiée.');
  }
  const sourceHash=supportHash([CHAT_IMAGE_PROTOCOL,uid,chatId,messageId,fileKind,[...parties].sort(),message.senderId,message.receiverId??null,
    reference.referenceHash,marker?{state:marker.state,decisionId:marker.decisionId,version:marker.version,currentDecisionId:current.decisionId,contentHash:current.contentHash}:null]);
  return {...reference,sourceHash};
}
/** Pixels of the current participant message, never an original report body,
 * free path or bearer URL. Ordinary chat traffic is not an authorization source. */
async function readChatMessageImage(request:any,endpoint:string) {
  const raw=supportObject(request.data,['operation','capability','expectedUid','chatId','messageId','fileKind','sourceReferenceHash']);
  if(endpoint!=='submitReport'||raw.capability!==CHAT_IMAGE_PROTOCOL||!['image','thumbnail'].includes(raw.fileKind)||!hash(raw.sourceReferenceHash))
    throw new HttpsError('invalid-argument','Lecture participante et référence exactes requises.');
  const chatId=id(raw.chatId),messageId=id(raw.messageId),fileKind=raw.fileKind;
  const before=await db.runTransaction(tx=>chatImageSource(tx,request,chatId,messageId,fileKind,raw.sourceReferenceHash));
  const file=storage.bucket().file(before.path),[metadata]=await file.getMetadata(),size=Number(metadata.size),generation=String(metadata.generation);
  if(!/^[1-9][0-9]*$/.test(generation)||!Number.isSafeInteger(size)||size<=0||size>=CHAT_IMAGE_MAX_BYTES||
      !/^image\/(jpeg|png|webp|heic|heif|gif)$/.test(metadata.contentType??'')||!/^[A-Za-z0-9+/]{6}==$/.test(metadata.crc32c??''))
    throw new HttpsError('failed-precondition','Les métadonnées de cette photo ne sont pas qualifiées.',{reason:'chat_image_metadata_unqualified'});
  const [bytes]=await storage.bucket().file(before.path,{generation}).download({validation:'crc32c'}),[after]=await file.getMetadata();
  if(bytes.byteLength!==size||String(after.generation)!==generation||after.crc32c!==metadata.crc32c||Number(after.size)!==size||after.contentType!==metadata.contentType)
    throw new HttpsError('aborted','La génération de cette photo a changé.',{reason:'chat_image_generation_changed'});
  await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const current=await chatImageSource(tx,request,chatId,messageId,fileKind,raw.sourceReferenceHash);
    if(current.sourceHash!==before.sourceHash)throw new HttpsError('aborted','La source de cette photo a changé.',{reason:'chat_image_source_changed'});});
  return {protocol:CHAT_IMAGE_PROTOCOL,viewerId:request.auth.uid,chatId,messageId,fileKind,sourceReferenceHash:before.referenceHash,sourceHash:before.sourceHash,
    generation,contentType:metadata.contentType,size,dataUrl:`data:${metadata.contentType};base64,${bytes.toString('base64')}`};
}
function originalBody(raw:any,t:Target) {return raw?.protocol==='content_original_v1'&&raw.targetType===t.targetType&&raw.targetId===t.targetId&&native(raw.recordedAt)&&
  raw.body&&hash(raw.sourceHash)&&supportSourceHash(raw.body)===raw.sourceHash?raw.body:null;}
async function source(tx:FirebaseFirestore.Transaction,t:Target,reportId:string|null) {
  const reportSnap=reportId?await tx.get(db.collection('reports').doc(reportId)):null,report=reportSnap?.data();
  if(reportId&&(!report||report.targetType!==t.targetType||report.targetId!==t.targetId||typeof report.reporterId!=='string')) throw new HttpsError('permission-denied','Dossier de contenu non qualifié.');
  const rootSnap=await tx.get(contentCaseRef(t.targetType,t.targetId)),root=rootSnap.data();
  const rootQualified=root==null||root.protocol==='content_moderation_case_v1'&&root.targetType===t.targetType&&root.targetId===t.targetId&&Number.isSafeInteger(root.version)&&root.version>0;
  let ref=db.collection(t.targetType==='review'?'avis':'messages').doc(t.targetId),snap=await tx.get(ref),body=snap.data(),parties:string[]=[],parent:any=null,eligible=false;
  let review:Awaited<ReturnType<typeof readNativeReview>>=null,messageEvidence:any=null;
  if(t.targetType==='review') {review=await readNativeReview(tx,t.targetId);if(review){parties=review.parties;parent={kind:review.kind,id:review.parent.id,revision:supportRevision(review.parent)};eligible=true;}}
  else if(body&&typeof body.chatId==='string') {
    const chat=await tx.get(db.collection('chats').doc(id(body.chatId))),ps=chat.data()?.participants;
    if(Array.isArray(ps)&&ps.length===2&&new Set(ps).size===2&&ps.every(p=>typeof p==='string'&&p&&!p.includes('/'))&&ps.includes(body.senderId)&&
      (body.receiverId==null||body.receiverId===ps.find(p=>p!==body.senderId))) {parties=ps;parent={kind:'chat',id:chat.id,revision:supportRevision(chat),data:chat.data()};eligible=['text','image'].includes(body.type);}
    if(report) messageEvidence=await messageReportProjection(tx,reportId!,report,true);
  }
  const saved=root?.original&&hash(root.original)?await tx.get(contentCaseRef(t.targetType,t.targetId).collection('originals').doc(root.original)):null;
  const original=originalBody(saved?.data(),t);
  let reportEvidence:any=null;
  const er=report?.contentEvidence;
  if(t.targetType==='review'&&er?.protocol==='content_report_reference_v1'&&/^cd_[a-f0-9]{64}$/.test(er.entryId??'')&&hash(er.contentHash)&&Number.isSafeInteger(er.version)) {
    const e=await proof(tx,t,{id:er.entryId,contentHash:er.contentHash,version:er.version});
    const saved=(await tx.get(db.collection('reports').doc(reportId!).collection('native_evidence').doc(er.entryId))).data();
    if(e?.command.action==='report'&&e.reportId===reportId&&saved?.protocol==='content_review_evidence_v1'&&saved.entryHash===er.contentHash&&
      saved.body&&supportSourceHash(saved.body)===e.sourceCapture.contentHash&&native(saved.recordedAt)&&saved.recordedAt.isEqual(e.recordedAt))
      reportEvidence={qualification:'native_report_capture',body:saved.body,sourceHash:e.sourceCapture.contentHash,recordedAt:saved.recordedAt.toDate().toISOString()};
  }
  const capture={protocol:'content_moderation_source_v1',...target(t),reportId,reportRevision:reportSnap?supportRevision(reportSnap):null,
    reportHash:supportSourceHash(report??null),contentRevision:snap.exists?supportRevision(snap):null,contentHash:supportSourceHash(body??null),
    caseVersion:rootQualified?root?.version??0:null,caseHash:supportSourceHash(root??null),originalHash:original?root?.original:null,
    parent:parent?{kind:parent.kind,id:parent.id,revision:parent.revision}:null,parties};
  return {t:target(t),ref,snap,body,reportSnap,report,root,rootQualified,original,review,messageEvidence,reportEvidence,parent,parties,eligible,
    qualification:rootQualified&&snap.exists&&parties.length===2?'native_content':'unknown',capture,sourceHash:supportSourceHash(capture)};
}
const previewId=(uid:string,scope:string,s:Awaited<ReturnType<typeof source>>,selected?:Reference|null) => supportHash([CONTENT_SAFETY_CAPABILITY,uid,scope,s.sourceHash,...(selected?[selected]:[])]);
function notices(d:any) {return d.recipientIds.map((userId:string)=>({eventKey:`content_safety:${d.entryId}`,userId,type:'moderation_update',title:'Examen d’un contenu',
  message:d.command.ownerMessage??'Un signalement ou une contestation a été enregistré pour examen humain. Cela ne décide ni d’un remboursement ni d’une sanction de compte.',
  data:{ownerId:userId,reportId:d.reportId,contentCaseId:d.caseId,contentEntryId:d.entryId,contentEntryHash:supportSourceHash(d),contentEntryVersion:String(d.version),
    contentTargetType:d.command.targetType,contentTargetId:d.command.targetId,contentSafetyCapability:CONTENT_SAFETY_CAPABILITY}}));}
async function proof(tx:FirebaseFirestore.Transaction,t:Target,r:Reference) {
  const row=(await tx.get(contentCaseRef(t.targetType,t.targetId).collection('entries').doc(r.id))).data(),d=row?.document;
  if(row?.protocol!=='content_moderation_entry_v1'||!d||supportSourceHash(d)!==r.contentHash||row.contentHash!==r.contentHash||d.entryId!==r.id||
    d.caseId!==contentCaseId(t.targetType,t.targetId)||d.command.targetType!==t.targetType||d.command.targetId!==t.targetId||d.version!==r.version||!native(d.recordedAt)||
    !Array.isArray(d.recipientIds)||d.recipientIds.length<2||d.recipientIds.length>3||entryId(d.actorId,d.requestId)!==r.id) return null;
  let command:Command;try{command=commandInput(d.command);}catch{return null;}
  if(d.recipientIds.some((v:any)=>typeof v!=='string'||!v||v.includes('/'))||new Set(d.recipientIds).size!==d.recipientIds.length||
    !d.recipientIds.includes(d.actorId)&&command.scope==='own'||d.sourceCapture?.caseVersion!==d.version-1||
    Object.entries(effects).some(([k,v])=>d[k]!==v)||command.scope==='admin'&&(d.operatorAuthority?.actorId!==d.actorId||
      d.operatorAuthority.privateRoleQualified!==true||!Number.isSafeInteger(d.operatorAuthority.authTime)||d.operatorAuthority.authTime<1||d.operatorAuthority.authTime*1000>d.recordedAt.toMillis()))return null;
  const receipt=(await tx.get(receiptRef(d.actorId,d.requestId))).data();
  if(supportHash(command)!==d.payloadHash||supportSourceHash(d.sourceCapture)!==command.sourceHash||
    receipt?.protocol!=='content_moderation_command_v1'||receipt.actorId!==d.actorId||receipt.requestId!==d.requestId||receipt.state!=='committed'||
    receipt.payloadHash!==d.payloadHash||supportHash(receipt.command)!==d.payloadHash||receipt.entryId!==r.id||receipt.contentHash!==r.contentHash||
    !native(receipt.recordedAt)||!receipt.recordedAt.isEqual(d.recordedAt)) return null;
  const n=await readOperationalNoticeReceipts(tx,notices(d));
  if(!Array.isArray(receipt.notificationIds)||n.some((p,i)=>!p||p.notificationId!==receipt.notificationIds[i]))return null;
  return d;
}
function entryView(d:any,admin:boolean,uid?:string) {return {reference:{id:d.entryId,contentHash:supportSourceHash(d),version:d.version},action:d.command.action,
  reason:d.command.reason,description:admin||d.actorId===uid?d.command.description:null,urgency:d.command.urgency,ownerMessage:d.command.ownerMessage,
  privateNote:admin?d.command.privateNote:null,relatedDecision:d.command.decisionReference,visibilityAtCommit:d.visibilityAtCommit,
  recordedAt:d.recordedAt.toDate().toISOString(),historicalOnly:true,...effects};}
function receiptView(uid:string,requestId:string,command:Command,d?:any) {return {protocol:'content_moderation_command_v1',actorId:uid,requestId,command,payloadHash:supportHash(command),
  state:d?.state??'unrecorded',reason:d?.reason??null,reportId:d?.reportId??null,caseId:d?.caseId??null,entryId:d?.entryId??null,
  entryReference:d?.entryId?{id:d.entryId,contentHash:d.contentHash,version:d.version}:null,recordedAt:native(d?.recordedAt)?d.recordedAt.toDate().toISOString():null,
  documentNeutralizedAtCommit:d?.documentNeutralizedAtCommit??false,storageSdkRestrictionAtCommit:d?.storageSdkRestrictionAtCommit??false,...effects};}
function imagePaths(body:any,chatId:string) {
  if(body.type!=='image')return [];
  const bucket=storage.bucket().name,paths:string[]=[];
  for(const value of [body.image?.url,body.image?.thumbnail]) {if(typeof value!=='string')continue;try{
    let path:string;
    if(value.startsWith(`gs://${bucket}/`))path=value.slice(bucket.length+6);
    else {const u=new URL(value),m=/^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(u.pathname);if(u.origin!=='https://firebasestorage.googleapis.com'||!m||decodeURIComponent(m[1])!==bucket)continue;path=decodeURIComponent(m[2]);}
    if(path.startsWith(`chat_images/${chatId}/`)&&!path.split('/').some(p=>!p||p==='.'||p==='..'||p.includes('\\')))paths.push(path);
  }catch{/* An arbitrary/legacy URL is retained privately, never fetched. */}}
  return [...new Set(paths)];
}
const contentMediaRef = (t:Target,eid:string) => contentCaseRef(t.targetType,t.targetId).collection('media').doc(eid);
function preservedMedia(row:any,t:Target,eid:string) {
  const p=row?.preservation;
  return p?.sourcePath===row.sourcePath&&p.sourceGeneration===row.sourceGeneration&&/^\d+$/.test(p.sourceGeneration??'')&&
    /^\d+$/.test(p.privateGeneration??'')&&typeof p.sourceCrc32c==='string'&&/^[A-Za-z0-9+/]{6}==$/.test(p.sourceCrc32c)&&
    Number.isSafeInteger(p.size)&&p.size>0&&p.size<10*1024*1024&&typeof p.contentType==='string'&&p.contentType.startsWith('image/')&&
    p.privatePath===`content_moderation_media/${contentCaseId(t.targetType,t.targetId)}/${eid}/${supportHash(row.sourcePath)}`&&hash(p.sha256)&&native(p.observedAt);
}
function nativeMediaAuthorization(row:any,t:Target,r:Reference,actorId:string,kind:'copy'|'revocation') {
  const a=row?.[kind+'Authorization'];
  if(!a)return false;
  const {proofHash,...body}=a;
  return a.protocol===`content_media_${kind}_authorization_v1`&&a.actorId===actorId&&a.decisionId===r.id&&a.sourcePathHash===supportHash(row.sourcePath)&&
    a.sourceGeneration===row.sourceGeneration&&/^\d+$/.test(a.sourceGeneration??'')&&native(a.authorizedAt)&&proofHash===supportHash(body)&&
    (kind==='copy'?a.privatePath===`content_moderation_media/${contentCaseId(t.targetType,t.targetId)}/${r.id}/${supportHash(row.sourcePath)}`&&
      a.witness?.sourceGeneration===row.sourceGeneration&&/^[A-Za-z0-9+/]{6}==$/.test(a.witness?.sourceCrc32c??'')&&
      Number.isSafeInteger(a.witness?.size)&&a.witness.size>0&&a.witness.size<CHAT_IMAGE_MAX_BYTES&&/^image\//.test(a.witness?.contentType??''):
      /^\d+$/.test(a.metageneration??'')&&a.bodyHash===supportHash({cacheControl:'private, no-store',metadata:{firebaseStorageDownloadTokens:null}}));
}
function mediaView(value:any) {
  const rows=Array.isArray(value?.objects)?value.objects:[],qualified=value?.protocol==='content_media_withdrawal_v1'&&rows.length<=2;
  const preserved=qualified?rows.filter((r:any)=>r.preservation?.sourcePath===r.sourcePath&&hash(r.preservation?.sha256)&&native(r.preservation?.observedAt)):[];
  const revoked=preserved.filter((r:any)=>r.revocation?.sourceGeneration===r.preservation.sourceGeneration&&native(r.revocation?.observedAt));
  return {protocol:'content_media_withdrawal_view_v1',state:!value?'not_required':!qualified?'unknown':rows.length>0&&revoked.length===rows.length?'observed_revoked':
    value.attempts>=3?'needs_review':value.state==='pending'?'pending':'unknown',managedObjectCount:qualified?rows.length:null,
    privatelyPreservedCount:qualified?preserved.length:null,revokedObjectCount:qualified?revoked.length:null,
    referenceCoverage:qualified?value.referenceCoverage:'unknown',observedAt:revoked.length===rows.length&&rows.length>0?
      new Date(Math.max(...revoked.map((r:any)=>r.revocation.observedAt.toMillis()))).toISOString():null,
    priorBearerAccessRestored:false,externalUrlsWithdrawalVerified:false,deliveredCopiesErasureVerified:false};
}
/** The immutable hide receipt authorizes no new IO after role loss. GET/replay
 * remain possible; each new copy/PATCH has its own bounded, native lease. */
async function mediaContext(tx:FirebaseFirestore.Transaction,t:Target,r:Reference) {
  const d=await proof(tx,t,r),ref=contentMediaRef(t,r.id),snap=await tx.get(ref),value=snap.data();
  if(!d||d.command.action!=='hide'||t.targetType!=='message')return null;
  const original=(await tx.get(contentCaseRef(t.targetType,t.targetId).collection('originals').doc(d.sourceCapture.contentHash))).data();
  const body=originalBody(original,t),paths=body?imagePaths(body,body.chatId):[];
  if(!value||value.protocol!=='content_media_withdrawal_v1'||value.actorId!==d.actorId||value.requestId!==d.requestId||
    supportHash(value.reference)!==supportHash(r)||!body||body.type!=='image'||supportSourceHash(body)!==d.sourceCapture.contentHash||
    !Array.isArray(value.objects)||supportHash(value.objects.map((o:any)=>o.sourcePath))!==supportHash(paths)||
    !Number.isSafeInteger(value.attempts)||value.attempts<0||value.attempts>3||
    value.objects.some((o:any)=>Object.prototype.hasOwnProperty.call(o,'copyAuthorization')&&!nativeMediaAuthorization(o,t,r,d.actorId,'copy')||
      Object.prototype.hasOwnProperty.call(o,'revocationAuthorization')&&!nativeMediaAuthorization(o,t,r,d.actorId,'revocation')||o.preservation&&!preservedMedia(o,t,r.id)||o.revocation&&(!o.preservation||
      o.revocation.sourceGeneration!==o.sourceGeneration||!/^\d+$/.test(o.revocation.metageneration??'')||!native(o.revocation.observedAt))))return null;
  const current=(await tx.get(db.collection('messages').doc(t.targetId))).data(),restriction=(await tx.get(db.collection('chat_media_restrictions').doc(body.chatId))).data();
  const active=current?.contentModeration?.protocol==='content_visibility_v1'&&current.contentModeration.state==='hidden'&&
    current.contentModeration.decisionId===r.id&&restriction?.protocol==='content_chat_restrictions_v1'&&
    supportHash(restriction.holds?.[d.caseId])===supportHash(paths);
  return {ref,value,d,active};
}
async function mediaResultInTransaction(tx:FirebaseFirestore.Transaction,t:Target,r:Reference) {
  if(!hash(r.contentHash)||!Number.isSafeInteger(r.version))return mediaView({});
  const c=await mediaContext(tx,t,r);if(c)return mediaView(c.value);
  const d=await proof(tx,t,r),saved=d?(await tx.get(contentCaseRef(t.targetType,t.targetId).collection('originals').doc(d.sourceCapture.contentHash))).data():null;
  const body=originalBody(saved,t);return mediaView(t.targetType==='review'||body&&body.type!=='image'?null:{});
}
async function mediaResult(request:any,t:Target,r:Reference,execute:boolean) {
  const first=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);
    const c=await mediaContext(tx,t,r);if(c)return {value:c.value,required:true};
    const d=await proof(tx,t,r),original=d?(await tx.get(contentCaseRef(t.targetType,t.targetId).collection('originals').doc(d.sourceCapture.contentHash))).data():null;
    const body=originalBody(original,t);return {value:null,required:t.targetType==='message'&&(!body||body.type==='image')};
  });
  let initial=first.value;if(!first.required)return mediaView(null);
  if(!execute||!initial||mediaView(initial).state==='observed_revoked'||initial.objects.length===0)return mediaView(initial??{});
  // Exact GET reconciliation remains possible after role loss or the third
  // attempt. It cannot create a copy or remove another token.
  for(let i=0;i<initial.objects.length;i++) {
    let row=initial.objects[i];if(row.revocation)continue;
    try {
      if(!row.preservation&&nativeMediaAuthorization(row,t,r,initial.actorId,'copy')) {
        const authorization=row.copyAuthorization,[m]=await storage.bucket().file(authorization.privatePath).getMetadata();
        const bytes=await readPrivateImage(authorization.privatePath,{...authorization.witness,privateGeneration:String(m.generation)},r.id,supportHash(row.sourcePath));
        const preservation={...authorization.witness,sourcePath:row.sourcePath,privatePath:authorization.privatePath,privateGeneration:String(m.generation),
          sha256:createHash('sha256').update(bytes).digest('hex'),observedAt:Timestamp.now()};
        const next={...row,preservation};
        if(!preservedMedia(next,t,r.id))continue;
        const recorded=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const c=await mediaContext(tx,t,r);
          if(!c||supportSourceHash(c.value.objects[i])!==supportSourceHash(row))return false;const objects=[...c.value.objects];objects[i]=next;
          tx.update(c.ref,{objects,updatedAt:Timestamp.now()});return true;});
        if(!recorded)continue;row=next;
      }
      if(!preservedMedia(row,t,r.id))continue;
      const p=row.preservation,bytes=await readPrivateImage(p.privatePath,p,r.id,supportHash(row.sourcePath));
      if(createHash('sha256').update(bytes).digest('hex')!==p.sha256)continue;
      const [m]=await storage.bucket().file(row.sourcePath).getMetadata();
      if(String(m.generation)!==row.sourceGeneration||m.metadata?.firebaseStorageDownloadTokens!=null||m.cacheControl!=='private, no-store'||!/^\d+$/.test(String(m.metageneration)))continue;
      await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const c=await mediaContext(tx,t,r);if(!c||supportSourceHash(c.value.objects[i])!==supportSourceHash(row))return;
        const objects=[...c.value.objects];objects[i]={...row,revocation:{sourceGeneration:row.sourceGeneration,metageneration:String(m.metageneration),observedAt:Timestamp.now()}};
        tx.update(c.ref,{objects,updatedAt:Timestamp.now()});});
    }catch{/* No absence or success is inferred from an unsuccessful GET. */}
  }
  initial=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);return (await mediaContext(tx,t,r))?.value??null;});
  if(!initial||mediaView(initial).state==='observed_revoked'||!CONTENT_SAFETY_ENABLED)return mediaView(initial??{});
  const lease=randomUUID();
  try {
    const reserved=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);
      const c=await mediaContext(tx,t,r);if(!c||!c.active||c.value.attempts>=3||
        c.value.leaseUntil instanceof Timestamp&&c.value.leaseUntil.toMillis()>Date.now())return null;
      await operator(tx,request,request.auth.uid);
      const actorId=supportUid(request);
      if(c.d.actorId!==actorId)throw new HttpsError('permission-denied','Reprise opérateur exacte requise.');
      const value={...c.value,actorId,objects:c.value.objects,attempts:c.value.attempts+1,state:'unknown',lease,leaseUntil:Timestamp.fromMillis(Date.now()+60000)};
      tx.set(c.ref,value);return value;
    });
    if(!reserved)return mediaView(initial);
    const checkpoint=async (index:number,row:any,authorize=false)=>db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);
      const c=await mediaContext(tx,t,r);if(!c||c.value.lease!==lease)return false;
      if(authorize){if(!c.active||c.value.leaseUntil.toMillis()<=Date.now())return false;await operator(tx,request,request.auth.uid);}
      if(row){const objects=[...c.value.objects];objects[index]=row;tx.update(c.ref,{objects,updatedAt:Timestamp.now()});}return true;
    });
    for(let i=0;i<reserved.objects.length;i++) {
      let row=reserved.objects[i];if(row.revocation)continue;
      const sourceFile=storage.bucket().file(row.sourcePath),mid=supportHash(row.sourcePath);
      const privatePath=`content_moderation_media/${contentCaseId(t.targetType,t.targetId)}/${r.id}/${mid}`;
      let witness;
      if(!preservedMedia(row,t,r.id)) {
        // An earlier native authorization (or legacy pre-IO generation) may
        // already have reached Storage. Only the GET recovery above can resume.
        if(row.sourceGeneration||Object.prototype.hasOwnProperty.call(row,'copyAuthorization')||Object.prototype.hasOwnProperty.call(row,'revocationAuthorization'))continue;
        const [metadata]=await sourceFile.getMetadata();witness=sourceImageWitness(metadata);
        const copyBody={protocol:'content_media_copy_authorization_v1',actorId:request.auth.uid,decisionId:r.id,sourcePathHash:mid,
          sourceGeneration:witness.sourceGeneration,privatePath,witness,authorizedAt:Timestamp.now()};
        row={...row,sourceGeneration:witness.sourceGeneration,copyAuthorization:{...copyBody,proofHash:supportHash(copyBody)}};
        if(!await checkpoint(i,row,true))break;
        const privateGeneration=await preservePrivateImage(row.sourcePath,privatePath,witness,r.id,mid);
        const bytes=await readPrivateImage(privatePath,{...witness,privateGeneration},r.id,mid);
        const sha256=createHash('sha256').update(bytes).digest('hex');
        row={...row,preservation:{...witness,sourcePath:row.sourcePath,privatePath,privateGeneration,sha256,observedAt:Timestamp.now()}};
        if(!await checkpoint(i,row,true))break;
      } else witness=row.preservation;
      // Preserve a real first copy while allowing its not-yet-authorized first
      // PATCH. A prior unknown PATCH is observed, never posted a second time.
      if(!nativeMediaAuthorization(row,t,r,reserved.actorId,'copy')||Object.prototype.hasOwnProperty.call(row,'revocationAuthorization'))continue;
      const [fresh]=await sourceFile.getMetadata();
      if(String(fresh.generation)!==witness.sourceGeneration||!/^\d+$/.test(String(fresh.metageneration)))throw new Error('source_generation_changed');
      const patchBody={cacheControl:'private, no-store',metadata:{firebaseStorageDownloadTokens:null}};
      const revocationBody={protocol:'content_media_revocation_authorization_v1',actorId:request.auth.uid,decisionId:r.id,sourcePathHash:mid,
        sourceGeneration:witness.sourceGeneration,metageneration:String(fresh.metageneration),bodyHash:supportHash(patchBody),authorizedAt:Timestamp.now()};
      row={...row,revocationAuthorization:{...revocationBody,proofHash:supportHash(revocationBody)}};
      if(!await checkpoint(i,row,true))break;
      if(fresh.metadata?.firebaseStorageDownloadTokens!=null||fresh.cacheControl!=='private, no-store')await sourceFile.setMetadata(patchBody,
        {ifGenerationMatch:witness.sourceGeneration,ifMetagenerationMatch:String(fresh.metageneration)});
      const [observed]=await sourceFile.getMetadata();
      if(String(observed.generation)!==witness.sourceGeneration||observed.metadata?.firebaseStorageDownloadTokens!=null||
        observed.cacheControl!=='private, no-store'||!/^\d+$/.test(String(observed.metageneration)))throw new Error('revocation_unknown');
      row={...row,revocation:{sourceGeneration:witness.sourceGeneration,metageneration:String(observed.metageneration),observedAt:Timestamp.now()}};
      if(!await checkpoint(i,row))break;
    }
  }catch{/* An ambiguous copy/PATCH remains unknown; no token or raw URL is logged. */}
  await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);const c=await mediaContext(tx,t,r);if(c?.value.lease===lease)tx.update(c.ref,{lease:null,leaseUntil:null,state:'unknown',updatedAt:Timestamp.now()});});
  initial=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);return (await mediaContext(tx,t,r))?.value??null;});return mediaView(initial);
}
export async function handleContentModeration(request:any,endpoint:'submitReport'|'triageReport') {
  return withPrivateAccountSession(request,async()=>{
  if(request.data?.operation==='readChatMessageImage')return readChatMessageImage(request,endpoint);
  const uid=supportUid(request),raw=supportObject(request.data,['operation','capability','expectedUid','scope','targetType','targetId','reportId','decisionReference','cursor','requestId','mode','command','fileKind']);
  if(raw.capability!==CONTENT_SAFETY_CAPABILITY)throw new HttpsError('invalid-argument','Version explicite du contenu requise.');
  const own=endpoint==='submitReport';
  if(raw.operation==='contentModerationCommand') {
    const command=commandInput(raw.command),requestId=supportRequestId(raw.requestId),rref=receiptRef(uid,requestId);
    if(command.scope!==(own?'own':'admin')||!['execute','observe','neutralize'].includes(raw.mode))throw new HttpsError('invalid-argument','Journal et endpoint de même portée requis.');
    const response=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);
      const prior=(await tx.get(rref)).data();
      if(prior){if(prior.protocol!=='content_moderation_command_v1'||prior.actorId!==uid||prior.requestId!==requestId||prior.payloadHash!==supportHash(command)||
          supportHash(prior.command)!==supportHash(command)||!native(prior.recordedAt)||!['committed','not_executed'].includes(prior.state))throw new HttpsError('already-exists','Intention différente.');
        if(prior.state==='committed'&&!await proof(tx,command,{id:prior.entryId,contentHash:prior.contentHash,version:prior.version}))throw new HttpsError('unavailable','Reçu natif à rapprocher.');
        return receiptView(uid,requestId,command,prior);}
      if(raw.mode==='observe')return receiptView(uid,requestId,command);
      const now=Timestamp.now(),refuse=(reason:string)=>{const d={protocol:'content_moderation_command_v1',actorId:uid,requestId,command,payloadHash:supportHash(command),state:'not_executed',reason,recordedAt:now,entryId:null,reportId:null,caseId:null};tx.create(rref,d);return receiptView(uid,requestId,command,d);};
      if(raw.mode==='neutralize')return refuse('requester_neutralized');
      if(!CONTENT_SAFETY_ENABLED)return refuse('content_safety_not_exposed');
      if(own){await supportCurrentAdminSession(request);await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(uid))).data(), tx, uid);}
      else await operator(tx,request,uid);
      const s=await source(tx,command,command.reportId);
      if(own&&!s.parties.includes(uid))return refuse('not_a_native_party');
      if(s.qualification!=='native_content'||!s.rootQualified||s.capture.caseVersion===null||s.capture.caseVersion>=Number.MAX_SAFE_INTEGER-1)return refuse('native_sources_unknown');
      if(command.sourceHash!==s.sourceHash||command.previewId!==previewId(uid,command.scope,s,command.decisionReference))return refuse('source_changed');
      if(command.action==='report'&&!publicReviewVisible(s.body!))return refuse('content_already_unavailable');
      const related=command.decisionReference?await proof(tx,command,command.decisionReference):null;
      if(command.action==='contest'&&(!related||!['maintain','hide','restore'].includes(related.command.action)||!related.recipientIds.includes(uid)))return refuse('decision_reference_unqualified');
      if(['hide','restore'].includes(command.action)&&!s.eligible)return refuse('structured_event_preserved');
      const isHidden=s.body!.contentModeration?.state==='hidden';
      if(command.action==='hide'&&isHidden)return refuse('content_already_unavailable');
      if(command.action==='restore'&&(!isHidden||!s.original))return refuse('original_source_unknown');
      const reportId=command.reportId??'content_'+supportHash([uid,command.targetType,command.targetId]),reportRef=db.collection('reports').doc(reportId);
      if(command.action==='report'&&(await tx.get(reportRef)).exists)return refuse('report_already_exists');
      const version=s.capture.caseVersion+1,eid=entryId(uid,requestId),caseRef=contentCaseRef(command.targetType,command.targetId);
      const original=command.action==='hide'&&!isHidden?s.body!:s.original,originalHash=original?supportSourceHash(original):null;
      if((original&&Buffer.byteLength(JSON.stringify(original),'utf8')>400000)||command.action==='report'&&Buffer.byteLength(JSON.stringify(s.body),'utf8')>400000)return refuse('original_source_unknown');
      const originalRef=originalHash?caseRef.collection('originals').doc(originalHash):null;
      const existingOriginal=originalRef?(await tx.get(originalRef)).data():null;
      if(existingOriginal&&!originalBody(existingOriginal,command))return refuse('original_source_unknown');
      const visibility=command.action==='hide'?'hidden':command.action==='restore'?'visible':isHidden?'hidden':'visible';
      const recipients=[...new Set([...s.parties,s.report?.reporterId??uid])].sort();
      const document={protocol:'content_moderation_entry_v1',entryId:eid,caseId:contentCaseId(command.targetType,command.targetId),reportId,actorId:uid,requestId,
        command,payloadHash:supportHash(command),sourceCapture:s.capture,version,recipientIds:recipients,visibilityAtCommit:visibility,recordedAt:now,
        operatorAuthority:own?null:{actorId:uid,authTime:request.auth.token.auth_time,privateRoleQualified:true},...effects};
      const contentHash=supportSourceHash(document),n=await prepareOperationalNotices(tx,notices(document));
      if((await tx.get(caseRef.collection('entries').doc(eid))).exists)return refuse('entry_without_receipt');
      const mref=command.action==='hide'&&command.targetType==='message'&&original?.type==='image'?contentMediaRef(command,eid):null;
      if(mref&&(await tx.get(mref)).exists)return refuse('media_restrictions_unknown');
      let rating:Awaited<ReturnType<typeof prepareVisibleRating>>|null=null,media:any=null,mediaRef:FirebaseFirestore.DocumentReference|null=null;
      let nextBody:any=null;
      const marker={protocol:'content_visibility_v1',state:visibility,caseId:document.caseId,decisionId:eid,version};
      if(['hide','restore'].includes(command.action)&&command.targetType==='review') {
        const kept=Object.fromEntries(['id','reviewerId','reviewerName','reviewerImage','vendeurId','transactionId','transactionType','articleId','articleTitle','createdAt'].filter(k=>s.body![k]!==undefined).map(k=>[k,s.body![k]]));
        nextBody={...kept,text:visibility==='hidden'?'':original!.text,note:visibility==='hidden'?null:original!.note,contentModeration:marker};
        rating=await prepareVisibleRating(tx,s.body!.vendeurId,{id:command.targetId,data:nextBody});
      }
      if(['hide','restore'].includes(command.action)&&command.targetType==='message') {
        const kept=Object.fromEntries(['id','chatId','senderId','receiverId','participants','type','timestamp','createdAt','status','isRead'].filter(k=>s.body![k]!==undefined).map(k=>[k,s.body![k]]));
        nextBody={...kept,...(visibility==='hidden'?{content:'Message masqué après examen'}:Object.fromEntries(['content','text','image'].filter(k=>original![k]!==undefined).map(k=>[k,original![k]]))),contentModeration:marker};
        mediaRef=db.collection('chat_media_restrictions').doc(s.body!.chatId);const prior=(await tx.get(mediaRef)).data();
        if(prior&&(prior.protocol!=='content_chat_restrictions_v1'||typeof prior.holds!=='object'||Array.isArray(prior.holds)||!prior.holds||Object.keys(prior.holds).length>500))return refuse('media_restrictions_unknown');
        const holds={...(prior?.holds??{})};if(visibility==='hidden')holds[document.caseId]=imagePaths(original!,s.body!.chatId);else delete holds[document.caseId];
        if(Object.values(holds).some(p=>!Array.isArray(p)||p.length>2||p.some(v=>typeof v!=='string'))||Object.keys(holds).length>500)return refuse('media_restrictions_unknown');
        media={protocol:'content_chat_restrictions_v1',chatId:s.body!.chatId,holds,blockedPaths:[...new Set(Object.values(holds).flat())],updatedAt:now};
        if(Buffer.byteLength(JSON.stringify(media),'utf8')>400000)return refuse('media_restrictions_unknown');
      }
      if(command.action==='report')tx.create(reportRef,{id:reportId,reporterId:uid,reporterName:'Un membre',targetType:'review',targetId:command.targetId,targetOwnerId:s.body!.reviewerId,
        reason:command.reason,description:command.description,status:'pending',createdAt:now,contentSafety:{protocol:'content_safety_statement_v1',urgency:command.urgency,linkedReviewId:command.targetId},
        contentEvidence:{protocol:'content_report_reference_v1',entryId:eid,contentHash,version}});
      if(command.action==='report')tx.create(reportRef.collection('native_evidence').doc(eid),{protocol:'content_review_evidence_v1',body:s.body,entryHash:contentHash,recordedAt:now});
      else tx.update(s.reportSnap!.ref,{status:command.action==='contest'?'reviewed':command.action==='maintain'?'dismissed':'resolved',
        contentDecision:{protocol:'content_decision_reference_v1',caseId:document.caseId,entryId:eid,contentHash,version},reviewedAt:now,
        ...(own?{}:{reviewedBy:uid,resolution:command.privateNote})});
      if(originalRef&&!existingOriginal)tx.create(originalRef,{protocol:'content_original_v1',targetType:command.targetType,targetId:command.targetId,sourceHash:originalHash,body:original,recordedAt:now});
      tx.set(caseRef,{...(s.root??{}),protocol:'content_moderation_case_v1',targetType:command.targetType,targetId:command.targetId,version,
        original:originalHash??s.root?.original??null,...(['maintain','hide','restore'].includes(command.action)?{current:{decisionId:eid,contentHash,version,state:visibility}}:{})});
      tx.create(caseRef.collection('entries').doc(eid),{protocol:document.protocol,document,contentHash});
      if(mref){const paths=imagePaths(original!,s.body!.chatId),refs=[original!.image?.url,original!.image?.thumbnail].filter(v=>typeof v==='string');
        tx.create(mref,{protocol:'content_media_withdrawal_v1',actorId:uid,requestId,reference:{id:eid,contentHash,version},
          objects:paths.map(sourcePath=>({sourcePath})),referenceCoverage:refs.length>0&&refs.every(v=>imagePaths({type:'image',image:{url:v}},s.body!.chatId).length===1)?'native_managed_only':'unknown_or_external',
          state:'pending',attempts:0,lease:null,leaseUntil:null,recordedAt:now,updatedAt:now});}
      if(nextBody)tx.set(s.ref,nextBody);
      if(nextBody&&s.review?.kind==='swap')tx.update(s.review.parent.ref,{[s.body!.reviewerId===s.review.parent.data()!.initiatorId?'initiatorRating':'receiverRating']:
        visibility==='hidden'?{score:null,comment:null,contentModeration:marker}:{score:original!.note,...(original!.text?{comment:original!.text}:{}),contentModeration:marker}});
      if(rating)rating.commit();
      if(mediaRef&&media){tx.set(mediaRef,media);tx.update(db.collection('chats').doc(s.body!.chatId),{contentPreviewRestricted:Object.keys(media.holds).length>0,lastMessage:'Consultez la conversation',lastMessageType:'system',updatedAt:now});}
      const receipt={protocol:'content_moderation_command_v1',actorId:uid,requestId,command,payloadHash:supportHash(command),state:'committed',reason:null,
        reportId,caseId:document.caseId,entryId:eid,contentHash,version,recordedAt:now,notificationIds:n.notificationIds,
        documentNeutralizedAtCommit:command.action==='hide',storageSdkRestrictionAtCommit:command.action==='hide'&&command.targetType==='message'&&imagePaths(original!,s.body!.chatId).length>0};
      tx.create(rref,receipt);n.commit();return receiptView(uid,requestId,command,receipt);
    });
    return {...response,mediaWithdrawal:response.state==='committed'&&command.action==='hide'&&response.entryReference?
      await mediaResult(request,command,response.entryReference,raw.mode==='execute'):mediaView(null)};
  }
  if(raw.scope!==(own?'own':'admin'))throw new HttpsError('permission-denied','Portée native requise.');
  if(!CONTENT_SAFETY_ENABLED&&raw.operation==='contentModerationPreview')throw new HttpsError('failed-precondition','Parcours de sécurité en préparation.',{reason:'content_safety_not_exposed'});
  const t=target(raw),reportId=raw.reportId==null?null:id(raw.reportId);
  const selectedReference=raw.decisionReference===undefined?null:reference(raw.decisionReference);
  if(!own&&reportId===null)throw new HttpsError('invalid-argument','Signalement sélectionné exact requis.');
  const result=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);
    if(!own)await operator(tx,request,uid);
    const s=await source(tx,t,reportId);
    if(own&&!s.parties.includes(uid))throw new HttpsError('permission-denied','Dossier personnel indisponible.');
    const selected=selectedReference?await proof(tx,t,selectedReference):null;
    if(selectedReference&&(!selected||own&&!selected.recipientIds.includes(uid)))throw new HttpsError('permission-denied','Référence personnelle native non qualifiée.');
    const current=s.root?.current;let currentDecision:any=null;
    if(current&&/^cd_[a-f0-9]{64}$/.test(current.decisionId??'')&&hash(current.contentHash)&&Number.isSafeInteger(current.version)) {
      const d=await proof(tx,t,{id:current.decisionId,contentHash:current.contentHash,version:current.version});if(d)currentDecision=entryView(d,!own,uid);
    }
    let entries:any[]=[],nextCursor:any=null,coverage:any=null,mediaWithdrawal=mediaView(null);
    const hiddenMarker=s.body?.contentModeration;
    if(t.targetType==='message'&&hiddenMarker?.state==='hidden'&&/^cd_[a-f0-9]{64}$/.test(hiddenMarker.decisionId??'')) {
      const entry=(await tx.get(contentCaseRef(t.targetType,t.targetId).collection('entries').doc(hiddenMarker.decisionId))).data();
      mediaWithdrawal=await mediaResultInTransaction(tx,t,{id:hiddenMarker.decisionId,contentHash:entry?.contentHash,version:hiddenMarker.version});
    }
    if(raw.operation==='contentModerationHistory'){
      const cursor=raw.cursor==null?null:id(supportObject(raw.cursor,['lastId']).lastId);let q:FirebaseFirestore.Query=contentCaseRef(t.targetType,t.targetId).collection('entries').orderBy('__name__').limit(21);if(cursor)q=q.startAfter(cursor);
      const page=await tx.get(q),inspected=page.docs.slice(0,20);for(const row of inspected){const d=row.data().document,r={id:row.id,contentHash:row.data().contentHash,version:d?.version};
        const p=hash(r.contentHash)&&Number.isSafeInteger(r.version)?await proof(tx,t,r):null;
        if(own&&p&&!p.recipientIds.includes(uid))continue;entries.push(p?{qualification:'native_content_entry',entry:entryView(p,!own,uid)}:{qualification:'unknown',entryId:row.id,entry:null});}
      nextCursor=page.size>20?{lastId:inspected.at(-1)!.id}:null;coverage={inspected:inspected.length,limit:20,hasMore:page.size>20,exhaustiveHistoryVerified:false};
    }
    if(!own)await operator(tx,request,uid);
    return {protocol:raw.operation==='contentModerationHistory'?'content_moderation_history_v1':'content_moderation_preview_v1',actorId:uid,scope:raw.scope,...t,reportId,
      source:{...s.capture,sourceHash:s.sourceHash,qualification:s.qualification},previewId:previewId(uid,raw.scope,s,selectedReference),
      current:own?s.body?{type:s.body.type??'review',text:publicReviewVisible(s.body)?s.body.text:s.t.targetType==='message'?s.body.content??null:null,note:publicReviewVisible(s.body)?s.body.note:null,state:s.body.contentModeration?.state??'visible'}:null:s.body??null,
      original:own?null:s.original,messageEvidence:own?null:s.messageEvidence,reportEvidence:own?null:s.reportEvidence,
      report:reportId?{reason:s.report!.reason??null,description:!own||s.report!.reporterId===uid?s.report!.description??null:null,urgency:s.report!.contentSafety?.urgency??'unknown',status:s.report!.status??null}:null,
      currentDecision,mediaWithdrawal,options:s.qualification!=='native_content'?[]:own?reportId?['contest']:t.targetType==='review'&&publicReviewVisible(s.body!)?['report']:[]:
        ['maintain',...(s.eligible?[s.body!.contentModeration?.state==='hidden'&&s.original?'restore':'hide']:[])],
      ...(selectedReference?{selectedDecision:{qualification:'native_addressed_entry',entry:entryView(selected,!own,uid)}}:{}),entries,nextCursor,coverage,...effects};
  });
  if(raw.operation==='readContentOriginalFile') {
    if(own||t.targetType!=='message'||!['image','thumbnail'].includes(raw.fileKind))throw new HttpsError('permission-denied','Lecture originale opérateur requise.');
    const original=result.original??result.messageEvidence?.source?.message;
    const value=original?.image?.[raw.fileKind==='image'?'url':'thumbnail'];
    const path=typeof value==='string'?imagePaths({type:'image',image:{url:value}},result.source.parent?.id??'')[0]:null;
    if(!path)throw new HttpsError('failed-precondition','Référence privée originale non qualifiée.',{reason:'content_original_pixels_unknown'});
    const preservation=await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);
      await operator(tx,request,uid);const s=await source(tx,t,reportId);
      if(s.sourceHash!==result.source.sourceHash)throw new HttpsError('failed-precondition','Source modifiée.',{reason:'source_changed'});
      const marker=s.body?.contentModeration;
      if(marker?.state!=='hidden'||!/^cd_[a-f0-9]{64}$/.test(marker.decisionId??''))return null;
      const entry=(await tx.get(contentCaseRef(t.targetType,t.targetId).collection('entries').doc(marker.decisionId))).data();
      if(!hash(entry?.contentHash))return null;
      const c=await mediaContext(tx,t,{id:marker.decisionId,contentHash:entry.contentHash,version:marker.version});
      return c?.value.objects.find((o:any)=>o.sourcePath===path&&preservedMedia(o,t,marker.decisionId))?.preservation??null;
    });
    const file=storage.bucket().file(preservation?.privatePath??path,preservation?{generation:preservation.privateGeneration}:undefined),[metadata]=await file.getMetadata();
    if(!/^\d+$/.test(String(metadata.generation))||!Number.isSafeInteger(Number(metadata.size))||Number(metadata.size)<=0||Number(metadata.size)>=CHAT_IMAGE_MAX_BYTES||
      typeof metadata.contentType!=='string'||!/^image\/(jpeg|png|webp|gif|heic|heif)$/.test(metadata.contentType))throw new HttpsError('failed-precondition','Original trop volumineux ou métadonnées non qualifiées.',{reason:'content_original_pixels_unknown'});
    const [bytes]=await storage.bucket().file(preservation?.privatePath??path,{generation:metadata.generation}).download({validation:'crc32c'});
    if(bytes.byteLength!==Number(metadata.size)||preservation&&(String(metadata.generation)!==preservation.privateGeneration||
      metadata.crc32c!==preservation.sourceCrc32c||metadata.metadata?.firebaseStorageDownloadTokens!=null||metadata.cacheControl!=='private, no-store'||
      createHash('sha256').update(bytes).digest('hex')!==preservation.sha256))throw new HttpsError('unavailable','Lecture originale à reprendre.');
    await db.runTransaction(async tx=>{await assertPrivateAccountSession(request,tx);await operator(tx,request,uid);const s=await source(tx,t,reportId);if(s.sourceHash!==result.source.sourceHash)throw new HttpsError('failed-precondition','Source modifiée.',{reason:'source_changed'});});
    return {protocol:'content_original_file_v1',actorId:uid,...t,reportId,sourceHash:result.source.sourceHash,generation:String(metadata.generation),
      crc32c:metadata.crc32c??null,sha256:createHash('sha256').update(bytes).digest('hex'),contentType:metadata.contentType,base64:bytes.toString('base64'),
      originalAtReportTimeVerified:false,physicalContentVerified:false,...effects};
  }
  return result;
  });
}
