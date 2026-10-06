import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), create: vi.fn(), count: vi.fn(), chats: vi.fn(), expo: vi.fn(), fcm: vi.fn(),
}));
vi.mock('../config/firebase', () => ({
  FieldValue: { serverTimestamp: () => 'server-time' },
  db: { collection: (name: string) => ({
    doc: () => ({ get: mocks.getUser }),
    add: mocks.create,
    where: () => ({
      where: () => ({ count: () => ({ get: mocks.count }) }),
      get: mocks.chats,
    }),
  }) },
}));
vi.mock('firebase-admin', () => ({ messaging: () => ({ sendEach: mocks.fcm }) }));
vi.mock('./expoPush', () => ({ sendExpoPushNotifications: mocks.expo }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn() }));
import { sendPushNotification, sendSwapNotification } from './notifications';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ exists: true, data: () => ({ expoPushTokens: ['ExpoPushToken[device]'] }) });
  mocks.create.mockResolvedValue({ id: 'notice', update: async () => {} });
  mocks.count.mockResolvedValue({ data: () => ({ count: 2 }) });
  mocks.chats.mockResolvedValue({ forEach: (callback: (value: unknown) => void) => callback({ data: () => ({ unreadCount: { u1: 3 } }) }) });
  mocks.expo.mockResolvedValue(1);
});

describe('shared notification transport policy', () => {
  it('iOS-only accounts receive an Expo payload with canonical route and server badge', async () => {
    expect(await sendPushNotification('u1', 'Hello', 'Body', { chatId: 'c1' }, 'new_message')).toEqual({ success: true, sentCount: 1 });
    expect(mocks.expo).toHaveBeenCalledWith('u1', ['ExpoPushToken[device]'], {
      title: 'Hello', body: 'Body', badge: 5, channelId: 'messages',
      data: { chatId: 'c1', type: 'new_message', deepLink: 'https://seconde.ca/chat/c1' },
    });
    expect(mocks.fcm).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('per-type refusal suppresses both in-app and gateway sends', async () => {
    mocks.getUser.mockResolvedValue({ exists: true, data: () => ({ expoPushTokens: ['ExpoPushToken[device]'], preferences: { notifications: { newMessages: false } } }) });
    await sendPushNotification('u1', 'Hello', 'Body', { chatId: 'c1' }, 'new_message');
    expect(mocks.expo).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('global push refusal preserves in-app notification without calling gateways', async () => {
    mocks.getUser.mockResolvedValue({ exists: true, data: () => ({ expoPushTokens: ['ExpoPushToken[device]'], preferences: { notifications: { push: false } } }) });
    await sendPushNotification('u1', 'Hello', 'Body', { chatId: 'c1' }, 'new_message');
    expect(mocks.expo).not.toHaveBeenCalled();
    expect(mocks.fcm).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('saved searches and swaps use canonical shared transport payloads', async () => {
    await sendPushNotification('u1', 'Search', 'Body', { savedSearchId: 's1' }, 'saved_search');
    expect(mocks.expo).toHaveBeenLastCalledWith('u1', expect.any(Array), expect.objectContaining({ channelId: 'saved_searches' }));
    await sendSwapNotification('u1', 'swap1', 'Swap', 'Body', { status: 'proposed' });
    expect(mocks.expo).toHaveBeenLastCalledWith('u1', expect.any(Array), expect.objectContaining({ data: { type: 'swap_update', status: 'proposed', swapId: 'swap1', deepLink: 'https://seconde.ca/swap/swap1' } }));
  });
  it('an Android failure cannot repeat a notification already accepted for iOS', async () => {
    mocks.getUser.mockResolvedValue({ exists: true, data: () => ({ expoPushTokens: ['ExpoPushToken[device]'], fcmTokens: ['native:FCM'] }) });
    mocks.fcm.mockRejectedValue(new Error('unavailable'));
    expect(await sendPushNotification('u1', 'Hello', 'Body', { chatId: 'c1' }, 'new_message')).toEqual({ success: true, sentCount: 1 });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
