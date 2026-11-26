import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { FieldPath, deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getTestEnv, teardownTestEnv } from './helpers';

const owner = 'standing_rules_owner';
const base = { email: 'standing@example.test', displayName: 'Compte', dateOfBirth: '2000-01-01', isActive: false };
const invalid = [false, null, 'true', 1, 0, {}, { value: true }, [], ['true']] as const;
async function seed(data: Record<string, unknown>) {
  const env = await getTestEnv();
  await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users', owner), data));
}
async function source() {
  const env = await getTestEnv();
  let data: Record<string, unknown> | undefined;
  await env.withSecurityRulesDisabled(async ctx => { data = (await getDoc(doc(ctx.firestore(), 'users', owner))).data(); });
  return data;
}
describe('ACCOUNT_STANDING backend user authority', () => {
  beforeAll(getTestEnv);
  afterAll(teardownTestEnv);
  beforeEach(async () => { await (await getTestEnv()).clearFirestore(); await seed(base); });

  it.each(['email', 'google', 'apple'])('keeps the legitimate %s initial true payload', async authProvider => {
    const env = await getTestEnv(); await env.clearFirestore();
    const ref = doc(env.authenticatedContext(owner).firestore(), 'users', owner);
    await assertSucceeds(setDoc(ref, { id: owner, email: base.email, displayName: base.displayName,
      createdAt: serverTimestamp(), authProvider, isActive: true }));
    expect(await source()).toMatchObject({ id: owner, isActive: true, authProvider });
  });
  it('keeps absent create compatible without introducing true', async () => {
    const env = await getTestEnv(); await env.clearFirestore();
    await assertSucceeds(setDoc(doc(env.authenticatedContext(owner).firestore(), 'users', owner), { email: base.email, displayName: base.displayName }));
    expect(await source()).not.toHaveProperty('isActive');
  });
  it.each(invalid.map(isActive => ({ isActive })))('rejects present invalid standing at create %j', async ({ isActive }) => {
    const env = await getTestEnv(); await env.clearFirestore();
    await assertFails(setDoc(doc(env.authenticatedContext(owner).firestore(), 'users', owner), { email: base.email, displayName: base.displayName, isActive }));
    expect(await source()).toBeUndefined();
  });
  it.each([true, null, 'active', 1, {}, { value: true }, []].map(isActive => ({ isActive })))('rejects owner replacement of existing false %j', async ({ isActive }) => {
    const env = await getTestEnv();
    await assertFails(updateDoc(doc(env.authenticatedContext(owner).firestore(), 'users', owner), { isActive }));
    expect(await source()).toEqual(base);
  });
  it.each(['updateDelete', 'mergeTrue', 'mergeDelete', 'replaceTrue', 'replaceOmission'])('rejects %s with complete source intact', async kind => {
    const env = await getTestEnv(), ref = doc(env.authenticatedContext(owner).firestore(), 'users', owner);
    const { isActive: _standing, ...without } = base;
    const write = kind === 'updateDelete' ? updateDoc(ref, { isActive: deleteField() }) :
      kind === 'mergeTrue' ? setDoc(ref, { isActive: true }, { merge: true }) :
      kind === 'mergeDelete' ? setDoc(ref, { isActive: deleteField() }, { merge: true }) :
      setDoc(ref, kind === 'replaceTrue' ? { ...base, isActive: true } : without);
    await assertFails(write); expect(await source()).toEqual(base);
  });
  it('rejects nested mutation and nested deletion of malformed server source', async () => {
    const nested = { ...base, isActive: { value: false } }; await seed(nested);
    const env = await getTestEnv(), ref = doc(env.authenticatedContext(owner).firestore(), 'users', owner);
    await assertFails(updateDoc(ref, new FieldPath('isActive', 'value'), true));
    await assertFails(updateDoc(ref, { 'isActive.value': deleteField() }));
    expect(await source()).toEqual(nested);
  });
  it.each([true, false, null, 'malformed', { value: false }])('ordinary update succeeds and preserves server standing %j', async isActive => {
    await seed({ ...base, isActive }); const env = await getTestEnv(), ref = doc(env.authenticatedContext(owner).firestore(), 'users', owner);
    await assertSucceeds(updateDoc(ref, { bio: 'Profil', displayName: 'Nom ordinaire', 'preferences.sizes': ['L'], accountType: 'user' }));
    expect(await source()).toMatchObject({ isActive, dateOfBirth: base.dateOfBirth, bio: 'Profil', preferences: { sizes: ['L'] }, accountType: 'user' });
  });
  it('legacy absent can update ordinary data but cannot add any standing', async () => {
    const { isActive: _standing, ...without } = base; await seed(without); const env = await getTestEnv(), ref = doc(env.authenticatedContext(owner).firestore(), 'users', owner);
    await assertSucceeds(updateDoc(ref, { bio: 'Legacy' }));
    for (const isActive of [true, false, null]) await assertFails(setDoc(ref, { isActive }, { merge: true }));
    expect(await source()).toEqual({ ...without, bio: 'Legacy' });
  });
  it.each(['outsider', 'adminOther', 'adminOwner', 'guest'])('%s does not gain client authority over standing', async kind => {
    const env = await getTestEnv(); const web = kind === 'guest' ? env.unauthenticatedContext().firestore() :
      env.authenticatedContext(kind === 'adminOwner' ? owner : 'standing_rules_other', kind.startsWith('admin') ? { admin: true } : {}).firestore();
    await assertFails(updateDoc(doc(web, 'users', owner), { isActive: true })); expect(await source()).toEqual(base);
  });
  it('active owner cannot self-suspend or remove standing by replacing document', async () => {
    await seed({ ...base, isActive: true }); const env = await getTestEnv(), ref = doc(env.authenticatedContext(owner).firestore(), 'users', owner);
    await assertFails(updateDoc(ref, { isActive: false })); await assertFails(updateDoc(ref, { isActive: deleteField() }));
    expect(await source()).toEqual({ ...base, isActive: true });
  });
});
