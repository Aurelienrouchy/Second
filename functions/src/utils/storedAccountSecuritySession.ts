/** NEW authority from an already qualified private instruction/capture only.
 * A stored auth_time is not a Firebase SDK token. Callers must qualify the
 * native source, role and business guards before using this internal helper. */
import {HttpsError} from 'firebase-functions/v2/https';
import type {Timestamp} from 'firebase-admin/firestore';
import {auth, db} from '../config/firebase';
import {hasAccountSecurityBarrier} from '../shared/accountSecurity';
import {qualifyAccountSecurityProfile, readAccountSecurityEpisode, readAccountSecurityRecoveryState} from './accountSecurityIdentity';

const refuse = () => new HttpsError('failed-precondition',
  'L’autorité native de cette instruction doit être réexaminée.', {reason:'stored_account_security_session_unqualified'});
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value,key);

export async function assertStoredAccountSecuritySession(tx:FirebaseFirestore.Transaction, uid:string,
  authTimeSeconds:unknown):Promise<{currentAdminClaim:boolean}> {
  const at = typeof authTimeSeconds==='number' ? authTimeSeconds*1000 : NaN;
  if(typeof uid!=='string'||!uid||uid.length>128||uid.includes('/')||uid==='.'||uid==='..'||/^__.*__$/.test(uid)||
    !Number.isSafeInteger(authTimeSeconds)||(authTimeSeconds as number)<1||!Number.isSafeInteger(at)||at>Date.now()) throw refuse();
  let account;
  try {account=await auth.getUser(uid);} catch {throw refuse();}
  const cutoff=typeof account.tokensValidAfterTime==='string'?Date.parse(account.tokensValidAfterTime):NaN;
  if(account.uid!==uid||account.disabled!==false||!Number.isSafeInteger(cutoff)||cutoff<0||cutoff>Date.now()||at<cutoff) throw refuse();
  const profile=(await tx.get(db.collection('eligibility_profiles').doc(uid))).data();
  if(hasAccountSecurityBarrier(await qualifyAccountSecurityProfile(profile,tx,uid))) throw refuse();
  if(!profile||!own(profile,'accountSecurityBarrier')&&!own(profile,'accountSecurityRecovery'))
    return {currentAdminClaim:account.customClaims?.admin===true};
  const episode=await readAccountSecurityEpisode(profile,tx,uid);
  if(!episode||(authTimeSeconds as number)<=(episode.barrier.recordedAt as Timestamp).seconds) throw refuse();
  const state=await readAccountSecurityRecoveryState(profile,tx,uid,episode);
  if(state.qualification!=='known'||!state.receipt?.restoration||
    (authTimeSeconds as number)<state.receipt.restoration.authTimeSeconds) throw refuse();
  return {currentAdminClaim:account.customClaims?.admin===true};
}
