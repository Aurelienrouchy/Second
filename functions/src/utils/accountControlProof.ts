/** Two primary Firebase sessions consenting to keep A / pause B.
 * A control proof is neither an identity finding nor access to the other UID.
 * Only the existing owner closure transaction may execute the pause. */
import {randomBytes} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {auth, db, FieldValue} from '../config/firebase';
import {assertPrivateAccountSession, withPrivateAccountSession} from './privateAccountSession';
import {assertRecentAccountAuthentication, assertAccountSecurityOpen} from './eligibility';
import {assertStoredAccountSecuritySession} from './storedAccountSecuritySession';
import {supportObject, supportHash, supportSourceHash} from './supportRequest';
import {prepareOperationalNotices} from './notifications';

export const ACCOUNT_CONTROL_PROOF_CAPABILITY = 'account_control_proof_v1';
const STATEMENT_VERSION = 'account_control_keep_and_pause_v1';
const STATEMENT = 'Je confirme contrôler ce compte Firebase. Je souhaite conserver le premier compte et mettre le second en pause, sans fusion, transfert de fonds ou de contrats, ni accès aux données de l’autre compte. Les obligations du compte mis en pause restent accessibles avec sa propre connexion.';
const effects = {samePhysicalIdentityVerified:false, fraudEstablished:false, accountsMerged:false,
  fundsMoved:false, otherAccountDataAccessGranted:false, restrictionsLifted:false} as const;
type Data = FirebaseFirestore.DocumentData;
type Primary = {uid:string;authTime:number;providerId:string;providerUidHash:string};
type Base = {supportRequestId:string;statementVersion:typeof STATEMENT_VERSION;accepted:true};
type Prepare = Base & {action:'prepare';expectedCaseVersion:number;declaredOtherUid:string};
type Linked = Base & {action:'consent_second'|'pause'|'finalize_pause';proofId:string;sourceHash:string;
  invitationCode?:string;pauseRequestId?:string};
type Command = Prepare | Linked;
type Envelope = {uid:string;requestId:string;command:Command;inputHash:string;receiptId:string};
type ReceiptIdentity = Pick<Envelope,'uid'|'requestId'|'inputHash'|'receiptId'>;
type PausePlan = {replayed:true;commit:(closure:any,at:FirebaseFirestore.FieldValue)=>void} |
  {replayed:false;link:Data;commit:(closure:any,at:FirebaseFirestore.FieldValue)=>void};
