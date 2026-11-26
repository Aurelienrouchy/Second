import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash,generateKeyPairSync,sign,verify} from 'node:crypto';
import {Timestamp} from 'firebase-admin/firestore';
import {createFirestoreMock} from '../utils/testHelpers/firestoreMock';
vi.mock('../config/firebase',()=>({db:{},auth:{}}));
vi.mock('../utils/accountErasureService',()=>({prepareAccountErasureAppleWebCommit:vi.fn()}));
import {createAccountErasureAppleWeb,verifyAppleWebIdentity,appleWebClientSecret,revokeAppleWebAuthorization,handleAccountErasureAppleWebCallback,type AppleWebRuntime} from './accountErasureAppleWeb';
import {ACCOUNT_ERASURE_APPLE_WEB as protocol} from '../shared/accountErasureAppleWeb';
import {erasureNativeAuth,prepareAccountErasureAppleWebCommit} from '../utils/accountErasure';
import {accountErasureId,accountErasureKeyHash,accountErasureSourceHash as hash} from '../utils/accountErasureContract';
const fs=createFirestoreMock({enforceReadBeforeWrite:true}),uid='synthetic-owner',requestId='request_1234567890',key='ab'.repeat(32),
  commandId=accountErasureId(uid,requestId),commandPath='account_erasure_commands/'+commandId,
  control={installationId:'installation',epoch:'initial',generation:'42',sourceHash:'a'.repeat(64)},
  config={projectId:'seconde-dev',origin:'https://seconde-dev.firebaseapp.com',clientId:'com.seconde.app.dev.auth',keyId:'4QU6688YNR',
    redirectURI:'https://seconde-dev.firebaseapp.com/account-erasure-apple/callback'},
  rsa=generateKeyPairSync('rsa',{modulusLength:2048}),jwk={...rsa.publicKey.export({format:'jwk'}),kid:'synthetic-apple-key',alg:'RS256',use:'sig'},
  ec=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
let runtime:AppleWebRuntime,service:ReturnType<typeof createAccountErasureAppleWeb>,native:any,sequence:number;
const startInput=()=>({capability:protocol,purpose:'authorize_existing' as const,expectedUid:uid,requestId,commandId,observationKey:key,confirmed:true as const});
const owner=()=>({uid,token:{auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'apple.com'}}});
const jwt=(claims:Record<string,unknown>,header:Record<string,unknown>={alg:'RS256',kid:jwk.kid})=>{
  const b=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url'),data=b(header)+'.'+b(claims);
  return data+'.'+sign('RSA-SHA256',Buffer.from(data),rsa.privateKey).toString('base64url');
};
const claims=(nonce:string,extra:Record<string,unknown>={})=>({iss:'https://appleid.apple.com',aud:config.clientId,sub:'native-apple-sub',nonce,
  iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...extra});
