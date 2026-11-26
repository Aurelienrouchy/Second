/** Carrier billing/indemnity documents. This module never changes money, labels or commercial guards. */
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {auth,db} from '../config/firebase';
import {readLabelLifecyclePurchasedSource,type LabelPurchasedReference} from './labelLifecycle';
import {supportUid,supportObject,supportId,supportRequestId,supportHash,supportSourceHash,supportRevision,supportText,supportDeclaredDate,
  supportCurrentAdminSession,supportAdmin} from './supportRequest';
import {prepareOperationalNotices,readOperationalNoticeReceipts} from './notifications';
import {checkRateLimit} from './rateLimit';

export const TRANSPORT_CARRIER_CAPABILITY='transport_carrier_review_v1';
export const TRANSPORT_CARRIER_ENABLED:boolean=true;
const HASH=/^[a-f0-9]{64}$/;
const native=(v:unknown):v is Timestamp=>v instanceof Timestamp&&Number.isSafeInteger(v.toMillis())&&v.toMillis()>0&&v.toMillis()<=Date.now();
const docId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&Buffer.byteLength(v,'utf8')<=1500&&!v.includes('/')&&!['.','..'].includes(v)&&!/^__.*__$/.test(v);
const has=(v:any,k:string)=>Object.prototype.hasOwnProperty.call(v??{},k);
function choice<T extends string>(v:unknown,allowed:readonly T[]):T {if(!allowed.includes(v as T))throw new HttpsError('invalid-argument','Qualification explicite requise.');return v as T;}
const optionalText=(v:unknown,max=1000)=>v===null?null:supportText(v,'Information déclarée',max);
function date(v:unknown):string|null {if(v===null)return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isSafeInteger(Date.parse(v))||new Date(v).toISOString()!==v)throw new HttpsError('invalid-argument','Date ISO exacte ou inconnue requise.');return v;}
function cents(v:unknown,signed=false):number|null {if(v===null)return null;if(!Number.isSafeInteger(v)||!signed&&(v as number)<0)throw new HttpsError('invalid-argument','Montant CAD entier ou inconnu requis.');return v as number;}
type EntryReference={id:string;contentHash:string};
function entryReference(v:unknown):EntryReference {const r=supportObject(v,['id','contentHash']);if(!/^cae_[a-f0-9]{64}$/.test(r.id??'')||!HASH.test(r.contentHash??''))throw new HttpsError('invalid-argument','Entrée exacte de ce dossier requise.');return {id:r.id,contentHash:r.contentHash};}
function refs(v:unknown,evidence=false):EntryReference[] {if(!Array.isArray(v)||v.length>100)throw new HttpsError('invalid-argument','Références bornées requises.');const result=v.map(r=>{if(!evidence)return entryReference(r);const x=supportObject(r,['id','contentHash']);if(!docId(x.id)||!HASH.test(x.contentHash??''))throw new HttpsError('invalid-argument','Pièce native exacte requise.');return {id:x.id,contentHash:x.contentHash};});if(new Set(result.map(r=>r.id)).size!==result.length)throw new HttpsError('invalid-argument','Références en double.');return result;}
type Context={transactionId:string;leg:'forward'|'return';topic:'carrier_billing'|'carrier_indemnity';label:LabelPurchasedReference;
  parentReview:null|{caseId:string;revision:string;contentHash:string}};
