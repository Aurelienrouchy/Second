/** Native documentary reports only. No consumer may use an instruction here
 * to settle money, a reserve, a debt or another commercial/bank obligation. */
import {Timestamp} from 'firebase-admin/firestore';
import {randomUUID} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {supportUid,supportId,supportObject,supportRequestId,supportHash,supportSourceHash,supportText,supportAdmin} from './supportRequest';
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
import {assertRecentAccountAuthentication,assertAccountSecurityOpen} from './eligibility';
import {checkRateLimit} from './rateLimit';
import {bankCaseRef,bankId,bankNative} from './bankDisputeCaseSource';
import {readBankFinancialNativeSource} from './bankFinancialReconciliationSource';
import {observeBankFinancialGraph} from './bankFinancialReconciliationProvider';
export const BANK_FINANCIAL_RECONCILIATION_CAPABILITY='bank_financial_reconciliation_v1';
export const BANK_FINANCIAL_RECONCILIATION_ENABLED:boolean=true;
const effects={financialExecutionAllowed:false,netFinancialResolutionQualified:false,financingAuthorized:false,holdReleaseAuthorized:false,
  sellerDebitAuthorized:false,buyerCreditAuthorized:false,bankArrivalVerified:false} as const;
const hash=(v:any):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
type Reference={id:string;contentHash:string};
export type BankFinancialReconciliationCommand={action:'capture_report'|'record_instruction';sourceHash:string;reportReference:Reference|null;
  instruction:'missing_evidence'|'reconciliation_documented'|'financial_review_preparation'|null;note:string;acknowledged:true};
const entries=(du:string)=>bankCaseRef(du).collection('financial_reconciliations');
const operation=(du:string,uid:string,rid:string)=>bankCaseRef(du).collection('financial_reconciliation_commands').doc(supportHash([uid,rid]));
const receipt=(du:string,uid:string,rid:string)=>operation(du,uid,rid).collection('results').doc('receipt');
const entryId=(uid:string,rid:string)=>'fr_'+supportHash([uid,rid]);
function reference(v:any):Reference{const r=supportObject(v,['id','contentHash']);if(!/^fr_[a-f0-9]{64}$/.test(r.id??'')||!hash(r.contentHash))throw new HttpsError('invalid-argument','Référence documentaire exacte requise.');return {id:r.id,contentHash:r.contentHash};}
function command(v:any):BankFinancialReconciliationCommand{
  const c=supportObject(v,['action','sourceHash','reportReference','instruction','note','acknowledged']);
  if(!['capture_report','record_instruction'].includes(c.action)||!hash(c.sourceHash)||c.acknowledged!==true||
    c.action==='capture_report'&&(c.reportReference!==null||c.instruction!==null)||c.action==='record_instruction'&&
    (c.reportReference===null||!['missing_evidence','reconciliation_documented','financial_review_preparation'].includes(c.instruction)))throw new HttpsError('invalid-argument','Rapport et instruction documentaire distincts requis.');
  return {action:c.action,sourceHash:c.sourceHash,reportReference:c.reportReference===null?null:reference(c.reportReference),instruction:c.instruction,
    note:supportText(c.note,'Motivation privée',2000),acknowledged:true};
}
async function authority(tx:FirebaseFirestore.Transaction,request:any){
  await assertPrivateAccountSession(request,tx);if(request.auth.token.auth_time*1000>Date.now())throw new HttpsError('permission-denied','Session actuelle requise.');
  await supportAdmin(tx,request.auth.uid,false);assertRecentAccountAuthentication(request.auth.token);
  await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(request.auth.uid))).data(), tx, request.auth.uid);
}
function view(uid:string,tid:string,du:string,rid:string,c:BankFinancialReconciliationCommand,r?:any){return {protocol:'bank_financial_reconciliation_command_v1',
  actorId:uid,transactionId:tid,disputeId:du,requestId:rid,command:c,payloadHash:supportHash(c),state:r?.state??'unrecorded',reason:r?.reason??null,
  reference:r?.reference??null,recordedAt:bankNative(r?.recordedAt)?r.recordedAt.toDate().toISOString():null,
  result:r?.state==='received'?{kind:c.action==='capture_report'?'report':'instruction',documentaryOnly:true,...effects}:null,...effects};}
