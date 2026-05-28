"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const notifications_1 = require("./notifications");
(0, vitest_1.describe)('buildDeepLink', () => {
    (0, vitest_1.it)('builds chat deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('chat', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
    });
    (0, vitest_1.it)('builds message deep link (same as chat)', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('message', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
    });
    (0, vitest_1.it)('builds offer_received deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('offer_received', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
    });
    (0, vitest_1.it)('builds offer_accepted deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('offer_accepted', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
    });
    (0, vitest_1.it)('builds offer_rejected deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('offer_rejected', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
    });
    (0, vitest_1.it)('builds offer_counter deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('offer_counter', { chatId: 'c1' })).toBe('https://seconde.app/chat/c1');
    });
    (0, vitest_1.it)('builds article_favorited deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('article_favorited', { articleId: 'a1' })).toBe('https://seconde.app/article/a1');
    });
    (0, vitest_1.it)('builds price_drop deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('price_drop', { articleId: 'a1' })).toBe('https://seconde.app/article/a1');
    });
    (0, vitest_1.it)('builds swap_zone_reminder deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('swap_zone_reminder', { partyId: 'p1' })).toBe('https://seconde.app/swap-party/p1');
    });
    (0, vitest_1.it)('builds swap_update deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('swap_update', { swapId: 's1' })).toBe('https://seconde.app/swap/s1');
    });
    (0, vitest_1.it)('builds saved_search deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('saved_search', { savedSearchId: 'ss1' })).toBe('https://seconde.app/search?savedSearchId=ss1');
    });
    (0, vitest_1.it)('builds shop_approved deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('shop_approved', {})).toBe('https://seconde.app/notifications');
    });
    (0, vitest_1.it)('builds shop_rejected deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('shop_rejected', {})).toBe('https://seconde.app/notifications');
    });
    (0, vitest_1.it)('builds shop_created deep link', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('shop_created', {})).toBe('https://seconde.app/notifications');
    });
    (0, vitest_1.it)('returns empty string for unknown type', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('unknown_type', {})).toBe('');
    });
    (0, vitest_1.it)('returns empty string when required data is missing (chat without chatId)', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('chat', {})).toBe('');
    });
    (0, vitest_1.it)('returns empty string when required data is missing (article without articleId)', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('article_favorited', {})).toBe('');
    });
    (0, vitest_1.it)('returns empty string when required data is missing (swap without swapId)', () => {
        (0, vitest_1.expect)((0, notifications_1.buildDeepLink)('swap_update', {})).toBe('');
    });
});
//# sourceMappingURL=notifications.test.js.map