/** Native command engine. An observation key is a read capability only; every
 * effect is resumed from the original authenticated, durable owner intention. */
import {Timestamp} from 'firebase-admin/firestore';
import type {UserRecord} from 'firebase-admin/auth';
import {HttpsError} from 'firebase-functions/v2/https';
import {ACCOUNT_ERASURE_PROTOCOL,accountErasureId,accountErasureKeyHash,accountErasureKeyMatches,
  accountErasureReceipt,accountErasureSourceHash,parseAccountErasureRequest,hasAccountErasureFence,
  accountErasureRecoveryObservationId,type AccountErasureRequest,type AccountErasureRecoveryRequest,type AccountErasureReceipt} from './accountErasureContract';

type Data=FirebaseFirestore.DocumentData;
export type ErasureCallableRequest={auth?:{uid:string;token?:Record<string,any>}|null;data?:unknown;rawRequest?:{headers?:Record<string,unknown>}};
export type ErasureNativeAuth={uid:string;createdAtMs:number;providers:string[];providerBindingsHash:string;cutoffMs:number};
export type ErasureControl={installationId:string;epoch:string;generation:string;sourceHash:string};
export type ErasureInspection={state:'ready'|'awaiting_obligations'|'awaiting_review'|'more';
  reasons:string[];cursor:Data;sourceHash:string;policyVersion:string};
export type ErasureStepResult={state:'more'|'awaiting_review'|'needs_attention'|'auth_deletion_pending'|'completed';
  cursor:Data;completedSteps:number;sourceHash:string;reasons?:string[];allRequiredEffectsVerified?:true;authAbsenceVerified?:true};
export interface AccountErasureRuntime {
  db:FirebaseFirestore.Firestore;
  auth:{getUser:(uid:string)=>Promise<UserRecord>};
  assertOwner:(request:ErasureCallableRequest,tx:FirebaseFirestore.Transaction)=>Promise<unknown>;
  control:()=>Promise<ErasureControl>;
  inspect:(command:Data)=>Promise<ErasureInspection>;
  admit:(command:Data,inspection:ErasureInspection)=>Promise<'admitted'|'changed'>;
  step:(command:Data)=>Promise<ErasureStepResult>;
  authorizeApple:(command:Data,code:string,idToken:string)=>Promise<{state:'revoked'|'unknown';proofHash:string}>;
  policyVersion:string;
  now?:()=>number;
}
const conflict=()=>new HttpsError('failed-precondition','Cette demande de suppression nécessite un rapprochement.');
const denied=()=>new HttpsError('permission-denied','Ce reçu n’est pas disponible.');
const primary=new Set(['password','google.com','apple.com']);
export function erasureNativeAuth(user:UserRecord):ErasureNativeAuth {
  const createdAtMs=Date.parse(user.metadata.creationTime),cutoffMs=Date.parse(user.tokensValidAfterTime??'');
  if(!Number.isSafeInteger(createdAtMs)||createdAtMs<1||createdAtMs>Date.now()||!Number.isSafeInteger(cutoffMs)||cutoffMs<0||cutoffMs>Date.now())throw conflict();
  const bindings=user.providerData.map(p=>({providerId:p.providerId,uid:p.uid})).sort((a,b)=>a.providerId.localeCompare(b.providerId)||a.uid.localeCompare(b.uid));
  if(bindings.some(p=>!primary.has(p.providerId)||!p.uid))throw conflict();
  return {uid:user.uid,createdAtMs,providers:[...new Set(bindings.map(p=>p.providerId))].sort(),providerBindingsHash:accountErasureSourceHash(bindings),cutoffMs};
}
export function sameErasureAuth(actual:ErasureNativeAuth,expected:ErasureNativeAuth):boolean {
  return actual.uid===expected.uid&&actual.createdAtMs===expected.createdAtMs&&actual.providerBindingsHash===expected.providerBindingsHash;
}
export function validateAccountErasureCommand(command:Data|undefined,id:string):asserts command is Data {
  if(!command||command.protocol!==ACCOUNT_ERASURE_PROTOCOL||command.commandId!==id||
    command.commandId!==accountErasureId(command.ownerId,command.requestId)||
    !command.actor||command.actor.uid!==command.ownerId||!primary.has(command.actor.provider)||
    (command.actor.authority==='apple_web_challenge'?
      !Number.isSafeInteger(command.actor.verifiedAtSeconds)||command.actor.verifiedAtSeconds<1||
        !/^[a-f0-9]{64}$/.test(command.actor.authorizationSourceHash??''):
      !Number.isSafeInteger(command.actor.authTimeSeconds)||command.actor.authTimeSeconds<1)||
    !command.authSource||command.authSource.uid!==command.ownerId||
    !(command.requestedAt instanceof Timestamp)||command.requestedAt.toMillis()<1||command.requestedAt.toMillis()>Date.now()+60000||
    command.confirmed!==true||command.inputHash!==accountErasureSourceHash({protocol:ACCOUNT_ERASURE_PROTOCOL,ownerId:command.ownerId,
      requestId:command.requestId,commandId:id,intakeObservationKeyHash:command.intakeObservationKeyHash,confirmed:true,authSource:command.authSource,actor:command.actor}))throw conflict();
}
const validateCommand:(command:Data|undefined,id:string)=>asserts command is Data=validateAccountErasureCommand;
export type AccountErasureAppleWebCommit={commandId:string;ownerId:string;commandInputHash:string;authSourceHash:string;
  challengeId:string;authorizationSourceHash:string;revocationProofHash:string;revokedAt:Timestamp};
