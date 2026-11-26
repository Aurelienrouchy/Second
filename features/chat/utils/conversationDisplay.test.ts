import { describe, it, expect } from 'vitest';

import {
  conversationTypeOf,
  firstNonEmptyTab,
  formatConversationTimestamp,
  formatBadgeCount,
  getLastMessagePreview,
} from './conversationDisplay';
import type { Chat } from '@/types';

const chat = (over: Partial<Chat>): Chat =>
  ({
    id: 'c',
    participants: ['moi', 'autre'],
    participantsInfo: [],
    unreadCount: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as Chat;

describe('conversationTypeOf', () => {
  it('sans sellerId, la conversation n’est ni vente ni achat', () => {
    expect(conversationTypeOf(chat({}), 'moi')).toBe('autres');
  });

  it('vendeur = moi → ventes ; sinon → achats', () => {
    expect(conversationTypeOf(chat({ sellerId: 'moi' }), 'moi')).toBe('ventes');
    expect(conversationTypeOf(chat({ sellerId: 'autre' }), 'moi')).toBe('achats');
  });

  it('sans utilisateur connu, tout retombe dans autres', () => {
    expect(conversationTypeOf(chat({ sellerId: 'moi' }), null)).toBe('autres');
  });
});

describe('firstNonEmptyTab', () => {
  it('respecte l’ordre ventes → achats → autres', () => {
    expect(firstNonEmptyTab([chat({ sellerId: 'autre' }), chat({ sellerId: 'moi' })], 'moi')).toBe('ventes');
    expect(firstNonEmptyTab([chat({ sellerId: 'autre' })], 'moi')).toBe('achats');
    expect(firstNonEmptyTab([chat({})], 'moi')).toBe('autres');
  });

  it('retombe sur ventes quand il n’y a rien', () => {
    expect(firstNonEmptyTab([], 'moi')).toBe('ventes');
  });
});

describe('formatConversationTimestamp — jours de calendrier', () => {
  const L = 'fr-CA';
  const now = new Date('2026-06-12T08:00:00');

  it('affiche l’heure pour un message du même jour', () => {
    expect(formatConversationTimestamp(new Date('2026-06-12T00:05:00'), L, now)).not.toBe('Hier');
  });

  it('dit « Hier » pour hier soir, même s’il y a moins de 24 h', () => {
    // Neuf heures d'écart : l'ancien calcul disait « aujourd'hui » et affichait
    // l'heure, comme si le message venait d'arriver.
    expect(formatConversationTimestamp(new Date('2026-06-11T23:00:00'), L, now)).toBe('Hier');
  });

  it('ne dit PAS « Hier » pour avant-hier soir, même s’il y a moins de 48 h', () => {
    // Trente-trois heures d'écart : l'ancien calcul disait « Hier ».
    expect(formatConversationTimestamp(new Date('2026-06-10T23:00:00'), L, now)).not.toBe('Hier');
  });

  it('donne le jour de la semaine en deçà d’une semaine', () => {
    const out = formatConversationTimestamp(new Date('2026-06-09T10:00:00'), L, now);
    expect(out).not.toBe('Hier');
    expect(out).not.toMatch(/\d{2}[-/]\d{2}/);
  });

  it('donne une date au-delà d’une semaine', () => {
    expect(formatConversationTimestamp(new Date('2026-05-20T10:00:00'), L, now)).toMatch(/\d/);
  });

  it('rend une chaîne vide sans horodatage', () => {
    expect(formatConversationTimestamp(undefined, L, now)).toBe('');
  });
});

describe('formatBadgeCount', () => {
  it('plafonne à 99+', () => {
    expect(formatBadgeCount(0)).toBe('0');
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
  });
});

describe('getLastMessagePreview', () => {
  const c = (over: Partial<Chat>) => chat(over);

  it('sans message : « Aucun message »', () => {
    expect(getLastMessagePreview(c({}))).toBe('Aucun message');
  });

  it('photo et texte', () => {
    expect(getLastMessagePreview(c({ lastMessage: 'x', lastMessageType: 'image' }))).toBe('[Photo]');
    expect(getLastMessagePreview(c({ lastMessage: 'Bonjour', lastMessageType: 'text' }))).toBe('Bonjour');
  });

  it('distingue offre, contre-offre et offre de rencontre sur le TEXTE', () => {
    const t = (lastMessage: string) =>
      getLastMessagePreview(c({ lastMessage, lastMessageType: 'offer' }));
    expect(t('Offre de 40 $')).toBe('[Offre]');
    expect(t('Contre-offre: 50 $ → 45 $')).toBe('[Contre-offre]');
    expect(t('Demande de meetup pour "Veste"')).toBe('[Offre meetup]');
    expect(t('Remise en main propre')).toBe('[Offre meetup]');
  });

  it('préfixe les messages système', () => {
    expect(getLastMessagePreview(c({ lastMessage: 'Offre acceptée', lastMessageType: 'system' })))
      .toBe('ℹ️ Offre acceptée');
  });
});
