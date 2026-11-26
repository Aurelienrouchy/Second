/**
 * Règles des offres et des conversations : ce qui est écrit, pas seulement quels
 * champs le sont.
 *
 * Racine commune des défauts couverts ici : `hasOnly([...])` ne contraint que
 * les NOMS de clés de premier niveau. Aucune valeur n'était validée, aucun
 * auteur n'était vérifié au-delà de « je participe à la conversation », et le
 * blocage n'apparaissait nulle part dans les règles de mise à jour.
 *
 * Les transitions d’offre sont serveur uniquement. Les attaques sur les
 * sous-maps et messages système sont aussi couvertes dans messages.rules.test.ts.
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

const ALICE = 'alice';
const BOB = 'bob';
const CHAT = 'chat-offres';
const ARTICLE = 'art-1';

const meetupOffer = {
  chatId: CHAT,
  senderId: BOB,
  receiverId: ALICE,
  participants: [ALICE, BOB],
  type: 'offer',
  isRead: false,
  status: 'sent',
  offer: {
    amount: 40,
    status: 'pending',
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    meetup: { location: { name: 'Café Olympico' }, proposedBy: 'buyer' },
  },
};

const shippingOffer = {
  ...meetupOffer,
  offer: { amount: 40, status: 'pending' },
};

async function seed() {
  const env = await getTestEnv();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'chats', CHAT), {
      participants: [ALICE, BOB],
      participantsInfo: [{ userId: ALICE }, { userId: BOB }],
      unreadCount: { [ALICE]: 0, [BOB]: 0 },
      sellerId: ALICE,
      articleId: ARTICLE,
    });
    await setDoc(doc(db, 'articles', ARTICLE), {
      sellerId: ALICE,
      price: 60,
      isActive: true,
      isSold: false,
    });
    await setDoc(doc(db, 'users', ALICE), { displayName: 'Alice' });
    await setDoc(doc(db, 'users', BOB), { displayName: 'Bob' });
    await setDoc(doc(db, 'messages', 'm-meetup'), meetupOffer);
    await setDoc(doc(db, 'messages', 'm-shipping'), shippingOffer);
  });
}

/** Pose un blocage d'`ownerUid` sur `targetUid`. */
async function block(ownerUid: string, targetUid: string) {
  const env = await getTestEnv();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', ownerUid), {
      displayName: ownerUid,
      blockedUserIds: [targetUid],
    });
  });
}

describe('règles des offres', () => {
  beforeAll(async () => {
    await getTestEnv();
  });
  afterAll(async () => {
    await teardownTestEnv();
  });
  beforeEach(seed);

  // ── L'offre naît toujours « en attente »
  it('refuse une offre créée directement même en attente', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(setDoc(doc(db, 'messages', 'neuve'), meetupOffer));
  });

  it('une offre NE PEUT PAS naître « acceptée »', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      setDoc(doc(db, 'messages', 'forgee'), {
        ...meetupOffer,
        offer: { ...meetupOffer.offer, status: 'accepted' },
      }),
    );
  });

  it('une offre NE PEUT PAS naître avec une rencontre déjà finalisée', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      setDoc(doc(db, 'messages', 'forgee2'), {
        ...meetupOffer,
        offer: {
          ...meetupOffer.offer,
          meetup: { ...meetupOffer.offer.meetup, completedAt: new Date() },
        },
      }),
    );
  });

  // ── L'acceptation d'une rencontre passe par le serveur
  it('le destinataire NE PEUT PAS accepter lui-même une offre de rencontre', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    // `acceptMeetupOffer` (Admin SDK) est le seul chemin : lui seul crée la
    // transaction et verrouille l'article. Une acceptation cliente laisse la
    // bulle « Acceptée » sans transaction ni verrou — le vendeur perd tout.
    await assertFails(
      updateDoc(doc(db, 'messages', 'm-meetup'), { 'offer.status': 'accepted' }),
    );
  });

  it('refuse l’acceptation directe d’une offre de livraison héritée', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', 'm-shipping'), { 'offer.status': 'accepted' }),
    );
  });

  it('refuse le refus direct d’une offre de rencontre', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', 'm-meetup'), { 'offer.status': 'rejected' }),
    );
  });

  // ── L'expiration doit être opposable
  it('la date limite d’une offre est immuable', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', 'm-meetup'), {
        'offer.expiresAt': new Date('2030-01-01T00:00:00Z'),
      }),
    );
  });

  // ── L'accusé de lecture appartient au destinataire
  it('le destinataire marque le message comme lu', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'messages', 'm-meetup'), { isRead: true, status: 'read' }),
    );
  });

  it('l’expéditeur NE PEUT PAS marquer son propre message comme lu', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    // Sinon l'expéditeur fige le compteur de non-lus du destinataire : le
    // marquage client ne requête que les messages `isRead == false`.
    await assertFails(updateDoc(doc(db, 'messages', 'm-meetup'), { isRead: true }));
  });

  // ── Le blocage vaut aussi sur les transitions d'offre
  it('une personne bloquée NE PEUT PLUS agir sur une offre', async () => {
    await block(ALICE, BOB);
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    // BOB est l'ÉMETTEUR de `m-meetup` : la garde de rôle préexistante ne lui
    // interdit que `accepted` / `rejected`. `counter_price` — la bascule que
    // fait réellement une contre-offre — lui est ouverte aujourd'hui. C'est
    // donc le seul verbe qui rende ce test discriminant : le tester sur
    // `rejected` le ferait passer pour une raison sans rapport avec le blocage.
    await assertFails(
      updateDoc(doc(db, 'messages', 'm-meetup'), { 'offer.status': 'counter_price' }),
    );
  });

  it('refuse la consommation directe même sans blocage', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', 'm-meetup'), { 'offer.status': 'counter_price' }),
    );
  });

  it('refuse aussi la transition directe de la personne qui bloque', async () => {
    await block(ALICE, BOB);
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    // Le blocage est ici DIRECTIONNEL, à la différence de la création de
    // message : couper aussi la personne qui bloque lui retirerait sa seule
    // sortie et laisserait l'article verrouillé jusqu'au balayage automatique.
    await assertFails(
      updateDoc(doc(db, 'messages', 'm-meetup'), { 'offer.status': 'rejected' }),
    );
  });

  it('le marquage « lu » reste possible malgré un blocage', async () => {
    await block(ALICE, BOB);
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'messages', 'm-meetup'), { isRead: true, status: 'read' }),
    );
  });
});

