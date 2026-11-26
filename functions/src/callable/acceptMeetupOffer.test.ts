/**
 * Tests for acceptMeetupOffer (payments.ts) — wave 4 fixes:
 *
 *  - F9: buyer/seller are derived from the ARTICLE (owner = seller, the other
 *    chat participant = buyer), NEVER from the offer sender. This makes a seller
 *    COUNTER-OFFER acceptable by the buyer (previously a dead-end). The accepter
 *    is the party who did NOT emit the offer.
 *  - F8: idempotency for the direct-checkout meetup flow — when the checkout
 *    pre-created the meetup_pending tx (article already isSold=true), accepting
 *    the offer returns THAT tx instead of rejecting on isSold or duplicating it.
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

vi.mock('../config/stripe', () => ({ getStripe: () => ({}) }));
vi.mock('../config/shipEngine', () => ({ getShipEngine: () => ({}) }));
vi.mock('../utils/fees', () => ({
  calculateFees: () => ({}),
  calculateServiceFee: () => 0,
  getServiceFeeConfig: () => ({}),
}));
vi.mock('../utils/rateLimit', () => ({
  checkRateLimit: async () => {},
  resolveCallerKey: (request: { auth?: { uid?: string } }) => ({
    callerKey: request.auth?.uid ?? 'anon',
    isAuthenticated: !!request.auth,
  }),
}));
vi.mock('../utils/trackingTransition', () => ({
  applyTrackingOutcome: () => {},
  DELIVERABLE_STATUSES: new Set<string>(),
}));
vi.mock('../utils/refund', () => ({ issueTransactionRefund: async () => ({ success: true }) }));
vi.mock('../utils/notifications', () => ({ sendPushNotification: async () => {} }));
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

import { acceptMeetupOffer, confirmMeetupTransaction, completeMeetupTransaction } from './payments';
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callAccept = acceptMeetupOffer as unknown as CallableHandler;

const CHAT = 'chat1';
const ARTICLE = 'article1';
const SELLER = 'seller1';
const BUYER = 'buyer1';
const LOCATION = { name: 'Café X', category: 'cafe', neighborhood: { id: 'n1', name: 'Plateau', borough: 'Plateau' } };

function seedChatArticle(opts?: { isSold?: boolean }) {
  fs.setDoc(`users/${SELLER}`, { isActive: true, dateOfBirth: '2000-01-01' });
  fs.setDoc(`users/${BUYER}`, { isActive: true, dateOfBirth: '2000-01-01' });
  fs.setDoc('users/buyer2', { isActive: true, dateOfBirth: '2000-01-01' });
  fs.setDoc(`eligibility_profiles/${SELLER}`, { version: 1, activityDeclaration: { kind: 'personal', actorUid: SELLER,
    recordedAt: new Date(), declarationVersion: 1, statement: SELLER_ACTIVITY_STATEMENTS.personal, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION } });
  fs.setDoc(`chats/${CHAT}`, {
    participants: [SELLER, BUYER],
    articleId: ARTICLE,
  });
  fs.setDoc(`articles/${ARTICLE}`, {
    sellerId: SELLER,
    price: 100,
    isSold: opts?.isSold ?? false,
    isActive: true,
  });
}

/** A pending meetup offer message emitted by `senderId`. */
function seedOffer(messageId: string, senderId: string, amount = 80) {
  fs.setDoc(`messages/${messageId}`, {
    type: 'offer',
    chatId: CHAT,
    senderId,
    offer: {
      status: 'pending',
      amount,
      meetup: { location: LOCATION },
    },
  });
}

beforeEach(() => {
  fs.reset();
});

