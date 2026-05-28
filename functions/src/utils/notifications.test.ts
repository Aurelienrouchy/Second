import { describe, it, expect } from 'vitest';
import { buildDeepLink } from './notifications';

describe('buildDeepLink', () => {
  it('builds chat deep link', () => {
    expect(buildDeepLink('chat', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
  });

  it('builds message deep link (same as chat)', () => {
    expect(buildDeepLink('message', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
  });

  it('builds offer_received deep link', () => {
    expect(buildDeepLink('offer_received', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
  });

  it('builds offer_accepted deep link', () => {
    expect(buildDeepLink('offer_accepted', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
  });

  it('builds offer_rejected deep link', () => {
    expect(buildDeepLink('offer_rejected', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
  });

  it('builds offer_counter deep link', () => {
    expect(buildDeepLink('offer_counter', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
  });

  it('builds article_favorited deep link', () => {
    expect(buildDeepLink('article_favorited', { articleId: 'a1' })).toBe('https://seconde.app/article/a1');
  });

  it('builds price_drop deep link', () => {
    expect(buildDeepLink('price_drop', { articleId: 'a1' })).toBe('https://seconde.app/article/a1');
  });

  it('builds swap_zone_reminder deep link', () => {
    expect(buildDeepLink('swap_zone_reminder', { partyId: 'p1' })).toBe('https://seconde.app/swap-party/p1');
  });

  it('builds swap_update deep link', () => {
    expect(buildDeepLink('swap_update', { swapId: 's1' })).toBe('https://seconde.app/swap/s1');
  });

  it('builds saved_search deep link', () => {
    expect(buildDeepLink('saved_search', { savedSearchId: 'ss1' })).toBe('https://seconde.app/search?savedSearchId=ss1');
  });

  it('builds shop_approved deep link', () => {
    expect(buildDeepLink('shop_approved', {})).toBe('https://seconde.app/notifications');
  });

  it('builds shop_rejected deep link', () => {
    expect(buildDeepLink('shop_rejected', {})).toBe('https://seconde.app/notifications');
  });

  it('builds shop_created deep link', () => {
    expect(buildDeepLink('shop_created', {})).toBe('https://seconde.app/notifications');
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
