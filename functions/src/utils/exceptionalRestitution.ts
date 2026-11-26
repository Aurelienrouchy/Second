/** Exceptional MANUAL restitution, shared by native withdrawal/wallet/refund
 * adapters. The original payment/identity is never reassigned or replayed. */
import {Timestamp} from 'firebase-admin/firestore';
import {createHash} from 'node:crypto';
import {HttpsError} from 'firebase-functions/v2/https';
import {db,storage,FieldValue} from '../config/firebase';
import {supportUid,supportObject,supportHash,supportSourceHash,supportAccountUid,isSupportAccountUid,supportRequestId,supportCurrentAdminSession,supportAdmin} from './supportRequest';
import {assertAccountSecurityOpen,assertRecentAccountAuthentication} from './eligibility';
import {financialRecoverySourceFields,financialRecoveryWalletFields,financialRecoveryCommitCheckpoint} from './financialRecoverySources';
import {FinancialRecoveryBlocked} from './financialRecoveryInterlock';
import {readFinancialRecoveryControl,readFinancialRecoveryPinnedObject,readFinancialRecoveryIdentityClaim,createRecoveryEvidence,recoveryInstallation} from '../config/recoveryControl';
import {prepareOperationalNotices} from './notifications';
import {readPrivateSupportCaseJpeg} from './privateSupportCaseEvidence';
import {parseExceptionalContext,exceptionalCaseId,exceptionalCaseRef,readExceptionalSource,observeExceptionalProvider,exceptionalNative as native,
 exceptionalCents as cents,exceptionalDebtCredit,exceptionalWalletConsumptionSlot,type ExceptionalContext} from './exceptionalRestitutionSources';

type Data=FirebaseFirestore.DocumentData;
export const EXCEPTIONAL_RESTITUTION_CAPABILITY='exceptional_financial_restitution_v1';
const effects={bankArrivalVerified:false,stripeSettlementGranted:false,accountAccessGranted:false} as const;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const instruction=(v:unknown):v is string=>typeof v==='string'&&/^er_[a-f0-9]{64}$/.test(v);
const proofId=(v:unknown):v is string=>typeof v==='string'&&/^xe_[a-f0-9]{64}$/.test(v);
const actions=['prepare','attest','void_never_executed'],purposes=['identity_destination','harm_or_authority','execution'];
const commandRef=(c:ExceptionalContext,uid:string,rid:string)=>exceptionalCaseRef(c).collection('exceptional_commands').doc('er_'+supportHash([uid,rid]));
const evidenceRef=(c:ExceptionalContext,uid:string,rid:string)=>exceptionalCaseRef(c).collection('exceptional_evidence').doc('xe_'+supportHash([uid,rid]));
const byEvidence=(c:ExceptionalContext,key:string)=>exceptionalCaseRef(c).collection('exceptional_evidence').doc(key);
const previewRef=(c:ExceptionalContext,key:string)=>exceptionalCaseRef(c).collection('exceptional_previews').doc(key);
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function operator(tx:FirebaseFirestore.Transaction,r:any){
 await supportCurrentAdminSession(r);assertRecentAccountAuthentication(r.auth.token);await supportAdmin(tx,r.auth.uid,false);
 const user=(await tx.get(db.collection('users').doc(r.auth.uid))).data();if(user?.isAdmin!==true)throw new HttpsError('permission-denied','Rôle privé actuel requis.');
 await assertAccountSecurityOpen((await tx.get(db.collection('eligibility_profiles').doc(r.auth.uid))).data(),tx,r.auth.uid);
}
function reference(v:any):Data|null{if(v===null)return null;const d=supportObject(v,['evidenceId','generation','sha256','contentHash']);
 if(!proofId(d.evidenceId)||typeof d.generation!=='string'||!/^\d{1,30}$/.test(d.generation)||!hash(d.sha256)||!hash(d.contentHash))throw new HttpsError('invalid-argument','Référence native de preuve requise.');return d;}
function parseCommand(v:any):Data&{context:ExceptionalContext}{
 const d=supportObject(v,['context','action','previewId','sourceHash','sourceRevision','instructionId','amountCents','currency','beneficiaryId','identityEvidence','authorityEvidence','executionEvidence','attestation','note','partyMessage','acknowledged']);
 const context=parseExceptionalContext(d.context),credit=exceptionalDebtCredit(context);
 const a=supportObject(d.attestation,['version','nativeBeneficiaryAndDestinationVerified','harmOrLegalAuthorityVerified','transferExecutedAndReceiptVerified','neverExecuted',...credit?['nativeCompensationCreditVerified']:[]]);
 if(!actions.includes(d.action)||!hash(d.previewId)||!hash(d.sourceHash)||!hash(d.sourceRevision)||!cents(d.amountCents)||d.amountCents<1||d.currency!=='CAD'||
  !(d.instructionId===null||instruction(d.instructionId))||d.acknowledged!==true||a.version!=='exceptional_restitution_human_v1'||a.nativeBeneficiaryAndDestinationVerified!==true||a.harmOrLegalAuthorityVerified!==true||
  a.transferExecutedAndReceiptVerified!==(!credit&&d.action==='attest')||credit&&a.nativeCompensationCreditVerified!==true||a.neverExecuted!==(d.action==='void_never_executed')||typeof d.note!=='string'||!d.note.trim()||d.note.length>2000||
  typeof d.partyMessage!=='string'||!d.partyMessage.trim()||d.partyMessage.length>2000)throw new HttpsError('invalid-argument','Attestation humaine motivée et tuple natif requis.');
 const identityEvidence=reference(d.identityEvidence),authorityEvidence=reference(d.authorityEvidence),executionEvidence=reference(d.executionEvidence);
 if(!identityEvidence||!authorityEvidence||(d.action==='prepare')!==(d.instructionId===null)||(!credit&&d.action==='attest')!==(executionEvidence!==null))throw new HttpsError('invalid-argument','Pièces et phase incompatibles.');
 return {...d,context,beneficiaryId:supportAccountUid(d.beneficiaryId),identityEvidence,authorityEvidence,executionEvidence,attestation:a,note:d.note.trim(),partyMessage:d.partyMessage.trim()};
}
function creditView(value:any){return value&&cents(value.debtOffsetCents)&&cents(value.balanceCreditCents)&&native(value.recordedAt)?
 {debtOffsetCents:value.debtOffsetCents,balanceCreditCents:value.balanceCreditCents,recordedAt:value.recordedAt.toDate().toISOString()}:null;}
function commandReceipt(c:ExceptionalContext,uid:string,rid:string,inputHash:string,r?:Data){return {protocol:'exceptional_restitution_command_v1',actorId:uid,requestId:rid,
 caseId:exceptionalCaseId(c),inputHash,state:r?.state??'unrecorded',reason:r?.reason??null,instructionId:r?.instructionId??null,outcome:r?.outcome??null,
 recordedAt:native(r?.recordedAt)?r!.recordedAt.toDate().toISOString():null,...exceptionalDebtCredit(c)?{nativeWalletCredit:creditView(r?.nativeWalletCredit)}:{},...effects};}
function evidenceReference(r:Data){return {evidenceId:r.evidenceId,generation:r.storageProof.generation,sha256:r.file.sha256,contentHash:r.contentHash};}
function proofContent(r:Data){return Object.fromEntries(['protocol','context','caseId','actorId','requestId','inputHash','evidenceId','purpose','instructionId','sourceHash','sourceRevision',
 'beneficiaryId','amountCents','file','privatePath','storageProof','execution'].map(k=>[k,r[k]??null]));}
function qualifiedProof(r:Data|undefined,c:ExceptionalContext,purpose:string,ref:Data|null){return !!r&&r.protocol==='exceptional_restitution_evidence_record_v1'&&r.caseId===exceptionalCaseId(c)&&
 supportHash(r.context)===supportHash(c)&&r.purpose===purpose&&r.state==='stored'&&native(r.recordedAt)&&proofId(r.evidenceId)&&r.evidenceId==='xe_'+supportHash([r.actorId,r.requestId])&&
 isSupportAccountUid(r.actorId)&&isSupportAccountUid(r.beneficiaryId)&&hash(r.inputHash)&&hash(r.sourceHash)&&hash(r.sourceRevision)&&cents(r.amountCents)&&r.amountCents>0&&
 r.privatePath===`exceptional_restitution_evidence/${r.caseId}/${r.evidenceId}.jpg`&&native(r.reservedAt)&&r.reservedAt.toMillis()<=r.recordedAt.toMillis()&&
 r.file?.contentType==='image/jpeg'&&cents(r.file.byteLength)&&r.file.byteLength>0&&r.file.byteLength<=2*1024*1024&&['width','height'].every(k=>cents(r.file[k])&&r.file[k]>0&&r.file[k]<=1200)&&
 r.storageProof?.protocol==='exceptional_native_jpeg_v1'&&/^\d{1,30}$/.test(r.storageProof.generation)&&typeof r.storageProof.crc32c==='string'&&!!r.storageProof.crc32c&&
 r.storageProof.temporaryHold===true&&native(r.storageProof.observedAt)&&r.storageProof.byteLength===r.file.byteLength&&hash(r.file.sha256)&&r.storageProof.sha256===r.file.sha256&&
 r.contentHash===supportSourceHash(proofContent(r))&&!!ref&&supportHash(evidenceReference(r))===supportHash(ref);}
