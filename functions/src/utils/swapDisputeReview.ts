/** Source-bound documentary review of an exchange. Never a settlement engine. */
import {Timestamp, FieldPath} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {db, FieldValue} from '../config/firebase';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from './eligibility';
import {supportAdmin, supportCurrentAdminSession, supportHash, supportId, supportObject, supportRequestId,
  supportRevision, supportSourceHash, supportText, supportUid, supportAccountUid, isSupportAccountUid} from './supportRequest';
import {accountRelationshipAllowsRelease} from './accountRelationshipReview';
import {readSwapHoldSource} from './swapHeldFunds';
import {prepareOperationalNotices,readOperationalNoticeReceipts,buildDeepLink,type OperationalNoticeInput} from './notifications';
import {withDocumentaryProjection} from './documentaryProjection';
import {readFinancialRecoveryControl} from '../config/recoveryControl';
import {localAgreementWitnessMatches} from './localAgreement';
import {assertPrivateAccountSession} from './privateAccountSession';
import {applicationLink} from '../config/runtimeEnvironment';

export const SWAP_DISPUTE_REVIEW_CAPABILITY = 'swap_dispute_review_v1';
export const SWAP_DISPUTE_REVIEW_ENABLED: boolean = true;
const effects = {documentaryOnly:true, financialEffectAuthorized:false, stockEffectAuthorized:false,
  disputeClosed:false, refundConfirmed:false, fundsReleased:false, deviceDeliveryVerified:false, readingVerified:false} as const;
const hash = (v:unknown):v is string => typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const native = (v:unknown):v is Timestamp => v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
const safeId = (v:unknown):v is string => typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
const swapRef = (id:string) => db.collection('swaps').doc(id);
const rootRef = (id:string) => swapRef(id).collection('dispute_review').doc('current');
const entryRef = (id:string,eid:string) => swapRef(id).collection('dispute_review_entries').doc(eid);
const commandRef = (id:string,uid:string,rid:string) => swapRef(id).collection('dispute_review_commands').doc(supportHash([uid,rid]));
const entryId = (uid:string,rid:string) => 'sdr_'+supportHash([uid,rid]);
const entryContentHash = (entry:any) => {const {recordedAt:_,...content}=entry;return supportSourceHash(content);};
export type SwapDisputeReviewReference = {swapId:string;id:string;contentHash:string;version:number};
export type SwapDisputeReviewSourceReference = {sourceHash:string;episodeHash:string;version:number};
export type SwapDisputeReviewCommand = {action:'record_review';source:SwapDisputeReviewSourceReference;
  recommendation:'retain_frozen'|'refund_review_required'|'payee_release_review_required'|'physical_resolution_review_required';
  motivation:string;partyMessages:{userId:string;message:string}[];acknowledged:true};
