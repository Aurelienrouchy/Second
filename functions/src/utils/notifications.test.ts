import { describe, it, expect, vi } from 'vitest';
vi.mock('../config/firebase', () => ({ db: {}, FieldValue: {} }));
import { buildDeepLink, getPreferenceKey } from './notifications';

describe('buildDeepLink', () => {
  it('builds chat deep link', () => {
    expect(buildDeepLink('chat', { chatId: 'c1' })).toBe('https://seconde.ca/chat/c1');
  });

  it('builds message deep link (same as chat)', () => {
    expect(buildDeepLink('message', { chatId: 'c1' })).toBe('https://seconde.ca/chat/c1');
  });

  it('builds offer_received deep link', () => {
    expect(buildDeepLink('offer_received', { chatId: 'c1' })).toBe('https://seconde.ca/chat/c1');
  });

  it('builds offer_accepted deep link', () => {
    expect(buildDeepLink('offer_accepted', { chatId: 'c1' })).toBe('https://seconde.ca/chat/c1');
  });

  it('builds offer_rejected deep link', () => {
    expect(buildDeepLink('offer_rejected', { chatId: 'c1' })).toBe('https://seconde.ca/chat/c1');
  });

  it('builds offer_counter deep link', () => {
    expect(buildDeepLink('offer_counter', { chatId: 'c1' })).toBe('https://seconde.ca/chat/c1');
  });

  it('builds article_favorited deep link', () => {
    expect(buildDeepLink('article_favorited', { articleId: 'a1' })).toBe('https://seconde.ca/article/a1');
  });

  it('builds price_drop deep link', () => {
    expect(buildDeepLink('price_drop', { articleId: 'a1' })).toBe('https://seconde.ca/article/a1');
  });

  it('builds swap_zone_reminder deep link', () => {
    expect(buildDeepLink('swap_zone_reminder', { partyId: 'p1' })).toBe('https://seconde.ca/swap-party/p1');
  });

  it('builds swap_update deep link', () => {
    expect(buildDeepLink('swap_update', { swapId: 's1' })).toBe('https://seconde.ca/swap/s1');
  });

  it('builds saved_search deep link', () => {
    expect(buildDeepLink('saved_search', { savedSearchId: 'ss1' })).toBe('https://seconde.ca/search?savedSearchId=ss1');
  });

  it('builds shop_approved deep link', () => {
    expect(buildDeepLink('shop_approved', {})).toBe('https://seconde.ca/notifications');
  });

  it('builds shop_rejected deep link', () => {
    expect(buildDeepLink('shop_rejected', {})).toBe('https://seconde.ca/notifications');
  });

  it('builds shop_created deep link', () => {
    expect(buildDeepLink('shop_created', {})).toBe('https://seconde.ca/notifications');
  });

  it('returns empty string for unknown type', () => {
    expect(buildDeepLink('unknown_type', {})).toBe('');
  });

  it('returns empty string when required data is missing (chat without chatId)', () => {
    expect(buildDeepLink('chat', {})).toBe('');
  });

  it('returns empty string when required data is missing (article without articleId)', () => {
    expect(buildDeepLink('article_favorited', {})).toBe('');
  });

  it('returns empty string when required data is missing (swap without swapId)', () => {
    expect(buildDeepLink('swap_update', {})).toBe('');
  });
});

// ===========================================================================
// Les notifications de RECOURS ne dépendent d'aucun réglage de confort.
//
// Le signalement d'absence partait sous le type `order_cancelled`, adossé à la
// préférence « Nouvelles ventes ». Une personne qui a coupé cette catégorie —
// un choix banal — n'apprenait jamais qu'elle est accusée de ne pas s'être
// présentée, ni qu'elle peut donner sa version. Le droit de réponse ouvert par
// `reportMeetupNoShow` ne peut pas dépendre d'un réglage de ce genre.
// ===========================================================================
describe('getPreferenceKey', () => {
  it('les types de recours et de rencontre ne sont adossés à aucun réglage', () => {
    expect(getPreferenceKey('no_show_reported')).toBeNull();
    expect(getPreferenceKey('meetup_confirmed')).toBeNull();
    expect(getPreferenceKey('meetup_cancelled')).toBeNull();
  });

  it('les catégories de confort gardent bien leur réglage', () => {
    expect(getPreferenceKey('new_message')).toBe('newMessages');
    expect(getPreferenceKey('offer_received')).toBe('offerReceived');
    expect(getPreferenceKey('offer_accepted')).toBe('offerResponse');
    expect(getPreferenceKey('order_cancelled')).toBe('newOrders');
  });

  it('un type inconnu est toujours délivré', () => {
    expect(getPreferenceKey('quelque_chose_de_neuf')).toBeNull();
  });
});