describe('acceptMeetupOffer — auth', () => {
  it('requires authentication', async () => {
    await expect(
      callAccept({ auth: null, data: { chatId: CHAT, messageId: 'm1' } })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

it('accepts the full price of a sub-dollar article and preserves its exact amount', async () => {
  seedChatArticle();
  fs.setDoc(`articles/${ARTICLE}`, { sellerId: SELLER, price: 0.5, isSold: false, isActive: true });
  seedOffer('cheap', BUYER, 0.5);
  const result = await callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'cheap' } });
  expect(fs.getDoc(`transactions/${result.transactionId}`)?.amount).toBe(0.5);
  expect(fs.getDoc(`articles/${ARTICLE}`)?.isSold).toBe(true);
});

// ===========================================================================
// F9 — buyer/seller derived from the article
// ===========================================================================

describe('acceptMeetupOffer — F9 derivation', () => {
  it('buyer proposes, SELLER accepts → tx with correct buyer/seller', async () => {
    seedChatArticle();
    seedOffer('m1', BUYER, 80);

    const res = await callAccept({
      auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER },
      data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' },
    });
    expect(res.success).toBe(true);

    const txWrite = fs.writeOps.find(
      (op) => op.path.startsWith('transactions/') && op.method === 'set'
    );
    expect(txWrite).toBeDefined();
    expect(txWrite!.data.buyerId).toBe(BUYER);
    expect(txWrite!.data.sellerId).toBe(SELLER);
    expect(txWrite!.data.amount).toBe(80);
    expect(txWrite!.data.status).toBe('meetup_pending');
    // Article locked.
    expect(fs.getDoc(`articles/${ARTICLE}`)!.isSold).toBe(true);
  });

  it('SELLER counter-offers, BUYER accepts → still buyer/seller correct (no permission-denied)', async () => {
    seedChatArticle();
    // The counter-offer is emitted by the SELLER.
    seedOffer('m2', SELLER, 90);

    const res = await callAccept({
      auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER },
      data: { expectedUid: BUYER, chatId: CHAT, messageId: 'm2' },
    });
    expect(res.success).toBe(true);

    const txWrite = fs.writeOps.find(
      (op) => op.path.startsWith('transactions/') && op.method === 'set'
    );
    expect(txWrite!.data.buyerId).toBe(BUYER);
    expect(txWrite!.data.sellerId).toBe(SELLER);
    expect(txWrite!.data.amount).toBe(90);
  });

  it('refuses the offer EMITTER accepting their own offer', async () => {
    seedChatArticle();
    seedOffer('m1', BUYER, 80);
    await expect(
      callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER }, data: { expectedUid: BUYER, chatId: CHAT, messageId: 'm1' } })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ===========================================================================
// F8 — idempotency for the direct-checkout flow
// ===========================================================================

describe('acceptMeetupOffer — F8 idempotency (pre-created tx)', () => {
  it('returns the pre-existing meetup tx instead of rejecting on isSold', async () => {
    // Checkout pre-created the tx + locked the article.
    seedChatArticle({ isSold: true });
    seedOffer('m1', BUYER, 80);
    fs.setDoc('transactions/preTx', {
      chatId: CHAT,
      buyerId: BUYER,
      sellerId: SELLER,
      articleId: ARTICLE,
      deliveryType: 'meetup',
      status: 'meetup_pending',
      amount: 80,
      meetupSpot: LOCATION,
    });

    const res = await callAccept({
      auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER },
      data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' },
    });

    expect(res.success).toBe(true);
    expect(res.transactionId).toBe('preTx');
    expect(res.reused).toBe(true);

    // No NEW transaction created.
    const newTxWrites = fs.writeOps.filter(
      (op) => op.path.startsWith('transactions/') && op.method === 'set'
    );
    expect(newTxWrites.length).toBe(0);

    // The offer was still accepted.
    expect((fs.getDoc('messages/m1') as any).offer.status).toBe('accepted');
  });

  it('ignores a CANCELLED pre-existing tx and proceeds with a fresh one', async () => {
    seedChatArticle({ isSold: false });
    seedOffer('m1', BUYER, 80);
    fs.setDoc('transactions/oldCancelled', {
      chatId: CHAT,
      buyerId: BUYER,
      sellerId: SELLER,
      articleId: ARTICLE,
      deliveryType: 'meetup',
      status: 'cancelled',
    });

    const res = await callAccept({
      auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER },
      data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' },
    });
    expect(res.success).toBe(true);
    expect(res.reused).toBe(false);
    expect(res.transactionId).not.toBe('oldCancelled');
  });

  it('rejects on isSold when there is NO pre-existing meetup tx (chat flow)', async () => {
    seedChatArticle({ isSold: true });
    seedOffer('m1', BUYER, 80);

    await expect(
      callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});


describe('acceptMeetupOffer — commitment safety', () => {
  it('double acceptance returns one exactly linked transaction', async () => {
    seedChatArticle(); seedOffer('m1', BUYER);
    const request = { auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' } };
    const [first, second] = await Promise.all([callAccept(request), callAccept(request)]);
    expect(first.transactionId).toBe(second.transactionId);
    expect(second.reused).toBe(true);
    expect(fs.writeOps.filter((w) => w.path.startsWith('transactions/') && w.method === 'set')).toHaveLength(1);
    expect(fs.getDoc(`transactions/${first.transactionId}`)?.offerMessageId).toBe('m1');
  });

  it('two buyers racing to accept cannot share or duplicate an agreement', async () => {
    seedChatArticle(); seedOffer('m1', BUYER);
    fs.setDoc('chats/chat2', { participants: [SELLER, 'buyer2'], articleId: ARTICLE });
    fs.setDoc('messages/m2', { type: 'offer', chatId: 'chat2', senderId: 'buyer2', offer: {
      amount: 80, status: 'pending', meetup: { location: LOCATION },
    } });
    const responses = await Promise.allSettled([
      callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' } }),
      callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: 'chat2', messageId: 'm2' } }),
    ]);
    expect(responses.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(fs.writeOps.filter((w) => w.path.startsWith('transactions/') && w.method === 'set')).toHaveLength(1);
  });

  it.each([
    { amount: 90, meetupSpot: LOCATION, status: 'meetup_pending' },
    { amount: 80, meetupSpot: { ...LOCATION, name: 'Autre lieu' }, status: 'meetup_pending' },
    { amount: 80, meetupSpot: LOCATION, status: 'meetup_confirmed' },
    { amount: 80, meetupSpot: LOCATION, status: 'meetup_pending', offerMessageId: 'differentOffer' },
  ])('never reuses differing or already accepted agreement %j', async (terms) => {
    seedChatArticle({ isSold: true }); seedOffer('m1', BUYER);
    fs.setDoc('transactions/existing', { chatId: CHAT, buyerId: BUYER, sellerId: SELLER, articleId: ARTICLE, deliveryType: 'meetup', ...terms });
    await expect(callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' } })).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc('transactions/existing')?.amount).toBe(terms.amount);
    expect(fs.writeOps).toEqual([]);
  });
});


describe('meetup follow-up transitions preserve the exact agreement', () => {
  const confirm = confirmMeetupTransaction as unknown as CallableHandler;
  const complete = completeMeetupTransaction as unknown as CallableHandler;
  it('confirm and complete update only the bound offer atomically and replay safely', async () => {
    seedChatArticle(); seedOffer('m1', BUYER);
    const accepted = await callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' } });
    const request = { auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, transactionId: accepted.transactionId, messageId: 'm1' } };
    await confirm(request); await confirm(request);
    expect(fs.getDoc(`transactions/${accepted.transactionId}`)?.status).toBe('meetup_confirmed');
    expect((fs.getDoc('messages/m1')?.offer as Record<string, unknown>).status).toBe('accepted');
    await complete(request); await complete(request);
    expect(fs.getDoc(`transactions/${accepted.transactionId}`)?.status).toBe('meetup_completed');
    expect((fs.getDoc('messages/m1')?.offer as Record<string, unknown>).status).toBe('completed');
  });
  it('an older message in the same chat cannot confirm or complete a different agreement', async () => {
    seedChatArticle(); seedOffer('m1', BUYER);
    const accepted = await callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' } });
    seedOffer('old', BUYER, 70);
    await fs.db.collection('messages').doc('old').update({ 'offer.status': 'accepted' });
    const request = { auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, transactionId: accepted.transactionId, messageId: 'old' } };
    await expect(confirm(request)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc(`transactions/${accepted.transactionId}`)?.status).toBe('meetup_pending');
    await confirm({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, transactionId: accepted.transactionId, messageId: 'm1' } });
    await expect(complete(request)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(fs.getDoc(`transactions/${accepted.transactionId}`)?.status).toBe('meetup_confirmed');
    expect((fs.getDoc('messages/old')?.offer as Record<string, unknown>).status).toBe('accepted');
  });
});


it('expired proposals cannot create a meetup reservation', async () => {
  seedChatArticle(); seedOffer('expired', BUYER);
  await fs.db.collection('messages').doc('expired').update({ 'offer.expiresAt': new Date(Date.now() - 1000) });
  await expect(callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'expired' } })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(fs.getDoc('articles/article1')?.isSold).toBe(false);
  expect(fs.writeOps.filter((w) => w.path.startsWith('transactions/'))).toEqual([]);
});