/** Internal native hook, deliberately not a callable authentication façade.
 * The Web module must read/validate its one-use challenge and real revocation
 * result in THIS transaction before calling commit alongside consumption. */
export async function prepareAccountErasureAppleWebCommit(runtime:Pick<AccountErasureRuntime,'db'|'auth'|'control'>,
  tx:FirebaseFirestore.Transaction,input:AccountErasureAppleWebCommit){
  const ref=runtime.db.collection('account_erasure_commands').doc(input.commandId),command=(await tx.get(ref)).data();
  validateCommand(command,input.commandId);
  const profile=(await tx.get(runtime.db.collection('eligibility_profiles').doc(input.ownerId))).data();
  if(command.ownerId!==input.ownerId||command.inputHash!==input.commandInputHash||
    accountErasureSourceHash(command.authSource)!==input.authSourceHash||profile?.accountErasureRequest?.commandId!==input.commandId||
    command.fenceCommitted||hasAccountErasureFence(profile)||!command.authSource.providers.includes('apple.com')||
    !/^[A-Za-z0-9_-]{16,128}$/.test(input.challengeId)||![input.authorizationSourceHash,input.revocationProofHash].every(v=>/^[a-f0-9]{64}$/.test(v))||
    !(input.revokedAt instanceof Timestamp)||input.revokedAt.toMillis()<command.requestedAt.toMillis()||input.revokedAt.toMillis()>Date.now())throw conflict();
  const native=await runtime.auth.getUser(input.ownerId),control=await runtime.control();
  if(native.disabled||!sameErasureAuth(erasureNativeAuth(native),command.authSource)||
    accountErasureSourceHash(control)!==accountErasureSourceHash(command.control))throw conflict();
  const receiptHash=accountErasureSourceHash(input);
  if(command.apple?.state==='revoked'){
    if(command.apple.webReceiptHash!==receiptHash)throw conflict();
    return {commit:()=>undefined,receipt:accountErasureReceipt(command)};
  }
  if(command.state!=='awaiting_apple_authorization'||!['required','unknown'].includes(command.apple?.state))throw conflict();
  const patch={state:'inspecting',version:command.version+1,updatedAt:Timestamp.now(),apple:{state:'revoked',
    flow:'apple_web_verified_code',proofHash:input.revocationProofHash,authorizationSourceHash:input.authorizationSourceHash,
    webChallengeHash:accountErasureSourceHash(input.challengeId),webReceiptHash:receiptHash,observedAt:input.revokedAt}};
  return {commit:()=>tx.update(ref,patch),receipt:accountErasureReceipt({...command,...patch})};
}
export type AccountErasureAppleWebRequestCommit={ownerId:string;requestId:string;commandId:string;observationKeyHash:string;
  confirmed:true;authSourceHash:string;preconfirmedIntentHash:string;preconfirmedAt:Timestamp;challengeId:string;
  authorizationSourceHash:string;revocationProofHash:string;verifiedAt:Timestamp;revokedAt:Timestamp};
