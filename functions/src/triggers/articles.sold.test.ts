/**
 * `onArticleSold` — vente conclue ou simple réservation ?
 *
 * `isSold` est aussi le VERROU d'une réservation : `acceptMeetupOffer` le pose
 * en créant une transaction `meetup_pending`, pour une rencontre qui peut
 * encore échouer. Le trigger traitait toute bascule comme une vente : il
 * retirait l'article des favoris de tous — définitivement — et annonçait
 * « Cet article a été vendu » dans toutes les conversations.
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
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentUpdated: (_opts: unknown, handler: unknown) => handler,
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));

import { onArticleSold } from './articles';

const run = onArticleSold as unknown as (event: unknown) => Promise<void>;

function markSold() {
  const article = { sellerId: 's1', title: 'Robe', isSold: false, isActive: true };
  fs.setDoc('articles/a1', { ...article, isSold: true });
  return run({
    params: { articleId: 'a1' },
    data: {
      before: { data: () => article },
      after: { data: () => ({ ...article, isSold: true }) },
    },
  });
}

async function systemMessages(): Promise<string[]> {
  const snap = await fs.db.collection('messages').where('type', '==', 'system').get();
  return snap.docs.map((d) => String(d.data()?.content));
}

beforeEach(() => {
  fs.reset();
  fs.setDoc('favorites/buyer1', { articleIds: ['a1', 'a2'] });
  fs.setDoc('chats/c1', { articleId: 'a1', participants: ['s1', 'buyer1'] });
  fs.setDoc('messages/m1', { chatId: 'c1', type: 'offer', offer: { status: 'pending' } });
});

describe('onArticleSold', () => {
  it('une réservation (rencontre acceptée) ne retire l’article d’aucun favori', async () => {
    fs.setDoc('transactions/t1', { articleId: 'a1', status: 'meetup_pending' });
    await markSold();
    expect(fs.getDoc('favorites/buyer1')!.articleIds).toEqual(['a1', 'a2']);
  });

  it('un ancien lien sans projection native ne certifie aucun libellé de vente ou réservation', async () => {
    fs.setDoc('transactions/t1', { articleId: 'a1', status: 'meetup_confirmed' });
    await markSold();
    const messages = await systemMessages();
    expect(messages).toHaveLength(0);expect(fs.writeOps).toHaveLength(0);
  });

  it('un ancien booléen vendu sans stock natif ne détruit aucune préférence', async () => {
    fs.setDoc('transactions/t0', { articleId: 'a1', status: 'meetup_completed' });
    await markSold();
    expect(fs.getDoc('favorites/buyer1')!.articleIds).toEqual(['a1','a2']);
    expect(await systemMessages()).toHaveLength(0);expect(fs.writeOps).toHaveLength(0);
  });

  it('une source de stock inconnue ne peut pas expirer des propositions', async () => {
    fs.setDoc('transactions/t1', { articleId: 'a1', status: 'meetup_pending' });
    await markSold();
    expect((fs.getDoc('messages/m1')!.offer as { status: string }).status).toBe('pending');expect(fs.writeOps).toHaveLength(0);
  });
});
