/** One-use Apple authorization for an EXISTING account-erasure command.
 * No Firebase login, provider token, code or Web capability is persisted. */
import {createHash,createPrivateKey,createPublicKey,randomBytes,sign,timingSafeEqual,verify} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import type {UserRecord} from 'firebase-admin/auth';
import {HttpsError,onCall,onRequest,type Request} from 'firebase-functions/v2/https';
import type {Response as HttpResponse} from 'express';
import {auth,db} from '../config/firebase';
import {requireRuntimeProjectId} from '../config/runtimeEnvironment';
import {readFinancialRecoveryControl,withFinancialRecoveryIoBudget} from '../config/recoveryControl';
import {ACCOUNT_ERASURE_APPLE_WEB as PROTOCOL,ACCOUNT_ERASURE_APPLE_WEB_PROJECTS as PROJECTS,
  ACCOUNT_ERASURE_APPLE_WEB_PATH as PAGE,ACCOUNT_ERASURE_APPLE_WEB_CALLBACK_PATH as CALLBACK,
  type AccountErasureAppleWebStart,type AccountErasureAppleWebCapability,type AccountErasureAppleWebComplete,
  type AccountErasureAppleWebStartReceipt,type AccountErasureAppleWebConfiguration,
  type AccountErasureAppleWebAuthorizationReceipt} from '../shared/accountErasureAppleWeb';
import {erasureNativeAuth,validateAccountErasureCommand,type ErasureControl,type ErasureCallableRequest,
  type AccountErasureAppleWebCommit} from '../utils/accountErasure';
import {accountErasureId,accountErasureKeyHash,accountErasureSourceHash as hash,hasAccountErasureFence} from '../utils/accountErasureContract';
import {assertPrivateAccountSession} from '../utils/privateAccountSession';
import {prepareAccountErasureAppleWebCommit} from '../utils/accountErasureService';

type Data=FirebaseFirestore.DocumentData;
type WebConfig={projectId:string;origin:string;clientId:string;keyId:string;redirectURI:string};
type Challenge=Data&{challengeId:string;ownerId:string;createdAt:Timestamp;expiresAt:Timestamp;authSourceHash:string;
  commandId:string;commandInputHash:string;appleSubjectHash:string;capHash:string;state:string;config:WebConfig};
type Revocation={proofHash:string;revokedAt:Timestamp};
export type AppleWebRuntime={db:FirebaseFirestore.Firestore;auth:{getUser:(id:string)=>Promise<UserRecord>};
  assertSession:(request:ErasureCallableRequest,tx:FirebaseFirestore.Transaction)=>Promise<unknown>;
  control:()=>Promise<ErasureControl>;config:()=>WebConfig;
  verifyApple:(token:string,expected:{clientId:string;subject:string;nonce:string;createdAtMs:number;code?:string})=>Promise<void>;
  revokeApple:(challenge:Challenge,code:string,token:string,expected:{subject:string;nonce:string})=>Promise<Revocation>;
  prepareCommit:(tx:FirebaseFirestore.Transaction,input:AccountErasureAppleWebCommit)=>Promise<{commit:()=>void;receipt:unknown}>;
  now?:()=>number;random?:()=>string};
const TTL=5*60_000,identifier=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(v),
  digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),
  text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length>=8&&v.length<=max&&!/[\r\n\0]/.test(v),
  reject=()=>new HttpsError('permission-denied','Cette autorisation Apple n’est pas disponible.'),
  changed=()=>new HttpsError('failed-precondition','Reprenez l’autorisation Apple depuis la demande dans Second.'),
  unavailable=()=>new HttpsError('unavailable','L’autorisation Apple n’a pas pu être confirmée. Reprenez cette étape dans Second.'),
  own=(v:unknown,k:string)=>v!==null&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,k);
