import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
const h=await vi.hoisted(async()=>{const {createFirestoreMock}=await import('./testHelpers/firestoreMock');return {fs:createFirestoreMock({enforceReadBeforeWrite:true}),guard:vi.fn(),qualification:vi.fn(),population:vi.fn()};});
vi.mock('../config/firebase',()=>({db:h.fs.db,auth:{getUser:async()=>{throw Object.assign(new Error('absent'),{code:'auth/user-not-found'});}}}));
vi.mock('./accountErasureRuntime',()=>({assertAccountErasureContinuation:(...args:any[])=>h.guard(...args)}));
vi.mock('./accountErasureQualification',()=>({readAccountErasurePosthogQualification:(...args:any[])=>h.qualification(...args),
  readAccountErasureNoCollectionQualification:(...args:any[])=>h.population(...args)}));
import {eraseAccountPosthog,revokeNativeAppleForErasure,completedPosthogDeletion} from './accountErasureProviders';
import {accountErasureSourceHash} from './accountErasureContract';
const id='a'.repeat(64),uuid='550e8400-e29b-41d4-a716-446655440000';
let command:any,fetchMock:ReturnType<typeof vi.fn>;
const response=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const person=()=>({results:[{id:17,uuid,distinct_ids:['synthetic-owner','anonymous-fixture']}],next:null});
const emptyStatus=()=>({count:0,results:[],next:null});
const zeroCounts=()=>({results:[[0,0]],columns:['event_count','recording_count'],is_cached:false,last_refresh:new Date().toISOString()});
const accepted=()=>({persons_found:1,persons_deleted:0,persons_queued_for_deletion:1,events_queued_for_deletion:true,
  recordings_queued_for_deletion:true,deletion_errors:[]});
const status=(state='completed',different=uuid)=>({next:null,previous:null,count:1,results:[{person_uuid:different,
  created_at:new Date(Date.now()-1000).toISOString(),status:state,delete_verified_at:state==='completed'?new Date(Date.now()-500).toISOString():null}]});
