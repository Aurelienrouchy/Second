/**
 * Tests for expireStaleAcceptedOffers (F135).
 *
 * An offer flipped to `accepted` (shipping/non-meetup: the buyer pays separately
 * via checkout) but never turned into a transaction locks the negotiated price
 * forever — verifyAcceptedOfferForNegotiatedAmount matches accepted offers by
 * amount with no time bound. This job expires such offers after a 48h grace
 * window, BUT only when no live (non-cancelled) transaction consumed the offer.
 *
 * The in-memory query mock matches on the LITERAL key `data[c.field]`, so each
 * message doc is seeded with BOTH the nested `offer` object (read by the job)
 * AND a flat `'offer.status'` key (matched by the `where('offer.status','==')`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
}));

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

vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));

import { expireStaleAcceptedOffers, expireStaleOffers } from './offerExpiration';

type Scheduled = () => Promise<void>;
const run = expireStaleAcceptedOffers as unknown as Scheduled;

const BUYER = 'buyer1';
const CHAT = 'chat1';
const OLD = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72h ago (past 48h grace)
const RECENT = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago (within grace)

/**
 * Seed an accepted offer message.
 */
function seedAcceptedOffer(
  messageId: string,
  opts: { acceptedAt?: Date; expiresAt?: Date; timestamp?: Date; amount?: number; senderId?: string; chatId?: string } = {}
) {
  const offer: Record<string, unknown> = {
    status: 'accepted',
    amount: opts.amount ?? 80,
  };
  if (opts.acceptedAt) offer.acceptedAt = opts.acceptedAt;
  if (opts.expiresAt) offer.expiresAt = opts.expiresAt;
  fs.setDoc(`messages/${messageId}`, {
    type: 'offer',
    chatId: opts.chatId ?? CHAT,
    senderId: opts.senderId ?? BUYER,
    timestamp: opts.timestamp ?? opts.acceptedAt ?? OLD,
    offer,
  });
}

beforeEach(() => {
  fs.reset();
});

describe('expireStaleAcceptedOffers (F135)', () => {
  // Le mock résout désormais la notation pointée comme Firestore : un
  // `update({'offer.status': …})` écrit le champ IMBRIQUÉ, et
  // `where('offer.status','==',…)` l'interroge au même endroit. On asserte donc
  // sur la forme réelle de production.
  const offerStatus = (id: string) => (fs.getDoc(`messages/${id}`) as any).offer.status;

  it('expires an accepted, unconsumed offer past the 48h grace window', async () => {
    seedAcceptedOffer('m1', { acceptedAt: OLD });

    await run();

    expect(offerStatus('m1')).toBe('expired');
    expect((fs.getDoc('messages/m1') as any).offer.expiredReason).toBe('accepted_unconsumed');
  });

  it('leaves a recently-accepted offer untouched (within grace window)', async () => {
    seedAcceptedOffer('m1', { acceptedAt: RECENT });

    await run();

    expect(offerStatus('m1')).toBe('accepted');
  });

  it('does NOT expire a consumed offer (live transaction exists for buyer+chat)', async () => {
    seedAcceptedOffer('m1', { acceptedAt: OLD });
    // A transaction was created from this offer (buyer paid) — must be preserved.
    fs.setDoc('transactions/t1', {
      buyerId: BUYER,
      chatId: CHAT,
      status: 'paid',
    });

    await run();

    expect(offerStatus('m1')).toBe('accepted');
  });

  it('DOES expire when the only transaction is cancelled (offer not consumed)', async () => {
    seedAcceptedOffer('m1', { acceptedAt: OLD });
    // A cancelled transaction does not consume the negotiated offer.
    fs.setDoc('transactions/t1', {
      buyerId: BUYER,
      chatId: CHAT,
      status: 'cancelled',
    });

    await run();

    expect(offerStatus('m1')).toBe('expired');
  });

  it('falls back to offer.expiresAt when acceptedAt is absent (legacy offers)', async () => {
    // Legacy accepted offer (accepted before acceptedAt was stamped): only
    // expiresAt is present, and it is well past the grace window.
    seedAcceptedOffer('m1', { expiresAt: OLD });

    await run();

    expect(offerStatus('m1')).toBe('expired');
  });

  // Régression : l'acheteur d'une rencontre est dérivé de l'ARTICLE (F9), pas de
  // l'émetteur de l'offre. Sur une CONTRE-OFFRE émise par le vendeur,
  // `senderId` est le vendeur. Le balayage cherchait les transactions de cet
  // « acheteur », n'en trouvait aucune, et expirait l'offre d'une rencontre
  // vivante — éteignant les boutons de la bulle de chat, seul point d'entrée du
  // parcours meetup.
  it('ne touche pas une contre-offre du VENDEUR dont la rencontre est vivante', async () => {
    const SELLER = 'seller1';
    seedAcceptedOffer('m1', { acceptedAt: OLD, senderId: SELLER });
    fs.setDoc('transactions/t1', {
      buyerId: BUYER, // ≠ senderId : c'est le vendeur qui a émis la contre-offre
      sellerId: SELLER,
      chatId: CHAT,
      deliveryType: 'meetup',
      status: 'meetup_confirmed',
    });

    await run();

    expect(offerStatus('m1')).toBe('accepted');
  });

  // La consommation se juge sur la CONVERSATION : une transaction vivante dans
  // un autre chat ne doit jamais protéger cette offre-ci.
  it('expire bien une offre dont la seule transaction vivante est dans un autre chat', async () => {
    seedAcceptedOffer('m1', { acceptedAt: OLD });
    fs.setDoc('transactions/t1', {
      buyerId: BUYER,
      chatId: 'un-autre-chat',
      status: 'meetup_confirmed',
    });

    await run();

    expect(offerStatus('m1')).toBe('expired');
  });

  it('is a no-op when there are no accepted offers', async () => {
    await expect(run()).resolves.toBeUndefined();
  });
});