function commandInput(raw:unknown):SwapDisputeReviewCommand {
  const c=supportObject(raw,['action','source','recommendation','motivation','partyMessages','acknowledged']);
  const s=supportObject(c.source,['sourceHash','episodeHash','version']);
  if(c.action!=='record_review'||!hash(s.sourceHash)||!hash(s.episodeHash)||!Number.isSafeInteger(s.version)||s.version<0||c.acknowledged!==true||
    !['retain_frozen','refund_review_required','payee_release_review_required','physical_resolution_review_required'].includes(c.recommendation)||
    !Array.isArray(c.partyMessages)||c.partyMessages.length!==2)throw new HttpsError('invalid-argument','Instruction documentaire et sources exactes requises.');
  const partyMessages=c.partyMessages.map((v:unknown)=>{const m=supportObject(v,['userId','message']);return {userId:supportAccountUid(m.userId),message:supportText(m.message,'Message à cette partie',2000)};});
  if(new Set(partyMessages.map(m=>m.userId)).size!==2)throw new HttpsError('invalid-argument','Deux destinataires distincts requis.');
  return {action:'record_review',source:{sourceHash:s.sourceHash,episodeHash:s.episodeHash,version:s.version},recommendation:c.recommendation,
    motivation:supportText(c.motivation,'Motivation documentaire',4000),partyMessages,acknowledged:true};
}
async function authority(tx:FirebaseFirestore.Transaction,request:any) {
  await supportCurrentAdminSession(request);
  // A stale token claim never substitutes for today's private active role.
  await supportAdmin(tx,request.auth.uid,false);
  assertRecentAccountAuthentication(request.auth.token);
  if(request.auth.token.auth_time*1000>Date.now())throw new HttpsError('permission-denied','Session actuelle non qualifiée.');
  await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(request.auth.uid))).data(), tx, request.auth.uid);
}
function documentCommitment(s:FirebaseFirestore.DocumentSnapshot) {
  return {path:s.ref.path,revision:supportRevision(s),sourceHash:supportSourceHash(s.data()??null),exists:s.exists};
}
function notices(id:string,uid:string,rid:string,c:SwapDisputeReviewCommand):OperationalNoticeInput[] {
  return c.partyMessages.map(m=>({eventKey:`swap_documentary_review:${id}:${supportHash([uid,rid])}`,userId:m.userId,type:'swap_update',
    title:'Revue documentaire de votre échange',message:m.message,
    data:{ownerId:m.userId,swapId:id,reviewEntryId:entryId(uid,rid),documentaryOnly:'true',financialEffectAuthorized:'false',stockEffectAuthorized:'false'}}));
}
async function qualifiedEntry(tx:FirebaseFirestore.Transaction,id:string,snap:FirebaseFirestore.DocumentSnapshot) {
  const d=snap.data();
  if(!d||d.protocol!=='swap_dispute_review_entry_v1'||d.swapId!==id||!isSupportAccountUid(d.actorId)||typeof d.requestId!=='string'||d.requestId.length<16||d.requestId.length>128||
    d.requestId.includes('/')||d.entryId!==snap.id||!Number.isSafeInteger(d.version)||d.version<1||
    snap.id!==entryId(d.actorId,d.requestId)||!native(d.recordedAt)||!hash(d.payloadHash)||d.documentaryOnly!==true||
    Object.entries(effects).some(([key,value])=>d[key]!==value)||!Array.isArray(d.notificationIds)||d.notificationIds.length!==2)return null;
  let c:SwapDisputeReviewCommand;try{c=commandInput(d.command);}catch{return null;}
  if(supportHash(c)!==d.payloadHash||d.version!==c.source.version+1||d.episodeHash!==c.source.episodeHash||!hash(d.sourceHash)||d.sourceHash!==c.source.sourceHash||
    !d.sourceCapture||d.sourceCapture.protocol!=='swap_dispute_review_source_v1'||d.sourceCapture.swapId!==id||
    supportSourceHash(d.sourceCapture)!==d.sourceHash||d.sourceCapture.episodeHash!==d.episodeHash||d.sourceCapture.version!==c.source.version||
    !Array.isArray(d.sourceCapture.episode?.parties)||d.sourceCapture.episode.parties.length!==2||
    c.partyMessages.some(m=>!d.sourceCapture.episode.parties.includes(m.userId)))return null;
  const rr=(await tx.get(commandRef(id,d.actorId,d.requestId))).data();
  if(!rr||rr.protocol!=='swap_dispute_review_command_v1'||rr.swapId!==id||rr.actorId!==d.actorId||rr.requestId!==d.requestId||rr.state!=='committed'||
    rr.payloadHash!==d.payloadHash||supportHash(rr.command)!==d.payloadHash||rr.entryId!==snap.id||rr.entryHash!==entryContentHash(d)||
    Object.entries(effects).some(([key,value])=>rr[key]!==value)||rr.version!==d.version||
    !native(rr.recordedAt)||!rr.recordedAt.isEqual(d.recordedAt))return null;
  let observed;
  try{observed=await readOperationalNoticeReceipts(tx,notices(id,d.actorId,d.requestId,c));}
  catch(e){if(e instanceof Error&&e.message==='Operational notification receipt mismatch')return null;throw e;}
  if(observed.some((r,i)=>!r||r.notificationId!==d.notificationIds[i]||r.committedAt!==d.recordedAt.toDate().toISOString()))return null;
  return d;
}
async function source(tx:FirebaseFirestore.Transaction,id:string) {
  const snap=await tx.get(swapRef(id)),d=snap.data();if(!d)throw new HttpsError('not-found','Échange introuvable.');
  if(process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'){
    const q=await readFinancialRecoveryControl();
    if(q.control.mode!=='normal'||q.control.previousEpoch!==null||q.control.financialEnvironment!=='unconfigured'||
      !localAgreementWitnessMatches('swap',swapRef(id).path,d,q.control))
      throw new HttpsError('failed-precondition','Cette revue exige un accord local natif qualifié.');
  }
  const parties=[d.initiatorId,d.receiverId],partiesQualified=parties.every(isSupportAccountUid)&&parties[0]!==parties[1];
  const episodeQualified=partiesQualified&&d.status==='disputed'&&native(d.disputeOpenedAt)&&parties.includes(d.disputeOpenedBy)&&
    typeof d.disputeReason==='string'&&!!d.disputeReason.trim();
  const episode={swapId:id,parties:partiesQualified?parties:[],openedAt:native(d.disputeOpenedAt)?d.disputeOpenedAt.toDate().toISOString():null,
    openedBy:isSupportAccountUid(d.disputeOpenedBy)?d.disputeOpenedBy:null,reason:typeof d.disputeReason==='string'?d.disputeReason:null,
    qualification:episodeQualified?'native_dispute_episode':'unknown'};
  const episodeHash=supportSourceHash(episode),rootSnap=await tx.get(rootRef(id)),root=rootSnap.data();
  const history=await tx.get(swapRef(id).collection('dispute_review_entries').orderBy(FieldPath.documentId()).limit(101));
  const historyCommitments=[],historyProofs=[];
  for(const row of history.docs.slice(0,100)){
    const proof=await qualifiedEntry(tx,id,row);historyProofs.push(proof);historyCommitments.push({...documentCommitment(row),noticesQualified:!!proof});
  }
  const rootEntry=root&&safeId(root.entryId)?history.docs.find(r=>r.id===root.entryId):null;
  const current=rootEntry?historyProofs[history.docs.indexOf(rootEntry)]:null;
  const version=root?Number.isSafeInteger(root.version)&&root.version>0?root.version:null:0;
  const historyQualified=history.size<=100&&historyProofs.every(Boolean)&&(!root?history.empty:
    root.protocol==='swap_dispute_review_root_v1'&&root.swapId===id&&Object.entries(effects).every(([key,value])=>root[key]===value)&&version!==null&&current&&current.version===version&&
    root.entryHash===entryContentHash(current)&&root.episodeHash===current.episodeHash&&native(root.recordedAt)&&root.recordedAt.isEqual(current.recordedAt))&&
    historyProofs.every((e:any)=>e.version<=Number(version))&&new Set(historyProofs.map((e:any)=>e?.version)).size===history.size&&
    history.size===version;
  const linked=[];
  for(const path of ['topup_checkout/current','topup_checkout/legacy_retirement','topup_release/committed','swap_hold_reviews/latest']){
    const s=await tx.get(db.doc(swapRef(id).path+'/'+path));linked.push({...documentCommitment(s),data:s.data()??null});
  }
  const movements:any[]=[],ledgerCommitments:any[]=[],wallets:any[]=[];let movementCoverage=true;
  if(partiesQualified)for(const uid of parties){
    const wallet=await tx.get(db.collection('wallets').doc(uid));wallets.push(documentCommitment(wallet));
    const rows=await tx.get(wallet.ref.collection('ledger').where('swapId','==',id).limit(101));if(rows.size>100)movementCoverage=false;
    for(const row of rows.docs.slice(0,100)){const v=row.data();ledgerCommitments.push(documentCommitment(row));
      movements.push({ownerId:uid,id:row.id,type:typeof v.type==='string'?v.type:null,amountCents:Number.isSafeInteger(v.amount)?v.amount:null,
        currency:typeof v.currency==='string'?v.currency:v.currency==null?'not_recorded':null,
        recordedAt:native(v.createdAt)?v.createdAt.toDate().toISOString():null,qualification:v.swapId===id&&Number.isSafeInteger(v.amount)&&
          native(v.createdAt)?'native_swap_linked_movement':'unknown'});
    }
  }
  const articleIds:string[]=[],articleCommitments:any[]=[],articles:any[]=[];let itemCoverage=true;
  for(const side of ['initiator','receiver']){
    const rows=d[side+'Items']??(d[side+'Item']?[d[side+'Item']]:[]);
    if(!Array.isArray(rows)||rows.length>20||rows.length===0){itemCoverage=false;continue;}
    for(const row of rows){if(!safeId(row?.articleId)||articleIds.includes(row.articleId)){itemCoverage=false;continue;}articleIds.push(row.articleId);}
  }
  for(const aid of articleIds){const a=await tx.get(db.collection('articles').doc(aid)),v=a.data();articleCommitments.push(documentCommitment(a));
    articles.push({id:aid,exists:a.exists,sellerId:isSupportAccountUid(v?.sellerId)?v!.sellerId:null,isSold:typeof v?.isSold==='boolean'?v.isSold:null,
      isActive:typeof v?.isActive==='boolean'?v.isActive:null,reservationQualification:'no_permission_inferred'});}
  // The generalist party may contain many unrelated items. Read reservations
  // by each selected native article, not a truncated global-party inventory.
  const inventoryCommitments:any[]=[];
  for(const aid of articleIds){
    const rows=await tx.get(db.collection('swapPartyItems').where('articleId','==',aid).limit(21));
    if(rows.size>20)itemCoverage=false;
    inventoryCommitments.push(...rows.docs.slice(0,20).map(documentCommitment));
  }
  let relation:any={qualification:'unknown',releaseAllowed:null,pairId:null,root:null};
  if(partiesQualified){const pid='arp_'+supportHash([...parties].sort()),r=await tx.get(db.collection('account_relationship_pairs').doc(pid));
    const allowed=await accountRelationshipAllowsRelease(tx,{kind:'swap',id},parties[0],parties[1]);
    relation={qualification:'current_native_guard_observed',releaseAllowed:allowed,pairId:pid,root:documentCommitment(r)};}
  const hold=partiesQualified?await readSwapHoldSource(tx,id,d,Timestamp.now()):null;
  const checkout=linked.find(v=>v.path.endsWith('/topup_checkout/current'))?.data;
  const top=d.cashTopUp,topup={amountCents:top&&Number.isSafeInteger(top.amount)&&top.amount>0?top.amount:null,currency:'CAD',
    amountQualification:top&&Number.isSafeInteger(top.amount)&&top.amount>0?'native_topup_cents':'unknown',
    payerId:partiesQualified&&parties.includes(top?.payerId)?top.payerId:null,
    paymentIntentId:typeof d.topUpPaymentIntentId==='string'&&/^pi_[A-Za-z0-9_]+$/.test(d.topUpPaymentIntentId)?d.topUpPaymentIntentId:null,
    paidAt:native(d.topUpPaidAt)?d.topUpPaidAt.toDate().toISOString():null,holdSource:hold?.source??null,
    checkout:{protocol:typeof checkout?.protocol==='string'?checkout.protocol:null,intentId:typeof checkout?.intentId==='string'?checkout.intentId:null,
      version:Number.isSafeInteger(checkout?.version)?checkout!.version:null,state:typeof checkout?.state==='string'?checkout.state:null,
      nativeReceiptQualified:false,financialSettlementVerified:false},
    providerCurrentState:'not_observed',settlementPermissionGranted:false};
  const refundWitnesses=Object.fromEntries(Object.keys(d).filter(k=>/refund/i.test(k)).map(k=>[k,d[k]]));
  const obligations={qualification:'selected_native_witnesses_only',refundWitnessHash:supportSourceHash(refundWitnesses),
    refundId:typeof d.topUpRefundId==='string'?d.topUpRefundId:null,refundedAt:native(d.topUpRefundedAt)?d.topUpRefundedAt.toDate().toISOString():null,
    reconciledAt:native(d.topUpRefundReconciledAt)?d.topUpRefundReconciledAt.toDate().toISOString():null,
    exhaustiveFinancialObligationsVerified:false,physicalReturnRuleQualified:false,itemReavailabilityRuleQualified:false};
  const capture={protocol:'swap_dispute_review_source_v1',swapId:id,swap:documentCommitment(snap),episode,episodeHash,version,
    root:documentCommitment(rootSnap),history:historyCommitments,linked:linked.map(({data:_,...v})=>v),
    wallets,ledger:ledgerCommitments,articles:articleCommitments,inventory:inventoryCommitments,relationship:relation,
    coverage:{historyQualified:!!historyQualified,historyCount:history.size,historyLimit:100,ledgerComplete:movementCoverage,itemCoverage,
      selectedSwapOnly:true,providerObserved:false,globalFinancialHistoryExhaustive:false},
    facts:{status:typeof d.status==='string'?d.status:null,topup,movements,articles,obligations,
      receptions:{initiatorAt:native(d.initiatorReceivedAt)?d.initiatorReceivedAt.toDate().toISOString():null,
        receiverAt:native(d.receiverReceivedAt)?d.receiverReceivedAt.toDate().toISOString():null},
      priorLegacyDecision:!!d.disputeResolutionNotice,legacyFinancialOutcomeVerified:false},...effects};
  const sourceHash=supportSourceHash(capture);
  return {capture,sourceHash,episodeHash,version,parties:partiesQualified?parties as string[]:[],
    qualified:episodeQualified&&!!historyQualified&&version!==null&&Buffer.byteLength(JSON.stringify(capture),'utf8')<450000};
}
const receiptView=(id:string,uid:string,rid:string,c:SwapDisputeReviewCommand,r:any)=>({protocol:'swap_dispute_review_receipt_v1',
  swapId:id,actorId:uid,requestId:rid,payloadHash:supportHash(c),state:r?.state??'unrecorded',
  recordedAt:native(r?.recordedAt)?r.recordedAt.toDate().toISOString():null,reason:typeof r?.reason==='string'?r.reason:null,
  reference:r?.state==='committed'?{swapId:id,id:r.entryId,contentHash:r.entryHash,version:r.version}:null,
  commandCommitted:r?.state==='committed',notificationCommitted:r?.state==='committed',nonExecutionVerified:r?.state==='not_executed',...effects});
