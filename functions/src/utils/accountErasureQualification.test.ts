import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({value:{} as any,control:{} as any}));
vi.mock('./accountErasureRuntime',()=>({ACCOUNT_ERASURE_INVENTORY_HASH:'a'.repeat(64)}));
vi.mock('../config/recoveryControl',()=>({withFinancialRecoveryIoBudget:(fn:any)=>fn(),readFinancialRecoveryPinnedObject:async()=>Buffer.from(JSON.stringify(h.value)),
  readFinancialRecoveryControl:async()=>h.control}));
import {readAccountErasureWriterQualification,readAccountErasureNoCollectionQualification,readAccountErasurePosthogQualification} from './accountErasureQualification';
import {accountErasureSourceHash} from './accountErasureContract';
const cutoff=Date.now()-10000;let command:any;
beforeEach(()=>{
  command={ownerId:'synthetic-owner',authSource:{uid:'synthetic-owner',createdAtMs:cutoff+1000},
    control:{installationId:'installation',epoch:'initial',generation:'1',sourceHash:'b'.repeat(64)}};
  h.control={installation:{installationId:'installation',firestoreProjectId:'seconde-b47a6',firestoreDatabaseId:'(default)'},
    control:{epoch:'initial',mode:'normal',financialEnvironment:'unconfigured',previousEpoch:null},generation:'1',sha256:'b'.repeat(64)};
  h.value={protocol:'account_erasure_writer_qualification_v1',installationId:'installation',firestoreProjectId:'seconde-b47a6',firestoreDatabaseId:'(default)',
    control:{epoch:'initial',generation:'1',sha256:'b'.repeat(64)},qualifiedAt:new Date(cutoff).toISOString(),expiresAt:new Date(Date.now()+86400_000).toISOString(),
    policyVersion:'seconde-erasure-2026-11-25-v1',inventoryHash:'a'.repeat(64),serverSourceSha256:'c'.repeat(64),firestoreRulesSha256:'d'.repeat(64),storageRulesSha256:'e'.repeat(64),
    acquisitionScope:{kind:'legacy_global_closed'},legacyAcquisitionsClosed:true,admittedInvocationsDrained:true,registeredWritersQualified:true,
    financialAuthority:'not_asserted',operatorId:'fixture-operator',
    posthogLateIngestionGuard:{kind:'project_ingestion_closed',projectId:'407000',host:'https://us.posthog.com',
      qualified:true,fixtureSha256:'5'.repeat(64),historyStart:new Date(cutoff).toISOString()},
    newPopulation:{protocol:'account_erasure_new_population_v1',
      authCreatedStrictlyAfter:new Date(cutoff).toISOString(),noPreviousClientDistribution:true,nativeClientAnalyticsDisabled:true,
      serverAnalyticsDisabled:true,nativeClientSourceSha256:'f'.repeat(64)}};
  for(const [name,value] of Object.entries({ACCOUNT_ERASURE_QUALIFICATION_OBJECT:'fixture/manifests/erasure.json',ACCOUNT_ERASURE_QUALIFICATION_GENERATION:'1',
    ACCOUNT_ERASURE_QUALIFICATION_SHA256:'1'.repeat(64),ACCOUNT_ERASURE_SERVER_SOURCE_SHA256:'c'.repeat(64),
    ACCOUNT_ERASURE_FIRESTORE_RULES_SHA256:'d'.repeat(64),ACCOUNT_ERASURE_STORAGE_RULES_SHA256:'e'.repeat(64)}))vi.stubEnv(name,value);
});
afterEach(()=>vi.unstubAllEnvs());
describe('operator-qualified new population and two-phase completion',()=>{
  it.each(['project_ingestion_closed','native_person_tombstone'])('qualifies writers with the native %s guard despite previous distribution, without asserting no collection',async kind=>{
    h.value.newPopulation.noPreviousClientDistribution=false;
    h.value.posthogLateIngestionGuard.kind=kind;
    expect((await readAccountErasureWriterQualification(command)).verified).toBe(true);
    expect((await readAccountErasureNoCollectionQualification(command)).verified).toBe(false);
    expect((await readAccountErasurePosthogQualification(command))?.kind).toBe(kind);
  });
  it('never turns production writer qualification into a no-collection proof, including a mistaken distribution assertion',async()=>{
    h.value.newPopulation.noPreviousClientDistribution=true;
    expect((await readAccountErasureWriterQualification(command)).verified).toBe(true);
    expect((await readAccountErasureNoCollectionQualification(command)).verified).toBe(false);
  });
  it('does not admit production writers without a native PostHog guard even if a draft claims no previous distribution',async()=>{
    delete h.value.posthogLateIngestionGuard;
    expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
  });
  it('does not let the provider verification omit the interval after the account was born',async()=>{
    h.value.posthogLateIngestionGuard.historyStart=new Date(command.authSource.createdAtMs+1000).toISOString();
    expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
  });
  it.each([
    ['projectId','another-project'],['host','https://other.example'],['qualified',false],
    ['fixtureSha256','not-qualified'],['kind','session_recording_disabled'],['historyStart','2999-01-01T00:00:00.000Z'],
  ])('rejects a native PostHog guard with unqualified %s',async(field,value)=>{
    h.value.posthogLateIngestionGuard[field]=value;
    expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
  });
  it('admits a strictly post-cutoff identity but cannot delete Auth before the finalizer fixture is qualified',async()=>{
    expect((await readAccountErasureWriterQualification(command,'admission')).verified).toBe(true);
    expect((await readAccountErasureWriterQualification(command,'completion')).verified).toBe(false);
    h.value.lateStorageFinalizationGuardQualified=true;h.value.lateStorageFinalizationFixtureSha256='2'.repeat(64);
    expect((await readAccountErasureWriterQualification(command,'completion')).verified).toBe(true);
  });
  it.each([-1,0])('never extends the no-collection proof to a subject born at/before the cutoff (%s)',async offset=>{
    command.authSource.createdAtMs=cutoff+offset;
    expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
    expect((await readAccountErasureNoCollectionQualification(command)).verified).toBe(false);
  });
  it.each(['serverAnalyticsDisabled','nativeClientAnalyticsDisabled','noPreviousClientDistribution'])('does not qualify an unproved %s statement',async field=>{
    h.value.newPopulation[field]=false;expect((await readAccountErasureNoCollectionQualification(command)).verified).toBe(false);
  });
  it.each(['serverSourceSha256','firestoreRulesSha256','storageRulesSha256','inventoryHash'])('rejects a different %s',async field=>{
    h.value[field]='3'.repeat(64);expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
  });
  it('rejects expiry, restoration, changed generation and a missing population',async()=>{
    const original=structuredClone(h.value);h.value.expiresAt=new Date(Date.now()-1).toISOString();expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
    h.value=structuredClone(original);h.control.control.previousEpoch='restored';expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
    h.control.control.previousEpoch=null;h.control.generation='2';expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
    h.control.generation='1';h.value.newPopulation=null;expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
  });
  it('bounds Dev to reserved native subjects without closing or misrepresenting ordinary TEST traffic',async()=>{
    h.control.installation.firestoreProjectId='seconde-dev';h.value.firestoreProjectId='seconde-dev';h.value.legacyAcquisitionsClosed=false;
    h.value.acquisitionScope={kind:'synthetic_identity_isolation',legacyAdmissionHistory:'none_for_reserved_identities',legacyWritersInScopeQualified:true,
      matrixSha256:'4'.repeat(64),subjectHashes:[accountErasureSourceHash(command.ownerId)],nativeBirthHashes:[accountErasureSourceHash(command.authSource)]};
    delete h.value.newPopulation.noPreviousClientDistribution;h.value.newPopulation.noPreviousClientsForReservedSubjects=true;
    expect((await readAccountErasureWriterQualification(command)).verified).toBe(true);
    expect((await readAccountErasureNoCollectionQualification(command)).verified).toBe(true);
    command.ownerId='unreserved';expect((await readAccountErasureWriterQualification(command)).verified).toBe(false);
  });
});
