/**
 * Règles Firestore — verrous du parcours de rencontre (meetup).
 *
 * Deux trous fermés ici :
 *
 *  1. `articles` : les gardes d'immutabilité s'écrivaient
 *     `!('X' in newData) || newData.X == oldData.X`. Or `newData` est le
 *     document tel qu'il sera APRÈS l'écriture : un `deleteField()` rend
 *     `'X' in newData` faux et la garde passe. Un vendeur pouvait ainsi effacer
 *     `isSold` d'un article verrouillé par une rencontre en cours pour le
 *     revendre, ou effacer `moderationStatus` pour sortir de la modération.
 *
 *  2. `disputes` : la lecture exigeait le custom claim `admin`, qu'AUCUN code du
 *     dépôt ne pose (`setCustomUserClaims` n'existe nulle part). La console de
 *     modération — qui interroge la collection en direct — ne pouvait donc lire
 *     aucun signalement d'absence, seul recours du parcours d'achat actif.
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const SELLER = 'seller-meetup';
const BUYER = 'buyer-meetup';
const ADMIN = 'admin-meetup';
const OUTSIDER = 'outsider-meetup';
const ARTICLE_ID = 'article-meetup-1';
const DISPUTE_ID = 'dispute-meetup-1';

const soldArticle = {
  sellerId: SELLER,
  title: 'Blouson de cuir',
  price: 120,
  isActive: true,
  isSold: true,
  moderationStatus: 'approved',
  views: 12,
  likes: 3,
  favoritesCount: 3,
};

describe('règles articles — immutabilité résistante à la suppression de champ', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'articles', ARTICLE_ID), soldArticle);
    });
  });

  it('interdit au vendeur de SUPPRIMER isSold pour déverrouiller son article', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(SELLER).firestore();
    await assertFails(
      updateDoc(doc(db, 'articles', ARTICLE_ID), { isSold: deleteField() }),
    );
  });

  it('interdit au vendeur de SUPPRIMER moderationStatus', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(SELLER).firestore();
    await assertFails(
      updateDoc(doc(db, 'articles', ARTICLE_ID), { moderationStatus: deleteField() }),
    );
  });

  it('interdit toujours de MODIFIER isSold', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(SELLER).firestore();
    await assertFails(
      updateDoc(doc(db, 'articles', ARTICLE_ID), { isSold: false }),
    );
  });

  it('refuse une édition directe de description même sur un article en vente', async () => {
    // Les éditions ordinaires passent aussi par la callable qui vérifie
    // les réservations et promeut les photos avant la publication.
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'articles', ARTICLE_ID), { ...soldArticle, isSold: false });
    });
    const db = env.authenticatedContext(SELLER).firestore();
    await assertFails(
      updateDoc(doc(db, 'articles', ARTICLE_ID), { description: 'Taille M, très bon état' }),
    );
  });
});

describe('règles disputes — lisibles par un admin Firestore', () => {
  beforeAll(async () => {
    await getTestEnv();
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  beforeEach(async () => {
    const env = await getTestEnv();
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
      // Admin par le champ Firestore : le seul mécanisme réellement en place,
      // aucun custom claim n'étant jamais posé par le code.
      await setDoc(doc(ctx.firestore(), 'users', ADMIN), { id: ADMIN, isAdmin: true });
      await setDoc(doc(ctx.firestore(), 'users', OUTSIDER), { id: OUTSIDER, isAdmin: false });
      await setDoc(doc(ctx.firestore(), 'disputes', DISPUTE_ID), {
        transactionId: 'tx-1',
        type: 'meetup_no_show',
        buyerId: BUYER,
        sellerId: SELLER,
        reportedBy: BUYER,
        reportedAgainst: SELLER,
        status: 'open',
      });
    });
  });

  it('autorise un admin Firestore à lire un signalement d\'absence', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(getDoc(doc(db, 'disputes', DISPUTE_ID)));
  });

  it('autorise les deux parties à lire leur propre litige', async () => {
    const env = await getTestEnv();
    await assertSucceeds(
      getDoc(doc(env.authenticatedContext(BUYER).firestore(), 'disputes', DISPUTE_ID)),
    );
    await assertSucceeds(
      getDoc(doc(env.authenticatedContext(SELLER).firestore(), 'disputes', DISPUTE_ID)),
    );
  });

  it('refuse un tiers non partie et non admin', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDoc(doc(db, 'disputes', DISPUTE_ID)));
  });

  it('refuse toute écriture client sur un litige, même admin', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ADMIN).firestore();
    await assertFails(updateDoc(doc(db, 'disputes', DISPUTE_ID), { status: 'resolved' }));
  });
});
