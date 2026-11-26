/**
 * Embeddings d'articles — deux trouvailles de la chasse « mise en vente ».
 *
 * EM01 : quand l'URL d'image n'était pas une URL Storage, le trigger faisait
 * un `fetch` sur l'URL fournie par le vendeur — une requête sortante
 * arbitraire depuis la fonction, sans liste blanche ni plafond de taille.
 * EM03 : un article VENDU restait actif dans l'index vectoriel.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({
  fs: null as MockFirestore | null,
  downloads: [] as string[],
  predicts: 0,
  predictError: null as unknown,
  onPredict: null as (() => void) | null,
  vectorDocs: [] as Array<{ id: string; data: Record<string, unknown> }>,
  createOptions: {} as Record<string, unknown>,
  updateOptions: {} as Record<string, unknown>,
}));
const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

vi.mock('../config/firebase', () => ({
  get db() {
    const db = holder.fs!.db;
    return {
      ...db,
      collection: (path: string) => {
        const ref = db.collection(path);
        if (path !== 'embeddings') return ref;
        const vectorQuery = {
          where: () => vectorQuery,
          findNearest: () => ({ get: async () => ({ docs: holder.vectorDocs.map(doc => ({
            id: doc.id, data: () => doc.data, get: (key: string) => doc.data[key],
          })) }) }),
        };
        return { ...ref, where: () => vectorQuery };
      },
    };
  },
  get FieldValue() {
    return { ...holder.fs!.FieldValue, vector: (value: number[]) => value };
  },
  storage: {
    bucket: (name?: string) => ({
      name: name ?? 'seconde-b47a6.firebasestorage.app',
      file: (path: string) => ({
        exists: async () => [false],
        download: async () => {
          holder.downloads.push(`${name}/${path}`);
          return [Buffer.from('x')];
        },
      }),
    }),
  },
}));
vi.mock('@google-cloud/aiplatform', () => ({
  PredictionServiceClient: class {
    predict = async () => {
      holder.predicts += 1;
      if (holder.predictError) throw holder.predictError;
      holder.onPredict?.();
      return [{ predictions: [{ structValue: { fields: { imageEmbedding: {
        listValue: { values: Array.from({ length: 1408 }, () => ({ numberValue: 0.01 })) },
      } } } }] }];
    };
  },
  helpers: { toValue: (v: unknown) => v, fromValue: (v: unknown) => v },
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (opts: Record<string, unknown>, handler: unknown) => { holder.createOptions = opts; return handler; },
  onDocumentUpdated: (opts: Record<string, unknown>, handler: unknown) => { holder.updateOptions = opts; return handler; },
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: unknown) => handler,
  HttpsError: class extends Error {},
}));
vi.mock('../utils/rateLimit', () => ({
  resolveCallerKey: () => ({ callerKey: 'guest', isAuthenticated: false }),
  checkRateLimit: async () => {},
}));
vi.mock('../utils/privateAccountSession', () => ({
  withPrivateAccountSession: async (_request: unknown, work: () => Promise<unknown>) => work(),
  assertPrivateAccountSession: async () => ({ currentAdminClaim: false }),
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));

import { generateAndStoreEmbedding, generateEmbeddingOnCreate, generateEmbeddingOnUpdate } from './embeddings';
import { visualSearch, getSimilarProducts } from '../callable/search';

const runUpdate = generateEmbeddingOnUpdate as unknown as (event: unknown) => Promise<void>;
const runCreate = generateEmbeddingOnCreate as unknown as (event: unknown) => Promise<void>;
const runVisual = visualSearch as unknown as (request: unknown) => Promise<{ results: Array<{ articleId: string }> }>;
const runSimilar = getSimilarProducts as unknown as (request: unknown) => Promise<{ results: Array<{ articleId: string }>; fallback?: boolean }>;
const IMAGE =
  'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/drafts%2Fu1%2Fa.jpg?alt=media&token=t';

beforeEach(() => {
  fs.reset();
  holder.downloads.length = 0;
  holder.predicts = 0;
  holder.predictError = null;
  holder.onPredict = null;
  holder.vectorDocs = [];
  vi.stubEnv('GOOGLE_CLOUD_PROJECT', 'seconde-b47a6');
  vi.stubEnv('GCLOUD_PROJECT', 'seconde-b47a6');
  vi.stubEnv('GCP_PROJECT', 'seconde-b47a6');
  vi.stubEnv('SECONDE_PROJECT_ID', 'seconde-b47a6');
  vi.stubEnv('SECONDE_ENV', 'production');
});
afterEach(() => vi.unstubAllEnvs());

function indexedArticle(extra: Record<string, unknown> = {}) {
  return { sellerId: 'u1', isActive: true, isSold: false, images: [{ url: IMAGE }], price: 20, ...extra };
}
function seedEmbedding(id = 'a1') {
  fs.setDoc(`embeddings/${id}`, { articleId: id, isActive: true, imageUrl: IMAGE, embedding: [0.1] });
}

describe('embeddings — image hors du projet (EM01)', () => {
  it('ne fait aucune requête sortante vers une URL choisie par le vendeur', async () => {
    const fetchSpy = vi.fn(async () => new Response('x'));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await generateAndStoreEmbedding('a1', {
        images: [{ url: 'https://attacker.example.com/huge.bin' }],
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ne lit pas, avec les droits admin, un bucket nommé par le vendeur', async () => {
    const foreign =
      'https://firebasestorage.googleapis.com/v0/b/someone-else.appspot.com/o/x.jpg?alt=media';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x')));
    try {
      await generateAndStoreEmbedding('a1', { images: [{ url: foreign }] });
      expect(holder.downloads.some((d) => d.startsWith('someone-else'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('embeddings — article vendu (EM03)', () => {
  it('désactive l’embedding d’un article vendu', async () => {
    seedEmbedding();
    const article = { isActive: true, isSold: false, images: [{ url: IMAGE }], price: 20 };
    fs.setDoc('articles/a1', { ...article, isSold: true });
    await runUpdate({
      params: { articleId: 'a1' },
      data: {
        before: { data: () => article },
        after: { data: () => ({ ...article, isSold: true }) },
      },
    });
    expect(fs.getDoc('embeddings/a1')).toBeUndefined();
  });

  it('le réactive quand il est remis en vente', async () => {
    seedEmbedding();
    const article = { isActive: true, isSold: true, images: [{ url: IMAGE }], price: 20 };
    fs.setDoc('articles/a1', { ...article, isSold: false });
    await runUpdate({
      params: { articleId: 'a1' },
      data: {
        before: { data: () => article },
        after: { data: () => ({ ...article, isSold: false }) },
      },
    });
    expect(fs.getDoc('embeddings/a1')!.isActive).toBe(true);
  });
});

/**
 * US02 : changer sa photo de profil réécrit tous les articles du vendeur ; ce
 * trigger faisait alors une lecture + une écriture d'embedding par article,
 * alors qu'aucun champ projeté dans `embeddings/` n'avait bougé.
 * EM02 : quand le document d'embedding manque, la moindre écriture sur
 * l'article — une vue, un compteur — rejouait un appel Vertex AI.
 */
