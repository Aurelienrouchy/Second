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

vi.mock('../config/firebase', () => ({
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

import { acceptMeetupOffer } from './payments';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callAccept = acceptMeetupOffer as unknown as CallableHandler;

const CHAT = 'chat1';
const ARTICLE = 'article1';
const SELLER = 'seller1';
const BUYER = 'buyer1';

function seedChatArticle(opts?: { isSold?: boolean }) {
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
      meetup: { location: { name: 'Café X' } },
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

// ===========================================================================
// F9 — buyer/seller derived from the article
// ===========================================================================

describe('acceptMeetupOffer — F9 derivation', () => {
  it('buyer proposes, SELLER accepts → tx with correct buyer/seller', async () => {
    seedChatArticle();
    seedOffer('m1', BUYER, 80);

    const res = await callAccept({
      auth: { uid: SELLER },
      data: { chatId: CHAT, messageId: 'm1' },
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
      auth: { uid: BUYER },
      data: { chatId: CHAT, messageId: 'm2' },
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
      callAccept({ auth: { uid: BUYER }, data: { chatId: CHAT, messageId: 'm1' } })
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
    });

    const res = await callAccept({
      auth: { uid: SELLER },
      data: { chatId: CHAT, messageId: 'm1' },
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
    expect((fs.getDoc('messages/m1') as Record<string, unknown>)['offer.status']).toBe('accepted');
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
      auth: { uid: SELLER },
      data: { chatId: CHAT, messageId: 'm1' },
    });
    expect(res.success).toBe(true);
    expect(res.reused).toBe(false);
    expect(res.transactionId).not.toBe('oldCancelled');
  });

  it('rejects on isSold when there is NO pre-existing meetup tx (chat flow)', async () => {
    seedChatArticle({ isSold: true });
    seedOffer('m1', BUYER, 80);

    await expect(
      callAccept({ auth: { uid: SELLER }, data: { chatId: CHAT, messageId: 'm1' } })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
