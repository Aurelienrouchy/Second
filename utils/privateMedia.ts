/** Tokenless references for private Storage objects. Never return a bearer URL. */
import { storageApiOrigin } from './fixStorageUrl';

export const PRIVATE_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
// Request empty token metadata; the Storage API may still generate tokens.
// Callers must ignore upload metadata and never distribute a download URL.
export const PRIVATE_IMAGE_UPLOAD_METADATA = {
  contentType: 'image/jpeg',
  cacheControl: 'private, no-store, max-age=0',
  customMetadata: { firebaseStorageDownloadTokens: '' },
} as const;

function isPrivatePath(path: string): boolean {
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) return false;
  return (parts[0] === 'drafts' && parts.length >= 4)
    || (parts[0] === 'chat_images' && parts.length >= 3)
    || (parts[0] === 'swaps' && parts[2] === 'photos' && parts.length >= 5);
}

/** Persist this stable reference; Firebase SDK resolves it through auth/rules. */
export function privateMediaUrl(bucket: string, path: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(bucket) || !isPrivatePath(path)) {
    throw new Error('Référence de média privé invalide');
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
}

/** Accept our own bucket only. Strip legacy bearer query parameters locally. */
export function privateMediaPath(input: string | undefined, bucket: string | undefined): string | null {
  if (!input || !bucket) return null;
  try {
    let path: string;
    if (input.startsWith('gs://')) {
      const prefix = `gs://${bucket}/`;
      if (!input.startsWith(prefix)) return null;
      path = input.slice(prefix.length);
    } else {
      const parsed = new URL(input);
      const emulatorOrigin = storageApiOrigin();
      if (parsed.username || parsed.password ||
          (parsed.origin !== 'https://firebasestorage.googleapis.com' &&
           !(emulatorOrigin.startsWith('http:') && parsed.origin === emulatorOrigin))) return null;
      const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(parsed.pathname);
      if (!match || decodeURIComponent(match[1]) !== bucket) return null;
      path = decodeURIComponent(match[2]);
    }
    return isPrivatePath(path) ? path : null;
  } catch {
    return null;
  }
}

/** Native renderer receives image bytes only; no Auth token or bearer URL. */
export function privateImageDataUri(bytes: ArrayBuffer, path: string): string {
  const data = new Uint8Array(bytes);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const chunks: string[] = [];
  let encoded = '';
  for (let index = 0; index < data.length; index += 3) {
    const a = data[index];
    const b = data[index + 1];
    const c = data[index + 2];
    encoded += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]
      + (b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)])
      + (c === undefined ? '=' : alphabet[c & 63]);
    if (encoded.length >= 8192) { chunks.push(encoded); encoded = ''; }
  }
  chunks.push(encoded);
  const extension = path.split('.').pop()?.toLowerCase();
  const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp'
    : extension === 'gif' ? 'image/gif' : 'image/jpeg';
  return `data:${mime};base64,${chunks.join('')}`;
}
