import {assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {deleteDoc,doc,getDoc,setDoc,Timestamp,updateDoc} from 'firebase/firestore';
import {getBytes,ref,uploadBytes} from 'firebase/storage';
import {afterAll,beforeAll,beforeEach,describe,it} from 'vitest';
import {getTestEnv,teardownTestEnv} from './helpers';

const OWNER='legacy-deleted-owner',SECOND=1700000000,bytes=new Uint8Array([1,2,3]);
const draft='drafts/'+OWNER+'/draft/cover.jpg';
const nativeFence={protocol:'phase1_legacy_deletion_fence_v1',ownerId:OWNER,startedAt:Timestamp.fromMillis(SECOND*1000+650),authTime:SECOND};
const presentFences=[nativeFence,null,{},false,'malformed',{...nativeFence,ownerId:'foreign-owner'}];
const ownerData={email:'owner@example.test',displayName:'Owner',isActive:true};
async function fence(value:unknown,deleteUser=false){
  const env=await getTestEnv();
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'eligibility_profiles',OWNER),{ownerId:OWNER,legacyDeletionFence:value});
    if(deleteUser)await deleteDoc(doc(ctx.firestore(),'users',OWNER));
  });
  return env;
}
describe('legacy deletion permanent native session fence',()=>{
  beforeAll(getTestEnv);afterAll(teardownTestEnv);
  beforeEach(async()=>{
    const env=await getTestEnv();await env.clearFirestore();await env.clearStorage();
    await env.withSecurityRulesDisabled(async ctx=>{
      await setDoc(doc(ctx.firestore(),'users',OWNER),ownerData);
      await setDoc(doc(ctx.firestore(),'eligibility_profiles',OWNER),{ownerId:OWNER});
      await setDoc(doc(ctx.firestore(),'users','unrelated'),{email:'unrelated@example.test',displayName:'Other'});
      await setDoc(doc(ctx.firestore(),'articles','public'),{sellerId:OWNER});
      await uploadBytes(ref(ctx.storage(),draft),bytes,{contentType:'image/jpeg'});
      await uploadBytes(ref(ctx.storage(),'articles/public/cover.jpg'),bytes,{contentType:'image/jpeg'});
    });
  });
  it('preserves SDK profile creation, edits, private reads and draft uploads before any fence',async()=>{
    const env=await getTestEnv(),owner=env.authenticatedContext(OWNER,{auth_time:SECOND});
    await assertSucceeds(getDoc(doc(owner.firestore(),'users',OWNER)));
    await assertSucceeds(updateDoc(doc(owner.firestore(),'users',OWNER),{displayName:'Owner updated'}));
    await assertSucceeds(setDoc(doc(owner.firestore(),'users',OWNER,'savedSearches','before-fence'),{query:'pull'}));
    await assertSucceeds(getBytes(ref(owner.storage(),draft)));
    await assertSucceeds(uploadBytes(ref(owner.storage(),'drafts/'+OWNER+'/new/before.jpg'),bytes,{contentType:'image/jpeg'}));
    await env.withSecurityRulesDisabled(ctx=>deleteDoc(doc(ctx.firestore(),'users',OWNER)));
    await assertSucceeds(setDoc(doc(owner.firestore(),'users',OWNER),ownerData));
  });
  it('preserves legacy signup when no private eligibility profile exists',async()=>{
    const env=await getTestEnv();
    await env.withSecurityRulesDisabled(async ctx=>{
      await deleteDoc(doc(ctx.firestore(),'users',OWNER));await deleteDoc(doc(ctx.firestore(),'eligibility_profiles',OWNER));
    });
    const owner=env.authenticatedContext(OWNER);
    await assertSucceeds(setDoc(doc(owner.firestore(),'users',OWNER),ownerData));
    await assertSucceeds(uploadBytes(ref(owner.storage(),'drafts/'+OWNER+'/new/no-profile.jpg'),bytes,{contentType:'image/jpeg'}));
  });
  it.each(presentFences)('refuses user updates and private/admin reads for every present fence %#',async value=>{
    const env=await fence(value);
    for(const auth_time of [SECOND,SECOND+1000]){
      const ctx=env.authenticatedContext(OWNER,{auth_time,admin:true}),db=ctx.firestore();
      await assertFails(updateDoc(doc(db,'users',OWNER),{displayName:'Cached JWT'}));
      await assertFails(getDoc(doc(db,'users',OWNER)));
      await assertFails(getDoc(doc(db,'eligibility_profiles',OWNER)));
    }
  });
  it.each(presentFences)('refuses recreation and orphan subcollection writes after deletion for fence %#',async value=>{
    const env=await fence(value,true);
    for(const auth_time of [SECOND,SECOND+1000]){
      const db=env.authenticatedContext(OWNER,{auth_time}).firestore();
      await assertFails(setDoc(doc(db,'users',OWNER),ownerData));
      await assertFails(setDoc(doc(db,'users',OWNER,'savedSearches','recreated'),{query:'pull'}));
    }
  });
  it.each(presentFences.map((value,index)=>[index,value] as const))('refuses private Storage reads and new drafts after deletion for fence %s',async(caseId,value)=>{
    const env=await fence(value,true);
    for(const auth_time of [SECOND,SECOND+1000]){
      const storage=env.authenticatedContext(OWNER,{auth_time}).storage();
      await assertFails(uploadBytes(ref(storage,'drafts/'+OWNER+'/after/new-'+caseId+'-'+auth_time+'.jpg'),bytes,{contentType:'image/jpeg'}));
      await assertFails(getBytes(ref(storage,draft)));
    }
  });
  it('keeps private fences server-only and does not close public browsing or unrelated owners',async()=>{
    const env=await fence(nativeFence,true),owner=env.authenticatedContext(OWNER,{auth_time:SECOND+1000});
    await assertFails(updateDoc(doc(owner.firestore(),'eligibility_profiles',OWNER),{legacyDeletionFence:null}));
    await assertFails(deleteDoc(doc(owner.firestore(),'eligibility_profiles',OWNER)));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('unrelated').firestore(),'users','unrelated')));
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(),'articles','public')));
    await assertSucceeds(getBytes(ref(env.unauthenticatedContext().storage(),'articles/public/cover.jpg')));
  });
});