export function accountErasurePreconfirmedIntentHash(input:Pick<AccountErasureAppleWebRequestCommit,
  'ownerId'|'requestId'|'commandId'|'observationKeyHash'|'authSourceHash'>):string{
  return accountErasureSourceHash({protocol:'account_erasure_apple_web_preconfirmation_v1',ownerId:input.ownerId,
    requestId:input.requestId,commandId:input.commandId,observationKeyHash:input.observationKeyHash,authSourceHash:input.authSourceHash,confirmed:true});
}
/** Native completion of ONE locally confirmed request after a fresh Apple
 * nonce/sub/code verification. It never issues a Firebase session or grants
 * recent-auth permission to any other operation. The challenge owner consumes
 * its native proof in this same transaction alongside commit(). */
export async function prepareAccountErasureAppleWebRequest(runtime:Pick<AccountErasureRuntime,'db'|'auth'|'control'|'policyVersion'>,
  tx:FirebaseFirestore.Transaction,input:AccountErasureAppleWebRequestCommit){
  if(input.confirmed!==true||input.commandId!==accountErasureId(input.ownerId,input.requestId)||
    !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)||!/^[A-Za-z0-9_-]{16,128}$/.test(input.challengeId)||
    ![input.observationKeyHash,input.authSourceHash,input.preconfirmedIntentHash,input.authorizationSourceHash,input.revocationProofHash]
      .every(v=>/^[a-f0-9]{64}$/.test(v))||input.preconfirmedIntentHash!==accountErasurePreconfirmedIntentHash(input)||
    !(input.preconfirmedAt instanceof Timestamp)||!(input.verifiedAt instanceof Timestamp)||!(input.revokedAt instanceof Timestamp)||
    input.preconfirmedAt.toMillis()<1||input.verifiedAt.toMillis()<input.preconfirmedAt.toMillis()||
    input.revokedAt.toMillis()<input.verifiedAt.toMillis()||input.revokedAt.toMillis()>Date.now()||
    Date.now()-input.preconfirmedAt.toMillis()>5*60000)throw conflict();
  const ref=runtime.db.collection('account_erasure_commands').doc(input.commandId),profileRef=runtime.db.collection('eligibility_profiles').doc(input.ownerId),
    userRef=runtime.db.collection('users').doc(input.ownerId),[priorSnap,profileSnap,user]=await Promise.all([tx.get(ref),tx.get(profileRef),tx.get(userRef)]),
    prior=priorSnap.data(),profile=profileSnap.data()??{};
  if(prior){
    validateCommand(prior,input.commandId);
    if(prior.ownerId!==input.ownerId||prior.intakeObservationKeyHash!==input.observationKeyHash||
      prior.origin?.preconfirmedIntentHash!==input.preconfirmedIntentHash)throw conflict();
    return {commit:()=>undefined,receipt:accountErasureReceipt(prior)};
  }
  if(hasAccountErasureFence(profile)||profile.accountErasureRequest!=null)throw conflict();
  const nativeRecord=await runtime.auth.getUser(input.ownerId),native=erasureNativeAuth(nativeRecord),control=await runtime.control();
  if(nativeRecord.disabled||!native.providers.includes('apple.com')||accountErasureSourceHash(native)!==input.authSourceHash)throw conflict();
  const closure=profile.accountClosure;
  if(closure!=null&&(closure.schemaVersion!==1||closure.ownerId!==input.ownerId||closure.phase!=='paused'))throw conflict();
  const at=Timestamp.now(),actor={uid:input.ownerId,provider:'apple.com',authority:'apple_web_challenge',
    verifiedAtSeconds:input.verifiedAt.seconds,authorizationSourceHash:input.authorizationSourceHash},
    identity={protocol:ACCOUNT_ERASURE_PROTOCOL,ownerId:input.ownerId,requestId:input.requestId,commandId:input.commandId,
      intakeObservationKeyHash:input.observationKeyHash,confirmed:true,authSource:native,actor};
  const command={...identity,observationKeyHash:input.observationKeyHash,inputHash:accountErasureSourceHash(identity),state:'requested',version:1,
    requestedAt:input.preconfirmedAt,updatedAt:at,completedAt:null,reviewDueAt:Timestamp.fromMillis(at.toMillis()+30*86400_000),control,
    retentionPolicyVersion:runtime.policyVersion,progress:{completedSteps:0,totalSteps:7},reasons:[],fenceCommitted:false,inspection:null,
    cursor:{phase:0,lastId:null},allRequiredEffectsVerified:false,authAbsenceVerified:false,
    origin:{kind:'verified_apple_web_preconfirmation',challengeHash:accountErasureSourceHash(input.challengeId),
      preconfirmedIntentHash:input.preconfirmedIntentHash,verifiedAt:input.verifiedAt},
    apple:{state:'revoked',flow:'apple_web_verified_code',authorizationSourceHash:input.authorizationSourceHash,
      proofHash:input.revocationProofHash,observedAt:input.revokedAt}};
  return {commit:()=>{
    tx.create(ref,command);
    if(user.exists)tx.update(userRef,{'preferences.analyticsConsent':false});
    tx.set(profileRef,{accountErasureRequest:{protocol:ACCOUNT_ERASURE_PROTOCOL,commandId:input.commandId,requestId:input.requestId,recordedAt:at},
      accountClosure:closure??{schemaVersion:1,ownerId:input.ownerId,phase:'paused',status:'paused',requestedAt:at,leaseUntilMs:0}},{merge:true});
  },receipt:accountErasureReceipt(command)};
}
export function createAccountErasureService(runtime:AccountErasureRuntime) {
  const db=runtime.db,now=runtime.now??Date.now,commandRef=(id:string)=>db.collection('account_erasure_commands').doc(id),
    profileRef=(uid:string)=>db.collection('eligibility_profiles').doc(uid);
  const update=(command:Data,patch:Data)=>({...patch,version:command.version+1,updatedAt:Timestamp.fromMillis(now())});
  async function current(id:string){const command=(await commandRef(id).get()).data();validateCommand(command,id);return command;}
  async function owner(request:ErasureCallableRequest,input:AccountErasureRequest,tx:FirebaseFirestore.Transaction){
    if(!request.auth||request.auth.uid!==input.expectedUid||accountErasureId(request.auth.uid,input.requestId)!==input.commandId)throw denied();
    const provider=request.auth.token?.firebase?.sign_in_provider,authTime=request.auth.token?.auth_time;
    if(!primary.has(provider)||!Number.isSafeInteger(authTime)||authTime<1||authTime*1000>now()+60000||now()-authTime*1000>5*60_000)
      throw new HttpsError('unauthenticated','Confirmez à nouveau votre identité.',{reason:'recent_primary_authentication_required'});
    await runtime.assertOwner(request,tx);
    const user=await runtime.auth.getUser(request.auth.uid),native=erasureNativeAuth(user);
    if(user.disabled||native.uid!==request.auth.uid||authTime*1000<native.cutoffMs||!native.providers.includes(provider))throw denied();
    return {native,actor:{uid:request.auth.uid,provider,authTimeSeconds:authTime}};
  }
  async function observe(request:ErasureCallableRequest,input:AccountErasureRequest):Promise<AccountErasureReceipt>{
    const command=(await commandRef(input.commandId).get()).data();
    if(!command||!accountErasureKeyMatches(command,input)||request.auth&&request.auth.uid!==command.ownerId)throw denied();
    validateCommand(command,input.commandId);return accountErasureReceipt(command,now());
  }
  async function requestErasure(request:ErasureCallableRequest,input:AccountErasureRequest){
    const control=await runtime.control();
    return db.runTransaction(async tx=>{
      const [oldSnap,profileSnap,userSnap]=await Promise.all([tx.get(commandRef(input.commandId)),tx.get(profileRef(input.expectedUid!)),
        tx.get(db.collection('users').doc(input.expectedUid!))]);
      const old=oldSnap.data(),profile=profileSnap.data()??{};
      if(old){
        validateCommand(old,input.commandId);
        if(request.auth?.uid!==old.ownerId||!accountErasureKeyMatches(old,input))throw denied();
        return accountErasureReceipt(old,now());
      }
      const authority=await owner(request,input,tx);
      if(hasAccountErasureFence(profile)||profile.accountErasureRequest!=null)throw new HttpsError('failed-precondition',
        'Une demande de suppression existe déjà. Reprenez son reçu.',{reason:'account_erasure_request_exists'});
      const at=Timestamp.fromMillis(now()),observationKeyHash=accountErasureKeyHash(input.commandId,input.observationKey),
        identity={protocol:ACCOUNT_ERASURE_PROTOCOL,ownerId:authority.native.uid,requestId:input.requestId,commandId:input.commandId,
          intakeObservationKeyHash:observationKeyHash,confirmed:true,authSource:authority.native,actor:authority.actor};
      const command:Data={...identity,observationKeyHash,inputHash:accountErasureSourceHash(identity),state:'requested',version:1,
        requestedAt:at,updatedAt:at,completedAt:null,reviewDueAt:Timestamp.fromMillis(now()+30*86400_000),control,retentionPolicyVersion:runtime.policyVersion,
        progress:{completedSteps:0,totalSteps:7},reasons:[],fenceCommitted:false,inspection:null,cursor:{phase:0,lastId:null},
        apple:authority.native.providers.includes('apple.com')?{state:'required'}:{state:'not_linked'},
        allRequiredEffectsVerified:false,authAbsenceVerified:false};
      const prior=profile.accountClosure;
      if(prior!=null&&(prior.schemaVersion!==1||prior.ownerId!==authority.native.uid||!['paused','purging','complete'].includes(prior.phase)))throw conflict();
      if(prior?.phase==='purging'||prior?.phase==='complete')throw conflict();
      tx.create(commandRef(input.commandId),command);
      if(userSnap.exists)tx.update(userSnap.ref,{'preferences.analyticsConsent':false});
      tx.set(profileRef(authority.native.uid),{accountErasureRequest:{protocol:ACCOUNT_ERASURE_PROTOCOL,commandId:input.commandId,requestId:input.requestId,recordedAt:at},
        accountClosure:prior??{schemaVersion:1,ownerId:authority.native.uid,phase:'paused',status:'paused',requestedAt:at,leaseUntilMs:0}}, {merge:true});
      return accountErasureReceipt(command,now());
    });
  }
  async function recoverOwner(request:ErasureCallableRequest,input:AccountErasureRecoveryRequest){
    return db.runTransaction(async tx=>{
      if(request.auth?.uid!==input.expectedUid)throw denied();
      const profile=(await tx.get(profileRef(input.expectedUid))).data(),link=profile?.accountErasureRequest;
      if(!link||link.protocol!==ACCOUNT_ERASURE_PROTOCOL||typeof link.requestId!=='string'||
        link.commandId!==accountErasureId(input.expectedUid,link.requestId))throw conflict();
      const command=(await tx.get(commandRef(link.commandId))).data();validateCommand(command,link.commandId);
      const recoveryRef=commandRef(command.commandId).collection('observation_rotations').doc(input.recoveryId),
        aliasRef=db.collection('account_erasure_observation_rotations').doc(accountErasureRecoveryObservationId(input.recoveryId,input.observationKey)),
        prior=(await tx.get(recoveryRef)).data(),alias=(await tx.get(aliasRef)).data();
      const authority=await owner(request,{...input,operation:'resume',requestId:command.requestId,commandId:command.commandId},tx);
      if(command.ownerId!==input.expectedUid||!sameErasureAuth(authority.native,command.authSource)||command.fenceCommitted||hasAccountErasureFence(profile))throw conflict();
      const nextHash=accountErasureKeyHash(command.commandId,input.observationKey);
      if(prior){
        if(prior.protocol!=='account_erasure_observation_rotation_v1'||prior.recoveryId!==input.recoveryId||
          prior.observationKeyHash!==nextHash||command.observationKeyHash!==nextHash||alias?.commandId!==command.commandId)throw conflict();
        return accountErasureReceipt(command,now());
      }
      const patch=update(command,{observationKeyHash:nextHash});
      if(alias)throw conflict();
      tx.create(recoveryRef,{protocol:'account_erasure_observation_rotation_v1',recoveryId:input.recoveryId,
        actor:authority.actor,authSourceHash:accountErasureSourceHash(authority.native),observationKeyHash:nextHash,
        priorObservationKeyHash:command.observationKeyHash,recordedAt:Timestamp.fromMillis(now()),
        destructiveAuthorityChanged:false});
      tx.update(commandRef(command.commandId),patch);
      tx.create(aliasRef,{protocol:'account_erasure_recovery_observation_v1',commandId:command.commandId,
        requestId:command.requestId,recoveryId:input.recoveryId,observationKeyHash:nextHash,recordedAt:Timestamp.fromMillis(now())});
      return accountErasureReceipt({...command,...patch},now());
    });
  }
  async function authorizeApple(request:ErasureCallableRequest,input:AccountErasureRequest){
    const admitted=await db.runTransaction(async tx=>{
      const command=(await tx.get(commandRef(input.commandId))).data();validateCommand(command,input.commandId);
      if(!accountErasureKeyMatches(command,input)||command.ownerId!==input.expectedUid)throw denied();
      const authority=await owner(request,input,tx);
      if(!sameErasureAuth(authority.native,command.authSource)||!authority.native.providers.includes('apple.com')||authority.actor.provider!=='apple.com')throw conflict();
      if(command.fenceCommitted||!['required','unknown'].includes(command.apple?.state)||command.state!=='awaiting_apple_authorization')throw conflict();
      const header=request.rawRequest?.headers?.authorization;
      if(typeof header!=='string'||!/^Bearer [^\s]+$/.test(header))throw denied();
      const codeHash=accountErasureSourceHash(input.appleAuthorizationCode),attempt={codeHash,startedAt:Timestamp.fromMillis(now()),state:'pending'};
      const previous=command.apple?.attempt;
      if(previous?.state==='pending'){
        if(!(previous.startedAt instanceof Timestamp)||authority.actor.authTimeSeconds<=previous.startedAt.seconds||previous.codeHash===codeHash)throw conflict();
        // A new primary authorization can replace an escaped UNKNOWN attempt;
        // no elapsed timeout claims the earlier provider call did not execute.
        tx.create(commandRef(command.commandId).collection('apple_attempts').doc(previous.codeHash),{
          ...previous,state:'outcome_unknown',replacedByCodeHash:codeHash,replacedByAuthTime:authority.actor.authTimeSeconds,
          recordedAt:Timestamp.fromMillis(now()),previousProviderOutcomeNotInferred:true});
      }
      tx.update(commandRef(command.commandId),update(command,{apple:{...command.apple,attempt}}));
      return {command,codeHash,idToken:header.slice(7)};
    });
    const result=await runtime.authorizeApple({...admitted.command,transientAppleFlow:input.appleAuthorizationFlow},input.appleAuthorizationCode!,admitted.idToken);
    return db.runTransaction(async tx=>{
      const command=(await tx.get(commandRef(input.commandId))).data();validateCommand(command,input.commandId);
      if(command.apple?.attempt?.codeHash!==admitted.codeHash)throw conflict();
      const patch=update(command,{apple:{state:result.state,proofHash:result.proofHash,codeHash:admitted.codeHash,observedAt:Timestamp.fromMillis(now())},
        state:result.state==='revoked'?'inspecting':'awaiting_apple_authorization'});
      tx.update(commandRef(command.commandId),patch);return accountErasureReceipt({...command,...patch},now());
    });
  }
  async function advance(id:string):Promise<AccountErasureReceipt>{
    let command=await current(id);
    if(['completed','not_executed','needs_attention'].includes(command.state))return accountErasureReceipt(command,now());
    const control=await runtime.control();
    if(control.installationId!==command.control.installationId||control.epoch!==command.control.epoch)throw conflict();
    if(!command.fenceCommitted){
      const inspection=await runtime.inspect(command);
      command=await db.runTransaction(async tx=>{
        const live=(await tx.get(commandRef(id))).data();validateCommand(live,id);
        if(live.version!==command.version)throw new HttpsError('aborted','Une autre reprise a avancé.');
        const state=inspection.state==='more'?'inspecting':inspection.state==='ready'?
          live.apple.state==='required'||live.apple.state==='unknown'?'awaiting_apple_authorization':'inspecting':inspection.state;
        const patch=update(live,{state,inspection,reasons:inspection.reasons,cursor:inspection.cursor,retentionPolicyVersion:inspection.policyVersion,
          progress:{...live.progress,completedSteps:inspection.state==='ready'?2:1}});
        tx.update(commandRef(id),patch);return {...live,...patch};
      });
      if(inspection.state!=='ready'||command.state==='awaiting_apple_authorization')return accountErasureReceipt(command,now());
      if(await runtime.admit(command,inspection)!=='admitted')return accountErasureReceipt(await current(id),now());
      command=await current(id);
    }else if(command.state==='awaiting_review'){
      // A review retry must re-enter the native execution state BEFORE its
      // first guarded write. An empty page used to hide this missing edge;
      // a nonempty page remained permanently barred by its own review state.
      command=await db.runTransaction(async tx=>{
        const live=(await tx.get(commandRef(id))).data();validateCommand(live,id);
        if(live.version!==command.version||live.state!=='awaiting_review')throw new HttpsError('aborted','Une autre reprise a avancé.');
        const profile=(await tx.get(profileRef(live.ownerId))).data(),fence=profile?.accountErasureFence;
        if(live.inputHash!==command.inputHash||live.fenceCommitted!==true||
          profile?.accountErasureRequest?.commandId!==id||fence?.protocol!=='account_erasure_fence_v1'||
          fence.ownerId!==live.ownerId||fence.commandId!==id||
          control.installationId!==live.control?.installationId||control.epoch!==live.control?.epoch||
          control.generation!==live.control?.generation||control.sourceHash!==live.control?.sourceHash)throw conflict();
        const patch=update(live,{state:'erasing'});
        tx.update(commandRef(id),patch);return {...live,...patch};
      });
    }
    const effect=await runtime.step(command);
    return db.runTransaction(async tx=>{
      const live=(await tx.get(commandRef(id))).data();validateCommand(live,id);
      if(live.version!==command.version)throw new HttpsError('aborted','Une autre reprise a avancé.');
      if(!live.fenceCommitted)throw conflict();
      if(effect.state==='completed'&&(effect.allRequiredEffectsVerified!==true||effect.authAbsenceVerified!==true))throw conflict();
      if(effect.state==='completed'){
        const profile=(await tx.get(profileRef(live.ownerId))).data();
        if(profile?.accountErasureFence?.commandId!==live.commandId)throw conflict();
      }
      const patch=update(live,{state:effect.state==='more'?'erasing':effect.state,cursor:effect.cursor,reasons:effect.reasons??[],
        progress:{...live.progress,completedSteps:effect.completedSteps},
        ...(effect.state==='completed'?{completedAt:Timestamp.fromMillis(now()),allRequiredEffectsVerified:true,authAbsenceVerified:true}:{})});
      if(effect.state==='completed')tx.update(profileRef(live.ownerId),{'accountClosure.phase':'complete','accountClosure.status':'complete'});
      tx.update(commandRef(id),patch);return accountErasureReceipt({...live,...patch},now());
    });
  }
  async function handle(request:ErasureCallableRequest){
    const input=parseAccountErasureRequest(request.data);
    if(input.operation==='observe_recovery'){
      const alias=(await db.collection('account_erasure_observation_rotations').doc(accountErasureRecoveryObservationId(input.recoveryId,input.observationKey)).get()).data();
      if(!alias||alias.protocol!=='account_erasure_recovery_observation_v1'||alias.recoveryId!==input.recoveryId)throw denied();
      return observe(request,{capability:ACCOUNT_ERASURE_PROTOCOL,mode:'delete',operation:'observe',requestId:alias.requestId,
        commandId:alias.commandId,observationKey:input.observationKey});
    }
    if(input.operation==='recover_owner')return recoverOwner(request,input);
    if(input.operation==='observe')return observe(request,input);
    if(input.operation==='request')return requestErasure(request,input);
    if(input.operation==='authorize_apple')return authorizeApple(request,input);
    // Resume only re-enqueues the owner's existing native work. An erased or
    // disabled Auth identity uses read-only observation; it gains no authority.
    const command=await current(input.commandId);
    if(request.auth?.uid!==command.ownerId||input.expectedUid!==command.ownerId||!accountErasureKeyMatches(command,input))throw denied();
    if(command.fenceCommitted)return accountErasureReceipt(command,now());
    await db.runTransaction(tx=>owner(request,input,tx));
    return advance(command.commandId);
  }
  return {handle,advance};
}
