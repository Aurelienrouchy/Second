import {onSchedule} from 'firebase-functions/v2/scheduler';
import {db} from '../config/firebase';
import {advanceAccountErasure,ACCOUNT_ERASURE_WORKABLE_STATES} from '../utils/accountErasureWorker';
import {accountErasureProviderSecrets} from '../utils/accountErasureService';
/** Slow provider completions and changed obligations do not depend on a live
 * Auth user/device. Review states are reobserved; unknown outcomes stay honest. */
export const resumeAccountErasures=onSchedule({schedule:'every 5 minutes',region:'northamerica-northeast1',memory:'512MiB',
  timeoutSeconds:540,secrets:accountErasureProviderSecrets()},async()=>{
  const position=db.doc('account_erasure_worker_positions/continuation_v1'),old=(await position.get()).data();
  let q=db.collection('account_erasure_commands').where('state','in',ACCOUNT_ERASURE_WORKABLE_STATES).orderBy('__name__').limit(25);
  if(typeof old?.lastId==='string')q=q.startAfter(old.lastId);
  let page=await q.get();
  if(page.empty&&old?.lastId)page=await db.collection('account_erasure_commands').where('state','in',ACCOUNT_ERASURE_WORKABLE_STATES).orderBy('__name__').limit(25).get();
  for(const row of page.docs)await advanceAccountErasure(row.id);
  await position.set({protocol:'account_erasure_worker_position_v1',lastId:page.size===25?page.docs.at(-1)!.id:null});
});
