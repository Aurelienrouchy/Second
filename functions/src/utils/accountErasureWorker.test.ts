import {beforeEach,describe,expect,it,vi} from 'vitest';
const h=await vi.hoisted(async()=>{
  const {createFirestoreMock}=await import('./testHelpers/firestoreMock');
  return {fs:createFirestoreMock({enforceReadBeforeWrite:true}),advance:vi.fn(),warn:vi.fn()};
});
vi.mock('../config/firebase',()=>({db:h.fs.db}));
vi.mock('./accountErasureService',()=>({getAccountErasureService:()=>({advance:h.advance})}));
vi.mock('firebase-functions/logger',()=>({warn:h.warn}));
import {advanceAccountErasure} from './accountErasureWorker';
const commandId='a'.repeat(64),path='account_erasure_commands/'+commandId;
beforeEach(()=>{h.fs.reset();h.advance.mockReset();h.warn.mockReset();h.fs.setDoc(path,{protocol:'account_erasure_v1',state:'erasing',version:4});});
describe('private bounded erasure failure diagnostics',()=>{
  it.each([
    [{code:'financial-recovery-closed',reason:'evidence_collision'},'recovery_evidence_collision'],
    [{code:412},'sdk_code_412'],
    [{code:'failed-precondition'},'callable_failed_precondition'],
    [new Error('Account erasure native intention, source, hold or target unqualified.'),'native_scope_unqualified'],
    [{code:'financial-recovery-closed',reason:'private_uid_token_url'},'unknown'],
    [new Error('private_uid_token_url'),'unknown'],
  ])('records only a fixed code without provider/member text',async(error,reasonCode)=>{
    h.advance.mockRejectedValue(error);await advanceAccountErasure(commandId);
    const job=h.fs.getDoc(path);expect(job).toMatchObject({state:'awaiting_review',version:5,
      reasons:['native_execution_requires_review'],executionFailure:{state:'outcome_not_inferred'}});
    expect(Object.keys(job!.executionFailure).sort()).toEqual(['observedAt','state']);
    expect(h.warn).toHaveBeenCalledWith('account_erasure_native_execution_requires_review',{
      commandHash:expect.stringMatching(/^[a-f0-9]{64}$/),reasonCode});
    expect(JSON.stringify([job,h.warn.mock.calls])).not.toContain('private_uid_token_url');
  });
  it('keeps an optimistic concurrent retry out of the failure queue',async()=>{
    h.advance.mockRejectedValue({code:'aborted',message:'private_uid_token_url'});await advanceAccountErasure(commandId);
    expect(h.fs.getDoc(path)).toEqual({protocol:'account_erasure_v1',state:'erasing',version:4});
    expect(h.warn).not.toHaveBeenCalled();
  });
});
