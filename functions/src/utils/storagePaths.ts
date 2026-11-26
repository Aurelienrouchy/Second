/**
 * Chemins d'objets Storage désignés par les URL de téléchargement Firebase.
 *
 * Les URL écrites par l'app ont la forme
 * `https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<chemin encodé>?alt=media&token=…`,
 * où le chemin est encodé (`drafts%2Fuid%2F…`). Les documents Firestore ne
 * portent que ces URL : c'est par elles qu'on sait quel objet un article
 * utilise encore.
 */

import { requireRuntimeProjectId } from '../config/runtimeEnvironment';

/** Bucket et chemin décodé d'une URL Firebase Storage, `null` pour toute autre URL. */
export function parseFirebaseStorageUrl(
  url: string
): { bucketName: string; filePath: string } | null {
  const match = url.match(
    /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/
  );
  if (!match) return null;
  const [, bucketName, encodedPath] = match;
  try {
    return { bucketName, filePath: decodeURIComponent(encodedPath) };
  } catch {
    // `%` orphelin : l'URL ne désigne aucun objet qu'on sache nommer.
    return null;
  }
}

/** Chemin d'objet désigné par `url`, ou `null` si ce n'est pas une URL Firebase Storage. */
export function storagePathFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  return parseFirebaseStorageUrl(url)?.filePath ?? null;
}

/**
 * Vrai si `url` désigne un objet du bucket de CE projet — sous son nom actuel
 * (`<projet>.firebasestorage.app`) ou sous l'ancien (`<projet>.appspot.com`),
 * que portent les URL émises par les versions antérieures du SDK.
 */
export function isOwnBucketImageUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  const parsed = parseFirebaseStorageUrl(url);
  if (!parsed) return false;
  const project = requireRuntimeProjectId();
  return (
    parsed.bucketName === `${project}.firebasestorage.app` ||
    parsed.bucketName === `${project}.appspot.com`
  );
}