it('pending expiry cannot overwrite acceptance after the query snapshot', async () => {
  const expired = new Date(Date.now() - 1000);
  fs.setDoc('messages/racing', { type: 'offer', chatId: CHAT, senderId: BUYER, offer: { status: 'accepted', expiresAt: expired }, 'offer.status': 'accepted' });
  fs.setQuery('messages', [{ id: 'racing', data: { type: 'offer', offer: { status: 'pending', expiresAt: expired }, 'offer.status': 'pending', 'offer.expiresAt': expired } }]);
  await (expireStaleOffers as unknown as Scheduled)();
  expect((fs.getDoc('messages/racing')?.offer as Record<string, unknown>).status).toBe('accepted');
  expect(fs.writeOps).toEqual([]);
});

it('preserves an accepted seller counter-offer through its exact linked buyer transaction', async () => {
  seedAcceptedOffer('counter', { senderId: 'seller', acceptedAt: OLD });
  await fs.db.collection('messages').doc('counter').update({ 'offer.transactionId': 'linked' });
  fs.setDoc('transactions/linked', { buyerId: BUYER, chatId: CHAT, status: 'meetup_confirmed', offerMessageId: 'counter', amount: 80 });
  await run();
  expect((fs.getDoc('messages/counter')?.offer as Record<string, unknown>).status).toBe('accepted');
});


describe('phase1 offer partition is disjoint from the ordinary Dev jobs',()=>{
  it.each([null,{}, {protocol:'phase1_message_origin_v1',installationId:'foreign',epoch:'wrong'}])('never changes a present origin marker %j',async phase1Source=>{
    seedAcceptedOffer('accepted',{acceptedAt:OLD});fs.setDoc('messages/accepted',{...fs.getDoc('messages/accepted'),phase1Source});
    fs.setDoc('messages/pending',{type:'offer',phase1Source,offer:{status:'pending',expiresAt:OLD}});
    await run();await (expireStaleOffers as unknown as Scheduled)();
    expect((fs.getDoc('messages/accepted') as any).offer.status).toBe('accepted');
    expect((fs.getDoc('messages/pending') as any).offer.status).toBe('pending');expect(fs.writeOps).toHaveLength(0);
  });
});
