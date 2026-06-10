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

import { expireStaleAcceptedOffers } from './offerExpiration';

type Scheduled = () => Promise<void>;
const run = expireStaleAcceptedOffers as unknown as Scheduled;

const BUYER = 'buyer1';
const CHAT = 'chat1';
const OLD = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72h ago (past 48h grace)
const RECENT = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago (within grace)

/**
 * Seed an accepted offer message. `offer.status` is duplicated as a flat key so
 * the query mock (matches data[c.field]) returns it.
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
    // Flat keys so the where('type'==)/where('offer.status'==) mock matches.
    'offer.status': 'accepted',
  });
}

beforeEach(() => {
  fs.reset();
});

describe('expireStaleAcceptedOffers (F135)', () => {
  // NOTE: the in-memory mock applies a dotted update key (`'offer.status'`) as a
  // FLAT key (it does not deep-merge into the nested `offer` object — unlike real
  // Firestore). So the job's write lands on the flat `'offer.status'` key. We
  // assert on that flat key, mirroring acceptMeetupOffer.test.ts.
  const flatStatus = (id: string) =>
    (fs.getDoc(`messages/${id}`) as Record<string, unknown>)['offer.status'];

  it('expires an accepted, unconsumed offer past the 48h grace window', async () => {
    seedAcceptedOffer('m1', { acceptedAt: OLD });

    await run();

    expect(flatStatus('m1')).toBe('expired');
    expect((fs.getDoc('messages/m1') as Record<string, unknown>)['offer.expiredReason']).toBe(
      'accepted_unconsumed'
    );
  });

  it('leaves a recently-accepted offer untouched (within grace window)', async () => {
    seedAcceptedOffer('m1', { acceptedAt: RECENT });

    await run();

    expect(flatStatus('m1')).toBe('accepted');
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

    expect(flatStatus('m1')).toBe('accepted');
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

    expect(flatStatus('m1')).toBe('expired');
  });

  it('falls back to offer.expiresAt when acceptedAt is absent (legacy offers)', async () => {
    // Legacy accepted offer (accepted before acceptedAt was stamped): only
    // expiresAt is present, and it is well past the grace window.
    seedAcceptedOffer('m1', { expiresAt: OLD });

    await run();

    expect(flatStatus('m1')).toBe('expired');
  });

  it('is a no-op when there are no accepted offers', async () => {
    await expect(run()).resolves.toBeUndefined();
  });
});
