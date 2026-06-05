import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const SENDER = 'sender';
const RECEIVER = 'receiver';
const OUTSIDER = 'outsider';
const MSG_ID = 'msg-1';
const OFFER_MSG_ID = 'offer-msg-1';

const baseMessage = {
  chatId: 'chat-1',
  senderId: SENDER,
  receiverId: RECEIVER,
  participants: [SENDER, RECEIVER],
  type: 'text',
  text: 'hello',
  isRead: false,
  status: 'sent',
};

const offerMessage = {
  chatId: 'chat-1',
  senderId: SENDER,
  receiverId: RECEIVER,
  participants: [SENDER, RECEIVER],
  type: 'offer',
  isRead: false,
  status: 'sent',
  offer: { amount: 30, status: 'pending' },
};

describe('messages rules — read receipts (status field)', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'messages', MSG_ID), baseMessage);
      await setDoc(doc(ctx.firestore(), 'messages', OFFER_MSG_ID), offerMessage);
    });
  });

  it('allows the receiver to mark a message as read (isRead + status read)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'messages', MSG_ID), { isRead: true, status: 'read' }),
    );
  });

  it('denies a non-participant marking the message as read', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(OUTSIDER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MSG_ID), { isRead: true, status: 'read' }),
    );
  });

  it('denies an invalid status value', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MSG_ID), { isRead: true, status: 'hacked' }),
    );
  });

  it('still allows flipping isRead alone (no status)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'messages', MSG_ID), { isRead: true }),
    );
  });

  it('still allows the receiver to accept an offer (offer key untouched by status change)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'messages', OFFER_MSG_ID), {
        offer: { amount: 30, status: 'accepted' },
      }),
    );
  });

  it('still denies tampering with the offer amount', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', OFFER_MSG_ID), {
        offer: { amount: 1, status: 'accepted' },
      }),
    );
  });
});