const owns = (v:any,k:string) => Object.prototype.hasOwnProperty.call(v??{},k);
const unavailable = ():never => {throw new HttpsError('failed-precondition','Cette invitation ou cette étape n’est pas disponible.');};
const validId = (v:unknown):v is string => typeof v==='string'&&v.length>0&&v.length<=128&&!v.includes('/')&&v!=='.'&&v!=='..'&&!/^__.*__$/.test(v);
function exactId(v:unknown,label='Identifiant'):string {
  if(!validId(v))
    throw new HttpsError('invalid-argument',label+' invalide.');
  return v;
}
function rid(v:unknown) {const id=exactId(v,'Identifiant de commande');if(id.length<16||id!==id.trim())throw new HttpsError('invalid-argument','Identifiant de commande stable requis.');return id;}
const digest = (v:any):v is string => typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const code = (v:any):v is string => typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
const native = (v:any):v is Timestamp => v instanceof Timestamp&&v.toMillis()>0&&v.toMillis()<=Date.now();
const ticketRef = (id:string) => db.collection('support_requests').doc(id);
const proofRef = (sid:string,id:string) => ticketRef(sid).collection('account_control').doc(id);
const receiptRef = (sid:string,id:string) => ticketRef(sid).collection('account_control_commands').doc(id);
const consentRef = (sid:string,id:string,party:'A'|'B') => proofRef(sid,id).collection('consents').doc(party);
function command(raw:unknown):Command {
  const c=supportObject(raw,['action','supportRequestId','expectedCaseVersion','declaredOtherUid','proofId','sourceHash','invitationCode','pauseRequestId','statementVersion','accepted']);
  if(c.statementVersion!==STATEMENT_VERSION||c.accepted!==true)throw new HttpsError('invalid-argument','Consentement explicite actuel requis.');
  const base:Base={supportRequestId:exactId(c.supportRequestId),statementVersion:STATEMENT_VERSION,accepted:true};
  if(c.action==='prepare') {
    if(!Number.isSafeInteger(c.expectedCaseVersion)||c.expectedCaseVersion<1||['proofId','sourceHash','invitationCode','pauseRequestId'].some(k=>owns(c,k)))throw new HttpsError('invalid-argument','Source de dossier exacte requise.');
    return {...base,action:'prepare',expectedCaseVersion:c.expectedCaseVersion,declaredOtherUid:exactId(c.declaredOtherUid,'Compte déclaré')};
  }
  if(!['consent_second','pause','finalize_pause'].includes(c.action)||!/^acp_[a-f0-9]{64}$/.test(c.proofId??'')||!digest(c.sourceHash)||
    owns(c,'expectedCaseVersion')||owns(c,'declaredOtherUid')||c.action==='consent_second'&&(!code(c.invitationCode)||owns(c,'pauseRequestId'))||
    c.action==='pause'&&(owns(c,'invitationCode')||owns(c,'pauseRequestId'))||c.action==='finalize_pause'&&owns(c,'invitationCode'))
    throw new HttpsError('invalid-argument','Étape et référence exactes requises.');
  return {...base,action:c.action,proofId:c.proofId,sourceHash:c.sourceHash,
    ...(c.action==='consent_second'?{invitationCode:c.invitationCode}:{}),
    ...(c.action==='finalize_pause'?{pauseRequestId:rid(c.pauseRequestId)}:{})};
}
function envelope(request:any,raw=request.data):Envelope {
  const d=supportObject(raw,['capability','expectedUid','mode','requestId','command']);
  const uid=exactId(request.auth?.uid,'Compte connecté');
  if(d.capability!==ACCOUNT_CONTROL_PROOF_CAPABILITY||d.expectedUid!==uid)throw new HttpsError('unauthenticated','Session propriétaire requise.');
  const requestId=rid(d.requestId),c=command(d.command);
  return {uid,requestId,command:c,inputHash:supportHash([uid,requestId,c]),receiptId:'acc_'+supportHash([uid,requestId])};
}
function nativeEnvelope(r:Data):Envelope {
  const uid=exactId(r.actorUid),requestId=rid(r.requestId),c=command(r.command);
  return {uid,requestId,command:c,inputHash:supportHash([uid,requestId,c]),receiptId:'acc_'+supportHash([uid,requestId])};
}
function caseSource(id:string,t:any) {
  if(t?.schemaVersion!==1||t.kind!=='account_reconciliation'||!Number.isSafeInteger(t.version)||t.version<1||
      !['submitted','needs_information','answered'].includes(t.status)||!Array.isArray(t.relatedAccountIds)||t.relatedAccountIds.length!==1)return unavailable();
  const keepUid=exactId(t.ownerId),pauseUid=exactId(t.relatedAccountIds[0]);
  if(keepUid===pauseUid)return unavailable();
  return {supportRequestId:id,kind:'account_reconciliation',version:t.version,status:t.status,keepUid,pauseUid};
}
async function currentUser(uid:string) {
  try{return await auth.getUser(uid);}catch{throw new HttpsError('unavailable','La confirmation du compte ne peut pas être qualifiée actuellement. Réessayez la même demande.');}
}
function nativeProvider(user:any,providerId:string) {
  if(!Array.isArray(user.providerData)||['anonymous','custom'].includes(providerId))return unavailable();
  const matches=user.providerData.filter((p:any)=>p?.providerId===providerId);
  if(matches.length!==1||typeof matches[0].uid!=='string'||!matches[0].uid||matches[0].uid.length>2048)return unavailable();
  return supportHash([providerId,matches[0].uid]);
}
/** Never creates a synthetic request for the OTHER account. Its stored consent
 * is checked against fresh native Auth and the current profile read set. */
