/** Lifetime Connect claims live outside database restoration. Auth creation
 * metadata alone is insufficient: an independent operator must attest the
 * cutover and UID/import constraints before it can qualify a new identity. */
import {auth,db} from '../config/firebase';
import {FinancialRecoveryBlocked,createRecoveryEvidence,readFinancialRecoveryControl,readFinancialRecoveryIdentityClaim,
  readFinancialRecoveryPinnedObject,recoveryDigest,recoveryInstallation,type QualifiedRecoveryControl} from '../config/recoveryControl';
import {isFinancialRecoveryDocumentPath,recoveryManifestQualifiesSource} from '../config/recoveryControl';
import {assertFinancialRecoveryEffect,assertFinancialRecoverySource} from './financialRecoveryInterlock';
import {supportSourceHash,supportUid,supportObject,supportAdmin} from './supportRequest';
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
import {HttpsError} from 'firebase-functions/v2/https';

type Action='create'|'delete';
type Data=FirebaseFirestore.DocumentData;
interface Identity {uid:string;createdAtMs:number;hash:string}
export interface ConnectIdentityClaim {
  protocol:'financial_recovery_connect_identity_claim_v1'|'financial_recovery_connect_identity_claim_v2';installationId:string;firestoreProjectId:string;firestoreDatabaseId:string;
  financialEnvironment:'test'|'live';stripePlatformAccountId:string;epoch:string;action:Action;uid:string;
  authIdentityHash:string;authCreatedAtMs:number;commandId:string;requestHash:string;parentHash:string;accountId:string|null;
  policyHash?:string;storeHash?:string;continuityId?:string;
}
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const command=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const unavailable=(reason:string):never=>{throw new FinancialRecoveryBlocked(reason);};
function uidPath(uid:string){const path=`users/${uid}`;if(!uid||uid.length>128||!isFinancialRecoveryDocumentPath(path))unavailable('connect_identity_unqualified');return path;}
function claimPath(uid:string,action:Action){return `${recoveryInstallation().prefix}/permits/connect-identities/${recoveryDigest(uid)}/${action}.json`;}
async function identity(uid:string):Promise<Identity>{
  uidPath(uid);let value;
  try{value=await auth.getUser(uid);}catch{return unavailable('connect_auth_identity_unavailable');}
  const createdAtMs=Date.parse(value.metadata?.creationTime??'');
  if(value.uid!==uid||value.disabled||!Number.isSafeInteger(createdAtMs)||createdAtMs<1||createdAtMs>Date.now())unavailable('connect_auth_identity_unqualified');
  return {uid,createdAtMs,hash:supportSourceHash({protocol:'connect_auth_identity_v1',projectId:recoveryInstallation().firestoreProjectId,uid,createdAtMs})};
}
function context(q:QualifiedRecoveryControl):Pick<ConnectIdentityClaim,'installationId'|'firestoreProjectId'|'firestoreDatabaseId'|'financialEnvironment'|'stripePlatformAccountId'>{
  const financialEnvironment=q.control.financialEnvironment,stripePlatformAccountId=q.control.stripePlatformAccountId;
  if(financialEnvironment==='unconfigured'||!stripePlatformAccountId)throw new FinancialRecoveryBlocked('financial_provider_unconfigured');
  return {installationId:q.control.installationId,firestoreProjectId:q.control.firestoreProjectId,
  firestoreDatabaseId:q.control.firestoreDatabaseId,financialEnvironment,stripePlatformAccountId};}
