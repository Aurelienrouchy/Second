import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteField, deleteDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { getTestEnv, teardownTestEnv } from './helpers';
describe('03B2 account intent and Quebec proof remain server-only/private', () => {
  beforeAll(getTestEnv); afterAll(teardownTestEnv);
  beforeEach(async () => {
    const env = await getTestEnv(); await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users/owner'), { displayName: 'Owner', email: 'owner@example.invalid', dateOfBirth: '2000-01-01' });
      await setDoc(doc(ctx.firestore(), 'eligibility_profiles/owner'), { ownerId: 'owner', version: 1,
        sellerQuebecEvidence: { accountId: 'acct_known', profileDateOfBirth: '2000-01-01', address: { street: 'PRIVATE' } },
        connectOperation: { id: 'internal', state: 'unknown', providerId: null } });
    });
  });
  it('owner, other UID and anonymous cannot read private proof/operation documents', async () => {
    const env = await getTestEnv();
    for (const ctx of [env.authenticatedContext('owner'), env.authenticatedContext('other'), env.unauthenticatedContext()]) await assertFails(getDoc(doc(ctx.firestore(), 'eligibility_profiles/owner')));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('admin', { admin: true }).firestore(), 'eligibility_profiles/owner')));
  });
  it('even a client admin cannot set, clear or replace the internal producer record', async () => {
    const env = await getTestEnv();
    for (const ctx of [env.authenticatedContext('owner'), env.authenticatedContext('admin', { admin: true })]) {
      const ref = doc(ctx.firestore(), 'eligibility_profiles/owner');
      await assertFails(updateDoc(ref, { sellerQuebecEvidence: { allowed: true } }));
      await assertFails(updateDoc(ref, { connectOperation: deleteField() })); await assertFails(deleteDoc(ref));
    }
  });
  it.each(['sellerQuebecEvidence', 'connectOperation', 'stripeAccountCreationStartedAt'])('user cannot forge %s on either update or partial signup', async field => {
    const env = await getTestEnv();
    await assertFails(updateDoc(doc(env.authenticatedContext('owner').firestore(), 'users/owner'), { [field]: { allowed: true } }));
    await assertFails(setDoc(doc(env.authenticatedContext('fresh').firestore(), 'users/fresh'), { displayName: 'Fresh', email: 'fresh@example.invalid', [field]: { allowed: true } }));
  });
});