describe('embeddings — écritures et appels inutiles (US02, EM02)', () => {
  const article = {
    isActive: true,
    isSold: false,
    images: [{ url: IMAGE }],
    price: 20,
    brand: 'Zara',
    categoryIds: ['women'],
  };

  function update(after: Record<string, unknown>) {
    fs.setDoc('articles/a1', { ...article, ...after });
    return runUpdate({
      params: { articleId: 'a1' },
      data: {
        before: { data: () => article },
        after: { data: () => ({ ...article, ...after }) },
      },
    });
  }

  it('un changement de photo de profil du vendeur ne touche pas l’embedding', async () => {
    seedEmbedding();
    await update({ sellerImage: 'https://x/p.jpg' });
    expect(fs.countWrites((op) => op.path === 'embeddings/a1')).toBe(0);
  });

  it('un changement de tranche de prix met bien à jour les métadonnées', async () => {
    seedEmbedding();
    await update({ price: 200 });
    expect(fs.getDoc('embeddings/a1')!.priceRange).toBe('high');
  });

  it('répare un index absent lors d’un changement de métadonnées pertinent', async () => {
    await update({ price: 200 });
    expect(holder.predicts).toBe(1);
    expect(fs.getDoc('embeddings/a1')!.priceRange).toBe('high');
    await update({ price: 200 });
    expect(holder.predicts).toBe(1);
  });

  it('une vue ne relance pas Vertex quand l’index manque', async () => {
    await update({ views: 30 });
    expect(holder.predicts).toBe(0);
  });

  it('régénère toujours quand la photo de l’article change', async () => {
    const other = IMAGE.replace('a.jpg', 'b.jpg');
    await update({ images: [{ url: other }] });
    expect(holder.predicts).toBe(1);
  });
});

