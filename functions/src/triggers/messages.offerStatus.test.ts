/**
 * `sendOfferStatusNotification` n'appliquait AUCUN contrôle de blocage.
 *
 * Le filet anti-blocage vit dans `sendMessageNotification`, qui ne se déclenche
 * qu'à la CRÉATION d'un message. Répondre à une offre est une MISE À JOUR :
 * cette seconde voie était donc entièrement hors garde. Une personne bloquée
 * pouvait faire sonner le téléphone de celle qui l'a bloquée en refusant ou en
 * contre-offrant, autant de fois qu'il y a d'offres dans le fil.
 *
 * Le trigger notifie `after.senderId`, l'auteur de l'offre. Piège n° 5 : dès que
 * la vendeuse a émis la contre-offre, `senderId` ne désigne plus l'acheteur mais
 * la vendeuse — c'est-à-dire, ici, la personne qui a bloqué.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFirestoreMock } from '../utils/testHelpers/firestoreMock';
import type { MockFirestore } from '../utils/testHelpers/firestoreMock';

const holder = vi.hoisted(() => ({ fs: null as MockFirestore | null }));
const fs: MockFirestore = createFirestoreMock();
holder.fs = fs;

const sent = vi.hoisted(() => ({ calls: [] as Array<{ to: string; title: string }> }));

vi.mock('../config/firebase', () => ({
  get db() {
    return holder.fs!.db;
  },
  get FieldValue() {
    return holder.fs!.FieldValue;
  },
}));
vi.mock('../utils/notifications', () => ({
  sendPushNotification: async (to: string, title: string) => {
    sent.calls.push({ to, title });
    return { success: true, sentCount: 1 };
  },
}));
vi.mock('firebase-functions/logger', () => ({
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
}));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_opts: unknown, handler: unknown) => handler,
  onDocumentUpdated: (_opts: unknown, handler: unknown) => handler,
}));

import { sendOfferStatusNotification } from './messages';

type TriggerHandler = (event: {
  data?: { before?: { data: () => unknown }; after?: { data: () => unknown } };
  params: Record<string, string>;
}) => Promise<void>;
const onOfferStatus = sendOfferStatusNotification as unknown as TriggerHandler;

const ALICE = 'alice';
const BOB = 'bob';
const CHAT = 'chat1';

/** Message d'offre émis par ALICE (contre-offre de la vendeuse) vers BOB. */
function offerMessage(status: string) {
  return {
    chatId: CHAT,
    senderId: ALICE,
    receiverId: BOB,
    type: 'offer',
    offer: { status, amount: 55 },
  };
}

function fire(beforeStatus: string, afterStatus: string) {
  return onOfferStatus({
    data: {
      before: { data: () => offerMessage(beforeStatus) },
      after: { data: () => offerMessage(afterStatus) },
    },
    params: { messageId: 'm1' },
  });
}

beforeEach(() => {
  fs.reset();
  sent.calls = [];
  fs.setDoc(`chats/${CHAT}`, { participants: [ALICE, BOB] });
  fs.setDoc(`users/${ALICE}`, { displayName: 'Alice' });
  fs.setDoc(`users/${BOB}`, { displayName: 'Bob' });
});

describe('sendOfferStatusNotification — garde de blocage', () => {
  it('notifie l’auteur de l’offre quand personne ne bloque', async () => {
    await fire('pending', 'rejected');
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0].to).toBe(ALICE);
  });

  it('ne notifie PAS quand l’auteur de l’offre a bloqué celui qui répond', async () => {
    fs.setDoc(`users/${ALICE}`, { displayName: 'Alice', blockedUserIds: [BOB] });
    await fire('pending', 'rejected');
    expect(sent.calls).toHaveLength(0);
  });

  it('ne notifie PAS non plus dans l’autre sens', async () => {
    fs.setDoc(`users/${BOB}`, { displayName: 'Bob', blockedUserIds: [ALICE] });
    await fire('pending', 'accepted');
    expect(sent.calls).toHaveLength(0);
  });

  it('voit un blocage stocké dans l’ancienne forme objet', async () => {
    fs.setDoc(`users/${ALICE}`, {
      displayName: 'Alice',
      blockedUsers: [{ userId: BOB, userName: 'Bob', blockedAt: '2026-01-01' }],
    });
    await fire('pending', 'counter_price');
    expect(sent.calls).toHaveLength(0);
  });

  it('ne notifie pas si l’auteur de l’offre n’est pas participant de la conversation', async () => {
    fs.setDoc(`chats/${CHAT}`, { participants: ['carole', BOB] });
    await fire('pending', 'rejected');
    expect(sent.calls).toHaveLength(0);
  });

  it('un statut non notifiable ne déclenche rien', async () => {
    await fire('accepted', 'completed');
    expect(sent.calls).toHaveLength(0);
  });
});

// ===========================================================================
// Une contre-offre produisait DEUX notifications au même destinataire.
//
// `counterOfferPrice` fait deux écritures que le serveur observe séparément :
//   - la bascule de l'offre d'origine vers `counter_price`, vue par
//     `sendOfferStatusNotification` → « Nouvelle contre-offre » ;
//   - la création du message de contre-offre, vue par `sendMessageNotification`
//     → « Nouvelle offre de {nom} ».
//
// Le destinataire recevait donc deux notifications pour un seul geste, dont une
// mal intitulée : « Nouvelle offre de Alice » alors qu'Alice est la VENDEUSE et
// qu'il s'agit d'une contre-offre, pas d'une offre neuve.
//
// On garde celle du changement de statut : c'est elle qui porte les libellés
// précis par type (prix / lieu / horaire) que les documents métier décrivent.
// ===========================================================================
import { sendMessageNotification } from './messages';

type CreateHandler = (event: {
  data?: { data: () => unknown; ref: { delete: () => Promise<void> } };
  params: Record<string, string>;
}) => Promise<void>;
const onCreate = sendMessageNotification as unknown as CreateHandler;

function fireCreate(message: Record<string, unknown>) {
  return onCreate({
    data: { data: () => message, ref: { delete: async () => {} } },
    params: { messageId: 'm2' },
  });
}

describe('sendMessageNotification — une seule notification par contre-offre', () => {
  const counterOffer = {
    chatId: CHAT,
    senderId: ALICE,
    receiverId: BOB,
    type: 'offer',
    content: 'Contre-offre: 55 $',
    offer: { amount: 55, status: 'pending', originalOfferId: 'offer_1' },
  };

  it('ne notifie pas la création d’une contre-offre', async () => {
    await fireCreate(counterOffer);
    expect(sent.calls).toHaveLength(0);
  });

  it('notifie bien une offre NEUVE', async () => {
    await fireCreate({ ...counterOffer, offer: { amount: 55, status: 'pending' } });
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0].to).toBe(BOB);
    expect(sent.calls[0].title).toContain('Nouvelle offre');
  });

  it('notifie toujours un message texte', async () => {
    await fireCreate({
      chatId: CHAT,
      senderId: ALICE,
      receiverId: BOB,
      type: 'text',
      content: 'Bonjour',
    });
    expect(sent.calls).toHaveLength(1);
  });
});
