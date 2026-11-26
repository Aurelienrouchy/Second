import {describe,it,expect} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
import {createAccountErasurePolicy,accountErasureTerminalTime} from './accountErasurePolicy';
const policy=createAccountErasurePolicy({processors:async()=>({verified:false,proofHash:'a'.repeat(64),reason:'pending'}),
  apple:async()=>({state:'unknown',proofHash:'b'.repeat(64)}),writerQualification:async()=>({verified:false,sourceHash:'c'.repeat(64)})});
describe('delegated operational erasure policy',()=>{
  it('erases ordinary personal data without adding a minimum retention period',()=>{
    for(const category of ['profile','favorites','saved_searches','search_history','consents','notifications','drafts','communications','reviews','articles','media'] as const)
      expect(policy.disposition(category,{content:'ordinary'},{})).toEqual({action:'erase',purpose:null,reviewAt:null});
  });
  it('uses the exact terminal time and never createdAt, updatedAt or the execution clock',()=>{
    expect(accountErasureTerminalTime({status:'completed',updatedAt:Timestamp.now()})).toBeNull();
    expect(policy.disposition('contracts',{status:'completed',createdAt:Timestamp.now()},{}).action).toBe('review');
    const acceptedAt=Timestamp.fromMillis(Date.now()-20000),completedAt=Timestamp.fromMillis(Date.now()-10000),
      source={status:'completed',acceptedAt,completedAt};
    const result=policy.disposition('contracts',source,{}),expected=completedAt.toDate();expected.setUTCFullYear(expected.getUTCFullYear()+3);
    expect(result.action).toBe('retain');expect(result.reviewAt?.toMillis()).toBe(expected.getTime());
  });
  it('does not transform a displayed price into accounting or presume a proposal was concluded',()=>{
    expect(policy.disposition('contracts',{status:'declined',declinedAt:Timestamp.now(),price:500},{}).action).toBe('review');
    expect(policy.disposition('contracts',{status:'completed',completedAt:Timestamp.now(),amount:500},{}).action).toBe('review');
  });
  it('retains only media linked to an actual qualified private contract purpose',()=>{
    const acceptedAt=Timestamp.fromMillis(Date.now()-20000),completedAt=Timestamp.fromMillis(Date.now()-10000);
    expect(policy.disposition('media',{sourceSnapshot:{title:'ordinary'},retainedContracts:[]},{}).action).toBe('erase');
    expect(policy.disposition('media',{retainedContracts:[{status:'completed',acceptedAt,completedAt}]},{}).action).toBe('retain');
    expect(policy.disposition('media',{retainedContracts:[{status:'proposed'}]},{}).action).toBe('review');
  });
  it('does not invent closure for an open support case',()=>{
    expect(policy.disposition('support',{status:'open',updatedAt:Timestamp.now()},{}).action).toBe('review');
    expect(policy.disposition('support',{status:'closed',closedAt:Timestamp.now()},{}).action).toBe('erase');
  });
});