async function own(tx:FirebaseFirestore.Transaction,id:string,uid:string,rid:string,c:SwapDisputeReviewCommand) {
  const s=await tx.get(commandRef(id,uid,rid)),r=s.data();if(!r)return null;
  if(r.protocol!=='swap_dispute_review_command_v1'||r.swapId!==id||r.actorId!==uid||r.requestId!==rid||r.payloadHash!==supportHash(c)||
    supportHash(r.command)!==supportHash(c)||!native(r.recordedAt)||!['committed','not_executed'].includes(r.state))
    throw new HttpsError('failed-precondition','Le reçu propre doit être rapproché.');
  if(Object.entries(effects).some(([key,value])=>r[key]!==value))throw new HttpsError('failed-precondition','Les effets du reçu propre doivent être rapprochés.');
  if(r.state==='committed'){
    if(r.entryId!==entryId(uid,rid)||!hash(r.entryHash)||!Number.isSafeInteger(r.version)||r.version<1)throw new HttpsError('failed-precondition','Le lien documentaire doit être rapproché.');
    const e=await tx.get(entryRef(id,r.entryId));
    const qualified=await qualifiedEntry(tx,id,e);
    if(!qualified||qualified.version!==r.version)throw new HttpsError('failed-precondition','Le reçu documentaire doit être rapproché.');
  }
  return r;
}
function refuse(tx:FirebaseFirestore.Transaction,id:string,uid:string,rid:string,c:SwapDisputeReviewCommand,reason:string) {
  const r={protocol:'swap_dispute_review_command_v1',swapId:id,actorId:uid,requestId:rid,payloadHash:supportHash(c),command:c,
    state:'not_executed',recordedAt:Timestamp.now(),reason,...effects};tx.create(commandRef(id,uid,rid),r);return r;
}
function pageCursor(v:unknown):string|null {
  if(v===null||v===undefined)return null;
  if(typeof v!=='string'||!/^sdr_[a-f0-9]{64}$/.test(v))throw new HttpsError('invalid-argument','Curseur natif requis.');return v;
}
export async function handleSwapDisputeReview(request:any) {
  const uid=supportUid(request),raw=supportObject(request.data,['swapDisputeCapability','swapId','expectedUid','expectedAdminUid','mode','requestId','command','sourceHash','cursor']);
  const id=supportId(raw.swapId);if(raw.expectedAdminUid!==uid)throw new HttpsError('permission-denied','Le compte SDK a changé.');
  if(!['preview','history','execute','observe','neutralize'].includes(raw.mode))throw new HttpsError('invalid-argument','Mode documentaire requis.');
  if(raw.mode==='preview'||raw.mode==='history')return db.runTransaction(async tx=>{
    await authority(tx,request);const s=await source(tx,id);
    if(raw.mode==='preview')return {protocol:'swap_dispute_review_preview_v1',swapId:id,source:{sourceHash:s.sourceHash,episodeHash:s.episodeHash,version:s.version},
      capture:s.capture,canRecord:SWAP_DISPUTE_REVIEW_ENABLED&&s.qualified,stageEnabled:SWAP_DISPUTE_REVIEW_ENABLED,admission:{currentPrivateAdminQualified:true,recentAuthenticationQualified:true},...effects};
    if(raw.sourceHash!==s.sourceHash)throw new HttpsError('failed-precondition','Les sources de la revue ont changé.');
    const cursor=pageCursor(raw.cursor);let q=swapRef(id).collection('dispute_review_entries').orderBy(FieldPath.documentId()).limit(21);
    if(cursor)q=q.startAfter(cursor);const rows=await tx.get(q),page=[];
    for(const r of rows.docs.slice(0,20)){const e=await qualifiedEntry(tx,id,r);page.push({reference:{swapId:id,id:r.id,contentHash:entryContentHash(r.data()),version:e?.version??null},
      qualification:e?'native_documentary_entry':'unknown',entry:e?{actorId:e.actorId,requestId:e.requestId,recordedAt:e.recordedAt.toDate().toISOString(),command:e.command,
        sourceHash:e.sourceHash,episodeHash:e.episodeHash,notificationIds:e.notificationIds,...effects}:null});}
    return {protocol:'swap_dispute_review_history_v1',swapId:id,sourceHash:s.sourceHash,cursor,entries:page,hasMore:rows.size>20,
      nextCursor:rows.size>20?rows.docs[19].id:null,admission:{currentPrivateAdminQualified:true,recentAuthenticationQualified:true},...effects};
  });
  const rid=supportRequestId(raw.requestId),c=commandInput(raw.command);
  const run=()=>db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    // The exact historical actor services their receipt before current role,
    // recent authentication, feature exposure or current business source.
    const prior=await own(tx,id,uid,rid,c);if(prior)return receiptView(id,uid,rid,c,prior);
    if(raw.mode==='observe')return receiptView(id,uid,rid,c,null);
    if(raw.mode==='neutralize')return receiptView(id,uid,rid,c,refuse(tx,id,uid,rid,c,'requester_neutralized'));
    if(!SWAP_DISPUTE_REVIEW_ENABLED)return receiptView(id,uid,rid,c,refuse(tx,id,uid,rid,c,'swap_documentary_review_not_exposed'));
    await authority(tx,request);const s=await source(tx,id);
    if(c.source.sourceHash!==s.sourceHash||c.source.episodeHash!==s.episodeHash||c.source.version!==s.version)
      return receiptView(id,uid,rid,c,refuse(tx,id,uid,rid,c,'native_source_changed'));
    if(!s.qualified)return receiptView(id,uid,rid,c,refuse(tx,id,uid,rid,c,'native_episode_or_history_unknown'));
    if(c.partyMessages.some(m=>!s.parties.includes(m.userId)))throw new HttpsError('invalid-argument','Les destinataires doivent être les deux parties natives.');
    const prepared=await prepareOperationalNotices(tx,notices(id,uid,rid,c));
    const version=s.version!+1,at=process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'?Timestamp.now():FieldValue.serverTimestamp(),eid=entryId(uid,rid);
    const e={protocol:'swap_dispute_review_entry_v1',swapId:id,entryId:eid,actorId:uid,requestId:rid,payloadHash:supportHash(c),command:c,
      sourceHash:s.sourceHash,episodeHash:s.episodeHash,version,sourceCapture:s.capture,notificationIds:prepared.notificationIds,recordedAt:at,...effects};
    const entryHash=entryContentHash(e),r={protocol:'swap_dispute_review_command_v1',swapId:id,actorId:uid,requestId:rid,payloadHash:supportHash(c),command:c,
      state:'committed',entryId:eid,entryHash,version,recordedAt:at,reason:null,...effects};
    tx.create(entryRef(id,eid),e);tx.create(commandRef(id,uid,rid),r);
    tx.set(rootRef(id),{protocol:'swap_dispute_review_root_v1',swapId:id,entryId:eid,entryHash,version,episodeHash:s.episodeHash,recordedAt:at,...effects});
    prepared.commit(at instanceof Timestamp?at:undefined);return null;
  });
  const committed=await (process.env.FINANCIAL_RECOVERY_ENVIRONMENT==='unconfigured'?
    withDocumentaryProjection({kind:'swap_dispute_review',swapId:id,requestId:rid,request,command:c,mode:raw.mode},run):run());
  if(committed)return committed;
  // Observe the actual shared commit Timestamp; a local clock never substitutes
  // for the atomic entry, command and two native notice receipts.
  return db.runTransaction(async tx=>receiptView(id,uid,rid,c,await own(tx,id,uid,rid,c)));
}
export type SwapDisputeReviewResponse = Awaited<ReturnType<typeof handleSwapDisputeReview>>;

