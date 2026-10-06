import { describe, expect, it } from 'vitest';
import { moveSellPhoto } from './sellPhotos';

describe('photo reordering', () => {
  it('moves any photo to any position with the uploaded URL attached', () => {
    expect(moveSellPhoto(['a', 'b', 'c', 'd'], ['A', 'B', 'C', 'D'], 1, 3)).toEqual({
      photos: ['a', 'c', 'd', 'b'], storageUrls: ['A', 'C', 'D', 'B'],
    });
  });
  it('allows non-primary photos to change places without changing the primary', () => {
    expect(moveSellPhoto(['a', 'b', 'c'], ['A', 'B', 'C'], 2, 1)).toEqual({
      photos: ['a', 'c', 'b'], storageUrls: ['A', 'C', 'B'],
    });
  });
  it('uses the local fallback for an incomplete uploaded set', () => {
    expect(moveSellPhoto(['a', 'b', 'c'], ['A', 'B'], 2, 0).storageUrls).toEqual([]);
  });
});
