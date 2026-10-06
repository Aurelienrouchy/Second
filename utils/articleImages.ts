import type { ArticleImage } from '@/types';
import { fixStorageUrl } from './fixStorageUrl';

/** Accept legacy URL arrays and current image objects at every article read boundary. */
export function normalizeArticleImages(images: unknown): ArticleImage[] {
  if (!Array.isArray(images)) return [];
  return images.flatMap((image: unknown) => {
    const entry = typeof image === 'string' ? { url: image } : image;
    if (!entry || typeof entry !== 'object' || !('url' in entry)) return [];
    if (typeof entry.url !== 'string' || !entry.url.trim()) return [];
    const normalized: ArticleImage = { url: fixStorageUrl(entry.url.trim()) };
    if ('blurhash' in entry && typeof entry.blurhash === 'string' && entry.blurhash) {
      normalized.blurhash = entry.blurhash;
    }
    return [normalized];
  });
}
