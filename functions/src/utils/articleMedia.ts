import { randomUUID } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, storage } from '../config/firebase';

/** Decode only Firebase Storage download URLs; never fetch an arbitrary host. */
export function storageObjectPath(url: string, bucketName?: string): string | null {
  try {
    const parsed = new URL(url);
    const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    const official = parsed.protocol === 'https:' && parsed.hostname === 'firebasestorage.googleapis.com';
    const emulator = !!emulatorHost && parsed.protocol === 'http:' && parsed.host === emulatorHost;
    if (!official && !emulator) return null;
    const match = parsed.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (!match || (bucketName && decodeURIComponent(match[1]) !== bucketName)) return null;
    const path = decodeURIComponent(match[2]);
    return path.split('/').some((segment) => !segment || segment === '.' || segment === '..') ? null : path;
  } catch {
    return null;
  }
}

/** New publications never retain expiring draft/staging URLs. */
export async function promoteArticleImages(
  images: Array<{ url: string; blurhash?: string }>, uid: string, articleId: string,
  allowCurrentArticle = false,
): Promise<Array<{ url: string; blurhash?: string }>> {
  const bucket = storage.bucket();
  return Promise.all(images.map(async (image, index) => {
    const path = storageObjectPath(image.url, bucket.name);
    if (!path) throw new HttpsError('invalid-argument', 'URL de photo invalide');
    const segments = path.split('/');
    const currentArticle = allowCurrentArticle && segments[0] === 'articles' && segments[1] === articleId && segments.length >= 3;
    const staged = (segments[0] === 'drafts' || segments[0] === 'products') && segments[1] === uid && segments.length >= 4;
    if (!staged && !currentArticle) throw new HttpsError('permission-denied', 'Cette photo ne vous appartient pas');
    const source = bucket.file(path);
    let metadata;
    try {
      [metadata] = await source.getMetadata();
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && Number(error.code) === 404) {
        throw new HttpsError('invalid-argument', 'Cette photo n’existe plus');
      }
      throw error;
    }
    const size = Number(metadata.size);
    if (!metadata.contentType?.startsWith('image/') || !Number.isFinite(size) || size <= 0 || size >= 10 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Photo invalide ou trop volumineuse');
    }
    if (currentArticle) return image;
    const destinationPath = `articles/${articleId}/image_${index}_${randomUUID()}`;
    const token = randomUUID();
    const destination = bucket.file(destinationPath);
    await source.copy(destination);
    // A staged private/no-store policy must not leak into the public article's
    // new URL. Existing article files are validated only, never rotated here.
    await destination.setMetadata({ cacheControl: 'public, max-age=3600', metadata: { firebaseStorageDownloadTokens: token } });
    const downloadOrigin = process.env.FIREBASE_STORAGE_EMULATOR_HOST
      ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`
      : 'https://firebasestorage.googleapis.com';
    return {
      ...image,
      url: `${downloadOrigin}/v0/b/${bucket.name}/o/${encodeURIComponent(destinationPath)}?alt=media&token=${token}`,
    };
  }));
}

/** A legacy published URL is never an abandoned draft, even after 14 days. */
export async function publishedDraftPaths(): Promise<Set<string>> {
  const articles = await db.collection('articles').select('images').get();
  const paths = new Set<string>();
  for (const article of articles.docs) {
    for (const image of article.data().images ?? []) {
      const url = typeof image === 'string' ? image : image?.url;
      const path = typeof url === 'string' ? storageObjectPath(url) : null;
      if (path?.startsWith('drafts/')) paths.add(path);
    }
  }
  return paths;
}
