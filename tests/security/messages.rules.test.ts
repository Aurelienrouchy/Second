import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

import { getTestEnv, teardownTestEnv } from './helpers';

// Offer terms and system events are written exclusively by Cloud Functions.

const SENDER = 'sender';
const RECEIVER = 'receiver';
const OUTSIDER = 'outsider';
const MSG_ID = 'msg-1';
const OFFER_MSG_ID = 'offer-msg-1';

const baseMessage = {
  chatId: 'chat-1',
  senderId: SENDER,
  receiverId: RECEIVER,
  participants: [SENDER, RECEIVER],
  type: 'text',
  text: 'hello',
  isRead: false,
  status: 'sent',
};

const offerMessage = {
  chatId: 'chat-1',
  senderId: SENDER,
  receiverId: RECEIVER,
  participants: [SENDER, RECEIVER],
  type: 'offer',
  isRead: false,
  status: 'sent',
  offer: { amount: 30, status: 'pending' },
};

describe('messages rules — read receipts (status field)', () => {
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
      await setDoc(doc(ctx.firestore(), 'messages', MSG_ID), baseMessage);
      await setDoc(doc(ctx.firestore(), 'messages', OFFER_MSG_ID), offerMessage);
    });
  });

  it('allows the receiver to mark a message as read (isRead + status read)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'messages', MSG_ID), { isRead: true, status: 'read' }),
    );
  });

  it('denies a non-participant marking the message as read', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(OUTSIDER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MSG_ID), { isRead: true, status: 'read' }),
    );
  });

  it('denies an invalid status value', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MSG_ID), { isRead: true, status: 'hacked' }),
    );
  });

  it('still allows flipping isRead alone (no status)', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'messages', MSG_ID), { isRead: true }),
    );
  });

  it('denies client acceptance; only the server may transition an offer', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', OFFER_MSG_ID), {
        offer: { amount: 30, status: 'accepted' },
      }),
    );
  });

  it('still denies tampering with the offer amount', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', OFFER_MSG_ID), {
        offer: { amount: 1, status: 'accepted' },
      }),
    );
  });

  it('denies forged client system events, including a blocked participant', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'chats', 'chat-1'), { participants: [SENDER, RECEIVER] });
      await setDoc(doc(ctx.firestore(), 'users', RECEIVER), { blockedUserIds: [SENDER] });
    });
    const db = env.authenticatedContext(SENDER).firestore();
    await assertFails(setDoc(doc(db, 'messages', 'forged-system'), { ...baseMessage, senderId: 'system', receiverId: 'system', type: 'system' }));
  });

  it('denies direct client offer creation', async () => {
    const env = await getTestEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'chats', 'chat-1'), { participants: [SENDER, RECEIVER] });
    });
    await assertFails(setDoc(doc(env.authenticatedContext(SENDER).firestore(), 'messages', 'forged-offer'), offerMessage));
  });
});

// ===========================================================================
// Rencontre (meetup) — la sous-map `offer.meetup` est immuable côté client.
//
// `diff().affectedKeys()` ne voit que les clés de premier niveau : tant que
// `offer.amount` était préservé, tout le contenu de `offer` restait
// réécrivable. Or c'est cette sous-map, et elle seule, qui pilote la bulle de
// chat — donc l'unique point d'entrée du parcours d'achat actif.
// ===========================================================================

const MEETUP_MSG_ID = 'offer-meetup-1';

const meetupOfferMessage = {
  chatId: 'chat-1',
  senderId: SENDER,
  receiverId: RECEIVER,
  participants: [SENDER, RECEIVER],
  type: 'offer',
  isRead: false,
  status: 'sent',
  offer: {
    amount: 30,
    status: 'accepted',
    meetup: {
      location: { name: 'Café Olimpico' },
      noShow: { reportedBy: RECEIVER, reason: 'other_party_no_show' },
    },
  },
};