async function readCase(tx:FirebaseFirestore.Transaction,c:ExceptionalContext){
 const r=(await tx.get(exceptionalCaseRef(c))).data();if(!r)return null;
 if(r.kind!=='exceptional_financial_restitution'||r.protocol!==EXCEPTIONAL_RESTITUTION_CAPABILITY||r.caseId!==exceptionalCaseId(c)||supportHash(r.context)!==supportHash(c)||
  !instruction(r.instructionId)||!hash(r.instructionHash)||!native(r.preparedAt))throw new HttpsError('failed-precondition','Dossier financier natif inconnu.');
 const p=(await tx.get(exceptionalCaseRef(c).collection('exceptional_commands').doc(r.instructionId))).data();
 if(p&&supportHash(parseCommand(p.command))!==p.inputHash)throw new HttpsError('failed-precondition','Corps natif initial contradictoire.');
 if(!p||p.protocol!=='exceptional_restitution_command_v1'||p.state!=='committed'||p.command?.action!=='prepare'||p.inputHash!==supportHash(p.command)||p.inputHash!==r.instructionHash||p.actorId!==r.actorId||
  r.instructionId!=='er_'+supportHash([p.actorId,p.requestId])||p.caseId!==r.caseId||supportHash(p.command.context)!==supportHash(c)||p.command.sourceHash!==supportSourceHash(r.sourceCapture?.facts)||
  p.command.beneficiaryId!==r.beneficiaryId||p.command.amountCents!==r.amountCents||!native(p.recordedAt)||!p.recordedAt.isEqual(r.preparedAt)||p.authority?.privateRole!==true||
  !Number.isSafeInteger(p.authority.authTime)||p.authority.authTime>p.recordedAt.seconds+60||p.recordedAt.seconds-p.authority.authTime>300)throw new HttpsError('failed-precondition','Instruction initiale non qualifiée.');
 if(r.state==='operator_attested'||r.state==='voided'){
  const last=(await tx.get(exceptionalCaseRef(c).collection('exceptional_commands').doc(r.terminalId))).data();
  if(last&&supportHash(parseCommand(last.command))!==last.inputHash)throw new HttpsError('failed-precondition','Attestation native terminale contradictoire.');
  if(!last||last.protocol!=='exceptional_restitution_command_v1'||last.state!=='committed'||last.inputHash!==supportHash(last.command)||last.instructionId!==r.instructionId||last.command.instructionId!==r.instructionId||
   r.terminalId!=='er_'+supportHash([last.actorId,last.requestId])||last.caseId!==r.caseId||supportHash(last.command.context)!==supportHash(c)||last.authority?.privateRole!==true||
   !Number.isSafeInteger(last.authority.authTime)||!native(last.recordedAt)||last.authority.authTime>last.recordedAt.seconds+60||last.recordedAt.seconds-last.authority.authTime>300||
   last.command.beneficiaryId!==r.beneficiaryId||last.command.amountCents!==r.amountCents||last.command.action!==(r.state==='voided'?'void_never_executed':'attest')||!native(last.recordedAt))
   throw new HttpsError('failed-precondition','Reçu terminal à rapprocher.');
 }
 if(r.state==='prepared'&&proofId(r.executionEvidenceId)){
  const e=(await tx.get(byEvidence(c,r.executionEvidenceId))).data();
  if(e?.state==='stored'&&qualifiedProof(e,c,'execution',evidenceReference(e))&&e.instructionId===r.instructionId&&e.beneficiaryId===r.beneficiaryId&&e.amountCents===r.amountCents)
   return {...r,executionEvidence:evidenceReference(e)};
 }
 return r;
}
async function continuity(){
 const q=await readFinancialRecoveryControl(),pin={object:process.env.FINANCIAL_RECOVERY_EXCEPTIONAL_POLICY_OBJECT??'',generation:process.env.FINANCIAL_RECOVERY_EXCEPTIONAL_POLICY_GENERATION??'',sha256:process.env.FINANCIAL_RECOVERY_EXCEPTIONAL_POLICY_SHA256??''};
 let p:any;try{p=JSON.parse((await readFinancialRecoveryPinnedObject(pin)).toString('utf8'));}catch(e){if(e instanceof FinancialRecoveryBlocked)throw e;throw new FinancialRecoveryBlocked('exceptional_policy_unknown');}
 const expected={protocol:'exceptional_restitution_continuity_v1',installationId:q.installation.installationId,firestoreProjectId:q.installation.firestoreProjectId,
  firestoreDatabaseId:q.installation.firestoreDatabaseId,financialEnvironment:q.installation.financialEnvironment,stripePlatformAccountId:q.installation.stripePlatformAccountId,
  epoch:q.control.epoch,bucket:q.installation.bucket,prefix:q.installation.prefix+'/permits/manual-refunds/exceptional',historicalClaimsComplete:true,
  legacyWritersDrained:true,runtimeObjectPermissions:'create_get_only_no_update_delete',claimProtection:'temporary_hold',holdReleaseAuthority:'independent_iam_only',
  lifecycleDeletion:'prevented_by_held_objects',namespaceMigration:'independently_qualified_only'};
 if(!p||Object.keys(p).length!==Object.keys(expected).length+3||Object.entries(expected).some(([k,v])=>p[k]!==v)||typeof p.continuityId!=='string'||!/^[A-Za-z0-9_.:-]{1,180}$/.test(p.continuityId)||
  !Number.isSafeInteger(p.protectedSinceMs)||p.protectedSinceMs<1||!Number.isSafeInteger(p.qualifiedThroughMs)||p.qualifiedThroughMs<p.protectedSinceMs||p.qualifiedThroughMs>Date.now())
  throw new FinancialRecoveryBlocked('exceptional_store_continuity_unknown');
 return {q,policyHash:supportHash(pin),continuityId:p.continuityId};
}
const claimPath=(key:string)=>recoveryInstallation().prefix+'/permits/manual-refunds/exceptional/'+key+'.json';
function qualifiedClaim(read:Awaited<ReturnType<typeof readFinancialRecoveryIdentityClaim>>,s:Awaited<ReturnType<typeof readExceptionalSource>>,instructionId:string,inputHash:string){
 const v=read?.value,i=recoveryInstallation();return read?.temporaryHold===true&&v?.protocol==='exceptional_restitution_lifetime_claim_v1'&&v.obligationKey===s.nativeObligationKey&&v.caseId===s.caseId&&
 v.instructionId===instructionId&&v.inputHash===inputHash&&v.ownerId===s.ownerId&&v.beneficiaryId===s.beneficiaryId&&hash(v.policyHash)&&typeof v.continuityId==='string'&&
 v.installationId===i.installationId&&v.firestoreProjectId===i.firestoreProjectId&&v.firestoreDatabaseId===i.firestoreDatabaseId&&v.financialEnvironment===i.financialEnvironment&&v.stripePlatformAccountId===i.stripePlatformAccountId;
}
async function claim(s:Awaited<ReturnType<typeof readExceptionalSource>>,instructionId:string,inputHash:string,create:boolean){
 if(!hash(s.nativeObligationKey))throw new FinancialRecoveryBlocked('exceptional_obligation_unknown');
 const corpus=s.context.kind==='wallet_restitution'?s.facts.walletFundsCorpus:null;
 if(corpus?.protocol==='exceptional_wallet_funds_corpus_v1'){
  const slotKey=exceptionalWalletConsumptionSlot(corpus),slotPath=claimPath(slotKey),old=await readFinancialRecoveryIdentityClaim(slotPath),i=recoveryInstallation(),value={protocol:'exceptional_wallet_consumption_successor_v1',slotKey,fundsCorpusHash:supportHash(corpus),obligationKey:s.nativeObligationKey,ownerId:s.ownerId,caseId:s.caseId,instructionId,inputHash,
   installationId:i.installationId,firestoreProjectId:i.firestoreProjectId,firestoreDatabaseId:i.firestoreDatabaseId,financialEnvironment:i.financialEnvironment,stripePlatformAccountId:i.stripePlatformAccountId};
  if(old){if(old.temporaryHold!==true||supportHash(old.value)!==supportHash(value))throw new FinancialRecoveryBlocked('wallet_consumption_successor_reserved');}
  else {if(!create)throw new FinancialRecoveryBlocked('wallet_consumption_successor_missing');await continuity();await createRecoveryEvidence(slotPath,value);}
 }
 const path=claimPath(s.nativeObligationKey),read=await readFinancialRecoveryIdentityClaim(path);
 if(read){if(!qualifiedClaim(read,s,instructionId,inputHash))
  throw new FinancialRecoveryBlocked('exceptional_obligation_reserved');if(create)throw new FinancialRecoveryBlocked('exceptional_prior_claim_without_receipt');return;}
 if(!create)throw new FinancialRecoveryBlocked('exceptional_claim_missing');
 const p=await continuity();await createRecoveryEvidence(path,{protocol:'exceptional_restitution_lifetime_claim_v1',obligationKey:s.nativeObligationKey,caseId:s.caseId,
  instructionId,inputHash,ownerId:s.ownerId,beneficiaryId:s.beneficiaryId,policyHash:p.policyHash,continuityId:p.continuityId,installationId:p.q.installation.installationId,
  firestoreProjectId:p.q.installation.firestoreProjectId,firestoreDatabaseId:p.q.installation.firestoreDatabaseId,financialEnvironment:p.q.installation.financialEnvironment,stripePlatformAccountId:p.q.installation.stripePlatformAccountId});
}
async function sourceView(tx:FirebaseFirestore.Transaction,c:ExceptionalContext,p:Data|null,admin:boolean,action?:string,amount?:number|null){
 const current=await readCase(tx,c),s=await readExceptionalSource(tx,c,p,current??undefined);let known=false;
 try{await continuity();if(s.nativeObligationKey){const cl=await readFinancialRecoveryIdentityClaim(claimPath(s.nativeObligationKey));
  known=current?qualifiedClaim(cl,s,current.instructionId,current.instructionHash):!cl;}}
 catch(e){if(!(e instanceof FinancialRecoveryBlocked))throw e;}
 const selected=current?.amountCents??(amount==null?s.maximumCents:amount),valid=cents(selected)&&selected>0&&s.maximumCents!==null&&selected<=s.maximumCents&&(!exceptionalDebtCredit(c)||selected===s.maximumCents);
 const nativeVoid=returnedPayoutVoid(s,current,action),ready=admin&&!!action&&known&&(!s.reason||nativeVoid)&&(!current?.reconciliationRequired||nativeVoid)&&valid&&s.funding!=='original_refund_allocation';
 const refs=admin?{identityEvidence:current?.identityEvidence??null,authorityEvidence:current?.authorityEvidence??null,executionEvidence:current?.executionEvidence??null}:{identityEvidence:null,authorityEvidence:null,executionEvidence:null};
 const source={protocol:'exceptional_restitution_source_v1',context:c,caseId:s.caseId,sourceHash:s.sourceHash,sourceRevision:s.sourceRevision,ownerId:current?.ownerId??s.ownerId,beneficiaryId:current?.beneficiaryId??s.beneficiaryId,
  currency:'CAD',maximumCents:s.maximumCents,amountCents:current?.amountCents??(valid?selected:null),funding:current?.funding??s.funding,state:current?.reconciliationRequired?'reconciliation_required':current?.state??(s.reason?'unqualified':'available'),instructionId:current?.instructionId??null,...refs,
  canPrepare:ready&&!current,canAttest:ready&&action!=='void_never_executed'&&current?.state==='prepared',canVoid:ready&&current?.state==='prepared'&&current.executionEvidenceId===null,
  reason:s.reason??(current?.reconciliationRequired?current.reconciliationReason??'exceptional_later_event_requires_reconciliation':!known?'exceptional_continuity_unqualified':!valid?'human_amount_outside_native_budget':s.warning??
   (current?.sourceCapture?.facts?.originalDebit?.debtRecorded>0&&!exceptionalDebtCredit(c)?'seller_debt_correction_not_included':null)),
   ...exceptionalDebtCredit(c)?{nativeWalletCredit:creditView(current?.nativeWalletCredit)}:{},...effects};
 return {source,s,current};
}
function returnedPayoutVoid(s:Awaited<ReturnType<typeof readExceptionalSource>>,current:Data|null,action?:string){
 return action==='void_never_executed'&&s.context.kind==='withdrawal_misdirection'&&current?.state==='prepared'&&current.executionEvidenceId===null&&
  s.reason==='current_paid_payout_required'&&s.facts.provider?.qualification==='returned_native_misdirection_review';
}
function jpeg(bytes:Buffer){
 if(bytes.length<16||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new HttpsError('invalid-argument','JPEG préparé requis.');
 let pos=2,dim:any=null;for(let i=0;i<200&&pos+3<bytes.length;i++){if(bytes[pos++]!==255)break;while(bytes[pos]===255)pos++;const m=bytes[pos++];if(m===218&&dim)return dim;
  if([0,216,217,218].includes(m)||pos+2>bytes.length)break;const n=bytes.readUInt16BE(pos);if(n<2||pos+n>bytes.length)break;
  if([192,194].includes(m)){if(n<11||bytes[pos+2]!==8||![1,3].includes(bytes[pos+7])||n!==8+3*bytes[pos+7])break;dim={width:bytes.readUInt16BE(pos+5),height:bytes.readUInt16BE(pos+3)};}pos+=n;}
 throw new HttpsError('invalid-argument','Dimensions JPEG non qualifiées.');
}
async function observeFile(r:Data){
 const path=`exceptional_restitution_evidence/${r.caseId}/${r.evidenceId}.jpg`;
 if(r.privatePath!==path)throw new HttpsError('failed-precondition','Chemin natif inconnu.');
 const stored=['stored','stored_requires_review'].includes(r.state),pin=r.storageProof,[m]=await storage.bucket().file(path).getMetadata(),generation=String(m.generation??'');
 if(!/^\d{1,30}$/.test(generation)||m.contentType!=='image/jpeg'||Number(m.size)!==r.file.byteLength||!m.crc32c||m.temporaryHold!==true||
  m.metadata?.inputHash!==r.inputHash||m.metadata?.evidenceId!==r.evidenceId||stored&&(pin?.protocol!=='exceptional_native_jpeg_v1'||pin.generation!==generation||pin.crc32c!==m.crc32c||pin.sha256!==r.file.sha256))
  throw new HttpsError('failed-precondition','La génération native de preuve doit être rapprochée.');
 const [bytes]=await storage.bucket().file(path,{generation:stored?pin.generation:generation}).download({validation:'crc32c'});
 if(bytes.length!==r.file.byteLength||sha(bytes)!==r.file.sha256||supportHash(jpeg(bytes))!==supportHash({width:r.file.width,height:r.file.height}))throw new HttpsError('failed-precondition','Bytes de preuve divergents.');
 return {bytes,proof:{protocol:'exceptional_native_jpeg_v1',generation,crc32c:m.crc32c,sha256:sha(bytes),byteLength:bytes.length,temporaryHold:true,observedAt:Timestamp.now()}};
}
function evidenceReceipt(c:ExceptionalContext,uid:string,rid:string,inputHash:string,r?:Data){return {protocol:'exceptional_restitution_evidence_v1',actorId:uid,requestId:rid,caseId:exceptionalCaseId(c),inputHash,
 state:r?.state==='upload_reserved'?'upload_unknown':r?.state??'unrecorded',reason:r?.reason??null,purpose:r?.purpose??null,beneficiaryId:r?.beneficiaryId??null,amountCents:r?.amountCents??null,
 evidence:r&&['stored','stored_requires_review'].includes(r.state)?evidenceReference(r):null,recordedAt:native(r?.recordedAt)?r!.recordedAt.toDate().toISOString():null,bankArrivalVerified:false,externalAuthenticityVerified:false};}
async function serviceEvidence(c:ExceptionalContext,uid:string,rid:string,inputHash:string){
 const r=(await evidenceRef(c,uid,rid).get()).data();if(!r)return evidenceReceipt(c,uid,rid,inputHash);
 if(r.inputHash!==inputHash||r.actorId!==uid||r.caseId!==exceptionalCaseId(c)||r.requestId!==rid)throw new HttpsError('already-exists','Dépôt différent.');
 if(r.state!=='upload_reserved')return evidenceReceipt(c,uid,rid,inputHash,r);
 let file:Awaited<ReturnType<typeof observeFile>>;try{file=await observeFile(r);}catch(e){if(e instanceof FinancialRecoveryBlocked)throw e;return evidenceReceipt(c,uid,rid,inputHash,r);}
 return db.runTransaction(async tx=>{const old=(await tx.get(evidenceRef(c,uid,rid))).data();if(!old||old.inputHash!==inputHash)throw new HttpsError('failed-precondition','Dépôt modifié.');
  if(old.state!=='upload_reserved')return evidenceReceipt(c,uid,rid,inputHash,old);
  const value:Data={...old,state:'stored',storageProof:file.proof,recordedAt:Timestamp.now()};value.contentHash=supportSourceHash(proofContent(value));
  const checkpoint=financialRecoveryCommitCheckpoint();await checkpoint({refs:[evidenceRef(c,uid,rid).path]});
  tx.update(evidenceRef(c,uid,rid),value);return evidenceReceipt(c,uid,rid,inputHash,value);});
}
function day(d:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
async function evidenceOperation(r:any,uid:string){
 const raw=r.data,c=parseExceptionalContext(raw.context),rid=supportRequestId(raw.requestId),minimal=raw.modeAction!=='execute';
 supportObject(raw,minimal?['mode','capability','expectedUid','requestId','modeAction','context','expectedInputHash']:['mode','capability','expectedUid','requestId','modeAction','context','previewId','sourceHash','sourceRevision','purpose','instructionId','file','bytesBase64','execution']);
 if(!['execute','observe','neutralize'].includes(raw.modeAction))throw new HttpsError('invalid-argument','Action de dépôt inconnue.');
 if(minimal){if(!hash(raw.expectedInputHash))throw new HttpsError('invalid-argument','Hash du dépôt requis.');
  await db.runTransaction(async tx=>{const old=(await tx.get(evidenceRef(c,uid,rid))).data();if(old&&old.inputHash!==raw.expectedInputHash)throw new HttpsError('already-exists','Dépôt différent.');
   if(!old&&raw.modeAction==='neutralize')tx.create(evidenceRef(c,uid,rid),{protocol:'exceptional_restitution_evidence_record_v1',actorId:uid,requestId:rid,caseId:exceptionalCaseId(c),context:c,inputHash:raw.expectedInputHash,state:'not_executed',reason:'requester_neutralized',recordedAt:Timestamp.now()});});
  return serviceEvidence(c,uid,rid,raw.expectedInputHash);
 }
 const f=supportObject(raw.file,['sha256','byteLength','contentType','width','height']);
 if(!purposes.includes(raw.purpose)||exceptionalDebtCredit(c)&&raw.purpose==='execution'||!hash(raw.previewId)||!hash(raw.sourceHash)||!hash(raw.sourceRevision)||!(raw.instructionId===null||instruction(raw.instructionId))||
  !hash(f.sha256)||!cents(f.byteLength)||f.byteLength<1||f.byteLength>2*1024*1024||f.contentType!=='image/jpeg'||!['width','height'].every(k=>cents(f[k])&&f[k]>0&&f[k]<=1200))throw new HttpsError('invalid-argument','JPEG préparé et tuple natif requis.');
 let execution:any=null;
 if(raw.purpose==='execution'){const e=supportObject(raw.execution,['transferReference','executedDate']);if(typeof e.transferReference!=='string'||e.transferReference.trim().length<3||e.transferReference.length>200||/[\u0000-\u001f\u007f]/.test(e.transferReference)||typeof e.executedDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(e.executedDate)||
  !Number.isFinite(Date.parse(e.executedDate+'T12:00:00Z'))||new Date(e.executedDate+'T12:00:00Z').toISOString().slice(0,10)!==e.executedDate||e.executedDate>day(new Date()))throw new HttpsError('invalid-argument','Référence bancaire et date civile réelle requises.');
  execution={referenceHash:supportHash(e.transferReference.trim().normalize('NFC').toUpperCase()),executedDate:e.executedDate};
 }else if(raw.execution!==null)throw new HttpsError('invalid-argument','Exécution incompatible.');
 const inputHash=supportHash({context:c,previewId:raw.previewId,sourceHash:raw.sourceHash,sourceRevision:raw.sourceRevision,purpose:raw.purpose,instructionId:raw.instructionId,file:f,execution});
 const old=(await evidenceRef(c,uid,rid).get()).data();if(old)return serviceEvidence(c,uid,rid,inputHash);
 if(typeof raw.bytesBase64!=='string'||raw.bytesBase64.length>Math.ceil(2*1024*1024/3)*4||raw.bytesBase64.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw.bytesBase64))throw new HttpsError('invalid-argument','Bytes bornés requis.');
 const bytes=Buffer.from(raw.bytesBase64,'base64');if(bytes.toString('base64')!==raw.bytesBase64||bytes.length!==f.byteLength||sha(bytes)!==f.sha256||supportHash(jpeg(bytes))!==supportHash({width:f.width,height:f.height}))throw new HttpsError('invalid-argument','JPEG différent de l’intention.');
 const reserved=await db.runTransaction(async tx=>{const prev=await tx.get(evidenceRef(c,uid,rid));if(prev.exists)return null;
  await operator(tx,r);const p=(await tx.get(previewRef(c,raw.previewId))).data(),current=await readCase(tx,c),s=await readExceptionalSource(tx,c,p?.provider??null,current??undefined);
  if(p?.actorId!==uid||p.protocol!=='exceptional_restitution_preview_v1'||p.sourceHash!==raw.sourceHash||p.sourceRevision!==raw.sourceRevision||s.sourceHash!==raw.sourceHash||s.sourceRevision!==raw.sourceRevision||
   !native(p.createdAt)||Date.now()-p.createdAt.toMillis()>300000||s.reason)throw new HttpsError('failed-precondition','Aperçu actuel requis.');
  if(raw.purpose==='execution'?(current?.state!=='prepared'||current.instructionId!==raw.instructionId||current.executionEvidenceId!==null||execution.executedDate<day(current.preparedAt.toDate())):raw.instructionId!==null)
   throw new HttpsError('failed-precondition','Instruction et phase exactes requises.');
  const v={protocol:'exceptional_restitution_evidence_record_v1',context:c,caseId:exceptionalCaseId(c),actorId:uid,requestId:rid,inputHash,evidenceId:evidenceRef(c,uid,rid).id,purpose:raw.purpose,instructionId:raw.instructionId,
   sourceHash:raw.sourceHash,sourceRevision:raw.sourceRevision,beneficiaryId:s.beneficiaryId,amountCents:p.amountCents,file:f,execution,privatePath:`exceptional_restitution_evidence/${exceptionalCaseId(c)}/${evidenceRef(c,uid,rid).id}.jpg`,state:'upload_reserved',reservedAt:Timestamp.now(),recordedAt:null,storageProof:null};
  const checkpoint=financialRecoveryCommitCheckpoint();await checkpoint({refs:[evidenceRef(c,uid,rid).path,...raw.purpose==='execution'?[exceptionalCaseRef(c).path]:[]]});tx.create(evidenceRef(c,uid,rid),v);
  if(raw.purpose==='execution')tx.update(exceptionalCaseRef(c),{executionEvidenceId:v.evidenceId});return v;
 });
 if(reserved){await db.runTransaction(tx=>operator(tx,r));try{await storage.bucket().file(reserved.privatePath).save(bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},
  metadata:{contentType:'image/jpeg',cacheControl:'private, no-store',temporaryHold:true,metadata:{inputHash,evidenceId:reserved.evidenceId}}});}catch(e){if(e instanceof FinancialRecoveryBlocked)throw e;}}
 return serviceEvidence(c,uid,rid,inputHash);
}
async function loadProofs(tx:FirebaseFirestore.Transaction,c:ExceptionalContext,cmd:Data){
 const read=async(ref:Data|null,purpose:string)=>{
  const d=ref?(await tx.get(byEvidence(c,ref.evidenceId))).data():undefined;
  if(!qualifiedProof(d,c,purpose,ref)||d!.beneficiaryId!==cmd.beneficiaryId||d!.amountCents!==cmd.amountCents)throw new HttpsError('failed-precondition','Preuve native liée au bénéficiaire et au montant requise.');return d!;};
 return {identity:await read(cmd.identityEvidence,'identity_destination'),authority:await read(cmd.authorityEvidence,'harm_or_authority'),
  execution:cmd.action==='attest'&&!exceptionalDebtCredit(c)?await read(cmd.executionEvidence,'execution'):null};
}
async function reReadAuthority(s:Awaited<ReturnType<typeof readExceptionalSource>>){
 const a=s.authority;if(a?.kind!=='human_qualified_representation')return;
 for(const selected of a.evidenceReads){const d=(await db.collection('support_requests').doc(a.supportRequestId).collection('review_evidence').doc(selected.evidence.evidenceId).get()).data();
  if(!d||d.generation!==selected.evidence.generation||d.sha256!==selected.evidence.sha256||d.sizeBytes!==selected.evidence.sizeBytes)throw new HttpsError('failed-precondition','Pièces de pouvoir modifiées.');
  await readPrivateSupportCaseJpeg(d as any);
 }
}
async function reserveBankReference(c:ExceptionalContext,r:Data,current:Data){
 // Shared with H18: one real transfer reference cannot settle two different
 // obligations through different manual capabilities.
 const key=r.execution.referenceHash,path=recoveryInstallation().prefix+'/permits/manual-refunds/references/'+key+'.json',old=await readFinancialRecoveryIdentityClaim(path);
 const payload={protocol:'exceptional_bank_reference_v1',referenceHash:key,caseId:exceptionalCaseId(c),instructionId:current.instructionId,
  proofHash:r.contentHash,beneficiaryId:current.beneficiaryId,amountCents:current.amountCents,currency:'CAD'};
 const check=(x:any)=>{if(!x?.temporaryHold||supportHash(x.value)!==supportHash(payload))throw new FinancialRecoveryBlocked('bank_reference_already_bound');};
 if(old){check(old);return;}
 try{await createRecoveryEvidence(path,payload);}catch(e){if(!(e instanceof FinancialRecoveryBlocked&&e.reason==='manual_refund_claim_already_reserved'))throw e;}
 check(await readFinancialRecoveryIdentityClaim(path));
}
export async function handleExceptionalRestitution(request:any){
 const uid=supportUid(request),raw=request.data;if(raw.capability!==EXCEPTIONAL_RESTITUTION_CAPABILITY)throw new HttpsError('invalid-argument','Version de réparation explicite requise.');
 if(raw.mode==='exceptional_restitution_evidence')return evidenceOperation(request,uid);
 if(raw.mode==='exceptional_restitution_evidence_read'){
  supportObject(raw,['mode','capability','expectedUid','context','evidence']);const c=parseExceptionalContext(raw.context),ref=reference(raw.evidence);if(!ref)throw new HttpsError('invalid-argument','Preuve requise.');
  const r=await db.runTransaction(async tx=>{await operator(tx,request);const d=(await tx.get(byEvidence(c,ref.evidenceId))).data();
   if(!d||!['stored','stored_requires_review'].includes(d.state)||supportHash(evidenceReference(d))!==supportHash(ref))throw new HttpsError('failed-precondition','Preuve native inconnue.');return d;});
  const f=await observeFile(r);await db.runTransaction(tx=>operator(tx,request));return {protocol:'exceptional_restitution_evidence_file_v1',actorId:uid,caseId:exceptionalCaseId(c),evidence:ref,purpose:r.purpose,dataUrl:'data:image/jpeg;base64,'+f.bytes.toString('base64'),bankArrivalVerified:false};
 }
 if(raw.mode==='exceptional_restitution_source'){
  supportObject(raw,['mode','capability','expectedUid','context','scope']);const c=parseExceptionalContext(raw.context);if(!['own','admin'].includes(raw.scope))throw new HttpsError('invalid-argument','Portée exacte requise.');
  return db.runTransaction(async tx=>{if(raw.scope==='admin'){await supportCurrentAdminSession(request);await supportAdmin(tx,uid,false);}
   const out=await sourceView(tx,c,null,raw.scope==='admin');if(raw.scope==='own'&&out.source.ownerId!==uid&&out.s.authority?.representativeUid!==uid)throw new HttpsError('permission-denied','Source propre requise.');return out.source;});
 }
 if(raw.mode==='exceptional_restitution_preview'){
  supportObject(raw,['mode','capability','expectedUid','context','action','amountCents']);const c=parseExceptionalContext(raw.context);
  if(!actions.includes(raw.action)||!(raw.amountCents===null||cents(raw.amountCents)&&raw.amountCents>0))throw new HttpsError('invalid-argument','Action et montant borné requis.');
  await db.runTransaction(tx=>operator(tx,request));const provider=await observeExceptionalProvider(c);
  return db.runTransaction(async tx=>{await operator(tx,request);const v=await sourceView(tx,c,provider,true,raw.action,raw.amountCents),source=v.source;
   const previewId=supportHash([uid,c,raw.action,source.sourceHash,source.sourceRevision,source.amountCents,provider.proofHash]),r=previewRef(c,previewId),old=await tx.get(r);
   const value={protocol:'exceptional_restitution_preview_v1',actorId:uid,context:c,action:raw.action,sourceHash:source.sourceHash,sourceRevision:source.sourceRevision,amountCents:source.amountCents,provider};
   if(old.exists){const previous=old.data()!;
    if(!native(previous.createdAt)||supportSourceHash(Object.fromEntries(Object.keys(value).map(k=>[k,previous[k]])))!==supportSourceHash(value))
     throw new HttpsError('failed-precondition','Aperçu natif contradictoire.');}
   const checkpoint=financialRecoveryCommitCheckpoint();await checkpoint({refs:[r.path]});
   if(old.exists)tx.update(r,{createdAt:Timestamp.now()});else tx.create(r,{...value,createdAt:Timestamp.now()});
   return {protocol:'exceptional_restitution_preview_v1',actorId:uid,action:raw.action,previewId,source};});
 }
 if(raw.mode!=='exceptional_restitution_command'||!['execute','observe','neutralize'].includes(raw.modeAction))throw new HttpsError('invalid-argument','Mode de réparation inconnu.');
 const execute=raw.modeAction==='execute';supportObject(raw,execute?['mode','capability','expectedUid','requestId','modeAction','command']:['mode','capability','expectedUid','requestId','modeAction','context','expectedInputHash']);
 const cmd=execute?parseCommand(raw.command):null,c=cmd?.context??parseExceptionalContext(raw.context),rid=supportRequestId(raw.requestId),inputHash=cmd?supportHash(cmd):raw.expectedInputHash,r=commandRef(c,uid,rid);
 if(!hash(inputHash))throw new HttpsError('invalid-argument','Hash du journal requis.');
 const first=await db.runTransaction(async tx=>{const old=(await tx.get(r)).data();
  if(old){if(old.actorId!==uid||old.requestId!==rid||old.inputHash!==inputHash||old.caseId!==exceptionalCaseId(c)||!['committed','not_executed'].includes(old.state))throw new HttpsError('already-exists','Journal différent.');return commandReceipt(c,uid,rid,inputHash,old);}
  if(raw.modeAction==='neutralize'){const value={protocol:'exceptional_restitution_command_v1',actorId:uid,requestId:rid,caseId:exceptionalCaseId(c),inputHash,state:'not_executed',reason:'requester_neutralized',recordedAt:Timestamp.now()};tx.create(r,value);return commandReceipt(c,uid,rid,inputHash,value);}
  if(!execute)return commandReceipt(c,uid,rid,inputHash);return null;});
 if(first)return first;
 const command=cmd!,provider=await observeExceptionalProvider(c);
 const initial=await db.runTransaction(async tx=>{await operator(tx,request);const preview=(await tx.get(previewRef(c,command.previewId))).data(),v=await sourceView(tx,c,provider,true,command.action,command.amountCents);
  if(preview?.protocol!=='exceptional_restitution_preview_v1'||preview.actorId!==uid||preview.action!==command.action||preview.sourceHash!==command.sourceHash||preview.sourceRevision!==command.sourceRevision||
   !native(preview.createdAt)||Date.now()-preview.createdAt.toMillis()>300000||v.source.sourceHash!==command.sourceHash||v.source.sourceRevision!==command.sourceRevision||v.source.amountCents!==command.amountCents||
   v.source.beneficiaryId!==command.beneficiaryId||!(command.action==='prepare'?v.source.canPrepare:command.action==='attest'?v.source.canAttest:v.source.canVoid)||
   (c.kind!=='refund_error'||exceptionalDebtCredit(c))&&command.amountCents!==v.source.maximumCents)throw new HttpsError('failed-precondition','Aperçu, autorité et budget natifs actuels requis.');
  const proofs=await loadProofs(tx,c,command);if(command.action!=='prepare'&&(!v.current||v.current.instructionId!==command.instructionId||supportHash(v.current.identityEvidence)!==supportHash(command.identityEvidence)||supportHash(v.current.authorityEvidence)!==supportHash(command.authorityEvidence)))
   throw new HttpsError('failed-precondition','Instruction native modifiée.');return {...v,proofs};});
 await observeFile(initial.proofs.identity);await observeFile(initial.proofs.authority);await reReadAuthority(initial.s);
 if(initial.proofs.execution){await observeFile(initial.proofs.execution);await reserveBankReference(c,initial.proofs.execution,initial.current!);}
 await continuity();if(command.action==='prepare')await claim(initial.s,r.id,inputHash,true);else await claim(initial.s,initial.current!.instructionId,initial.current!.instructionHash,false);
 await db.runTransaction(async tx=>{
  const old=(await tx.get(r)).data();if(old){if(old.inputHash!==inputHash)throw new HttpsError('already-exists','Journal différent.');return;}
  await operator(tx,request);const current=await readCase(tx,c),s=await readExceptionalSource(tx,c,provider,current??undefined),proofs=await loadProofs(tx,c,command);
  if(s.sourceHash!==command.sourceHash||s.sourceRevision!==command.sourceRevision||s.reason&&!returnedPayoutVoid(s,current,command.action)||s.beneficiaryId!==command.beneficiaryId||s.maximumCents===null||command.amountCents>s.maximumCents)
   throw new HttpsError('aborted','Sources financières modifiées.');
  const initialKey=command.action==='prepare'?r.id:current!.instructionId;await claim(s,initialKey,command.action==='prepare'?inputHash:current!.instructionHash,false);
  if(command.action==='prepare'?current!==null:current?.state!=='prepared'||current.instructionId!==command.instructionId)throw new HttpsError('aborted','Une autre instruction a gagné.');
  if(command.action==='void_never_executed'&&current!.executionEvidenceId!==null)throw new HttpsError('failed-precondition','Une exécution déclarée ou inconnue nécessite une revue.');
  if(proofs.identity.contentHash!==initial.proofs.identity.contentHash||proofs.authority.contentHash!==initial.proofs.authority.contentHash||proofs.execution&&
   (proofs.execution.contentHash!==initial.proofs.execution!.contentHash||current!.executionEvidenceId!==proofs.execution.evidenceId||proofs.execution.instructionId!==current!.instructionId))throw new HttpsError('aborted','Pièces natives modifiées.');
  // All financial dates below are the native commit time, including across
  // checkpoint IO or a transaction retry. Read the receipt after commit.
  const now=FieldValue.serverTimestamp(),state=command.action==='prepare'?'prepared':command.action==='attest'?'operator_attested':'voided';
  const next:Data=command.action==='prepare'?{kind:'exceptional_financial_restitution',protocol:EXCEPTIONAL_RESTITUTION_CAPABILITY,caseId:s.caseId,context:c,ownerId:s.ownerId,
   beneficiaryId:s.beneficiaryId,amountCents:command.amountCents,currency:'CAD',funding:s.funding,nativeObligationKey:s.nativeObligationKey,state,instructionId:r.id,instructionHash:inputHash,
   status:'open',severity:'high',refId:s.caseId,message:command.note,createdAt:now,actorId:uid,preparedAt:now,identityEvidence:command.identityEvidence,authorityEvidence:command.authorityEvidence,executionEvidence:null,executionEvidenceId:null,
   sourceCapture:{facts:s.facts,authority:s.authority??null,walletBasis:s.wallet?{collection:'wallets',id:s.ownerId,source:s.wallet}:null},reservation:null}: {...current!,state,terminalId:r.id,updatedAt:now,
    ...command.action==='attest'?{executionEvidence:command.executionEvidence,attestedAt:now}:{voidedAt:now,reconciliationRequired:false,reconciliationReason:null}};
  const marker={protocol:EXCEPTIONAL_RESTITUTION_CAPABILITY,caseId:s.caseId,instructionId:initialKey,state,ownerId:s.ownerId,amountCents:command.amountCents,sourceHash:command.sourceHash};
  let targetFields:Data|undefined,profilePlan:{ref:FirebaseFirestore.DocumentReference;fields:Data}|undefined,ledger:{ref:FirebaseFirestore.DocumentReference;document:Data}|undefined,
   creditedWallet:{ref:FirebaseFirestore.DocumentReference;fields:Data;create:boolean}|undefined;
  if(c.kind==='wallet_restitution'){
   const walletRef=db.collection('wallets').doc(c.ownerId),wallet=s.wallet!,profileRef=db.collection('eligibility_profiles').doc(c.ownerId),profile=(await tx.get(profileRef)).data();
   if(command.action==='prepare'){
    const debit=walletRef.collection('ledger').doc('exceptional_restitution_'+initialKey);if((await tx.get(debit)).exists||wallet.balance!==command.amountCents)throw new HttpsError('aborted','Solde ou débit causal modifié.');
    next.reservation={ownerId:c.ownerId,ledgerId:debit.id,amountCents:command.amountCents,recordedAt:now};
    targetFields=await financialRecoveryWalletFields(walletRef,wallet,{balance:0,exceptionalRestitution:marker,updatedAt:now},{balance:0});
    ledger={ref:debit,document:{type:'exceptional_restitution_reserve',caseId:s.caseId,instructionId:initialKey,amount:command.amountCents,currency:'CAD',balanceAfter:0,createdAt:now}};
   }else if(command.action==='void_never_executed'){
    const returned=walletRef.collection('ledger').doc('exceptional_restitution_void_'+initialKey),exists=await tx.get(returned),balance=wallet.balance+command.amountCents;
    if(exists.exists||!cents(balance))throw new HttpsError('failed-precondition','Restauration de réserve à rapprocher.');
    targetFields=await financialRecoveryWalletFields(walletRef,wallet,{balance,exceptionalRestitution:marker,updatedAt:now},{balance});
    ledger={ref:returned,document:{type:'exceptional_restitution_void',caseId:s.caseId,instructionId:initialKey,reserveLedgerId:current!.reservation.ledgerId,amount:command.amountCents,currency:'CAD',balanceAfter:balance,createdAt:now}};
   }else targetFields=await financialRecoveryWalletFields(walletRef,wallet,{exceptionalRestitution:marker});
   profilePlan={ref:profileRef,fields:{'accountClosure.exceptionalRestitution':marker}};
   if(profile?.accountClosure?.phase!=='paused'&&!(s.facts.postClosure?.qualified===true&&profile?.accountClosure?.phase==='purging'&&profile.accountClosure.authDeletedAt instanceof Timestamp))throw new HttpsError('aborted','Fermeture modifiée.');
  }else if(s.target)targetFields=await financialRecoverySourceFields(c.kind==='withdrawal_misdirection'?'withdrawal':'purchase',s.target,s.facts.withdrawal??s.facts.order,{exceptionalRestitution:marker});
  if(exceptionalDebtCredit(c)&&command.action==='attest'){
   const owner=s.ownerId!,walletRef=db.collection('wallets').doc(owner),snapshot=s.walletSnapshot!,wallet=s.wallet??{balance:0,pendingBalance:0,heldBalance:0,sellerDebt:0,status:'inactive',currency:'CAD'},
    offset=Math.min(wallet.sellerDebt,command.amountCents),balanceCredit=command.amountCents-offset,balance=wallet.balance+balanceCredit,debt=wallet.sellerDebt-offset,
    credit=walletRef.collection('ledger').doc('exceptional_compensation_'+initialKey);
   if((await tx.get(credit)).exists||!cents(balance)||!cents(debt))throw new HttpsError('aborted','Crédit compensatoire natif à rapprocher.');
   next.nativeWalletCredit={debtOffsetCents:offset,balanceCreditCents:balanceCredit,recordedAt:now};
   const values={...!snapshot.exists?wallet:{},balance,sellerDebt:debt,updatedAt:now};
   creditedWallet={ref:walletRef,fields:await financialRecoveryWalletFields(walletRef,snapshot,values,{balance,sellerDebt:debt}),create:!snapshot.exists};
   ledger={ref:credit,document:{type:'exceptional_compensation_credit',caseId:s.caseId,instructionId:initialKey,transactionId:(c as Extract<ExceptionalContext,{kind:'refund_error'}>).transactionId,
    refundIntentId:(c as Extract<ExceptionalContext,{kind:'refund_error'}>).refundIntentId,amount:command.amountCents,debtOffsetCents:offset,balanceCreditCents:balanceCredit,balanceAfter:balance,sellerDebtAfter:debt,currency:'CAD',createdAt:now}};
   const profileRef=db.collection('eligibility_profiles').doc(owner),profile=(await tx.get(profileRef)).data(),closure=profile?.accountClosure;
   if(closure?.schemaVersion===1&&closure.ownerId===owner&&['purging','complete'].includes(closure.phase))profilePlan={ref:profileRef,fields:{'accountClosure.phase':'purging','accountClosure.status':'incomplete',
    'accountClosure.requiresOperator':true,'accountClosure.leaseUntilMs':0,'accountClosure.blockers':['financial_reconciliation_required'],'accountClosure.incompleteParts':['financial_obligation'],
    'accountClosure.lateFinancialEvent':{source:'seconde_compensation',caseId:s.caseId,recordedAt:now}}};
  }
  const liabilityRef=db.collection('platform_ledger').doc('exceptional_restitution_'+s.caseId),priorLiability=(await tx.get(liabilityRef)).data();
  if(command.action!=='prepare'&&(!priorLiability||priorLiability.instructionId!==initialKey||priorLiability.amountCents!==command.amountCents))throw new HttpsError('failed-precondition','Passif natif à rapprocher.');
  const liability={protocol:'exceptional_restitution_liability_v1',type:'exceptional_restitution',caseId:s.caseId,context:c,ownerId:s.ownerId,beneficiaryId:s.beneficiaryId,
   instructionId:initialKey,amountCents:command.amountCents,currency:'CAD',funding:s.funding,state,reservedLiabilityCents:state==='prepared'?command.amountCents:0,
   manuallyDisbursedCents:state==='operator_attested'&&!exceptionalDebtCredit(c)?command.amountCents:0,...exceptionalDebtCredit(c)?{nativeWalletCredit:next.nativeWalletCredit??null}:{},createdAt:priorLiability?.createdAt??now,updatedAt:now,
   ...(proofs.execution?{executionEvidenceHash:proofs.execution.contentHash,declaredExecutedDate:proofs.execution.execution.executedDate}:{}),...effects};
  const bankReference=proofs.execution?db.collection('platform_ledger').doc('manual_bank_transfer_'+proofs.execution.execution.referenceHash):null;
  if(bankReference&&(await tx.get(bankReference)).exists)throw new HttpsError('already-exists','Cette référence bancaire est déjà rapprochée.');
  if(command.action!=='prepare')next.status='resolved';
  const receipt={protocol:'exceptional_restitution_command_v1',actorId:uid,requestId:rid,caseId:s.caseId,inputHash,command,state:'committed',reason:null,instructionId:initialKey,outcome:state,
   recordedAt:now,...exceptionalDebtCredit(c)?{nativeWalletCredit:next.nativeWalletCredit??null}:{},authority:{privateRole:true,authTime:request.auth.token.auth_time}};
  const notice=await prepareOperationalNotices(tx,[{eventKey:'exceptional_restitution:'+r.id,userId:s.ownerId!,type:'order_moderation',title:'Suivi de la restitution',message:command.partyMessage,
   data:{ownerId:s.ownerId!,exceptionalCaseId:s.caseId,state,bankArrivalVerified:'false'}}]);
  const checkpoint=financialRecoveryCommitCheckpoint();await checkpoint({refs:[exceptionalCaseRef(c).path,r.path,liabilityRef.path,...s.target?[s.target.path]:[],
   ...ledger?[ledger.ref.path]:[],...bankReference?[bankReference.path]:[],...profilePlan?[profilePlan.ref.path]:[],...creditedWallet?[creditedWallet.ref.path]:[]]});
  if(bankReference)tx.create(bankReference,{type:'exceptional_manual_bank_reference',protocol:'exceptional_bank_reference_v1',caseId:s.caseId,context:c,instructionId:initialKey,
   attestationId:r.id,referenceHash:proofs.execution!.execution.referenceHash,amountCents:command.amountCents,currency:'CAD',createdAt:now});
  if(ledger)tx.create(ledger.ref,ledger.document);if(targetFields&&s.target)tx.update(s.target,targetFields);if(profilePlan)tx.update(profilePlan.ref,profilePlan.fields);
  if(creditedWallet){if(creditedWallet.create)tx.create(creditedWallet.ref,creditedWallet.fields);else tx.update(creditedWallet.ref,creditedWallet.fields);}
  tx.set(liabilityRef,liability);tx.set(exceptionalCaseRef(c),next);tx.create(r,receipt);notice.commit();
 });
 // No NEW authority is inferred from this read: it returns this caller's own
 // immutable receipt, including the server-resolved commit timestamp.
 return db.runTransaction(async tx=>{const recorded=(await tx.get(r)).data();
  if(!recorded||recorded.actorId!==uid||recorded.requestId!==rid||recorded.caseId!==exceptionalCaseId(c)||recorded.inputHash!==inputHash||
   !['committed','not_executed'].includes(recorded.state)||!native(recorded.recordedAt))throw new HttpsError('unavailable','Relisez le reçu natif de cette même demande.');
  return commandReceipt(c,uid,rid,inputHash,recorded);});
}
/** Consumed exception reservations fence BOTH reversal and wallet credit. Real
 * old recovery receipts remain FIRST in their original consumer. */