async function requalifyPrimary(tx:FirebaseFirestore.Transaction,proof:Primary,keepAccount=false) {
  const user=await currentUser(proof.uid),cutoff=typeof user.tokensValidAfterTime==='string'?Date.parse(user.tokensValidAfterTime):NaN;
  if(user.uid!==proof.uid||user.disabled||!Number.isSafeInteger(cutoff)||cutoff<0||cutoff>Date.now()||
    !Number.isSafeInteger(proof.authTime)||proof.authTime<1||proof.authTime>Math.floor(Date.now()/1000)+60||proof.authTime*1000<cutoff||
    nativeProvider(user,proof.providerId)!==proof.providerUidHash)return unavailable();
  // A matching provider and Auth cutoff do not renew an older consent. New
  // authority must also clear the native containment and restoration floors.
  await assertStoredAccountSecuritySession(tx,proof.uid,proof.authTime);
  const profile=(await tx.get(db.collection('eligibility_profiles').doc(proof.uid))).data();
  await assertAccountSecurityOpen(profile, tx, proof.uid);
  if(keepAccount&&owns(profile,'accountClosure'))return unavailable();
}
async function primary(tx:FirebaseFirestore.Transaction,request:any):Promise<Primary> {
  await assertPrivateAccountSession(request,tx);
  assertRecentAccountAuthentication(request.auth?.token??{});
  const uid=exactId(request.auth?.uid),providerId=request.auth?.token?.firebase?.sign_in_provider;
  if(typeof providerId!=='string'||!providerId||providerId.length>128)return unavailable();
  const user=await currentUser(uid);
  const p={uid,authTime:request.auth.token.auth_time as number,providerId,providerUidHash:nativeProvider(user,providerId)};
  await requalifyPrimary(tx,p);
  return p;
}
function proofQualified(p:any,sid:string,id:string) {
  if(p?.protocol!==ACCOUNT_CONTROL_PROOF_CAPABILITY||p.proofId!==id||p.supportRequestId!==sid||!code(p.invitationCode)||
    p.challengeHash!==supportHash(p.invitationCode)||p.statementVersion!==STATEMENT_VERSION||!native(p.createdAt)||
    !(p.expiresAt instanceof Timestamp)||p.expiresAt.toMillis()!==p.createdAt.toMillis()+24*60*60_000||
    p.caseSource?.supportRequestId!==sid||p.caseSource.kind!=='account_reconciliation'||p.caseSource.keepUid!==p.keepUid||p.caseSource.pauseUid!==p.pauseUid||
    !Number.isSafeInteger(p.caseSource.version)||p.caseSource.version<1||p.keepUid===p.pauseUid||
    p.sourceHash!==supportHash({caseSource:p.caseSource,proofId:id,challengeHash:p.challengeHash,statementVersion:STATEMENT_VERSION}))return unavailable();
  exactId(p.keepUid);exactId(p.pauseUid);
  return p as Data;
}
function consentQualified(c:any,p:Data,party:'A'|'B') {
  const expectedUid=party==='A'?p.keepUid:p.pauseUid;
  if(c?.protocol!=='account_control_consent_v1'||c.party!==party||c.actorUid!==expectedUid||c.proofId!==p.proofId||
    c.sourceHash!==p.sourceHash||c.statementVersion!==STATEMENT_VERSION||c.accepted!==true||c.statement!==STATEMENT||
    !native(c.recordedAt)||!digest(c.inputHash)||typeof c.requestId!=='string'||c.receiptId!=='acc_'+supportHash([expectedUid,c.requestId])||
    c.primary?.uid!==expectedUid||typeof c.primary.providerId!=='string'||
    !digest(c.primary.providerUidHash)||c.consentHash!==supportHash({actorUid:c.actorUid,party,proofId:p.proofId,sourceHash:p.sourceHash,
      statementVersion:STATEMENT_VERSION,statement:STATEMENT,accepted:true,inputHash:c.inputHash,primary:c.primary,
      requestId:c.requestId,receiptId:c.receiptId}))return unavailable();
  return c as Data;
}
async function consentCommand(tx:FirebaseFirestore.Transaction,c:Data,p:Data,party:'A'|'B') {
  const r=(await tx.get(receiptRef(p.supportRequestId,c.receiptId))).data();
  qualifyReceipt(r,{uid:c.actorUid,requestId:rid(c.requestId),inputHash:c.inputHash,receiptId:c.receiptId});
  if(r?.state!=='completed'||r.proofId!==p.proofId||r.command.supportRequestId!==p.supportRequestId||
    r.command.action!==(party==='A'?'prepare':'consent_second')||!r.recordedAt.isEqual(c.recordedAt)||
    party==='A'&&(r.command.expectedCaseVersion!==p.caseSource.version||r.command.declaredOtherUid!==p.pauseUid||
      p.proofId!=='acp_'+supportHash([p.supportRequestId,c.actorUid,c.requestId]))||
    party==='B'&&(r.command.sourceHash!==p.sourceHash||r.command.proofId!==p.proofId||r.command.invitationCode!==p.invitationCode))return unavailable();
}
async function readProof(tx:FirebaseFirestore.Transaction,sid:string,id:string) {
  const p=proofQualified((await tx.get(proofRef(sid,id))).data(),sid,id);
  const a=consentQualified((await tx.get(consentRef(sid,id,'A'))).data(),p,'A');
  const rawB=(await tx.get(consentRef(sid,id,'B'))).data();
  const b=rawB?consentQualified(rawB,p,'B'):null;
  if(p.consentAHash!==a.consentHash||owns(p,'consentBHash')&&(!b||p.consentBHash!==b.consentHash)||b&&!owns(p,'consentBHash'))return unavailable();
  await consentCommand(tx,a,p,'A');if(b)await consentCommand(tx,b,p,'B');
  return {p,a,b};
}
async function requireCurrentCase(tx:FirebaseFirestore.Transaction,p:Data) {
  const t=(await tx.get(ticketRef(p.supportRequestId))).data();
  if(supportHash(caseSource(p.supportRequestId,t))!==supportHash(p.caseSource))return unavailable();
}
function consent(p:Data,party:'A'|'B',e:Envelope,session:Primary) {
  const immutable={actorUid:e.uid,party,proofId:p.proofId,sourceHash:p.sourceHash,statementVersion:STATEMENT_VERSION,
    statement:STATEMENT,accepted:true,inputHash:e.inputHash,primary:session,requestId:e.requestId,receiptId:e.receiptId};
  return {protocol:'account_control_consent_v1',...immutable,consentHash:supportHash(immutable),recordedAt:FieldValue.serverTimestamp()};
}
function receipt(e:Envelope,state:'completed'|'not_executed',proofId:string|null,extra:Data={}) {
  return {protocol:'account_control_command_v1',actorUid:e.uid,requestId:e.requestId,inputHash:e.inputHash,
    command:e.command,receiptId:e.receiptId,state,proofId,recordedAt:FieldValue.serverTimestamp(),...extra};
}
function qualifyReceipt(r:any,e:ReceiptIdentity & {command?:Command}) {
  if(r?.protocol!=='account_control_command_v1'||r.actorUid!==e.uid||r.requestId!==e.requestId||r.inputHash!==e.inputHash||
    r.receiptId!==e.receiptId||!native(r.recordedAt)||
    !['completed','not_executed'].includes(r.state))throw new HttpsError('failed-precondition','Ce reçu ne correspond pas à cette commande.');
  if(r.command===null) {
    if(r.state!=='not_executed'||r.descriptorOnly!==true||!['prepare','consent_second','pause','finalize_pause'].includes(r.action)||
      typeof r.supportRequestId!=='string')return unavailable();
  }else if(supportHash([r.actorUid,r.requestId,r.command])!==r.inputHash)return unavailable();
  if(e.command) {
    const c=e.command;
    if((r.command?.action??r.action)!==c.action||(r.command?.supportRequestId??r.supportRequestId)!==c.supportRequestId)return unavailable();
  }
  return r as Data;
}
function receiptView(r:Data) {
  return {id:r.receiptId,requestId:r.requestId,inputHash:r.inputHash,action:r.command?.action??r.action,state:r.state,
    recordedAt:r.recordedAt.toDate().toISOString(),receiptHash:supportSourceHash(r)};
}
function response(e:ReceiptIdentity|null,state:string,r:Data|null,view:Data|null,replayed=false,actorUid=e?.uid??'') {
  return {protocol:ACCOUNT_CONTROL_PROOF_CAPABILITY,actorUid,requestId:e?.requestId??null,inputHash:e?.inputHash??null,
    state,replayed,receipt:r?receiptView(r):null,proof:view};
}
/** No cleanup/body/bank/account data enter a control proof. */
function closureSource(c:any,uid:string) {
  if(c?.schemaVersion!==1||c.ownerId!==uid||c.phase!=='paused'||c.status!=='paused'||!native(c.requestedAt)||
    !Number.isSafeInteger(c.leaseUntilMs)||c.leaseUntilMs<0||c.leaseUntilMs>Date.now()||
    !c.cleanup||typeof c.cleanup!=='object'||Array.isArray(c.cleanup)||!Array.isArray(c.cleanup.articleIds)||
    c.cleanup.username!==null&&typeof c.cleanup.username!=='string'||c.cleanup.stripeAccountId!==null&&typeof c.cleanup.stripeAccountId!=='string')return unavailable();
  return {schemaVersion:1,ownerId:uid,phase:'paused',status:'paused',requestedAt:c.requestedAt,
    accountControlProof:owns(c,'accountControlProof')?c.accountControlProof:null};
}
function pauseQualified(r:Data,p:Data,c:any,a:Data,b:Data|null) {
  try{qualifyReceipt(r,nativeEnvelope(r));}catch{return false;}
  if(!b||r.state!=='completed'||r.command.action!=='pause'||r.actorUid!==p.pauseUid||r.proofId!==p.proofId||
    r.sourceHash!==p.sourceHash||r.command.sourceHash!==p.sourceHash||r.command.proofId!==p.proofId||r.command.supportRequestId!==p.supportRequestId||
    r.consentAHash!==a.consentHash||r.consentBHash!==b.consentHash||
    !['created_pause','observed_existing_pause'].includes(r.pauseKind)||!native(r.recordedAt)||!native(r.closureSource?.requestedAt)||
    r.pausePrimary?.uid!==p.pauseUid||!Number.isSafeInteger(r.pausePrimary.authTime)||r.pausePrimary.authTime<1||
    r.pausePrimary.authTime>r.recordedAt.seconds+60||!digest(r.pausePrimary.providerUidHash)||
    typeof r.pausePrimary.providerId!=='string'||['anonymous','custom'].includes(r.pausePrimary.providerId))return false;
  let current;try {current=closureSource(c,p.pauseUid);}catch{return false;}
  if(supportSourceHash(current)!==supportSourceHash(r.closureSource))return false;
  if(r.pauseKind==='created_pause'&&(!r.recordedAt.isEqual(r.closureSource.requestedAt)||
    supportHash(current.accountControlProof)!==supportHash({protocol:ACCOUNT_CONTROL_PROOF_CAPABILITY,supportRequestId:p.supportRequestId,
      proofId:p.proofId,receiptId:r.receiptId,requestId:r.requestId,inputHash:r.inputHash})))return false;
  return true;
}
async function view(tx:FirebaseFirestore.Transaction,p:Data,a:Data,b:Data|null,uid:string) {
  if(uid!==p.keepUid&&(uid!==p.pauseUid||!b))return unavailable();
  let current=true;try{await requireCurrentCase(tx,p);}catch(error){if(!(error instanceof HttpsError))throw error;current=false;}
  let paused=false,kind='not_recorded',pauseRequestId:string|null=null;
  if(owns(p,'pauseReceiptId')) {
    const r=(await tx.get(receiptRef(p.supportRequestId,p.pauseReceiptId))).data();
    const profile=(await tx.get(db.collection('eligibility_profiles').doc(p.pauseUid))).data();
    if(r&&typeof r.requestId==='string') {
      const e=nativeEnvelope(r);
      qualifyReceipt(r,e);paused=pauseQualified(r,p,profile?.accountClosure,a,b);pauseRequestId=r.requestId;kind=paused?r.pauseKind:'unknown';
    }else kind='unknown';
  }
  return {proofId:p.proofId,supportRequestId:p.supportRequestId,sourceHash:p.sourceHash,keepUid:p.keepUid,pauseUid:p.pauseUid,
    stage:!current?'source_changed':kind==='unknown'?'historical_unknown':p.finalized===true&&paused?'finalized':paused?'paused':b?'both_consented':'awaiting_second_consent',
    statementVersion:STATEMENT_VERSION,statement:STATEMENT,invitationCode:uid===p.keepUid&&!b&&current?p.invitationCode:null,
    expiresAt:p.expiresAt.toDate().toISOString(),pauseRequestId,pauseSourceQualification:kind,
    controlOfBothFirebaseSessionsObserved:!!b,pauseObserved:paused,inAppNoticeRecorded:p.noticesRecorded===true,...effects};
}
async function existingResponse(tx:FirebaseFirestore.Transaction,e:Envelope,r:Data) {
  qualifyReceipt(r,e);
  let v:Data|null=null;
  if(r.state==='completed'&&typeof r.proofId==='string') {
    const {p,a,b}=await readProof(tx,e.command.supportRequestId,r.proofId);
    v=await view(tx,p,a,b,e.uid);
  }
  return response(e,r.state,r,v,true);
}
async function notices(tx:FirebaseFirestore.Transaction,p:Data,stage:'consent'|'paused') {
  return prepareOperationalNotices(tx,[p.keepUid,p.pauseUid].map(userId=>({userId,eventKey:'account_control:'+p.proofId+':'+stage,
    type:'account_security',title:'Rapprochement de comptes',message:stage==='paused'
      ?'La mise en pause convenue du second compte a été enregistrée. Les comptes et leurs obligations restent séparés.'
      :'Les deux confirmations ont été enregistrées. Le second compte doit encore confirmer sa mise en pause.',
    data:{ownerId:userId,supportRequestId:p.supportRequestId,proofId:p.proofId,sourceHash:p.sourceHash}})));
}

