import {beforeEach,describe,expect,it,vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
import {createFirestoreMock,type MockFirestore} from './testHelpers/firestoreMock';
const h=vi.hoisted(()=>({fs:null as MockFirestore|null}));
const fs=createFirestoreMock({enforceReadBeforeWrite:true});h.fs=fs;
vi.mock('../config/firebase',()=>({get db(){return h.fs!.db;},get FieldValue(){return h.fs!.FieldValue;},
  auth:{getUser:async()=>({uid:'owner',disabled:false,tokensValidAfterTime:new Date(0).toISOString(),customClaims:{admin:true}})}}));
import {assertPrivateAccountSession,withPrivateAccountSession} from './privateAccountSession';
import {hasAccountClosure} from '../shared/eligibility';
import {hasAccountErasureFence} from './accountErasureContract';
const req=()=>({auth:{uid:'owner',token:{auth_time:Math.floor(Date.now()/1000)}},data:{expectedUid:'owner'}});
beforeEach(()=>fs.reset());
describe('dedicated account erasure fence',()=>{
  it('does not close a current private session before admission',async()=>{
    fs.setDoc('eligibility_profiles/owner',{accountClosure:{phase:'paused'}});
    expect((await assertPrivateAccountSession(req())).uid).toBe('owner');
    expect(hasAccountErasureFence(fs.getDoc('eligibility_profiles/owner'))).toBe(false);
  });
  it.each([null,{},false,'malformed',{protocol:'account_erasure_fence_v1',ownerId:'other'},
    {protocol:'account_erasure_fence_v1',ownerId:'owner',commandId:'a'.repeat(64),recordedAt:Timestamp.now()}])(
    'closes SDK/CF acquisition and private servicing for marker presence %#',async accountErasureFence=>{
      fs.setDoc('eligibility_profiles/owner',{accountErasureFence});
      expect(hasAccountClosure(fs.getDoc('eligibility_profiles/owner'))).toBe(true);
      await expect(assertPrivateAccountSession(req())).rejects.toMatchObject({details:{reason:'account_erasure_in_progress'}});
    });
  it('does not return private data if erasure admission commits during a read',async()=>{
    await expect(withPrivateAccountSession(req(),async()=>{
      fs.setDoc('eligibility_profiles/owner',{accountErasureFence:{commandId:'a'.repeat(64)}});
      return {privateData:'must not escape'};
    })).rejects.toMatchObject({details:{reason:'account_erasure_in_progress'}});
  });
  it('joins the fence read to the native transaction even for current administrative auth',async()=>{
    const read:string[]=[];
    const tx={get:async(ref:any)=>{read.push(ref.path);return ref.get();}};
    await assertPrivateAccountSession(req(),tx as any);
    fs.setDoc('eligibility_profiles/owner',{accountErasureFence:null});
    await expect(assertPrivateAccountSession(req(),tx as any)).rejects.toMatchObject({details:{reason:'account_erasure_in_progress'}});
    expect(read.filter(path=>path==='eligibility_profiles/owner')).toHaveLength(2);
  });
});