export async function exceptionalRestitutionBlocksPayoutRecovery(tx:FirebaseFirestore.Transaction,id:string,withdrawal:Data){
 const c:ExceptionalContext={kind:'withdrawal_misdirection',withdrawalRequestId:id},marker=withdrawal.exceptionalRestitution;
 const obligationKey=typeof withdrawal.withdrawalIntent?.payloadHash==='string'?supportHash(['withdrawal_misdirection',id,withdrawal.withdrawalIntent.payloadHash]):null;
 const outside=obligationKey?await readFinancialRecoveryIdentityClaim(claimPath(obligationKey)):null;
 if(marker===undefined&&!outside)return false;
 const current=await readCase(tx,c);return !current||current.state!=='voided'||marker?.instructionId!==current.instructionId;
}
export async function exceptionalWalletRestitutionAllowsClosure(tx:FirebaseFirestore.Transaction,uid:string,marker:Data){
 if(marker?.protocol!==EXCEPTIONAL_RESTITUTION_CAPABILITY||marker.ownerId!==uid||typeof marker.caseId!=='string')return false;
 const raw=(await tx.get(db.collection('admin_alerts').doc(marker.caseId))).data();if(raw?.context?.kind!=='wallet_restitution'||raw.context.ownerId!==uid)return false;
 const c=parseExceptionalContext(raw.context),current=await readCase(tx,c);if(!current||current.reconciliationRequired===true||current.instructionId!==marker.instructionId||!['operator_attested','voided'].includes(current.state))return false;
 const accounting=await readExceptionalNativeAccounting(tx,current.caseId);if(!accounting.qualified||accounting.blockers.length)return false;
 const wallet=(await tx.get(db.collection('wallets').doc(uid))).data(),debit=(await tx.get(db.collection('wallets').doc(uid).collection('ledger').doc(current.reservation.ledgerId))).data();
 return !!wallet&&wallet.exceptionalRestitution?.instructionId===current.instructionId&&debit?.type==='exceptional_restitution_reserve'&&debit.instructionId===current.instructionId&&debit.amount===current.amountCents;
}