async function proof(tx:FirebaseFirestore.Transaction,tid:string,du:string,r:Reference){
  const raw=(await tx.get(entries(du).doc(r.id))).data(),d=raw?.document;
  if(!d||raw.contentHash!==r.contentHash||supportSourceHash(d)!==r.contentHash||d.protocol!=='bank_financial_reconciliation_entry_v1'||
    d.transactionId!==tid||d.disputeId!==du||d.id!==entryId(d.actorId,d.requestId)||!bankNative(d.recordedAt))return null;
  const own=(await tx.get(receipt(du,d.actorId,d.requestId))).data();
  if(own?.state!=='received'||own.actorId!==d.actorId||own.transactionId!==tid||own.disputeId!==du||own.requestId!==d.requestId||
    own.payloadHash!==supportHash(d.command)||supportHash(own.reference)!==supportHash(r)||!bankNative(own.recordedAt)||!own.recordedAt.isEqual(d.recordedAt))return null;
  return d;
}
const entryView=(d:any)=>({...d,recordedAt:d.recordedAt.toDate().toISOString()});
async function own(tx:FirebaseFirestore.Transaction,uid:string,tid:string,du:string,rid:string,c:BankFinancialReconciliationCommand){
  const r=(await tx.get(receipt(du,uid,rid))).data(),op=(await tx.get(operation(du,uid,rid))).data();
  for(const v of [r,op])if(v&&(v.actorId!==uid||v.transactionId!==tid||v.disputeId!==du||v.requestId!==rid||v.payloadHash!==supportHash(c)||supportHash(v.command)!==supportHash(c)))
    throw new HttpsError('already-exists','Cette référence appartient à une autre intention.');
  if(r?.state==='received'&&!await proof(tx,tid,du,reference(r.reference)))throw new HttpsError('unavailable','Reçu documentaire à rapprocher.');
  return {r,op};
}
function refuse(tx:FirebaseFirestore.Transaction,uid:string,tid:string,du:string,rid:string,c:BankFinancialReconciliationCommand,reason:string){
  const r={protocol:'bank_financial_reconciliation_command_v1',actorId:uid,transactionId:tid,disputeId:du,requestId:rid,command:c,payloadHash:supportHash(c),
    state:'not_executed',reason,reference:null,recordedAt:Timestamp.now()};tx.create(receipt(du,uid,rid),r);return r;
}
async function commitEntry(tx:FirebaseFirestore.Transaction,uid:string,tid:string,du:string,rid:string,c:BankFinancialReconciliationCommand,body:any){
  const d={protocol:'bank_financial_reconciliation_entry_v1',id:entryId(uid,rid),actorId:uid,transactionId:tid,disputeId:du,requestId:rid,command:c,
    ...body,recordedAt:Timestamp.now(),...effects};
  if(Buffer.byteLength(JSON.stringify(d),'utf8')>650000)return refuse(tx,uid,tid,du,rid,c,'documentary_report_size_unknown');
  let contentHash:string;try{contentHash=supportSourceHash(d);}catch{return refuse(tx,uid,tid,du,rid,c,'documentary_report_size_unknown');}
  const ref={id:d.id,contentHash},r={protocol:'bank_financial_reconciliation_command_v1',actorId:uid,transactionId:tid,disputeId:du,
    requestId:rid,command:c,payloadHash:supportHash(c),state:'received',reason:null,reference:ref,recordedAt:d.recordedAt};
  const alertRef=db.collection('admin_alerts').doc('bank_financial_'+d.id),alert=await tx.get(alertRef);
  tx.create(entries(du).doc(d.id),{document:d,contentHash:ref.contentHash});tx.create(receipt(du,uid,rid),r);
  if(!alert.exists)tx.create(alertRef,{kind:'bank_financial_reconciliation',refId:du,transactionId:tid,entryId:d.id,entryHash:ref.contentHash,
    severity:'info',status:'open',createdAt:d.recordedAt,message:'Rapport ou instruction documentaire bancaire à examiner. Aucun règlement financier autorisé.'});
  return r;
}
async function handleBankFinancialReconciliationWithSession(request:any){
  const uid=supportUid(request),raw=supportObject(request.data,['capability','expectedUid','mode','transactionId','disputeId','expectedSource','reportReference','cursor','requestId','command']);
  if(raw.capability!==BANK_FINANCIAL_RECONCILIATION_CAPABILITY||!['preview','history','execute','observe','neutralize'].includes(raw.mode))throw new HttpsError('invalid-argument','Version et mode de rapprochement requis.');
  const tid=supportId(raw.transactionId),du=raw.disputeId;if(!bankId(du,'du'))throw new HttpsError('invalid-argument','Dossier bancaire natif requis.');
  if(['preview','history'].includes(raw.mode))return db.runTransaction(async tx=>{
    await authority(tx,request);if(!BANK_FINANCIAL_RECONCILIATION_ENABLED)throw new HttpsError('failed-precondition','Rapprochement en préparation.',{reason:'bank_financial_reconciliation_not_exposed'});
    const source=await readBankFinancialNativeSource(tx,tid,du);if(!source.capture.parties)throw new HttpsError('permission-denied','Dossier privé indisponible.');
    const expected=raw.expectedSource==null?null:supportObject(raw.expectedSource,['sourceHash']);
    if(expected&&expected.sourceHash!==source.sourceHash)throw new HttpsError('failed-precondition','La source native a changé.',{reason:'bank_reconciliation_source_changed'});
    let lastId:string|null=null;if(raw.cursor!=null){const c=supportObject(raw.cursor,['lastId']);if(typeof c.lastId!=='string'||!c.lastId||c.lastId.includes('/')||Buffer.byteLength(c.lastId)>1500||
      ['.','..'].includes(c.lastId)||/^__.*__$/.test(c.lastId)||!expected)throw new HttpsError('invalid-argument','Curseur et source de page exacts requis.');lastId=c.lastId;}
    const selected=raw.reportReference==null?null:await proof(tx,tid,du,reference(raw.reportReference));
    if(raw.reportReference!=null&&!selected)throw new HttpsError('failed-precondition','Référence documentaire inconnue.');
    const rows:any[]=[];let nextCursor:any=null,coverage:any=null;
    if(raw.mode==='history'){
      let q:FirebaseFirestore.Query=entries(du).orderBy('__name__').limit(21);if(lastId)q=q.startAfter(lastId);
      const page=await tx.get(q);for(const row of page.docs.slice(0,20)){const v=row.data(),d=hash(v.contentHash)?await proof(tx,tid,du,{id:row.id,contentHash:v.contentHash}):null;
        rows.push(d?{qualification:'native_documentary_entry',reference:{id:row.id,contentHash:v.contentHash},entry:entryView(d)}:{qualification:'unknown',entryId:row.id,entry:null});}
      nextCursor=page.size>20?{lastId:page.docs[19].id}:null;coverage={inspected:Math.min(page.size,20),limit:20,hasMore:page.size>20,exhaustiveHistoricalReportsVerified:false};
    }
    await authority(tx,request);
    return {protocol:'bank_financial_reconciliation_preview_v1',actorId:uid,transactionId:tid,disputeId:du,
      source:{sourceHash:source.sourceHash,qualification:source.qualified?'native_current':'unknown',capture:source.capture},localEvidence:source.localEvidence,
      selectedEntry:selected?entryView(selected):null,rows,nextCursor,coverage,readAt:Timestamp.now().toDate().toISOString(),...effects};
  });
  const c=command(raw.command),rid=supportRequestId(raw.requestId),opRef=operation(du,uid,rid),token=randomUUID();
  const first=await db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    const found=await own(tx,uid,tid,du,rid,c);if(found.r)return {r:found.r};
    if(raw.mode==='neutralize')return {r:refuse(tx,uid,tid,du,rid,c,'requester_neutralized')};
    if(found.op){
      if(found.op.command.action!=='capture_report'||!found.op.nativeSource?.identity||!Number.isSafeInteger(found.op.attempts)||found.op.attempts>=3||
        found.op.readLease?.until instanceof Timestamp&&found.op.readLease.until.toMillis()>Date.now())return {pending:true};
      await authority(tx,request);
      tx.update(opRef,{attempts:found.op.attempts+1,readLease:{token,until:Timestamp.fromMillis(Date.now()+45000)}});return {op:found.op};
    }
    if(raw.mode==='observe')return {};
    if(!BANK_FINANCIAL_RECONCILIATION_ENABLED)return {r:refuse(tx,uid,tid,du,rid,c,'bank_financial_reconciliation_not_exposed')};
    await authority(tx,request);const source=await readBankFinancialNativeSource(tx,tid,du);
    if(c.sourceHash!==source.sourceHash)return {r:refuse(tx,uid,tid,du,rid,c,'bank_reconciliation_source_changed')};
    if(!source.qualified)return {r:refuse(tx,uid,tid,du,rid,c,'bank_reconciliation_native_identity_unknown')};
    if(c.action==='record_instruction'){
      const report=await proof(tx,tid,du,c.reportReference!);
      if(!report||report.kind!=='report'||report.nativeSourceHash!==source.sourceHash||report.nativeSourceMatchesAtCommit!==true)
        return {r:refuse(tx,uid,tid,du,rid,c,'bank_reconciliation_report_not_current')};
      if(c.instruction==='reconciliation_documented'&&(report.report.qualification!=='complete_referenced_manifest'||!source.capture.localCoverageQualified))
        return {r:refuse(tx,uid,tid,du,rid,c,'bank_reconciliation_report_incomplete')};
      return {r:await commitEntry(tx,uid,tid,du,rid,c,{kind:'instruction',nativeSourceHash:source.sourceHash,nativeSource:source.capture,
        reportReference:c.reportReference,reportCorpusHash:supportSourceHash({reportHash:c.reportReference!.contentHash,nativeSourceHash:source.sourceHash}),
        instruction:c.instruction,motivation:c.note,documentaryOnly:true})};
    }
    const op={protocol:'bank_financial_reconciliation_operation_v1',actorId:uid,transactionId:tid,disputeId:du,requestId:rid,command:c,payloadHash:supportHash(c),
      nativeSource:{sourceHash:source.sourceHash,capture:source.capture,localEvidence:source.localEvidence,identity:source.identity},attempts:1,
      readLease:{token,until:Timestamp.fromMillis(Date.now()+45000)},recordedAt:Timestamp.now()};
    if(Buffer.byteLength(JSON.stringify(op),'utf8')>650000)return {r:refuse(tx,uid,tid,du,rid,c,'documentary_source_size_unknown')};
    tx.create(opRef,op);return {op};
  });
  if(first.r)return view(uid,tid,du,rid,c,first.r);
  if(!first.op)return view(uid,tid,du,rid,c,first.pending?{state:'unknown'}:undefined);
  // This is the only external IO path. The immutable native intent already
  // exists, and every call (including recovery) is GET-only and bounded.
  await checkRateLimit(uid,true,{functionName:'bankFinancialReconciliationRead',maxCallsAuthenticated:5,maxCallsUnauthenticated:0,windowMs:60000});
  await db.runTransaction(tx=>authority(tx,request));
  let graph=await observeBankFinancialGraph(first.op.nativeSource.identity);
  // Native local origins must name a GET-qualified refund of this same graph.
  // Matching amounts alone never associate two external/local settlements.
  const local=first.op.nativeSource.localEvidence,bindings:any[]=[];
  if(local.currentRefund?.cardCents>0)bindings.push({id:local.currentRefund.providerRefundId,amount:local.currentRefund.cardCents});
  for(const a of local.allocations)if(a.terms?.cardCents>0)bindings.push({id:a.providerRefundId,amount:a.terms.cardCents});
  for(const r of local.repairs)if(r.providerRefundId!==null||r.state!=='not_executed')bindings.push({id:r.providerRefundId,amount:r.amountCents});
  if(bindings.some(b=>!bankId(b.id,'re')||!Number.isSafeInteger(b.amount)||!graph.refunds.some(r=>r.associationQualified===true&&r.id===b.id&&r.amountCents===b.amount)))
    graph={...graph,qualification:'unknown',reasons:[...graph.reasons,'local_provider_association_unknown']};
  const result=await db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    const found=await own(tx,uid,tid,du,rid,c);if(found.r)return found.r;
    if(!found.op||found.op.readLease?.token!==token)return null;
    await authority(tx,request);
    const current=await readBankFinancialNativeSource(tx,tid,du),same=current.sourceHash===found.op.nativeSource.sourceHash;
    await authority(tx,request);
    const recorded=await commitEntry(tx,uid,tid,du,rid,c,{kind:'report',nativeSourceHash:found.op.nativeSource.sourceHash,nativeSource:found.op.nativeSource.capture,
      nativeSourceMatchesAtCommit:same,currentNativeSourceHash:current.sourceHash,localEvidence:found.op.nativeSource.localEvidence,
      report:{...graph,...(!same?{qualification:'unknown',reasons:[...graph.reasons,'native_manifest_changed_before_commit']}:{}),
        netFinancialResolutionQualified:false,financialEffectAuthorized:false}});
    tx.update(opRef,{readLease:null});return recorded;
  });
  return view(uid,tid,du,rid,c,result??{state:'unknown'});
}
export async function handleBankFinancialReconciliation(request:any){
  // Own receipts remain available to a current owner session after loss of the
  // administrative role. New private bodies and provider reads need authority.
  return withPrivateAccountSession(request,()=>handleBankFinancialReconciliationWithSession(request));
}
export type BankFinancialReconciliationResponse=Awaited<ReturnType<typeof handleBankFinancialReconciliation>>;
