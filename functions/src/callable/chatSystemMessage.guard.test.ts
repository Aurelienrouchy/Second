/**
 * `postChatSystemMessage` vérifiait la PARTICIPATION mais pas le BLOCAGE.
 *
 * C'est le seul canal d'écriture serveur ouvert aux deux participants d'une
 * conversation. Les règles Firestore refusent la création d'un message par une
 * personne bloquée (`neitherBlocks`), et le trigger détruit ce qui passerait
 * malgré tout — mais cette callable écrit en Admin SDK, donc HORS des règles.
 * Une personne bloquée pouvait ainsi continuer à faire apparaître du contenu
 * dans le fil de celle qui l'a bloquée, sous la VOIX de la plateforme, avec
 * jusqu'à 120 caractères de texte libre via `locationName`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({ auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString(), customClaims: { admin: uid === 'admin' } }) },
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));
vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: (request: { auth?: { uid?: string } }) => ({
    callerKey: request.auth?.uid ?? 'anon',
    isAuthenticated: !!request.auth,
  }),
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));
vi.mock('firebase-functions/v2/https', () => {
  class _HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  }
  return { onCall: (_opts: unknown, handler: unknown) => handler, HttpsError: _HttpsError };
});

import { postChatSystemMessage } from './chatSystemMessage';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const post = postChatSystemMessage as unknown as CallableHandler;

const ALICE = 'alice';
const BOB = 'bob';
const CHAT = 'chat1';

function seedChat() {
  fs.setDoc(`chats/${CHAT}`, { participants: [ALICE, BOB] });
  fs.setDoc(`users/${ALICE}`, {});
  fs.setDoc(`users/${BOB}`, {});
}

function countSystemMessages(): number {
  return fs.countWrites(
    (op) => op.path.startsWith('messages/') && op.data?.senderId === 'system'
  );
}

beforeEach(() => {
  fs.reset();
});

describe('postChatSystemMessage — garde de blocage', () => {
  it('un participant non bloqué poste normalement', async () => {
    seedChat();
    const res = await post({
      auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BOB },
      data: { expectedUid: BOB, chatId: CHAT, kind: 'offer_accepted', params: { amount: 40 } },
    });
    expect(res.success).toBe(true);
    expect(countSystemMessages()).toBe(1);
  });

  it('refuse quand le destinataire a bloqué l’appelant', async () => {
    seedChat();
    fs.setDoc(`users/${ALICE}`, { blockedUserIds: [BOB] });

    await expect(
      post({
        auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BOB },
        data: { expectedUid: BOB, chatId: CHAT, kind: 'counter_location', params: { locationName: 'coucou' } },
      })
    ).rejects.toThrow();
    expect(countSystemMessages()).toBe(0);
  });

  it('refuse aussi dans l’autre sens : l’appelant a bloqué l’autre', async () => {
    seedChat();
    fs.setDoc(`users/${ALICE}`, { blockedUserIds: [BOB] });

    await expect(
      post({
        auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: ALICE },
        data: { expectedUid: ALICE, chatId: CHAT, kind: 'offer_rejected', params: { amount: 40 } },
      })
    ).rejects.toThrow();
    expect(countSystemMessages()).toBe(0);
  });

  it('voit aussi un blocage stocké dans l’ancienne forme objet', async () => {
    seedChat();
    fs.setDoc(`users/${ALICE}`, {
      blockedUsers: [{ userId: BOB, userName: 'Bob', blockedAt: '2026-01-01' }],
    });

    await expect(
      post({
        auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BOB },
        data: { expectedUid: BOB, chatId: CHAT, kind: 'offer_accepted', params: { amount: 40 } },
      })
    ).rejects.toThrow();
    expect(countSystemMessages()).toBe(0);
  });

  it('un non-participant est toujours refusé', async () => {
    seedChat();
    await expect(
      post({
        auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: 'mallory' },
        data: { expectedUid: 'mallory', chatId: CHAT, kind: 'offer_accepted', params: { amount: 40 } },
      })
    ).rejects.toThrow();
    expect(countSystemMessages()).toBe(0);
  });
});