async function policy(q:QualifiedRecoveryControl){
  context(q);
  const pin={object:process.env.FINANCIAL_RECOVERY_IDENTITY_POLICY_OBJECT??'',
    generation:process.env.FINANCIAL_RECOVERY_IDENTITY_POLICY_GENERATION??'',sha256:process.env.FINANCIAL_RECOVERY_IDENTITY_POLICY_SHA256??''};
  const bytes=await readFinancialRecoveryPinnedObject(pin);
  let value:Record<string,unknown>;try{value=JSON.parse(bytes.toString('utf8'));}catch{return unavailable('identity_policy_unqualified');}
  const expected={protocol:'financial_recovery_connect_identity_policy_v2',...context(q),epoch:q.control.epoch,
    legacyWritersDrained:true,allConnectCreatesUseLifetimeClaims:true,authUidReuseForbidden:true,authImportsAfterBoundaryForbidden:true,
    claimNamespace:'lifetime_installation'};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==Object.keys(expected).length+2||
    Object.entries(expected).some(([k,v])=>value[k]!==v)||!Number.isSafeInteger(value.newAuthCreatedAfterMs)||
    (value.newAuthCreatedAfterMs as number)<1||(value.newAuthCreatedAfterMs as number)>Date.now())unavailable('identity_policy_unqualified');
  const store=value.lifetimeStore as Record<string,unknown>,expectedStore={bucket:q.installation.bucket,
    prefix:`${q.installation.prefix}/permits/connect-identities`,claimProtection:'temporary_hold',
    runtimeObjectPermissions:'create_get_only_no_update_delete',holdReleaseAuthority:'independent_iam_only',
    namespaceMigration:'independently_qualified_only',historicalClaimsComplete:true,lifecycleDeletion:'prevented_by_held_objects'};
  if(!store||typeof store!=='object'||Array.isArray(store)||Object.keys(store).length!==Object.keys(expectedStore).length+3||
    Object.entries(expectedStore).some(([k,v])=>store[k]!==v)||typeof store.continuityId!=='string'||
    !/^[A-Za-z0-9_.:-]{1,180}$/.test(store.continuityId)||!Number.isSafeInteger(store.protectedSinceMs)||
    (store.protectedSinceMs as number)<1||(store.protectedSinceMs as number)>(value.newAuthCreatedAfterMs as number)||
    !Number.isSafeInteger(store.qualifiedThroughMs)||(store.qualifiedThroughMs as number)<(value.newAuthCreatedAfterMs as number)||
    (store.qualifiedThroughMs as number)>Date.now())unavailable('identity_store_continuity_unqualified');
  // This is an independent operator's historical continuity qualification.
  // Current object holds are checked separately. It cannot detect an authority
  // deliberately releasing/deleting claims in violation of that qualification.
  return {boundary:value.newAuthCreatedAfterMs as number,storeHash:supportSourceHash(store),
    continuityId:typeof store.continuityId==='string'?store.continuityId:unavailable('identity_store_continuity_unqualified'),policyHash:supportSourceHash(pin)};
}
function selected(data:Data|undefined,key:string){return data&&Object.prototype.hasOwnProperty.call(data,key)?{present:true,value:data[key]}:{present:false};}
/** Exact native parent projection for independent manifests. No local witness
 * or profile timestamp can convert an old absence into creation permission. */
