import {HttpsError} from 'firebase-functions/v2/https';
import {db} from '../config/firebase';
import {assertPrivateAccountSession} from './privateAccountSession';
import {readFinancialRecoveryState} from './financialRecoveryInterlock';
import {supportAdmin, supportObject, supportUid} from './supportRequest';

export const FINANCIAL_RECOVERY_STATUS_CAPABILITY = 'financial_recovery_status_v1';

/** Read-only operator projection. A restored database role can inspect the
 * interlock; it cannot modify its independently administered control object. */
export async function readFinancialRecoveryStatus(request: any) {
  const uid = supportUid(request);
  const input = supportObject(request.data, ['capability', 'expectedUid', 'mode']);
  if (input.capability !== FINANCIAL_RECOVERY_STATUS_CAPABILITY || input.mode !== 'observe') {
    throw new HttpsError('invalid-argument', 'Lecture de reprise invalide.');
  }
  const requalifyAdmin = () => db.runTransaction(async tx => {
    const session = await assertPrivateAccountSession(request, tx);
    await supportAdmin(tx, uid, session.currentAdminClaim);
  });
  await requalifyAdmin();
  const state = await readFinancialRecoveryState();
  await requalifyAdmin();
  return {...state, actorId: uid, observedAt: new Date().toISOString(), financialEffectsApplied: false};
}
