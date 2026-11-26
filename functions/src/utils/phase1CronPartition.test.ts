import {describe, expect, it} from 'vitest';
import {hasPhase1LocalAgreement, hasPhase1LocalOfferOrigin} from './phase1CronPartition';
describe('disjoint ordinary TEST and local phase1 scheduler partitions', () => {
  it.each([undefined, null, false, '', {}, {protocol: 'forged'}])('keeps any present local marker outside the TEST partition: %j', value => {
    expect(hasPhase1LocalOfferOrigin({phase1Source: value})).toBe(true);
    expect(hasPhase1LocalAgreement({localAgreementWitness: value})).toBe(true);
  });
  it('retains ordinary TEST financial witnesses and the transport marker without local origin', () => {
    for (const source of [null, undefined, {}, {phase1Contract: 'phase1_v2'}, {financialRecoveryWitness: {}, inventoryUnit: {}}]) {
      expect(hasPhase1LocalOfferOrigin(source)).toBe(false);
      expect(hasPhase1LocalAgreement(source)).toBe(false);
    }
  });
});