function shape(raw:unknown,fields:string[]):asserts raw is Record<string,unknown>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!fields.includes(k)))
    throw new HttpsError('invalid-argument','Autorisation Apple invalide.');
}
function parseCapability(raw:unknown,complete=false):AccountErasureAppleWebCapability|AccountErasureAppleWebComplete{
  shape(raw,['capability','challengeId','cap',...(complete?['code','id_token','state']:[])]);
  if(raw.capability!==PROTOCOL||!identifier(raw.challengeId)||typeof raw.cap!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(raw.cap)||
    complete&&(!text(raw.code,4096)||!text(raw.id_token,16384)||!text(raw.state,128)))throw reject();
  return raw as unknown as AccountErasureAppleWebComplete;
}
function parseStart(raw:unknown):AccountErasureAppleWebStart{
  shape(raw,['capability','purpose','expectedUid','requestId','commandId','observationKey','confirmed']);
  if(raw.capability!==PROTOCOL||raw.purpose!=='authorize_existing'||typeof raw.expectedUid!=='string'||
    !/^[A-Za-z0-9_-]{1,128}$/.test(raw.expectedUid)||!identifier(raw.requestId)||!digest(raw.commandId)||
    !digest(raw.observationKey)||raw.confirmed!==true||raw.commandId!==accountErasureId(raw.expectedUid,raw.requestId))throw reject();
  return raw as unknown as AccountErasureAppleWebStart;
}
const capHash=(id:string,cap:string)=>hash([PROTOCOL,'web_capability',id,cap]);
const nonce=(id:string,cap:string)=>hash([PROTOCOL,'nonce',id,cap]);
const state=(id:string,cap:string)=>hash([PROTOCOL,'state',id,cap]);
function capMatches(challenge:Challenge,input:AccountErasureAppleWebCapability):boolean{
  const actual=capHash(input.challengeId,input.cap);
  return digest(challenge.capHash)&&timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(challenge.capHash,'hex'));
}
export function appleWebConfig():WebConfig{
  const projectId=requireRuntimeProjectId(),q=PROJECTS[projectId as keyof typeof PROJECTS];
  if(!q||process.env.APPLE_ERASURE_WEB_CLIENT_ID!==q.clientId||process.env.APPLE_ERASURE_WEB_KEY_ID!==q.keyId||
    process.env.APPLE_ERASURE_WEB_TEAM_ID!=='B6D5JY9LKV')throw unavailable();
  return {projectId,...q,redirectURI:q.origin+CALLBACK};
}
export function createAccountErasureAppleWeb(runtime:AppleWebRuntime){
  const now=runtime.now??Date.now,random=runtime.random??(()=>randomBytes(32).toString('base64url')),
    ref=(id:string)=>runtime.db.collection('account_erasure_apple_web').doc(id),
    actorRef=(id:string)=>runtime.db.collection('account_erasure_apple_web_owners').doc(id);
  function check(challenge:Data|undefined,input:AccountErasureAppleWebCapability):asserts challenge is Challenge{
    if(!challenge||challenge.protocol!==PROTOCOL||challenge.challengeId!==input.challengeId||!capMatches(challenge as Challenge,input)||
      !(challenge.createdAt instanceof Timestamp)||!(challenge.expiresAt instanceof Timestamp)||
      challenge.createdAt.toMillis()>now()||challenge.expiresAt.toMillis()!==challenge.createdAt.toMillis()+TTL||
      challenge.expiresAt.toMillis()<=now()||hash(challenge.config)!==hash(runtime.config()))throw reject();
  }
  async function admissible(tx:FirebaseFirestore.Transaction,challenge:Challenge){
    const [commandSnap,profileSnap,actorSnap]=await Promise.all([
      tx.get(runtime.db.collection('account_erasure_commands').doc(challenge.commandId)),
      tx.get(runtime.db.collection('eligibility_profiles').doc(challenge.ownerId)),tx.get(actorRef(challenge.ownerId))]);
    const command=commandSnap.data(),profile=profileSnap.data();validateAccountErasureCommand(command,challenge.commandId);
    if(command.ownerId!==challenge.ownerId||command.inputHash!==challenge.commandInputHash||hash(command.authSource)!==challenge.authSourceHash||
      profile?.accountErasureRequest?.commandId!==challenge.commandId||hasAccountErasureFence(profile)||own(profile,'legacyDeletionFence')||
      command.fenceCommitted||command.state!=='awaiting_apple_authorization'||!['required','unknown'].includes(command.apple?.state)||
      actorSnap.data()?.challengeId!==challenge.challengeId)throw changed();
    const user=await runtime.auth.getUser(challenge.ownerId),native=erasureNativeAuth(user),
      bindings=user.providerData.filter(p=>p.providerId==='apple.com');
    if(user.disabled||bindings.length!==1||hash(bindings[0].uid)!==challenge.appleSubjectHash||hash(native)!==challenge.authSourceHash||
      hash(await runtime.control())!==hash(command.control))throw changed();
    // This checks the original native authentication and its private barrier;
    // the Web capability never becomes a Firebase token or recent-auth claim.
    await runtime.assertSession({auth:challenge.startAuth,data:{expectedUid:challenge.ownerId}},tx);
    return {subject:bindings[0].uid};
  }
  async function start(request:ErasureCallableRequest):Promise<AccountErasureAppleWebStartReceipt>{
    const input=parseStart(request.data),authTime=request.auth?.token?.auth_time,provider=request.auth?.token?.firebase?.sign_in_provider;
    if(request.auth?.uid!==input.expectedUid||!['password','google.com','apple.com'].includes(provider)||
      !Number.isSafeInteger(authTime)||authTime<1||authTime*1000>now()+60000||now()-authTime*1000>TTL)throw reject();
    const challengeId=random(),cap=random(),createdAt=Timestamp.fromMillis(now()),config=runtime.config();
    if(!identifier(challengeId)||!/^[A-Za-z0-9_-]{43}$/.test(cap))throw unavailable();
    await runtime.db.runTransaction(async tx=>{
      await runtime.assertSession(request,tx);
      const [commandSnap,profileSnap]=await Promise.all([tx.get(runtime.db.collection('account_erasure_commands').doc(input.commandId)),
        tx.get(runtime.db.collection('eligibility_profiles').doc(input.expectedUid))]);
      const command=commandSnap.data(),profile=profileSnap.data();validateAccountErasureCommand(command,input.commandId);
      const user=await runtime.auth.getUser(input.expectedUid),native=erasureNativeAuth(user),bindings=user.providerData.filter(p=>p.providerId==='apple.com');
      if(user.disabled||bindings.length!==1||command.ownerId!==input.expectedUid||command.requestId!==input.requestId||
        command.observationKeyHash!==accountErasureKeyHash(input.commandId,input.observationKey)||hash(command.authSource)!==hash(native)||
        profile?.accountErasureRequest?.commandId!==input.commandId||hasAccountErasureFence(profile)||command.fenceCommitted||
        command.state!=='awaiting_apple_authorization'||!['required','unknown'].includes(command.apple?.state)||
        hash(await runtime.control())!==hash(command.control))throw changed();
      tx.create(ref(challengeId),{protocol:PROTOCOL,challengeId,purpose:'authorize_existing',ownerId:input.expectedUid,
        requestId:input.requestId,commandId:input.commandId,commandInputHash:command.inputHash,authSourceHash:hash(native),
        appleSubjectHash:hash(bindings[0].uid),capHash:capHash(challengeId,cap),createdAt,expiresAt:Timestamp.fromMillis(createdAt.toMillis()+TTL),
        state:'prepared',config,startAuth:{uid:request.auth!.uid,token:{auth_time:authTime,firebase:{sign_in_provider:provider}}}});
      tx.set(actorRef(input.expectedUid),{protocol:PROTOCOL,challengeId,commandId:input.commandId,updatedAt:createdAt});
    });
    return {capability:PROTOCOL,challengeId,browserUrl:config.origin+PAGE+'#challengeId='+challengeId+'&cap='+cap,
      expiresAt:new Date(createdAt.toMillis()+TTL).toISOString()};
  }
  async function prepare(request:ErasureCallableRequest):Promise<AccountErasureAppleWebConfiguration>{
    const input=parseCapability(request.data),challenge=(await ref(input.challengeId).get()).data();check(challenge,input);
    if(request.auth&&request.auth.uid!==challenge.ownerId||challenge.state!=='prepared')throw reject();
    await runtime.db.runTransaction(tx=>admissible(tx,challenge));
    return {capability:PROTOCOL,challengeId:input.challengeId,expiresAt:challenge.expiresAt.toDate().toISOString(),
      apple:{clientId:challenge.config.clientId,redirectURI:challenge.config.redirectURI,state:state(input.challengeId,input.cap),
        nonce:nonce(input.challengeId,input.cap),usePopup:true}};
  }
  async function complete(request:ErasureCallableRequest):Promise<AccountErasureAppleWebAuthorizationReceipt>{
    const input=parseCapability(request.data,true) as AccountErasureAppleWebComplete,reference=ref(input.challengeId),
      initial=(await reference.get()).data();check(initial,input);
    if(request.auth&&request.auth.uid!==initial.ownerId||input.state!==state(input.challengeId,input.cap))throw reject();
    const receipt={capability:PROTOCOL,challengeId:input.challengeId,authorizationReceived:true as const};
    if(initial.state==='authorized')return receipt;
    if(initial.state!=='prepared')throw changed();
    let subject='';await runtime.db.runTransaction(async tx=>{subject=(await admissible(tx,initial)).subject;});
    const expected={subject,nonce:nonce(input.challengeId,input.cap)},authorizationSourceHash=hash({protocol:PROTOCOL,
      challengeId:initial.challengeId,commandInputHash:initial.commandInputHash,codeHash:hash(input.code),tokenHash:hash(input.id_token),stateHash:hash(input.state)});
    // Wrong Apple identities/nonce/audience/signature fail BEFORE token exchange
    // or revocation. Verification uses only Apple's fixed public JWKS endpoint.
    await runtime.verifyApple(input.id_token,{clientId:initial.config.clientId,...expected,createdAtMs:initial.createdAt.toMillis(),code:input.code});
    const attemptId=random();
    const claimed=await runtime.db.runTransaction(async tx=>{
      const live=(await tx.get(reference)).data();check(live,input);
      if(live.state==='authorized')return false;
      if(live.state!=='prepared')throw changed();
      await admissible(tx,live);
      tx.update(reference,{state:'authorizing',attemptId,authorizationSourceHash,updatedAt:Timestamp.fromMillis(now())});return true;
    });
    if(!claimed)return receipt;
    let proof:Revocation;
    try{proof=await runtime.revokeApple(initial,input.code,input.id_token,expected);}
    catch{
      await runtime.db.runTransaction(async tx=>{const live=(await tx.get(reference)).data();
        if(live?.state==='authorizing'&&live.attemptId===attemptId)tx.update(reference,{state:'authorization_unknown',updatedAt:Timestamp.fromMillis(now())});});
      throw unavailable();
    }
    if(!digest(proof.proofHash)||!(proof.revokedAt instanceof Timestamp))throw unavailable();
    await runtime.db.runTransaction(async tx=>{
      const live=(await tx.get(reference)).data();check(live,input);
      if(live.state!=='authorizing'||live.attemptId!==attemptId||live.authorizationSourceHash!==authorizationSourceHash)throw changed();
      await admissible(tx,live);
      const prepared=await runtime.prepareCommit(tx,{commandId:live.commandId,ownerId:live.ownerId,commandInputHash:live.commandInputHash,
        authSourceHash:live.authSourceHash,challengeId:live.challengeId,authorizationSourceHash,revocationProofHash:proof.proofHash,revokedAt:proof.revokedAt});
      prepared.commit();tx.update(reference,{state:'authorized',revocationProofHash:proof.proofHash,authorizedAt:proof.revokedAt,updatedAt:Timestamp.fromMillis(now())});
    });return receipt;
  }
  return {start,prepare,complete};
}

