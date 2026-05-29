import { describe, it, expect } from 'vitest';
import {
  generateSearchKeywords,
  calculatePopularityScore,
  normalizeSearchText,
} from './search';

describe('normalizeSearchText', () => {
  it('strips diacritics (accents)', () => {
    expect(normalizeSearchText('été')).toBe('ete');
    expect(normalizeSearchText('décontracté')).toBe('decontracte');
    expect(normalizeSearchText('Robe À Manches')).toBe('robe a manches');
  });

  it('strips punctuation', () => {
    expect(normalizeSearchText("c'est")).toBe('c est');
    expect(normalizeSearchText('nike,')).toBe('nike');
  });

  it('collapses whitespace and trims', () => {
    expect(normalizeSearchText('  robe   bleue  ')).toBe('robe bleue');
  });

  it('handles null/undefined-like input', () => {
    expect(normalizeSearchText(null as unknown as string)).toBe('');
    expect(normalizeSearchText(undefined as unknown as string)).toBe('');
  });
});

describe('generateSearchKeywords', () => {
  it('returns empty array for empty string', () => {
    expect(generateSearchKeywords('')).toEqual([]);
  });

  it('returns empty array for null/undefined-like input', () => {
    expect(generateSearchKeywords(null as unknown as string)).toEqual([]);
  });

  it('filters out words shorter than 3 characters', () => {
    const keywords = generateSearchKeywords('le de la');
    expect(keywords).toEqual([]);
  });

  it('includes individual words', () => {
    const keywords = generateSearchKeywords('robe bleue vintage');
    expect(keywords).toContain('robe');
    expect(keywords).toContain('bleue');
    expect(keywords).toContain('vintage');
  });

  it('lowercases all keywords', () => {
    const keywords = generateSearchKeywords('Robe Bleue');
    expect(keywords).toContain('robe');
    expect(keywords).toContain('bleue');
    expect(keywords).not.toContain('Robe');
  });

  it('generates bigrams for adjacent words', () => {
    const keywords = generateSearchKeywords('robe bleue vintage');
    expect(keywords).toContain('robe bleue');
    expect(keywords).toContain('bleue vintage');
  });

  it('generates prefixes for words longer than 3 chars', () => {
    const keywords = generateSearchKeywords('vintage');
    expect(keywords).toContain('vin');
    expect(keywords).toContain('vint');
    expect(keywords).toContain('vinta');
    expect(keywords).toContain('vintag');
    expect(keywords).toContain('vintage');
  });

  it('does not generate prefixes for 3-char words', () => {
    const keywords = generateSearchKeywords('bob');
    expect(keywords).toContain('bob');
    expect(keywords).toHaveLength(1);
  });

  it('removes punctuation', () => {
    const keywords = generateSearchKeywords("l'élégance, c'est!");
    expect(keywords.some(k => k.includes("'"))).toBe(false);
    expect(keywords.some(k => k.includes(','))).toBe(false);
  });

  it('deduplicates keywords', () => {
    const keywords = generateSearchKeywords('robe robe robe');
    const robeCount = keywords.filter(k => k === 'robe').length;
    expect(robeCount).toBe(1);
  });
});

describe('calculatePopularityScore', () => {
  it('returns higher score for more engagement', () => {
    const now = new Date();
    const highEngagement = calculatePopularityScore(100, 50, now);
    const lowEngagement = calculatePopularityScore(10, 2, now);
    expect(highEngagement).toBeGreaterThan(lowEngagement);
  });

  it('applies time decay — newer items score higher', () => {
    const now = new Date();
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const newItem = calculatePopularityScore(50, 10, now);
    const oldItem = calculatePopularityScore(50, 10, oneMonthAgo);
    expect(newItem).toBeGreaterThan(oldItem);
  });

  it('returns 0 for zero engagement', () => {
    const score = calculatePopularityScore(0, 0, new Date());
    expect(score).toBe(0);
  });

  it('weights likes more than views', () => {
    const now = new Date();
    const manyViews = calculatePopularityScore(100, 0, now);
    const fewLikes = calculatePopularityScore(0, 10, now);
    // 100 views * 0.1 = 10, 10 likes * 2 = 20
    expect(fewLikes).toBeGreaterThan(manyViews);
  });

  it('returns positive score for any engagement', () => {
    const score = calculatePopularityScore(1, 0, new Date());
    expect(score).toBeGreaterThan(0);
  });
});
