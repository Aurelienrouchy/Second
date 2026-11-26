/** Late, already-admitted resumable uploads do not reopen an erased account.
 * This is an event-driven generation guard, not a time-based drain assertion. */
import {onObjectFinalized} from 'firebase-functions/v2/storage';
import {Timestamp} from 'firebase-admin/firestore';
import {db} from '../config/firebase';
import {runtimeStorageBucket} from '../config/runtimeEnvironment';
import {eraseStorageGeneration,erasurePostalFinalizationDisposition} from '../utils/accountErasureRuntime';
import {accountErasureSourceHash} from '../utils/accountErasureContract';
export async function handleErasedAccountStorageFinalization(event:{id:string;data:{name?:string;generation?:string|number;bucket?:string}}){
  const path=event.data.name??'',parts=path.split('/'),ownerId=['users','drafts','products','profile_privacy'].includes(parts[0])&&parts.length>=3?parts[1]:
    parts[0]==='avatars'&&parts.length===2?parts[1]:parts[0]==='chat_images'&&parts.length===4?parts[2]:
    parts[0]==='swaps'&&parts.length===5&&parts[2]==='photos'&&/^[A-Za-z0-9_-]{1,200}$/.test(parts[1])?parts[3]:null;
  if(typeof event.data.generation==='number'&&!Number.isSafeInteger(event.data.generation))return;
  const generation=String(event.data.generation??'');
  if(!ownerId||!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)||!/^[1-9]\d{0,24}$/.test(generation)||event.data.bucket!==runtimeStorageBucket())return;
  const profile=(await db.collection('eligibility_profiles').doc(ownerId).get()).data(),fence=profile?.accountErasureFence;
  if(!fence||typeof fence!=='object'||!/^[a-f0-9]{64}$/.test(fence.commandId??''))return;
  const command=(await db.collection('account_erasure_commands').doc(fence.commandId).get()).data();
  if(!command||command.protocol!=='account_erasure_v1'||command.ownerId!==ownerId||command.confirmed!==true||
    command.fenceCommitted!==true||fence.protocol!=='account_erasure_fence_v1'||fence.ownerId!==ownerId||
    command.commandId!==fence.commandId)return;
  const disposition=parts[0]==='swaps'?await erasurePostalFinalizationDisposition(command,path,generation):'erase';
  if(disposition==='erase')await eraseStorageGeneration(command,path,generation);
  await db.runTransaction(async tx=>{
    const live=(await tx.get(db.collection('account_erasure_commands').doc(command.commandId))).data();
    if(live?.inputHash!==command.inputHash)throw new Error('Erasure finalization command changed.');
    tx.set(db.collection('account_erasure_commands').doc(command.commandId).collection('late_storage_receipts').doc(accountErasureSourceHash(event.id)),{
      protocol:'account_erasure_late_storage_receipt_v1',eventIdHash:accountErasureSourceHash(event.id),
      targetHash:accountErasureSourceHash([path,generation]),state:disposition==='retain'?'retained_contract_generation':'generation_absence_verified',observedAt:Timestamp.now()});
  });
}
export const eraseLateAccountStorage=onObjectFinalized({region:'northamerica-northeast1',memory:'512MiB',timeoutSeconds:120,
  bucket:runtimeStorageBucket(),retry:true},handleErasedAccountStorageFinalization);
