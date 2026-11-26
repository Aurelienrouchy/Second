import {isProductionRuntime} from '../config/runtimeEnvironment';
import {createPhase1AccountErasureRuntime} from './accountErasureRuntime';
import {createAccountErasureService,prepareAccountErasureAppleWebCommit as prepareWebCommit,prepareAccountErasureAppleWebRequest as prepareWebRequest,
  type AccountErasureAppleWebCommit,type AccountErasureAppleWebRequestCommit} from './accountErasure';
import {createAccountErasurePolicy} from './accountErasurePolicy';
import {eraseAccountPosthog,revokeNativeAppleForErasure} from './accountErasureProviders';
import {readAccountErasureWriterQualification} from './accountErasureQualification';
let service:ReturnType<typeof createAccountErasureService>|undefined;
let runtime:ReturnType<typeof createPhase1AccountErasureRuntime>|undefined;
export function accountErasureProviderSecrets():string[]{
  return isProductionRuntime()&&process.env.POSTHOG_ERASURE_ENABLED==='true'?['POSTHOG_ERASURE_API_KEY']:[];
}
export function getAccountErasureService(){
  return service??=createAccountErasureService(getAccountErasureRuntime());
}
function getAccountErasureRuntime(){return runtime??=createPhase1AccountErasureRuntime(createAccountErasurePolicy({processors:eraseAccountPosthog,
  apple:revokeNativeAppleForErasure,writerQualification:readAccountErasureWriterQualification}));}
export function prepareAccountErasureAppleWebCommit(tx:FirebaseFirestore.Transaction,input:AccountErasureAppleWebCommit){
  return prepareWebCommit(getAccountErasureRuntime(),tx,input);
}
export function prepareAccountErasureAppleWebRequest(tx:FirebaseFirestore.Transaction,input:AccountErasureAppleWebRequestCommit){
  return prepareWebRequest(getAccountErasureRuntime(),tx,input);
}