beforeEach(()=>{
  h.fs.reset();h.guard.mockReset();h.guard.mockResolvedValue(undefined);fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);
  h.qualification.mockReset();h.qualification.mockResolvedValue({kind:'project_ingestion_closed',sourceHash:'d'.repeat(64),historyStart:'1970-01-01T00:00:00.000Z'});
  h.population.mockReset();h.population.mockResolvedValue({verified:false,sourceHash:'d'.repeat(64)});
  vi.stubEnv('GCLOUD_PROJECT','seconde-b47a6');vi.stubEnv('SECONDE_PROJECT_ID','seconde-b47a6');vi.stubEnv('SECONDE_ENV','production');
  vi.stubEnv('POSTHOG_ERASURE_API_KEY','synthetic-personal-api-key');
  command={commandId:id,ownerId:'synthetic-owner',inputHash:'b'.repeat(64),requestedAt:Timestamp.fromMillis(Date.now()-10000),
    fenceCommitted:true,authSource:{providers:['apple.com']},transientAppleFlow:'ios_native'};
  h.fs.setDoc('account_erasure_commands/'+id,command);
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('qualified PostHog deletion provider',()=>{
  it('verifies native person/event/recording absence for a never-collected subject without claiming not_used',async()=>{
    fetchMock.mockResolvedValueOnce(response({results:[],next:null})).mockResolvedValueOnce(response({results:[[0,0]],
      columns:['event_count','recording_count'],is_cached:false,last_refresh:new Date().toISOString()}));
    const result=await eraseAccountPosthog(command);expect(result.verified).toBe(true);
    expect(JSON.stringify(h.fs.getDoc('account_erasure_commands/'+id+'/processors/posthog'))).not.toContain('not_used');
    expect(fetchMock.mock.calls.some(c=>String(c[0]).includes('/query/'))).toBe(true);
  });
  it('reconciles a lost bulk response by the already-persisted UUID without another delete',async()=>{
    const identity={protocol:'posthog_account_erasure_v1',commandId:id,ownerId:command.ownerId,personUuid:uuid,
      distinctIdsHash:accountErasureSourceHash([command.ownerId]),distinctIdCount:1,distinctIds:[command.ownerId],deleteEvents:true,deleteRecordings:true,keepPerson:false,
      projectId:'407000',host:'https://us.posthog.com',inputHash:command.inputHash};
    h.fs.setDoc('account_erasure_commands/'+id+'/processors/posthog',{identity,state:'prepared',preparedAt:Timestamp.now(),acceptedAt:null});
    fetchMock.mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response({results:[[0,0]],columns:['event_count','recording_count'],
      is_cached:false,last_refresh:new Date().toISOString()})).mockResolvedValueOnce(response({},404));
    expect((await eraseAccountPosthog(command)).verified).toBe(true);
    expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/bulk_delete/'))).toHaveLength(0);
  });
  it('accepts a request without credentials without pretending analytics was never used',async()=>{
    vi.stubEnv('POSTHOG_ERASURE_API_KEY','');const result=await eraseAccountPosthog(command);
    expect(result.verified).toBe(false);expect(result.reason).toBe('posthog_operator_credential_required');expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not call missing person/history absent a verified historical request not_used',async()=>{
    fetchMock.mockImplementation(async()=>response({results:[],next:null}));expect((await eraseAccountPosthog(command)).verified).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('persists native subject and desired deletion before submitting, then verifies the correlated provider result',async()=>{
    fetchMock.mockResolvedValueOnce(response(person())).mockResolvedValueOnce(response(emptyStatus()))
      .mockResolvedValueOnce(response(person().results[0])).mockImplementationOnce(async(url:any,options:any)=>{
      const prepared=h.fs.getDoc('account_erasure_commands/'+id+'/processors/posthog');expect(prepared?.state).toBe('prepared');
      expect(String(url)).toBe('https://us.posthog.com/api/projects/407000/persons/bulk_delete/');
      expect(JSON.parse(options.body)).toEqual({ids:[uuid],delete_events:true,delete_recordings:true,keep_person:false});
      return response(accepted(),202);
    }).mockResolvedValueOnce(response(status())).mockResolvedValueOnce(response(zeroCounts())).mockResolvedValueOnce(response({},404));
    expect((await eraseAccountPosthog(command)).verified).toBe(true);
    const saved=h.fs.getDoc('account_erasure_commands/'+id+'/processors/posthog')!;
    expect(saved.state).toBe('verified');expect(JSON.stringify(saved)).not.toContain('synthetic-personal-api-key');
    expect(saved.identity.personUuid).toBe(uuid);expect(saved.identity).not.toHaveProperty('distinct_ids');
    expect(h.guard).toHaveBeenCalledTimes(7);
  });
  it('never treats HTTP202 or a global empty queue as deletion completion',async()=>{
    fetchMock.mockResolvedValueOnce(response(person())).mockResolvedValueOnce(response(emptyStatus()))
      .mockResolvedValueOnce(response(person().results[0])).mockResolvedValueOnce(response(accepted(),202))
      .mockResolvedValueOnce(response({count:0,results:[],next:null}));
    expect((await eraseAccountPosthog(command)).verified).toBe(false);
    expect(h.fs.getDoc('account_erasure_commands/'+id+'/processors/posthog')?.state).toBe('accepted');
  });
  it('does not accept a different person, an old request or a pending verification',()=>{
    const at=command.requestedAt.toMillis();expect(completedPosthogDeletion(status().results[0],uuid,at)).toBe(true);
    expect(completedPosthogDeletion(status('pending').results[0],uuid,at)).toBe(false);
    expect(completedPosthogDeletion(status('completed','other-person').results[0],uuid,at)).toBe(false);
    expect(completedPosthogDeletion({...status().results[0],created_at:new Date(at-1).toISOString()},uuid,at)).toBe(false);
  });
  it('resumes accepted deletion by native UUID without resubmitting a new delete',async()=>{
    fetchMock.mockResolvedValueOnce(response(person())).mockResolvedValueOnce(response(emptyStatus())).mockResolvedValueOnce(response(person().results[0]))
      .mockResolvedValueOnce(response(accepted(),202)).mockResolvedValueOnce(response(status('pending')));
    expect((await eraseAccountPosthog(command)).verified).toBe(false);fetchMock.mockResolvedValueOnce(response(status()))
      .mockResolvedValueOnce(response(zeroCounts())).mockResolvedValueOnce(response({},404));
    expect((await eraseAccountPosthog(command)).verified).toBe(true);expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/bulk_delete/'))).toHaveLength(1);
  });
  it('does not delete a UUID whose native aliases changed between preparation and provider effect',async()=>{
    fetchMock.mockResolvedValueOnce(response(person())).mockResolvedValueOnce(response(emptyStatus()))
      .mockResolvedValueOnce(response({...person().results[0],distinct_ids:['synthetic-owner','new-foreign-alias']}));
    expect((await eraseAccountPosthog(command)).verified).toBe(false);
    expect(fetchMock.mock.calls.filter(c=>String(c[0]).endsWith('/bulk_delete/'))).toHaveLength(0);
  });
  it('does not turn cached counts or personless nonzero data into absence proof',async()=>{
    fetchMock.mockResolvedValueOnce(response({results:[],next:null})).mockResolvedValueOnce(response({...zeroCounts(),is_cached:true}));
    expect((await eraseAccountPosthog(command)).verified).toBe(false);
    fetchMock.mockResolvedValueOnce(response({results:[],next:null})).mockResolvedValueOnce(response({...zeroCounts(),results:[[1,0]]}));
    expect((await eraseAccountPosthog(command)).verified).toBe(false);
    expect(h.fs.getDoc('account_erasure_commands/'+id+'/processors/posthog')).toBeUndefined();
  });
});
describe('official native Apple request transport',()=>{
  const config=()=>{vi.stubEnv('ACCOUNT_ERASURE_APPLE_API_KEY','synthetic-public-firebase-key');vi.stubEnv('ACCOUNT_ERASURE_APPLE_IOS_BUNDLE_ID','com.seconde.app');
    vi.stubEnv('ACCOUNT_ERASURE_APPLE_IOS_APP_ID','1:123456:ios:abcdef123456');};
  it('does not call a provider until the iOS project/app configuration is qualified',async()=>{
    expect((await revokeNativeAppleForErasure(command,'code-in-memory','id-token-in-memory')).state).toBe('unknown');expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends the official native code request without inventing a redirect URI and keeps credentials only in memory',async()=>{
    config();fetchMock.mockResolvedValue(response({}));
    const result=await revokeNativeAppleForErasure(command,'code-in-memory','id-token-in-memory');expect(result.state).toBe('revoked');
    const [url,options]=fetchMock.mock.calls[0];expect(String(url)).toMatch(/^https:\/\/identitytoolkit.googleapis.com\/v2\/accounts:revokeToken\?key=/);
    expect(JSON.parse(options.body)).toEqual({providerId:'apple.com',tokenType:'3',token:'code-in-memory',idToken:'id-token-in-memory'});
    expect(options.redirect).toBe('error');expect(JSON.stringify(result)).not.toContain('code-in-memory');expect(JSON.stringify(result)).not.toContain('id-token-in-memory');
    expect(h.fs.writeOps).toHaveLength(0);
  });
  it.each([400,403,500])('never claims revocation for HTTP%d',async status=>{
    config();fetchMock.mockResolvedValue(response({error:{message:'sensitive provider error'}},status));
    expect((await revokeNativeAppleForErasure(command,'code-in-memory','id-token-in-memory')).state).toBe('unknown');
  });
  it('does not accept an arbitrary JSON success body or a lost response as a proof',async()=>{
    config();fetchMock.mockResolvedValueOnce(response({unexpected:'not the official response'})).mockRejectedValueOnce(new Error('lost response'));
    expect((await revokeNativeAppleForErasure(command,'code-in-memory','id-token-in-memory')).state).toBe('unknown');
    expect((await revokeNativeAppleForErasure(command,'code-in-memory','id-token-in-memory')).state).toBe('unknown');
  });
});
