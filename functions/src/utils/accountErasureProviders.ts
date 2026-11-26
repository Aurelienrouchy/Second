/** External erasure transports. Only bounded native provider results can
 * complete a step. Codes/ID tokens/API keys and response bodies are not logged. */
import {Timestamp} from 'firebase-admin/firestore';
import {db,auth} from '../config/firebase';
import {isProductionRuntime,requireRuntimeProjectId} from '../config/runtimeEnvironment';
import {assertAccountErasureContinuation} from './accountErasureRuntime';
import {accountErasureSourceHash} from './accountErasureContract';
import {readAccountErasureNoCollectionQualification,readAccountErasurePosthogQualification} from './accountErasureQualification';
type Data=FirebaseFirestore.DocumentData;
const hash=accountErasureSourceHash,posthogHost='https://us.posthog.com',posthogProject='407000';
const json=async(response:Response):Promise<any>=>{
  const body=await response.text();if(Buffer.byteLength(body,'utf8')>256*1024)throw new Error('Provider response exceeds bound.');
  return JSON.parse(body);
};
const pending=(reason:string,value:unknown)=>({verified:false,proofHash:hash(value),reason});
const stamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
export function completedPosthogDeletion(value:unknown,personUuid:string,intentionAt:number):boolean{
  if(!value||typeof value!=='object')return false;
  const row=value as Data,created=stamp(row.created_at),verified=stamp(row.delete_verified_at);
  return row.person_uuid===personUuid&&row.status==='completed'&&created!==null&&created>=intentionAt&&created<=Date.now()&&
    verified!==null&&verified>=intentionAt&&verified>=created&&verified<=Date.now();
}
const uuidValue=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const nativePersonUuid=(person:Data)=>uuidValue(person.uuid)?person.uuid:uuidValue(person.id)?person.id:null;
const sqlLiteral=(v:string)=>"'"+v.replace(/\\/g,'\\\\').replace(/'/g,"\\'")+"'";
export function posthogErasureAbsenceQuery(ids:string[],historyStart:string):string{
  if(!ids.length||ids.length>1000||ids.some(v=>typeof v!=='string'||!v||Buffer.byteLength(v)>1024||/[\r\n\0]/.test(v)))throw new Error('Provider subject aliases unqualified.');
  if(!Number.isFinite(Date.parse(historyStart))||Date.parse(historyStart)>Date.now())throw new Error('Qualified history lower bound required.');
  const values=ids.map(sqlLiteral).join(','),lower=new Date(historyStart).toISOString().slice(0,19).replace('T',' ');
  return `SELECT (SELECT count() FROM events WHERE timestamp >= toDateTime('${lower}', 'UTC') AND distinct_id IN (${values})) AS event_count, `+
    `(SELECT count() FROM session_replay_events WHERE distinct_id IN (${values}) AND is_deleted = 0) AS recording_count`;
}
export async function eraseAccountPosthog(command:Data){
  const noCollection=await readAccountErasureNoCollectionQualification(command);
  if(noCollection.verified)return {verified:true,proofHash:hash({protocol:'post_cutoff_account_no_collection_v1',
    qualificationSourceHash:noCollection.sourceHash,authBirthHash:hash(command.authSource),historicalSubjectsQualified:false}),reason:null};
  if(!isProductionRuntime())return {verified:true,proofHash:hash({protocol:'posthog_dev_capture_disabled_v1',project:requireRuntimeProjectId()}),reason:null};
  if(requireRuntimeProjectId()!=='seconde-b47a6')return pending('provider_project_unqualified',{state:'unqualified'});
  const key=process.env.POSTHOG_ERASURE_API_KEY;
  if(!key)return pending('posthog_operator_credential_required',{state:'credential_unavailable'});
  const qualification=await readAccountErasurePosthogQualification(command);
  if(!qualification)return pending('posthog_ingestion_guard_requires_qualification',{state:'unqualified'});
  const ref=db.collection('account_erasure_commands').doc(command.commandId).collection('processors').doc('posthog'),
    headers={Authorization:'Bearer '+key,'Content-Type':'application/json'},base=posthogHost+'/api/projects/'+posthogProject+'/',
    request=async(path:string,options:RequestInit={})=>{
      await assertAccountErasureContinuation(command);
      return fetch(base+path,{...options,headers,redirect:'error',signal:AbortSignal.timeout(10000)});
    };
  const absence=async(ids:string[])=>{
    const query=posthogErasureAbsenceQuery(ids,qualification.historyStart),response=await request('query/',{method:'POST',body:JSON.stringify({
      query:{kind:'HogQLQuery',query},refresh:'force_blocking',async:false})});
    if(response.status!==200)return null;
    const body=await json(response),refresh=stamp(body.last_refresh);
    if(body.is_cached===true||refresh===null||refresh<command.requestedAt.toMillis()||refresh>Date.now()||
      !Array.isArray(body.results)||body.results.length!==1||!Array.isArray(body.results[0])||body.results[0].length!==2||
      body.results[0].some((v:unknown)=>!Number.isSafeInteger(v)||(v as number)<0)||
      !Array.isArray(body.columns)||body.columns.join(',')!=='event_count,recording_count')return null;
    return {eventCount:body.results[0][0] as number,recordingCount:body.results[0][1] as number,queryHash:hash(query),
      refreshedAt:body.last_refresh,ingestionQualificationHash:qualification.sourceHash};
  };
  const poll=async(uuid:string)=>{
    for(let offset=0;offset<1000;offset+=100){
      const response=await request('persons/deletion_status/?person_uuid='+encodeURIComponent(uuid)+'&status=all&limit=100&offset='+offset);
      if(response.status!==200)return null;
      const body=await json(response);
      if(!Array.isArray(body.results)||body.results.length>100||!Number.isSafeInteger(body.count)||body.count<0)return null;
      const row=body.results.find((v:unknown)=>completedPosthogDeletion(v,uuid,command.requestedAt.toMillis()));
      if(row)return row;
      if(body.next==null)return null;
    }
    return null;
  };
  const verifyKnown=async(current:Data,row:Data)=>{
    const ids=current.identity.distinctIds;
    if(!Array.isArray(ids)||hash([...ids].sort())!==current.identity.distinctIdsHash)return pending('posthog_aliases_require_review',{state:'alias_inventory_missing'});
    const counts=await absence(ids);
    if(!counts||counts.eventCount!==0||counts.recordingCount!==0)return pending('posthog_verification_pending',{state:'events_or_recordings_not_absent'});
    const person=await request('persons/'+encodeURIComponent(current.identity.personUuid)+'/');
    if(person.status!==404)return pending('posthog_verification_pending',{state:'profile_absence_not_observed'});
    const proof={protocol:'posthog_account_erasure_verified_v1',personUuid:current.identity.personUuid,
      intentionHash:hash(current.identity),createdAt:row.created_at,deleteVerifiedAt:row.delete_verified_at,
      counts,acceptanceHash:current.acceptanceHash??null,status:'completed',projectId:posthogProject,host:posthogHost,
      submissionOutcomeReconciledFromNative:current.state!=='accepted'};
    const proofHash=hash(proof),{distinctIds:discarded,...minimalIdentity}=current.identity;void discarded;
    await ref.update({state:'verified',identity:minimalIdentity,proof,proofHash,verifiedAt:Timestamp.now()});
    return {verified:true,proofHash,reason:null};
  };
  let current=(await ref.get()).data();
  if(['verified','absence_verified'].includes(current?.state))return {verified:true,proofHash:current!.proofHash,reason:null};
  if(!current){
    const response=await request('persons/?distinct_id='+encodeURIComponent(command.ownerId)+'&limit=2');
    if(response.status!==200)return pending('posthog_lookup_pending',{status:response.status});
    const native=await json(response);
    if(!Array.isArray(native.results)||native.next!=null||native.results.length>1)return pending('posthog_subject_requires_review',{state:'subject_not_uniquely_observed'});
    if(native.results.length===0){
      const counts=await absence([command.ownerId]);
      if(counts&&counts.eventCount===0&&counts.recordingCount===0&&qualification.kind==='project_ingestion_closed'){
        const proof={protocol:'posthog_native_subject_absence_v1',subjectHash:hash(command.ownerId),personAbsent:true,counts,
          notUsedInferred:false,projectId:posthogProject,host:posthogHost},proofHash=hash(proof);
        await ref.set({state:'absence_verified',proof,proofHash,verifiedAt:Timestamp.now()});return {verified:true,proofHash,reason:null};
      }
      // The operator may use the documented minimal privacy $set -> delete
      // workflow. No product event or fabricated never-used proof is emitted.
      return pending('posthog_personless_history_requires_erasure',{state:'native_absence_or_future_ingestion_not_qualified'});
    }
    const person=native.results[0],uuid=nativePersonUuid(person);
    if(!uuid||!Array.isArray(person.distinct_ids)||person.distinct_ids.length>1000||!person.distinct_ids.includes(command.ownerId)||
      person.distinct_ids.some((v:unknown)=>typeof v!=='string'))return pending('posthog_subject_requires_review',{state:'subject_native_shape_unqualified'});
    for(const alias of person.distinct_ids){if(alias===command.ownerId||alias.length<1||alias.length>128||alias.includes('/'))continue;
      try{const other=await auth.getUser(alias);if(other.uid!==command.ownerId)return pending('posthog_alias_requires_review',{state:'other_native_account_alias'});}
      catch(error){if((error as any)?.code!=='auth/user-not-found')throw error;}
    }
    const identity={protocol:'posthog_account_erasure_v1',commandId:command.commandId,ownerId:command.ownerId,personUuid:uuid,
      distinctIdsHash:hash([...person.distinct_ids].sort()),distinctIdCount:person.distinct_ids.length,distinctIds:[...person.distinct_ids].sort(),
      deleteEvents:true,deleteRecordings:true,keepPerson:false,projectId:posthogProject,host:posthogHost,inputHash:command.inputHash};
    await db.runTransaction(async tx=>{const job=(await tx.get(db.collection('account_erasure_commands').doc(command.commandId))).data(),prior=(await tx.get(ref)).data();
      if(job?.inputHash!==command.inputHash||job?.fenceCommitted!==true)throw new Error('Provider erasure intention changed.');
      if(prior){if(hash(prior.identity)!==hash(identity))throw new Error('Provider erasure subject changed.');return;}
      tx.create(ref,{identity,state:'prepared',preparedAt:Timestamp.now(),acceptedAt:null});});
    current=(await ref.get()).data()!;
  }
  if(current.identity?.inputHash!==command.inputHash||current.identity?.ownerId!==command.ownerId||current.identity?.projectId!==posthogProject||
    current.identity?.host!==posthogHost||!uuidValue(current.identity?.personUuid))return pending('posthog_subject_requires_review',{state:'native_intention_changed'});
  // A lost response/commit may leave PREPARED after native completion. Always
  // reconcile the immutable UUID first; never resolve a different person anew.
  const known=await poll(current.identity.personUuid);
  if(known)return verifyKnown(current,known);
  if(current.state==='accepted')return pending('posthog_verification_pending',{state:'native_completion_not_observed'});
  const detail=await request('persons/'+encodeURIComponent(current.identity.personUuid)+'/');
  if(detail.status!==200)return pending('posthog_verification_pending',{state:'known_subject_already_absent_or_unavailable'});
  const native=await json(detail);
  if(nativePersonUuid(native)!==current.identity.personUuid||!Array.isArray(native.distinct_ids)||
    hash([...native.distinct_ids].sort())!==current.identity.distinctIdsHash)return pending('posthog_aliases_changed',{state:'native_aliases_changed_before_effect'});
  const response=await request('persons/bulk_delete/',{method:'POST',body:JSON.stringify({ids:[current.identity.personUuid],
    delete_events:true,delete_recordings:true,keep_person:false})});
  if(response.status!==202)return pending('posthog_submission_pending',{status:response.status});
  const accepted=await json(response);
  if(!Number.isSafeInteger(accepted.persons_found)||accepted.persons_found<0||accepted.persons_found>1||!Number.isSafeInteger(accepted.persons_deleted)||
    !Number.isSafeInteger(accepted.persons_queued_for_deletion)||accepted.events_queued_for_deletion!==true||
    accepted.recordings_queued_for_deletion!==true||!Array.isArray(accepted.deletion_errors)||accepted.deletion_errors.length)
    return pending('posthog_submission_requires_review',{state:'acceptance_not_qualified'});
  await ref.update({state:'accepted',acceptedAt:Timestamp.now(),acceptanceHash:hash({personsFound:accepted.persons_found,
    personsDeleted:accepted.persons_deleted,personsQueued:accepted.persons_queued_for_deletion,eventsQueued:true,recordingsQueued:true})});
  current=(await ref.get()).data()!;
  const completed=await poll(current.identity.personUuid);
  return completed?verifyKnown(current,completed):pending('posthog_verification_pending',{state:'native_completion_not_observed'});
}
/** Exact iOS SDK request shape, not the Android/web CODE redirect flow.
 * https://github.com/firebase/firebase-ios-sdk/blob/main/FirebaseAuth/Sources/Swift/Backend/RPC/RevokeTokenRequest.swift */
export async function revokeNativeAppleForErasure(command:Data,code:string,idToken:string):Promise<{state:'revoked'|'unknown';proofHash:string}>{
  const project=requireRuntimeProjectId(),key=process.env.ACCOUNT_ERASURE_APPLE_API_KEY,
    bundle=process.env.ACCOUNT_ERASURE_APPLE_IOS_BUNDLE_ID,appId=process.env.ACCOUNT_ERASURE_APPLE_IOS_APP_ID;
  const expected=project==='seconde-b47a6'?'com.seconde.app':project==='seconde-dev'?'com.seconde.app.dev':null;
  const unknown=(status:string)=>({state:'unknown' as const,proofHash:hash({protocol:'apple_native_revocation_observation_v1',
    commandId:command.commandId,codeHash:hash(code),status})});
  if(command.transientAppleFlow!=='ios_native'||!key||!command.authSource?.providers?.includes('apple.com')||
    bundle!==expected||!appId||!/^1:\d+:ios:[a-f0-9]+$/.test(appId))return unknown('configuration_unqualified');
  // The callable engine freshly verifies the authenticated owner, linked Apple
  // native subject and ephemeral ID token before entering this transport.
  try{
    const response=await fetch('https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key='+encodeURIComponent(key),{
      method:'POST',headers:{'Content-Type':'application/json','X-Ios-Bundle-Identifier':bundle,'X-Firebase-GMPID':appId},
      body:JSON.stringify({providerId:'apple.com',tokenType:'3',token:code,idToken}),redirect:'error',signal:AbortSignal.timeout(10000)});
    if(response.status!==200)return unknown('http_'+response.status);
    const body=await json(response);if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)return unknown('response_unqualified');
    return {state:'revoked',proofHash:hash({protocol:'apple_native_revocation_verified_v1',commandId:command.commandId,
      authSourceHash:hash(command.authSource),codeHash:hash(code),projectId:project,flow:command.transientAppleFlow,
      bundleId:bundle,appId,status:200,observedAt:Timestamp.now()})};
  }catch{return unknown('transport_outcome_unknown');}
}
