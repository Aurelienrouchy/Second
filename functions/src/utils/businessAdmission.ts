import { HttpsError } from 'firebase-functions/v2/https';
import { readFinancialRecoveryControl, type QualifiedRecoveryControl } from '../config/recoveryControl';
import { assertFinancialRecoveryEffect } from './financialRecoveryInterlock';

export const BUSINESS_ADMISSION_PROTOCOL='business_admission_control_v1';
export type BusinessAdmission={protocol:typeof BUSINESS_ADMISSION_PROTOCOL;state:'open'|'stop_new';planId:string|null};
/** This addendum is independently administered, never writable by an app
 * operator. Missing configuration is UNKNOWN, not an activated cessation. */
export function qualifiedBusinessAdmission(q:QualifiedRecoveryControl):BusinessAdmission|null{
  const raw=q.control.businessAdmission;
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='planId,protocol,state')return null;
  const v=raw as Record<string,unknown>;
  if(v.protocol!==BUSINESS_ADMISSION_PROTOCOL||!['open','stop_new'].includes(v.state as string)||
    (v.state==='open'?v.planId!==null:typeof v.planId!=='string'||!/^bc_[a-f0-9]{64}$/.test(v.planId)))return null;
  return v as BusinessAdmission;
}
/** NEW commercial acquisition only, AFTER native own receipts. Acquire the
 * existing invocation permit before checking the addendum: its later commit
 * checkpoint rejects a changed control generation, including a concurrent
 * stop. In-flight executions must still be drained by the actual operator;
 * a successful check does not certify that operational drain. */
export async function assertNewBusinessAdmission(previewOnly=false):Promise<void>{
  if(!previewOnly)await assertFinancialRecoveryEffect('firestore_commit',{providerOperation:'new_commerce_admission'});
  const q=await readFinancialRecoveryControl(),admission=qualifiedBusinessAdmission(q);
  if(!admission||admission.state!=='open')throw new HttpsError('failed-precondition',
    admission?'Les nouveaux engagements commerciaux sont arrêtés. Les commandes et recours existants restent à traiter.':
      'La configuration des nouveaux engagements commerciaux doit être qualifiée avant de poursuivre.',
    {reason:admission?'business_new_commerce_stopped':'business_admission_configuration_required',
      newCommerceBlocked:true,cessationActivated:admission?.state==='stop_new',action:'contactSupport'});
}
