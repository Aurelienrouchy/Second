"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const search_1 = require("./search");
(0, vitest_1.describe)('generateSearchKeywords', () => {
    (0, vitest_1.it)('returns empty array for empty string', () => {
        (0, vitest_1.expect)((0, search_1.generateSearchKeywords)('')).toEqual([]);
    });
    (0, vitest_1.it)('returns empty array for null/undefined-like input', () => {
        (0, vitest_1.expect)((0, search_1.generateSearchKeywords)(null)).toEqual([]);
    });
    (0, vitest_1.it)('filters out words shorter than 3 characters', () => {
        const keywords = (0, search_1.generateSearchKeywords)('le de la');
        (0, vitest_1.expect)(keywords).toEqual([]);
    });
    (0, vitest_1.it)('includes individual words', () => {
        const keywords = (0, search_1.generateSearchKeywords)('robe bleue vintage');
        (0, vitest_1.expect)(keywords).toContain('robe');
        (0, vitest_1.expect)(keywords).toContain('bleue');
        (0, vitest_1.expect)(keywords).toContain('vintage');
    });
    (0, vitest_1.it)('lowercases all keywords', () => {
        const keywords = (0, search_1.generateSearchKeywords)('Robe Bleue');
        (0, vitest_1.expect)(keywords).toContain('robe');
        (0, vitest_1.expect)(keywords).toContain('bleue');
        (0, vitest_1.expect)(keywords).not.toContain('Robe');
    });
    (0, vitest_1.it)('generates bigrams for adjacent words', () => {
        const keywords = (0, search_1.generateSearchKeywords)('robe bleue vintage');
        (0, vitest_1.expect)(keywords).toContain('robe bleue');
        (0, vitest_1.expect)(keywords).toContain('bleue vintage');
    });
    (0, vitest_1.it)('generates prefixes for words longer than 3 chars', () => {
        const keywords = (0, search_1.generateSearchKeywords)('vintage');
        (0, vitest_1.expect)(keywords).toContain('vin');
        (0, vitest_1.expect)(keywords).toContain('vint');
        (0, vitest_1.expect)(keywords).toContain('vinta');
        (0, vitest_1.expect)(keywords).toContain('vintag');
        (0, vitest_1.expect)(keywords).toContain('vintage');
    });
    (0, vitest_1.it)('does not generate prefixes for 3-char words', () => {
        const keywords = (0, search_1.generateSearchKeywords)('bob');
        (0, vitest_1.expect)(keywords).toContain('bob');
        (0, vitest_1.expect)(keywords).toHaveLength(1);
    });
    (0, vitest_1.it)('removes punctuation', () => {
        const keywords = (0, search_1.generateSearchKeywords)("l'élégance, c'est!");
        (0, vitest_1.expect)(keywords.some(k => k.includes("'"))).toBe(false);
        (0, vitest_1.expect)(keywords.some(k => k.includes(','))).toBe(false);
    });
    (0, vitest_1.it)('deduplicates keywords', () => {
        const keywords = (0, search_1.generateSearchKeywords)('robe robe robe');
        const robeCount = keywords.filter(k => k === 'robe').length;
        (0, vitest_1.expect)(robeCount).toBe(1);
    });
});
(0, vitest_1.describe)('calculatePopularityScore', () => {
    (0, vitest_1.it)('returns higher score for more engagement', () => {
        const now = new Date();
        const highEngagement = (0, search_1.calculatePopularityScore)(100, 50, now);
        const lowEngagement = (0, search_1.calculatePopularityScore)(10, 2, now);
        (0, vitest_1.expect)(highEngagement).toBeGreaterThan(lowEngagement);
    });
    (0, vitest_1.it)('applies time decay — newer items score higher', () => {
        const now = new Date();
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const newItem = (0, search_1.calculatePopularityScore)(50, 10, now);
        const oldItem = (0, search_1.calculatePopularityScore)(50, 10, oneMonthAgo);
        (0, vitest_1.expect)(newItem).toBeGreaterThan(oldItem);
    });
    (0, vitest_1.it)('returns 0 for zero engagement', () => {
        const score = (0, search_1.calculatePopularityScore)(0, 0, new Date());
        (0, vitest_1.expect)(score).toBe(0);
    });
    (0, vitest_1.it)('weights likes more than views', () => {
        const now = new Date();
        const manyViews = (0, search_1.calculatePopularityScore)(100, 0, now);
        const fewLikes = (0, search_1.calculatePopularityScore)(0, 10, now);
        // 100 views * 0.1 = 10, 10 likes * 2 = 20
        (0, vitest_1.expect)(fewLikes).toBeGreaterThan(manyViews);
    });
    (0, vitest_1.it)('returns positive score for any engagement', () => {
        const score = (0, search_1.calculatePopularityScore)(1, 0, new Date());
        (0, vitest_1.expect)(score).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=search.test.js.map