export async function handleAccountControlProof(request:any,endpoint:'owner'|'read') {
  return withPrivateAccountSession(request,async()=>{
    const mode=request.data?.mode;
    if(endpoint==='read'&&['invitation','status'].includes(mode)) {
      const d=supportObject(request.data,['capability','expectedUid','mode','supportRequestId','proofId',...(mode==='invitation'?['invitationCode']:['sourceHash'])]);
      const uid=exactId(request.auth?.uid);
      if(d.expectedUid!==uid||d.capability!==ACCOUNT_CONTROL_PROOF_CAPABILITY)throw new HttpsError('unauthenticated','Session propriétaire requise.');
      // Invalid, foreign and guessed invitations all have one neutral response.
      if(mode==='invitation'&&(!code(d.invitationCode)||!/^acp_[a-f0-9]{64}$/.test(d.proofId??'')||!validId(d.supportRequestId)))
        return response(null,'unavailable',null,null,false,uid);
      const sid=exactId(d.supportRequestId),id=exactId(d.proofId);
      return db.runTransaction(async tx=>{
        await assertPrivateAccountSession(request,tx);
        const raw=(await tx.get(proofRef(sid,id))).data();
        if(mode==='invitation'&&(!raw||raw.pauseUid!==uid||raw.invitationCode!==d.invitationCode))return response(null,'unavailable',null,null,false,uid);
        if(mode==='invitation')await primary(tx,request);
        const {p,a,b}=await readProof(tx,sid,id);
        if(mode==='invitation') {
          await requireCurrentCase(tx,p);
          if(!b&&p.expiresAt.toMillis()<=Date.now())return response(null,'unavailable',null,null,false,uid);
          await requalifyPrimary(tx,a.primary,true);
          // B gets the invitation intent only, never the support record or A's Auth facts.
          const v={proofId:p.proofId,supportRequestId:sid,sourceHash:p.sourceHash,keepUid:p.keepUid,pauseUid:p.pauseUid,
            stage:b?'both_consented':'awaiting_second_consent',statementVersion:STATEMENT_VERSION,statement:STATEMENT,
            invitationCode:null,expiresAt:p.expiresAt.toDate().toISOString(),pauseRequestId:null,pauseSourceQualification:'not_recorded',
            controlOfBothFirebaseSessionsObserved:!!b,pauseObserved:false,inAppNoticeRecorded:p.noticesRecorded===true,...effects};
          return response(null,'available',null,v,false,uid);
        }
        if(!digest(d.sourceHash)||d.sourceHash!==p.sourceHash)return unavailable();
        return response(null,'available',null,await view(tx,p,a,b,uid),false,uid);
      });
    }
    if(!['execute','observe','neutralize'].includes(mode)||endpoint==='read'&&mode!=='observe')throw new HttpsError('invalid-argument','Lecture ou commande de contrôle invalide.');
    if(owns(request.data,'descriptor')) {
      const d=supportObject(request.data,['capability','expectedUid','mode','requestId','descriptor']);
      const x=supportObject(d.descriptor,['supportRequestId','action','inputHash']),uid=exactId(request.auth?.uid),requestId=rid(d.requestId);
      if(mode==='execute'||d.expectedUid!==uid||d.capability!==ACCOUNT_CONTROL_PROOF_CAPABILITY||!digest(x.inputHash)||
        !['prepare','consent_second','pause','finalize_pause'].includes(x.action))throw new HttpsError('invalid-argument','Descripteur de reçu propriétaire invalide.');
      const sid=exactId(x.supportRequestId),e={uid,requestId,inputHash:x.inputHash,receiptId:'acc_'+supportHash([uid,requestId])};
      await db.runTransaction(async tx=>{
        await assertPrivateAccountSession(request,tx);
        const ref=receiptRef(sid,e.receiptId),r=(await tx.get(ref)).data();
        if(r) {
          qualifyReceipt(r,e);
          if((r.command?.action??r.action)!==x.action||(r.command?.supportRequestId??r.supportRequestId)!==sid)return unavailable();
          return;
        }
        if(mode==='neutralize')tx.create(ref,{protocol:'account_control_command_v1',actorUid:uid,requestId,inputHash:e.inputHash,
          receiptId:e.receiptId,command:null,descriptorOnly:true,action:x.action,supportRequestId:sid,state:'not_executed',proofId:null,
          recordedAt:FieldValue.serverTimestamp()});
      });
      return db.runTransaction(async tx=>{
        await assertPrivateAccountSession(request,tx);
        const r=(await tx.get(receiptRef(sid,e.receiptId))).data();
        if(!r)return response(e,'unrecorded',null,null);
        qualifyReceipt(r,e);
        if(r.command!==null)return existingResponse(tx,envelope(request,{capability:ACCOUNT_CONTROL_PROOF_CAPABILITY,
          expectedUid:uid,mode:'observe',requestId,command:r.command}),r);
        return response(e,r.state,r,null,true);
      });
    }
    const e=envelope(request),c=e.command;
    if(c.action==='pause'&&mode==='execute')throw new HttpsError('failed-precondition','Utilisez la mise en pause du compte connecté.');
    await db.runTransaction(async tx=>{
      await assertPrivateAccountSession(request,tx);
      const ref=receiptRef(c.supportRequestId,e.receiptId),prior=(await tx.get(ref)).data();
      if(prior){qualifyReceipt(prior,e);return;}
      if(mode==='observe')return;
      if(mode==='neutralize'){tx.create(ref,receipt(e,'not_executed',null));return;}
      const session=await primary(tx,request);
      if(c.action==='prepare') {
        const source=caseSource(c.supportRequestId,(await tx.get(ticketRef(c.supportRequestId))).data());
        if(source.keepUid!==e.uid||source.pauseUid!==c.declaredOtherUid||source.version!==c.expectedCaseVersion)return unavailable();
        const id='acp_'+supportHash([c.supportRequestId,e.uid,e.requestId]),pRef=proofRef(c.supportRequestId,id);
        if((await tx.get(pRef)).exists)return unavailable();
        const invitationCode=randomBytes(16).toString('hex'),createdAt=Timestamp.now(),challengeHash=supportHash(invitationCode);
        const p={protocol:ACCOUNT_CONTROL_PROOF_CAPABILITY,proofId:id,supportRequestId:c.supportRequestId,caseSource:source,
          keepUid:source.keepUid,pauseUid:source.pauseUid,challengeHash,invitationCode,statementVersion:STATEMENT_VERSION,createdAt,
          expiresAt:Timestamp.fromMillis(createdAt.toMillis()+24*60*60_000),
          sourceHash:supportHash({caseSource:source,proofId:id,challengeHash,statementVersion:STATEMENT_VERSION})};
        const a=consent(p,'A',e,session);
        await primary(tx,request);await requalifyPrimary(tx,session,true);
        tx.create(pRef,{...p,consentAHash:a.consentHash});tx.create(consentRef(c.supportRequestId,id,'A'),a);
        tx.create(ref,receipt(e,'completed',id));return;
      }
      const {p,a,b}=await readProof(tx,c.supportRequestId,c.proofId);
      if(e.uid!==p.pauseUid||c.sourceHash!==p.sourceHash)return unavailable();
      await requireCurrentCase(tx,p);await requalifyPrimary(tx,a.primary,true);
      if(c.action==='consent_second') {
        if(c.invitationCode!==p.invitationCode||b||p.expiresAt.toMillis()<=Date.now())return unavailable();
        const second=consent(p,'B',e,session),notice=await notices(tx,p,'consent');
        await primary(tx,request);await requalifyPrimary(tx,session);await requalifyPrimary(tx,a.primary,true);
        tx.create(consentRef(c.supportRequestId,c.proofId,'B'),second);tx.update(proofRef(c.supportRequestId,c.proofId),{consentBHash:second.consentHash,noticesRecorded:true});
        tx.create(ref,receipt(e,'completed',c.proofId));notice.commit();return;
      }
      if(!b||c.action!=='finalize_pause')return unavailable();
      await requalifyPrimary(tx,b.primary);
      if(!p.pauseReceiptId)return unavailable();
      const pause=(await tx.get(receiptRef(c.supportRequestId,p.pauseReceiptId))).data(),profile=(await tx.get(db.collection('eligibility_profiles').doc(e.uid))).data();
      if(!pause||pause.requestId!==c.pauseRequestId||!pauseQualified(pause,p,profile?.accountClosure,a,b))return unavailable();
      await primary(tx,request);await requalifyPrimary(tx,a.primary,true);
      tx.create(ref,receipt(e,'completed',c.proofId,{pauseReceiptId:p.pauseReceiptId,pauseReceiptHash:supportSourceHash(pause)}));
      tx.update(proofRef(c.supportRequestId,c.proofId),{finalized:true});
    });
    return db.runTransaction(async tx=>{
      await assertPrivateAccountSession(request,tx);
      const r=(await tx.get(receiptRef(c.supportRequestId,e.receiptId))).data();
      return r?existingResponse(tx,e,r):response(e,'unrecorded',null,null);
    });
  });
}

