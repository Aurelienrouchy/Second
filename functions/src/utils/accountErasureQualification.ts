/** Immutable operator qualification from the independently controlled bucket.
 * Never self-certified by an erasure command, a restored database or a client. */
import {readFinancialRecoveryPinnedObject,readFinancialRecoveryControl,withFinancialRecoveryIoBudget} from '../config/recoveryControl';
import {ACCOUNT_ERASURE_INVENTORY_HASH} from './accountErasureRuntime';
import {ACCOUNT_ERASURE_POLICY_VERSION} from './accountErasurePolicy';
import {accountErasureSourceHash} from './accountErasureContract';
type Data=FirebaseFirestore.DocumentData;
type PosthogGuard={kind:'project_ingestion_closed'|'native_person_tombstone';historyStart:string};
/** This proves a provider boundary, not that a newly born Auth identity has
 * never run an older client. Session recording disabled is insufficient. */
function posthogGuard(value:Data):PosthogGuard|null{
  const guard=value.posthogLateIngestionGuard;
  if(value.firestoreProjectId!=='seconde-b47a6'||!guard||!['project_ingestion_closed','native_person_tombstone'].includes(guard.kind)||
    guard.projectId!=='407000'||guard.host!=='https://us.posthog.com'||guard.qualified!==true||
    !/^[a-f0-9]{64}$/.test(guard.fixtureSha256??'')||typeof guard.historyStart!=='string'||
    !Number.isFinite(Date.parse(guard.historyStart))||Date.parse(guard.historyStart)>Date.now())return null;
  return {kind:guard.kind,historyStart:new Date(guard.historyStart).toISOString()};
}
export async function readAccountErasureWriterQualification(command:Data,phase:'admission'|'completion'='admission'):Promise<{verified:boolean;sourceHash:string}>{
  return withFinancialRecoveryIoBudget(async()=>{
    const invalid={verified:false,sourceHash:accountErasureSourceHash({state:'qualification_unavailable'})};
    const env=process.env,pin={object:env.ACCOUNT_ERASURE_QUALIFICATION_OBJECT??'',generation:env.ACCOUNT_ERASURE_QUALIFICATION_GENERATION??'',sha256:env.ACCOUNT_ERASURE_QUALIFICATION_SHA256??''};
    if(!pin.object||!pin.generation||!/^[a-f0-9]{64}$/.test(pin.sha256)||
      !/^[a-f0-9]{64}$/.test(env.ACCOUNT_ERASURE_SERVER_SOURCE_SHA256??'')||
      !/^[a-f0-9]{64}$/.test(env.ACCOUNT_ERASURE_FIRESTORE_RULES_SHA256??'')||
      !/^[a-f0-9]{64}$/.test(env.ACCOUNT_ERASURE_STORAGE_RULES_SHA256??''))return invalid;
    let value:Data;
    try{value=JSON.parse((await readFinancialRecoveryPinnedObject(pin)).toString('utf8'));}catch{return invalid;}
    const q=await readFinancialRecoveryControl(),at=Date.parse(value.qualifiedAt),until=Date.parse(value.expiresAt),
      nativeControl={epoch:q.control.epoch,generation:q.generation,sha256:q.sha256};
    const scope=value.acquisitionScope;
    const population=value.newPopulation,cutoff=Date.parse(population?.authCreatedStrictlyAfter??''),providerGuard=posthogGuard(value);
    const populationQualified=population?.protocol==='account_erasure_new_population_v1'&&
      Number.isSafeInteger(cutoff)&&cutoff>0&&cutoff<=Date.now()&&Number.isSafeInteger(command.authSource?.createdAtMs)&&
      command.authSource.createdAtMs>cutoff&&(scope?.kind==='synthetic_identity_isolation'?
        population.noPreviousClientsForReservedSubjects===true:providerGuard!==null&&
          Date.parse(providerGuard.historyStart)<=command.authSource.createdAtMs)&&
      population.nativeClientAnalyticsDisabled===true&&population.serverAnalyticsDisabled===true&&
      /^[a-f0-9]{64}$/.test(population.nativeClientSourceSha256??'');
    const acquisitionsQualified=scope?.kind==='legacy_global_closed'&&q.installation.firestoreProjectId==='seconde-b47a6'&&value.legacyAcquisitionsClosed===true||
      scope?.kind==='synthetic_identity_isolation'&&q.installation.firestoreProjectId==='seconde-dev'&&
      scope.legacyAdmissionHistory==='none_for_reserved_identities'&&scope.legacyWritersInScopeQualified===true&&
      /^[a-f0-9]{64}$/.test(scope.matrixSha256??'')&&Array.isArray(scope.subjectHashes)&&scope.subjectHashes.length>0&&scope.subjectHashes.length<=50&&
      scope.subjectHashes.includes(accountErasureSourceHash(command.ownerId))&&Array.isArray(scope.nativeBirthHashes)&&
      scope.nativeBirthHashes.includes(accountErasureSourceHash(command.authSource));
    const verified=value.protocol==='account_erasure_writer_qualification_v1'&&value.installationId===q.installation.installationId&&
      value.firestoreProjectId===q.installation.firestoreProjectId&&value.firestoreDatabaseId===q.installation.firestoreDatabaseId&&
      q.control.mode==='normal'&&q.control.financialEnvironment==='unconfigured'&&q.control.previousEpoch===null&&
      value.control?.epoch===nativeControl.epoch&&value.control?.generation===nativeControl.generation&&value.control?.sha256===nativeControl.sha256&&
      command.control?.installationId===q.installation.installationId&&command.control?.epoch===q.control.epoch&&
      command.control?.generation===q.generation&&command.control?.sourceHash===q.sha256&&
      value.policyVersion===ACCOUNT_ERASURE_POLICY_VERSION&&value.inventoryHash===ACCOUNT_ERASURE_INVENTORY_HASH&&
      value.serverSourceSha256===env.ACCOUNT_ERASURE_SERVER_SOURCE_SHA256&&
      value.firestoreRulesSha256===env.ACCOUNT_ERASURE_FIRESTORE_RULES_SHA256&&value.storageRulesSha256===env.ACCOUNT_ERASURE_STORAGE_RULES_SHA256&&
      Number.isSafeInteger(at)&&at>0&&at<=Date.now()&&Number.isSafeInteger(until)&&until>at&&until>Date.now()&&
      acquisitionsQualified&&populationQualified&&value.admittedInvocationsDrained===true&&value.registeredWritersQualified===true&&
      (phase==='admission'||value.lateStorageFinalizationGuardQualified===true&&/^[a-f0-9]{64}$/.test(value.lateStorageFinalizationFixtureSha256??''))&&
      value.financialAuthority==='not_asserted'&&typeof value.operatorId==='string'&&value.operatorId.length>0;
    return {verified,sourceHash:pin.sha256};
  });
}
/** Only the reserved Dev fixtures have the separately attested no-collection
 * scope. Production has distributed older clients: Auth birth and today's
 * disabled PostHog client/server capture never prove that subject's absence.
 * This concerns Seconde PostHog, not all Google/Firebase SDK telemetry. */
export async function readAccountErasureNoCollectionQualification(command:Data):Promise<{verified:boolean;sourceHash:string}>{
  const q=await readAccountErasureWriterQualification(command,'admission');
  if(!q.verified)return {verified:false,sourceHash:q.sourceHash};
  const control=await readFinancialRecoveryControl();
  return {verified:control.installation.firestoreProjectId==='seconde-dev',sourceHash:q.sourceHash};
}
export async function readAccountErasurePosthogQualification(command:Data):Promise<{kind:'project_ingestion_closed'|'native_person_tombstone';sourceHash:string;historyStart:string}|null>{
  if(!(await readAccountErasureWriterQualification(command)).verified)return null;
  const pin={object:process.env.ACCOUNT_ERASURE_QUALIFICATION_OBJECT??'',generation:process.env.ACCOUNT_ERASURE_QUALIFICATION_GENERATION??'',
    sha256:process.env.ACCOUNT_ERASURE_QUALIFICATION_SHA256??''};
  try{
    const value=JSON.parse((await readFinancialRecoveryPinnedObject(pin)).toString('utf8')),guard=posthogGuard(value);
    return guard?{...guard,sourceHash:pin.sha256}:null;
  }catch{return null;}
}