/** Read-only historical join. Current roles/provider profiles never erase a
 * recorded human event. This qualifies its exact native receipts and ledger,
 * not bank arrival or the continuity of an external bank statement. */
export async function readExceptionalNativeAccounting(tx:FirebaseFirestore.Transaction,caseId:string){
 const blockers:string[]=[],bad=(reason:string)=>{if(!blockers.includes(reason))blockers.push(reason);};
 const raw=(await tx.get(db.collection('admin_alerts').doc(caseId))).data();
 if(!raw)return {qualified:false,blockers:['exceptional_case_missing'],case:null,liability:null,reserve:null,returned:null,terminal:null,reference:null};
 try{
  const context=parseExceptionalContext(raw.context),r=await readCase(tx,context);
  if(!r||r.caseId!==caseId||!isSupportAccountUid(r.ownerId)||r.beneficiaryId!==r.ownerId||!cents(r.amountCents)||r.amountCents<1||r.currency!=='CAD'||
   !['prepared','operator_attested','voided'].includes(r.state)||!['existing_wallet','seconde_compensation','seconde_wallet_compensation'].includes(r.funding))throw new Error('case');
  const target=await tx.get(context.kind==='wallet_restitution'?db.collection('wallets').doc(context.ownerId):context.kind==='withdrawal_misdirection'?
   db.collection('withdrawal_requests').doc(context.withdrawalRequestId):db.collection('transactions').doc(context.transactionId)),currentSource=target.data();
  if(!currentSource)bad('exceptional_native_current_source_missing');
  else if(context.kind==='withdrawal_misdirection'&&currentSource.userId!==r.ownerId||context.kind==='refund_error'&&
   currentSource[['seller_undue_debit','seller_debt_compensation'].includes(context.harm)?'sellerId':'buyerId']!==r.ownerId||context.kind==='wallet_restitution'&&
   Object.prototype.hasOwnProperty.call(currentSource,'userId')&&currentSource.userId!==r.ownerId)bad('exceptional_native_current_source_changed');
  const liability=(await tx.get(db.collection('platform_ledger').doc('exceptional_restitution_'+caseId))).data()??null;
  if(!liability||liability.protocol!=='exceptional_restitution_liability_v1'||liability.type!=='exceptional_restitution'||liability.caseId!==caseId||
   liability.instructionId!==r.instructionId||liability.ownerId!==r.ownerId||liability.beneficiaryId!==r.beneficiaryId||liability.amountCents!==r.amountCents||
   liability.state!==r.state||liability.funding!==r.funding||liability.currency!=='CAD'||supportHash(liability.context)!==supportHash(context)||
   liability.reservedLiabilityCents!==(r.state==='prepared'?r.amountCents:0)||liability.manuallyDisbursedCents!==(r.state==='operator_attested'&&!exceptionalDebtCredit(context)?r.amountCents:0)||
   !native(liability.createdAt)||!liability.createdAt.isEqual(r.preparedAt)||!native(liability.updatedAt)||liability.bankArrivalVerified!==false||liability.stripeSettlementGranted!==false)bad('exceptional_liability_native_join_unknown');
  const identity=r.identityEvidence?(await tx.get(byEvidence(context,r.identityEvidence.evidenceId))).data():undefined,
   authority=r.authorityEvidence?(await tx.get(byEvidence(context,r.authorityEvidence.evidenceId))).data():undefined;
  for(const [value,purpose,ref] of [[identity,'identity_destination',r.identityEvidence],[authority,'harm_or_authority',r.authorityEvidence]] as const)
   if(!qualifiedProof(value,context,purpose,ref)||value!.beneficiaryId!==r.beneficiaryId||value!.amountCents!==r.amountCents)bad('exceptional_initial_proof_native_join_unknown');
  let reserve:Data|null=null,returned:Data|null=null,terminal:Data|null=null,reference:Data|null=null;
  if(context.kind==='wallet_restitution'){
   if(r.funding!=='existing_wallet'||r.reservation?.ownerId!==r.ownerId||r.reservation.amountCents!==r.amountCents||r.reservation.ledgerId!=='exceptional_restitution_'+r.instructionId)bad('exceptional_wallet_reservation_unknown');
   else {
    reserve=(await tx.get(db.collection('wallets').doc(r.ownerId).collection('ledger').doc(r.reservation.ledgerId))).data()??null;
    if(!reserve||reserve.type!=='exceptional_restitution_reserve'||reserve.caseId!==caseId||reserve.instructionId!==r.instructionId||reserve.amount!==r.amountCents||reserve.currency!=='CAD'||reserve.balanceAfter!==0||!native(reserve.createdAt)||!reserve.createdAt.isEqual(r.preparedAt))bad('exceptional_reserve_ledger_unknown');
    returned=(await tx.get(db.collection('wallets').doc(r.ownerId).collection('ledger').doc('exceptional_restitution_void_'+r.instructionId))).data()??null;
    if(r.state==='voided'? !returned||returned.type!=='exceptional_restitution_void'||returned.reserveLedgerId!==r.reservation.ledgerId||returned.caseId!==caseId||returned.instructionId!==r.instructionId||returned.amount!==r.amountCents||returned.currency!=='CAD'||!native(returned.createdAt)||!returned.createdAt.isEqual(r.voidedAt):returned!==null)bad('exceptional_void_ledger_unknown');
   }
  }else if(!['seconde_compensation','seconde_wallet_compensation'].includes(r.funding)||r.reservation!==null)bad('exceptional_compensation_funding_unknown');
  if(r.terminalId){terminal=(await tx.get(exceptionalCaseRef(context).collection('exceptional_commands').doc(r.terminalId))).data()??null;}
  let compensation:Data|null=null;
  if(r.state==='operator_attested'&&exceptionalDebtCredit(context)){
   const credit=r.nativeWalletCredit;compensation=(await tx.get(db.collection('wallets').doc(r.ownerId).collection('ledger').doc('exceptional_compensation_'+r.instructionId))).data()??null;
   if(!credit||!cents(credit.debtOffsetCents)||!cents(credit.balanceCreditCents)||credit.debtOffsetCents+credit.balanceCreditCents!==r.amountCents||!native(credit.recordedAt)||!native(r.attestedAt)||!credit.recordedAt.isEqual(r.attestedAt)||
    !terminal?.recordedAt?.isEqual(r.attestedAt)||terminal.command?.attestation?.nativeCompensationCreditVerified!==true||terminal.command?.attestation?.transferExecutedAndReceiptVerified!==false||
    terminal.command.executionEvidence!==null||r.executionEvidenceId!==null||r.executionEvidence!==null||supportSourceHash(terminal.nativeWalletCredit)!==supportSourceHash(credit)||supportSourceHash(liability?.nativeWalletCredit)!==supportSourceHash(credit)||
    !compensation||compensation.type!=='exceptional_compensation_credit'||compensation.caseId!==caseId||compensation.instructionId!==r.instructionId||compensation.transactionId!==(context as Extract<ExceptionalContext,{kind:'refund_error'}>).transactionId||
    compensation.refundIntentId!==(context as Extract<ExceptionalContext,{kind:'refund_error'}>).refundIntentId||compensation.amount!==r.amountCents||compensation.debtOffsetCents!==credit.debtOffsetCents||compensation.balanceCreditCents!==credit.balanceCreditCents||
    !cents(compensation.balanceAfter)||!cents(compensation.sellerDebtAfter)||compensation.currency!=='CAD'||!native(compensation.createdAt)||!compensation.createdAt.isEqual(r.attestedAt))bad('exceptional_compensation_credit_native_join_unknown');
  }else if(r.state==='operator_attested'){
   const execution=r.executionEvidence?(await tx.get(byEvidence(context,r.executionEvidence.evidenceId))).data():undefined;
   if(!qualifiedProof(execution,context,'execution',r.executionEvidence)||execution!.instructionId!==r.instructionId||execution!.beneficiaryId!==r.beneficiaryId||execution!.amountCents!==r.amountCents||
    execution!.evidenceId!==r.executionEvidenceId||!hash(execution!.execution?.referenceHash)||!native(r.attestedAt)||!terminal?.recordedAt?.isEqual(r.attestedAt)||
    terminal?.command?.attestation?.transferExecutedAndReceiptVerified!==true)bad('exceptional_execution_native_join_unknown');
   else {
    reference=(await tx.get(db.collection('platform_ledger').doc('manual_bank_transfer_'+execution!.execution.referenceHash))).data()??null;
    if(!reference||reference.protocol!=='exceptional_bank_reference_v1'||reference.type!=='exceptional_manual_bank_reference'||reference.caseId!==caseId||reference.instructionId!==r.instructionId||
     reference.attestationId!==r.terminalId||reference.referenceHash!==execution!.execution.referenceHash||reference.amountCents!==r.amountCents||reference.currency!=='CAD'||!native(reference.createdAt)||!reference.createdAt.isEqual(r.attestedAt)||
     liability?.executionEvidenceHash!==execution!.contentHash||liability?.declaredExecutedDate!==execution!.execution.executedDate)bad('exceptional_bank_reference_native_join_unknown');
   }
  }
  if(r.reconciliationRequired===true)bad('exceptional_later_event_requires_reconciliation');
  return {qualified:blockers.every(code=>['exceptional_later_event_requires_reconciliation','exceptional_native_current_source_missing','exceptional_native_current_source_changed'].includes(code)),blockers,case:r,liability,reserve,returned,terminal,reference,compensation};
 }catch(error){if(error instanceof FinancialRecoveryBlocked)throw error;return {qualified:false,blockers:['exceptional_native_history_unknown'],case:raw,liability:null,reserve:null,returned:null,terminal:null,reference:null};}
}

/** Planned with all other payout reads; no write or second money movement is
 * hidden in the fence itself. The original immutable human receipt survives. */
export async function prepareExceptionalPayoutReconciliation(tx:FirebaseFirestore.Transaction,id:string,withdrawal:Data|undefined,reason:string,evidence:Data){
 const context:ExceptionalContext={kind:'withdrawal_misdirection',withdrawalRequestId:id},ref=exceptionalCaseRef(context),r=(await tx.get(ref)).data();
 if(!r&&!withdrawal?.exceptionalRestitution)return {commit:()=>{}};
 if(!r||r.protocol!==EXCEPTIONAL_RESTITUTION_CAPABILITY||r.caseId!==ref.id||r.ownerId!==withdrawal?.userId)return {commit:()=>{}};
 return {commit:()=>tx.update(ref,{status:'open',reconciliationRequired:true,reconciliationReason:reason,reconciliationEvidenceHash:supportSourceHash(evidence),updatedAt:Timestamp.now()})};
}