function context(v:unknown):Context {
  const c=supportObject(v,['transactionId','leg','topic','label','parentReview']),l=supportObject(c.label,['kind','entryId','contentHash']);
  let label:LabelPurchasedReference;
  if(l.kind==='initial'&&!has(l,'entryId')&&!has(l,'contentHash'))label={kind:'initial'};
  else if(l.kind==='replacement'&&/^le_[a-f0-9]{64}$/.test(l.entryId??'')&&HASH.test(l.contentHash??''))label={kind:'replacement',entryId:l.entryId,contentHash:l.contentHash};
  else throw new HttpsError('invalid-argument','Achat d’étiquette natif exact requis.');
  const p=c.parentReview===null?null:supportObject(c.parentReview,['caseId','revision','contentHash']);
  if(p&&(!/^(case|contact_case|carrier_case)_[a-f0-9]{64}$/.test(p.caseId??'')||typeof p.revision!=='string'||!/^\d+:\d+$/.test(p.revision)||!HASH.test(p.contentHash??'')))throw new HttpsError('invalid-argument','Dossier parent exact requis.');
  return {transactionId:supportId(c.transactionId),leg:choice(c.leg,['forward','return'] as const),topic:choice(c.topic,['carrier_billing','carrier_indemnity'] as const),label,parentReview:p?{caseId:p.caseId,revision:p.revision,contentHash:p.contentHash}:null};
}
function provenance(v:unknown){const s=supportObject(v,['kind','issuer','reference','issuedAt']);return {kind:choice(s.kind,['participant_statement','carrier_document_declared','operator_carrier_contact','document_reference','unknown'] as const),issuer:optionalText(s.issuer,500),reference:optionalText(s.reference,500),issuedAt:supportDeclaredDate(s.issuedAt,Date.now())};}
function settlement(v:unknown){if(v===null)return null;const s=supportObject(v,['amountCents','finality','source']);return {amountCents:cents(s.amountCents),finality:choice(s.finality,['partial','final','unknown'] as const),source:provenance(s.source)};}
function statementInput(v:unknown,c:Context) {
  const s=supportObject(v,['protocol','summary','source','occurredAt','parent','billing','indemnity','evidenceReferences','evidenceAvailability','evidenceLimitations']);
  if(s.protocol!=='transport_carrier_statement_v1')throw new HttpsError('invalid-argument','Version du constat transporteur requise.');
  const parent=s.parent===null?null:entryReference(s.parent);
  let billing=null,indemnity=null;
  if(c.topic==='carrier_billing') {
    if(s.indemnity!==null)throw new HttpsError('invalid-argument','Facturation et indemnité sont deux dossiers distincts.');
    const b=supportObject(s.billing,['event','allocation','amountCents','currency','reason','finality','settlement']);
    const event=choice(b.event,['invoice','adjustment','credit_note','challenge','carrier_response','settlement_document','unknown'] as const);
    if(b.currency!=='CAD'||['challenge','carrier_response'].includes(event)&&!parent)throw new HttpsError('invalid-argument','Devise ou réponse liée manquante.');
    billing={event,allocation:choice(b.allocation,['attributed_to_selected_label','grouped_unallocated','unknown'] as const),amountCents:cents(b.amountCents,true),currency:'CAD' as const,
      reason:optionalText(b.reason,2000),finality:choice(b.finality,['provisional','final','unknown'] as const),settlement:settlement(b.settlement)};
    if(event==='settlement_document'? !billing.settlement||!parent : billing.settlement!==null)throw new HttpsError('invalid-argument','Document de règlement distinct lié requis.');
  } else {
    if(s.billing!==null)throw new HttpsError('invalid-argument','Facturation et indemnité sont deux dossiers distincts.');
    const n=supportObject(s.indemnity,['event','coverage','claim','decision','recourse','settlement']);
    const coverage=supportObject(n.coverage,['state','summary','source']);
    const claim=n.claim===null?null:supportObject(n.claim,['claimant','beneficiary','reference','requestedCents','submittedAt']);
    const decision=n.decision===null?null:supportObject(n.decision,['state','approvedCents','reason','source']);
    const recourse=n.recourse===null?null:supportObject(n.recourse,['rejection','reference','submittedAt','deadlineAt','deadlineSource']);
    const event=choice(n.event,['coverage_document','claim_submitted','decision_document','recourse_submitted','carrier_response','settlement_document','unknown'] as const);
    indemnity={event,coverage:{state:choice(coverage.state,['documented_declared','not_documented','unknown'] as const),summary:optionalText(coverage.summary,2000),source:provenance(coverage.source)},
      claim:claim?{claimant:choice(claim.claimant,['buyer','seller','platform','other','unknown'] as const),beneficiary:choice(claim.beneficiary,['buyer','seller','platform','other','unknown'] as const),reference:optionalText(claim.reference,500),requestedCents:cents(claim.requestedCents),submittedAt:supportDeclaredDate(claim.submittedAt,Date.now())}:null,
      decision:decision?{state:choice(decision.state,['rejected','partially_accepted','accepted','unknown'] as const),approvedCents:cents(decision.approvedCents),reason:optionalText(decision.reason,2000),source:provenance(decision.source)}:null,
      recourse:recourse?{rejection:recourse.rejection===null?null:entryReference(recourse.rejection),reference:optionalText(recourse.reference,500),submittedAt:supportDeclaredDate(recourse.submittedAt,Date.now()),deadlineAt:date(recourse.deadlineAt),deadlineSource:provenance(recourse.deadlineSource)}:null,
      settlement:settlement(n.settlement)};
    const cover=indemnity.coverage;
    if(cover.state==='documented_declared'&&(cover.source.kind==='unknown'||!cover.source.issuer||!cover.source.reference||!cover.source.issuedAt||!cover.summary))throw new HttpsError('invalid-argument','Une couverture déclarée documentée exige sa source datée ; sinon indiquez inconnue.');
    if(event==='claim_submitted'&&!claim||event==='decision_document'&&(!decision||!parent)||event==='recourse_submitted'&&(!recourse||!recourse.rejection||!parent)||event==='carrier_response'&&!parent)
      throw new HttpsError('invalid-argument','Cycle demande, décision, recours et règlement distincts requis.');
    if(event==='settlement_document'? !indemnity.settlement||!parent : indemnity.settlement!==null)throw new HttpsError('invalid-argument','Document de règlement distinct lié requis.');
    if(indemnity.decision?.state==='rejected'&&indemnity.decision.approvedCents!==null&&indemnity.decision.approvedCents!==0)throw new HttpsError('invalid-argument','Montant accordé contradictoire au rejet.');
    const ds=indemnity.recourse?.deadlineSource;
    if(indemnity.recourse?.deadlineAt!==null&&indemnity.recourse?.deadlineAt!==undefined&&(!ds||ds.kind==='unknown'||!ds.issuer||!ds.reference||!ds.issuedAt))throw new HttpsError('invalid-argument','Une échéance de recours connue exige sa source déclarée datée.');
  }
  return {protocol:'transport_carrier_statement_v1' as const,summary:supportText(s.summary,'Résumé communicable',2000),source:provenance(s.source),occurredAt:supportDeclaredDate(s.occurredAt,Date.now()),parent,billing,indemnity,
    evidenceReferences:refs(s.evidenceReferences,true),evidenceAvailability:choice(s.evidenceAvailability,['available','unavailable','unknown'] as const),evidenceLimitations:optionalText(s.evidenceLimitations,2000)};
}
type Statement=ReturnType<typeof statementInput>;
type Reference={sourceHash:string;semanticHash:string;caseRevision:string|null;caseHash:string|null;observationSetHash:string;corpusHash:string;membersHash:string};
function sourceReference(v:unknown):Reference {const r=supportObject(v,['sourceHash','semanticHash','caseRevision','caseHash','observationSetHash','corpusHash','membersHash']);if(!['sourceHash','semanticHash','observationSetHash','corpusHash','membersHash'].every(k=>HASH.test(r[k]??''))||
  (r.caseRevision===null?r.caseHash!==null:typeof r.caseRevision!=='string'||!/^\d+:\d+$/.test(r.caseRevision)||!HASH.test(r.caseHash??'')))throw new HttpsError('invalid-argument','Sources et révision exactes requises.');return r as Reference;}
