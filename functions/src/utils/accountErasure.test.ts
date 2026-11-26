import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
import {createFirestoreMock} from './testHelpers/firestoreMock';
import {createAccountErasureService,erasureNativeAuth,prepareAccountErasureAppleWebCommit,prepareAccountErasureAppleWebRequest,
  accountErasurePreconfirmedIntentHash,type AccountErasureRuntime} from './accountErasure';
import {accountErasureId,accountErasureKeyHash,parseAccountErasureRequest,accountErasureReceipt,accountErasureSourceHash} from './accountErasureContract';
const fs=createFirestoreMock({enforceReadBeforeWrite:true}),uid='owner',requestId='request_1234567890',key='ab'.repeat(32),
  commandId=accountErasureId(uid,requestId),path='account_erasure_commands/'+commandId;
let runtime:AccountErasureRuntime,user:any,service:ReturnType<typeof createAccountErasureService>;
const payload=(operation='request',extra:any={})=>({capability:'account_erasure_v1',mode:'delete',operation,requestId,commandId,observationKey:key,
  ...(operation==='observe'?{}:{expectedUid:uid}),...(operation==='request'?{confirmed:true}:{}),...extra});
const auth=()=>({uid,token:{auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'password'}}});
const call=(data:any,withAuth=true)=>service.handle({data:{...data,...(data.operation==='authorize_apple'?{appleAuthorizationFlow:'ios_native'}:{})},
  ...(withAuth?{auth:{...auth(),token:{...auth().token,firebase:{sign_in_provider:data.operation==='authorize_apple'?'apple.com':'password'}}}}:{}),
  rawRequest:{headers:{authorization:'Bearer ephemeral-id-token'}}});
