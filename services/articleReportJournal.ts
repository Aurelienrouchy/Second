import AsyncStorage from '@/utils/environmentStorage';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import type { Article } from '@/types/article';
import type { ArticleReportAttempt, ArticleReportMediaProposal, ArticleReportObservation, ArticleReportPreview } from '@/types/articleReportEvidence';
import { assertTradeSessionCurrent, captureTradeSession } from '@/services/tradeOperation';

const FIELDS = ['title', 'description', 'price', 'images', 'condition', 'brand', 'brandStatus', 'categoryIds', 'size',
  'color', 'colors', 'material', 'materials', 'pattern', 'hasKnownDefects', 'defectsDescription', 'hasAlterations',
  'alterationsDescription', 'quantity'] as const;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const failure = () => new Error('La version, les photos ou l’intention de signalement doivent être rapprochées. Aucun nouveau signalement n’a été confirmé.');
const journalKey = (uid: string, articleId: string) => `second:article-report:v1:${encodeURIComponent(uid)}:${encodeURIComponent(articleId)}`;
const writes = new Map<string, Promise<unknown>>();
export function articleReportProjection(article: Article): Record<string, unknown> {
  return Object.fromEntries(FIELDS.map(field => [field, field === 'images' ? article.images.map(image => ({url: image.url, blurhash: image.blurhash ?? null}))
    : field === 'size' && article.size ? {value: article.size.value ?? null, system: article.size.system ?? null} : article[field] ?? null]));
}
export function canonicalArticleReport(value: unknown): string {
  let nodes = 0;
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > 5000 || depth > 8) throw failure();
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(item => visit(item, depth + 1));
    if (record(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
      return Object.fromEntries(Object.keys(v).sort().map(key => [key, visit(v[key], depth + 1)]));
    }
    throw failure();
  };
  const result = JSON.stringify(visit(value, 0)); if (result.length > 120000) throw failure(); return result;
}
function proposals(v: unknown): v is ArticleReportMediaProposal[] {
  return Array.isArray(v) && v.length >= 1 && v.length <= 10 && v.every((m, index) => record(m) &&
    Object.keys(m).sort().join(',') === 'contentType,index,qualification,size,sourceCrc32c,sourceGeneration' && m.index === index &&
    (m.qualification === 'needs_review' ? [m.sourceGeneration, m.sourceCrc32c, m.contentType, m.size].every(item => item === null) :
      m.qualification === 'qualified' && typeof m.sourceGeneration === 'string' && /^\d+$/.test(m.sourceGeneration) &&
      typeof m.sourceCrc32c === 'string' && typeof m.contentType === 'string' && m.contentType.startsWith('image/') &&
      typeof m.size === 'number' && Number.isSafeInteger(m.size) && m.size > 0 && m.size < 10 * 1024 * 1024));
}
export function validArticleReportAttempt(v: unknown, uid: string, articleId: string): v is ArticleReportAttempt {
  return record(v) && Object.keys(v).sort().join(',') === 'description,expectedArticleContentHash,expectedArticleRevision,expectedMedia,reason,requestId,targetId,targetType,uid,version' &&
    v.version === 1 && v.uid === uid && v.targetType === 'article' && v.targetId === articleId && id(articleId) && id(v.requestId) &&
    typeof v.reason === 'string' && ['counterfeit', 'dangerous_item', 'scam', 'inappropriate_content', 'spam', 'other'].includes(v.reason) &&
    (v.description === null || typeof v.description === 'string' && v.description.trim() === v.description && v.description.length > 0 && v.description.length <= 2000) &&
    hash(v.expectedArticleRevision) && hash(v.expectedArticleContentHash) && proposals(v.expectedMedia);
}
export async function parseArticleReportPreview(v: unknown, uid: string, articleId: string, sellerId: string,
  examined: Record<string, unknown>, assertContext: () => void): Promise<ArticleReportPreview> {
  if (!record(v) || v.protocol !== 'article_report_preview_v1' || v.actorUid !== uid || v.articleId !== articleId || v.sellerId !== sellerId ||
    !hash(v.articleRevision) || !hash(v.contentHash) || !record(v.snapshot) || canonicalArticleReport(v.snapshot) !== canonicalArticleReport(examined) ||
    !proposals(v.expectedMedia) || v.mediaCount !== v.expectedMedia.length || v.conservation !== (v.expectedMedia.every(m => m.qualification === 'qualified') ? 'ready' : 'needs_review') ||
    v.authenticityVerified !== false || v.photoRightsVerified !== false) throw failure();
  const contentHash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, canonicalArticleReport(examined)); assertContext();
  if (v.contentHash !== contentHash) throw failure(); return v as unknown as ArticleReportPreview;
}
export async function parseArticleReportObservation(v: unknown, attempt: ArticleReportAttempt, assertContext: () => void): Promise<ArticleReportObservation> {
  if (!record(v) || !['article_report_receipt_v1', 'article_report_nonexecution_v1'].includes(String(v.protocol)) || v.actorUid !== attempt.uid || v.articleId !== attempt.targetId ||
    !id(v.reportId) || v.requestId !== attempt.requestId) throw failure();
  if (v.state === 'unrecorded' || v.state === 'historical_unknown') {
    if (v.protocol !== 'article_report_receipt_v1' || ['tupleHash', 'snapshot', 'media', 'dataUrl', 'receivedAt'].some(key => key in v) ||
      v.state === 'historical_unknown' && v.conservation !== 'historical_unknown') throw failure();
    return v as unknown as ArticleReportObservation;
  }
  const tupleHash = await articleReportTupleHash(attempt); assertContext();
  if (v.protocol === 'article_report_nonexecution_v1') {
    if (v.state !== 'not_executed' || v.tupleHash !== tupleHash || v.articleRevision !== attempt.expectedArticleRevision ||
      v.contentHash !== attempt.expectedArticleContentHash || v.reason !== attempt.reason || v.description !== attempt.description ||
      typeof v.neutralizedAt !== 'string' || !Number.isFinite(Date.parse(v.neutralizedAt)) || new Date(v.neutralizedAt).toISOString() !== v.neutralizedAt ||
      v.sourceExamined !== false || v.reportCreated !== false || v.authenticityVerified !== false || v.photoRightsVerified !== false ||
      v.ok !== undefined && v.ok !== true || v.replay !== undefined && typeof v.replay !== 'boolean' ||
      Object.keys(v).some(key => !['protocol', 'actorUid', 'reportId', 'articleId', 'requestId', 'tupleHash', 'reason', 'description',
        'articleRevision', 'contentHash', 'neutralizedAt', 'state', 'sourceExamined', 'reportCreated', 'authenticityVerified', 'photoRightsVerified', 'ok', 'replay'].includes(key))) throw failure();
    return v as unknown as ArticleReportObservation;
  }
  if (v.state !== undefined && v.state !== 'recorded' || v.tupleHash !== tupleHash || v.articleRevision !== attempt.expectedArticleRevision ||
    v.contentHash !== attempt.expectedArticleContentHash || v.reason !== attempt.reason || v.description !== attempt.description ||
    typeof v.receivedAt !== 'string' || !Number.isFinite(Date.parse(v.receivedAt)) || !['pending', 'preserved', 'needs_review'].includes(String(v.conservation)) ||
    v.mediaCount !== attempt.expectedMedia.length || typeof v.status !== 'string' || v.authenticityVerified !== false || v.photoRightsVerified !== false ||
    ['snapshot', 'media', 'dataUrl', 'privatePath', 'sourcePath'].some(key => key in v)) throw failure();
  return v as unknown as ArticleReportObservation;
}
export function articleReportTupleHash(attempt: ArticleReportAttempt): Promise<string> {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, canonicalArticleReport({actorUid: attempt.uid, articleId: attempt.targetId,
    requestId: attempt.requestId, reason: attempt.reason, description: attempt.description, expectedArticleRevision: attempt.expectedArticleRevision,
    expectedArticleContentHash: attempt.expectedArticleContentHash, expectedMedia: attempt.expectedMedia}));
}
async function serialized<T>(slot: string, work: () => Promise<T>): Promise<T> {
  const next = (writes.get(slot) ?? Promise.resolve()).catch(() => undefined).then(work); writes.set(slot, next);
  try { return await next; } finally { if (writes.get(slot) === next) writes.delete(slot); }
}
export async function readArticleReportAttempt(uid: string, articleId: string, assertContext: () => void): Promise<ArticleReportAttempt | null> {
  const session = captureTradeSession(uid); assertContext(); if (!id(articleId)) throw failure();
  const raw = await AsyncStorage.getItem(journalKey(uid, articleId)); assertTradeSessionCurrent(session); assertContext();
  if (raw === null) return null;
  let value: unknown; try { value = JSON.parse(raw); } catch { throw failure(); }
  if (!validArticleReportAttempt(value, uid, articleId)) throw failure(); return value;
}
export async function rememberArticleReportAttempt(attempt: ArticleReportAttempt, assertContext: () => void): Promise<void> {
  const session = captureTradeSession(attempt.uid); assertContext(); if (!validArticleReportAttempt(attempt, attempt.uid, attempt.targetId)) throw failure();
  await serialized(journalKey(attempt.uid, attempt.targetId), async () => {
    assertTradeSessionCurrent(session); assertContext();
    const old = await readArticleReportAttempt(attempt.uid, attempt.targetId, assertContext);
    if (old && canonicalArticleReport(old) !== canonicalArticleReport(attempt)) throw failure();
    await AsyncStorage.setItem(journalKey(attempt.uid, attempt.targetId), JSON.stringify(old ?? attempt)); assertTradeSessionCurrent(session); assertContext();
  });
}
export async function acknowledgeArticleReportAttempt(attempt: ArticleReportAttempt, receipt: ArticleReportObservation, assertContext: () => void): Promise<void> {
  const session = captureTradeSession(attempt.uid); assertContext();
  await serialized(journalKey(attempt.uid, attempt.targetId), async () => {
    await parseArticleReportObservation(receipt, attempt, assertContext); assertTradeSessionCurrent(session); assertContext();
    if (receipt.state === 'unrecorded' || receipt.state === 'historical_unknown') throw failure();
    const old = await readArticleReportAttempt(attempt.uid, attempt.targetId, assertContext);
    if (!old || canonicalArticleReport(old) !== canonicalArticleReport(attempt)) throw failure();
    await AsyncStorage.removeItem(journalKey(attempt.uid, attempt.targetId)); assertTradeSessionCurrent(session); assertContext();
  });
}