function instructionInput(v:unknown){const i=supportObject(v,['action','privateNote','buyerMessage','sellerMessage','contradictions','nextFollowUpAt','examinedObservationReferences','evidenceReferences','amountReview','acknowledged']);
  if(i.acknowledged!==true)throw new HttpsError('invalid-argument','Examen humain explicite requis.');
  const a=i.amountReview===null?null:supportObject(i.amountReview,['basis','adjustments','settlements']);
  return {action:choice(i.action,['maintain_review','contest','request_information','await_response','record_settlement_document','close_documentary_follow_up'] as const),privateNote:supportText(i.privateNote,'Motivation privée',4000),buyerMessage:supportText(i.buyerMessage,'Message acheteur',3000),sellerMessage:supportText(i.sellerMessage,'Message vendeur',3000),
    contradictions:choice(i.contradictions,['examined_for_sources','unresolved','unknown'] as const),nextFollowUpAt:date(i.nextFollowUpAt),examinedObservationReferences:refs(i.examinedObservationReferences),evidenceReferences:refs(i.evidenceReferences,true),
    amountReview:a?{basis:a.basis===null?null:entryReference(a.basis),adjustments:refs(a.adjustments),settlements:refs(a.settlements)}:null,acknowledged:true};
}
type Instruction=ReturnType<typeof instructionInput>;
type Command={action:'record_statement'|'record_operator_observation';context:Context;source:Reference;statement:Statement}|{action:'record_instruction';context:Context;source:Reference;instruction:Instruction;previewId?:string};
function commandInput(v:unknown):Command {const c=supportObject(v,['action','context','source','statement','instruction','previewId']),ctx=context(c.context),source=sourceReference(c.source);
  if(['record_statement','record_operator_observation'].includes(c.action)){if(has(c,'instruction')||has(c,'previewId'))throw new HttpsError('invalid-argument','Constat sans instruction requis.');return {action:c.action,context:ctx,source,statement:statementInput(c.statement,ctx)};}
  if(c.action!=='record_instruction'||has(c,'statement')||c.previewId!==undefined&&!/^carrier_preview_[a-f0-9]{64}$/.test(c.previewId))throw new HttpsError('invalid-argument','Instruction exacte requise.');
  return {action:'record_instruction',context:ctx,source,instruction:instructionInput(c.instruction),...(c.previewId===undefined?{}:{previewId:c.previewId})};
}
const previewCommand=(c:Extract<Command,{action:'record_instruction'}>)=>{const {previewId:_previewId,...body}=c;return body;};
const caseId=(c:Context)=>'carrier_case_'+supportHash(c);
const rows=(id:string)=>db.collection('transactions').doc(id).collection('transport_reviews');
const caseRef=(c:Context)=>rows(c.transactionId).doc(caseId(c));
const receiptRef=(c:Context,uid:string,rid:string)=>rows(c.transactionId).doc('carrier_command_'+supportHash([uid,rid]));
const eid=(uid:string,rid:string)=>'cae_'+supportHash([uid,rid]);
const noAuthority={financialEffectAuthorized:false,inventoryReleaseAuthorized:false,shippingPermissionGranted:false,carrierLiabilityVerified:false,
  coverageVerified:false,externalMoneyReceivedVerified:false,legalDeadlineCreated:false,otherGuardsLifted:false} as const;
function selected(r:any){if(r.capability!==TRANSPORT_CARRIER_CAPABILITY)throw new HttpsError('invalid-argument','Version du dossier coût/indemnité requise.');}
async function operator(tx:FirebaseFirestore.Transaction,request:any,uid:string){await supportCurrentAdminSession(request);const at=request.auth.token.auth_time*1000;
  if(!Number.isSafeInteger(at)||at<1||at>Date.now()||Date.now()-at>300000)throw new HttpsError('permission-denied','Réauthentification opérateur récente requise.');
  await supportAdmin(tx,uid,false);const role=await tx.get(db.collection('users').doc(uid));if(role.data()?.isAdmin!==true||role.data()?.isActive===false)throw new HttpsError('permission-denied','Rôle privé courant requis.');
  return {actorId:uid,authTime:request.auth.token.auth_time,privateRoleHash:supportSourceHash(role.data()),qualifiedAtCommit:true};}
async function authorityCurrent(tx:FirebaseFirestore.Transaction,d:any){const role=(await tx.get(db.collection('users').doc(d.actorId))).data();if(role?.isAdmin!==true||role.isActive===false)return false;
  try{const u=await auth.getUser(d.actorId),ms=d.authority.authTime*1000,cutoff=u.tokensValidAfterTime==null?null:Date.parse(u.tokensValidAfterTime);return u.uid===d.actorId&&!u.disabled&&Number.isSafeInteger(ms)&&ms>0&&ms<=Date.now()&&(cutoff===null||Number.isSafeInteger(cutoff)&&ms>=cutoff);}catch{return false;}}
const noticeInputs=(c:Context,id:string,buyer:string,seller:string)=>[buyer,seller].map(userId=>({eventKey:`transport_carrier_review_v1:${id}:${userId}`,userId,type:'order_moderation',title:'Dossier transporteur à suivre',
  message:'Un document ou une instruction sur les coûts ou l’indemnisation du transport a été enregistré. Consultez le dossier privé. Cet avis ne confirme ni responsabilité, ni débit, ni remboursement ou arrivée d’argent.',data:{ownerId:userId,transactionId:c.transactionId,transportCarrierCaseId:caseId(c)}}));
