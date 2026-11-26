/**
 * SS01 — les alertes de recherche sauvegardée plafonnent AVANT de filtrer.
 *
 * La requête porte `where('createdAt', '>', lastNotifiedAt)` : Firestore
 * l'ordonne alors implicitement par `createdAt` CROISSANT, et le `limit(50)`
 * retient les cinquante plus ANCIENNES correspondances. Les filtres fins
 * (état, marque, matière) s'appliquent ensuite, en mémoire, sur ce paquet : un
 * vendeur actif fait donc passer les nouveautés hors de la fenêtre, et
 * l'alerte promise ne part jamais.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  sent: [] as Array<Record<string, unknown>>,
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
vi.mock('firebase-admin', () => ({
  messaging: () => ({
    sendEach: async (messages: Array<Record<string, unknown>>) => {
      holder.sent.push(...messages);
      return { responses: messages.map(() => ({ success: true })) };
    },
  }),
  firestore: { FieldValue: { arrayRemove: (...v: unknown[]) => v } },
}));
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));
vi.mock('../utils/notifications', () => ({
  sendPushNotification: async (_uid: string, title: string, body: string, data: Record<string, unknown>) => { holder.sent.push({ notification: { title, body }, data }); return { success: true }; },
  partitionTokens: (tokens: string[]) => ({ fcmTokens: tokens, apnsTokens: [] }),
}));

import { checkSavedSearchNotifications } from './savedSearches';

const run = checkSavedSearchNotifications as unknown as () => Promise<void>;

const JOUR = 24 * 60 * 60 * 1000;
const DEBUT = new Date('2026-09-01T12:00:00Z').getTime();

/** Firestore rend des Timestamp : le planificateur appelle `.toDate()` dessus. */
function horodatage(ms: number) {
  return { toDate: () => new Date(ms), toMillis: () => ms };
}

beforeEach(() => {
  fs.reset();
  holder.sent.length = 0;
  fs.setDoc('users/u1', { fcmTokens: ['token-1'] });
  fs.setDoc('users/u1/savedSearches/s1', {
    notifyNewItems: true,
    name: 'Robes neuves',
    filters: { condition: 'neuf' },
    lastNotifiedAt: horodatage(DEBUT - JOUR),
  });
  // Soixante correspondances depuis la dernière alerte : les cinquante-cinq
  // plus anciennes sont en « bon état », seules les cinq DERNIÈRES sont neuves.
  for (let i = 0; i < 60; i++) {
    fs.setDoc(`articles/a${String(i).padStart(2, '0')}`, {
      title: `Robe ${i}`,
      isActive: true,
      isSold: false,
      createdAt: horodatage(DEBUT + i * 60_000),
      condition: i < 55 ? 'bon état' : 'neuf',
      sellerId: 'vendeur',
      price: 30,
    });
  }
});

describe('checkSavedSearchNotifications — la fenêtre de 50 (SS01)', () => {
  it('notifie les correspondances les plus RÉCENTES, pas les cinquante plus anciennes', async () => {
    await run();
    expect(holder.sent).toHaveLength(1);
    expect(holder.sent[0].data).toMatchObject({ newItemsCount: '5', savedSearchId: 's1' });
  });

  it('marque la recherche comme notifiée', async () => {
    await run();
    expect(fs.getDoc('users/u1/savedSearches/s1')!.newItemsCount).toBe(5);
  });
});
