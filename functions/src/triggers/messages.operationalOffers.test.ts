import { beforeEach, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
const h = await vi.hoisted(async () => {
  const { createFirestoreMock } = await import('../utils/testHelpers/firestoreMock');
  const { Timestamp } = await import('firebase-admin/firestore');
  const fs = createFirestoreMock({ enforceReadBeforeWrite: true }), stamp = Timestamp.now();
  const db = { ...fs.db, runTransaction: (fn: any) => fs.db.runTransaction(tx => {
    const get = async (ref: any) => {
      const snap = await tx.get(ref);
      return ref.path?.startsWith('messages/') && typeof snap.data === 'function' ? { ...snap, createTime: stamp } : snap;
    };
    return fn({ ...tx, get, getAll: (...refs: any[]) => Promise.all(refs.map(get)) });
  }) };
  return { fs, db, stamp, push: vi.fn(), prodPush: vi.fn() };
});
vi.mock('../config/firebase', () => ({ db: h.db, get FieldValue() { return { ...h.fs.FieldValue, serverTimestamp: () => Timestamp.now() }; } }));
vi.mock('../utils/expoPush', () => ({ sendDevExpoPushNotifications: h.push, sendExpoPushNotifications: h.prodPush }));
vi.mock('../config/runtimeEnvironment', async original => ({ ...await original<any>(), isProductionRuntime: () => false, applicationLink: (v: string) => v }));
vi.mock('firebase-functions/v2/firestore', () => ({ onDocumentCreated: (_o: any, fn: any) => fn, onDocumentUpdated: (_o: any, fn: any) => fn }));
vi.mock('firebase-functions/logger', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
import { sendMessageNotification, sendOfferStatusNotification } from './messages';
import { dispatchOperationalNoticeOnCreate } from '../utils/notifications';
const fs = h.fs, path = 'messages/offer1';
const current = () => fs.getDoc(path)!;
const creation = () => (sendMessageNotification as any)({ params: { messageId: 'offer1' },
  data: { id: 'offer1', ref: fs.db.collection('messages').doc('offer1'), data: current, createTime: h.stamp } });
const response = (before: any, after: any) => (sendOfferStatusNotification as any)({ params: { messageId: 'offer1' }, data: {
  before: { data: () => before }, after: { data: () => after, ref: fs.db.collection('messages').doc('offer1') },
} });
beforeEach(() => {
  fs.reset(); h.push.mockReset(); h.prodPush.mockReset(); h.push.mockResolvedValue({ eligibleDestinations: 1, accepted: 1 });
  fs.setDoc('users/buyer', { isActive: true, expoPushTokens: ['ExpoPushToken[legacyIgnored]'], fcmTokens: ['legacy-fcm-ignored'] });
  fs.setDoc('users/seller', { isActive: true });
  fs.setDoc('chats/chat1', { participants: ['buyer','seller'], articleId: 'article', unreadCount: { buyer: 0, seller: 0 } });
  fs.setDoc(path, { type: 'offer', chatId: 'chat1', senderId: 'buyer', receiverId: 'seller',
    offer: { protocol: 'shipping_offer_v1', deliveryType: 'shipping', offerId: 'offer1', articleId: 'article',
      buyerId: 'buyer', sellerId: 'seller', amount: 13, status: 'pending' } });
});
it('commits the offer notice, chat preview and unread count exactly once on redelivery', async () => {
  await creation(); await creation();
  expect(fs.getDoc('chats/chat1')).toMatchObject({ lastMessage: 'Proposition de 13 $', unreadCount: { seller: 1, buyer: 0 } });
  expect(fs.writeOps.filter(w => w.method === 'create' && w.path.startsWith('notifications/'))).toHaveLength(1);
  expect(fs.writeOps.filter(w => w.method === 'create' && w.path.startsWith('operational_notice_receipts/'))).toHaveLength(1);
});
it('notifies the buyer once on acceptance and leaves the seller creation count untouched', async () => {
  await creation(); const before = current(), after = { ...before, offer: { ...(before.offer as any), status: 'accepted', acceptedAt: h.stamp } };
  fs.setDoc(path, after); await response(before, after); await response(before, after);
  expect(fs.getDoc('chats/chat1')).toMatchObject({ lastMessage: 'Proposition acceptée', unreadCount: { seller: 1, buyer: 1 } });
  expect(fs.writeOps.filter(w => w.method === 'create' && w.path.startsWith('notifications/'))).toHaveLength(2);
});
it('keeps a newer chat preview while retaining one unread older offer, and respects blocking', async () => {
  fs.setDoc('chats/chat1', { ...fs.getDoc('chats/chat1'), lastMessage: 'Plus récent', lastMessageTimestamp: Timestamp.fromMillis(h.stamp.toMillis() + 1) });
  await creation(); expect(fs.getDoc('chats/chat1')).toMatchObject({ lastMessage: 'Plus récent', unreadCount: { seller: 1 } });
  fs.reset(); fs.setDoc('chats/chat1', { participants: ['buyer','seller'] }); fs.setDoc('users/buyer', { blockedUserIds: ['seller'] });
  fs.setDoc(path, { type: 'offer', chatId: 'chat1', senderId: 'buyer', receiverId: 'seller', offer: { amount: 13 } });
  await creation(); expect(fs.writeOps).toHaveLength(0);
});
it('dispatches a newly committed outbox immediately with the same lease used by retries', async () => {
  await creation();
  const receiptId = fs.writeOps.find(w => w.path.startsWith('operational_notice_receipts/'))!.path.split('/')[1];
  let started!: () => void, finish!: () => void;
  const atGateway = new Promise<void>(resolve => { started = resolve; }), gateway = new Promise<void>(resolve => { finish = resolve; });
  h.push.mockImplementation(async () => { started(); await gateway; return { eligibleDestinations: 1, accepted: 1 }; });
  const event = { params: { receiptId }, data: {} };
  const first = (dispatchOperationalNoticeOnCreate as any)(event); await atGateway;
  await (dispatchOperationalNoticeOnCreate as any)(event);
  expect(h.push).toHaveBeenCalledTimes(1); expect(h.prodPush).not.toHaveBeenCalled();
  finish(); await first;
  expect(fs.getDoc(`operational_notice_receipts/${receiptId}`)).toMatchObject({ pushState: 'completed', pushOutcome: 'gateway_accepted', pushAcceptedCount: 1 });
  await (dispatchOperationalNoticeOnCreate as any)(event); expect(h.push).toHaveBeenCalledTimes(1);
});
