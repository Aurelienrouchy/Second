import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { functions, storage } from '@/config/firebaseConfig';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';
import { PRIVATE_MEDIA_MAX_BYTES } from '@/utils/privateMedia';
import { storageApiOrigin } from '@/utils/fixStorageUrl';

export interface ChatMessageImageReference {chatId: string; messageId: string; fileKind: 'thumbnail' | 'image'}
export interface ChatMessageImage extends ChatMessageImageReference {
  protocol: 'chat_message_image_v1'; viewerId: string; sourceReferenceHash: string; sourceHash: string;
  generation: string; contentType: string; size: number; dataUrl: string;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && v.trim() === v && !!v && v.length <= 200 && !/[\\/\u0000-\u001f\u007f-\u009f]/.test(v) && !['.', '..'].includes(v) && !/^__.*__$/.test(v);
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];
const fail = () => new Error('Cette image privée du message ne peut pas être confirmée.');
/** One decoding pass, exact own bucket and configured origins. Tokens never enter the command. */
export function chatMessageImagePath(uri: string | undefined, bucket: string | undefined, chatId: string): string | null {
  if (!uri || !bucket || !/^[A-Za-z0-9._-]+$/.test(bucket) || !id(chatId) || /[\u0000-\u001f\u007f-\u009f\\]/.test(uri)) return null;
  try {
    let path: string;
    if (uri.startsWith('gs://')) {
      const prefix = `gs://${bucket}/`;
      if (!uri.startsWith(prefix)) return null;
      path = uri.slice(prefix.length).split(/[?#]/, 1)[0];
    } else {
      const parsed = new URL(uri), emulator = storageApiOrigin();
      if (parsed.username || parsed.password || (parsed.origin !== 'https://firebasestorage.googleapis.com' &&
        !(emulator.startsWith('http://') && parsed.origin === emulator))) return null;
      // Read the original object spelling, before URL normalizes dot segments.
      const raw = uri.slice(uri.indexOf('://') + 3), slash = raw.indexOf('/');
      const match = /^\/v0\/b\/([^/?#]+)\/o\/([^?#]+)(?:\?[^#]*)?(?:#.*)?$/.exec(raw.slice(slash));
      if (!match || decodeURIComponent(match[1]) !== bucket) return null;
      path = decodeURIComponent(match[2]);
    }
    const parts = path.split('/');
    if (parts.length < 3 || parts[0] !== 'chat_images' || parts[1] !== chatId || parts.some(part => !part || part === '.' || part === '..') ||
      /[\u0000-\u001f\u007f-\u009f\\]/.test(path)) return null;
    return path;
  } catch { return null; }
}
export function isChatMessageImage(v: unknown, uid: string, reference: ChatMessageImageReference, sourceReferenceHash: string): v is ChatMessageImage {
  if (!object(v) || Object.keys(v).length !== 11 || Object.keys(v).some(k => !['protocol', 'viewerId', 'chatId', 'messageId', 'fileKind', 'sourceReferenceHash', 'sourceHash', 'generation', 'contentType', 'size', 'dataUrl'].includes(k)) ||
    v.protocol !== 'chat_message_image_v1' || v.viewerId !== uid || v.chatId !== reference.chatId || v.messageId !== reference.messageId || v.fileKind !== reference.fileKind ||
    v.sourceReferenceHash !== sourceReferenceHash || !hash(v.sourceHash) || typeof v.generation !== 'string' || !/^[1-9][0-9]*$/.test(v.generation) ||
    typeof v.contentType !== 'string' || !TYPES.includes(v.contentType) || typeof v.size !== 'number' || !Number.isSafeInteger(v.size) || v.size <= 0 || v.size >= PRIVATE_MEDIA_MAX_BYTES ||
    typeof v.dataUrl !== 'string' || !v.dataUrl.startsWith(`data:${v.contentType};base64,`)) return false;
  const encoded = v.dataUrl.slice(`data:${v.contentType};base64,`.length);
  if (!encoded.length || encoded.length > Math.ceil(v.size / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(encoded[encoded.length - padding - 1]);
  return encoded.length / 4 * 3 - padding === v.size && (padding === 2 ? (last & 15) === 0 : padding === 1 ? (last & 3) === 0 : true);
}
export const ChatMessageImageService = {
  async read(uid: string, reference: ChatMessageImageReference, uri: string | undefined, assertContext: () => void): Promise<ChatMessageImage> {
    const session = captureTradeSession(uid), current = () => {assertTradeSessionCurrent(session); assertContext();}; current();
    if (!id(reference.chatId) || !id(reference.messageId) || !['thumbnail', 'image'].includes(reference.fileKind)) throw fail();
    const bucket = storage.app?.options.storageBucket, path = chatMessageImagePath(uri, bucket, reference.chatId);
    if (!bucket || !path) throw fail();
    const sourceReferenceHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(['chat_message_image_reference_v1', bucket, path])); current();
    const result = await httpsCallable<unknown, unknown>(functions, 'submitReport')({operation: 'readChatMessageImage', capability: 'chat_message_image_v1', expectedUid: uid,
      chatId: reference.chatId, messageId: reference.messageId, fileKind: reference.fileKind, sourceReferenceHash});
    current(); if (!isChatMessageImage(result.data, uid, reference, sourceReferenceHash)) throw fail();
    return result.data;
  },
};
