/** Human bank evidence workflow. It authorizes no refund, debt, stock or hold release. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {createHash} from 'node:crypto';
import {checkRateLimit} from './rateLimit';
import {db} from '../config/firebase';
import {relayNativeBankDeadline} from './supportDeadlineNotices';
import {getStripe} from '../config/stripe';
import {supportUid,supportId,supportObject,supportRequestId,supportHash,supportSourceHash,supportText,supportAdmin} from './supportRequest';
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
import {assertRecentAccountAuthentication,assertAccountSecurityOpen} from './eligibility';
import {prepareOperationalNotices,readOperationalNoticeReceipts} from './notifications';
import {productReviewCaseRef} from './productReviewSource';
import {readProductReviewEvidenceProof,readProductReviewEvidenceFile} from './productReviewEvidence';
import {FinancialRecoveryBlocked,withFinancialRecoveryScope} from './financialRecoveryInterlock';
import {financialRecoverySourceFields,prepareFinancialRecoverySource,financialRecoveryCommitCheckpoint} from './financialRecoverySources';
import {bankCaseRef,bankNative,bankId,bankStripeId,bankResponseAvailable,bankNativeIdentity,bankEvidenceSelectionMatches,bankEvidenceHasUnselected,
  getBankProvider,readBankCaseSource,prepareBankObservation,bankDocumentarySourceFields,type BankObservation} from './bankDisputeCaseSource';
export const BANK_CASE_CAPABILITY='bank_dispute_case_v1';
export const BANK_CASE_ENABLED:boolean=true;
const effects={financialEffectAuthorized:false,bankOutcomeEstablished:false,bankAcceptanceVerified:false,holdReleaseAuthorized:false,inventoryPermissionGranted:false} as const;
const hash=(v:any):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
type Reference={id:string;contentHash:string};
type Piece={slot:'customer_communication'|'shipping_documentation'|'uncategorized_file';evidenceId:string;evidenceHash:string};
type Command={action:'save_draft'|'attach_file'|'stage_draft'|'submit_evidence'|'accept_dispute'|'buyer_withdrawal';scope:'own'|'admin';sourceHash:string;
  draftReference:Reference|null;fileIndex:number|null;text:string|null;privateReason:string|null;pieces:Piece[];acknowledged:true};
export type BankCaseCommand=Command;
const refInput=(v:any):Reference=>{const r=supportObject(v,['id','contentHash']);if(!/^be_[a-f0-9]{64}$/.test(r.id??'')||!hash(r.contentHash))throw new HttpsError('invalid-argument','Référence bancaire native exacte requise.');return {id:r.id,contentHash:r.contentHash};};
const fail=()=>new HttpsError('failed-precondition','Le dossier bancaire doit être rapproché.',{reason:'bank_case_source_unknown',...effects});
function input(raw:any):Command {
  const c=supportObject(raw,['action','scope','sourceHash','draftReference','fileIndex','text','privateReason','pieces','acknowledged']);
  if(!['save_draft','attach_file','stage_draft','submit_evidence','accept_dispute','buyer_withdrawal'].includes(c.action)||!['own','admin'].includes(c.scope)||!hash(c.sourceHash)||c.acknowledged!==true||
    !Array.isArray(c.pieces)||c.pieces.length>3||c.action==='buyer_withdrawal'!==(c.scope==='own'))throw new HttpsError('invalid-argument','Intention bancaire explicite requise.');
  const pieces=c.pieces.map((v:any)=>{const p=supportObject(v,['slot','evidenceId','evidenceHash']);if(!['customer_communication','shipping_documentation','uncategorized_file'].includes(p.slot)||
    !/^pf_[a-f0-9]{64}$/.test(p.evidenceId??'')||!hash(p.evidenceHash))throw new HttpsError('invalid-argument','Pièce privée de la commande requise.');return p as Piece;});
  if(new Set(pieces.map(p=>p.slot)).size!==pieces.length)throw new HttpsError('invalid-argument','Une pièce par champ bancaire.');
  const draftReference=c.draftReference===null?null:refInput(c.draftReference),documentary=['save_draft','buyer_withdrawal'].includes(c.action),draftRequired=['attach_file','stage_draft','submit_evidence'].includes(c.action);
  if(documentary&&(draftReference!==null||c.fileIndex!==null||c.text===null)||draftRequired&&(draftReference===null||c.text!==null||pieces.length)||
    c.action==='accept_dispute'&&(draftReference!==null||c.text!==null||pieces.length)||
    c.action==='buyer_withdrawal'&&(pieces.length||c.privateReason!==null)||c.scope==='admin'&&c.privateReason===null||
    c.action==='attach_file'&&(!Number.isSafeInteger(c.fileIndex)||c.fileIndex<0||c.fileIndex>2)||c.action!=='attach_file'&&c.fileIndex!==null)
    throw new HttpsError('invalid-argument','Brouillon, pièce et confirmation d’envoi sont distincts.');
  return {action:c.action,scope:c.scope,sourceHash:c.sourceHash,draftReference,fileIndex:c.fileIndex,
    text:c.text===null?null:supportText(c.text,'Texte déclaré',6000),privateReason:c.privateReason===null?null:supportText(c.privateReason,'Motivation opérateur privée',4000),pieces,acknowledged:true};
}
const opRef=(du:string,uid:string,rid:string)=>bankCaseRef(du).collection('commands').doc(supportHash([uid,rid]));
const resultRef=(du:string,uid:string,rid:string)=>opRef(du,uid,rid).collection('results').doc('receipt');
const entryId=(uid:string,rid:string)=>'be_'+supportHash([uid,rid]);
const fileRef=(du:string,draft:Reference,index:number)=>bankCaseRef(du).collection('files').doc(supportHash([draft.id,index]));
function providerPayloadHash(value:any){return supportSourceHash({transactionId:value.transactionId,disputeId:value.disputeId,
  action:value.command?.action,evidence:value.evidence,file:value.file,filename:value.filename});}
async function qualifyBankEntry(tx:FirebaseFirestore.Transaction,du:string,reference:Reference){
  const ref=bankCaseRef(du).collection('entries').doc(reference.id),snap=await tx.get(ref),value=snap.data();
  if(!value||value.contentHash!==reference.contentHash||supportSourceHash(value.document)!==reference.contentHash)throw fail();
  await prepareFinancialRecoverySource('bank_case_entry',ref.path,value);
}
async function qualifyEffectSource(source:Awaited<ReturnType<typeof readBankCaseSource>>,du:string){
  if(!source.qualified||!source.root)throw fail();
  await prepareFinancialRecoverySource('purchase',source.ref.path,source.order);
  await prepareFinancialRecoverySource('bank_case_root',bankCaseRef(du).path,source.root);
}
async function authority(tx:FirebaseFirestore.Transaction,request:any,admin:boolean){
  await assertPrivateAccountSession(request,tx);if(request.auth.token.auth_time*1000>Date.now())throw fail();
  if(admin)await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(request.auth.uid))).data(), tx, request.auth.uid);
  if(admin){await supportAdmin(tx,request.auth.uid,false);assertRecentAccountAuthentication(request.auth.token);}
}
function notices(document:any){return document.parties.map((userId:string)=>({eventKey:'bank_case_entry:'+document.id,userId,type:'order_moderation' as const,
  title:'Dossier de contestation bancaire',message:document.command.action==='buyer_withdrawal'?
    'Une déclaration de retrait de contestation a été reçue. Elle ne clôt pas le dossier bancaire et ne débloque pas les fonds.':
    document.command.action==='accept_dispute'?'L’opérateur a accepté la contestation auprès du prestataire. Cela ne confirme ni faute, ni règlement comptable, ni disponibilité des fonds.':
    document.command.action==='submit_evidence'?'Un envoi de pièces au prestataire a été observé. Cela ne confirme ni l’acceptation bancaire ni l’issue ou la disponibilité des fonds.':
    'Le traitement du dossier bancaire a été mis à jour. Les réclamations commerciales et les mouvements de fonds restent distincts.',
  data:{ownerId:userId,transactionId:document.transactionId,disputeId:document.disputeId,bankCaseCapability:BANK_CASE_CAPABILITY,
    bankCaseEntryId:document.id,bankCaseEntryHash:supportSourceHash(document)}}));}
async function entryProof(tx:FirebaseFirestore.Transaction,du:string,r:Reference){
  const raw=(await tx.get(bankCaseRef(du).collection('entries').doc(r.id))).data(),d=raw?.document;
  if(!d||raw.contentHash!==r.contentHash||supportSourceHash(d)!==r.contentHash||d.id!==r.id||d.disputeId!==du||
    !bankNative(d.recordedAt)||d.id!==entryId(d.actorId,d.requestId))return null;
  const receipt=(await tx.get(resultRef(du,d.actorId,d.requestId))).data();
  if(receipt?.state!=='received'||receipt.transactionId!==d.transactionId||receipt.disputeId!==du||receipt.actorId!==d.actorId||receipt.payloadHash!==supportHash(d.command)||
    supportHash(receipt.reference)!==supportHash(r)||!bankNative(receipt.recordedAt)||!receipt.recordedAt.isEqual(d.recordedAt))return null;
  const nr=await readOperationalNoticeReceipts(tx,notices(d));if(nr.some((v,i)=>!v||v.notificationId!==receipt.notificationIds?.[i]))return null;
  return d;
}
function receiptView(uid:string,tid:string,du:string,rid:string,c:Command,v?:any){return {protocol:'bank_case_command_v1',actorId:uid,transactionId:tid,disputeId:du,requestId:rid,command:c,
  payloadHash:supportHash(c),state:v?.state??'unrecorded',reason:v?.reason??null,reference:v?.reference??null,
  result:v?.result??null,futureEffectsNeutralized:bankNative(v?.futureEffectsNeutralizedAt)||v?.reason==='requester_neutralized',
  recordedAt:bankNative(v?.recordedAt)?v.recordedAt.toDate().toISOString():null,...effects};}
function adminEntryView(d:any){return {id:d.id,contentHash:supportSourceHash(d),actorId:d.actorId,transactionId:d.transactionId,disputeId:d.disputeId,
  command:d.command,sourceHash:d.sourceHash,sourceCapture:d.sourceCapture,recordedAt:d.recordedAt.toDate().toISOString(),
  providerEffect:d.providerEffect?{...d.providerEffect,...(d.providerEffect.closeProof?{closeProof:{...d.providerEffect.closeProof,observedAt:bankNative(d.providerEffect.closeProof.observedAt)?d.providerEffect.closeProof.observedAt.toDate().toISOString():null}}:{}),providerObservedAt:bankNative(d.providerEffect.providerObservedAt)?d.providerEffect.providerObservedAt.toDate().toISOString():null}:null,
  ...effects};}
function caseView(root:any,observation:any,admin:boolean){const p=observation?.document?.semantic;return {transactionId:typeof root?.transactionId==='string'?root.transactionId:null,
  disputeId:typeof root?.disputeId==='string'?root.disputeId:null,version:Number.isSafeInteger(root?.version)?root.version:null,
  status:p?.status??'unknown',amountCents:Number.isSafeInteger(p?.amountCents)?p.amountCents:null,currency:p?.currency==='CAD'?'CAD':null,
  dueBy:p?.dueBySeconds>0?new Date(p.dueBySeconds*1000).toISOString():null,dueQualification:p?.dueQualification??'unknown',
  hasEvidence:typeof p?.hasEvidence==='boolean'?p.hasEvidence:null,submissionCount:Number.isSafeInteger(p?.submissionCount)?p.submissionCount:null,
  pastDue:typeof p?.pastDue==='boolean'?p.pastDue:null,providerObservedAt:bankNative(observation?.document?.observedAt)?observation.document.observedAt.toDate().toISOString():null,
  responsibleUid:admin?root?.responsibleUid??null:null,currentDraft:admin?root?.currentDraft??null:null,currentStage:admin?root?.currentStage??null:null,
  currentProviderStateVerified:false,providerRestitutionVerified:false,...effects};}
function cursor(raw:any){if(raw==null)return null;const c=supportObject(raw,['lastId']);
  if(typeof c.lastId!=='string'||!c.lastId||c.lastId.includes('/')||Buffer.byteLength(c.lastId,'utf8')>1500||['.','..'].includes(c.lastId)||/^__.*__$/.test(c.lastId))throw new HttpsError('invalid-argument','Curseur natif invalide.');return c.lastId;}
async function piecesProof(tx:FirebaseFirestore.Transaction,tid:string,pieces:Piece[]){
  const context={kind:'order' as const,id:tid},out=[];
  for(const p of pieces){const raw=(await tx.get(productReviewCaseRef(context).collection('evidence').doc(p.evidenceId))).data();
    const proof=await readProductReviewEvidenceProof(tx,context,p.evidenceId,raw);
    if(!proof||raw!.contentHash!==p.evidenceHash||proof.document.adopted!==true||!['buyer','seller'].includes(proof.document.actorRole))throw fail();
    out.push({selection:p,actorId:proof.document.actorId,actorRole:proof.document.actorRole,storageProof:proof.document.storageProof,command:proof.command});}
  return out;
}
async function draftData(tx:FirebaseFirestore.Transaction,du:string,c:Command){
  if(!c.draftReference)throw fail();const d=await entryProof(tx,du,c.draftReference);
  if(!d||d.command.action!=='save_draft'||d.command.scope!=='admin')throw fail();return d;
}
async function providerPayload(tx:FirebaseFirestore.Transaction,du:string,draft:any){
  const evidence:Record<string,string>={uncategorized_text:draft.command.text};
  for(let i=0;i<draft.command.pieces.length;i++){
    const file=(await tx.get(fileRef(du,{id:draft.id,contentHash:supportSourceHash(draft)},i))).data();
    if(!file?.reference)throw fail();const entry=await entryProof(tx,du,refInput(file.reference));
    if(!entry||entry.command.action!=='attach_file'||entry.command.fileIndex!==i||entry.command.draftReference?.id!==draft.id||
      entry.command.draftReference.contentHash!==supportSourceHash(draft)||!bankId(entry.providerEffect?.fileId,'file'))throw fail();
    evidence[draft.command.pieces[i].slot]=entry.providerEffect.fileId;
    await qualifyBankEntry(tx,du,refInput(file.reference));
  }
  return evidence;
}
async function recordResult(tx:FirebaseFirestore.Transaction,tid:string,du:string,uid:string,rid:string,c:Command,source:any,providerEffect:any){
  const old=(await tx.get(resultRef(du,uid,rid))).data();if(old)return old;
  const id=entryId(uid,rid),now=Timestamp.now(),document={protocol:'bank_case_entry_v1',id,transactionId:tid,disputeId:du,actorId:uid,requestId:rid,command:c,
    sourceHash:source.sourceHash,sourceCapture:source.capture,parties:source.parties,providerEffect,recordedAt:now,...effects};
  if(Buffer.byteLength(JSON.stringify(document),'utf8')>600000)throw fail();
  const reference={id,contentHash:supportSourceHash(document)},noticesReady=await prepareOperationalNotices(tx,notices(document));
  const rootRef=bankCaseRef(du),root=(await tx.get(rootRef)).data(),alertRef=db.collection('admin_alerts').doc('bank_case_entry_'+id),priorAlert=await tx.get(alertRef);
  const op=(await tx.get(opRef(du,uid,rid))).data();
  const entryRef=rootRef.collection('entries').doc(id),missingEntry=await tx.get(entryRef);
  if(missingEntry.exists)throw fail();
  const receipt={protocol:'bank_case_command_v1',actorId:uid,transactionId:tid,disputeId:du,requestId:rid,command:c,payloadHash:supportHash(c),state:'received',reason:null,reference,
    result:{action:c.action,providerOperationObserved:providerEffect!==null,submissionObserved:providerEffect?.submissionObserved===true,
      bankAcceptanceVerified:false,financialEffectAuthorized:false},recordedAt:now,notificationIds:noticesReady.notificationIds,
    ...(op?.futureEffectsNeutralizedAt?{futureEffectsNeutralizedAt:op.futureEffectsNeutralizedAt}:{})};
  if(!root||root.protocol!=='bank_dispute_case_v1'||root.transactionId!==tid||!Number.isSafeInteger(root.version)||root.version<1||root.version>=Number.MAX_SAFE_INTEGER-1)throw fail();
  const update:any={version:root.version+1,updatedAt:now};
  if(c.action==='save_draft'){update.currentDraft=reference;update.responsibleUid=uid;}
  if(c.action==='stage_draft')update.currentStage=reference;
  if(root.pendingEffect?.id===supportHash([uid,rid]))update.pendingEffect=null;
  const rootFields=await bankDocumentarySourceFields('bank_case_root',rootRef,root,update);
  let entryMayAuthorizeFuture=['save_draft','buyer_withdrawal'].includes(c.action);
  if(!entryMayAuthorizeFuture&&op){try{await prepareFinancialRecoverySource('bank_case_command',opRef(du,uid,rid).path,op);entryMayAuthorizeFuture=true;}
    catch(error){if(!(error instanceof FinancialRecoveryBlocked))throw error;}}
  const entry={protocol:document.protocol,document,contentHash:reference.contentHash};
  const entryFields=entryMayAuthorizeFuture?await bankDocumentarySourceFields('bank_case_entry',entryRef,missingEntry,entry):{...entry,financialRecoveryWitness:null};
  // Source/receipt proof reads are complete before every write below.
  tx.create(entryRef,entryFields);
  tx.create(resultRef(du,uid,rid),receipt);tx.update(rootRef,rootFields);
  if(c.action==='attach_file')tx.create(fileRef(du,c.draftReference!,c.fileIndex!),{reference,draftReference:c.draftReference,fileIndex:c.fileIndex});
  if(!priorAlert.exists)tx.create(alertRef,{kind:'bank_dispute_case',severity:'info',refId:du,transactionId:tid,entryId:id,createdAt:now,status:'open',
    message:c.action==='buyer_withdrawal'?'Déclaration de retrait reçue ; issue bancaire inchangée.':'Acte documentaire bancaire à examiner, sans autorité financière.'});
  noticesReady.commit();return receipt;
}
async function observationSource(_tid:string,du:string,admin:boolean){
  let observed:BankObservation|null=null;if(admin){try{observed=await getBankProvider(du);}catch{/* Unknown is not a bank result. */}}
  return observed;
}
/** Recovery reads exact native provider identities. It never uploads or sends. */
async function recover(request:any,tid:string,du:string,rid:string,c:Command,operation:any){
  const uid=request.auth.uid,rr=resultRef(du,uid,rid),stripe=getStripe();if(!stripe||!bankNative(operation.postAuthorizedAt))return null;
  await assertPrivateAccountSession(request);
  let effect:any=null,observation:BankObservation|null=null;
  if(c.action==='attach_file'){
    // A lost upload with no returned native file ID remains unknown. Neither a
    // matching filename/size nor an elapsed clock can associate external bytes.
    if(!bankId(operation.providerFile?.id,'file'))return null;
    const f=await stripe.files.retrieve(operation.providerFile.id);
    if(f.id!==operation.providerFile.id||f.purpose!=='dispute_evidence'||f.size!==operation.file.byteLength||
      f.filename!==operation.filename||!['jpg','jpeg'].includes(f.type??''))return null;
    effect={fileId:f.id,purpose:f.purpose,byteLength:f.size,sourceSha256:operation.file.sha256,generation:operation.file.generation,
      crc32c:operation.file.crc32c,providerObservedAt:Timestamp.now(),submissionObserved:false};
  }else if(c.action==='accept_dispute'){
    let closeProof=operation.closeResponse?.disputeId===du&&operation.closeResponse.status==='lost'&&bankId(operation.closeResponse.requestId,'req')&&bankNative(operation.closeResponse.observedAt)?operation.closeResponse:null;
    if(!closeProof){
      const key='bank_close_'+supportHash([du,operation.id]);
      const page=await stripe.events.list({types:['charge.dispute.closed','charge.dispute.updated'],created:{gte:Math.floor(operation.postAuthorizedAt.toMillis()/1000)},limit:100});
      for(const event of page.data){const d=event.data.object as any;
        if(event.account==null&&event.context==null&&event.request?.idempotency_key===key&&bankId(event.request.id,'req')&&
          d.id===du&&d.status==='lost'&&bankStripeId(d.payment_intent)===operation.providerBefore.paymentIntentId&&bankStripeId(d.charge)===operation.providerBefore.chargeId&&
          d.amount===operation.providerBefore.amountCents&&d.currency==='cad'&&event.livemode===operation.providerBefore.livemode){
          closeProof={disputeId:du,status:'lost',requestId:event.request.id,eventId:event.id,observedAt:Timestamp.now()};break;}}
    }
    if(!closeProof)return null;
    observation=await getBankProvider(du);const p=observation.semantic;
    if(p.status!=='lost'||p.paymentIntentId!==operation.providerBefore.paymentIntentId||p.chargeId!==operation.providerBefore.chargeId||
      p.amountCents!==operation.providerBefore.amountCents||p.livemode!==operation.providerBefore.livemode)return null;
    effect={providerStatus:p.status,providerObservedAt:observation.observedAt,operatorAcceptanceObserved:true,submissionObserved:false,closeProof,bankAcceptanceVerified:false};
  }else{
    observation=await getBankProvider(du);const p=observation.semantic,base=operation.providerBefore;
    if(p.disputeId!==du||p.paymentIntentId!==base.paymentIntentId||p.chargeId!==base.chargeId||p.amountCents!==base.amountCents||
      p.livemode!==base.livemode||p.operationMarker!==operation.id||!bankEvidenceSelectionMatches(p.evidence,operation.evidence))return null;
    if(c.action==='submit_evidence'&&(p.submissionCount!==base.submissionCount+1||p.evidenceHash!==base.evidenceHash))return null;
    if(c.action==='stage_draft'&&p.hasEvidence!==true)return null;
    effect={providerStatus:p.status,providerObservedAt:observation.observedAt,evidenceHash:p.evidenceHash,submissionCount:p.submissionCount,
      hasEvidence:p.hasEvidence,pastDue:p.pastDue,submissionObserved:c.action==='submit_evidence',bankAcceptanceVerified:false,operationMarker:p.operationMarker};
  }
  return db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    const existing=(await tx.get(rr)).data();if(existing)return existing;
    const current=(await tx.get(opRef(du,uid,rid))).data();if(!current||current.payloadHash!==supportHash(c)||current.id!==operation.id||
      !bankNative(current.postAuthorizedAt)||!current.postAuthorizedAt.isEqual(operation.postAuthorizedAt))throw fail();
    // A real effect belongs to its immutable original source, even if current
    // source/role changed. Its receipt grants no new bank/data permission.
    return recordResult(tx,tid,du,uid,rid,c,current.nativeSource,effect);
  });
}
export async function handleBankDisputeCase(request:any){
  return withFinancialRecoveryScope({operation:'bankDisputeCase'},()=>withPrivateAccountSession(request,()=>handleBankDisputeCaseWithSession(request)));
}
async function handleBankDisputeCaseWithSession(request:any){
  const uid=supportUid(request),raw=supportObject(request.data,['capability','expectedUid','mode','scope','transactionId','disputeId','historyKind','cursor','expectedSource','entryReference','requestId','command']);
  if(raw.capability!==BANK_CASE_CAPABILITY||!['list','preview','history','execute','observe','neutralize'].includes(raw.mode))throw new HttpsError('invalid-argument','Version et mode bancaires requis.');
  if(raw.mode==='list'){
    if(raw.scope!=='admin')throw new HttpsError('permission-denied','Lecture opérateur requise.');const after=cursor(raw.cursor);
    const result=await db.runTransaction(async tx=>{await authority(tx,request,true);if(!BANK_CASE_ENABLED)throw new HttpsError('failed-precondition','Dossier bancaire en préparation.',{reason:'bank_case_not_exposed'});
      let q:FirebaseFirestore.Query=db.collection('bank_dispute_cases').orderBy('__name__').limit(21);if(after)q=q.startAfter(after);
      const page=await tx.get(q),rows=[];for(const row of page.docs.slice(0,20)){
        const root=row.data(),r=root.latestObservation;
        const o=r&&typeof r.id==='string'?(await tx.get(row.ref.collection('observations').doc(r.id))).data():null;
        const qualified=root.protocol==='bank_dispute_case_v1'&&root.disputeId===row.id&&o?.contentHash===r?.contentHash&&supportSourceHash(o?.document??null)===r?.contentHash;
        rows.push(qualified?{qualification:'native_bank_case',case:caseView(root,o,true)}:{qualification:'unknown',caseId:row.id,case:null});}
      return {protocol:'bank_case_list_v1',actorId:uid,rows,nextCursor:page.size>20?{lastId:page.docs[19].id}:null,
        coverage:{inspected:Math.min(page.size,20),limit:20,hasMore:page.size>20,exhaustiveHistoricalCasesVerified:false},...effects};});
    await db.runTransaction(tx=>authority(tx,request,true));return result;
  }
  const tid=supportId(raw.transactionId),du=raw.disputeId;if(!bankId(du,'du'))throw new HttpsError('invalid-argument','Identité du litige bancaire requise.');
  if(raw.mode==='preview'||raw.mode==='history'){
    if(!['own','admin'].includes(raw.scope))throw new HttpsError('invalid-argument','Portée bancaire explicite requise.');const historyKind=raw.historyKind??'actions';
    if(!['actions','observations','events'].includes(historyKind)||raw.scope!=='admin'&&historyKind!=='actions')throw new HttpsError('permission-denied','Historique privé non autorisé.');
    const admin=raw.scope==='admin',after=cursor(raw.cursor),selected=raw.entryReference==null?null:refInput(raw.entryReference);
    if(raw.mode==='history'&&after&&raw.expectedSource==null)throw new HttpsError('invalid-argument','La source de la page précédente est requise.');
    await db.runTransaction(async tx=>{await authority(tx,request,admin);const order=(await tx.get(db.collection('transactions').doc(tid))).data();
      if(!order||!admin&&![order.buyerId,order.sellerId].includes(uid))throw new HttpsError('permission-denied','Dossier personnel indisponible.');});
    if(!BANK_CASE_ENABLED)throw new HttpsError('failed-precondition','Dossier bancaire en préparation.',{reason:'bank_case_not_exposed'});
    const observed=await observationSource(tid,du,admin);
    await db.runTransaction(async tx=>{await authority(tx,request,admin);const source=await readBankCaseSource(tx,tid,du,observed);
      if(!source.boundId||!admin&&!source.parties.includes(uid))throw new HttpsError('permission-denied','Identité du dossier non qualifiée.');
      if(admin||!source.root){const commit=await prepareBankObservation(tx,tid,du,observed);commit();}});
    await relayNativeBankDeadline(du);
    const result=await db.runTransaction(async tx=>{await authority(tx,request,admin);const source=await readBankCaseSource(tx,tid,du,observed);
      if(!source.boundId||!admin&&!source.parties.includes(uid))throw new HttpsError('permission-denied','Dossier personnel indisponible.');
      if(raw.expectedSource!=null&&supportObject(raw.expectedSource,['sourceHash']).sourceHash!==source.sourceHash)throw new HttpsError('failed-precondition','La source bancaire a changé.',{reason:'bank_case_source_changed'});
      const root=source.root!,r=root.latestObservation,o=r?(await tx.get(bankCaseRef(du).collection('observations').doc(r.id))).data():null;
      const nativeObservation=o?.contentHash===r?.contentHash&&supportSourceHash(o?.document??null)===r?.contentHash?o:null;
      const selectedEntry=selected?await entryProof(tx,du,selected):null;
      if(selected&&(!selectedEntry||selectedEntry.transactionId!==tid||!admin&&!selectedEntry.parties.includes(uid)))throw new HttpsError('permission-denied','Référence adressée non qualifiée.');
      const rows=[];let nextCursor:any=null,coverage:any=null;
      if(raw.mode==='history'){
        let q:FirebaseFirestore.Query=bankCaseRef(du).collection(historyKind==='actions'?'entries':historyKind).orderBy('__name__').limit(21);if(after)q=q.startAfter(after);
        const page=await tx.get(q);for(const row of page.docs.slice(0,20)){
          const value=row.data();
          if(historyKind==='observations'){
            const d=value.document,qualified=d?.protocol==='bank_case_observation_v1'&&d.disputeId===du&&d.transactionId===tid&&
              value.contentHash===supportSourceHash(d)&&bankNative(d.observedAt);
            rows.push(qualified?{qualification:'native_bank_observation',observation:{id:row.id,contentHash:value.contentHash,
              providerQualified:d.providerQualified,provider:d.semantic,observedAt:d.observedAt.toDate().toISOString(),financialEffectApplied:false,providerRestitutionVerified:false}}:
              {qualification:'unknown',entryId:row.id,entry:null});continue;
          }
          if(historyKind==='events'){
            const {contentHash,...d}=value,qualified=d.protocol==='bank_case_event_v1'&&d.eventId===row.id&&d.disputeId===du&&d.transactionId===tid&&
              contentHash===supportSourceHash(d)&&bankNative(d.receivedAt);
            rows.push(qualified?{qualification:'native_bank_event',event:{...d,contentHash,receivedAt:d.receivedAt.toDate().toISOString()}}:
              {qualification:'unknown',entryId:row.id,entry:null});continue;
          }
          const d=hash(value.contentHash)?await entryProof(tx,du,{id:row.id,contentHash:value.contentHash}):null;
          rows.push(d?{qualification:'native_bank_entry',entry:admin?adminEntryView(d):{id:d.id,action:d.command.action,recordedAt:d.recordedAt.toDate().toISOString(),
            ownStatement:d.actorId===uid&&d.command.action==='buyer_withdrawal'?d.command.text:null,bankOutcomeEstablished:false}}:
            {qualification:'unknown',entryId:row.id,entry:null});}
        nextCursor=page.size>20?{lastId:page.docs[19].id}:null;coverage={inspected:Math.min(page.size,20),limit:20,hasMore:page.size>20,exhaustiveHistoryVerified:false};}
      return {protocol:'bank_case_preview_v1',actorId:uid,scope:raw.scope,transactionId:tid,disputeId:du,historyKind,source:{sourceHash:source.sourceHash,
        qualification:source.qualified?'native_current':'unknown'},case:caseView(root,nativeObservation,admin),
        operatorSource:admin?{capture:source.capture,providerEvidence:observed?.semantic.evidence??null,providerResponseAvailable:bankResponseAvailable(source.provider),acceptDisputeAvailable:source.qualified&&source.provider?.status==='needs_response'&&bankResponseAvailable(source.provider),
          refundBankOverlap:source.order.bankRefundReconciliation!=null,netFinancialResolutionQualified:false,ledgerEntries:source.ledgerEntries,
          refundRecorded:source.order.refund?{intentId:typeof source.order.refund.intentId==='string'?source.order.refund.intentId:null,
            state:typeof source.order.refund.state==='string'?source.order.refund.state:'unknown',
            cardCents:Number.isSafeInteger(source.order.refund.cardAmountCents)?source.order.refund.cardAmountCents:null,
            walletCents:Number.isSafeInteger(source.order.refund.walletAmountCents)?source.order.refund.walletAmountCents:null,
            fundsAppliedAt:bankNative(source.order.refund.fundsAppliedAt)?source.order.refund.fundsAppliedAt.toDate().toISOString():null}:null}:null,
        canDeclareWithdrawal:!admin&&source.order.buyerId===uid,selectedEntry:selectedEntry?admin?adminEntryView(selectedEntry):{id:selectedEntry.id,action:selectedEntry.command.action,
          recordedAt:selectedEntry.recordedAt.toDate().toISOString(),ownStatement:selectedEntry.actorId===uid&&selectedEntry.command.action==='buyer_withdrawal'?selectedEntry.command.text:null,bankOutcomeEstablished:false}:null,
        rows,nextCursor,coverage,readAt:Timestamp.now().toDate().toISOString(),...effects};
    });
    await db.runTransaction(tx=>authority(tx,request,admin));return result;
  }
  const c=input(raw.command),rid=supportRequestId(raw.requestId),op=opRef(du,uid,rid),rr=resultRef(du,uid,rid);
  const first=await db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    const prior=(await tx.get(rr)).data(),operation=(await tx.get(op)).data();
    if(prior){if(prior.actorId!==uid||prior.transactionId!==tid||prior.disputeId!==du||prior.requestId!==rid||prior.payloadHash!==supportHash(c)||supportHash(prior.command)!==supportHash(c))throw fail();
      if(prior.state==='received'&&!await entryProof(tx,du,refInput(prior.reference)))throw fail();return {receipt:prior,operation};}
    if(operation&&(operation.actorId!==uid||operation.requestId!==rid||operation.transactionId!==tid||operation.payloadHash!==supportHash(c)||supportHash(operation.command)!==supportHash(c)))throw new HttpsError('already-exists','Une autre intention utilise cet identifiant.');
    if(raw.mode==='observe')return {receipt:null,operation};
    const refuse=(reason:string)=>{const v={protocol:'bank_case_command_v1',actorId:uid,transactionId:tid,disputeId:du,requestId:rid,command:c,payloadHash:supportHash(c),state:'not_executed',reason,
      reference:null,result:null,recordedAt:Timestamp.now()};tx.create(rr,v);return {receipt:v,operation};};
    if(raw.mode==='neutralize'){
      if(!operation)return refuse('requester_neutralized');
      const root=(await tx.get(bankCaseRef(du))).data(),at=Timestamp.now();
      tx.update(op,await bankDocumentarySourceFields('bank_case_command',op,operation,{futureEffectsNeutralizedAt:at}));
      if(!operation.postAuthorizedAt){if(root?.pendingEffect?.id===operation.id)tx.update(bankCaseRef(du),await bankDocumentarySourceFields('bank_case_root',bankCaseRef(du),root!,{pendingEffect:null}));return refuse('requester_neutralized');}
      return {receipt:null,operation:{...operation,futureEffectsNeutralizedAt:at}};
    }
    if(operation)return {receipt:null,operation};
    if(!BANK_CASE_ENABLED)return refuse('bank_case_not_exposed');
    return {receipt:null,operation:null};
  });
  if(first.receipt)return receiptView(uid,tid,du,rid,c,first.receipt);
  if(first.operation){try{const v=await recover(request,tid,du,rid,c,first.operation);if(v)return receiptView(uid,tid,du,rid,c,v);}catch(error){if(error instanceof FinancialRecoveryBlocked)throw error;/* Never replay an unknown POST. */}
    return receiptView(uid,tid,du,rid,c,{state:'unknown',futureEffectsNeutralizedAt:first.operation.futureEffectsNeutralizedAt});}
  if(raw.mode==='observe'||raw.mode==='neutralize')return receiptView(uid,tid,du,rid,c);
  const admin=c.scope==='admin';
  await db.runTransaction(async tx=>{await authority(tx,request,admin);const order=(await tx.get(db.collection('transactions').doc(tid))).data();
    if(!order||!admin&&order.buyerId!==uid)throw new HttpsError('permission-denied','Déclaration personnelle indisponible.');});
  await checkRateLimit(uid,true,{functionName:'bankDisputeCase',maxCallsAuthenticated:admin?30:10,maxCallsUnauthenticated:0,windowMs:60000});
  const observation=await observationSource(tid,du,admin);
  const operation=await db.runTransaction(async tx=>{
    const recoveryCommit=financialRecoveryCommitCheckpoint();
    await assertPrivateAccountSession(request,tx);
    const prior=(await tx.get(rr)).data(),opSnapshot=await tx.get(op);if(prior)return {receipt:prior};if(opSnapshot.exists)throw fail();
    await authority(tx,request,admin);const source=await readBankCaseSource(tx,tid,du,observation);
    if(!source.boundId||!admin&&source.order.buyerId!==uid)throw new HttpsError('permission-denied','Dossier personnel indisponible.');
    const refuse=(reason:string)=>{const receipt={protocol:'bank_case_command_v1',actorId:uid,transactionId:tid,disputeId:du,requestId:rid,command:c,payloadHash:supportHash(c),state:'not_executed',reason,
      reference:null,result:null,recordedAt:Timestamp.now()};tx.create(rr,receipt);return {receipt};};
    if(c.sourceHash!==source.sourceHash)return refuse('bank_case_source_changed');
    if(admin&&!source.qualified)return refuse('bank_case_source_unknown');
    if(c.action==='buyer_withdrawal'||c.action==='save_draft'){
      if(c.action==='save_draft')await piecesProof(tx,tid,c.pieces);
      const receipt=await recordResult(tx,tid,du,uid,rid,c,source,null);return {receipt};}
    if(!bankResponseAvailable(source.provider))return refuse('bank_response_not_available');
    if(source.root?.pendingEffect!=null)return refuse('pending_operation_requires_observation');
    let file:any=null,evidence:Record<string,string>={};
    if(c.action==='accept_dispute'){
      if(source.provider!.status!=='needs_response')return refuse('bank_response_not_available');
    }else{
      const draft=await draftData(tx,du,c);if(supportHash(source.root?.currentDraft)!==supportHash(c.draftReference))return refuse('draft_reference_changed');
      await qualifyBankEntry(tx,du,c.draftReference!);
      const pieces=await piecesProof(tx,tid,draft.command.pieces);file=c.action==='attach_file'?pieces[c.fileIndex!]:null;
      if(c.action==='attach_file'){
        if(!file||(await tx.get(fileRef(du,c.draftReference!,c.fileIndex!))).exists)return refuse('file_already_recorded_or_unknown');
      }else {
        evidence=await providerPayload(tx,du,draft);
        // A partial Stripe update cannot remove an older unselected field.
        // Refuse it rather than silently sending that material with this draft.
        if(c.action==='stage_draft'&&bankEvidenceHasUnselected(source.provider!.evidence,evidence)||
          c.action==='submit_evidence'&&!bankEvidenceSelectionMatches(source.provider!.evidence,evidence))return refuse('bank_evidence_selection_mismatch');
      }
      if(c.action==='submit_evidence'){
        const current=source.root?.currentStage?await entryProof(tx,du,refInput(source.root.currentStage)):null;
        if(!current||current.command.action!=='stage_draft'||supportHash(current.command.draftReference)!==supportHash(c.draftReference)||
          current.providerEffect?.evidenceHash!==source.provider!.evidenceHash||current.providerEffect?.submissionCount!==source.provider!.submissionCount||source.provider!.hasEvidence!==true)
          return refuse('stage_reference_changed');
        await qualifyBankEntry(tx,du,refInput(source.root!.currentStage));}
    }
    const id=supportHash([uid,rid]),value={protocol:'bank_case_operation_v1',id,actorId:uid,requestId:rid,transactionId:tid,disputeId:du,command:c,payloadHash:supportHash(c),
      nativeSource:{sourceHash:source.sourceHash,capture:source.capture,parties:source.parties},providerBefore:source.provider,evidence,
      file:file?{...file.storageProof,evidenceId:file.selection.evidenceId,evidenceHash:file.selection.evidenceHash}:null,
      filename:file?`bank_${id}.jpg`:null,providerFile:null,reservedAt:Timestamp.now(),postAuthorizedAt:null,futureEffectsNeutralizedAt:null};
    await qualifyEffectSource(source,du);
    const intent={...value,providerPayloadHash:providerPayloadHash(value)},rootFields=await financialRecoverySourceFields('bank_case_root',bankCaseRef(du),source.root!,{pendingEffect:{id,actorId:uid,payloadHash:supportHash(c)}});
    const intentFields=await financialRecoverySourceFields('bank_case_command',op,opSnapshot,intent);
    await recoveryCommit({refs:[op.path,bankCaseRef(du).path,source.ref.path]});
    tx.create(op,intentFields);tx.update(bankCaseRef(du),rootFields);return {operation:intent};
  });
  if(operation.receipt)return receiptView(uid,tid,du,rid,c,operation.receipt);
  const nativeOperation=operation.operation!;let bytes:Buffer|null=null;
  if(c.action==='attach_file'){
    const f=nativeOperation.file!,result=await readProductReviewEvidenceFile({...request,data:{expectedUid:uid,operation:'evidence_file',scope:'admin',context:{kind:'order',id:tid},
      evidenceId:f.evidenceId,expectedEvidenceHash:f.evidenceHash}});
    bytes=Buffer.from(result.dataUrl.slice('data:image/jpeg;base64,'.length),'base64');
    if(bytes.length!==f.byteLength||createHash('sha256').update(bytes).digest('hex')!==f.sha256||result.generation!==f.generation||result.crc32c!==f.crc32c)throw fail();
  }
  await db.runTransaction(tx=>authority(tx,request,true));
  const current=await observationSource(tid,du,true);
  const permitted=await db.runTransaction(async tx=>{
    const recoveryCommit=financialRecoveryCommitCheckpoint();
    await assertPrivateAccountSession(request,tx);
    const value=(await tx.get(op)).data(),receipt=(await tx.get(rr)).data();if(receipt)return {allowed:false,receipt};
    if(!value||value.postAuthorizedAt||value.futureEffectsNeutralizedAt)return {allowed:false,receipt:null};
    const root=(await tx.get(bankCaseRef(du))).data();
    const refuse=async(reason:string)=>{
      const record={protocol:'bank_case_command_v1',actorId:uid,transactionId:tid,disputeId:du,requestId:rid,command:c,payloadHash:supportHash(c),
        state:'not_executed',reason,reference:null,result:null,recordedAt:Timestamp.now()};
      const opFields=await bankDocumentarySourceFields('bank_case_command',op,value,{futureEffectsNeutralizedAt:Timestamp.now()});
      const rootFields=root?.pendingEffect?.id===nativeOperation.id?await bankDocumentarySourceFields('bank_case_root',bankCaseRef(du),root,{pendingEffect:null}):null;
      tx.create(rr,record);tx.update(op,opFields);
      if(rootFields)tx.update(bankCaseRef(du),rootFields);return {allowed:false,receipt:record};
    };
    try{await authority(tx,request,true);}catch(error){if(error instanceof FinancialRecoveryBlocked)throw error;return refuse('operator_authority_unavailable');}
    const source=await readBankCaseSource(tx,tid,du,current);
    if(!source.qualified)return refuse('bank_case_source_unknown');
    if(source.sourceHash!==nativeOperation.nativeSource.sourceHash)return refuse('bank_case_source_changed');
    if(!bankResponseAvailable(source.provider)||c.action==='accept_dispute'&&source.provider?.status!=='needs_response')return refuse('bank_response_not_available');
    if(c.action==='stage_draft'&&bankEvidenceHasUnselected(source.provider!.evidence,nativeOperation.evidence)||
      c.action==='submit_evidence'&&!bankEvidenceSelectionMatches(source.provider!.evidence,nativeOperation.evidence))return refuse('bank_evidence_selection_mismatch');
    if(source.root?.pendingEffect?.id!==nativeOperation.id)return refuse('pending_operation_requires_observation');
    if(value.id!==nativeOperation.id||value.payloadHash!==supportHash(c)||supportHash(value.command)!==supportHash(c)||
      value.providerPayloadHash!==providerPayloadHash(value)||value.providerPayloadHash!==nativeOperation.providerPayloadHash||
      value.nativeSource?.sourceHash!==nativeOperation.nativeSource.sourceHash||supportSourceHash(value.nativeSource.capture)!==value.nativeSource.sourceHash)throw fail();
    await qualifyEffectSource(source,du);
    const fields=await financialRecoverySourceFields('bank_case_command',op,value,{postAuthorizedAt:Timestamp.now()});
    await recoveryCommit({refs:[op.path,source.ref.path,bankCaseRef(du).path]});
    tx.update(op,fields);return {allowed:true,receipt:null};
  });
  if(!permitted.allowed)return receiptView(uid,tid,du,rid,c,permitted.receipt??{state:'unknown'});
  const stripe=getStripe();if(!stripe)return receiptView(uid,tid,du,rid,c,{state:'unknown'});
  // The immutable instruction and its parents are requalified after private
  // file/provider reads, immediately before the one new provider operation.
  await db.runTransaction(async tx=>{
    await authority(tx,request,true);
    const value=(await tx.get(op)).data(),source=await readBankCaseSource(tx,tid,du,current);
    if(!value||!bankNative(value.postAuthorizedAt)||value.futureEffectsNeutralizedAt||value.id!==nativeOperation.id||
      value.payloadHash!==supportHash(c)||supportHash(value.command)!==supportHash(c)||value.providerPayloadHash!==providerPayloadHash(value)||
      value.providerPayloadHash!==nativeOperation.providerPayloadHash||source.sourceHash!==nativeOperation.nativeSource.sourceHash||
      source.root?.pendingEffect?.id!==value.id)throw fail();
    await qualifyEffectSource(source,du);
    await prepareFinancialRecoverySource('bank_case_command',op.path,value);
  });
  try{
    if(c.action==='attach_file'){
      const file=await stripe.files.create({purpose:'dispute_evidence',file:{data:bytes!,name:nativeOperation.filename!,type:'image/jpeg'}},
        {idempotencyKey:'bank_file_'+supportHash([du,nativeOperation.id])});
      if(!bankId(file.id,'file')||file.purpose!=='dispute_evidence'||file.size!==nativeOperation.file!.byteLength||file.filename!==nativeOperation.filename||!['jpg','jpeg'].includes(file.type??''))throw fail();
      await db.runTransaction(async tx=>{const v=(await tx.get(op)).data();if(!v||v.payloadHash!==supportHash(c)||!bankNative(v.postAuthorizedAt))throw fail();
        tx.update(op,await bankDocumentarySourceFields('bank_case_command',op,v,{providerFile:{id:file.id,purpose:file.purpose,byteLength:file.size,
          sourceSha256:nativeOperation.file!.sha256,generation:nativeOperation.file!.generation,crc32c:nativeOperation.file!.crc32c,observedAt:Timestamp.now()}}));});
    }else if(c.action==='accept_dispute'){
      const response=await stripe.disputes.close(du,{}, {idempotencyKey:'bank_close_'+supportHash([du,nativeOperation.id])});
      if(response.id!==du||response.status!=='lost'||!bankId(response.lastResponse?.requestId,'req'))throw fail();
      await db.runTransaction(async tx=>{const v=(await tx.get(op)).data();if(!v||v.payloadHash!==supportHash(c)||!bankNative(v.postAuthorizedAt))throw fail();
        tx.update(op,await bankDocumentarySourceFields('bank_case_command',op,v,{closeResponse:{disputeId:du,status:response.status,requestId:response.lastResponse.requestId,observedAt:Timestamp.now()}}));});
    }else await stripe.disputes.update(du,{...(c.action==='stage_draft'?{evidence:nativeOperation.evidence}:{}),submit:c.action==='submit_evidence',
      metadata:{seconde_bank_operation:nativeOperation.id}},{idempotencyKey:'bank_dispute_'+supportHash([du,nativeOperation.id])});
    const actual=(await op.get()).data();const completed=await recover(request,tid,du,rid,c,actual);if(completed)return receiptView(uid,tid,du,rid,c,completed);
  }catch(error){if(error instanceof FinancialRecoveryBlocked)throw error;/* Native intent remains unknown. No second upload/send or invented failure. */}
  return receiptView(uid,tid,du,rid,c,{state:'unknown'});
}
/** Invoked only by the existing signature-verified webhook dispatcher. Durable
 * observations precede ACK; this path never invokes the financial transition. */
