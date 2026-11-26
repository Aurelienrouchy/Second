/**
 * Signalement d'absence sur une rencontre — et surtout la CONTRE-DÉCLARATION.
 *
 * Un signalement gèle la transaction en `disputed`, ce qui rendait tout second
 * signalement impossible : la personne visée n'avait aucun moyen, dans l'app, de
 * donner sa version, alors que la notification l'y invite et que
 * l'administrateur ne recevait qu'un seul récit.
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
const pushed = vi.hoisted(() => ({ calls: [] as Array<{ to: string; type: string }> }));
vi.mock('../utils/notifications', () => ({
  sendPushNotification: async (to: string, _t: string, _b: string, _d: unknown, type: string) => {
    pushed.calls.push({ to, type });
  },
}));
vi.mock('../lib/analytics', () => ({ captureServerEvent: async () => {} }));
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

import { reportMeetupNoShow } from './payments';

type CallableHandler = (request: {
  auth?: { uid: string } | null;
  data?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;
const callReport = reportMeetupNoShow as unknown as CallableHandler;

const BUYER = 'buyer1';
const SELLER = 'seller1';
const TX = 'tx1';
const ARTICLE = 'article1';

function seedLiveMeetup() {
  fs.setDoc(`articles/${ARTICLE}`, { sellerId: SELLER, isSold: true, isActive: true });
  fs.setDoc(`transactions/${TX}`, {
    buyerId: BUYER,
    sellerId: SELLER,
    articleId: ARTICLE,
    deliveryType: 'meetup',
    status: 'meetup_confirmed',
    chatId: 'chat1',
    offerMessageId: 'm1',
  });
  fs.setDoc('messages/m1', {
    type: 'offer',
    chatId: 'chat1',
    senderId: BUYER,
    offer: { status: 'accepted', amount: 80, meetup: { location: { name: 'Café X' } } },
  });
}

beforeEach(() => {
  fs.reset();
  pushed.calls = [];
});

describe('reportMeetupNoShow — premier signalement', () => {
  it('gèle la transaction, libère l’article et ouvre un dossier', async () => {
    seedLiveMeetup();

    const res = await callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER }, data: { expectedUid: BUYER, transactionId: TX } });

    expect(res.success).toBe(true);
    const tx = fs.getDoc(`transactions/${TX}`) as any;
    expect(tx.status).toBe('disputed');
    expect(tx.noShowReport.reportedBy).toBe(BUYER);
    expect((fs.getDoc(`articles/${ARTICLE}`) as any).isSold).toBe(false);
  });
});

describe('reportMeetupNoShow — contre-déclaration de la partie visée', () => {
  it('accepte la version de l’accusé sans rien rouvrir', async () => {
    seedLiveMeetup();
    await callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER }, data: { expectedUid: BUYER, transactionId: TX } });

    const res = await callReport({
      auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER },
      data: { expectedUid: SELLER, transactionId: TX, details: 'Je me suis présenté.' },
    });

    expect(res.counterDeclaration).toBe(true);
    const tx = fs.getDoc(`transactions/${TX}`) as any;
    // La contre-déclaration est enregistrée…
    expect(tx.counterReport.reportedBy).toBe(SELLER);
    expect(tx.counterReport.details).toBe('Je me suis présenté.');
    // …sans toucher au statut, au premier récit, ni au verrou de l'article.
    expect(tx.status).toBe('disputed');
    expect(tx.noShowReport.reportedBy).toBe(BUYER);
    expect((fs.getDoc(`articles/${ARTICLE}`) as any).isSold).toBe(false);
  });

  it('refuse une seconde contre-déclaration de la même personne', async () => {
    seedLiveMeetup();
    await callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER }, data: { expectedUid: BUYER, transactionId: TX } });
    await callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, transactionId: TX } });

    await expect(
      callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, transactionId: TX } }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('refuse au signaleur initial de se contre-déclarer lui-même', async () => {
    seedLiveMeetup();
    await callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER }, data: { expectedUid: BUYER, transactionId: TX } });

    await expect(
      callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER }, data: { expectedUid: BUYER, transactionId: TX } }),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('refuse un tiers étranger à la transaction', async () => {
    seedLiveMeetup();
    await callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER }, data: { expectedUid: BUYER, transactionId: TX } });

    await expect(
      callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: 'intrus' }, data: { expectedUid: 'intrus', transactionId: TX } }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ===========================================================================
// Le droit de réponse ne peut pas dépendre d'un réglage de confort.
//
// Ces deux notifications partaient sous le type `order_cancelled`, adossé à la
// préférence « Nouvelles ventes ». Une personne qui a coupé cette catégorie
// n'apprenait ni qu'elle est accusée de ne pas s'être présentée, ni qu'elle
// peut donner sa version. `no_show_reported` n'est adossé à aucun réglage.
// ===========================================================================
describe('reportMeetupNoShow — la notification de recours est inconditionnelle', () => {
  it("notifie la partie visee sous un type sans reglage", async () => {
    seedLiveMeetup();

    await callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER }, data: { expectedUid: BUYER, transactionId: TX } });

    expect(pushed.calls).toHaveLength(1);
    expect(pushed.calls[0].to).toBe(SELLER);
    expect(pushed.calls[0].type).toBe('no_show_reported');
  });

  it("notifie de meme le premier signaleur quand sa version est contestee", async () => {
    seedLiveMeetup();
    await callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: BUYER }, data: { expectedUid: BUYER, transactionId: TX } });
    pushed.calls = [];

    await callReport({ auth: { token: { auth_time: Math.floor(Date.now() / 1000) }, uid: SELLER }, data: { expectedUid: SELLER, transactionId: TX } });

    expect(pushed.calls).toHaveLength(1);
    expect(pushed.calls[0].to).toBe(BUYER);
    expect(pushed.calls[0].type).toBe('no_show_reported');
  });
});
