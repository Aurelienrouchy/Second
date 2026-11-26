import { createHash } from 'node:crypto';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, Timestamp, where } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { getTestEnv, teardownTestEnv } from './helpers';

const OWNER = 'contained-owner';
const SECOND = 1_700_000_000;
const requestId = 'native-security-request';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nativeBarrier = () => ({ schemaVersion: 1, ownerId: OWNER,
  commandId: 'security_' + digest([OWNER, requestId]), requestId,
  inputHash: digest([OWNER, requestId, 'account_security_containment_v1', true]),
  source: 'owner_security_request', accepted: true,
  statementVersion: 'account_security_containment_v1', newEffectsBlocked: true,
  recordedAt: Timestamp.fromMillis(SECOND * 1000 + 650) });
const bytes = new Uint8Array([1, 2, 3]);
const paths = ['users/' + OWNER + '/private.jpg', 'products/' + OWNER + '/article/private.jpg',
  'drafts/' + OWNER + '/draft/private.jpg', 'avatars/' + OWNER,
  'swaps/private-swap/photos/' + OWNER + '/proof.jpg'];

describe('contained account private session fence', () => {
  beforeAll(getTestEnv);
  afterAll(teardownTestEnv);
  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.clearStorage();
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'users', OWNER), { displayName: 'Owner', isAdmin: true, preferences: { privacy: { showProfilePhoto: false } } });
      await setDoc(doc(db, 'eligibility_profiles', OWNER), { accountSecurityBarrier: nativeBarrier() });
      await setDoc(doc(db, 'eligibility_profiles', 'other'), { ownerId: 'other' });
      await setDoc(doc(db, 'chats', 'private-chat'), { participants: [OWNER, 'other'] });
      await setDoc(doc(db, 'chat_media_restrictions', 'private-chat'), {
        protocol: 'content_chat_restrictions_v1', blockedPaths: [],
      });
      await setDoc(doc(db, 'swaps', 'private-swap'), { initiatorId: OWNER, receiverId: 'other', status: 'photos_pending' });
      await setDoc(doc(db, 'admin', 'private'), { note: 'private' });
      await setDoc(doc(db, 'articles', 'public'), { sellerId: OWNER });
      for (let index = 0; index < 10; index++) {
        await setDoc(doc(db, 'notifications', 'notice-' + index), { userId: OWNER, isRead: false });
      }
      for (const path of [...paths, 'chat_images/private-chat/legacy.jpg', 'articles/public/cover.jpg']) {
        await uploadBytes(ref(ctx.storage(), path), bytes, { contentType: 'image/jpeg' });
      }
    });
  });

  it.each([SECOND - 1, SECOND])('refuses private Firestore and Storage access at auth_time %s', async authTime => {
    const env = await getTestEnv();
    const ctx = env.authenticatedContext(OWNER, { auth_time: authTime, admin: true });
    await assertFails(getDoc(doc(ctx.firestore(), 'users', OWNER)));
    await assertFails(getDoc(doc(ctx.firestore(), 'admin', 'private')));
    await assertFails(getDoc(doc(env.authenticatedContext(OWNER, { auth_time: authTime }).firestore(), 'eligibility_profiles', 'other')));
    for (const path of paths) await assertFails(getBytes(ref(ctx.storage(), path)));
    await assertFails(uploadBytes(ref(ctx.storage(), 'chat_images/private-chat/new.jpg'), bytes, { contentType: 'image/jpeg' }));
  });

  it('allows a later native sign-in to read historical private data without retiring containment', async () => {
    const env = await getTestEnv();
    const ctx = env.authenticatedContext(OWNER, { auth_time: SECOND + 1, admin: true });
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'users', OWNER)));
    await assertSucceeds(getDoc(doc(ctx.firestore(), 'admin', 'private')));
    await assertSucceeds(getDoc(doc(env.authenticatedContext(OWNER, { auth_time: SECOND + 1 }).firestore(), 'eligibility_profiles', 'other')));
    // One cached profile lookup across ten rows, below the query access budget.
    await assertSucceeds(getDocs(query(collection(ctx.firestore(), 'notifications'), where('userId', '==', OWNER))));
    for (const path of paths) await assertSucceeds(getBytes(ref(ctx.storage(), path)));
    // Chat creation and swap proofs each need at most two distinct documents.
    await assertSucceeds(uploadBytes(ref(ctx.storage(), 'chat_images/private-chat/' + OWNER + '/new.jpg'), bytes, { contentType: 'image/jpeg' }));
    await assertSucceeds(uploadBytes(ref(ctx.storage(), 'swaps/private-swap/photos/' + OWNER + '/new.jpg'), bytes, { contentType: 'image/jpeg' }));
  });

  it.each([null, {}, { ...nativeBarrier(), ownerId: 'other' }, { ...nativeBarrier(), recordedAt: 'not-a-timestamp' }])
    ('refuses a present unqualified barrier %#', async barrier => {
      const env = await getTestEnv();
      await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'eligibility_profiles', OWNER), { accountSecurityBarrier: barrier }));
      const ctx = env.authenticatedContext(OWNER, { auth_time: SECOND + 1 });
      await assertFails(getDoc(doc(ctx.firestore(), 'users', OWNER)));
      await assertFails(getBytes(ref(ctx.storage(), paths[0])));
    });

  it.each([{}, { auth_time: '1800000001' }, { auth_time: SECOND + 0.5 }])
    ('refuses a missing or non-integer auth_time %#', async token => {
      const ctx = (await getTestEnv()).authenticatedContext(OWNER, token);
      await assertFails(getDoc(doc(ctx.firestore(), 'users', OWNER)));
      await assertFails(getBytes(ref(ctx.storage(), paths[0])));
    });

  it.each([Timestamp.fromMillis(-1), Timestamp.fromMillis(0), Timestamp.fromMillis(Date.now() + 3_600_000)])
    ('refuses a non-positive or future containment date %# even when auth_time follows it', async recordedAt => {
      const env = await getTestEnv();
      await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'eligibility_profiles', OWNER), {
        accountSecurityBarrier: { ...nativeBarrier(), recordedAt },
      }));
      const ctx = env.authenticatedContext(OWNER, { auth_time: Math.floor(Date.now() / 1000) + 7_200 });
      await assertFails(getDoc(doc(ctx.firestore(), 'users', OWNER)));
      await assertFails(getBytes(ref(ctx.storage(), paths[0])));
    });

  it('keeps legacy accounts without a marker compatible and preserves ownership', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'eligibility_profiles', OWNER), { ownerId: OWNER }));
    const owner = env.authenticatedContext(OWNER);
    await assertSucceeds(getDoc(doc(owner.firestore(), 'users', OWNER)));
    await assertSucceeds(getBytes(ref(owner.storage(), paths[0])));
    const other = env.authenticatedContext('unrelated');
    await assertFails(getDoc(doc(other.firestore(), 'users', OWNER)));
    await assertFails(getBytes(ref(other.storage(), paths[0])));
  });

  it('preserves public images while all direct chat reads require the server reader', async () => {
    const env = await getTestEnv();
    const anonymous = env.unauthenticatedContext();
    await assertSucceeds(getDoc(doc(anonymous.firestore(), 'articles', 'public')));
    await assertSucceeds(getBytes(ref(anonymous.storage(), 'articles/public/cover.jpg')));
    // The callable reader performs all three checks without the Storage
    // two-document lookup limit; even a fresh participant cannot read directly.
    await assertFails(getBytes(ref(env.authenticatedContext(OWNER, { auth_time: SECOND }).storage(), 'chat_images/private-chat/legacy.jpg')));
    await assertFails(getBytes(ref(env.authenticatedContext(OWNER, { auth_time: SECOND + 1 }).storage(), 'chat_images/private-chat/legacy.jpg')));
    await assertFails(getBytes(ref(env.authenticatedContext('other').storage(), 'chat_images/private-chat/legacy.jpg')));
    await assertFails(getBytes(ref(env.authenticatedContext('unrelated').storage(), 'chat_images/private-chat/legacy.jpg')));
    await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'users', OWNER), {
      preferences: { privacy: { showProfilePhoto: true } },
    }));
    await assertSucceeds(getBytes(ref(anonymous.storage(), 'avatars/' + OWNER)));
    await assertSucceeds(getBytes(ref(env.authenticatedContext(OWNER, { auth_time: SECOND }).storage(), 'avatars/' + OWNER)));
  });
});
