import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db, storage } from '../config/firebase';
import { articlePrivacyWithdrawn } from './publicProfile';

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
/** Monotone source retirement. The edit reads this same native document before
 * writing its new images; an earlier preparation cannot reintroduce a source
 * whose deletion is already committed but whose pixels still exist. */
export function retiredArticleMediaRef(articleId: string, sourcePath: string) {
  return db.collection('articles').doc(articleId).collection('retired_media')
    .doc(createHash('sha256').update(sourcePath).digest('hex'));
}
export function rejectRetiredArticleMedia(): never {
  throw new HttpsError('failed-precondition', 'Cette photo a été retirée de l’annonce. Ajoutez une nouvelle copie avant de la republier.',
    { reason: 'article_media_source_retired', action: 'uploadNewArticlePhoto' });
}

/** New publications never retain expiring draft/staging URLs. */
export async function promoteArticleImages(
  images: Array<{ url: string; blurhash?: string }>, uid: string, articleId: string,
  allowCurrentArticle = false,
): Promise<Array<{ url: string; blurhash?: string }>> {
  const bucket = storage.bucket();
  return Promise.all(images.map(async (image, index) => {
    if (articlePrivacyWithdrawn((await db.collection('articles').doc(articleId).get()).data())) {
      throw new HttpsError('failed-precondition', 'Cette annonce a été retirée pour confidentialité.');
    }
    const path = storageObjectPath(image.url, bucket.name);
    if (!path) throw new HttpsError('invalid-argument', 'URL de photo invalide');
    const segments = path.split('/');
    const currentArticle = allowCurrentArticle && segments[0] === 'articles' && segments[1] === articleId && segments.length >= 3;
    const staged = (segments[0] === 'drafts' || segments[0] === 'products') && segments[1] === uid && segments.length >= 4;
    if (!staged && !currentArticle) throw new HttpsError('permission-denied', 'Cette photo ne vous appartient pas');
    if (currentArticle && (await retiredArticleMediaRef(articleId, path).get()).exists) rejectRetiredArticleMedia();
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
    if (!metadata.generation || !metadata.metageneration || !metadata.crc32c || !metadata.contentType?.startsWith('image/')
        || !Number.isSafeInteger(size) || size <= 0 || size >= 10 * 1024 * 1024) {
      throw new HttpsError('invalid-argument', 'Photo invalide ou trop volumineuse');
    }
    if (currentArticle) return image;
    // Firebase may mint a download token during an authenticated SDK upload.
    // It is never a publication grant for the private staged source. Retire it
    // on the exact generation before creating a separate public destination.
    if (metadata.metadata?.firebaseStorageDownloadTokens != null || metadata.cacheControl !== 'private, no-store') {
      try {
        await source.setMetadata({cacheControl:'private, no-store',metadata:{firebaseStorageDownloadTokens:null}},
          {ifGenerationMatch:metadata.generation,ifMetagenerationMatch:metadata.metageneration});
      } catch (error:unknown) {
        if (Number((error as {code?:unknown})?.code) === 412)
          throw new HttpsError('failed-precondition','La source de cette photo a changé. Réessayez sa publication.');
        throw error;
      }
    }
    const [privateSource] = await source.getMetadata();
    if (String(privateSource.generation) !== String(metadata.generation) || privateSource.crc32c !== metadata.crc32c ||
        privateSource.contentType !== metadata.contentType || Number(privateSource.size) !== size ||
        !privateSource.metageneration || privateSource.metadata?.firebaseStorageDownloadTokens != null ||
        privateSource.cacheControl !== 'private, no-store')
      throw new HttpsError('failed-precondition','Le brouillon privé de cette photo ne peut pas être confirmé.');
    const destinationPath = `articles/${articleId}/image_${index}_${randomUUID()}`;
    const token = randomUUID();
    const destination = bucket.file(destinationPath);
    const promotionRef = db.collection('article_media_promotions').doc(createHash('sha256').update(JSON.stringify([articleId, destinationPath])).digest('hex'));
    // This native permit serializes with withdrawal BEFORE external IO. An
    // unresolved permit prevents a completed privacy receipt, even if a late
    // copy has not appeared in the first namespace listing yet.
    await db.runTransaction(async tx => {
      const current = (await tx.get(db.collection('articles').doc(articleId))).data();
      if (articlePrivacyWithdrawn(current)) throw new HttpsError('failed-precondition', 'Annonce retirée pour confidentialité.');
      tx.create(promotionRef, { schemaVersion: 1, articleId, ownerId: uid, destinationPath, sourcePath: path,
        sourceGeneration: String(metadata.generation), state: 'preparing', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    });
    // Never overwrite an object, and never copy a replacement staged source.
    await bucket.file(path, { generation: metadata.generation }).copy(destination, { preconditionOpts: { ifGenerationMatch: 0 } });
    const [copied] = await destination.getMetadata();
    if (!copied.generation || copied.crc32c !== metadata.crc32c || copied.contentType !== metadata.contentType || Number(copied.size) !== size) {
      throw new HttpsError('failed-precondition', 'Copie de publication non qualifiée.');
    }
    // A staged private/no-store policy must not leak into the public article's
    // new URL. Existing article files are validated only, never rotated here.
    await destination.setMetadata({ cacheControl: 'public, max-age=3600', metadata: { firebaseStorageDownloadTokens: token } },
      { ifGenerationMatch: copied.generation, ifMetagenerationMatch: copied.metageneration });
    // An editor may have started before the privacy withdrawal committed.
    // Never leave its newly promoted public object behind after that barrier.
    const ready = await db.runTransaction(async tx => {
      const current = (await tx.get(db.collection('articles').doc(articleId))).data();
      const permit = (await tx.get(promotionRef)).data();
      if (!permit || permit.destinationPath !== destinationPath || articlePrivacyWithdrawn(current)) return false;
      tx.update(promotionRef, { state: 'ready', destinationGeneration: String(copied.generation), updatedAt: Timestamp.now() });
      return true;
    });
    if (!ready) {
      try {
        const [latest] = await destination.getMetadata();
        if (String(latest.generation) !== String(copied.generation)) throw new HttpsError('failed-precondition', 'Génération de publication à examiner.');
        await destination.delete({ ifGenerationMatch: copied.generation });
      } catch (error: unknown) {
        if (!(typeof error === 'object' && error && 'code' in error && Number(error.code) === 404)) throw error;
      }
      const [exists] = await destination.exists();
      if (!exists) await db.runTransaction(async tx => {
        const permit = (await tx.get(promotionRef)).data();
        if (permit?.destinationPath === destinationPath) tx.update(promotionRef, { state: 'removed',
          removedGeneration: String(copied.generation), removedAt: Timestamp.now(), updatedAt: Timestamp.now() });
      });
      throw new HttpsError('failed-precondition', 'Cette annonce a été retirée pour confidentialité.');
    }
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