let jwks:{expires:number;keys:Record<string,any>[]} | undefined;
async function publicAppleKeys(){
  if(jwks&&jwks.expires>Date.now())return jwks.keys;
  const r=await fetch('https://appleid.apple.com/auth/keys',{redirect:'error',signal:AbortSignal.timeout(10000)}),body=await boundedJson(r);
  if(r.status!==200||!Array.isArray(body.keys)||body.keys.length<1||body.keys.length>10)throw unavailable();
  jwks={expires:Date.now()+300_000,keys:body.keys};return jwks.keys;
}
async function boundedJson(response:Response):Promise<Record<string,any>>{
  const body=await response.text();if(body.length>65536)throw unavailable();
  try{const parsed=JSON.parse(body);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw unavailable();return parsed;}
  catch{throw unavailable();}
}
export async function verifyAppleWebIdentity(token:string,expected:{clientId:string;subject:string;nonce:string;createdAtMs:number;code?:string},
  keys?:Record<string,any>[],at=Date.now()):Promise<void>{
  if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||token.length>16384)throw reject();
  const parts=token.split('.');let head:Data,claims:Data;
  try{head=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}
  catch{throw reject();}
  if(!head||head.alg!=='RS256'||typeof head.kid!=='string'||head.kid.length>128||head.crit!=null||!claims||
    claims.iss!=='https://appleid.apple.com'||claims.aud!==expected.clientId||claims.sub!==expected.subject||claims.nonce!==expected.nonce||
    !Number.isSafeInteger(claims.exp)||claims.exp*1000<=at||!Number.isSafeInteger(claims.iat)||claims.iat*1000>at+60000||
    claims.iat*1000<expected.createdAtMs-1000||at-claims.iat*1000>TTL||
    own(claims,'nbf')&&(!Number.isSafeInteger(claims.nbf)||claims.nbf*1000>at+60000))throw reject();
  if(expected.code){const codeHash=createHash('sha256').update(expected.code).digest().subarray(0,16).toString('base64url');
    if(claims.c_hash!==codeHash)throw reject();}
  const candidates=(keys??await publicAppleKeys()).filter(k=>k.kid===head.kid&&k.kty==='RSA'&&k.alg==='RS256'&&k.use==='sig');
  if(candidates.length!==1)throw reject();
  try{if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:candidates[0],format:'jwk'}),Buffer.from(parts[2],'base64url')))throw reject();}
  catch{throw reject();}
}
export function appleWebClientSecret(config:WebConfig,key:string,at=Date.now()):string{
  const q=PROJECTS[config.projectId as keyof typeof PROJECTS];
  if(!q||q.clientId!==config.clientId||q.keyId!==config.keyId||q.origin!==config.origin||config.redirectURI!==q.origin+CALLBACK)throw unavailable();
  const privateKey=createPrivateKey(key);
  if(privateKey.asymmetricKeyType!=='ec'||privateKey.asymmetricKeyDetails?.namedCurve!=='prime256v1')throw unavailable();
  const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url'),issued=Math.floor(at/1000),
    data=encode({alg:'ES256',kid:q.keyId})+'.'+encode({iss:'B6D5JY9LKV',iat:issued,exp:issued+300,aud:'https://appleid.apple.com',sub:q.clientId});
  return data+'.'+sign('sha256',Buffer.from(data),{key:privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
}
export async function revokeAppleWebAuthorization(challenge:Challenge,code:string,_token:string,expected:{subject:string;nonce:string}):Promise<Revocation>{
  const secret=process.env.APPLE_ERASURE_SIGNING_KEY;if(!secret)throw unavailable();
  const clientSecret=appleWebClientSecret(challenge.config,secret),post=(path:string,values:Record<string,string>)=>
    fetch('https://appleid.apple.com/auth/'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams(values),redirect:'error',signal:AbortSignal.timeout(10000)}),
    response=await post('token',{client_id:challenge.config.clientId,client_secret:clientSecret,code,grant_type:'authorization_code',redirect_uri:challenge.config.redirectURI});
  if(response.status!==200)throw unavailable();
  const tokens=await boundedJson(response);
  if(!text(tokens.id_token,16384)||!text(tokens.refresh_token,8192)||tokens.token_type!=='Bearer'||!text(tokens.access_token,8192)||
    !Number.isSafeInteger(tokens.expires_in)||tokens.expires_in<1)throw unavailable();
  await verifyAppleWebIdentity(tokens.id_token,{clientId:challenge.config.clientId,...expected,createdAtMs:challenge.createdAt.toMillis()});
  // Revoke the fresh refresh grant, never an authorization code or identity
  // token. Tokens exist only in this invocation and are never written/logged.
  const revoked=await post('revoke',{client_id:challenge.config.clientId,client_secret:clientSecret,token:tokens.refresh_token,token_type_hint:'refresh_token'});
  if(revoked.status!==200||(await revoked.text()).trim()!=='')throw unavailable();
  const revokedAt=Timestamp.now();return {revokedAt,proofHash:hash({protocol:'apple_web_revocation_verified_v1',challengeHash:hash(challenge.challengeId),
    commandInputHash:challenge.commandInputHash,clientId:challenge.config.clientId,authSourceHash:challenge.authSourceHash,
    authorizationCodeHash:hash(code),revokedGrantHash:hash(tokens.refresh_token),status:200,observedAt:revokedAt})};
}
const runtime:AppleWebRuntime={db,auth,assertSession:assertPrivateAccountSession,config:appleWebConfig,verifyApple:verifyAppleWebIdentity,
  revokeApple:revokeAppleWebAuthorization,prepareCommit:prepareAccountErasureAppleWebCommit,
  control:()=>withFinancialRecoveryIoBudget(async()=>{const q=await readFinancialRecoveryControl();
    if(q.control.mode!=='normal'||q.control.financialEnvironment!=='unconfigured'||q.control.previousEpoch!==null)throw unavailable();
    return {installationId:q.control.installationId,epoch:q.control.epoch,generation:q.generation,sourceHash:q.sha256};})};
const service=createAccountErasureAppleWeb(runtime),options={region:'northamerica-northeast1',memory:'512MiB' as const,timeoutSeconds:60};
export const startAccountErasureAppleWeb=onCall(options,request=>service.start(request));
export const prepareAccountErasureAppleWeb=onCall(options,request=>service.prepare(request));
export const completeAccountErasureAppleWeb=onCall({...options,secrets:['APPLE_ERASURE_SIGNING_KEY']},request=>service.complete(request));

/** Real registered HTTPS return URL. It only relays to the exact first-party
 * opener; it cannot admit an intention or exchange/revoke any provider token. */
export function handleAccountErasureAppleWebCallback(request:Request,response:HttpResponse):void{
  response.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()'});
  if(request.method!=='POST'){response.status(405).set('Allow','POST').send('Retour Apple attendu.');return;}
  if(!request.is('application/x-www-form-urlencoded')||!Buffer.isBuffer(request.rawBody)||request.rawBody.length>24576){response.status(400).send('Retour Apple invalide.');return;}
  const p=new URLSearchParams(request.rawBody.toString('utf8')),config=appleWebConfig();
  if(['code','id_token','state'].some(k=>p.getAll(k).length!==1)||!text(p.get('code'),4096)||!text(p.get('id_token'),16384)||!text(p.get('state'),128)){
    response.status(400).send('Autorisation Apple non reçue. Reprenez cette étape dans Second.');return;}
  const nonceValue=randomBytes(16).toString('base64'),safe=(v:unknown)=>JSON.stringify(v).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  response.set('Content-Security-Policy',"default-src 'none'; script-src 'nonce-"+nonceValue+"'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'");
  response.status(200).type('html').send('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Autorisation Apple</title>'+ 
    '<p>Retournez dans Second pour suivre votre demande.</p><script nonce="'+nonceValue+'">'+
    'if(window.opener){window.opener.postMessage('+safe({type:'account_erasure_apple_authorization_v1',authorization:{code:p.get('code'),id_token:p.get('id_token'),state:p.get('state')}})+','+safe(config.origin)+');window.close();}</script></html>');
}
export const accountErasureAppleWebCallback=onRequest({...options,timeoutSeconds:30},handleAccountErasureAppleWebCallback);