async function proof(tx:FirebaseFirestore.Transaction,c:Context,id:string,raw:any) {
  try {
    const d=raw?.document;
    if(raw?.protocol!=='transport_carrier_entry_v1'||d?.protocol!==raw.protocol||d.entryId!==id||id!==eid(d.actorId,d.requestId)||d.caseId!==caseId(c)||
      !docId(d.actorId)||d.actorId.length>128||!docId(d.requestId)||d.requestId.length<16||d.requestId.length>128||!native(d.recordedAt)||
      raw.contentHash!==supportSourceHash(d)||Object.entries(noAuthority).some(([k,v])=>d[k]!==v))return null;
    const command=commandInput(d.command);
    if(caseId(command.context)!==caseId(c)||supportHash(command)!==d.payloadHash||!['buyer','seller','operator'].includes(d.actorRole)||
      (command.action==='record_statement')===(d.actorRole==='operator'))return null;
    const capture=(await tx.get(caseRef(c).collection('source_captures').doc(command.source.sourceHash))).data();
    const r=(await tx.get(receiptRef(c,d.actorId,d.requestId))).data();
    if(capture?.protocol!=='transport_carrier_source_capture_v1'||capture.sourceHash!==command.source.sourceHash||!native(capture.recordedAt)||
      supportSourceHash(capture.document)!==capture.sourceHash||supportHash(capture.document.context)!==supportHash(command.context)||
      supportHash(capture.document.parties)!==supportHash(d.parties)||capture.document.caseRevision!==command.source.caseRevision||capture.document.caseHash!==command.source.caseHash||
      supportSourceHash(capture.document.semantic)!==command.source.semanticHash||supportHash(capture.document.observationReferences)!==command.source.observationSetHash||
      supportSourceHash(capture.document.corpus.manifest)!==command.source.corpusHash||capture.document.corpus.membersHash!==command.source.membersHash||
      r?.protocol!=='transport_carrier_command_v1'||r.actorId!==d.actorId||r.requestId!==d.requestId||r.state!=='committed'||r.entryId!==id||
      r.payloadHash!==d.payloadHash||supportHash(r.command)!==d.payloadHash||!native(r.recordedAt)||!r.recordedAt.isEqual(d.recordedAt))return null;
    const {sourceHash:_sourceHash,parcelReview:_parcelReview,...members}=capture.document.corpus.manifest;
    if(supportSourceHash(members)!==command.source.membersHash)return null;
    if(d.actorRole==='operator') {
      const at=d.authority?.authTime*1000;
      if(d.authority?.actorId!==d.actorId||d.authority.qualifiedAtCommit!==true||!HASH.test(d.authority.privateRoleHash??'')||!Number.isSafeInteger(at)||at<1||at>d.recordedAt.toMillis()||d.recordedAt.toMillis()-at>300000)return null;
    } else if(capture.document.parties[`${d.actorRole}Id`]!==d.actorId)return null;
    const notices=await readOperationalNoticeReceipts(tx,noticeInputs(command.context,id,d.parties.buyerId,d.parties.sellerId));
    if(notices.some((n,i)=>!n||n.notificationId!==r.notificationIds?.[i]))return null;
    return {document:d,command,contentHash:raw.contentHash as string};
  } catch(e) {if(e instanceof TypeError||e instanceof HttpsError&&['failed-precondition','invalid-argument'].includes(e.code))return null;throw e;}
}
async function frame(tx:FirebaseFirestore.Transaction,c:Context) {
  const snap=await tx.get(db.collection('transactions').doc(c.transactionId)),order=snap.data();
  if(!order||!docId(order.buyerId)||!docId(order.sellerId)||order.buyerId===order.sellerId||order.deliveryType!=='shipping')throw new HttpsError('failed-precondition','Commande transport native inconnue.');
  const purchased=await readLabelLifecyclePurchasedSource(tx,c.transactionId,order,c.leg,c.label);
  const rootSnap=await tx.get(caseRef(c)),root=rootSnap.data();
  if(root&&(root.protocol!=='transport_carrier_case_v1'||root.caseId!==caseId(c)||root.buyerId!==order.buyerId||root.sellerId!==order.sellerId||
    !Number.isSafeInteger(root.version)||root.version<1||!native(root.createdAt)||!native(root.updatedAt)||caseId(context(root.context))!==caseId(c)))throw new HttpsError('failed-precondition','Dossier transporteur à rapprocher.');
  let parent=null;
  if(c.parentReview) {
    const p=await tx.get(rows(c.transactionId).doc(c.parentReview.caseId)),d=p.data();
    if(!d||c.parentReview.caseId===caseId(c)||d.buyerId!==order.buyerId||d.sellerId!==order.sellerId||supportRevision(p)!==c.parentReview.revision||
      supportSourceHash(d)!==c.parentReview.contentHash||!native(d.createdAt)||
      (!['transport_contact_case_v1','transport_carrier_case_v1'].includes(d.protocol)&&!d.body))throw new HttpsError('failed-precondition','Dossier parent natif périmé ou inconnu.');
    parent={caseId:p.id,revision:supportRevision(p),contentHash:supportSourceHash(d)};
  }
  const {readProductReviewDocumentarySet}=await import('./productReviewWorkflow');
  const set=await readProductReviewDocumentarySet(tx,{kind:'order',id:c.transactionId},true,true);
  if(set.source.document.nativeActors.buyerId!==order.buyerId||set.source.document.nativeActors.sellerId!==order.sellerId)throw new HttpsError('failed-precondition','Corpus d’une autre commande.');
  const {sourceHash:_sourceHash,parcelReview:_parcelReview,...members}=set.manifest,membersHash=supportSourceHash(members);
  const corpusComplete=set.contributionRows.every(r=>r.proof)&&set.communicationRows.every(r=>r.proof)&&set.evidenceRows.every(r=>r.reference?.state==='received')&&
    set.intentRows.every(r=>r.reference&&['received','not_executed'].includes(r.reference.state))&&!set.coverage.contributionsHasMore&&!set.coverage.communicationsHasMore&&!set.documentaryCoverage.evidenceHasMore&&!set.documentaryCoverage.intentsHasMore;
  const page=await tx.get(caseRef(c).collection('observations').orderBy('__name__').limit(101)),observations=[];
  for(const row of page.docs.slice(0,100))observations.push({id:row.id,contentHash:HASH.test(row.data().contentHash??'')?row.data().contentHash:null,proof:await proof(tx,c,row.id,row.data())});
  const observationReferences=observations.map(r=>({id:r.id,contentHash:r.contentHash}));
  const semantic={protocol:'transport_carrier_semantic_v1',context:c,parties:{buyerId:order.buyerId,sellerId:order.sellerId},articleId:order.articleId??null,
    articleSnapshotHash:supportSourceHash(order.articleSnapshot??null),shippingSnapshotHash:supportSourceHash(order.shippingSnapshot??null),
    purchasedSourceHash:purchased.purchaseSourceHash,parent,financialRecordingHash:supportSourceHash([order.refund??null,order.bankDispute??null,order.fundsReleasedAt??null])};
  const document={protocol:'transport_carrier_source_v1',context:c,parties:semantic.parties,orderRevision:supportRevision(snap),orderHash:supportSourceHash(order),
    caseRevision:supportRevision(rootSnap),caseHash:root?supportSourceHash(root):null,semantic,observationReferences,corpus:{manifest:set.manifest,membersHash}};
  const reference:Reference={sourceHash:supportSourceHash(document),semanticHash:supportSourceHash(semantic),caseRevision:document.caseRevision,caseHash:document.caseHash,
    observationSetHash:supportHash(observationReferences),corpusHash:set.corpusHash,membersHash};
  return {c,order,snap,root,rootSnap,purchased,set,observations,document,reference,corpusComplete,hasMore:page.size>100};
}
type Frame=Awaited<ReturnType<typeof frame>>;
function observation(f:Frame,r:EntryReference){const p=f.observations.find(o=>o.id===r.id&&o.contentHash===r.contentHash)?.proof;return p&&p.command.action!=='record_instruction'?{...p,statement:p.command.statement}:null;}
function monetarySummary(f:Frame,i:Instruction) {
  const unknown={qualification:'unknown' as 'unknown'|'coherent_documentary_amounts',currency:'CAD' as const,basisAmountCents:null as number|null,
    adjustmentCents:null as number|null,settlementDocumentCents:null as number|null,remainingDocumentaryCents:null as number|null,
    selectedReferencesOnly:true,exhaustiveCarrierAccountingVerified:false,actualMoneyReceivedVerified:false};
  const a=i.amountReview;if(!a||i.contradictions!=='examined_for_sources')return unknown;
  if(f.purchased.qualification!=='native_purchased_label'||!f.corpusComplete||f.hasMore||f.observations.some(o=>!o.proof))return unknown;
  const provenanceQualified=(s:ReturnType<typeof provenance>)=>s.kind!=='unknown'&&s.issuer!==null&&s.reference!==null&&s.issuedAt!==null;
  const sourced=(s:Statement)=>provenanceQualified(s.source)&&s.evidenceReferences.length>0&&
    s.evidenceReferences.every(r=>f.set.evidenceRows.some(e=>e.reference?.id===r.id&&e.reference.contentHash===r.contentHash&&e.reference.state==='received'));
  let basis:number|null=null,basisStatement:Statement|null=null;
  if(f.c.topic==='carrier_billing') {
    // A grouped/unknown invoice cannot silently become this order's share,
    // even when the original purchased cost is independently known.
    if(f.observations.some(o=>{const p=o.proof;if(!p||p.command.action==='record_instruction')return false;const b=p.command.statement.billing;return b&&['invoice','adjustment','credit_note'].includes(b.event)&&b.allocation!=='attributed_to_selected_label';}))return unknown;
    if(f.observations.some(o=>{const p=o.proof;if(!p||p.command.action==='record_instruction')return false;const b=p.command.statement.billing;
      return b&&['adjustment','credit_note'].includes(b.event)&&!a.adjustments.some(r=>r.id===o.id&&r.contentHash===o.contentHash);}))return unknown;
    if(a.basis){const b=observation(f,a.basis)?.statement;if(!b||!sourced(b)||b.billing?.event!=='invoice'||b.billing.allocation!=='attributed_to_selected_label'||b.billing.finality!=='final')return unknown;basis=b.billing.amountCents;basisStatement=b;}
    else basis=f.purchased.costCents;
  } else {
    if(!a.basis||a.adjustments.length)return unknown;
    const b=observation(f,a.basis)?.statement,n=b?.indemnity;
    if(!b||!n||!sourced(b)||n.event!=='decision_document'||!n.decision||!provenanceQualified(n.decision.source)||!['accepted','partially_accepted'].includes(n.decision.state))return unknown;
    basis=n.decision.approvedCents;basisStatement=b;
  }
  if(basis===null||basis<0||!Number.isSafeInteger(basis))return unknown;
  if(a.basis&&f.observations.some(o=>{const p=o.proof;if(!p||p.command.action==='record_instruction')return false;const s=p.command.statement;
    return (s.billing?.settlement||s.indemnity?.settlement)&&supportHash(s.parent)===supportHash(a.basis)&&!a.settlements.some(r=>r.id===o.id&&r.contentHash===o.contentHash);}))return unknown;
  let adjustments=0,settlements=0;const seen=new Set<string>(),documents=new Set<string>();let finalCount=0;
  if(basisStatement){documents.add(supportHash([basisStatement.source.issuer,basisStatement.source.reference]));
    const ownSource=basisStatement.indemnity?.decision?.source;if(ownSource)documents.add(supportHash([ownSource.issuer,ownSource.reference]));}
  for(const r of [...a.adjustments,...a.settlements]) {
    const p=observation(f,r),s=p?.statement;
    if(!s||!sourced(s)||seen.has(r.id)||a.basis?.id===r.id)return unknown;seen.add(r.id);
    const documentKey=supportHash([s.source.issuer,s.source.reference]);if(documents.has(documentKey))return unknown;documents.add(documentKey);
    if(a.adjustments.some(v=>v.id===r.id)) {
      const b=s.billing;if(!b||!['adjustment','credit_note'].includes(b.event)||b.finality!=='final'||b.allocation!=='attributed_to_selected_label'||b.amountCents===null)return unknown;
      adjustments+=b.amountCents;
    } else {
      const st=s.billing?.settlement??s.indemnity?.settlement;
      if(!st||!provenanceQualified(st.source)||st.amountCents===null||st.finality==='unknown'||!a.basis||supportHash(s.parent)!==supportHash(a.basis)||
        s.billing&&s.billing.allocation!=='attributed_to_selected_label')return unknown;
      const settlementKey=supportHash([st.source.issuer,st.source.reference]);
      if(settlementKey!==documentKey){if(documents.has(settlementKey))return unknown;documents.add(settlementKey);}
      if(st.finality==='final')finalCount++;settlements+=st.amountCents;
    }
    if(!Number.isSafeInteger(adjustments)||!Number.isSafeInteger(settlements))return unknown;
  }
  const remaining=basis+adjustments-settlements;
  if(!Number.isSafeInteger(remaining)||remaining<0||finalCount>1||finalCount===1&&remaining!==0)return unknown;
  return {...unknown,qualification:'coherent_documentary_amounts' as const,basisAmountCents:basis,adjustmentCents:adjustments,settlementDocumentCents:settlements,remainingDocumentaryCents:remaining};
}
function entryView(p:NonNullable<Awaited<ReturnType<typeof proof>>>,uid:string,admin:boolean) {
  const d=p.document,c=p.command;
  return {entryId:d.entryId,contentHash:p.contentHash,kind:c.action,actorRole:d.actorRole,recordedAt:d.recordedAt.toDate().toISOString(),
    partyMessage:c.action==='record_instruction'?(uid===d.parties.buyerId?c.instruction.buyerMessage:uid===d.parties.sellerId?c.instruction.sellerMessage:null):c.statement.summary,
    ...(c.action==='record_instruction'?{instruction:{action:c.instruction.action,nextFollowUpAt:c.instruction.nextFollowUpAt},monetarySummary:d.monetarySummary}:{}),
    ...(admin||d.actorId===uid?{command:c,actorId:d.actorId}:{}),historicalOnly:true,...noAuthority};
}
async function currentInstruction(tx:FirebaseFirestore.Transaction,f:Frame,uid:string,admin:boolean) {
  const ref=f.root?.latestInstruction;if(!has(f.root,'latestInstruction'))return {qualification:'unrecorded',entry:null};
  if(!/^cae_[a-f0-9]{64}$/.test(ref?.id??'')||!HASH.test(ref?.contentHash??''))return {qualification:'unknown',entry:null};
  const p=await proof(tx,f.c,ref.id,(await tx.get(caseRef(f.c).collection('instructions').doc(ref.id))).data());
  if(!p||p.command.action!=='record_instruction'||p.contentHash!==ref.contentHash)return {qualification:'unknown',entry:null};
  const s=p.command.source,current=s.semanticHash===f.reference.semanticHash&&s.observationSetHash===f.reference.observationSetHash&&s.membersHash===f.reference.membersHash&&
    f.purchased.qualification==='native_purchased_label'&&f.corpusComplete&&!f.hasMore&&f.observations.every(o=>o.proof)&&await authorityCurrent(tx,p.document);
  return {qualification:current?'native_current_instruction':'historical_sources_changed',entry:entryView(p,uid,admin)};
}
function sourceView(f:Frame,uid:string,admin:boolean){return {protocol:'transport_carrier_source_v1',context:f.c,caseId:caseId(f.c),reference:f.reference,caseVersion:f.root?.version??0,
  purchasedLabel:f.purchased,observationReferences:f.observations.map(o=>({id:o.id,contentHash:o.contentHash,qualification:o.proof?'native_recorded_statement':'unknown'})),
  evidenceReferences:f.set.evidenceRows.filter(e=>admin||e.reference?.actorId===uid).flatMap(e=>e.reference?[{id:e.id,contentHash:e.reference.contentHash}]:[]),
  coverage:{observationsInspected:f.observations.length,observationLimit:100,observationsHasMore:f.hasMore,corpusComplete:f.corpusComplete,exhaustiveHistoryVerified:false},
  documentaryContext:{caseId:f.set.source.caseId,sourceHash:f.set.source.sourceHash,materialCapability:'product_review_material_v1',parcelCapability:'product_review_parcel_v1'},
  canRecordStatementNow:TRANSPORT_CARRIER_ENABLED&&[f.order.buyerId,f.order.sellerId].includes(uid)&&f.purchased.qualification==='native_purchased_label'&&f.corpusComplete&&!f.hasMore&&f.observations.length<100&&f.observations.every(o=>o.proof),
  canRecordOperatorObservationNow:TRANSPORT_CARRIER_ENABLED&&admin&&f.purchased.qualification==='native_purchased_label'&&f.corpusComplete&&!f.hasMore&&f.observations.length<100&&f.observations.every(o=>o.proof),
  canPrepareInstructionNow:TRANSPORT_CARRIER_ENABLED&&admin&&f.purchased.qualification==='native_purchased_label'&&f.corpusComplete&&!f.hasMore&&f.observations.every(o=>o.proof),
  carrierDeadlineAndHumanFollowUpAreDistinct:true,...noAuthority};}