export function connectIdentityParentHash(uid:string,authIdentityHash:string,action:Action,user:Data,profile:Data|undefined,accountId:string|null){
  const closure=profile?.accountClosure;
  return supportSourceHash({protocol:'connect_identity_parent_v1',uid,authIdentityHash,action,accountId,
    user:{stripeAccountId:selected(user,'stripeAccountId'),stripeAccountCreationStartedAt:selected(user,'stripeAccountCreationStartedAt')},
    profileExists:profile!==undefined,connectOperation:selected(profile,'connectOperation'),
    accountClosure:closure==null?selected(profile,'accountClosure'):{present:true,value:{schemaVersion:selected(closure,'schemaVersion'),
      ownerId:selected(closure,'ownerId'),phase:selected(closure,'phase'),requestedAt:selected(closure,'requestedAt'),
      providerDeletionStartedAt:selected(closure,'providerDeletionStartedAt'),providerAccountDeleted:selected(closure,'providerAccountDeleted'),
      authDeletedAt:selected(closure,'authDeletedAt'),cleanupStripeAccountId:selected(closure.cleanup,'stripeAccountId')}}});
}
function qualifiedClaim(value:Record<string,unknown>,uid:string,action:Action):ConnectIdentityClaim{
  const i=recoveryInstallation(),keys=['protocol','installationId','firestoreProjectId','firestoreDatabaseId','financialEnvironment','stripePlatformAccountId',
    'epoch','action','uid','authIdentityHash','authCreatedAtMs','commandId','requestHash','parentHash','accountId'];
  const v2=value.protocol==='financial_recovery_connect_identity_claim_v2';
  if(v2)keys.push('policyHash','storeHash','continuityId');
  if(Object.keys(value).length!==keys.length||!keys.every(k=>Object.prototype.hasOwnProperty.call(value,k))||
    ![ 'financial_recovery_connect_identity_claim_v1','financial_recovery_connect_identity_claim_v2'].includes(value.protocol as string)||value.uid!==uid||value.action!==action||
    value.installationId!==i.installationId||value.firestoreProjectId!==i.firestoreProjectId||value.firestoreDatabaseId!==i.firestoreDatabaseId||
    value.financialEnvironment!==i.financialEnvironment||value.stripePlatformAccountId!==i.stripePlatformAccountId||
    typeof value.epoch!=='string'||!/^[A-Za-z0-9_.:-]{1,180}$/.test(value.epoch)||!hex(value.authIdentityHash)||!hex(value.requestHash)||!hex(value.parentHash)||
    !command(value.commandId)||!Number.isSafeInteger(value.authCreatedAtMs)||(value.authCreatedAtMs as number)<1||(value.authCreatedAtMs as number)>Date.now()||
    !(value.accountId===null||typeof value.accountId==='string'&&/^acct_[A-Za-z0-9_]{1,190}$/.test(value.accountId))||
    v2&&(!hex(value.policyHash)||!hex(value.storeHash)||typeof value.continuityId!=='string'||!/^[A-Za-z0-9_.:-]{1,180}$/.test(value.continuityId)))unavailable('identity_claim_unqualified');
  return value as unknown as ConnectIdentityClaim;
}
/** Read-only unknown/recovery receipt. Its existence never grants a POST,
 * irrespective of elapsed time, claim epoch or lost Firestore markers. */
export async function readConnectIdentityClaim(uid:string,action:Action){
  uidPath(uid);const read=await readFinancialRecoveryIdentityClaim(claimPath(uid,action));
  if(!read)return null;const claim=qualifiedClaim(read.value,uid,action);
  return {claim,reference:read.sha256,temporaryHold:read.temporaryHold};
}
/** Read-only readiness for a NEW explicit form submission after a failed
 * request. Absence of a Firestore marker alone cannot clear an unknown local
 * request after restoration. Qualify the same Auth identity, lifetime policy
 * and exact parent source as creation, without reserving a claim or permit.
 * This observation never authorizes a POST: creation repeats all its guards. */
export async function readConnectCreationReadiness(uid:string,
  privateGuard?:(tx?:FirebaseFirestore.Transaction)=>Promise<unknown>):Promise<boolean>{
  uidPath(uid);
  return db.runTransaction(async tx=>{
    if(privateGuard)await privateGuard(tx);
    const user=(await tx.get(db.collection('users').doc(uid))).data();
    const profile=(await tx.get(db.collection('eligibility_profiles').doc(uid))).data();
    if(!user||user.stripeAccountId!=null||user.stripeAccountCreationStartedAt!=null||profile?.connectOperation!=null)return false;
    const currentIdentity=await identity(uid),q=await readFinancialRecoveryControl();
    if(q.control.mode!=='normal')return false;
    const qualification=await policy(q);
    if(await readConnectIdentityClaim(uid,'create'))return false;
    const parentHash=connectIdentityParentHash(uid,currentIdentity.hash,'create',user,profile,null);
    if(currentIdentity.createdAtMs<=qualification.boundary&&
      !await recoveryManifestQualifiesSource(q,uidPath(uid),parentHash))return false;
    // Bound the observation to one control generation and re-read the lifetime
    // claim before returning. Firestore retries if the native parent changes.
    const after=await readFinancialRecoveryControl();
    if(after.generation!==q.generation||after.sha256!==q.sha256||after.control.mode!=='normal'||
      after.control.epoch!==q.control.epoch||await readConnectIdentityClaim(uid,'create'))return false;
    if(privateGuard)await privateGuard(tx);
    return true;
  });
}
/** Caller supplies real snapshots read in its current transaction. The same
 * commandId/body remains stable across Firestore retries in one invocation. */
