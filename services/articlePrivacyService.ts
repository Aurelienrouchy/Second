import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { PRIVATE_MEDIA_MAX_BYTES } from '@/utils/privateMedia';
import type { ArticlePrivacyWithdrawalAttempt, ArticlePrivacyWithdrawalReceipt, PrivateArticleAccess,
  PrivateArticleEvidenceRead, PrivateArticleMedia, PrivateArticleMediaReference, PrivateProfileMedia } from '@/types/articlePrivacy';

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const generation = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{1,32}$/.test(v);
const supportedImage = (v: unknown): v is string => typeof v === 'string' && ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif'].includes(v);
const unknown = () => new Error('Le retrait ou la preuve privée doit être relu. Aucun ancien lien public n’est utilisé après un refus ou une lecture incertaine.');
const key = (uid: string) => `second:article-privacy:v1:${encodeURIComponent(uid)}`;
const writes = new Map<string, Promise<void>>(), locks = new Set<string>();
export const newArticlePrivacyRequestId = () => randomUUID();
export const articlePrivacySourceHash = (source: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, source);
const attemptSame = (a: ArticlePrivacyWithdrawalAttempt, b: ArticlePrivacyWithdrawalAttempt) => a.version === b.version &&
  a.ownerId === b.ownerId && a.articleId === b.articleId && a.requestId === b.requestId;
