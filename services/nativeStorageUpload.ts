import { randomUUID } from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { auth, storage } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession, staleTradeOperation } from '@/services/tradeOperation';
import { storageApiOrigin } from '@/utils/fixStorageUrl';
import { PRIVATE_IMAGE_UPLOAD_METADATA, PRIVATE_MEDIA_MAX_BYTES } from '@/utils/privateMedia';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UploadStage = 'file' | 'authentication' | 'start' | 'session' | 'transfer' | 'confirmation' | 'profile';

/** Safe to show/log: native exceptions may contain the bearer upload URL. */
export class NativeStorageUploadError extends Error {
  readonly code = 'storage/upload-unconfirmed';

  constructor(readonly stage: UploadStage, readonly httpStatus?: number) {
    super('Le téléversement de l’image n’a pas pu être confirmé. Réessayez avec une nouvelle tentative.');
    this.name = 'NativeStorageUploadError';
  }
}

/** A new object name on every attempt. Never reuse the historical profile.jpg object. */
export function newProfileImagePath(ownerUid: string): string {
  return `users/${ownerUid}/profile_${randomUUID()}.jpg`;
}

/**
 * Firebase Storage's resumable protocol, with JSON metadata in the initial
 * request and native file streaming for the final request. This deliberately
 * avoids the Web SDK's Blob/ArrayBuffer path on React Native.
 *
 * Public profile URLs preserve the existing avatar contract, and are opt-in
 * for a newly named profile object only. Private callers never inspect tokens.
 */