describe('messages rules — immutabilité de offer.meetup', () => {
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
      await setDoc(doc(ctx.firestore(), 'messages', MEETUP_MSG_ID), meetupOfferMessage);
    });
  });

  // L'acteur est le RECEIVER : la garde de rôle préexistante (« seul le
  // destinataire peut accepter/refuser ») le laisse déjà écrire dans `offer`
  // tant que le statut reste `accepted`. C'est donc bien la nouvelle règle
  // d'immutabilité qui doit refuser, et elle seule.
  it("interdit d'effacer le marqueur de no-show pour rallumer les boutons", async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MEETUP_MSG_ID), {
        'offer.meetup.noShow': null,
      }),
    );
  });

  it("interdit de forger un completedAt pour supprimer le recours de l'autre", async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MEETUP_MSG_ID), {
        'offer.meetup.completedAt': new Date(),
      }),
    );
  });

  it('interdit de déplacer le lieu de rendez-vous après acceptation', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MEETUP_MSG_ID), {
        'offer.meetup.location': { name: 'Ruelle sombre' },
      }),
    );
  });

  it('interdit de supprimer toute la sous-map meetup en remplaçant offer', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MEETUP_MSG_ID), {
        offer: { amount: 30, status: 'accepted' },
      }),
    );
  });

  // The same restrictions apply to requests from older clients.
  it("refuse aussi le completedAt envoyé par un ancien build", async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MEETUP_MSG_ID), {
        'offer.meetup.completedAt': new Date(),
      }),
    );
  });

  it('laisse passer une lecture marquée (isRead) sur le même message', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'messages', MEETUP_MSG_ID), { isRead: true }),
    );
  });
});

describe('messages rules — un statut accepté ne redevient pas « refusé »', () => {
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
      await setDoc(doc(ctx.firestore(), 'messages', MEETUP_MSG_ID), meetupOfferMessage);
      await setDoc(doc(ctx.firestore(), 'messages', OFFER_MSG_ID), offerMessage);
    });
  });

  it("interdit de refuser une offre déjà acceptée (éteindrait une rencontre vivante)", async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', MEETUP_MSG_ID), { 'offer.status': 'rejected' }),
    );
  });

  it('refuse une acceptation directe même sur une offre en attente', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(RECEIVER).firestore();
    await assertFails(
      updateDoc(doc(db, 'messages', OFFER_MSG_ID), { 'offer.status': 'accepted' }),
    );
  });
});

describe('messages rules — un participant ne forge plus de message « système »', () => {
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
      await setDoc(doc(ctx.firestore(), 'chats', 'chat-1'), {
        participants: [SENDER, RECEIVER],
        articleId: 'article-1',
      });
    });
  });

  it("refuse un message senderId:'system' au contenu forgé", async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(SENDER).firestore();
    await assertFails(
      setDoc(doc(db, 'messages', 'forged-1'), {
        chatId: 'chat-1',
        senderId: 'system',
        receiverId: 'system',
        type: 'system',
        content:
          'Rencontre confirmée ! La transaction est terminée. Le paiement a été réglé.',
        participants: [SENDER, RECEIVER],
        status: 'sent',
        isRead: true,
      }),
    );
  });

  it("refuse aussi le message système forgé par un ancien build", async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(SENDER).firestore();
    await assertFails(
      setDoc(doc(db, 'messages', 'legacy-system-1'), {
        chatId: 'chat-1',
        senderId: 'system',
        receiverId: 'system',
        type: 'system',
        content: 'Offre de 30 $ acceptée',
        participants: [SENDER, RECEIVER],
        status: 'sent',
        isRead: true,
      }),
    );
  });

  it('laisse un participant envoyer un message normal signé de son uid', async () => {
    const env = await getTestEnv();
    const db = env.authenticatedContext(SENDER).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'messages', 'normal-1'), {
        chatId: 'chat-1',
        senderId: SENDER,
        receiverId: RECEIVER,
        participants: [SENDER, RECEIVER],
        type: 'text',
        content: 'On se voit à 18h ?',
        status: 'sent',
        isRead: false,
      }),
    );
  });
});
