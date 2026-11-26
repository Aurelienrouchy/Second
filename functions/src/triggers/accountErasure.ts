import {onDocumentWritten} from 'firebase-functions/v2/firestore';
import {advanceAccountErasure} from '../utils/accountErasureWorker';
import {accountErasureProviderSecrets} from '../utils/accountErasureService';
export const continueAccountErasure=onDocumentWritten({document:'account_erasure_commands/{commandId}',
  region:'northamerica-northeast1',memory:'512MiB',timeoutSeconds:120,retry:true,secrets:accountErasureProviderSecrets()},async event=>{
  const before=event.data?.before.data(),after=event.data?.after.data();
  if(!after||after.protocol!=='account_erasure_v1'||before?.version===after.version||
    !['requested','inspecting','erasing','auth_deletion_pending'].includes(after.state))return;
  await advanceAccountErasure(event.params.commandId);
});
