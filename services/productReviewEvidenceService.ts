import { phase1HttpsCallable as httpsCallable } from '@/services/phase1Callable';
import { digest, CryptoDigestAlgorithm } from 'expo-crypto';
import { functions } from '@/config/firebaseConfig';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { isProductReviewContext, isProductReviewEvidenceReference, productReviewDocumentId, productReviewEqual, productReviewHash } from '@/services/productReviewService';
import type { ProductReviewContext, ProductReviewCursor, ProductReviewScope } from '@/types/productReview';
import type { ProductReviewEvidence, ProductReviewEvidenceAttempt, ProductReviewEvidenceCommand, ProductReviewEvidencePage,
  ProductReviewEvidencePixels, ProductReviewEvidencePreview, ProductReviewEvidenceReceipt, ProductReviewPreparedFile, ProductReviewFileProof, ProductReviewEvidenceReference } from '@/types/productReviewEvidence';
export const PRODUCT_REVIEW_EVIDENCE_TYPES = ['received_item_photo', 'supporting_document_image', 'expertise_image'] as const;
export const PRODUCT_REVIEW_EVIDENCE_LIMIT = 2097152;
const EFFECTS = ['authenticityVerified', 'recallApplicabilityVerified', 'childSafetyVerified', 'hygieneVerified', 'speciesOrProvenanceVerified',
  'financialEffectAuthorized', 'inventoryEffectAuthorized', 'shippingPermissionGranted', 'physicalContentsVerified', 'legalDeadlineEstablished'];
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = (v: unknown, prefix: string): v is string => typeof v === 'string' && new RegExp(`^${prefix}_[a-f0-9]{64}$`).test(v);
const actor = (v: unknown): v is string => typeof v === 'string' && !!v && v.length <= 128 && !v.includes('/');
const role = (v: unknown) => ['buyer', 'seller', 'reporter'].includes(String(v));
const count = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const iso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const generation = (v: unknown): v is string => typeof v === 'string' && /^\d{1,20}$/.test(v);
const crc = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9+/]{6}==$/.test(v);
const none = (v: Record<string, unknown>) => EFFECTS.every(k => v[k] === false);
const failure = () => new Error('La pièce privée et sa même intention doivent être relues. Aucun autre fichier ne remplace les octets d’origine.');
const guard = (uid: string, callback: () => void) => {const session = captureTradeSession(uid); callback(); return () => {assertTradeSessionCurrent(session); callback();};};
export const isProductReviewPreparedFile = (v: unknown): v is ProductReviewPreparedFile => object(v) && exact(v, ['sha256', 'byteLength', 'contentType', 'width', 'height', 'preparation', 'qualityDeclared']) &&
  hash(v.sha256) && count(v.byteLength, 1, PRODUCT_REVIEW_EVIDENCE_LIMIT) && v.contentType === 'image/jpeg' && count(v.width, 1, 1200) && count(v.height, 1, 1200) && v.preparation === 'prepareImageForUpload' && v.qualityDeclared === 0.75;
export const isProductReviewEvidenceCommand = (v: unknown): v is ProductReviewEvidenceCommand => object(v) &&
  exact(v, ['context', 'contributionId', 'contributionHash', 'sourceHash', 'typeDeclared', 'file']) && isProductReviewContext(v.context) &&
  id(v.contributionId, 'pc') && hash(v.contributionHash) && hash(v.sourceHash) && PRODUCT_REVIEW_EVIDENCE_TYPES.includes(v.typeDeclared as 'received_item_photo') && isProductReviewPreparedFile(v.file);