/** Independent flush-time check of the ENTIRE documentary transaction. The
 * native parent/source/role are reread here; no parent, stock or money write is
 * included in this permission. */
export async function qualifyLocalSwapReviewWrites(tx:FirebaseFirestore.Transaction,scope:{swapId:string;requestId:string;request:any;command:unknown;mode:string},
  writes:readonly {method:string;args:any[]}[]){
  const fail=():never=>{throw new HttpsError('failed-precondition','Projection documentaire du troc non qualifiée.');},
    id=scope.swapId,uid=supportUid(scope.request),rid=scope.requestId,c=commandInput(scope.command),q=await readFinancialRecoveryControl(),
    parent=(await tx.get(swapRef(id))).data();
  if(!parent||q.control.mode!=='normal'||q.control.previousEpoch!==null||q.control.financialEnvironment!=='unconfigured'||
    !localAgreementWitnessMatches('swap',swapRef(id).path,parent,q.control))return fail();
  await assertPrivateAccountSession(scope.request,tx);
  const path=commandRef(id,uid,rid).path,byPath=new Map(writes.map(w=>[w.args[0]?.path,w])),row=byPath.get(path)?.args[1],
    at=row?.recordedAt;
  if(!native(at)||Date.now()-at.toMillis()>60000||(await tx.get(commandRef(id,uid,rid))).exists)return fail();
  const expected:{path:string;method:'create'|'set';value:FirebaseFirestore.DocumentData}[]=[];
  if(row.state==='not_executed'){
    if(!['requester_neutralized','swap_documentary_review_not_exposed','native_source_changed','native_episode_or_history_unknown'].includes(row.reason))return fail();
    if(scope.mode!=='neutralize')await authority(tx,scope.request);
    expected.push({path,method:'create',value:{protocol:'swap_dispute_review_command_v1',swapId:id,actorId:uid,requestId:rid,payloadHash:supportHash(c),command:c,
      state:'not_executed',recordedAt:at,reason:row.reason,...effects}});
    return expected;
  }
  if(scope.mode!=='execute'||row.state!=='committed')return fail();
  await authority(tx,scope.request);const s=await source(tx,id);
  if(!s.qualified||c.source.sourceHash!==s.sourceHash||c.source.episodeHash!==s.episodeHash||c.source.version!==s.version||
    c.partyMessages.some(m=>!s.parties.includes(m.userId)))return fail();
  const inputs=notices(id,uid,rid,c),ids=inputs.map(i=>'operational_'+supportHash([i.eventKey,i.userId])),eid=entryId(uid,rid),version=s.version!+1,
    e={protocol:'swap_dispute_review_entry_v1',swapId:id,entryId:eid,actorId:uid,requestId:rid,payloadHash:supportHash(c),command:c,
      sourceHash:s.sourceHash,episodeHash:s.episodeHash,version,sourceCapture:s.capture,notificationIds:ids,recordedAt:at,...effects},entryHash=entryContentHash(e);
  if((await tx.get(entryRef(id,eid))).exists)return fail();
  expected.push({path:entryRef(id,eid).path,method:'create',value:e},
    {path,method:'create',value:{protocol:'swap_dispute_review_command_v1',swapId:id,actorId:uid,requestId:rid,payloadHash:supportHash(c),command:c,
      state:'committed',entryId:eid,entryHash,version,recordedAt:at,reason:null,...effects}},
    {path:rootRef(id).path,method:'set',value:{protocol:'swap_dispute_review_root_v1',swapId:id,entryId:eid,entryHash,version,episodeHash:s.episodeHash,recordedAt:at,...effects}});
  for(let index=0;index<inputs.length;index++){
    const i=inputs[index],nid=ids[index],rpath='operational_notice_receipts/'+nid,npath='notifications/'+nid;
    if((await tx.get(db.doc(rpath))).exists||(await tx.get(db.doc(npath))).exists)return fail();
    expected.push({path:rpath,method:'create',value:{protocol:'operational_notice_v1',notificationId:nid,eventKey:i.eventKey,userId:i.userId,type:i.type,
      title:i.title,message:i.message,data:i.data,payloadHash:supportHash([i.eventKey,i.userId,i.type,i.title,i.message,Object.entries(i.data).sort(([a],[b])=>a.localeCompare(b))]),
      inAppCommitted:true,committedAt:at,pushState:'pending',pushAttempts:0}},
      {path:npath,method:'create',value:{id:nid,userId:i.userId,type:i.type,title:i.title,message:i.message,
        data:{...i.data,deepLink:applicationLink(buildDeepLink(i.type,i.data))},operationalReceiptId:nid,isRead:false,createdAt:at}});
  }
  return expected;
}