export async function reserveConnectIdentityClaim(tx:FirebaseFirestore.Transaction,uid:string,action:Action,commandId:string,requestHash:string,
  accountId:string|null=null,financialAbsenceHash?:string):Promise<ConnectIdentityClaim>{
  if(!command(commandId)||!hex(requestHash)||action==='delete'&&!hex(financialAbsenceHash)||
    !(accountId===null||/^acct_[A-Za-z0-9_]{1,190}$/.test(accountId)))unavailable('connect_claim_command_unqualified');
  const userSnapshot=await tx.get(db.collection('users').doc(uid)),profileSnapshot=await tx.get(db.collection('eligibility_profiles').doc(uid));
  const user=userSnapshot.data(),profile=profileSnapshot.data();if(!user)unavailable('connect_identity_parent_missing');
  if(action==='create'&&(user!.stripeAccountId!=null||user!.stripeAccountCreationStartedAt!=null||profile?.connectOperation!=null))unavailable('connect_existing_identity_requires_recovery');
  const currentIdentity=await identity(uid),q=await readFinancialRecoveryControl(),qualification=await policy(q);
  const parentHash=connectIdentityParentHash(uid,currentIdentity.hash,action,user!,profile,accountId);
  // Deletion always needs an independently qualified financial absence set;
  // even a new Auth identity says nothing about lost wallets/orders/holds.
  if(action==='delete')await assertFinancialRecoverySource({ref:profileSnapshot.ref.path,
    nativeSourceHash:supportSourceHash({protocol:'connect_delete_absences_v1',parentHash,financialAbsenceHash})});
  if(action==='delete'||currentIdentity.createdAtMs<=qualification.boundary)await assertFinancialRecoverySource({ref:userSnapshot.ref.path,nativeSourceHash:parentHash});
  else await assertFinancialRecoveryEffect('firestore_commit',{refs:[userSnapshot.ref.path,profileSnapshot.ref.path],sourceHash:parentHash});
  const claim:ConnectIdentityClaim={protocol:'financial_recovery_connect_identity_claim_v2',...context(q),epoch:q.control.epoch,action,uid,
    authIdentityHash:currentIdentity.hash,authCreatedAtMs:currentIdentity.createdAtMs,commandId,requestHash,parentHash,accountId,
    policyHash:qualification.policyHash,storeHash:qualification.storeHash,continuityId:qualification.continuityId};
  await createRecoveryEvidence(claimPath(uid,action),claim as unknown as Record<string,unknown>,q.installation);
  // Fresh control after reserving independently; never silently adopt epoch.
  await assertFinancialRecoveryEffect('firestore_commit',{refs:[userSnapshot.ref.path,profileSnapshot.ref.path],sourceHash:parentHash});
  return claim;
}
/** A new POST requires the exact independently reserved instruction and the
 * current Auth identity. Old claim receipts remain readable without this. */
export async function assertConnectIdentityPost(uid:string,action:Action,commandId:string,requestHash:string,accountId:string|null=null){
  const read=await readConnectIdentityClaim(uid,action);if(!read)unavailable('connect_identity_claim_missing');
  const claim=read!.claim,currentIdentity=await identity(uid),q=await readFinancialRecoveryControl(),qualification=await policy(q);
  if(claim.protocol!=='financial_recovery_connect_identity_claim_v2'||!read!.temporaryHold||
    claim.policyHash!==qualification.policyHash||claim.storeHash!==qualification.storeHash||claim.continuityId!==qualification.continuityId||
    claim.epoch!==q.control.epoch||claim.authIdentityHash!==currentIdentity.hash||claim.authCreatedAtMs!==currentIdentity.createdAtMs||
    claim.commandId!==commandId||claim.requestHash!==requestHash||claim.accountId!==accountId)unavailable('connect_identity_claim_changed');
  await assertFinancialRecoveryEffect('stripe_mutation',{refs:[uidPath(uid)],sourceHash:claim.parentHash,
    idempotencyKeys:[action==='create'?'connect_account_'+uid:'connect_delete_'+commandId]});
}