export async function recordBankDisputeCaseEvent(event:any){
  const dispute=event?.data?.object,du=dispute?.id;
  if(!bankId(du,'du')||!bankId(event?.id,'evt')||!['charge.dispute.created','charge.dispute.updated','charge.dispute.closed',
    'charge.dispute.funds_withdrawn','charge.dispute.funds_reinstated'].includes(event.type))throw new Error('Native bank event identity unavailable');
  const old=await bankCaseRef(du).collection('events').doc(event.id).get();if(old.exists){await relayNativeBankDeadline(du);return;}
  let observation:BankObservation|null=null;
  if(event.account==null&&event.context==null){try{observation=await getBankProvider(du);}catch{/* Unknown observation must be durable. */}}
  const pi=observation?.semantic.paymentIntentId??bankStripeId(dispute.payment_intent);
  await db.runTransaction(async tx=>{
    if((await tx.get(bankCaseRef(du).collection('events').doc(event.id))).exists)return;
    let tid:string|null=null;
    if(observation&&bankId(pi,'pi')){
      const matches=await tx.get(db.collection('transactions').where('stripePaymentIntentId','==',pi).limit(2));
      if(matches.size===1&&bankNativeIdentity(matches.docs[0].data(),observation))tid=matches.docs[0].id;
    }
    const commit=await prepareBankObservation(tx,tid,du,observation,event);commit();
  });
  await relayNativeBankDeadline(du);
}

export type BankCaseResponse=Awaited<ReturnType<typeof handleBankDisputeCase>>;