beforeEach(()=>{
  fs.reset();user={uid,disabled:false,metadata:{creationTime:new Date(Date.now()-86400_000).toISOString()},
    tokensValidAfterTime:new Date(0).toISOString(),providerData:[{providerId:'password',uid:'synthetic@example.invalid'}]};
  runtime={db:fs.db as any,auth:{getUser:vi.fn(async()=>user)},assertOwner:vi.fn(async()=>({uid})),
    control:vi.fn(async()=>({installationId:'installation',epoch:'initial',generation:'1',sourceHash:'a'.repeat(64)})),
    inspect:vi.fn(async()=>({state:'ready',reasons:[],cursor:{phase:0,lastId:null},sourceHash:'b'.repeat(64),policyVersion:'policy_v1'})),
    admit:vi.fn(async command=>{fs.setDoc('eligibility_profiles/'+uid,{accountErasureFence:{commandId}});
      fs.setDoc(path,{...command,fenceCommitted:true,state:'erasing',version:command.version+1});return 'admitted';}),
    step:vi.fn(async()=>({state:'more',cursor:{phase:1,lastId:null},completedSteps:3,sourceHash:'c'.repeat(64)})),
    authorizeApple:vi.fn(async()=>({state:'revoked',proofHash:'d'.repeat(64)})),policyVersion:'policy_v1'};
  service=createAccountErasureService(runtime);
});
describe('durable account erasure command and opaque observation',()=>{
  it('persists the intention and hashed capability before a worker effect',async()=>{
    const receipt=await call(payload());expect(receipt.state).toBe('requested');
    expect(runtime.inspect).not.toHaveBeenCalled();expect(runtime.step).not.toHaveBeenCalled();
    const command=fs.getDoc(path)!;expect(command.observationKeyHash).toBe(accountErasureKeyHash(commandId,key));
    expect(JSON.stringify(command)).not.toContain(key);expect(JSON.stringify(command)).not.toContain('ephemeral-id-token');
    expect(fs.getDoc('eligibility_profiles/'+uid)?.accountClosure.phase).toBe('paused');
  });
  it('replays the same request after a lost response without a new intention or effect',async()=>{
    const first=await call(payload());await call(payload());
    expect(fs.countWrites(op=>op.path===path&&op.method==='create')).toBe(1);
    expect(await call(payload('observe'),false)).toEqual(first);expect(runtime.step).not.toHaveBeenCalled();
  });
  it('does not create another command for a second request or borrow its capability',async()=>{
    await call(payload());const next='second_1234567890';
    await expect(call(payload('request',{requestId:next,commandId:accountErasureId(uid,next)}))).rejects.toMatchObject({details:{reason:'account_erasure_request_exists'}});
    await expect(call(payload('request',{observationKey:'cd'.repeat(32)}))).rejects.toMatchObject({code:'permission-denied'});
    expect(fs.getDoc('account_erasure_commands/'+accountErasureId(uid,next))).toBeUndefined();
  });
  it('does not accept custom/stale authentication, mismatched UID or an observation instruction',async()=>{
    await expect(service.handle({data:payload(),auth:{uid,token:{auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'custom'}}}})).rejects.toMatchObject({code:'unauthenticated'});
    await expect(call(payload('request',{expectedUid:'other'}))).rejects.toMatchObject({code:'permission-denied'});
    expect(()=>parseAccountErasureRequest(payload('observe',{confirmed:true}))).toThrow();
    expect(()=>parseAccountErasureRequest(payload('request',{observationKey:'a'.repeat(43)}))).toThrow();
    expect(fs.getDoc(path)).toBeUndefined();
  });
  it('keeps observation independent of Auth after disable/delete; a wrong account cannot observe',async()=>{
    await call(payload());vi.mocked(runtime.auth.getUser).mockRejectedValue(Object.assign(new Error('absent'),{code:'auth/user-not-found'}));
    expect((await call(payload('observe'),false)).deletionComplete).toBe(false);
    await expect(service.handle({data:payload('observe'),auth:{uid:'other'}})).rejects.toMatchObject({code:'permission-denied'});
    await expect(call(payload('observe',{observationKey:'ef'.repeat(32)}),false)).rejects.toMatchObject({code:'permission-denied'});
  });
  it('resumes native work after Auth is absent without authorizing it from an observer',async()=>{
    await call(payload());await service.advance(commandId);
    vi.mocked(runtime.auth.getUser).mockRejectedValue(new Error('absent'));
    await service.advance(commandId);expect(runtime.step).toHaveBeenCalledTimes(2);
    await call(payload('observe'),false);expect(runtime.step).toHaveBeenCalledTimes(2);
    expect(fs.getDoc(path)?.state).toBe('erasing');
  });
  it('never calls an incomplete effect access closure a completed deletion',async()=>{
    await call(payload());await service.advance(commandId);
    const receipt=await call(payload('observe'),false);expect(receipt.accountAccessClosed).toBe(true);
    expect(receipt.deletionComplete).toBe(false);expect(receipt.success).toBe(false);
    vi.mocked(runtime.step).mockResolvedValue({state:'completed',cursor:{},completedSteps:7,sourceHash:'a'.repeat(64)});
    await expect(service.advance(commandId)).rejects.toThrow();expect(fs.getDoc(path)?.state).toBe('erasing');
  });
  it('requires native postconditions before completed and expires observation only after completion',async()=>{
    await call(payload());vi.mocked(runtime.step).mockResolvedValue({state:'completed',cursor:{},completedSteps:7,
      sourceHash:'a'.repeat(64),allRequiredEffectsVerified:true,authAbsenceVerified:true});
    expect((await service.advance(commandId)).deletionComplete).toBe(true);
    const command=fs.getDoc(path)!;
    expect(()=>accountErasureReceipt(command,command.completedAt.toMillis()+31*86400_000)).toThrow();
  });
  it('does not adopt a different independent installation or epoch',async()=>{
    await call(payload());vi.mocked(runtime.control).mockResolvedValue({installationId:'other',epoch:'initial',generation:'1',sourceHash:'a'.repeat(64)});
    await expect(service.advance(commandId)).rejects.toThrow();expect(runtime.step).not.toHaveBeenCalled();
  });
  it('retains a generic observer response when native inspection requires review',async()=>{
    await call(payload());vi.mocked(runtime.inspect).mockResolvedValue({state:'awaiting_review',reasons:['private_financial_source_unknown'],
      cursor:{phase:2},sourceHash:'a'.repeat(64),policyVersion:'policy_v1'});
    const receipt=await service.advance(commandId);expect(receipt.reasons).toEqual(['review_pending']);
    expect(JSON.stringify(receipt)).not.toContain('financial');expect(runtime.admit).not.toHaveBeenCalled();
  });
  it('prioritizes linked Apple even with a password primary on another platform',async()=>{
    user.providerData.push({providerId:'apple.com',uid:'apple-native-subject'});
    await call(payload());const receipt=await service.advance(commandId);
    expect(receipt.state).toBe('awaiting_apple_authorization');expect(runtime.admit).not.toHaveBeenCalled();
  });
  it('does not revoke Apple for a recreated native identity and never saves its code or ID token',async()=>{
    user.providerData.push({providerId:'apple.com',uid:'apple-native-subject'});await call(payload());await service.advance(commandId);
    user={...user,metadata:{creationTime:new Date(Date.now()-1000).toISOString()}};
    await expect(call(payload('authorize_apple',{appleAuthorizationCode:'ephemeral-apple-code'}))).rejects.toThrow();
    expect(runtime.authorizeApple).not.toHaveBeenCalled();expect(JSON.stringify(fs.getDoc(path))).not.toContain('ephemeral-apple-code');
  });
  it('records only Apple proof after qualified revocation; replay never sends code twice',async()=>{
    user.providerData.push({providerId:'apple.com',uid:'apple-native-subject'});await call(payload());await service.advance(commandId);
    await call(payload('authorize_apple',{appleAuthorizationCode:'ephemeral-apple-code'}));
    expect(runtime.authorizeApple).toHaveBeenCalledTimes(1);expect(fs.getDoc(path)?.apple.state).toBe('revoked');
    expect(JSON.stringify(fs.getDoc(path))).not.toContain('ephemeral-apple-code');expect(JSON.stringify(fs.getDoc(path))).not.toContain('ephemeral-id-token');
    await expect(call(payload('authorize_apple',{appleAuthorizationCode:'ephemeral-apple-code'}))).rejects.toThrow();
  });
  it('rotates an owner capability on another device without creating a new deletion',async()=>{
    await call(payload());const newKey='ee'.repeat(32),recovery={capability:'account_erasure_v1',mode:'delete',operation:'recover_owner',
      expectedUid:uid,recoveryId:'recovery_1234567890',observationKey:newKey};
    const recovered=await call(recovery);expect(recovered.commandId).toBe(commandId);await call(recovery);
    expect(fs.countWrites(op=>op.path===path&&op.method==='create')).toBe(1);
    await expect(call(payload('observe'),false)).rejects.toMatchObject({code:'permission-denied'});
    expect((await call(payload('observe',{observationKey:newKey}),false)).commandId).toBe(commandId);
    expect(runtime.step).not.toHaveBeenCalled();expect(JSON.stringify(fs.getDoc(path))).not.toContain(newKey);
  });
  it('refuses owner recovery after destructive fence, or after another Auth incarnation',async()=>{
    await call(payload());user={...user,metadata:{creationTime:new Date(Date.now()-1000).toISOString()}};
    const recovery={capability:'account_erasure_v1',mode:'delete',operation:'recover_owner',expectedUid:uid,
      recoveryId:'recovery_1234567890',observationKey:'ee'.repeat(32)};
    await expect(call(recovery)).rejects.toThrow();
    user.metadata.creationTime=fs.getDoc(path)!.authSource.createdAtMs?new Date(fs.getDoc(path)!.authSource.createdAtMs).toISOString():'';
    await service.advance(commandId);await expect(call(recovery)).rejects.toThrow();
  });
  it('observes a lost rotation response using only persisted recovery identity after Auth deletion',async()=>{
    await call(payload());const recoveryId='recovery_1234567890',newKey='ef'.repeat(32);
    await call({capability:'account_erasure_v1',mode:'delete',operation:'recover_owner',expectedUid:uid,recoveryId,observationKey:newKey});
    // The new device deliberately has not received/saved canonical commandId
    // or requestId. Its key and recoveryId were persisted BEFORE the rotation.
    vi.mocked(runtime.auth.getUser).mockRejectedValue(Object.assign(new Error('absent'),{code:'auth/user-not-found'}));
    const observation={capability:'account_erasure_v1',mode:'delete',operation:'observe_recovery',recoveryId,observationKey:newKey};
    const receipt=await call(observation,false);expect(receipt.commandId).toBe(commandId);expect(receipt.requestId).toBe(requestId);
    expect(runtime.step).not.toHaveBeenCalled();
    await expect(call({...observation,observationKey:key},false)).rejects.toMatchObject({code:'permission-denied'});
    expect(()=>parseAccountErasureRequest({...observation,expectedUid:uid})).toThrow();
  });
  it('does not accept a forged command even with a matching capability',async()=>{
    await call(payload());fs.setDoc(path,{...fs.getDoc(path),authSource:{...fs.getDoc(path)!.authSource,uid:'other'}});
    await expect(call(payload('observe'),false)).rejects.toThrow();expect(runtime.step).not.toHaveBeenCalled();
  });
  it('does not leak native private source names, amounts or owner ID through a review receipt',async()=>{
    await call(payload());const command=fs.getDoc(path)!;fs.setDoc(path,{...command,state:'awaiting_review',
      reasons:['wallets/private','debt_123'],inspection:{secretAmount:123},updatedAt:Timestamp.now()});
    const text=JSON.stringify(await call(payload('observe'),false));
    for(const privateText of ['wallets/private','debt_123','secretAmount','"ownerId"'])expect(text).not.toContain(privateText);
  });
});
describe('internal native Apple web hooks',()=>{
  const preconfirmed=()=>{
    const at=Timestamp.fromMillis(Date.now()-10),input:any={ownerId:uid,requestId,commandId,confirmed:true,
      observationKeyHash:accountErasureKeyHash(commandId,key),authSourceHash:accountErasureSourceHash(erasureNativeAuth(user)),
      preconfirmedAt:at,verifiedAt:at,revokedAt:at,challengeId:'web_challenge_1234567890',
      authorizationSourceHash:'d'.repeat(64),revocationProofHash:'e'.repeat(64)};
    return {...input,preconfirmedIntentHash:accountErasurePreconfirmedIntentHash(input)};
  };
  it('does not block the account until the native challenge owner commits its fresh proof',async()=>{
    user.providerData.push({providerId:'apple.com',uid:'apple-native-subject'});const input=preconfirmed();
    await fs.db.runTransaction(async(tx:any)=>{
      const prepared=await prepareAccountErasureAppleWebRequest(runtime,tx,input);
      expect(fs.getDoc(path)).toBeUndefined();expect(fs.getDoc('eligibility_profiles/'+uid)).toBeUndefined();
      expect(fs.writeOps).toHaveLength(0);prepared.commit();
    });
    const native=fs.getDoc(path)!;expect(native.actor.authority).toBe('apple_web_challenge');expect(native.actor).not.toHaveProperty('authTimeSeconds');
    expect(native.apple.state).toBe('revoked');expect(native.origin.preconfirmedIntentHash).toBe(input.preconfirmedIntentHash);
    expect(fs.getDoc('eligibility_profiles/'+uid)?.accountClosure.phase).toBe('paused');
    expect(JSON.stringify(native)).not.toContain(key);expect((await call(payload('observe'),false)).commandId).toBe(commandId);
  });
  it('replays the identical preconfirmation and observes canonical identity after Auth disappears',async()=>{
    user.providerData.push({providerId:'apple.com',uid:'apple-native-subject'});const input=preconfirmed();
    const commit=()=>fs.db.runTransaction(async(tx:any)=>{const p=await prepareAccountErasureAppleWebRequest(runtime,tx,input);p.commit();return p.receipt;});
    await commit();vi.mocked(runtime.auth.getUser).mockRejectedValue(Object.assign(new Error('absent'),{code:'auth/user-not-found'}));
    await commit();expect(fs.countWrites(op=>op.path===path&&op.method==='create')).toBe(1);
    expect((await call(payload('observe'),false)).requestId).toBe(requestId);
  });
  it('does not consume a modified, expired or unconfirmed envelope and never creates a general Firebase session',async()=>{
    user.providerData.push({providerId:'apple.com',uid:'apple-native-subject'});const input=preconfirmed();
    for(const mutation of [{observationKeyHash:'f'.repeat(64)},{confirmed:false},{preconfirmedAt:Timestamp.fromMillis(Date.now()-6*60000)},
      {authSourceHash:'f'.repeat(64)}])await expect(fs.db.runTransaction((tx:any)=>prepareAccountErasureAppleWebRequest(runtime,tx,{...input,...mutation}))).rejects.toThrow();
    expect(fs.writeOps).toHaveLength(0);expect(fs.getDoc('eligibility_profiles/'+uid)).toBeUndefined();
  });
  it('refuses current Auth birth/provider changes between start and native Web completion',async()=>{
    user.providerData.push({providerId:'apple.com',uid:'apple-native-subject'});const input=preconfirmed();
    user={...user,metadata:{creationTime:new Date(Date.now()-1000).toISOString()}};
    await expect(fs.db.runTransaction((tx:any)=>prepareAccountErasureAppleWebRequest(runtime,tx,input))).rejects.toThrow();expect(fs.writeOps).toHaveLength(0);
  });
  it('records the existing native order proof without rotating its observation capability',async()=>{
    user.providerData.push({providerId:'apple.com',uid:'apple-native-subject'});await call(payload());await service.advance(commandId);
    const before=fs.getDoc(path)!,input={commandId,ownerId:uid,commandInputHash:before.inputHash,authSourceHash:accountErasureSourceHash(before.authSource),
      challengeId:'web_challenge_1234567890',authorizationSourceHash:'d'.repeat(64),revocationProofHash:'e'.repeat(64),revokedAt:Timestamp.now()};
    await fs.db.runTransaction(async(tx:any)=>{const p=await prepareAccountErasureAppleWebCommit(runtime,tx,input);p.commit();});
    const after=fs.getDoc(path)!;expect(after.apple.flow).toBe('apple_web_verified_code');expect(after.state).toBe('inspecting');
    expect(after.observationKeyHash).toBe(before.observationKeyHash);expect(after.inputHash).toBe(before.inputHash);
    expect((await call(payload('observe'),false)).commandId).toBe(commandId);
    await fs.db.runTransaction(async(tx:any)=>{const p=await prepareAccountErasureAppleWebCommit(runtime,tx,input);p.commit();});
    expect(fs.getDoc(path)?.version).toBe(after.version);
  });
});
