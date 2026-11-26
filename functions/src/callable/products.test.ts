/**
 * `createArticle` / `updateArticle` — la validation serveur de la publication.
 *
 * C'est l'autorité qui publie : l'app n'écrit plus un article qu'à travers
 * elle. Chaque bloc correspond à une trouvaille de la chasse « mise en
 * vente », confirmée par ses sceptiques.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { FieldValue as NativeFieldValue, Timestamp } from 'firebase-admin/firestore';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = await vi.hoisted(async () => ({
  recovery: (await import('../utils/testHelpers/recoveryStorageFixture')).createRecoveryStorageFixture('seconde-b47a6'),
  nextRequest: 0,
  fs: null as MockFirestore | null,
  deleted: [] as string[],
  brandMatch: null as Record<string, unknown> | null,
}));
vi.mock('@google-cloud/storage', () => ({ Storage: holder.recovery.Storage }));
const fs: MockFirestore = holder.fs!;

vi.mock('../utils/articleMedia', async original => ({ ...await original<typeof import('../utils/articleMedia')>(), promoteArticleImages: async (images: unknown) => images }));

vi.mock('../config/firebase', async () => {
  const { createFirestoreMock } = await import('../utils/testHelpers/firestoreMock');
  // Real dependencies capture collection references during their import. All
  // of them must see this same store before the test module body runs.
  holder.fs = createFirestoreMock({ enforceReadBeforeWrite: true });
  const native = holder.fs.db.runTransaction.bind(holder.fs.db);
  const persisted = (v: any): any => v instanceof NativeFieldValue && v.isEqual(NativeFieldValue.delete()) ? holder.fs!.FieldValue.delete() :
    Array.isArray(v) ? v.map(persisted) : v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype ?
      Object.fromEntries(Object.entries(v).map(([key, value]) => [key, persisted(value)])) : v;
  holder.fs.db.runTransaction = (fn: any) => native(async (tx: any) => {
    for (const method of ['create', 'set', 'update']) { const write = tx[method].bind(tx); tx[method] = (ref: any, value: any, ...rest: any[]) => write(ref, persisted(value), ...rest); }
    const get = tx.get.bind(tx);
    tx.get = async (ref: any) => { const snap = await get(ref); const timed = (row: any) => ({ ...row, updateTime: Timestamp.fromMillis(10000 + holder.fs!.writeOps.findLastIndex(v => v.path === row.ref.path)) }); return snap.docs ? { ...snap, docs: snap.docs.map(timed) } : snap.exists ? timed(snap) : snap; };
    return fn(tx);
  });
  return {
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return { ...holder.fs!.FieldValue, serverTimestamp: () => Timestamp.now(), delete: () => NativeFieldValue.delete() };
  },
  auth: { getUser: async (uid: string) => ({ uid, disabled: false, tokensValidAfterTime: new Date(0).toISOString() }) },
  storage: {
    bucket: () => ({
      file: (path: string) => ({
        delete: async () => {
          holder.deleted.push(path);
        },
      }),
    }),
  },
  };
});
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));
vi.mock('firebase-functions/v2/https', () => {
  class _HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { onCall: (_opts: unknown, handler: unknown) => handler, HttpsError: _HttpsError };
});
vi.mock('../services/brands', () => ({
  matchBrand: async () =>
    holder.brandMatch ?? {
      brandName: null,
      matchType: 'none',
      confidence: 0,
      needsConfirmation: false,
    },
  BRAND_MATCHING: { strongThreshold: 0.75, autoSelectThreshold: 0.9 },
}));

import { createArticle, incrementProductView, updateArticle } from './products';
import { installFinancialSubjectTransactions } from '../utils/financialSubjectTransaction';
installFinancialSubjectTransactions(fs.db as any);
import { SELLER_ACTIVITY_STATEMENTS, SELLER_ACTIVITY_STATEMENT_VERSION } from '../shared/eligibility';

type Req = { auth?: { uid: string; token: Record<string, unknown> } | null; data?: unknown };
const callCreate = createArticle as unknown as (r: Req) => Promise<{ articleId: string }>;
const callUpdate = updateArticle as unknown as (r: Req) => Promise<{ success: boolean }>;

const UID = 'u1';
const AUTH = () => ({ uid: UID, token: { email_verified: true, auth_time: Math.floor(Date.now() / 1000) } });
const IMAGE =
  'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/drafts%2Fu1%2Fd%2Fa.jpg?alt=media&token=t';
const APPSPOT_IMAGE =
  'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.appspot.com/o/drafts%2Fu1%2Fd%2Fa.jpg?alt=media&token=t';
const FOREIGN_IMAGE = 'https://tracker.example.com/pixel.gif';
const T0 = new Date('2026-08-01T12:00:00Z');

function hood(i: number) {
  return { id: `q${i}`, name: `Quartier ${i}`, borough: 'Le Plateau-Mont-Royal' };
}

function createData(over: Record<string, unknown> = {}) {
  return {
    clientRequestId: `publication_${++holder.nextRequest}`,
    quantity: 1,
    size: { value: 'M', system: 'EU' },
    title: 'Robe fleurie Zara',
    description: 'Portée deux fois',
    price: 25,
    images: [{ url: IMAGE }],
    category: 'Robes',
    categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters', 'women_clothing_sweaters_hoodies'],
    condition: 'très bon état',
    isHandDelivery: true,
    isShipping: false,
    neighborhoods: [hood(1)],
    ...over,
  };
}

async function publish(over: Record<string, unknown> = {}) {
  const { articleId } = await callCreate({ auth: AUTH(), data: createData(over) });
  return fs.getDoc(`articles/${articleId}`)!;
}

function seedArticle(over: Record<string, unknown> = {}) {
  fs.setDoc('articles/a1', {
    sellerId: UID,
    title: 'Robe fleurie Zara',
    quantity: 1, description: 'Portée deux fois', condition: 'très bon état', size: { value: 'M', system: 'EU' },
    price: 100,
    isActive: true,
    isSold: false,
    brand: 'Zara',
    images: [{ url: IMAGE }],
    categoryIds: ['women', 'women_clothing', 'women_clothing_sweaters', 'women_clothing_sweaters_hoodies'],
    isHandDelivery: true,
    ...over,
  });
}

function update(updates: Record<string, unknown>) {
  return callUpdate({ auth: AUTH(), data: { articleId: 'a1', updates } });
}

beforeEach(() => {
  fs.reset();
  holder.recovery.reset();
  for (const [key, value] of Object.entries(holder.recovery.environment)) vi.stubEnv(key, value);
  holder.nextRequest = 0;
  holder.deleted.length = 0;
  holder.brandMatch = null;
  fs.setDoc(`users/${UID}`, { displayName: 'Alice', dateOfBirth: '1990-04-12' });
  fs.setDoc(`eligibility_profiles/${UID}`, { version: 1, activityDeclaration: { kind: 'personal', actorUid: UID,
    recordedAt: new Date(), declarationVersion: 1, statement: SELLER_ACTIVITY_STATEMENTS.personal, statementVersion: SELLER_ACTIVITY_STATEMENT_VERSION } });
});
afterEach(() => vi.unstubAllEnvs());

describe('createArticle — images (P08)', () => {
  it('publie une image du bucket du projet', async () => {
    const article = await publish();
    expect(article.images).toEqual([{ url: IMAGE }]);
  });

  it('accepte l’ancien nom du bucket (appspot), que portent les URL anciennes', async () => {
    const article = await publish({ images: [{ url: APPSPOT_IMAGE }] });
    expect(article.images).toEqual([{ url: APPSPOT_IMAGE }]);
  });

  it('refuse une image hébergée ailleurs (pixel espion, image d’autrui, requête sortante)', async () => {
    await expect(publish({ images: [{ url: FOREIGN_IMAGE }] })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

describe('createArticle — catégories (P13, P20)', () => {
  it('refuse des identifiants de catégorie qui ne sont pas des chaînes', async () => {
    await expect(publish({ categoryIds: ['women', 42] })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('refuse un article rangé dans des dizaines de catégories à la fois', async () => {
    const categoryIds = Array.from({ length: 40 }, (_, i) => `c${i}`);
    await expect(publish({ categoryIds })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('nettoie et borne le libellé de catégorie, qui alimente les mots-clés de recherche', async () => {
    const article = await publish({ category: `<b>Robes</b>${'x'.repeat(300)}` });
    expect(article.category).not.toContain('<b>');
    expect((article.category as string).length).toBeLessThanOrEqual(100);
  });
});

describe('createArticle — nettoyage du texte (P07, P11)', () => {
  it('refuse un titre qui ne contient que des balises (il aurait été publié vide)', async () => {
    await expect(publish({ title: '<b><i></i></b>' })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('garde le texte français légitime écrit entre « < » et « > »', async () => {
    const description = 'Tour de taille <70 cm, longueur >90 cm';
    const article = await publish({ description });
    expect(article.description).toBe(description);
  });

  it('retire toujours les vraies balises', async () => {
    const article = await publish({ description: 'Belle <script>alert(1)</script> robe' });
    expect(article.description).toBe('Belle alert(1) robe');
  });
});

describe('createArticle — remise en main propre (P16, P09)', () => {
  it('refuse plus de dix quartiers au lieu de jeter le surplus en silence', async () => {
    const neighborhoods = Array.from({ length: 11 }, (_, i) => hood(i));
    await expect(publish({ neighborhoods })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('accepte dix quartiers', async () => {
    const neighborhoods = Array.from({ length: 10 }, (_, i) => hood(i));
    const article = await publish({ neighborhoods });
    expect(article.neighborhoods).toHaveLength(10);
  });

  it('refuse une remise en main propre sans aucun quartier', async () => {
    await expect(publish({ neighborhoods: [] })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});

describe('updateArticle — marque (P21)', () => {
  it('efface la marque quand l’écran d’édition envoie null', async () => {
    seedArticle();
    await update({ brand: null });
    expect(fs.getDoc('articles/a1')!.brand).toBeUndefined();
  });

  it('efface la marque quand le champ est vidé', async () => {
    seedArticle();
    await update({ brand: '   ' });
    expect(fs.getDoc('articles/a1')!.brand).toBeUndefined();
  });
});

describe('updateArticle — suppression d’un article vendu ou déjà supprimé (P23, P24)', () => {
  it('laisse supprimer (désactiver) un article vendu', async () => {
    seedArticle({ isSold: true });
    await update({ isActive: false });
    expect(fs.getDoc('articles/a1')!.isActive).toBe(false);
  });

  it('refuse toute autre modification d’un article vendu, même glissée avec une désactivation', async () => {
    seedArticle({ isSold: true });
    await expect(update({ isActive: false, price: 10 })).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });

  it('une seconde suppression d’un article déjà désactivé réussit au lieu d’afficher une erreur', async () => {
    seedArticle({ isActive: false });
    await expect(update({ isActive: false })).resolves.toMatchObject({ success: true });
  });

  it('refuse toujours de modifier le contenu d’un article désactivé', async () => {
    seedArticle({ isActive: false });
    await expect(update({ price: 10 })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('updateArticle — images (P08)', () => {
  it('refuse une nouvelle image hébergée ailleurs', async () => {
    seedArticle();
    await expect(
      update({ images: [{ url: IMAGE }, { url: FOREIGN_IMAGE }] }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('garde une image que l’article porte déjà, même hors bucket (articles anciens)', async () => {
    seedArticle({ images: [{ url: FOREIGN_IMAGE }] });
    await update({ images: [{ url: FOREIGN_IMAGE }, { url: IMAGE }] });
    expect(fs.getDoc('articles/a1')!.images).toEqual([{ url: FOREIGN_IMAGE }, { url: IMAGE }]);
  });
});

describe('updateArticle — baisse de prix (P26, P28, P27)', () => {
  it('enregistre une vraie baisse', async () => {
    seedArticle({ price: 100 });
    await update({ price: 80 });
    const a = fs.getDoc('articles/a1')!;
    expect(a.originalPrice).toBe(100);
    expect(a.priceDropPercent).toBe(20);
    expect(a.lastPriceDropAt).toBeDefined();
  });

  it('une hausse, même sous le prix d’origine, efface la baisse affichée', async () => {
    seedArticle({ price: 90, originalPrice: 120, priceDropPercent: 25, lastPriceDropAt: T0 });
    await update({ price: 110 });
    const a = fs.getDoc('articles/a1')!;
    expect(a.originalPrice).toBeUndefined();
    expect(a.priceDropPercent).toBeUndefined();
    expect(a.lastPriceDropAt).toBeUndefined();
  });

  it('une baisse d’un centime ne remet pas l’article en tête du rail « Baisses de prix »', async () => {
    seedArticle({ price: 100, originalPrice: 120, priceDropPercent: 17, lastPriceDropAt: T0 });
    await update({ price: 99.99 });
    expect(fs.getDoc('articles/a1')!.lastPriceDropAt).toEqual(T0);
  });

  it('un essai de transaction rejoué ne reprend pas la baisse calculée au premier essai', async () => {
    seedArticle({ price: 100 });
    const db = fs.db as unknown as {
      runTransaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
    };
    const real = db.runTransaction.bind(db);
    let conflictInjected = false;
    const aborted = new Error('SYNTHETIC_PRICE_CONFLICT');
    db.runTransaction = async (fn) => {
      try {
        return await real(async (tx: any) => {
          let updatesPrice = false;
          const observed = new Proxy(tx, { get(target, key) {
            if (key === 'update') return (ref: any, value: any, ...rest: any[]) => {
              updatesPrice ||= ref.path === 'articles/a1' && value.price === 80;
              return target.update(ref, value, ...rest);
            };
            return Reflect.get(target, key);
          } });
          const result = await fn(observed);
          if (updatesPrice && !conflictInjected) {
            conflictInjected = true;
            throw aborted;
          }
          return result;
        });
      } catch (error) {
        if (error !== aborted) throw error;
        // Only the abandoned price-writing attempt races; admission and final
        // receipt reads must not overwrite the successfully committed price.
        seedArticle({ price: 82 });
        return real(fn);
      }
    };
    try {
      await update({ price: 80 });
    } finally {
      db.runTransaction = real;
    }
    // 82 $ → 80 $ n'est pas une baisse qui compte : rien ne doit rester de
    // la baisse 100 $ → 80 $ calculée par l'essai abandonné.
    const a = fs.getDoc('articles/a1')!;
    expect(conflictInjected).toBe(true);
    expect(a.price).toBe(80);
    expect(a.originalPrice).toBeUndefined();
    expect(a.lastPriceDropAt).toBeUndefined();
  });
});

describe('createArticle — vente réservée aux 18 ans et plus (M09)', () => {
  // L'app ne bloquait qu'au tap sur l'onglet Vendre ; « Mes articles », un
  // lien profond ou la reprise d'un brouillon passaient, et le serveur ne
  // revérifiait rien. Le partenaire de paiement exige 18 ans.
  it('refuse la publication d’un compte de 16 ou 17 ans', async () => {
    const seventeen = new Date();
    seventeen.setFullYear(seventeen.getFullYear() - 17);
    fs.setDoc(`users/${UID}`, {
      displayName: 'Alice',
      dateOfBirth: seventeen.toISOString().slice(0, 10),
    });
    await expect(publish()).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('refuse un compte sans date de naissance', async () => {
    fs.setDoc(`users/${UID}`, { displayName: 'Alice' });
    await expect(publish()).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('publie pour un compte de 18 ans révolus', async () => {
    await expect(publish()).resolves.toBeDefined();
  });
});

describe('createArticle — publication rejouée (V09, P17)', () => {
  // Le serveur écrit, la réponse se perd : le client affiche une erreur, le
  // vendeur retape « Publier », et le même article paraît deux fois.
  it('une même demande de publication, rejouée, ne crée qu’un article', async () => {
    const data = createData({ clientRequestId: 'draft_1757000000000_abc' });
    const first = await callCreate({ auth: AUTH(), data });
    const second = await callCreate({ auth: AUTH(), data });

    expect(second.articleId).toBe(first.articleId);
    const all = await fs.db.collection('articles').get();
    expect(all.size).toBe(1);
  });

  it('deux brouillons différents donnent deux articles', async () => {
    await callCreate({ auth: AUTH(), data: createData({ clientRequestId: 'draft_a' }) });
    await callCreate({ auth: AUTH(), data: createData({ clientRequestId: 'draft_b' }) });
    const all = await fs.db.collection('articles').get();
    expect(all.size).toBe(2);
  });
});

describe('updateArticle — photos retirées (E08)', () => {
  const OWN_ARTICLE_IMAGE =
    'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/articles%2Fa1%2Fimage_1.jpg?alt=media&token=t';
  const OTHER_USER_IMAGE =
    'https://firebasestorage.googleapis.com/v0/b/seconde-b47a6.firebasestorage.app/o/drafts%2Fsomeone%2Fd%2Fx.jpg?alt=media&token=t';

  it('retire la photo de l’annonce et conserve son original Storage', async () => {
    seedArticle({ images: [{ url: IMAGE }, { url: OWN_ARTICLE_IMAGE }] });
    expect(await update({ images: [{ url: IMAGE }] })).toMatchObject({ success: true });
    expect(fs.getDoc('articles/a1')!.images).toEqual([{ url: IMAGE }]);
    expect(holder.deleted).toEqual([]);
  });

  it('retire aussi le lien d’une photo de brouillon sans supprimer le fichier', async () => {
    seedArticle({ images: [{ url: IMAGE }, { url: OWN_ARTICLE_IMAGE }] });
    expect(await update({ images: [{ url: OWN_ARTICLE_IMAGE }] })).toMatchObject({ success: true });
    expect(fs.getDoc('articles/a1')!.images).toEqual([{ url: OWN_ARTICLE_IMAGE }]);
    expect(holder.deleted).toEqual([]);
  });

  it('n’efface jamais un fichier hors des dossiers du vendeur et de l’article', async () => {
    seedArticle({ images: [{ url: IMAGE }, { url: OTHER_USER_IMAGE }] });
    await update({ images: [{ url: IMAGE }] });
    expect(holder.deleted).toEqual([]);
  });

  it('n’efface rien si la modification est refusée', async () => {
    seedArticle({ isSold: true, images: [{ url: IMAGE }, { url: OWN_ARTICLE_IMAGE }] });
    await expect(update({ images: [{ url: IMAGE }] })).rejects.toBeDefined();
    expect(holder.deleted).toEqual([]);
  });
});

describe('incrementProductView — un compteur qu’on ne gonfle pas à volonté (P01)', () => {
  // Le compteur de vues est la seule entrée du score de popularité, seul ordre
  // serveur de la recherche par mot-clé. N'importe quel compte connecté
  // pouvait l'incrémenter en boucle.
  const view = (uid: string) =>
    (incrementProductView as unknown as (r: Req) => Promise<unknown>)({
      auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000) } },
      data: { productId: 'a1' },
    });

  it('compte une vue par personne et par jour', async () => {
    seedArticle({ views: 0 });
    await view('buyer1');
    await view('buyer1');
    await view('buyer1');
    expect(fs.getDoc('articles/a1')!.views).toBe(1);
  });

  it('compte chaque personne', async () => {
    seedArticle({ views: 0 });
    await view('buyer1');
    await view('buyer2');
    expect(fs.getDoc('articles/a1')!.views).toBe(2);
  });

  it('ne compte pas le vendeur qui regarde sa propre fiche', async () => {
    seedArticle({ views: 0 });
    await view(UID);
    expect(fs.getDoc('articles/a1')!.views).toBe(0);
  });
});


describe('createArticle — marque approchante (P05)', () => {
  // Entre 0,75 et 0,90 le service de correspondance lève « à confirmer » : cette
  // bande contient autant de vraies corrections (Zarra → Zara) que de
  // substitutions absurdes (Lolita → Ippolita). Le serveur ne tranche plus à
  // la place du vendeur.
  it('n’impose pas une marque approchante que le service donne à confirmer', async () => {
    holder.brandMatch = {
      brandName: 'Ippolita',
      matchType: 'fuzzy',
      confidence: 0.8,
      needsConfirmation: true,
    };
    const doc = await publish({ brand: 'Lolita' });
    expect(doc.brand).toBe('Lolita');
  });

  it('garde la marque du catalogue quand la correspondance est certaine', async () => {
    holder.brandMatch = {
      brandName: 'Zara',
      matchType: 'fuzzy',
      confidence: 0.95,
      needsConfirmation: false,
    };
    const doc = await publish({ brand: 'zra' });
    expect(doc.brand).toBe('Zara');
  });

  it('garde la marque du catalogue sur une correspondance exacte', async () => {
    holder.brandMatch = {
      brandName: 'IPPOLITA',
      matchType: 'exact',
      confidence: 1,
      needsConfirmation: false,
    };
    const doc = await publish({ brand: 'ippolita' });
    expect(doc.brand).toBe('IPPOLITA');
  });
});

describe('« livraison seule » alors que le rail d’expédition est fermé (P10)', () => {
  // Le drapeau serveur est la seule vraie garde : le miroir client ne fait que
  // masquer l’interface. Un article « livraison seule » publié rail fermé est
  // acheté en remise en main propre, que le vendeur n’a jamais acceptée.
  const shipOnly = { isShipping: true, isHandDelivery: false, neighborhoods: [] };

  afterEach(() => {
    delete process.env.SHIPPING_ENABLED;
  });

  it('refuse la publication d’un article « livraison seule » quand la livraison est fermée', async () => {
    delete process.env.SHIPPING_ENABLED;
    await expect(callCreate({ auth: AUTH(), data: createData(shipOnly) })).rejects.toThrow(
      /temporairement indisponible/i,
    );
  });

  it('publie le même article quand la livraison est ouverte', async () => {
    process.env.SHIPPING_ENABLED = 'true';
    const doc = await publish(shipOnly);
    expect(doc.isShipping).toBe(true);
  });

  it('refuse de basculer un article existant en « livraison seule »', async () => {
    delete process.env.SHIPPING_ENABLED;
    seedArticle();
    await expect(update({ isHandDelivery: false, isShipping: true })).rejects.toThrow(
      /temporairement indisponible/i,
    );
  });

  it('laisse ajouter la livraison tant que la remise en main propre reste', async () => {
    delete process.env.SHIPPING_ENABLED;
    seedArticle();
    await update({ isShipping: true });
    expect(fs.getDoc('articles/a1')!.isShipping).toBe(true);
  });
});