describe('règles des conversations', () => {
  beforeAll(async () => {
    await getTestEnv();
  });
  afterAll(async () => {
    await teardownTestEnv();
  });
  beforeEach(seed);

  const validChat = {
    participants: [ALICE, BOB],
    participantsInfo: [{ userId: ALICE }, { userId: BOB }],
    unreadCount: { [ALICE]: 0, [BOB]: 0 },
  };

  it('une conversation valide se crée', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertSucceeds(setDoc(doc(db, 'chats', 'neuve'), validChat));
  });

  it('on NE PEUT PAS se déclarer vendeur d’un article dont on n’est pas propriétaire', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      setDoc(doc(db, 'chats', 'usurpee'), {
        ...validChat,
        articleId: ARTICLE,
        sellerId: BOB,
      }),
    );
  });

  it('le vrai vendeur de l’article est accepté', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'chats', 'legitime'), {
        ...validChat,
        articleId: ARTICLE,
        sellerId: ALICE,
      }),
    );
  });

  it('un vendeur étranger à la conversation est refusé', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      setDoc(doc(db, 'chats', 'tiers'), { ...validChat, sellerId: 'carole' }),
    );
  });

  it('on NE PEUT PAS pré-remplir le compteur de non-lus de l’autre', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      setDoc(doc(db, 'chats', 'gonflee'), {
        ...validChat,
        unreadCount: { [ALICE]: 99, [BOB]: 0 },
      }),
    );
  });

  it('un participant met à jour l’aperçu normalement', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'chats', CHAT), {
        lastMessage: 'Bonjour',
        lastMessageType: 'text',
      }),
    );
  });

  it('une personne bloquée NE PEUT PLUS écrire l’aperçu de la conversation', async () => {
    await block(ALICE, BOB);
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    // Les règles refusent le MESSAGE d'une personne bloquée, mais l'aperçu est
    // une écriture distincte sur le document `chats` : sans cette garde, elle
    // reste un canal de texte libre vers la liste de conversations de la
    // victime, pastille de non-lu comprise.
    await assertFails(
      updateDoc(doc(db, 'chats', CHAT), { lastMessage: 'coucou quand même' }),
    );
  });

  it('celle qui bloque peut toujours mettre à jour son propre fil', async () => {
    await block(ALICE, BOB);
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'chats', CHAT), { [`unreadCount.${ALICE}`]: 0 }),
    );
  });

  it('un aperçu de taille plausible passe, même long', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    // Les builds INSTALLÉS ne tronquent pas l'aperçu et les champs de
    // contre-offre n'y ont aucun plafond : une borne serrée leur ferait perdre
    // l'écriture — et avec elle le compteur de non-lus, qui voyage dans le même
    // `updateDoc`.
    await assertSucceeds(
      updateDoc(doc(db, 'chats', CHAT), { lastMessage: 'x'.repeat(1500) }),
    );
  });

  it('un aperçu démesuré reste refusé', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertFails(
      updateDoc(doc(db, 'chats', CHAT), { lastMessage: 'x'.repeat(2500) }),
    );
  });
});

describe('règles — identité et participants', () => {
  beforeAll(async () => {
    await getTestEnv();
  });
  afterAll(async () => {
    await teardownTestEnv();
  });
  beforeEach(seed);

  it('un message dont les participants sont ceux de la conversation passe', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'messages', 'ok'), {
        chatId: CHAT,
        senderId: BOB,
        receiverId: ALICE,
        participants: [ALICE, BOB],
        type: 'text',
        content: 'salut',
      }),
    );
  });

  it('on NE PEUT PAS rendre un message lisible par un tiers', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(BOB).firestore();
    // `participants` du message est le seul champ que lisent la règle de lecture
    // et la requête temps réel : y glisser un tiers lui ouvre la conversation.
    await assertFails(
      setDoc(doc(db, 'messages', 'fuite'), {
        chatId: CHAT,
        senderId: BOB,
        receiverId: ALICE,
        participants: [BOB, 'mallory'],
        type: 'text',
        content: 'salut',
      }),
    );
  });

  it('un nom d’affichage valide est accepté', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', ALICE), { displayName: 'Alice R.' }));
  });

  it('un nom VIDE est refusé', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    // Ce nom est propagé dans l'instantané de TOUTES les conversations : c'est
    // le seul nom que voit l'autre partie.
    await assertFails(updateDoc(doc(db, 'users', ALICE), { displayName: '' }));
  });

  it('un nom composé long passe — les connexions sociales en écrivent', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    // Les builds INSTALLÉS écrivent le nom du fournisseur Google/Apple sans le
    // tronquer. Une borne serrée ferait échouer leur connexion, en boucle.
    await assertSucceeds(
      updateDoc(doc(db, 'users', ALICE), { displayName: 'x'.repeat(80) }),
    );
  });

  it('un nom démesuré reste refusé', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(ALICE).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', ALICE), { displayName: 'x'.repeat(200) }),
    );
  });
});
