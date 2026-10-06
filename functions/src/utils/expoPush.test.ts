import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), set: vi.fn(), update: vi.fn(), receiptGet: vi.fn(),
  doc: vi.fn(), arrayRemove: vi.fn((token: string) => ({ remove: token })),
}));
vi.mock('../config/firebase', () => ({
  FieldValue: { arrayRemove: mocks.arrayRemove },
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}`, set: (value: unknown) => mocks.set(`${name}/${id}`, value) }),
      where: () => ({ limit: () => ({ get: mocks.receiptGet }) }),
    }),
    runTransaction: async (callback: (tx: unknown) => Promise<void>) => callback({
      get: async () => ({ exists: true }), update: mocks.update,
    }),
  },
}));
vi.mock('firebase-functions/logger', () => ({ warn: vi.fn() }));
import { isExpoPushToken, reconcileExpoPushReceipts, sendExpoPushNotifications } from './expoPush';

const token = 'ExpoPushToken[test-device]';
const notice = { title: 'Message', body: 'Test', data: { type: 'message', chatId: 'c1' }, badge: 2, channelId: 'messages' };
function response(data: unknown) { return { ok: true, json: async () => ({ data }) }; }
function receipt(id: string, age: number) {
  const remove = vi.fn().mockResolvedValue(undefined);
  return {
    id, data: () => ({ userId: 'u1', token, createdAt: { toMillis: () => Date.now() - age } }),
    ref: { delete: remove },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.set.mockResolvedValue(undefined);
  mocks.fetch.mockResolvedValue(response([{ status: 'ok', id: 'ticket1' }]));
});

describe('Expo iOS push transport', () => {
  it('accepts gateway tokens and excludes APNs/FCM values', () => {
    expect(isExpoPushToken(token)).toBe(true);
    expect(isExpoPushToken('ExponentPushToken[legacy]')).toBe(true);
    expect(isExpoPushToken('a'.repeat(64))).toBe(false);
    expect(isExpoPushToken('native:FCM')).toBe(false);
  });
  it('sends a canonical payload once per token and persists tickets for receipt reconciliation', async () => {
    expect(await sendExpoPushNotifications('u1', [token, token, 'a'.repeat(64)], notice)).toBe(1);
    const [url, request] = mocks.fetch.mock.calls[0];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(JSON.parse(request.body)).toEqual([{ to: token, ...notice, sound: 'default', priority: 'high' }]);
    expect(mocks.set).toHaveBeenCalledWith('expoPushReceipts/ticket1', expect.objectContaining({ userId: 'u1', token }));
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('chunks at the documented 100 messages limit', async () => {
    mocks.fetch.mockImplementation(async (_url: string, request: { body: string }) => response(
      JSON.parse(request.body).map((_: unknown, index: number) => ({ status: 'ok', id: `ticket${index}` })),
    ));
    await sendExpoPushNotifications('u1', Array.from({ length: 101 }, (_, i) => `ExpoPushToken[device-${i}]`), notice);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toHaveLength(100);
    expect(JSON.parse(mocks.fetch.mock.calls[1][1].body)).toHaveLength(1);
  });
  it('unknown gateway errors retain tokens and do not claim acceptance', async () => {
    mocks.fetch.mockRejectedValue(new Error('network unavailable'));
    expect(await sendExpoPushNotifications('u1', [token], notice)).toBe(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('prunes only a confirmed DeviceNotRegistered ticket', async () => {
    mocks.fetch.mockResolvedValue(response([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]));
    await sendExpoPushNotifications('u1', [token], notice);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'users/u1' }), { expoPushTokens: { remove: token } });
  });
  it('reconciles confirmed receipt errors and keeps unrelated device tokens', async () => {
    const doc = receipt('ticket1', 20 * 60 * 1000);
    mocks.receiptGet.mockResolvedValue({ empty: false, docs: [doc] });
    mocks.fetch.mockResolvedValue(response({ ticket1: { status: 'error', details: { error: 'DeviceNotRegistered' } } }));
    await reconcileExpoPushReceipts();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(doc.ref.delete).toHaveBeenCalledTimes(1);
  });
  it('missing receipts retry until expiry and never prune on unknown outcome', async () => {
    const fresh = receipt('fresh', 20 * 60 * 1000);
    const expired = receipt('expired', 25 * 60 * 60 * 1000);
    mocks.receiptGet.mockResolvedValue({ empty: false, docs: [fresh, expired] });
    mocks.fetch.mockResolvedValue(response({}));
    await reconcileExpoPushReceipts();
    expect(fresh.ref.delete).not.toHaveBeenCalled();
    expect(expired.ref.delete).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('credential or provider errors are observable without removing a valid token', async () => {
    const doc = receipt('ticket1', 20 * 60 * 1000);
    mocks.receiptGet.mockResolvedValue({ empty: false, docs: [doc] });
    mocks.fetch.mockResolvedValue(response({ ticket1: { status: 'error', details: { error: 'InvalidCredentials' } } }));
    await reconcileExpoPushReceipts();
    expect(doc.ref.delete).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
