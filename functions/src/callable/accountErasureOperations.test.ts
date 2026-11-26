import {beforeEach,describe,it,expect,vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
const h=await vi.hoisted(async()=>{const {createFirestoreMock}=await import('../utils/testHelpers/firestoreMock');
  return {fs:createFirestoreMock({enforceReadBeforeWrite:true}),admin:true,erase:vi.fn(),guard:vi.fn()};});
vi.mock('../config/firebase',()=>({db:h.fs.db}));
vi.mock('../utils/privateAccountSession',()=>({assertPrivateAccountSession:async()=>{await h.guard();return {uid:'operator',currentAdminClaim:h.admin};},
  withPrivateAccountSession:async(_request:any,fn:any)=>{await h.guard();const result=await fn();await h.guard();return result;}}));
vi.mock('../utils/accountErasureRuntime',()=>({eraseStorageGeneration:(...args:any[])=>h.erase(...args)}));
import {handleAccountErasureOperations} from './accountErasureOperations';
import {accountErasureSourceHash} from '../utils/accountErasureContract';
const id='a'.repeat(64),reviewId='b'.repeat(64),path='account_erasure_commands/'+id,reviewPath=path+'/media_reviews/'+reviewId;
const req=(action:string,extra:any={})=>({auth:{uid:'operator',token:{auth_time:Math.floor(Date.now()/1000),firebase:{sign_in_provider:'google.com'}}},
  data:{expectedUid:'operator',action,...extra}});
const call=(action:string,extra:any={})=>handleAccountErasureOperations(req(action,extra));
beforeEach(()=>{
  h.fs.reset();h.admin=true;h.erase.mockReset();h.erase.mockResolvedValue(undefined);h.guard.mockReset();h.guard.mockResolvedValue(undefined);
  h.fs.setDoc('users/operator',{});
  h.fs.setDoc(path,{protocol:'account_erasure_v1',commandId:id,requestId:'native-request-12345678',ownerId:'owner',state:'awaiting_review',version:7,
    inputHash:'c'.repeat(64),intakeObservationKeyHash:'d'.repeat(64),observationKeyHash:'e'.repeat(64),confirmed:true,
    requestedAt:Timestamp.now(),updatedAt:Timestamp.now(),completedAt:null,progress:{completedSteps:4,totalSteps:7},
    retentionPolicyVersion:'policy',fenceCommitted:true,authSource:{doNotExpose:'private-native-subject'},reasons:['posthog_operator_credential_required']});
  h.fs.setDoc(reviewPath,{protocol:'account_erasure_chat_media_review_v1',commandId:id,ownerId:'owner',state:'review_required',
    sourceMessageId:'message',sourceChatId:'chat',sourceMessageHash:'f'.repeat(64),path:'chat_images/chat/photo.jpg',generation:'11',size:100,contentType:'image/jpeg'});
});
describe('real erasure operator queue boundaries',()=>{
  it('requires current authentication, primary recency and a current native operator role',async()=>{
    await expect(handleAccountErasureOperations({data:{action:'list'}})).rejects.toMatchObject({code:'permission-denied'});
    await expect(handleAccountErasureOperations({...req('list'),data:{action:'list',expectedUid:'other'}})).rejects.toMatchObject({code:'permission-denied'});
    const stale=req('list');stale.auth.token.auth_time-=600;await expect(handleAccountErasureOperations(stale)).rejects.toMatchObject({code:'permission-denied'});
    h.admin=false;await expect(call('list')).rejects.toMatchObject({code:'permission-denied'});
    h.guard.mockRejectedValueOnce(new Error('native session fenced'));await expect(call('list')).rejects.toThrow('native session fenced');
  });
  it('lists and inspects real pending native work without exposing capabilities or native Auth subjects',async()=>{
    expect((await call('list')).items).toHaveLength(1);
    const inspection=await call('inspect',{commandId:id}),text=JSON.stringify(inspection);
    expect(inspection.nativeReasons).toContain('posthog_operator_credential_required');expect(inspection.media[0].generation).toBe('11');
    for(const forbidden of ['private-native-subject','observationKeyHash','intakeObservationKeyHash','authSource'])expect(text).not.toContain(forbidden);
    expect(inspection.financialQualificationGranted).toBe(false);expect(inspection.legalAuthorityAutomaticallyVerified).toBe(false);
  });
  it('retries an existing intention after repair, retaining capability and recording the exact operator action',async()=>{
    const before=h.fs.getDoc(path)!,input={commandId:id,expectedVersion:7,requestId:'operator-retry-12345678'};
    const first=await call('resume',input);expect(first.state).toBe('erasing');expect(first.version).toBe(8);
    expect(h.fs.getDoc(path)?.observationKeyHash).toBe(before.observationKeyHash);expect(h.fs.getDoc(path)?.inputHash).toBe(before.inputHash);
    const writes=h.fs.writeOps.length;await call('resume',input);expect(h.fs.writeOps).toHaveLength(writes);
    await expect(call('resume',{...input,expectedVersion:8})).rejects.toMatchObject({code:'aborted'});
    expect(h.fs.writeOps.some(v=>/^(wallets|transactions|swaps|withdrawal_requests)\//.test(v.path))).toBe(false);
  });
  it('cannot replace Apple owner authorization or consume a different command version',async()=>{
    h.fs.setDoc(path,{...h.fs.getDoc(path),state:'awaiting_apple_authorization'});
    await expect(call('resume',{commandId:id,expectedVersion:7,requestId:'operator-retry-12345678'})).rejects.toMatchObject({code:'failed-precondition'});
    expect(h.fs.writeOps).toHaveLength(0);
  });
  const mediaInput=()=>({commandId:id,reviewId,expectedReviewHash:accountErasureSourceHash(h.fs.getDoc(reviewPath)),requestId:'operator-media-12345678',
    ownershipVerified:true,reason:'Verified the native sender record and this exact generation as belonging to the requesting owner.'});
  it('durably prepares an operator-reviewed generation before storage effects and returns idempotent proof',async()=>{
    const input=mediaInput();h.erase.mockImplementationOnce(async(command:any,path:string,generation:string)=>{
      expect(command.commandId).toBe(id);expect(path).toBe('chat_images/chat/photo.jpg');expect(generation).toBe('11');
      expect(h.fs.getDoc(reviewPath)?.state).toBe('erase_prepared');
    });
    expect((await call('erase_media',input)).state).toBe('generation_absence_verified');expect(h.fs.getDoc(reviewPath)?.state).toBe('erased');
    expect(h.fs.getDoc(reviewPath)?.operatorAttestation.rprDesignationAutomaticallyVerified).toBe(false);
    await call('erase_media',input);expect(h.erase).toHaveBeenCalledTimes(1);
  });
  it('keeps an unknown escaped response pending and reuses the same prepared generation on retry',async()=>{
    const input=mediaInput();h.erase.mockRejectedValueOnce(new Error('lost storage response'));
    await expect(call('erase_media',input)).rejects.toThrow('lost storage response');expect(h.fs.getDoc(reviewPath)?.state).toBe('erase_prepared');
    await call('erase_media',input);expect(h.erase).toHaveBeenCalledTimes(2);expect(h.fs.getDoc(reviewPath)?.state).toBe('erased');
  });
  it('does not permit broad chat deletion, unreviewed ownership or a changed native target',async()=>{
    await expect(call('erase_media',{...mediaInput(),ownershipVerified:false})).rejects.toMatchObject({code:'invalid-argument'});
    await expect(call('erase_media',{...mediaInput(),expectedReviewHash:'c'.repeat(64)})).rejects.toMatchObject({code:'aborted'});
    h.fs.setDoc(reviewPath,{...h.fs.getDoc(reviewPath),path:'users/another/avatar.jpg'});
    await expect(call('erase_media',mediaInput())).rejects.toMatchObject({code:'aborted'});
    expect(h.erase).not.toHaveBeenCalled();expect(h.fs.writeOps).toHaveLength(0);
  });
});
