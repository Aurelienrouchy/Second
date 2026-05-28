import { describe, it, expect } from 'vitest';
import { encodeGeohash, getGeohashNeighbors } from './geohash';

describe('encodeGeohash', () => {
  it('encodes Montreal coordinates', () => {
    const hash = encodeGeohash(45.5017, -73.5673);
    expect(hash).toHaveLength(7);
    expect(hash.startsWith('f25')).toBe(true);
  });

  it('respects precision parameter', () => {
    const hash5 = encodeGeohash(45.5017, -73.5673, 5);
    const hash9 = encodeGeohash(45.5017, -73.5673, 9);
    expect(hash5).toHaveLength(5);
    expect(hash9).toHaveLength(9);
    expect(hash9.startsWith(hash5)).toBe(true);
  });

  it('defaults to precision 7', () => {
    const hash = encodeGeohash(0, 0);
    expect(hash).toHaveLength(7);
  });

  it('encodes equator/prime meridian (0, 0)', () => {
    const hash = encodeGeohash(0, 0);
    expect(hash.startsWith('s')).toBe(true);
  });

  it('encodes north pole', () => {
    const hash = encodeGeohash(90, 0);
    expect(hash).toHaveLength(7);
  });

  it('encodes south pole', () => {
    const hash = encodeGeohash(-90, 0);
    expect(hash).toHaveLength(7);
  });

  it('nearby coordinates share prefix', () => {
    const hash1 = encodeGeohash(45.5017, -73.5673, 5);
    const hash2 = encodeGeohash(45.5020, -73.5670, 5);
    expect(hash1.substring(0, 4)).toBe(hash2.substring(0, 4));
  });

  it('distant coordinates differ in prefix', () => {
    const montreal = encodeGeohash(45.5017, -73.5673, 3);
    const paris = encodeGeohash(48.8566, 2.3522, 3);
    expect(montreal).not.toBe(paris);
  });
});

describe('getGeohashNeighbors', () => {
  it('includes the original geohash', () => {
    const neighbors = getGeohashNeighbors('f25eh7');
    expect(neighbors).toContain('f25eh7');
  });

  it('returns at least 1 result', () => {
    const neighbors = getGeohashNeighbors('abcdef');
    expect(neighbors.length).toBeGreaterThanOrEqual(1);
  });
});
