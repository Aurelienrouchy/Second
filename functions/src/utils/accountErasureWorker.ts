import {Timestamp} from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import {db} from '../config/firebase';
import {getAccountErasureService} from './accountErasureService';
import {accountErasureSourceHash} from './accountErasureContract';
export const ACCOUNT_ERASURE_WORKABLE_STATES=['requested','inspecting','awaiting_obligations','awaiting_review','erasing','auth_deletion_pending'];
/** Fixed private diagnostic codes only. Never persist a provider message,
 * response body, stack, credential, path or member-controlled value. */
function nativeFailureReason(error:unknown):string{
  const value=error as {code?:unknown;reason?:unknown;message?:unknown}|null;
  const recovery=new Set(['evidence_unavailable','evidence_collision','io_budget_exhausted','control_unavailable',
    'source_not_reconciled','article_privacy_native_unqualified','installation_unqualified','scope_missing',
    'financial_provider_unconfigured','effect_control_changed','mode_draining']);
  if(value?.code==='financial-recovery-closed'&&typeof value.reason==='string'&&recovery.has(value.reason))
    return 'recovery_'+value.reason;
  if(typeof value?.code==='number'&&[3,5,6,7,8,9,10,13,14,16,400,401,403,404,409,412,429,500,503,504].includes(value.code))
    return 'sdk_code_'+value.code;
  const callable=['failed-precondition','permission-denied','unauthenticated','resource-exhausted','unavailable','deadline-exceeded','internal'];
  if(typeof value?.code==='string'&&callable.includes(value.code))return 'callable_'+value.code.split('-').join('_');
  if(value?.message==='Account erasure native intention, source, hold or target unqualified.')return 'native_scope_unqualified';
  if(value?.message==='Native erasure source requires reconciliation.')return 'native_source_unqualified';
  if(value?.message==='Firestore transactions require all reads to be executed before all writes.')return 'native_read_order';
  return 'unknown';
}
export async function advanceAccountErasure(commandId:string){
  if(!/^[a-f0-9]{64}$/.test(commandId))throw new Error('Invalid native erasure command.');
  try{return await getAccountErasureService().advance(commandId);}
  catch(error){
    // A concurrent native retry is not an execution failure. The winning
    // command update or the scheduled sweep will continue the same intention.
    if((error as any)?.code==='aborted')return;
    logger.warn('account_erasure_native_execution_requires_review',{
      commandHash:accountErasureSourceHash(commandId),reasonCode:nativeFailureReason(error)});
    await db.runTransaction(async tx=>{
      const ref=db.collection('account_erasure_commands').doc(commandId),job=(await tx.get(ref)).data();
      if(!job||job.protocol!=='account_erasure_v1'||['completed','not_executed'].includes(job.state))return;
      tx.update(ref,{state:'awaiting_review',version:job.version+1,updatedAt:Timestamp.now(),
        reasons:['native_execution_requires_review'],executionFailure:{state:'outcome_not_inferred',observedAt:Timestamp.now()}});
    });
    // No error body, credential, path, UID, code or provider response enters logs.
    return;
  }
}