function assertOwner(uid: string, assertContext: () => void) {
  const session = captureTradeSession(uid);
  return () => { assertTradeSessionCurrent(session); assertContext(); };
}
function validAttempt(v: unknown, uid: string): v is ArticlePrivacyWithdrawalAttempt {
  if (!record(v)) return false;
  return Object.keys(v).every(k => ['version', 'ownerId', 'articleId', 'requestId'].includes(k)) && v.version === 1 &&
    v.ownerId === uid && id(v.articleId) && typeof v.requestId === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(v.requestId);
}
function validAccess(access: PrivateArticleAccess) {
  if (!id(access.articleId) || access.transactionId !== undefined && !id(access.transactionId) || access.swapId !== undefined && !id(access.swapId) ||
      access.transactionId !== undefined && access.swapId !== undefined || access.sourceReferenceHashes !== undefined &&
      (!Array.isArray(access.sourceReferenceHashes) || access.sourceReferenceHashes.length > 10 || !access.sourceReferenceHashes.every(hash) ||
        new Set(access.sourceReferenceHashes).size !== access.sourceReferenceHashes.length)) throw unknown();
}
async function parseWithdrawal(value: unknown, attempt: ArticlePrivacyWithdrawalAttempt, assertCurrent: () => void): Promise<ArticlePrivacyWithdrawalReceipt> {
  if (!record(value) || value.kind !== 'article_privacy_withdrawal_v1' || value.ownerId !== attempt.ownerId ||
      value.articleId !== attempt.articleId || value.requestId !== attempt.requestId ||
      !['unrecorded', 'pending', 'needs_review', 'completed', 'not_executed'].includes(String(value.state)) || typeof value.replay !== 'boolean' ||
      typeof value.intentCommitted !== 'boolean' || typeof value.publicWithdrawalComplete !== 'boolean' ||
      typeof value.privateEvidenceAvailable !== 'boolean' || value.downloadedCopiesRecallable !== false ||
      !count(value.mediaTotal) || !count(value.mediaRevoked) || !count(value.mediaNeedsReview) ||
      value.mediaRevoked + value.mediaNeedsReview > value.mediaTotal) throw unknown();
  if (value.state === 'unrecorded') {
    if (value.operationId !== null || value.intentCommitted !== false || value.publicWithdrawalComplete !== false ||
        value.privateEvidenceAvailable !== false || value.mediaTotal !== 0 || value.mediaRevoked !== 0 || value.mediaNeedsReview !== 0 ||
        value.createdAt !== null || value.updatedAt !== null || value.completedAt !== null) throw unknown();
  } else {
    const operationId = await digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify([attempt.ownerId, attempt.articleId, attempt.requestId])); assertCurrent();
    if (value.operationId !== operationId || value.intentCommitted !== true || !date(value.createdAt) ||
        !date(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)) throw unknown();
    if (value.state === 'not_executed') {
      if (value.publicWithdrawalComplete !== false || value.privateEvidenceAvailable !== false || value.mediaTotal !== 0 || value.mediaRevoked !== 0 ||
          value.mediaNeedsReview !== 0 || value.completedAt !== null || value.noWithdrawalEffectsCommitted !== true || value.lateRequestBlocked !== true ||
          !date(value.nonExecutionCommittedAt) || Date.parse(value.nonExecutionCommittedAt) < Date.parse(value.createdAt) ||
          Date.parse(value.nonExecutionCommittedAt) > Date.parse(value.updatedAt)) throw unknown();
    } else if (value.privateEvidenceAvailable !== true || value.publicWithdrawalComplete !== (value.state === 'completed') ||
        (value.state === 'completed' ? !date(value.completedAt) || Date.parse(value.completedAt) < Date.parse(value.createdAt) ||
          value.mediaNeedsReview !== 0 || value.mediaRevoked !== value.mediaTotal : value.completedAt !== null)) throw unknown();
  }
  if (value.state !== 'not_executed' && ['noWithdrawalEffectsCommitted', 'lateRequestBlocked', 'nonExecutionCommittedAt'].some(field =>
      Object.prototype.hasOwnProperty.call(value, field))) throw unknown();
  return value as unknown as ArticlePrivacyWithdrawalReceipt;
}
function validMediaRef(v: unknown, evidenceId: string): v is PrivateArticleMediaReference {
  return record(v) && hash(v.mediaId) && v.evidenceId === evidenceId && supportedImage(v.contentType) &&
    count(v.size) && v.size > 0 && v.size < PRIVATE_MEDIA_MAX_BYTES && generation(v.generation) && hash(v.sourceReferenceHash) &&
    v.mediaBasis === 'source_generation_at_withdrawal' && v.historicalPixelsVerified === false;
}
/** An authenticated image is bounded bytes, never a URL/token/path to storage. */
function validDataImage(value: Record<string, unknown>): boolean {
  if (!supportedImage(value.contentType) || !count(value.size) || value.size < 1 || value.size >= PRIVATE_MEDIA_MAX_BYTES ||
      !generation(value.generation) || typeof value.dataUrl !== 'string') return false;
  const prefix = `data:${value.contentType};base64,`;
  if (!value.dataUrl.startsWith(prefix)) return false;
  const base64 = value.dataUrl.slice(prefix.length);
  if (base64.length !== 4 * Math.ceil(value.size / 3) || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return base64.length / 4 * 3 - padding === value.size;
}
async function serialize(uid: string, work: () => Promise<void>) {
  const pending = (writes.get(uid) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(uid, pending);
  try { await pending; } finally { if (writes.get(uid) === pending) writes.delete(uid); }
}
export class ArticlePrivacyService {
  static async attempts(uid: string, assertContext: () => void): Promise<ArticlePrivacyWithdrawalAttempt[]> {
    const assertCurrent = assertOwner(uid, assertContext); assertCurrent();
    const raw = await AsyncStorage.getItem(key(uid)); assertCurrent();
    if (raw === null) return [];
    let value: unknown; try { value = JSON.parse(raw); } catch { throw unknown(); }
    if (!Array.isArray(value) || value.length > 1000 || !value.every(a => validAttempt(a, uid)) ||
        new Set(value.map(a => a.articleId)).size !== value.length) throw unknown();
    return value;
  }
  static async observe(attempt: ArticlePrivacyWithdrawalAttempt, assertContext: () => void): Promise<ArticlePrivacyWithdrawalReceipt> {
    const assertCurrent = assertOwner(attempt.ownerId, assertContext); assertCurrent();
    if (!validAttempt(attempt, attempt.ownerId)) throw unknown();
    const payload = { articleId: attempt.articleId, expectedUid: attempt.ownerId, requestId: attempt.requestId, mode: 'observe' as const };
    const { data } = await httpsCallable<typeof payload, unknown>(functions, 'withdrawArticlePrivacy')(payload); assertCurrent();
    return parseWithdrawal(data, attempt, assertCurrent);
  }
  static async withdraw(attempt: ArticlePrivacyWithdrawalAttempt, assertContext: () => void): Promise<ArticlePrivacyWithdrawalReceipt> {
    const uid = attempt.ownerId, slot = JSON.stringify([uid, attempt.articleId]), assertCurrent = assertOwner(uid, assertContext); assertCurrent();
    if (!validAttempt(attempt, uid) || locks.has(slot)) throw unknown();
    locks.add(slot);
    try {
      await serialize(uid, async () => {
        const current = await this.attempts(uid, assertCurrent); assertCurrent();
        const prior = current.find(a => a.articleId === attempt.articleId);
        if (prior && !attemptSame(prior, attempt)) throw unknown();
        if (!prior) { await AsyncStorage.setItem(key(uid), JSON.stringify([...current, attempt])); assertCurrent(); }
      });
      assertCurrent();
      const payload = { articleId: attempt.articleId, expectedUid: uid, requestId: attempt.requestId, mode: 'request' as const };
      const { data } = await httpsCallable<typeof payload, unknown>(functions, 'withdrawArticlePrivacy')(payload); assertCurrent();
      const receipt = await parseWithdrawal(data, attempt, assertCurrent); assertCurrent();
      if (!receipt.intentCommitted || receipt.state === 'unrecorded') throw unknown();
      return receipt;
    } finally { locks.delete(slot); }
  }
  static async acknowledge(attempt: ArticlePrivacyWithdrawalAttempt, assertContext: () => void): Promise<void> {
    const uid = attempt.ownerId, slot = JSON.stringify([uid, attempt.articleId]), assertCurrent = assertOwner(uid, assertContext); assertCurrent();
    if (!validAttempt(attempt, uid) || locks.has(slot)) throw unknown();
    locks.add(slot);
    try {
      const receipt = await this.observe(attempt, assertCurrent); assertCurrent();
      const terminal = receipt.state === 'completed' && receipt.publicWithdrawalComplete || receipt.state === 'not_executed' &&
        receipt.noWithdrawalEffectsCommitted === true && receipt.lateRequestBlocked === true && date(receipt.nonExecutionCommittedAt);
      if (!terminal) throw unknown();
      await serialize(uid, async () => {
        const current = await this.attempts(uid, assertCurrent); assertCurrent();
        const prior = current.find(a => a.articleId === attempt.articleId);
        if (!prior || !attemptSame(prior, attempt)) throw unknown();
        await AsyncStorage.setItem(key(uid), JSON.stringify(current.filter(a => a.articleId !== attempt.articleId))); assertCurrent();
      });
    } finally { locks.delete(slot); }
  }
  static async evidence(uid: string, access: PrivateArticleAccess, assertContext: () => void): Promise<PrivateArticleEvidenceRead> {
    validAccess(access); const assertCurrent = assertOwner(uid, assertContext); assertCurrent();
    const payload = { ...access, expectedUid: uid };
    const { data } = await httpsCallable<typeof payload, unknown>(functions, 'readPrivateArticleEvidence')(payload); assertCurrent();
    if (!record(data) || data.kind !== 'private_article_evidence_v1' || data.viewerId !== uid || !id(data.ownerId) || data.articleId !== access.articleId ||
        !['unrecorded', 'recorded'].includes(String(data.state)) || !Array.isArray(data.mediaRefs) || !count(data.mediaNeedsReview) ||
        !Array.isArray(data.publicReferenceHashes) || data.publicReferenceHashes.length > 10 || !data.publicReferenceHashes.every(hash) ||
        new Set(data.publicReferenceHashes).size !== data.publicReferenceHashes.length ||
        data.publicReferenceHashes.some(h => !access.sourceReferenceHashes?.includes(h))) throw unknown();
    if (data.state === 'unrecorded') {
      if (data.publicReferenceUseAllowed !== (data.publicReferenceHashes.length > 0) || data.evidenceId !== null || data.capturedAt !== null || data.sourceUpdatedAt !== null ||
          data.snapshot !== null || data.mediaRefs.length !== 0 || data.mediaNeedsReview !== 0 || data.ownerWithdrawalAttempt !== null) throw unknown();
    } else if (data.publicReferenceUseAllowed !== false || data.publicReferenceHashes.length !== 0 || !hash(data.evidenceId) || !date(data.capturedAt) ||
        !(data.sourceUpdatedAt === null || date(data.sourceUpdatedAt)) || !record(data.snapshot) ||
        data.mediaRefs.length > 1000 || !data.mediaRefs.every(r => validMediaRef(r, data.evidenceId as string)) ||
        new Set(data.mediaRefs.map(r => r.sourceReferenceHash)).size !== data.mediaRefs.length) throw unknown();
    if (data.state === 'recorded') {
      if (!['owner_dossier', 'transaction_contract', 'swap_contract'].includes(String(data.evidenceScope))) throw unknown();
      if (data.evidenceScope === 'owner_dossier') {
        if (data.contractId !== null) throw unknown();
        if (data.ownerId !== uid) {
          // Full withdrawal evidence is a separate owner/admin right. A
          // participant contract ID cannot upgrade itself to this dossier.
          const current = auth.currentUser;
          if (!current || current.uid !== uid) throw unknown();
          const token = await current.getIdTokenResult(true); assertCurrent();
          if (auth.currentUser !== current || token.claims.admin !== true) throw unknown();
        }
      } else {
        if (data.ownerId === uid || data.sourceUpdatedAt !== null ||
            (data.evidenceScope === 'transaction_contract' ? !access.transactionId || data.contractId !== access.transactionId || access.swapId !== undefined
              : !access.swapId || data.contractId !== access.swapId || access.transactionId !== undefined)) throw unknown();
      }
      if (data.ownerId === uid) {
        if (!validAttempt(data.ownerWithdrawalAttempt, uid) || data.ownerWithdrawalAttempt.articleId !== access.articleId) throw unknown();
        const operationId = await digestStringAsync(CryptoDigestAlgorithm.SHA256,
          JSON.stringify([uid, access.articleId, data.ownerWithdrawalAttempt.requestId])); assertCurrent();
        if (data.evidenceId !== operationId) throw unknown();
      } else if (data.ownerWithdrawalAttempt !== null) throw unknown();
      const media = new Map<string, PrivateArticleMediaReference>();
      for (const value of data.mediaRefs as PrivateArticleMediaReference[]) {
        const prior = media.get(value.mediaId);
        if (prior && (prior.evidenceId !== value.evidenceId || prior.generation !== value.generation ||
            prior.contentType !== value.contentType || prior.size !== value.size)) throw unknown();
        media.set(value.mediaId, value);
      }
    }
    return data as unknown as PrivateArticleEvidenceRead;
  }
  static async image(uid: string, access: PrivateArticleAccess, media: PrivateArticleMediaReference, assertContext: () => void): Promise<PrivateArticleMedia> {
    validAccess(access); const assertCurrent = assertOwner(uid, assertContext); assertCurrent();
    if (!validMediaRef(media, media.evidenceId)) throw unknown();
    const payload = { ...access, expectedUid: uid, evidenceId: media.evidenceId, mediaId: media.mediaId, sourceReferenceHash: media.sourceReferenceHash };
    const { data } = await httpsCallable<typeof payload, unknown>(functions, 'readPrivateArticleMedia')(payload); assertCurrent();
    if (!record(data) || data.kind !== 'private_article_media_v1' || data.viewerId !== uid || data.articleId !== access.articleId ||
        data.evidenceId !== media.evidenceId || data.mediaId !== media.mediaId || data.generation !== media.generation || data.contentType !== media.contentType ||
        data.sourceReferenceHash !== media.sourceReferenceHash || data.mediaBasis !== 'source_generation_at_withdrawal' ||
        data.historicalPixelsVerified !== false || data.size !== media.size || !validDataImage(data)) throw unknown();
    return data as unknown as PrivateArticleMedia;
  }
  static async avatar(uid: string, ownerId: string, assertContext: () => void, agreement?: { transactionId?: string; swapId?: string },
    mode: 'observe' | 'read' = 'read', mediaId?: string): Promise<PrivateProfileMedia> {
    const assertCurrent = assertOwner(uid, assertContext); assertCurrent();
    if (!id(ownerId) || agreement?.transactionId !== undefined && !id(agreement.transactionId) ||
        agreement?.swapId !== undefined && !id(agreement.swapId) || agreement?.transactionId && agreement?.swapId || mediaId !== undefined && !hash(mediaId)) throw unknown();
    const payload = { ownerId, expectedUid: uid, ...agreement, mode, ...(mediaId ? { mediaId } : {}) };
    const { data } = await httpsCallable<typeof payload, unknown>(functions, 'readPrivateProfileMedia')(payload); assertCurrent();
    if (!record(data) || data.kind !== 'private_profile_media_v1' || data.viewerId !== uid || data.ownerId !== ownerId || data.mode !== mode ||
        !['unrecorded', 'pending', 'copied', 'revoked', 'needs_review'].includes(String(data.state)) ||
        data.publicWithdrawalComplete !== (data.state === 'revoked') || data.downloadedCopiesRecallable !== false ||
        !(data.mediaId === null || hash(data.mediaId)) || mediaId !== undefined && data.mediaId !== mediaId || !(data.evidenceId === null || hash(data.evidenceId)) ||
        !(data.generation === null || generation(data.generation)) || !(data.contentType === null || supportedImage(data.contentType)) ||
        !(data.size === null || count(data.size) && data.size > 0 && data.size < PRIVATE_MEDIA_MAX_BYTES)) throw unknown();
    if (mode === 'observe' ? data.dataUrl !== null : !['copied', 'revoked'].includes(String(data.state)) ||
        !hash(data.evidenceId) || !hash(data.mediaId) || !validDataImage(data)) throw unknown();
    return data as unknown as PrivateProfileMedia;
  }
}