function fileProof(v: unknown): v is ProductReviewFileProof {
  return object(v) && exact(v, ['generation', 'crc32c', 'sha256', 'byteLength', 'contentType', 'width', 'height']) && generation(v.generation) && crc(v.crc32c) &&
    hash(v.sha256) && count(v.byteLength, 1, PRODUCT_REVIEW_EVIDENCE_LIMIT) && v.contentType === 'image/jpeg' && count(v.width, 1, 1200) && count(v.height, 1, 1200);
}
function evidence(v: unknown, uid: string, scope: ProductReviewScope): v is ProductReviewEvidence {
  return object(v) && exact(v, ['protocol', 'evidenceId', 'contentHash', 'actorId', 'actorRole', 'contributionId', 'typeDeclared', 'state', 'sourceHash',
    'recordedAt', 'generation', 'crc32c', 'sha256', 'byteLength', 'contentType', 'width', 'height', 'currentBlobAvailabilityVerified', 'imageDecodeVerified', 'issuerOriginalVerified', ...EFFECTS]) &&
    v.protocol === 'product_review_evidence_v1' && id(v.evidenceId, 'pf') && hash(v.contentHash) && actor(v.actorId) && (scope === 'admin' || v.actorId === uid) && role(v.actorRole) &&
    id(v.contributionId, 'pc') && PRODUCT_REVIEW_EVIDENCE_TYPES.includes(v.typeDeclared as 'received_item_photo') && ['received', 'stored_requires_review'].includes(String(v.state)) &&
    hash(v.sourceHash) && iso(v.recordedAt) && fileProof(Object.fromEntries(['generation', 'crc32c', 'sha256', 'byteLength', 'contentType', 'width', 'height'].map(k => [k, v[k]]))) &&
    v.currentBlobAvailabilityVerified === false && v.imageDecodeVerified === false && v.issuerOriginalVerified === false && none(v);
}
/** Hash the actual decoded JPEG bytes, never a Base64 string or URI. */
export async function productReviewByteHash(bytes: Uint8Array): Promise<string> {
  const result = await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function productReviewEncodeBytes(bytes: Uint8Array): string {
  const chunks: string[] = []; let piece = '';
  for (let i = 0; i < bytes.length; i += 3) {const b = bytes[i], c = bytes[i + 1], d = bytes[i + 2];
    piece += alphabet[b >> 2] + alphabet[((b & 3) << 4) | ((c ?? 0) >> 4)] + (i + 1 < bytes.length ? alphabet[((c & 15) << 2) | ((d ?? 0) >> 6)] : '=') + (i + 2 < bytes.length ? alphabet[d & 63] : '=');
    if (piece.length >= 8192) {chunks.push(piece); piece = '';}}
  chunks.push(piece); return chunks.join('');
}
function decode(base64: string): Uint8Array {
  if (!base64 || base64.length % 4 || base64.length > Math.ceil(PRODUCT_REVIEW_EVIDENCE_LIMIT / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw failure();
  const size = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0), bytes = new Uint8Array(size); let offset = 0;
  for (let i = 0; i < base64.length; i += 4) {const a = alphabet.indexOf(base64[i]), b = alphabet.indexOf(base64[i + 1]), c = alphabet.indexOf(base64[i + 2]), d = alphabet.indexOf(base64[i + 3]);
    bytes[offset++] = a << 2 | b >> 4; if (offset < size) bytes[offset++] = (b & 15) << 4 | Math.max(c, 0) >> 2; if (offset < size) bytes[offset++] = (Math.max(c, 0) & 3) << 6 | Math.max(d, 0);}
  if (productReviewEncodeBytes(bytes) !== base64) throw failure(); return bytes;
}
/** Bounded header qualification matches the backend; it is not a decoder or a physical-content assessment. */
export function productReviewJpegDimensions(bytes: Uint8Array) {
  if (bytes.length < 16 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw failure();
  let p = 2, dimensions: {width: number; height: number} | null = null;
  for (let segments = 0; segments < 200 && p + 3 < bytes.length; segments++) {
    if (bytes[p++] !== 255) break; while (bytes[p] === 255) p++; const marker = bytes[p++];
    if (marker === 218) {if (dimensions) return dimensions; break;} if ([217, 0, 216].includes(marker)) break;
    if (p + 2 > bytes.length) break; const length = bytes[p] * 256 + bytes[p + 1]; if (length < 2 || p + length > bytes.length) break;
    if ([192, 194].includes(marker)) {if (length < 11 || bytes[p + 2] !== 8 || ![1, 3].includes(bytes[p + 7]) || length !== 8 + 3 * bytes[p + 7]) break;
      dimensions = {height: bytes[p + 3] * 256 + bytes[p + 4], width: bytes[p + 5] * 256 + bytes[p + 6]};}
    p += length;
  } throw failure();
}
async function rpc(uid: string, endpoint: 'submitReport' | 'triageReport', input: Record<string, unknown>, assertContext: () => void) {
  const current = guard(uid, assertContext); current();
  const context = input.context ?? (object(input.command) ? input.command.context : null);
  const result = await httpsCallable<unknown, unknown>(functions, endpoint)({...input, expectedUid: uid, capability: 'product_review_evidence_v1', ...(object(context) && context.kind === 'article_listing' ? {listingCapability: 'product_review_article_listing_v1'} : {})}); current(); return result.data;
}
async function caseId(context: ProductReviewContext, current: () => void) {if (!isProductReviewContext(context)) throw failure(); const result = `pr_${await productReviewHash([context.kind, context.id])}`; current(); return result;}
export const ProductReviewEvidenceService = {
  async preview(uid: string, context: ProductReviewContext, contributionId: string, assertContext: () => void, material = false, parcel = false): Promise<ProductReviewEvidencePreview> {
    const current = guard(uid, assertContext); if (!id(contributionId, 'pc')) throw failure();
    if (material && context.kind !== 'order') throw failure();
    const expectedCase = await caseId(context, current), v = await rpc(uid, 'submitReport', {operation: 'productReviewEvidencePreview', context, contributionId, ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'context', 'caseId', 'contributionId', 'contributionHash', 'sourceHash', 'typesDeclared', 'contentType', 'maxBytes', 'maxDimension', 'preparation', 'qualityDeclared', 'uploadPermissionGranted', ...EFFECTS]) ||
      v.protocol !== 'product_review_evidence_preview_v1' || v.actorId !== uid || !productReviewEqual(v.context, context) || v.caseId !== expectedCase || v.contributionId !== contributionId || !hash(v.contributionHash) || !hash(v.sourceHash) ||
      !productReviewEqual(v.typesDeclared, PRODUCT_REVIEW_EVIDENCE_TYPES) || v.contentType !== 'image/jpeg' || v.maxBytes !== PRODUCT_REVIEW_EVIDENCE_LIMIT || v.maxDimension !== 1200 ||
      v.preparation !== 'prepareImageForUpload' || v.qualityDeclared !== 0.75 || v.uploadPermissionGranted !== false || !none(v)) throw failure(); return v as unknown as ProductReviewEvidencePreview;
  },
  async command(a: ProductReviewEvidenceAttempt, action: 'execute' | 'observe' | 'neutralize', assertContext: () => void, bytes?: Uint8Array): Promise<ProductReviewEvidenceReceipt> {
    const current = guard(a.uid, assertContext); if (!isProductReviewEvidenceCommand(a.command) || !productReviewEqual(a.context, a.command.context) || !/^[A-Za-z0-9_-]{16,128}$/.test(a.requestId)) throw failure();
    if (a.parcelCapability !== undefined && (a.parcelCapability !== 'product_review_parcel_v1' || a.context.kind !== 'order')) throw failure();
    if (a.materialCapability !== undefined && (a.materialCapability !== 'product_review_material_v1' || a.context.kind !== 'order')) throw failure();
    let bytesBase64: string | undefined;
    if (bytes) {if (action !== 'execute' || bytes.length !== a.command.file.byteLength || await productReviewByteHash(bytes) !== a.command.file.sha256 ||
      !productReviewEqual(productReviewJpegDimensions(bytes), {width: a.command.file.width, height: a.command.file.height})) throw failure(); current(); bytesBase64 = productReviewEncodeBytes(bytes);}
    const expectedCase = await caseId(a.context, current), payloadHash = await productReviewHash(a.command), evidenceId = `pf_${await productReviewHash([a.uid, a.requestId])}`; current();
    const v = await rpc(a.uid, 'submitReport', {operation: 'productReviewEvidenceCommand', requestId: a.requestId, action, command: a.command, ...(bytesBase64 ? {bytesBase64} : {}), ...(a.materialCapability ? {materialCapability: a.materialCapability} : {}), ...(a.parcelCapability ? {parcelCapability: a.parcelCapability} : {})}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'requestId', 'payloadHash', 'caseId', 'contributionId', 'evidenceId', 'actorRole', 'futureEffectsNeutralized', 'sendAttempts', 'state', 'reason', 'evidenceHash',
      'storedNativeVerified', 'attachedToContributionVerified', 'fileProof', 'recordedAt', 'currentBlobAvailabilityVerified', 'imageDecodeVerified', 'issuerOriginalVerified', ...EFFECTS]) ||
      v.protocol !== 'product_review_evidence_command_v1' || v.actorId !== a.uid || v.requestId !== a.requestId || v.payloadHash !== payloadHash || v.caseId !== expectedCase ||
      v.contributionId !== a.command.contributionId || v.evidenceId !== evidenceId || v.actorRole !== null && !role(v.actorRole) || typeof v.futureEffectsNeutralized !== 'boolean' || !count(v.sendAttempts, 0, 3) ||
      v.currentBlobAvailabilityVerified !== false || v.imageDecodeVerified !== false || v.issuerOriginalVerified !== false || !none(v)) throw failure();
    const stored = v.state === 'received' || v.state === 'stored_requires_review';
    if (stored ? !role(v.actorRole) || !hash(v.evidenceHash) || !iso(v.recordedAt) || !fileProof(v.fileProof) || v.storedNativeVerified !== true || v.attachedToContributionVerified !== (v.state === 'received') ||
      !['sha256', 'byteLength', 'contentType', 'width', 'height'].every(k => (v.fileProof as unknown as Record<string, unknown>)[k] === (a.command.file as unknown as Record<string, unknown>)[k]) ||
      (v.state === 'received' ? v.reason !== null || v.futureEffectsNeutralized !== false : !['source_changed', 'future_effects_neutralized'].includes(String(v.reason))) :
      v.evidenceHash !== null || v.fileProof !== null || v.storedNativeVerified !== false || v.attachedToContributionVerified !== false ||
      (v.state === 'unrecorded' ? v.actorRole !== null || v.recordedAt !== null || v.reason !== null || v.sendAttempts !== 0 || v.futureEffectsNeutralized !== false :
        v.state === 'not_executed' ? !iso(v.recordedAt) || !['requester_neutralized', 'source_changed'].includes(String(v.reason)) || v.futureEffectsNeutralized !== false :
          !['reserved', 'upload_unknown'].includes(String(v.state)) || !role(v.actorRole) || v.recordedAt !== null || v.reason !== null && !['source_changed', 'future_effects_neutralized', 'upload_retry_limit_reached'].includes(String(v.reason)))) throw failure();
    return v as unknown as ProductReviewEvidenceReceipt;
  },
  async page(uid: string, context: ProductReviewContext, scope: ProductReviewScope, cursor: ProductReviewCursor | null, assertContext: () => void, material = false, parcel = false): Promise<ProductReviewEvidencePage> {
    const current = guard(uid, assertContext); if (cursor !== null && (!object(cursor) || !exact(cursor, ['lastId']) || !productReviewDocumentId(cursor.lastId))) throw failure();
    if (material && context.kind !== 'order') throw failure();
    const expectedCase = await caseId(context, current), v = await rpc(uid, scope === 'admin' ? 'triageReport' : 'submitReport', {operation: 'readProductReviewEvidence', context, scope, cursor, ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'scope', 'caseId', 'entries', 'nextCursor', 'readAt', 'coverage', 'otherActorsOriginalsVisible', ...EFFECTS]) ||
      v.protocol !== 'product_review_evidence_page_v1' || v.actorId !== uid || v.scope !== scope || v.caseId !== expectedCase || !iso(v.readAt) || !Array.isArray(v.entries) || v.entries.length > 20 ||
      v.otherActorsOriginalsVisible !== (scope === 'admin') || !none(v) || !object(v.coverage) || !exact(v.coverage, ['inspected', 'limit', 'hasMore', 'exhaustiveHistoryVerified']) ||
      v.coverage.inspected !== v.entries.length || v.coverage.limit !== 20 || typeof v.coverage.hasMore !== 'boolean' || v.coverage.exhaustiveHistoryVerified !== false) throw failure();
    const ids: string[] = [];
    for (const row of v.entries) {if (!object(row)) throw failure();
      if (row.qualification === 'unknown') {if (!exact(row, ['qualification', 'evidenceId', 'evidence']) || !productReviewDocumentId(row.evidenceId) || row.evidence !== null) throw failure(); ids.push(row.evidenceId);}
      else {if (!exact(row, ['qualification', 'evidence']) || row.qualification !== 'native_stored_file' || !evidence(row.evidence, uid, scope)) throw failure(); ids.push(row.evidence.evidenceId);}}
    if (new Set(ids).size !== ids.length || (v.coverage.hasMore ? !object(v.nextCursor) || !exact(v.nextCursor, ['lastId']) || v.nextCursor.lastId !== ids.at(-1) ||
      !productReviewDocumentId(v.nextCursor.lastId) || v.nextCursor.lastId === cursor?.lastId || ids.length !== 20 : v.nextCursor !== null)) throw failure(); return v as unknown as ProductReviewEvidencePage;
  },
  async file(uid: string, context: ProductReviewContext, scope: ProductReviewScope, entry: ProductReviewEvidence | ProductReviewEvidenceReference, assertContext: () => void, material = false, parcel = false): Promise<ProductReviewEvidencePixels> {
    const current = guard(uid, assertContext), metadata = 'evidenceId' in entry;
    if (!(metadata ? evidence(entry, uid, scope) : isProductReviewEvidenceReference(entry) && (scope === 'admin' || entry.actorId === uid)) || !isProductReviewContext(context)) throw failure();
    if (material && context.kind !== 'order') throw failure();
    const expectedId = metadata ? entry.evidenceId : entry.id;
    const v = await rpc(uid, scope === 'admin' ? 'triageReport' : 'submitReport', {operation: 'readProductReviewEvidenceFile', context, scope,
      evidenceId: expectedId, expectedEvidenceHash: entry.contentHash, ...(material ? {materialCapability: 'product_review_material_v1'} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1'} : {})}, current);
    if (!object(v) || !exact(v, ['protocol', 'actorId', 'evidenceId', 'contentHash', 'dataUrl', 'generation', 'crc32c', 'sha256', 'imageDecodeVerified', 'issuerOriginalVerified', ...EFFECTS]) ||
      v.protocol !== 'product_review_evidence_file_v1' || v.actorId !== uid || v.evidenceId !== expectedId || v.contentHash !== entry.contentHash || v.generation !== entry.generation ||
      v.crc32c !== entry.crc32c || v.sha256 !== entry.sha256 || typeof v.dataUrl !== 'string' || !v.dataUrl.startsWith('data:image/jpeg;base64,') ||
      v.imageDecodeVerified !== false || v.issuerOriginalVerified !== false || !none(v)) throw failure();
    const bytes = decode(v.dataUrl.substring('data:image/jpeg;base64,'.length));
    const size = productReviewJpegDimensions(bytes);
    if (!count(size.width, 1, 1200) || !count(size.height, 1, 1200) || await productReviewByteHash(bytes) !== entry.sha256 ||
      metadata && (bytes.length !== entry.byteLength || !productReviewEqual(size, {width: entry.width, height: entry.height}))) throw failure();
    current(); return v as unknown as ProductReviewEvidencePixels;
  },
};
