import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

// ALICE has blocked BOB. The block list lives on ALICE's user doc as the flat
// `blockedUserIds` list (server/companion-maintained alongside blockedUsers).
const ALICE = 'alice';
const BOB = 'bob';
const CAROL = 'carol';
const CHAT_AB = 'chat-ab';

describe('blocking rules — blocked user cannot message / open chat (M2)', () => {
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
      const db = ctx.firestore();
      // Alice blocks Bob.
      await setDoc(doc(db, 'users', ALICE), {
        email: 'alice@example.com',
        displayName: 'Alice',
        blockedUserIds: [BOB],
      });
      await setDoc(doc(db, 'users', BOB), {
        email: 'bob@example.com',
        displayName: 'Bob',
      });
      await setDoc(doc(db, 'users', CAROL), {
        email: 'carol@example.com',
        displayName: 'Carol',
      });
      // An already-existing chat between Alice and Bob (seeded before block).
      await setDoc(doc(db, 'chats', CHAT_AB), {
        participants: [ALICE, BOB],
        participantsInfo: [{ id: ALICE }, { id: BOB }],
        unreadCount: { [ALICE]: 0, [BOB]: 0 },
      });
    });
  });

  it('denies a blocked user (Bob) sending a message to the blocker (Alice)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      setDoc(doc(db, 'messages', 'msg-blocked'), {
        senderId: BOB,
        receiverId: ALICE,
        type: 'text',
        chatId: CHAT_AB,
        participants: [ALICE, BOB],
        text: 'hello?',
      }),
    );
  });

  it('denies a blocked user (Bob) opening a new chat with the blocker (Alice)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      setDoc(doc(db, 'chats', 'chat-new-ba'), {
        participants: [ALICE, BOB],
        participantsInfo: [{ id: ALICE }, { id: BOB }],
        unreadCount: { [ALICE]: 0, [BOB]: 0 },
      }),
    );
  });

  it('denies the blocker (Alice) opening a new chat with the blocked user (Bob)', async () => {
    // Symmetric guard: if either side blocks the other, no chat is created.
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      setDoc(doc(db, 'chats', 'chat-new-ab'), {
        participants: [ALICE, BOB],
        participantsInfo: [{ id: ALICE }, { id: BOB }],
        unreadCount: { [ALICE]: 0, [BOB]: 0 },
      }),
    );
  });

  it('allows an unrelated user (Carol) to message Alice (no block)', async () => {
    const env = await getTestEnv();
    // Seed a chat between Alice and Carol.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'chats', 'chat-ac'), {
        participants: [ALICE, CAROL],
        participantsInfo: [{ id: ALICE }, { id: CAROL }],
        unreadCount: { [ALICE]: 0, [CAROL]: 0 },
      });
    });
    const db = env.authenticatedContext(CAROL).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'messages', 'msg-ok'), {
        senderId: CAROL,
        receiverId: ALICE,
        type: 'text',
        chatId: 'chat-ac',
        participants: [ALICE, CAROL],
        text: 'hi Alice',
      }),
    );
  });

  it('allows Carol to open a new chat with Bob (no block either side)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(CAROL).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'chats', 'chat-cb'), {
        participants: [BOB, CAROL],
        participantsInfo: [{ id: BOB }, { id: CAROL }],
        unreadCount: { [BOB]: 0, [CAROL]: 0 },
      }),
    );
  });
});