function newOpen(){if(!TRANSPORT_CARRIER_ENABLED)throw new HttpsError('failed-precondition','Le dossier coût/indemnité est en préparation.',{reason:'transport_carrier_review_not_exposed'});}
async function ownOrder(tx:FirebaseFirestore.Transaction,c:Context,uid:string){const order=(await tx.get(db.collection('transactions').doc(c.transactionId))).data();if(!order||![order.buyerId,order.sellerId].includes(uid))throw new HttpsError('permission-denied','Commande privée non autorisée.');return order;}
export async function readTransportCarrierSource(request:any) {
  const uid=supportUid(request),raw=supportObject(request.data,['mode','capability','expectedUid','context','scope']);selected(raw);const c=context(raw.context),scope=choice(raw.scope,['own','admin'] as const);
  return db.runTransaction(async tx=>{if(scope==='admin')await operator(tx,request,uid);else await ownOrder(tx,c,uid);const f=await frame(tx,c);
    return {protocol:'transport_carrier_source_observation_v1',actorId:uid,scope,source:sourceView(f,uid,scope==='admin'),currentInstruction:await currentInstruction(tx,f,uid,scope==='admin'),...noAuthority};});
}
export async function previewTransportCarrier(request:any) {
  const uid=supportUid(request),raw=supportObject(request.data,['mode','capability','expectedUid','command']);selected(raw);const command=commandInput(raw.command);
  if(command.action!=='record_instruction')throw new HttpsError('invalid-argument','Aperçu réservé à l’instruction opérateur.');newOpen();
  return db.runTransaction(async tx=>{await operator(tx,request,uid);const f=await frame(tx,command.context);if(supportHash(f.reference)!==supportHash(command.source))throw new HttpsError('failed-precondition','Source modifiée.');
    const normalized=previewCommand(command),intentHash=supportHash(normalized),previewId='carrier_preview_'+supportHash([uid,normalized]),ref=caseRef(command.context).collection('previews').doc(previewId),old=(await tx.get(ref)).data();
    if(old&&(old.protocol!=='transport_carrier_preview_v1'||old.actorId!==uid||old.intentHash!==intentHash))throw new HttpsError('failed-precondition','Aperçu historique à rapprocher.');
    if(!old)tx.create(ref,{protocol:'transport_carrier_preview_v1',actorId:uid,intentHash,source:command.source,recordedAt:Timestamp.now()});
    return {protocol:'transport_carrier_preview_v1',actorId:uid,previewId,intentHash,source:sourceView(f,uid,true),monetarySummary:monetarySummary(f,command.instruction),...noAuthority};});
}
const reasons=['requester_neutralized','transport_carrier_review_not_exposed','source_changed','incomplete_carrier_sources','preview_unqualified','carrier_capacity_requires_review','document_capacity_requires_review'];
function receiptView(uid:string,rid:string,command:Command,r?:any){return {protocol:'transport_carrier_command_v1',actorId:uid,requestId:rid,command,payloadHash:supportHash(command),state:r?.state??'unrecorded',reason:r?.reason??null,
  entryId:r?.entryId??null,caseId:caseId(command.context),recordedAt:native(r?.recordedAt)?r.recordedAt.toDate().toISOString():null,currentInstructionVerified:false,...noAuthority};}
