import { describe, expect, it } from 'vitest';
import { clampImageTranslation, fittedImageSize } from './galleryGeometry';

describe('gallery geometry', () => {
  it('fits portrait and landscape images without cropping', () => {
    expect(fittedImageSize(400, 600, 800, 400)).toEqual({ width: 400, height: 200 });
    expect(fittedImageSize(400, 600, 400, 1200)).toEqual({ width: 200, height: 600 });
  });

  it('bounds pan using the actual image and prevents dragging empty margins', () => {
    expect(clampImageTranslation(100, 200, 600, 2)).toBe(0);
    expect(clampImageTranslation(1000, 400, 400, 3)).toBe(400);
    expect(clampImageTranslation(-1000, 400, 400, 3)).toBe(-400);
    expect(clampImageTranslation(15, 400, 400, 1)).toBe(0);
  });
});
