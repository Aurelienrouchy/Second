import { describe, expect, it } from 'vitest';
import { normalizeArticleImages } from './articleImages';

describe('article image read boundary', () => {
  it('resolves legacy URLs and canonical objects, preserving placeholders', () => {
    expect(normalizeArticleImages([
      'https://firebasestorage.googleapis.com/v0/b/test/o/articles/item/photo.jpg?alt=media',
      { url: 'https://example.com/photo.jpg', blurhash: 'abc' },
      { url: '' }, null, {},
    ])).toEqual([
      { url: 'https://firebasestorage.googleapis.com/v0/b/test/o/articles%2Fitem%2Fphoto.jpg?alt=media' },
      { url: 'https://example.com/photo.jpg', blurhash: 'abc' },
    ]);
  });

  it('handles absent/malformed image fields and does not double encode URLs', () => {
    expect(normalizeArticleImages(undefined)).toEqual([]);
    expect(normalizeArticleImages({ url: 'not-an-array' })).toEqual([]);
    const url = 'https://firebasestorage.googleapis.com/v0/b/test/o/articles%2Fphoto.jpg?alt=media';
    expect(normalizeArticleImages([{ url }])).toEqual([{ url }]);
  });
});