export async function uploadPreparedJpeg(options: {
  ownerUid: string;
  path: string;
  localUri: string;
  publicProfileUrl?: true;
  assertContext?: () => void;
}): Promise<{publicDownloadUrl: string | null}> {
  const owner = auth.currentUser;
  const session = captureTradeSession(options.ownerUid);
  const current = () => {
    assertTradeSessionCurrent(session);
    if (auth.currentUser !== owner) throw staleTradeOperation();
    options.assertContext?.();
  };
  current();
  if (options.publicProfileUrl !== undefined && options.publicProfileUrl !== true) {
    throw new Error('Mode de téléversement invalide.');
  }
  const bucket = storage.app.options.storageBucket;
  const parts = options.path.split('/');
  const profileName = parts.length === 3 && parts[0] === 'users' && parts[1] === options.ownerUid &&
    /^profile_(.+)\.jpg$/.test(parts[2]) && UUID_V4.test(parts[2].slice('profile_'.length, -4));
  const privateDraft = parts.length >= 4 && parts[0] === 'drafts' && parts[1] === options.ownerUid;
  const privateSwap = parts.length === 5 && parts[0] === 'swaps' && parts[2] === 'photos' &&
    parts[3] === options.ownerUid && /^[0-3]_[0-9a-f-]+\.jpg$/i.test(parts[4]) && UUID_V4.test(parts[4].slice(2, -4));
  if (!bucket || !/^[A-Za-z0-9._-]+$/.test(bucket) || !options.ownerUid ||
      parts.some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f\u007f]/.test(part)) ||
      (options.publicProfileUrl ? !profileName : !privateDraft && !privateSwap) ||
      !/^(?:file:\/\/\/|content:\/\/)[^\u0000-\u001f\u007f]+$/.test(options.localUri)) {
    throw new Error('Destination ou fichier de téléversement invalide.');
  }
  let stage: UploadStage = 'file';
  let httpStatus: number | undefined;
  try {
    const info = await FileSystem.getInfoAsync(options.localUri);
    current();
    if (!info.exists || info.isDirectory || !Number.isSafeInteger(info.size) || info.size <= 0 || info.size >= PRIVATE_MEDIA_MAX_BYTES) {
      throw new Error('Fichier JPEG indisponible ou trop volumineux.');
    }
    stage = 'authentication';
    const token = await owner!.getIdToken();
    current();
    if (!token) throw new Error('Authentification du téléversement indisponible.');
    const origin = storageApiOrigin();
    const endpoint = `${origin}/v0/b/${bucket}/o`;
    // downloadTokens is a reserved Firebase field: the cloud API rejects even
    // an empty firebaseStorageDownloadTokens custom value when finalizing.
    // Privacy comes from authenticated rules and never distributing the token
    // the service may generate. Cache policy is set before the bytes arrive.
    const metadata = {name: options.path, contentType: PRIVATE_IMAGE_UPLOAD_METADATA.contentType,
      cacheControl: PRIVATE_IMAGE_UPLOAD_METADATA.cacheControl};
    stage = 'start';
    const started = await fetch(`${endpoint}?name=${encodeURIComponent(options.path)}`, {
      method: 'POST', redirect: 'error',
      headers: {Authorization: `Firebase ${token}`, 'Content-Type': 'application/json; charset=utf-8',
        'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(info.size), 'X-Goog-Upload-Header-Content-Type': 'image/jpeg'},
      body: JSON.stringify(metadata),
    });
    current();
    httpStatus = started.status;
    if (!started.ok || started.headers.get('X-Goog-Upload-Status') !== 'active') throw new Error('Initialisation refusée.');
    stage = 'session';
    const uploadUrl = started.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) throw new Error('Session de téléversement absente.');
    const target = new URL(uploadUrl);
    const expected = new URL(endpoint);
    // The session URL is a bearer capability: never persist it, log it, or send
    // the Firebase token to an origin or object chosen by a response body.
    if (target.origin !== expected.origin || target.pathname !== expected.pathname || target.username || target.password || target.hash ||
        !target.searchParams.get('upload_id') || target.searchParams.getAll('upload_id').length !== 1 ||
        target.searchParams.getAll('name').length !== 1 || target.searchParams.get('name') !== options.path) {
      throw new Error('Session de téléversement invalide.');
    }
    current();
    stage = 'transfer';
    httpStatus = undefined;
    const completed = await FileSystem.uploadAsync(uploadUrl, options.localUri, {
      httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: {Authorization: `Firebase ${token}`, 'Content-Type': 'image/jpeg',
        'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0'},
    });
    current();
    stage = 'confirmation';
    httpStatus = completed.status;
    const finalStatus = Object.entries(completed.headers).find(([key]) => key.toLowerCase() === 'x-goog-upload-status')?.[1];
    if (completed.status < 200 || completed.status >= 300 || finalStatus !== 'final') throw new Error('Téléversement non confirmé.');
    if (!options.publicProfileUrl) return {publicDownloadUrl: null};

    // Only the opt-in public avatar response is decoded, with exact source
    // identity. Ignore every other field; never adopt a body-supplied URL.
    stage = 'profile';
    if (completed.body.length > 32_768) throw new Error('Réponse de téléversement invalide.');
    const result: unknown = JSON.parse(completed.body);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Réponse invalide.');
    const record = result as Record<string, unknown>;
    const size = typeof record.size === 'number' ? record.size : typeof record.size === 'string' && /^[0-9]+$/.test(record.size) ? Number(record.size) : NaN;
    if (record.name !== options.path || record.bucket !== bucket || record.contentType !== 'image/jpeg' || size !== info.size ||
        record.cacheControl !== PRIVATE_IMAGE_UPLOAD_METADATA.cacheControl || typeof record.downloadTokens !== 'string' || !UUID_V4.test(record.downloadTokens)) {
      throw new Error('Source de la photo de profil non confirmée.');
    }
    current();
    return {publicDownloadUrl: `${origin}/v0/b/${bucket}/o/${encodeURIComponent(options.path)}?alt=media&token=${encodeURIComponent(record.downloadTokens)}`};
  } catch (error: unknown) {
    current();
    // Native network exceptions can include the resumable URL. Do not leak it
    // through the existing callers' development logs or user-facing errors.
    if (__DEV__) {
      const cause = error && typeof error === 'object' ? error as Record<string, unknown> : null;
      const causeName = typeof cause?.name === 'string' &&
        ['Error', 'TypeError', 'CodedError', 'UnavailabilityError', 'AbortError'].includes(cause.name) ? cause.name : 'other';
      const causeCode = typeof cause?.code === 'string' && /^(?:ERR_[A-Z0-9_]{1,80}|E_[A-Z0-9_]{1,80}|storage\/[a-z-]{1,64})$/.test(cause.code)
        ? cause.code : null;
      // Extract only a known Apple domain and a bounded numeric code. The
      // surrounding native message may include the private upload capability.
      const nativeFailure = typeof cause?.message === 'string'
        ? /\b(NSURLErrorDomain|NSPOSIXErrorDomain|NSCocoaErrorDomain)\s+Code=(-?[0-9]{1,6})\b/.exec(cause.message) : null;
      console.warn('[nativeStorageUpload] Upload not confirmed', JSON.stringify({stage, httpStatus: httpStatus ?? null,
        causeName, causeCode, nativeDomain: nativeFailure?.[1] ?? null, nativeCode: nativeFailure ? Number(nativeFailure[2]) : null}));
    }
    throw new NativeStorageUploadError(stage, httpStatus);
  }
}
