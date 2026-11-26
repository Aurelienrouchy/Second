/**
 * `updateSearchIndex` face à un `createdAt` qui n'est pas un Timestamp.
 *
 * La règle de création cliente directe n'imposait aucun type à `createdAt`,
 * et les builds antérieurs posaient une date client. Le trigger appelait
 * `createdAt?.toDate()` sans vérifier que la méthode existe : un seul
 * document mal formé levait, l'erreur était avalée par le `catch`, et
 * l'article n'entrait jamais dans l'index — ni à la création, ni à aucune
 * écriture suivante.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null, debounced: [] as string[] }));
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
  onDocumentWritten: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));
// Le debounce est un `setTimeout` que Cloud Run peut geler dès le retour du
// handler : on le simule tel quel — enregistré, jamais exécuté.
vi.mock('../utils/debounce', () => ({
  debounceUpdate: (key: string) => {
    holder.debounced.push(key);
  },
}));

import { updateSearchIndex, updateUserStats } from './products';

const run = updateSearchIndex as unknown as (event: unknown) => Promise<void>;
const runStats = updateUserStats as unknown as (event: unknown) => Promise<void>;

function change(before: Record<string, unknown>, after: Record<string, unknown>) {
  fs.setDoc('articles/a1', after);
  return {
    params: { articleId: 'a1' },
    data: {
      before: { exists: true, data: () => before },
      after: { exists: true, data: () => after },
    },
  };
}

function creation(data: Record<string, unknown>) {
  fs.setDoc('articles/a1', data);
  return {
    params: { articleId: 'a1' },
    data: {
      before: { exists: false, data: () => undefined },
      after: { exists: true, data: () => data },
    },
  };
}

const ARTICLE = {
  sellerId: 's1',
  title: 'Robe fleurie',
  description: 'Portée deux fois',
  price: 25,
  isActive: true,
  isSold: false,
  moderationStatus: 'approved',
  categoryIds: ['women', 'women_dresses'],
  images: [{ url: 'https://firebasestorage.googleapis.com/v0/b/b/o/a.jpg?alt=media' }],
  views: 0,
  likes: 0,
};

beforeEach(() => {
  fs.reset();
  holder.debounced.length = 0;
});

describe('updateSearchIndex — createdAt', () => {
  it('indexe un article dont la date de création est un Timestamp', async () => {
    await run(creation({ ...ARTICLE, createdAt: { toDate: () => new Date('2026-09-01') } }));
    expect(fs.getDoc('search_index/a1')).toBeDefined();
  });

  it('indexe quand même un article dont la date de création n’est pas un Timestamp', async () => {
    await run(creation({ ...ARTICLE, createdAt: '2026-09-01' }));
    expect(fs.getDoc('search_index/a1')).toBeDefined();
  });
});

describe('updateSearchIndex — une mise à jour qui compte (T01)', () => {
  const listed = { ...ARTICLE, createdAt: { toDate: () => new Date('2026-09-01') } };

  it('remettre en vente écrit l’index TOUT DE SUITE, pas dans une minuterie gelable', async () => {
    // L'index est supprimé à la vente. La remise en vente passait par un
    // setTimeout que Cloud Run n'exécute pas forcément : l'article ne
    // revenait jamais dans la recherche.
    await run(change({ ...listed, isSold: true }, { ...listed, isSold: false }));
    expect(fs.getDoc('search_index/a1')).toBeDefined();
  });

  it('un changement de prix aussi', async () => {
    await run(change(listed, { ...listed, price: 20 }));
    expect(fs.getDoc('search_index/a1')?.price).toBe(20);
  });

  it('une simple vue reste regroupée (debounce), sans écriture immédiate', async () => {
    await run(change(listed, { ...listed, views: 5 }));
    expect(fs.getDoc('search_index/a1')).toBeUndefined();
    expect(holder.debounced).toContain('search_index_a1');
  });
});

describe('updateUserStats — une vue ne relit plus tout le catalogue (P03)', () => {
  const listed = { ...ARTICLE, createdAt: { toDate: () => new Date('2026-09-01') } };

  it('ne recalcule rien pour une simple vue', async () => {
    await runStats(change(listed, { ...listed, views: 5 }));
    expect(holder.debounced).not.toContain('user_stats_s1');
  });

  it('recalcule quand l’article est vendu', async () => {
    await runStats(change(listed, { ...listed, isSold: true }));
    expect(holder.debounced).toContain('user_stats_s1');
  });
});


/**
 * Écritures d'index inutiles ou mortes.
 *
 * US02 : changer sa photo de profil réécrit tous les articles du vendeur ; le
 * trigger d'index réécrivait alors un document search_index par article, alors
 * que `sellerImage` n'y figure pas.
 * T02/T03/T04 : la description en clair, `titleLowercase` et le bloc
 * `location` sont écrits à chaque indexation et lus nulle part.
 */
describe('updateSearchIndex — écritures inutiles (US02, T02, T03, T04)', () => {
  const listed = { ...ARTICLE, createdAt: { toDate: () => new Date('2026-09-01') } };

  it('un changement de photo de profil du vendeur ne réécrit pas l’index', async () => {
    await run(change(listed, { ...listed, sellerImage: 'https://x/new.jpg' }));
    expect(fs.getDoc('search_index/a1')).toBeUndefined();
    expect(holder.debounced).not.toContain('search_index_a1');
  });

  it('un changement de nom du vendeur, lui, le réécrit', async () => {
    await run(change(listed, { ...listed, sellerName: 'Alice B.' }));
    expect(fs.getDoc('search_index/a1')?.sellerName).toBe('Alice B.');
  });

  it('un changement de description le réécrit (les mots-clés en dépendent)', async () => {
    await run(change(listed, { ...listed, description: 'Neuve, jamais portée' }));
    expect(fs.getDoc('search_index/a1')?.keywords).toContain('jamais');
  });

  it('n’écrit plus la description en clair, mais garde ses mots-clés', async () => {
    await run(creation(listed));
    const doc = fs.getDoc('search_index/a1')!;
    expect(doc.description).toBeUndefined();
    expect(doc.keywords).toContain('portee');
  });

  it('n’écrit plus titleLowercase', async () => {
    await run(creation(listed));
    expect(fs.getDoc('search_index/a1')!.titleLowercase).toBeUndefined();
  });

  it('n’écrit plus de bloc location, ni de geohash sur l’article', async () => {
    const located = {
      ...listed,
      location: { city: 'Montréal', coordinates: { lat: 45.5, lon: -73.6 } },
    };
    await run(creation(located));
    expect(fs.getDoc('search_index/a1')!.location).toBeUndefined();
    expect(holder.debounced).not.toContain('article_geohash_a1');
  });
});
