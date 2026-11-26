import {describe, expect, it} from 'vitest';
import {assertLegacyAccountDeletionRequest, assertLegacyAcquisitionEnabled, assertLegacyActor, assertLegacySource, beginLegacyDeletion, checkedLegacySource, isPhase1ProtectedSource} from './phase1LegacyFence';
import {evaluateCurrentSellerEligibility, hasAccountClosure} from '../shared/eligibility';
import {createFirestoreMock} from './testHelpers/firestoreMock';

describe('production legacy compatibility fence', () => {
  it('closes legacy acquisition on the explicit cutover flag and every malformed configured value', () => {
    for (const flag of ['true', '', 'TRUE', '0', 'unknown']) expect(() => assertLegacyAcquisitionEnabled({SECONDE_LEGACY_ACQUISITION_DISABLED: flag}))
      .toThrowError(expect.objectContaining({details: {reason: 'phase1_update_required'}}));
    expect(() => assertLegacyAcquisitionEnabled({})).not.toThrow();
    expect(() => assertLegacyAcquisitionEnabled({SECONDE_LEGACY_ACQUISITION_DISABLED: 'false'})).not.toThrow();
  });
  it.each([null, false, {}, {protocol: 'phase1_legacy_deletion_fence_v1'}])(
    'also closes counterpart acquisition for every present private deletion fence %j', legacyDeletionFence => {
      const profile = {legacyDeletionFence};
      expect(hasAccountClosure(profile)).toBe(true);
      expect(evaluateCurrentSellerEligibility({user: {dateOfBirth: '2000-01-01'}, profile}, 'sell').reasons).toContain('account_closing');
    });
  it('preserves historical sources and historical empty deletion requests', () => {
    for (const source of [null, undefined, {}, {status: 'meetup_confirmed', amount: 20}, {status: 'proposed', cashTopUp: null}]) {
      expect(isPhase1ProtectedSource(source)).toBe(false);
      expect(() => assertLegacySource(source)).not.toThrow();
    }
    for (const data of [undefined, null, {}]) expect(() => assertLegacyAccountDeletionRequest(data)).not.toThrow();
    const native = {status: 'meetup_confirmed', amount: 20};
    expect(checkedLegacySource(native)).toBe(native);
  });

  it.each(['phase1Contract', 'phase1Source', 'localAgreementWitness', 'localCatalogueWitness', 'financialRecoveryWitness', 'inventoryUnit',
    'privacyWithdrawal', 'contentModeration', 'accountErasureFence', 'articleEvidence', 'messageEvidence', 'withdrawalIntent', 'providerSubmission'])(
    'closes old writers for %s even when malformed, without validating or adopting it', marker => {
      for (const value of [undefined, null, false, '', {}, {protocol: 'forged'}]) {
        const source = {status: 'proposed', [marker]: value};
        expect(isPhase1ProtectedSource(source)).toBe(true);
        expect(() => assertLegacySource(source)).toThrowError(expect.objectContaining({
          code: 'failed-precondition', details: {reason: 'phase1_update_required'},
        }));
        expect(source).toEqual({status: 'proposed', [marker]: value});
      }
    });

  it.each(['mode', 'expectedUid', 'accountControlProof', 'capability', 'operation'])(
    'refuses modern deletion field %s before the historical destructive handler', field => {
      expect(() => assertLegacyAccountDeletionRequest({[field]: undefined})).toThrowError(expect.objectContaining({
        code: 'failed-precondition', details: {reason: 'phase1_update_required'},
      }));
    });

  it('supports mixed scheduler batches by skipping protected sources individually', () => {
    const sources = [{id: 'old-a', status: 'proposed'}, {id: 'modern', localAgreementWitness: {}}, {id: 'old-b', status: 'proposed'}];
    const processed = sources.filter(source => !isPhase1ProtectedSource(source)).map(source => source.id);
    expect(processed).toEqual(['old-a', 'old-b']);
  });

  const request = () => ({auth: {uid: 'owner', token: {auth_time: Math.floor(Date.now() / 1000)}}});
  const dependencies = () => {
    const fs = createFirestoreMock({enforceReadBeforeWrite: true});
    fs.setDoc('users/owner', {isActive: true});
    const auth = {getUser: async (uid: string) => ({uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString()})};
    return {fs, deps: {db: fs.db, auth} as unknown as Parameters<typeof assertLegacyActor>[1]};
  };

  it('acquires the private deletion fence before closing a historical account and permits an empty-payload retry', async () => {
    const {fs, deps} = dependencies();
    await beginLegacyDeletion(request(), deps);
    const before = fs.getDoc('eligibility_profiles/owner');
    expect(before).toMatchObject({legacyDeletionFence: {protocol: 'phase1_legacy_deletion_fence_v1', ownerId: 'owner'}});
    expect(fs.getDoc('users/owner')).toMatchObject({isActive: false});
    await expect(assertLegacyActor(request(), deps)).rejects.toMatchObject({details: {reason: 'legacy_deletion_in_progress'}});
    await beginLegacyDeletion(request(), deps);
    expect(fs.getDoc('eligibility_profiles/owner')).toEqual(before);
  });

  it('does not mutate on modern pause commands, a migrated profile, an existing modern source or unsettled old money', async () => {
    const cases = [
      {payload: {mode: 'pause'}, seed: null},
      {payload: {}, seed: ['eligibility_profiles/owner', {}]},
      {payload: {}, seed: ['messages/modern', {senderId: 'owner', phase1Contract: 'phase1_v2'}]},
      {payload: {}, seed: ['transactions/modern', {buyerId: 'owner', localAgreementWitness: {}}]},
      {payload: {}, seed: ['wallets/owner', {heldBalance: 100}]},
      {payload: {}, seed: ['transactions/old', {buyerId: 'owner', status: 'meetup_pending'}]},
    ];
    for (const item of cases) {
      const {fs, deps} = dependencies();
      if (item.seed) fs.setDoc(item.seed[0] as string, item.seed[1] as Record<string, unknown>);
      await expect(beginLegacyDeletion({...request(), data: item.payload}, deps)).rejects.toMatchObject({code: 'failed-precondition'});
      expect(fs.writeOps).toEqual([]);
      expect(fs.getDoc('users/owner')).toMatchObject({isActive: true});
    }
  });

  it.each([null, false, {}, {protocol:'invalid'}])('closes every old servicing path for erasure fence presence %j',async accountErasureFence=>{
    const {fs,deps}=dependencies();fs.setDoc('eligibility_profiles/owner',{accountErasureFence});
    for(const options of [{},{acquisition:true},{allowDeletionRetry:true}])
      await expect(assertLegacyActor(request(),deps,options)).rejects.toMatchObject({details:{reason:'phase1_update_required'}});
    expect(fs.writeOps).toEqual([]);
  });

  it('moves migrated acquisition to V2 while preserving legacy servicing with a fresh native session', async () => {
    const {fs, deps} = dependencies();
    fs.setDoc('eligibility_profiles/owner', {version: 1});
    await expect(assertLegacyActor(request(), deps, {acquisition: true})).rejects.toMatchObject({details: {reason: 'phase1_update_required'}});
    expect((await assertLegacyActor(request(), deps)).uid).toBe('owner');
  });
});