describe('embeddings — reprise et événements retardés', () => {
  function creation(article = indexedArticle(), time = new Date().toISOString()) {
    return { params: { articleId: 'a1' }, time, data: { data: () => article } };
  }

  it('réessaie une panne transitoire puis réutilise le vecteur en cas de replay', async () => {
    const article = indexedArticle();
    fs.setDoc('articles/a1', article);
    holder.predictError = Object.assign(new Error('temporarily unavailable'), { code: 14 });
    expect(holder.createOptions.retry).toBe(true);
    expect(holder.updateOptions.retry).toBe(true);
    await expect(runCreate(creation(article))).rejects.toMatchObject({ code: 14 });
    expect(fs.getDoc('embeddings/a1')).toBeUndefined();
    holder.predictError = null;
    await runCreate(creation(article));
    expect(fs.getDoc('embeddings/a1')!.isActive).toBe(true);
    await runCreate(creation(article));
    expect(holder.predicts).toBe(2);
  });

  it('ne boucle pas sur une erreur permanente ou un événement de plus de 15 minutes', async () => {
    const article = indexedArticle();
    fs.setDoc('articles/a1', article);
    holder.predictError = Object.assign(new Error('permission denied'), { code: 7 });
    await expect(runCreate(creation(article))).resolves.toBeUndefined();
    expect(holder.predicts).toBe(1);
    holder.predictError = null;
    await runCreate(creation(article, new Date(Date.now() - 16 * 60 * 1000).toISOString()));
    expect(holder.predicts).toBe(1);
  });

  it.each([{ moderationStatus: 'pending' }, { moderationStatus: 'rejected' }, { privacyWithdrawal: null }])(
    'ne traite pas une annonce non publique %j', async extra => {
      const article = indexedArticle(extra);
      fs.setDoc('articles/a1', article);
      seedEmbedding();
      await runCreate(creation(article));
      await runUpdate({ params: { articleId: 'a1' }, data: {
        before: { data: () => indexedArticle() }, after: { data: () => article },
      } });
      expect(holder.predicts).toBe(0);
      expect(fs.getDoc('embeddings/a1')).toBeUndefined();
    },
  );

  it('un ancien événement ne remplace pas l’index d’une nouvelle photo', async () => {
    const current = indexedArticle({ images: [{ url: IMAGE.replace('a.jpg', 'new.jpg') }] });
    fs.setDoc('articles/a1', current);
    fs.setDoc('embeddings/a1', { isActive: true, imageUrl: current.images[0].url, embedding: [0.2] });
    await runCreate(creation());
    await runUpdate({ params: { articleId: 'a1' }, data: {
      before: { data: () => indexedArticle({ price: 200 }) }, after: { data: () => indexedArticle() },
    } });
    expect(holder.predicts).toBe(0);
    expect(fs.getDoc('embeddings/a1')!.imageUrl).toBe(current.images[0].url);
    expect(fs.countWrites(() => true)).toBe(0);
  });

  it('une photo retirée pendant l’analyse ne revient jamais dans l’index', async () => {
    const article = indexedArticle();
    fs.setDoc('articles/a1', article);
    holder.onPredict = () => fs.setDoc('articles/a1', { ...article, privacyWithdrawal: { reason: 'withdrawn' } });
    await runCreate(creation(article));
    expect(holder.predicts).toBe(1);
    expect(fs.getDoc('embeddings/a1')).toBeUndefined();
  });
});

describe('recherche visuelle — visibilité courante pour les visiteurs', () => {
  function candidate(id: string, extra: Record<string, unknown> = {}) {
    fs.setDoc(`articles/${id}`, indexedArticle({ __name__: id, title: id, condition: 'good', ...extra }));
    holder.vectorDocs.push({ id, data: { imageUrl: IMAGE, vector_distance: 0.1 } });
  }

  it('exclut les annonces vendues, cachées, retirées ou bloquées malgré un ancien index actif', async () => {
    candidate('public');
    candidate('sold', { isSold: true });
    candidate('inactive', { isActive: false });
    candidate('pending', { moderationStatus: 'pending' });
    candidate('rejected', { moderationStatus: 'rejected' });
    candidate('private', { privacyWithdrawal: null });
    candidate('changedPhoto', { images: [{ url: IMAGE.replace('a.jpg', 'new.jpg') }] });
    holder.vectorDocs.push({ id: 'deleted', data: { imageUrl: IMAGE, vector_distance: 0.1 } });
    fs.setDoc('articles/source', indexedArticle());
    seedEmbedding('source');
    const visual = await runVisual({ data: { imageBase64: 'safe-fixture', limit: 20 } });
    const similar = await runSimilar({ data: { articleId: 'source', limit: 20 } });
    expect(visual.results.map(item => item.articleId)).toEqual(['public']);
    expect(similar.results.map(item => item.articleId)).toEqual(['public']);
  });

  it.each([{ moderationStatus: 'pending' }, { privacyWithdrawal: null }, { isSold: true }])(
    'ne lance pas de recherche depuis un article non public %j', async extra => {
      fs.setDoc('articles/source', indexedArticle(extra));
      seedEmbedding('source');
      candidate('public');
      await expect(runSimilar({ data: { articleId: 'source' } })).resolves.toMatchObject({ results: [], fallback: true });
    },
  );
});