export async function commandTransportCarrier(request:any) {
  const uid=supportUid(request),raw=supportObject(request.data,['mode','capability','expectedUid','requestId','operation','command']);selected(raw);
  const rid=supportRequestId(raw.requestId),command=commandInput(raw.command),payloadHash=supportHash(command),id=eid(uid,rid),ref=receiptRef(command.context,uid,rid);
  const operation=choice(raw.operation,['execute','observe','neutralize'] as const);
  if(operation==='execute'&&!(await ref.get()).exists)await checkRateLimit(uid,true,{functionName:'transportCarrierReview',maxCallsAuthenticated:10,maxCallsUnauthenticated:0,windowMs:60000});
  return db.runTransaction(async tx=>{
    const prior=(await tx.get(ref)).data();
    if(prior){if(prior.protocol!=='transport_carrier_command_v1'||prior.actorId!==uid||prior.requestId!==rid||prior.payloadHash!==payloadHash||supportHash(prior.command)!==payloadHash||!native(prior.recordedAt))throw new HttpsError('already-exists','Autre intention ou reçu inconnu.');
      if(prior.state==='committed'){const p=await proof(tx,command.context,id,(await tx.get(caseRef(command.context).collection(command.action==='record_instruction'?'instructions':'observations').doc(id))).data());if(!p||prior.entryId!==id||p.document.payloadHash!==payloadHash)throw new HttpsError('unavailable','Reçu historique à rapprocher.');}
      else if(prior.state!=='not_executed'||prior.entryId!==null||!reasons.includes(prior.reason))throw new HttpsError('failed-precondition','Non-exécution à rapprocher.');
      return receiptView(uid,rid,command,prior);}
    if(operation==='observe')return receiptView(uid,rid,command);
    const now=Timestamp.now(),reject=(reason:string)=>{const r={protocol:'transport_carrier_command_v1',actorId:uid,requestId:rid,command,payloadHash,state:'not_executed',reason,entryId:null,recordedAt:now};tx.create(ref,r);return receiptView(uid,rid,command,r);};
    if(operation==='neutralize')return reject('requester_neutralized');
    if(!TRANSPORT_CARRIER_ENABLED)return reject('transport_carrier_review_not_exposed');
    const admin=command.action!=='record_statement',authority=admin?await operator(tx,request,uid):null;
    if(!admin)await ownOrder(tx,command.context,uid);
    let f:Frame;try{f=await frame(tx,command.context);}catch(e){if(e instanceof HttpsError&&['failed-precondition','invalid-argument','not-found'].includes(e.code))return reject('incomplete_carrier_sources');throw e;}
    if(supportHash(f.reference)!==supportHash(command.source))return reject('source_changed');
    if(f.root?.version>=Number.MAX_SAFE_INTEGER-1||f.hasMore||command.action!=='record_instruction'&&f.observations.length>=100)return reject('carrier_capacity_requires_review');
    if(f.purchased.qualification!=='native_purchased_label'||!f.corpusComplete||f.observations.some(o=>!o.proof))return reject('incomplete_carrier_sources');
    if(command.action==='record_instruction') {
      const i=command.instruction,preview=command.previewId?(await tx.get(caseRef(command.context).collection('previews').doc(command.previewId))).data():null;
      if(!preview||preview.protocol!=='transport_carrier_preview_v1'||preview.actorId!==uid||preview.intentHash!==supportHash(previewCommand(command))||!native(preview.recordedAt))return reject('preview_unqualified');
      if(supportHash(i.examinedObservationReferences)!==supportHash(f.observations.map(o=>({id:o.id,contentHash:o.contentHash})))||
        supportHash(i.evidenceReferences)!==supportHash(f.set.evidenceRows.map(e=>({id:e.id,contentHash:e.reference?.contentHash??null}))))return reject('incomplete_carrier_sources');
      if(i.amountReview&&[...(i.amountReview.basis?[i.amountReview.basis]:[]),...i.amountReview.adjustments,...i.amountReview.settlements].some(r=>!observation(f,r)))return reject('incomplete_carrier_sources');
      if(i.action==='record_settlement_document'&&(!i.amountReview||!i.amountReview.settlements.length||i.amountReview.settlements.some(r=>{const s=observation(f,r)?.statement;return !s?.billing?.settlement&&!s?.indemnity?.settlement;})))return reject('incomplete_carrier_sources');
    } else {
      const s=command.statement,allSources=[s.source,s.billing?.settlement?.source,s.indemnity?.coverage.source,s.indemnity?.decision?.source,s.indemnity?.recourse?.deadlineSource,s.indemnity?.settlement?.source];
      if(!admin&&allSources.some(p=>p?.kind==='operator_carrier_contact'))throw new HttpsError('permission-denied','Une observation opérateur exige son auteur natif.');
      if(s.evidenceReferences.some(r=>!f.set.evidenceRows.some(e=>e.reference?.id===r.id&&e.reference.contentHash===r.contentHash&&(admin||e.reference.actorId===uid))))throw new HttpsError('permission-denied','Pièce propre native requise.');
      if(s.parent&&!observation(f,s.parent))return reject('incomplete_carrier_sources');
      if(s.indemnity?.recourse){const r=s.indemnity.recourse,p=r.rejection?observation(f,r.rejection):null;
        if(!p||!['rejected','partially_accepted'].includes(p.statement.indemnity?.decision?.state??'')||supportHash(s.parent)!==supportHash(r.rejection))return reject('incomplete_carrier_sources');}
    }
    const target=caseRef(command.context).collection(command.action==='record_instruction'?'instructions':'observations').doc(id),entry=await tx.get(target),captureRef=caseRef(command.context).collection('source_captures').doc(command.source.sourceHash),capture=await tx.get(captureRef);
    if(entry.exists||capture.exists&&(capture.data()?.sourceHash!==command.source.sourceHash||supportSourceHash(capture.data()?.document)!==command.source.sourceHash))return reject('incomplete_carrier_sources');
    const role=uid===f.order.buyerId?'buyer':uid===f.order.sellerId?'seller':null;
    const document={protocol:'transport_carrier_entry_v1',entryId:id,caseId:caseId(command.context),actorId:uid,actorRole:admin?'operator':role,
      parties:f.document.parties,requestId:rid,payloadHash,command,authority,recordedAt:now,...(command.action==='record_instruction'?{monetarySummary:monetarySummary(f,command.instruction)}:{}),...noAuthority};
    if(Buffer.byteLength(JSON.stringify({document,source:f.document}),'utf8')>800000)return reject('document_capacity_requires_review');
    const contentHash=supportSourceHash(document),notices=await prepareOperationalNotices(tx,noticeInputs(command.context,id,f.order.buyerId,f.order.sellerId));
    if(!capture.exists)tx.create(captureRef,{protocol:'transport_carrier_source_capture_v1',sourceHash:command.source.sourceHash,document:f.document,recordedAt:now});
    tx.create(target,{protocol:document.protocol,document,contentHash});
    const patch={version:(f.root?.version??0)+1,updatedAt:now,...(command.action==='record_instruction'?{latestInstruction:{id,contentHash}}:{latestObservation:{id,contentHash}})};
    if(f.root)tx.update(caseRef(command.context),patch);else tx.create(caseRef(command.context),{protocol:'transport_carrier_case_v1',caseId:caseId(command.context),context:command.context,buyerId:f.order.buyerId,sellerId:f.order.sellerId,createdAt:now,...patch});
    const receipt={protocol:'transport_carrier_command_v1',actorId:uid,requestId:rid,command,payloadHash,state:'committed',reason:null,entryId:id,recordedAt:now,notificationIds:notices.notificationIds};tx.create(ref,receipt);notices.commit();return receiptView(uid,rid,command,receipt);
  });
}
export async function readTransportCarrierHistory(request:any) {
  const uid=supportUid(request),raw=supportObject(request.data,['mode','capability','expectedUid','context','scope','stream','cursor']);selected(raw);const c=context(raw.context),scope=choice(raw.scope,['own','admin'] as const),stream=choice(raw.stream,['observations','instructions'] as const);
  const cursor=raw.cursor==null?null:supportObject(raw.cursor,['lastId']).lastId;if(cursor!==null&&!docId(cursor))throw new HttpsError('invalid-argument','Curseur invalide.');
  return db.runTransaction(async tx=>{if(scope==='admin')await operator(tx,request,uid);else await ownOrder(tx,c,uid);
    let q:FirebaseFirestore.Query=caseRef(c).collection(stream).orderBy('__name__').limit(21);if(cursor)q=q.startAfter(cursor);const page=await tx.get(q),inspected=page.docs.slice(0,20),entries=[];
    for(const row of inspected){const p=await proof(tx,c,row.id,row.data());entries.push(p?{qualification:'native_recorded_entry',entry:entryView(p,uid,scope==='admin')}:{qualification:'unknown',entryId:row.id,entry:null});}
    return {protocol:'transport_carrier_history_page_v1',actorId:uid,scope,caseId:caseId(c),stream,entries,nextCursor:page.size>20?{lastId:inspected.at(-1)!.id}:null,
      coverage:{inspected:inspected.length,limit:20,hasMore:page.size>20,exhaustiveHistoryVerified:false},currentInstructionVerified:false,...noAuthority};});
}
