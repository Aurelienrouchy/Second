"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const geohash_1 = require("./geohash");
(0, vitest_1.describe)('encodeGeohash', () => {
    (0, vitest_1.it)('encodes Montreal coordinates', () => {
        const hash = (0, geohash_1.encodeGeohash)(45.5017, -73.5673);
        (0, vitest_1.expect)(hash).toHaveLength(7);
        (0, vitest_1.expect)(hash.startsWith('f25')).toBe(true);
    });
    (0, vitest_1.it)('respects precision parameter', () => {
        const hash5 = (0, geohash_1.encodeGeohash)(45.5017, -73.5673, 5);
        const hash9 = (0, geohash_1.encodeGeohash)(45.5017, -73.5673, 9);
        (0, vitest_1.expect)(hash5).toHaveLength(5);
        (0, vitest_1.expect)(hash9).toHaveLength(9);
        (0, vitest_1.expect)(hash9.startsWith(hash5)).toBe(true);
    });
    (0, vitest_1.it)('defaults to precision 7', () => {
        const hash = (0, geohash_1.encodeGeohash)(0, 0);
        (0, vitest_1.expect)(hash).toHaveLength(7);
    });
    (0, vitest_1.it)('encodes equator/prime meridian (0, 0)', () => {
        const hash = (0, geohash_1.encodeGeohash)(0, 0);
        (0, vitest_1.expect)(hash.startsWith('s')).toBe(true);
    });
    (0, vitest_1.it)('encodes north pole', () => {
        const hash = (0, geohash_1.encodeGeohash)(90, 0);
        (0, vitest_1.expect)(hash).toHaveLength(7);
    });
    (0, vitest_1.it)('encodes south pole', () => {
        const hash = (0, geohash_1.encodeGeohash)(-90, 0);
        (0, vitest_1.expect)(hash).toHaveLength(7);
    });
    (0, vitest_1.it)('nearby coordinates share prefix', () => {
        const hash1 = (0, geohash_1.encodeGeohash)(45.5017, -73.5673, 5);
        const hash2 = (0, geohash_1.encodeGeohash)(45.5020, -73.5670, 5);
        (0, vitest_1.expect)(hash1.substring(0, 4)).toBe(hash2.substring(0, 4));
    });
    (0, vitest_1.it)('distant coordinates differ in prefix', () => {
        const montreal = (0, geohash_1.encodeGeohash)(45.5017, -73.5673, 3);
        const paris = (0, geohash_1.encodeGeohash)(48.8566, 2.3522, 3);
        (0, vitest_1.expect)(montreal).not.toBe(paris);
    });
});
(0, vitest_1.describe)('getGeohashNeighbors', () => {
    (0, vitest_1.it)('includes the original geohash', () => {
        const neighbors = (0, geohash_1.getGeohashNeighbors)('f25eh7');
        (0, vitest_1.expect)(neighbors).toContain('f25eh7');
    });
    (0, vitest_1.it)('returns at least 1 result', () => {
        const neighbors = (0, geohash_1.getGeohashNeighbors)('abcdef');
        (0, vitest_1.expect)(neighbors.length).toBeGreaterThanOrEqual(1);
    });
});
//# sourceMappingURL=geohash.test.js.map