export const CONNECT_IDENTITY_RECOVERY_CAPABILITY='connect_identity_recovery_v1';
export interface ConnectIdentityRecoveryInput {
  capability:typeof CONNECT_IDENTITY_RECOVERY_CAPABILITY;expectedUid:string;mode:'read';scope:'own'|'admin';
  ownerId:string;action:'create'|'delete';recoveryReference?:string|null;
}
export interface ConnectIdentityRecoveryResponse {
  protocol:typeof CONNECT_IDENTITY_RECOVERY_CAPABILITY;actorId:string;scope:'own'|'admin';ownerId:string;action:'create'|'delete';
  state:'claim_recorded_outcome_unqualified'|'no_external_claim_observed';recoveryReference:string|null;
  claim:Pick<ConnectIdentityClaim,'commandId'|'epoch'|'action'|'accountId'|'parentHash'|'requestHash'>|null;
  newEffectAuthorized:false;sourceQualification:'independent_qualification_required';financialSettlement:'not_asserted';
  absenceProvesNoProviderEffect:false;readAt:string;
}
/** Bounded support reader, routed by the existing support endpoint. It has no
 * control mutation, claim reset, provider mutation or source-adoption branch. */
export async function handleConnectIdentityRecovery(request:any):Promise<ConnectIdentityRecoveryResponse>{
  const actorId=supportUid(request),input=supportObject(request.data,['capability','expectedUid','mode','scope','ownerId','action','recoveryReference']);
  if(input.capability!==CONNECT_IDENTITY_RECOVERY_CAPABILITY||input.mode!=='read'||!['own','admin'].includes(input.scope)||
    !['create','delete'].includes(input.action)||typeof input.ownerId!=='string'||
    input.recoveryReference!=null&&!hex(input.recoveryReference))throw new HttpsError('invalid-argument','Lecture de reprise Connect explicite requise.');
  const ownerId=input.ownerId;uidPath(ownerId);
  if(input.scope==='own'&&ownerId!==actorId)throw new HttpsError('permission-denied','Lecture personnelle requise.');
  return withPrivateAccountSession<ConnectIdentityRecoveryResponse>(request,async()=>{
    const authority=()=>db.runTransaction(async tx=>{const session=await assertPrivateAccountSession(request,tx);
      if(input.scope==='admin')await supportAdmin(tx,actorId,session.currentAdminClaim);});
    await authority();
    const read=await readConnectIdentityClaim(ownerId,input.action);
    await authority();
    if(input.recoveryReference!=null&&read?.reference!==input.recoveryReference)throw new HttpsError('failed-precondition',
      'La référence de reprise doit être vérifiée.',{reason:'connect_identity_recovery_reference_changed'});
    return {protocol:CONNECT_IDENTITY_RECOVERY_CAPABILITY,actorId,scope:input.scope,ownerId,action:input.action,
      state:read?'claim_recorded_outcome_unqualified' as const:'no_external_claim_observed' as const,
      recoveryReference:read?.reference??null,
      claim:read?{commandId:read.claim.commandId,epoch:read.claim.epoch,action:read.claim.action,accountId:read.claim.accountId,
        parentHash:read.claim.parentHash,requestHash:read.claim.requestHash}:null,
      newEffectAuthorized:false,sourceQualification:'independent_qualification_required',
      financialSettlement:'not_asserted',absenceProvesNoProviderEffect:false,readAt:new Date().toISOString()};
  });
}