async function challenge(){
  const receipt=await service.start({auth:owner(),data:startInput()}),url=new URL(receipt.browserUrl),fragment=new URLSearchParams(url.hash.slice(1)),
    cap={capability:protocol,challengeId:receipt.challengeId,cap:fragment.get('cap')!},configuration=await service.prepare({data:cap});
  return {receipt,cap,configuration};
}
beforeEach(()=>{
  fs.reset();sequence=0;native={uid,disabled:false,metadata:{creationTime:new Date(Date.now()-86400000).toISOString()},tokensValidAfterTime:new Date(0).toISOString(),
    providerData:[{providerId:'apple.com',uid:'native-apple-sub'}]};
  const authSource=erasureNativeAuth(native),actor={uid,provider:'apple.com',authTimeSeconds:owner().token.auth_time},
    identity={protocol:'account_erasure_v1',ownerId:uid,requestId,commandId,intakeObservationKeyHash:accountErasureKeyHash(commandId,key),confirmed:true,authSource,actor};
  fs.setDoc(commandPath,{...identity,observationKeyHash:identity.intakeObservationKeyHash,inputHash:hash(identity),state:'awaiting_apple_authorization',version:2,
    requestedAt:Timestamp.fromMillis(Date.now()-1000),updatedAt:Timestamp.now(),completedAt:null,control,retentionPolicyVersion:'synthetic-policy',
    progress:{completedSteps:0,totalSteps:7},reasons:[],fenceCommitted:false,apple:{state:'required'}});
  fs.setDoc('eligibility_profiles/'+uid,{accountErasureRequest:{commandId}});
  runtime={db:fs.db as any,auth:{getUser:vi.fn(async()=>native)},assertSession:vi.fn(async()=>({uid})),config:()=>config,control:vi.fn(async()=>control),
    verifyApple:vi.fn(async()=>{}),revokeApple:vi.fn(async()=>({proofHash:'b'.repeat(64),revokedAt:Timestamp.now()})),
    prepareCommit:(tx,input)=>prepareAccountErasureAppleWebCommit(runtime,tx,input),random:()=>Buffer.alloc(32,++sequence).toString('base64url')};
  service=createAccountErasureAppleWeb(runtime);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('one-use authorization of an existing native erasure command',()=>{
  it('stores only the capability hash, no observation key/session token, and exposes no owner/order in public config',async()=>{
    const {receipt,cap,configuration}=await challenge(),stored=fs.getDoc('account_erasure_apple_web/'+receipt.challengeId)!;
    expect(stored.capHash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(stored)).not.toContain(cap.cap);expect(JSON.stringify(stored)).not.toContain(key);
    expect(JSON.stringify(configuration)).not.toContain(uid);expect(JSON.stringify(configuration)).not.toContain(commandId);
    expect(receipt.browserUrl).not.toContain(key);expect(configuration.apple).toMatchObject({clientId:config.clientId,redirectURI:config.redirectURI,usePopup:true});
    expect(fs.getDoc(commandPath)?.state).toBe('awaiting_apple_authorization');expect(runtime.revokeApple).not.toHaveBeenCalled();
  });
  it.each(['unauthenticated','other-owner','stale','custom','new-intent'])('refuses %s without challenge or provider effects',async kind=>{
    const data:any=startInput(),auth:any=kind==='unauthenticated'?null:owner();
    if(kind==='other-owner')auth.uid='other';if(kind==='stale')auth.token.auth_time-=301;if(kind==='custom')auth.token.firebase.sign_in_provider='custom';
    if(kind==='new-intent')data.purpose='prepare_request';
    await expect(service.start({auth,data})).rejects.toBeDefined();expect(fs.writeOps).toHaveLength(0);expect(runtime.revokeApple).not.toHaveBeenCalled();
  });
  it('checks the original key/birth/source and command state before creating a challenge',async()=>{
    await expect(service.start({auth:owner(),data:{...startInput(),observationKey:'cd'.repeat(32)}})).rejects.toBeDefined();
    native.metadata.creationTime=new Date(Date.now()-2*86400000).toISOString();
    await expect(service.start({auth:owner(),data:startInput()})).rejects.toBeDefined();expect(fs.writeOps).toHaveLength(0);
  });
  it('rejects malformed/other/expired capabilities and does not extend expiry by reading',async()=>{
    const {cap,receipt}=await challenge(),path='account_erasure_apple_web/'+receipt.challengeId;
    await expect(service.prepare({data:{...cap,cap:'z'.repeat(43)}})).rejects.toBeDefined();
    await expect(service.prepare({auth:{uid:'other'},data:cap})).rejects.toBeDefined();
    const before=fs.getDoc(path)!;runtime.now=()=>Date.parse(receipt.expiresAt);service=createAccountErasureAppleWeb(runtime);
    await expect(service.prepare({data:cap})).rejects.toBeDefined();expect(fs.getDoc(path)).toEqual(before);
  });
  it('supersedes only the ephemeral challenge and never rotates the canonical observation key',async()=>{
    const first=await challenge(),before=fs.getDoc(commandPath);await challenge();
    await expect(service.prepare({data:first.cap})).rejects.toBeDefined();expect(fs.getDoc(commandPath)).toEqual(before);
  });
  it('fails a wrong Apple identity BEFORE exchanging/revoking, without creating Auth or a new order',async()=>{
    const {cap,configuration}=await challenge(),code='synthetic-apple-code',id_token=jwt(claims(configuration.apple.nonce,{sub:'another-apple-sub',
      c_hash:createHash('sha256').update(code).digest().subarray(0,16).toString('base64url')}));
    runtime.verifyApple=(token,expected)=>verifyAppleWebIdentity(token,expected,[jwk]);
    const before=fs.getDoc(commandPath),writes=fs.writeOps.length;
    await expect(service.complete({data:{...cap,code,id_token,state:configuration.apple.state}})).rejects.toBeDefined();
    expect(runtime.revokeApple).not.toHaveBeenCalled();expect(fs.writeOps).toHaveLength(writes);expect(fs.getDoc(commandPath)).toEqual(before);
    expect(Object.keys(runtime.auth)).toEqual(['getUser']);
  });
  it('consumes the challenge and commits the SAME order only after the real provider result, then replays without another call',async()=>{
    const {cap,configuration}=await challenge(),data={...cap,code:'synthetic-code',id_token:'synthetic-token',state:configuration.apple.state};
    const receipt=await service.complete({data});expect(receipt.authorizationReceived).toBe(true);expect(receipt).not.toHaveProperty('deletionComplete');
    expect(fs.getDoc(commandPath)).toMatchObject({state:'inspecting',version:3,apple:{state:'revoked',flow:'apple_web_verified_code'}});
    expect(fs.getDoc('account_erasure_apple_web/'+cap.challengeId)?.state).toBe('authorized');
    expect(await service.complete({data})).toEqual(receipt);expect(runtime.revokeApple).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fs.getDoc(commandPath))).not.toContain('synthetic-code');
    expect(JSON.stringify(fs.getDoc('account_erasure_apple_web/'+cap.challengeId))).not.toContain('synthetic-token');
  });
  it('refuses a second completion while the first provider attempt is running',async()=>{
    const {cap,configuration}=await challenge(),data={...cap,code:'synthetic-code',id_token:'synthetic-token',state:configuration.apple.state};
    let release!:()=>void,entered!:()=>void;const pending=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
    runtime.revokeApple=vi.fn(async()=>{entered();await pending;return {proofHash:'b'.repeat(64),revokedAt:Timestamp.now()};});
    const first=service.complete({data});await started;await expect(service.complete({data})).rejects.toBeDefined();release();await first;
    expect(runtime.revokeApple).toHaveBeenCalledTimes(1);
  });
  it('keeps an unknown provider outcome non-authoritative without retrying the consumed code',async()=>{
    const {cap,configuration}=await challenge(),data={...cap,code:'synthetic-code',id_token:'synthetic-token',state:configuration.apple.state};
    runtime.revokeApple=vi.fn(async()=>{throw Error('transport lost');});await expect(service.complete({data})).rejects.toMatchObject({code:'unavailable'});
    await expect(service.complete({data})).rejects.toBeDefined();expect(runtime.revokeApple).toHaveBeenCalledTimes(1);
    expect(fs.getDoc(commandPath)?.apple.state).toBe('required');expect(fs.getDoc('account_erasure_apple_web/'+cap.challengeId)?.state).toBe('authorization_unknown');
  });
  it.each(['profile-fence','command-source','auth-birth','control-epoch'])('refuses %s changing during revocation and does not claim authorization',async kind=>{
    const {cap,configuration}=await challenge();runtime.revokeApple=vi.fn(async()=>{
      if(kind==='profile-fence')fs.setDoc('eligibility_profiles/'+uid,{accountErasureRequest:{commandId},accountErasureFence:null});
      if(kind==='command-source')fs.setDoc(commandPath,{...fs.getDoc(commandPath),inputHash:'c'.repeat(64)});
      if(kind==='auth-birth')native.metadata.creationTime=new Date(Date.now()-2*86400000).toISOString();
      if(kind==='control-epoch')runtime.control=async()=>({...control,epoch:'other'});
      return {proofHash:'b'.repeat(64),revokedAt:Timestamp.now()};});
    await expect(service.complete({data:{...cap,code:'synthetic-code',id_token:'synthetic-token',state:configuration.apple.state}})).rejects.toBeDefined();
    expect(fs.getDoc(commandPath)?.apple.state).toBe('required');expect(fs.getDoc('account_erasure_apple_web/'+cap.challengeId)?.state).not.toBe('authorized');
  });
});
describe('Apple signatures and native OAuth transport',()=>{
  it('validates the real signature and required Apple claims with a code-bound hybrid response',async()=>{
    const code='synthetic-code',nonce='nonce',expected={clientId:config.clientId,subject:'native-apple-sub',nonce,createdAtMs:Date.now()-1000,code};
    await expect(verifyAppleWebIdentity(jwt(claims(nonce,{c_hash:createHash('sha256').update(code).digest().subarray(0,16).toString('base64url')})),expected,[jwk])).resolves.toBeUndefined();
  });
  it.each(['issuer','audience','subject','nonce','expired','stale','future','code','signature','algorithm'])('rejects %s before provider exchange',async kind=>{
    const code='synthetic-code',base=claims('nonce',{c_hash:createHash('sha256').update(code).digest().subarray(0,16).toString('base64url')}),at=Date.now();
    const mutation:any=kind==='issuer'?{iss:'https://attacker.invalid'}:kind==='audience'?{aud:'com.other'}:kind==='subject'?{sub:'other'}:
      kind==='nonce'?{nonce:'other'}:kind==='expired'?{exp:Math.floor(at/1000)-1}:kind==='stale'?{iat:Math.floor(at/1000)-400}:
      kind==='future'?{iat:Math.floor(at/1000)+120}:kind==='code'?{c_hash:'other'}:{};
    let token=jwt({...base,...mutation},kind==='algorithm'?{alg:'none',kid:jwk.kid}:undefined);if(kind==='signature')token=token.slice(0,-8)+'aaaaaaaa';
    await expect(verifyAppleWebIdentity(token,{clientId:config.clientId,subject:'native-apple-sub',nonce:'nonce',createdAtMs:at-1000,code},[jwk],at)).rejects.toBeDefined();
  });
  it('signs a short ES256 developer secret with the exact environment Services ID',()=>{
    const key=ec.privateKey.export({type:'pkcs8',format:'pem'}).toString(),secret=appleWebClientSecret(config,key),parts=secret.split('.'),
      head=JSON.parse(Buffer.from(parts[0],'base64url').toString()),body=JSON.parse(Buffer.from(parts[1],'base64url').toString());
    expect(head).toEqual({alg:'ES256',kid:'4QU6688YNR'});expect(body).toMatchObject({iss:'B6D5JY9LKV',sub:config.clientId,aud:'https://appleid.apple.com'});
    expect(body.exp-body.iat).toBe(300);expect(verify('sha256',Buffer.from(parts[0]+'.'+parts[1]),{key:ec.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url'))).toBe(true);
    expect(()=>appleWebClientSecret({...config,clientId:'com.seconde.app.auth'},key)).toThrow();
  });
  it('exchanges CODE then revokes the fresh REFRESH token with no persistence or Firebase request',async()=>{
    const {cap}=await challenge(),stored=fs.getDoc('account_erasure_apple_web/'+cap.challengeId)!,nonce='synthetic-nonce',
      idToken=jwt(claims(nonce)),fetchMock=vi.fn(async(url:string,init?:RequestInit)=>{
        if(url.endsWith('/keys'))return new Response(JSON.stringify({keys:[jwk]}),{status:200});
        if(url.endsWith('/token'))return new Response(JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',id_token:idToken,token_type:'Bearer',expires_in:300}),{status:200});
        return new Response(null,{status:200});});
    vi.stubGlobal('fetch',fetchMock);vi.stubEnv('APPLE_ERASURE_SIGNING_KEY',ec.privateKey.export({type:'pkcs8',format:'pem'}).toString());
    const proof=await revokeAppleWebAuthorization(stored as any,'synthetic-code',idToken,{subject:'native-apple-sub',nonce});
    expect(proof.proofHash).toMatch(/^[a-f0-9]{64}$/);
    const posts=fetchMock.mock.calls.filter(c=>c[1]?.method==='POST');expect(posts.map(c=>c[0])).toEqual(['https://appleid.apple.com/auth/token','https://appleid.apple.com/auth/revoke']);
    const exchanged=posts[0][1]!.body as URLSearchParams,revoked=posts[1][1]!.body as URLSearchParams;
    expect(exchanged.get('grant_type')).toBe('authorization_code');expect(exchanged.get('redirect_uri')).toBe(config.redirectURI);
    expect(revoked.get('token')).toBe('synthetic-refresh');expect(revoked.get('token_type_hint')).toBe('refresh_token');
    expect(JSON.stringify(proof)).not.toContain('synthetic-refresh');expect(fs.getDoc(commandPath)?.state).toBe('awaiting_apple_authorization');
  });
});
describe('first-party POST callback relays no authority or URL credentials',()=>{
  const response=()=>{const r:any={headers:{},code:0,body:'',set:(a:any,b?:string)=>{if(typeof a==='string')r.headers[a]=b;else Object.assign(r.headers,a);return r;},
    status:(n:number)=>{r.code=n;return r;},send:(s:string)=>{r.body=s;return r;},type:()=>r};return r;};
  beforeEach(()=>{vi.stubEnv('GCLOUD_PROJECT','seconde-dev');vi.stubEnv('SECONDE_ENV','development');vi.stubEnv('SECONDE_PROJECT_ID','seconde-dev');
    vi.stubEnv('APPLE_ERASURE_WEB_CLIENT_ID',config.clientId);vi.stubEnv('APPLE_ERASURE_WEB_KEY_ID',config.keyId);vi.stubEnv('APPLE_ERASURE_WEB_TEAM_ID','B6D5JY9LKV');});
  it('serves an escaped nonce-CSP message to ONLY the exact registered opener origin without database writes',()=>{
    const rawBody=Buffer.from(new URLSearchParams({code:'synthetic-code</script><script>bad()',id_token:'synthetic-id-token',state:'synthetic-state'}).toString()),r=response();
    handleAccountErasureAppleWebCallback({method:'POST',is:()=>true,rawBody} as any,r);
    expect(r.code).toBe(200);expect(r.headers['Cache-Control']).toBe('no-store');expect(r.headers['Referrer-Policy']).toBe('no-referrer');
    expect(r.headers['Content-Security-Policy']).toContain("default-src 'none'");expect(r.headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
    expect(r.headers).not.toHaveProperty('Cross-Origin-Opener-Policy');expect(r.body).toContain(config.origin);expect(r.body).not.toContain('postMessage(*');
    expect(r.body).not.toContain('</script><script>');expect(r.body).not.toContain('location=');expect(fs.writeOps).toHaveLength(0);
  });
  it.each(['get','duplicate','oversize','wrong-type'])('refuses %s callback input without reflecting it',kind=>{
    const rawBody=Buffer.from(kind==='duplicate'?'code=synthetic-code&code=other-code&id_token=synthetic-token&state=synthetic-state':kind==='oversize'?'x'.repeat(24577):'code=synthetic-code&id_token=synthetic-token&state=synthetic-state'),r=response();
    handleAccountErasureAppleWebCallback({method:kind==='get'?'GET':'POST',is:()=>kind!=='wrong-type',rawBody} as any,r);
    expect(r.code).toBe(kind==='get'?405:400);expect(r.body).not.toContain('synthetic-code');expect(fs.writeOps).toHaveLength(0);
  });
});
