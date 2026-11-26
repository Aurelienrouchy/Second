import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, limit, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { getTestEnv, teardownTestEnv } from './helpers';
const collections = ['eligibility_profiles', 'eligibility_requests', 'eligibility_audit'];
const protectedFields = ['dateOfBirth', 'dateOfBirthVersion', 'eligibility', 'sellerActivity', 'sellerAdmission'];
describe('eligibility internal data and forged user projections', () => {
  beforeAll(getTestEnv); afterAll(teardownTestEnv);
  beforeEach(async () => {
    const env = await getTestEnv(); await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users/owner'), { displayName: 'Owner', email: 'owner@example.invalid', dateOfBirth: '2000-01-01',
        dateOfBirthVersion: 1, eligibility: { allowed: false }, sellerActivity: 'professional', sellerAdmission: { allowed: false } });
      await setDoc(doc(ctx.firestore(), 'users/backendAdmin'), { isAdmin: true });
      for (const name of collections) await setDoc(doc(ctx.firestore(), name + '/owner'), { ownerId: 'owner', internalNote: 'PRIVATE', signals: { active: true } });
    });
  });
  it.each(collections)('%s is unreadable to owner, other UID and anonymous, even in a bounded owner query', async name => {
    const env = await getTestEnv();
    for (const context of [env.authenticatedContext('owner'), env.authenticatedContext('other'), env.unauthenticatedContext()]) {
      const db = context.firestore();
      await assertFails(getDoc(doc(db, name + '/owner')));
      await assertFails(getDocs(query(collection(db, name), where('ownerId', '==', 'owner'), limit(50))));
      await assertFails(getDocs(collection(db, name)));
    }
  });
  it.each(collections)('%s is admin-readable via trusted claim or backend role, never client-writable even by admin', async name => {
    const env = await getTestEnv();
    for (const context of [env.authenticatedContext('claimAdmin', { admin: true }), env.authenticatedContext('backendAdmin')]) {
      const db = context.firestore();
      await assertSucceeds(getDoc(doc(db, name + '/owner'))); await assertSucceeds(getDocs(collection(db, name)));
      await assertFails(setDoc(doc(db, name + '/forged'), { ownerId: 'owner', allowed: true }));
      await assertFails(updateDoc(doc(db, name + '/owner'), { internalNote: 'forged', ownerId: 'other' }));
      await assertFails(deleteDoc(doc(db, name + '/owner')));
    }
  });
  it.each(collections)('%s owner cannot create partial proof or erase/update an internal record', async name => {
    const db = (await getTestEnv()).authenticatedContext('owner').firestore();
    await assertFails(setDoc(doc(db, name + '/forged'), { ownerId: 'owner', allowed: true }));
    await assertFails(updateDoc(doc(db, name + '/owner'), { signals: {} }));
    await assertFails(deleteDoc(doc(db, name + '/owner')));
  });
  it.each(protectedFields)('users.%s cannot be injected during partial create, changed or erased by owner', async field => {
    const env = await getTestEnv(), db = env.authenticatedContext('owner').firestore();
    await assertFails(updateDoc(doc(db, 'users/owner'), { [field]: { allowed: true } }));
    await assertFails(updateDoc(doc(db, 'users/owner'), { [field]: deleteField() }));
    const fresh = env.authenticatedContext('newOwner').firestore();
    await assertFails(setDoc(doc(fresh, 'users/newOwner'), { displayName: 'Fresh', email: 'fresh@example.invalid', [field]: { allowed: true } }));
  });
  it('ordinary profile edits remain allowed and private DOB is unreadable to third parties', async () => {
    const env = await getTestEnv();
    await assertSucceeds(updateDoc(doc(env.authenticatedContext('owner').firestore(), 'users/owner'), { displayName: 'Updated' }));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('owner').firestore(), 'users/owner')));
    await assertFails(getDoc(doc(env.authenticatedContext('other').firestore(), 'users/owner')));
  });
});