it('ambiguous legacy pending proposals must be explicitly replaced before acceptance', async () => {
  seedChatArticle(); seedOffer('older', BUYER); seedOffer('newer', BUYER, 70);
  await expect(callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'older' } })).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(fs.getDoc('articles/article1')?.isSold).toBe(false);
  expect(fs.writeOps).toEqual([]);
});

describe('acceptMeetupOffer — offre expirée', () => {
  // Le marquage « expirée » était posé DANS la runTransaction, juste avant le
  // throw qui l'abandonne : il n'était donc jamais persisté et l'offre restait
  // `pending` jusqu'au balayage horaire. Il s'écrit maintenant après l'abandon.
  it("marque réellement l'offre comme expirée avant de refuser", async () => {
    seedChatArticle();
    fs.setDoc('messages/m1', {
      type: 'offer',
      chatId: CHAT,
      senderId: BUYER,
      offer: {
        status: 'pending',
        amount: 80,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        meetup: { location: LOCATION },
      },
    });

    await expect(
      callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect((fs.getDoc('messages/m1') as any).offer.status).toBe('expired');
    expect((fs.getDoc(`articles/${ARTICLE}`) as any).isSold).toBe(false);
  });
});

describe('acceptMeetupOffer — compte supprimé', () => {
  it("refuse d'accepter l'offre d'un acheteur dont le compte a disparu", async () => {
    seedChatArticle();
    fs.setDoc(`users/${BUYER}`, null); // compte supprimé
    seedOffer('m1', BUYER);

    await expect(
      callAccept({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, chatId: CHAT, messageId: 'm1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    expect((fs.getDoc(`articles/${ARTICLE}`) as any).isSold).toBe(false);
  });
});
