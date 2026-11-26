import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=await vi.hoisted(async()=>{const fs=(await import('../utils/testHelpers/firestoreMock')).createFirestoreMock({enforceReadBeforeWrite:true});
  return {fs,erase:vi.fn(),postal:vi.fn()};});
vi.mock('../config/firebase',()=>({db:h.fs.db}));
vi.mock('../config/runtimeEnvironment',()=>({runtimeStorageBucket:()=> 'demo-second.appspot.com'}));
vi.mock('../utils/accountErasureRuntime',()=>({eraseStorageGeneration:(...a:any[])=>h.erase(...a),erasurePostalFinalizationDisposition:(...a:any[])=>h.postal(...a)}));
import {handleErasedAccountStorageFinalization} from './accountErasureStorage';
const commandId='c'.repeat(64),path='swaps/swap/photos/owner/late.jpg',command={protocol:'account_erasure_v1',ownerId:'owner',commandId,
  confirmed:true,fenceCommitted:true,inputHash:'a'.repeat(64)},event={id:'native-event',data:{bucket:'demo-second.appspot.com',name:path,generation:'11'}};
beforeEach(()=>{h.fs.reset();h.erase.mockReset();h.erase.mockResolvedValue(undefined);h.postal.mockReset();h.postal.mockResolvedValue('erase');
  h.fs.setDoc('eligibility_profiles/owner',{accountErasureFence:{protocol:'account_erasure_fence_v1',commandId,ownerId:'owner'}});
  h.fs.setDoc('account_erasure_commands/'+commandId,command);});
describe('postal late Storage event routing',()=>{
  it('records exact generation absence only after the qualified orphan effect',async()=>{
    await handleErasedAccountStorageFinalization(event);expect(h.postal).toHaveBeenCalledWith(command,path,'11');expect(h.erase).toHaveBeenCalledWith(command,path,'11');
    expect(h.fs.writeOps.at(-1)?.data).toMatchObject({state:'generation_absence_verified'});
  });
  it('preserves a referenced contract generation without fabricating a deletion receipt',async()=>{
    h.postal.mockResolvedValue('retain');await handleErasedAccountStorageFinalization(event);expect(h.erase).not.toHaveBeenCalled();
    expect(h.fs.writeOps.at(-1)?.data).toMatchObject({state:'retained_contract_generation'});
  });
  it('propagates an unqualified parent/hold refusal without an effect or receipt',async()=>{
    h.postal.mockRejectedValue(Error('unqualified native parent'));await expect(handleErasedAccountStorageFinalization(event)).rejects.toThrow();
    expect(h.erase).not.toHaveBeenCalled();expect(h.fs.writeOps).toHaveLength(0);
  });
  it.each(['foreign_bucket','invalid_generation','foreign_owner','unknown_namespace','nested_path'])('ignores %s without touching other objects',async kind=>{
    const value={...event,data:{...event.data}};
    if(kind==='foreign_bucket')value.data.bucket='foreign.appspot.com';if(kind==='invalid_generation')value.data.generation='0';
    if(kind==='foreign_owner')value.data.name='swaps/swap/photos/peer/late.jpg';if(kind==='unknown_namespace')value.data.name='other/owner/late.jpg';
    if(kind==='nested_path')value.data.name='swaps/swap/photos/owner/nested/late.jpg';
    await handleErasedAccountStorageFinalization(value);expect(h.postal).not.toHaveBeenCalled();expect(h.erase).not.toHaveBeenCalled();expect(h.fs.writeOps).toHaveLength(0);
  });
});
