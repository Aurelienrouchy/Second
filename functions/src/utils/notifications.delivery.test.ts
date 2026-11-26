import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Timestamp} from 'firebase-admin/firestore';
const h = await vi.hoisted(async () => {
  const {createFirestoreMock} = await import('./testHelpers/firestoreMock');
  const fs = createFirestoreMock({enforceReadBeforeWrite: true});
  const db = Object.create(fs.db);
  db.collection = (name: string) => {
    const collection = fs.db.collection(name);
    if (name !== 'chats') return collection;
    return {...collection, where: (...args: unknown[]) => {
      const query = collection.where(...args);
      return {...query, get: async () => {const snap = await query.get();
        return {...snap, forEach: (fn: (doc: unknown) => void) => snap.docs.forEach(fn)};}};
    }};
  };
  return {fs, db, expo: vi.fn(), fcm: vi.fn()};
});
vi.mock('../config/firebase', () => ({db: h.db, FieldValue: h.fs.FieldValue}));
vi.mock('firebase-admin', () => ({messaging: () => ({sendEach: h.fcm})}));
vi.mock('./expoPush', () => ({sendExpoPushNotifications: h.expo}));
vi.mock('firebase-functions/logger', () => ({info: vi.fn(), warn: vi.fn()}));
import {sendPushNotification, sendSwapNotification} from './notifications';
const source = {chatId: 'c1', senderId: 'u2'};
const notices = () => h.fs.writeOps.filter(v => v.path.startsWith('notifications/') && v.method === 'create');
function preferences(value: Record<string, unknown>) {
  h.fs.setDoc('users/u1', {...h.fs.getDoc('users/u1'), preferences: value});
}
beforeEach(() => {
  h.fs.reset(); vi.clearAllMocks();
  // Explicit production transport, synthetic native sources, mocked gateways.
  vi.stubEnv('GCLOUD_PROJECT', 'seconde-b47a6'); vi.stubEnv('SECONDE_PROJECT_ID', 'seconde-b47a6');
  vi.stubEnv('SECONDE_ENV', 'production');
  h.fs.setDoc('users/u1', {expoPushTokens: ['ExpoPushToken[device]']});
  h.fs.setDoc('chats/c1', {participants: ['u1', 'u2'], unreadCount: {u1: 3}});
  h.fs.setDoc('notifications/existing', {userId: 'u1', isRead: false});
  h.expo.mockResolvedValue(1);
});
afterEach(() => vi.unstubAllEnvs());
describe('shared notification transport policy', () => {
  it('sends a private, natively qualified iOS chat preview with the server badge', async () => {
    expect(await sendPushNotification('u1', 'Private author', 'Private body', source, 'new_message')).toEqual({success: true, sentCount: 1});
    expect(h.expo).toHaveBeenCalledWith('u1', ['ExpoPushToken[device]'], {
      title: 'Nouveau message', body: 'Un membre vous a envoyé un message.', badge: 5, channelId: 'messages',
      data: {...source, ownerId: 'u1', noticeSource: 'chat_participant_push_v1', type: 'new_message', deepLink: 'https://seconde.ca/chat/c1'},
    });
    expect(h.fcm).not.toHaveBeenCalled(); expect(notices()).toHaveLength(1);
  });
  it('per-type push refusal preserves operational in-app history', async () => {
    preferences({notifications: {newMessages: false}});
    await sendPushNotification('u1', 'Hello', 'Body', source, 'new_message');
    expect(h.expo).not.toHaveBeenCalled(); expect(notices()).toHaveLength(1);
  });
  it('global push refusal preserves the in-app notification without calling gateways', async () => {
    preferences({notifications: {push: false}});
    await sendPushNotification('u1', 'Hello', 'Body', source, 'new_message');
    expect(h.expo).not.toHaveBeenCalled(); expect(h.fcm).not.toHaveBeenCalled(); expect(notices()).toHaveLength(1);
  });
  it('requires native marketing consent for saved searches and retains the canonical swap route', async () => {
    await sendPushNotification('u1', 'Search', 'Body', {savedSearchId: 's1'}, 'saved_search');
    expect(h.expo).not.toHaveBeenCalled(); expect(notices()).toHaveLength(0);
    const time = Timestamp.now(); preferences({marketingConsent: true});
    h.fs.setDoc('eligibility_profiles/u1', {marketingConsent: {schemaVersion: 1, ownerId: 'u1', granted: true,
      purpose: 'marketing', policyVersion: '2026-11-25', revision: 1, recordedAt: time, consentId: 'consent'}});
    h.fs.setDoc('users/u1/consents/consent', {schemaVersion: 1, ownerId: 'u1', type: 'marketing', granted: true,
      purpose: 'marketing', version: '2026-11-25', revision: 1, channel: 'app', source: 'privacy_settings', acceptedAt: time});
    await sendPushNotification('u1', 'Search', 'Body', {savedSearchId: 's1'}, 'saved_search');
    expect(h.expo).toHaveBeenLastCalledWith('u1', expect.any(Array), expect.objectContaining({channelId: 'saved_searches'}));
    await sendSwapNotification('u1', 'swap1', 'Swap', 'Body', {status: 'proposed'});
    expect(h.expo).toHaveBeenLastCalledWith('u1', expect.any(Array), expect.objectContaining({data: {type: 'swap_update', status: 'proposed', swapId: 'swap1', deepLink: 'https://seconde.ca/swap/swap1'}}));
  });
  it('an Android failure cannot repeat a notification already accepted for iOS', async () => {
    h.fs.setDoc('users/u1', {...h.fs.getDoc('users/u1'), fcmTokens: ['native:FCM']});
    h.fcm.mockRejectedValue(new Error('unavailable'));
    expect(await sendPushNotification('u1', 'Hello', 'Body', source, 'new_message')).toEqual({success: true, sentCount: 1});
    expect(notices()).toHaveLength(1);
  });
});
