/** Account erasure has its own command and observation identity. Observation
 * never grants a new destructive effect or discloses the erased person's data. */
import {createHash, timingSafeEqual} from 'node:crypto';
import {DocumentReference,FieldValue,GeoPoint,Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';

export const ACCOUNT_ERASURE_PROTOCOL = 'account_erasure_v1' as const;
export const ACCOUNT_ERASURE_FENCE = 'accountErasureFence' as const;
export const ACCOUNT_ERASURE_RECEIPT = 'account_erasure_receipt_v1' as const;
export const ACCOUNT_ERASURE_OBSERVATION_DAYS_AFTER_COMPLETION = 30;
export const ACCOUNT_ERASURE_STATES = ['requested', 'inspecting', 'awaiting_obligations', 'awaiting_review',
  'awaiting_apple_authorization', 'erasing', 'auth_deletion_pending', 'completed', 'needs_attention', 'not_executed'] as const;
export type AccountErasureState = typeof ACCOUNT_ERASURE_STATES[number];
export type AccountErasureRequest = {
  capability: typeof ACCOUNT_ERASURE_PROTOCOL;
  mode: 'delete';
  operation: 'request'|'observe'|'resume'|'authorize_apple';
  requestId: string;
  commandId: string;
  observationKey: string;
  expectedUid?: string;
  confirmed?: true;
  appleAuthorizationCode?: string;
  appleAuthorizationFlow?: 'ios_native';
};
export type AccountErasureRecoveryRequest = {
  capability: typeof ACCOUNT_ERASURE_PROTOCOL;mode:'delete';operation:'recover_owner';
  expectedUid:string;recoveryId:string;observationKey:string;
};
export type AccountErasureRecoveryObservationRequest = {
  capability: typeof ACCOUNT_ERASURE_PROTOCOL;mode:'delete';operation:'observe_recovery';
  recoveryId:string;observationKey:string;
};
export const accountErasureRecoveryObservationId=(recoveryId:string,key:string)=>createHash('sha256')
  .update(JSON.stringify([ACCOUNT_ERASURE_PROTOCOL,'recovery_observation',recoveryId,key])).digest('hex');
export type AccountErasureReceipt = {
  kind: typeof ACCOUNT_ERASURE_RECEIPT;
  commandId: string;
  requestId: string;
  state: AccountErasureState;
  version: number;
  accountAccessClosed: boolean;
  deletionComplete: boolean;
  appleAuthorizationRequired: boolean;
  progress: {completedSteps:number;totalSteps:number};
  reasons: string[];
  updatedAt: string;
  completedAt: string|null;
  retentionPolicyVersion: string;
  observationExpiresAt: string|null;
  // Compatibility does not turn a pending request into a completed deletion.
  success: boolean;
  status: 'incomplete'|'complete';
  newOperationsBlocked: true;
};
export const accountErasureId = (ownerId:string,requestId:string) => createHash('sha256')
  .update(JSON.stringify([ACCOUNT_ERASURE_PROTOCOL,ownerId,requestId])).digest('hex');
export const accountErasureKeyHash = (commandId:string,key:string) => createHash('sha256')
  .update(JSON.stringify([ACCOUNT_ERASURE_PROTOCOL,'observation',commandId,key])).digest('hex');
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export function accountErasureOwn(value:unknown,key:string):boolean {
  return value!==null&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,key);
}
export function accountErasureSourceHash(value:unknown):string {
  const ancestors=new Set<object>();let size=0;
  const fail=():never=>{throw new HttpsError('failed-precondition','Source native invalide.');};
  const canonical=(v:any,depth=0):any=>{
    if(depth>40||(size+=16)>2_000_000)return fail();
    if(v===undefined)return ['absent'];
    if(v===null)return ['null'];
    if(typeof v==='string'){size+=Buffer.byteLength(v,'utf8');return ['string',v];}
    if(typeof v==='boolean')return ['boolean',v];
    if(typeof v==='number')return Number.isFinite(v)?['number',Object.is(v,-0)?'-0':String(v)]:fail();
    if(v instanceof Timestamp)return ['timestamp',v.seconds,v.nanoseconds];
    if(v instanceof GeoPoint)return ['geopoint',v.latitude,v.longitude];
    if(v instanceof DocumentReference)return ['reference',(v.firestore as FirebaseFirestore.Firestore&{projectId:string}).projectId,v.firestore.databaseId,v.path];
    if(v instanceof Uint8Array){size+=v.byteLength*2;return ['bytes',Buffer.from(v).toString('base64')];}
    if(v instanceof Date)return Number.isFinite(v.getTime())?['date',v.toISOString()]:fail();
    if(v instanceof FieldValue||typeof v!=='object'||!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v))||ancestors.has(v))return fail();
    ancestors.add(v);
    const out=Array.isArray(v)?['array',v.map(x=>canonical(x,depth+1))]:['map',Object.keys(v).sort().map(k=>[k,canonical(v[k],depth+1)])];
    ancestors.delete(v);return out;
  };
  const encoded=JSON.stringify(canonical(value));
  if(Buffer.byteLength(encoded,'utf8')>2_000_000)return fail();
  return createHash('sha256').update(encoded).digest('hex');
}
export function hasAccountErasureFence(profile:unknown):boolean {
  return accountErasureOwn(profile,ACCOUNT_ERASURE_FENCE);
}
export function assertNoAccountErasureFence(profile:unknown):void {
  if(hasAccountErasureFence(profile))throw new HttpsError('failed-precondition',
    'La suppression du compte est en cours. Consultez le reçu de cette demande.',
    {reason:'account_erasure_in_progress',action:'observeErasure'});
}
/** No code, ID token, password or provider secret belongs in a durable receipt. */
export function parseAccountErasureRequest(raw:unknown):AccountErasureRequest|AccountErasureRecoveryRequest|AccountErasureRecoveryObservationRequest {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpsError('invalid-argument','Demande de suppression invalide.');
  const v=raw as Record<string,unknown>;
  if(v.operation==='observe_recovery'){
    if(Object.keys(v).some(k=>!['capability','mode','operation','recoveryId','observationKey'].includes(k))||
      v.capability!==ACCOUNT_ERASURE_PROTOCOL||v.mode!=='delete'||!identifier(v.recoveryId)||String(v.recoveryId).length<16||
      typeof v.observationKey!=='string'||!/^[a-f0-9]{64}$/.test(v.observationKey))
      throw new HttpsError('invalid-argument','Référence et clé d’observation requises.');
    return v as AccountErasureRecoveryObservationRequest;
  }
  if(v.operation==='recover_owner'){
    if(Object.keys(v).some(k=>!['capability','mode','operation','expectedUid','recoveryId','observationKey'].includes(k))||
      v.capability!==ACCOUNT_ERASURE_PROTOCOL||v.mode!=='delete'||!identifier(v.expectedUid)||!identifier(v.recoveryId)||
      String(v.recoveryId).length<16||typeof v.observationKey!=='string'||!/^[a-f0-9]{64}$/.test(v.observationKey))
      throw new HttpsError('invalid-argument','Identité courante et nouvelle clé d’observation requises.');
    return v as AccountErasureRecoveryRequest;
  }
  const allowed=['capability','mode','operation','requestId','commandId','observationKey','expectedUid','confirmed','appleAuthorizationCode','appleAuthorizationFlow'];
  if(Object.keys(v).some(k=>!allowed.includes(k))||v.capability!==ACCOUNT_ERASURE_PROTOCOL||v.mode!=='delete'||
    !['request','observe','resume','authorize_apple'].includes(String(v.operation))||
    !identifier(v.requestId)||String(v.requestId).length<16||typeof v.commandId!=='string'||!/^[a-f0-9]{64}$/.test(v.commandId)||
    typeof v.observationKey!=='string'||!/^[a-f0-9]{64}$/.test(v.observationKey))
    throw new HttpsError('invalid-argument','Identité de demande et clé d’observation requises.');
  if(v.operation==='observe') {
    if(['expectedUid','confirmed','appleAuthorizationCode','appleAuthorizationFlow'].some(k=>accountErasureOwn(v,k)))
      throw new HttpsError('invalid-argument','L’observation ne peut envoyer aucune nouvelle instruction.');
  }else if(!identifier(v.expectedUid)||v.operation==='request'&&v.confirmed!==true)
    throw new HttpsError('invalid-argument','Identité courante et confirmation de suppression requises.');
  if(v.operation==='authorize_apple') {
    if(v.appleAuthorizationFlow!=='ios_native'||typeof v.appleAuthorizationCode!=='string'||v.appleAuthorizationCode.length<8||v.appleAuthorizationCode.length>4096||/[\r\n\0]/.test(v.appleAuthorizationCode))
      throw new HttpsError('invalid-argument','Nouvelle autorisation Apple requise.');
  }else if(accountErasureOwn(v,'appleAuthorizationCode')||accountErasureOwn(v,'appleAuthorizationFlow'))throw new HttpsError('invalid-argument','Le code Apple doit rester dans son étape distincte.');
  return v as AccountErasureRequest;
}
export function accountErasureKeyMatches(command:Record<string,any>,input:AccountErasureRequest):boolean {
  if(command.protocol!==ACCOUNT_ERASURE_PROTOCOL||command.commandId!==input.commandId||command.requestId!==input.requestId||
    typeof command.observationKeyHash!=='string'||!/^[a-f0-9]{64}$/.test(command.observationKeyHash))return false;
  return timingSafeEqual(Buffer.from(command.observationKeyHash,'hex'),Buffer.from(accountErasureKeyHash(input.commandId,input.observationKey),'hex'));
}
export function accountErasureReceipt(command:Record<string,any>,now=Date.now(),scope:'capability'|'operator'='capability'):AccountErasureReceipt {
  if(command.protocol!==ACCOUNT_ERASURE_PROTOCOL||!/^[a-f0-9]{64}$/.test(command.commandId??'')||!identifier(command.requestId)||
    !(ACCOUNT_ERASURE_STATES as readonly unknown[]).includes(command.state)||!Number.isSafeInteger(command.version)||command.version<1||
    !(command.updatedAt instanceof Timestamp)||command.updatedAt.toMillis()<1||command.updatedAt.toMillis()>now+60000)
    throw new HttpsError('failed-precondition','Reçu natif à vérifier.');
  const complete=command.state==='completed'&&command.allRequiredEffectsVerified===true&&command.authAbsenceVerified===true&&
    command.completedAt instanceof Timestamp&&command.completedAt.toMillis()>0&&command.completedAt.toMillis()<=now;
  if(command.state==='completed'&&!complete)throw new HttpsError('failed-precondition','La fin de cette suppression n’est pas prouvée.');
  const progress=command.progress;
  if(!progress||!Number.isSafeInteger(progress.completedSteps)||!Number.isSafeInteger(progress.totalSteps)||
    progress.completedSteps<0||progress.totalSteps<1||progress.completedSteps>progress.totalSteps)
    throw new HttpsError('failed-precondition','Progression native à vérifier.');
  // Observation keys intentionally cannot reveal whether a debt, report,
  // contract, named provider or a particular retained object exists.
  const reasons=command.state==='awaiting_obligations'||command.state==='awaiting_review'?['review_pending']:
    command.state==='needs_attention'?['action_required']:command.state==='awaiting_apple_authorization'?['authorization_required']:[];
  const completedAt=complete?command.completedAt.toDate().toISOString():null;
  const expiry=complete?command.completedAt.toMillis()+ACCOUNT_ERASURE_OBSERVATION_DAYS_AFTER_COMPLETION*86400_000:null;
  if(scope==='capability'&&expiry!==null&&now>expiry)throw new HttpsError('not-found','Ce reçu n’est plus disponible.');
  return {kind:ACCOUNT_ERASURE_RECEIPT,commandId:command.commandId,requestId:command.requestId,state:command.state,
    version:command.version,accountAccessClosed:command.fenceCommitted===true,deletionComplete:complete,
    appleAuthorizationRequired:command.state==='awaiting_apple_authorization',
    progress:{completedSteps:progress.completedSteps,totalSteps:progress.totalSteps},
    reasons,retentionPolicyVersion:typeof command.retentionPolicyVersion==='string'?command.retentionPolicyVersion:'not_qualified',
    updatedAt:command.updatedAt.toDate().toISOString(),completedAt,
    observationExpiresAt:expiry===null?null:new Date(expiry).toISOString(),success:complete,
    status:complete?'complete':'incomplete',newOperationsBlocked:true};
}