/** Narrow hook for the EXISTING users.pause transaction. All reads, including
 * notices and both current primary sources, precede the caller's first write. */
export async function prepareAccountControlPause(tx:FirebaseFirestore.Transaction,request:any,priorClosure:any):Promise<PausePlan|null> {
  const raw=request.data?.accountControlProof;
  if(raw===undefined)return null;
  if(request.data?.mode!=='pause')throw new HttpsError('invalid-argument','La preuve ne peut servir qu’à une mise en pause.');
  const d=supportObject(raw,['capability','requestId','command']);
  const e=envelope(request,{...d,expectedUid:request.data.expectedUid,mode:'execute'}),c=e.command;
  if(c.action!=='pause')throw new HttpsError('invalid-argument','Commande de pause exacte requise.');
  await assertPrivateAccountSession(request,tx);
  const ref=receiptRef(c.supportRequestId,e.receiptId),prior=(await tx.get(ref)).data();
  if(prior){qualifyReceipt(prior,e);return {replayed:true,commit:(_closure:any,_at:any)=>undefined};}
  const pausePrimary=await primary(tx,request);
  const {p,a,b}=await readProof(tx,c.supportRequestId,c.proofId);
  if(e.uid!==p.pauseUid||c.sourceHash!==p.sourceHash||!b||p.pauseReceiptId)return unavailable();
  await requireCurrentCase(tx,p);await requalifyPrimary(tx,a.primary,true);await requalifyPrimary(tx,b.primary);
  // Existing closures are observed explicitly; advanced/malformed phases never
  // acquire a false new pause receipt or get replaced by a fresh closure.
  const existing=priorClosure==null?null:closureSource(priorClosure,e.uid);
  const notice=await notices(tx,p,'paused');
  await primary(tx,request);await requalifyPrimary(tx,pausePrimary);await requalifyPrimary(tx,a.primary,true);
  const link={protocol:ACCOUNT_CONTROL_PROOF_CAPABILITY,supportRequestId:c.supportRequestId,proofId:c.proofId,
    receiptId:e.receiptId,requestId:e.requestId,inputHash:e.inputHash};
  return {replayed:false,link,commit:(closure:any,at:FirebaseFirestore.FieldValue)=>{
    const source=existing??{schemaVersion:1,ownerId:e.uid,phase:'paused',status:'paused',requestedAt:at,accountControlProof:link};
    // The caller supplies its SAME serverTimestamp transform. No precommit
    // timestamp/hash is substituted for the actual Firestore commit.
    if(!existing&&closure.accountControlProof!==link)throw new Error('Pause closure causal link missing');
    tx.create(ref,receipt(e,'completed',c.proofId,{recordedAt:at,sourceHash:p.sourceHash,
      consentAHash:a.consentHash,consentBHash:b.consentHash,pausePrimary,pauseKind:existing?'observed_existing_pause':'created_pause',closureSource:source}));
    tx.update(proofRef(c.supportRequestId,c.proofId),{pauseReceiptId:e.receiptId,noticesRecorded:true});notice.commit();
  }};
}

export async function readAccountControlPause(request:any) {
  const raw=request.data?.accountControlProof;if(raw===undefined)return null;
  const e=envelope(request,{...supportObject(raw,['capability','requestId','command']),expectedUid:request.data.expectedUid,mode:'observe'});
  return withPrivateAccountSession(request,()=>db.runTransaction(async tx=>{
    await assertPrivateAccountSession(request,tx);
    const r=(await tx.get(receiptRef(e.command.supportRequestId,e.receiptId))).data();
    return r?existingResponse(tx,e,r):response(e,'unrecorded',null,null);
  }));
}
