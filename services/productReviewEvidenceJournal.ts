import AsyncStorage from '@/utils/environmentStorage';
import { getEnvironmentFileDirectory } from '@/utils/environmentStorage';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { prepareImageForUpload } from '@/utils/imageUtils';
import { captureTradeSession, assertTradeSessionCurrent } from '@/services/tradeOperation';
import { isProductReviewContext, productReviewEqual, productReviewHash } from '@/services/productReviewService';
import { isProductReviewEvidenceCommand, PRODUCT_REVIEW_EVIDENCE_LIMIT, PRODUCT_REVIEW_EVIDENCE_TYPES,
  productReviewByteHash, productReviewJpegDimensions, ProductReviewEvidenceService } from '@/services/productReviewEvidenceService';
import type { ProductReviewContext } from '@/types/productReview';
import type { ProductReviewEvidenceAttempt, ProductReviewEvidencePreview, ProductReviewEvidenceType } from '@/types/productReviewEvidence';

const locks = new Set<string>();
const slot = (uid: string, context: ProductReviewContext) => `second:product-review-evidence:v1:${JSON.stringify([uid, context.kind, context.id])}`;
const failure = () => new Error('La même pièce préparée reste liée à cette intention. Relisez-la sans lui substituer un autre fichier.');
const guard = (uid: string, callback: () => void) => {const session = captureTradeSession(uid); callback(); return () => {assertTradeSessionCurrent(session); callback();};};
async function privateFile(uid: string, requestId: string, current: () => void) {
  const actorHash = await productReviewHash(uid); current();
  return new File(new Directory(Paths.document, getEnvironmentFileDirectory('product-review-evidence'), actorHash), `${requestId}.jpg`);
}
async function pending(uid: string, context: ProductReviewContext, assertContext: () => void): Promise<ProductReviewEvidenceAttempt | null> {
  const current = guard(uid, assertContext); if (!isProductReviewContext(context)) throw failure();
  const raw = await AsyncStorage.getItem(slot(uid, context)); current(); if (raw === null) return null;
  const v: unknown = JSON.parse(raw);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw failure(); const a = v as Record<string, unknown>;
  const material = Object.prototype.hasOwnProperty.call(a, 'materialCapability'), parcel = Object.prototype.hasOwnProperty.call(a, 'parcelCapability');
  if (Object.keys(a).length !== 6 + Number(material) + Number(parcel) || Object.keys(a).some(k => !['version', 'uid', 'requestId', 'context', 'command', 'preparedUri', ...(material ? ['materialCapability'] : []), ...(parcel ? ['parcelCapability'] : [])].includes(k)) ||
    parcel && (a.parcelCapability !== 'product_review_parcel_v1' || context.kind !== 'order') || material && (a.materialCapability !== 'product_review_material_v1' || context.kind !== 'order') || a.version !== 1 || a.uid !== uid ||
    typeof a.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(a.requestId) || !productReviewEqual(a.context, context) || !isProductReviewEvidenceCommand(a.command) ||
    !productReviewEqual(a.command.context, context) || a.preparedUri !== (await privateFile(uid, a.requestId, current)).uri) throw failure();
  current(); return a as unknown as ProductReviewEvidenceAttempt;
}
async function exact(a: ProductReviewEvidenceAttempt, current: () => void) {
  const saved = await pending(a.uid, a.context, current); if (!saved || !productReviewEqual(saved, a)) throw failure(); return saved;
}
async function bytes(a: ProductReviewEvidenceAttempt, current: () => void) {
  const file = await privateFile(a.uid, a.requestId, current); current(); if (a.preparedUri !== file.uri || !file.exists || file.size !== a.command.file.byteLength) throw failure();
  const result = await file.bytes(); current();
  if (result.length !== a.command.file.byteLength || await productReviewByteHash(result) !== a.command.file.sha256 ||
    !productReviewEqual(productReviewJpegDimensions(result), {width: a.command.file.width, height: a.command.file.height})) throw failure();
  current(); return result;
}
async function locked<T>(uid: string, context: ProductReviewContext, assertContext: () => void, task: (current: () => void) => Promise<T>) {
  const current = guard(uid, assertContext); if (!isProductReviewContext(context)) throw failure(); const key = slot(uid, context);
  if (locks.has(key)) throw failure(); locks.add(key); try {const result = await task(current); current(); return result;} finally {locks.delete(key);}
}
export const ProductReviewEvidenceJournal = {
  pending,
  /** Persist the prepared bytes' identity before any RPC. Only the local private URI and tuple enter AsyncStorage. */
  stage(uid: string, preview: ProductReviewEvidencePreview, typeDeclared: ProductReviewEvidenceType, uri: string, assertContext: () => void, material = false, parcel = false) {
    return locked(uid, preview.context, assertContext, async current => {
      if (material && preview.context.kind !== 'order' || preview.actorId !== uid || !PRODUCT_REVIEW_EVIDENCE_TYPES.includes(typeDeclared) || !preview.typesDeclared.includes(typeDeclared) ||
        typeof uri !== 'string' || !/^(file|content|blob):/.test(uri) || await pending(uid, preview.context, current)) throw failure();
      current(); const requestId = randomUUID(), destination = await privateFile(uid, requestId, current);
      try {
        current(); const compressedUri = await prepareImageForUpload(uri, {maxDimension: 1200, quality: 0.75}); current();
        const prepared = new File(compressedUri); current(); if (!prepared.exists || prepared.size < 1 || prepared.size > PRODUCT_REVIEW_EVIDENCE_LIMIT) throw failure();
        const originalBytes = await prepared.bytes(); current();
        const dimensions = productReviewJpegDimensions(originalBytes), sha256 = await productReviewByteHash(originalBytes); current();
        const command = {context: preview.context, contributionId: preview.contributionId, contributionHash: preview.contributionHash, sourceHash: preview.sourceHash,
          typeDeclared, file: {sha256, byteLength: originalBytes.length, contentType: 'image/jpeg' as const, ...dimensions, preparation: 'prepareImageForUpload' as const, qualityDeclared: 0.75 as const}};
        if (!isProductReviewEvidenceCommand(command)) throw failure();
        current(); destination.parentDirectory.create({idempotent: true, intermediates: true}); current(); if (destination.exists) throw failure();
        const attempt: ProductReviewEvidenceAttempt = {version: 1, uid, requestId, context: preview.context, command, preparedUri: destination.uri, ...(material ? {materialCapability: 'product_review_material_v1' as const} : {}), ...(parcel ? {parcelCapability: 'product_review_parcel_v1' as const} : {})};
        // Track the private destination before async copy: an interrupted copy remains bound to its original actor/intention.
        current(); await AsyncStorage.setItem(slot(uid, preview.context), JSON.stringify(attempt)); current(); await exact(attempt, current);
        current(); await prepared.copy(destination); current();
        // Remove only the generated compression output, never the selected original asset.
        if (prepared.uri !== uri && prepared.uri !== destination.uri) {current(); if (prepared.exists) prepared.delete(); current();}
        await bytes(attempt, current); current();
        return exact(attempt, current);
      } catch (error) {
        // No RPC has escaped. A missing/partial copy never permits replacing bytes under this saved tuple.
        throw error;
      }
    });
  },
  observe(a: ProductReviewEvidenceAttempt, assertContext: () => void) {
    return locked(a.uid, a.context, assertContext, async current => ProductReviewEvidenceService.command(await exact(a, current), 'observe', current));
  },
  /** The backend GETs the same object first; a bounded retry can only carry the prepared original bytes. */
  send(a: ProductReviewEvidenceAttempt, assertContext: () => void) {
    return locked(a.uid, a.context, assertContext, async current => {
      const saved = await exact(a, current), original = await bytes(saved, current);
      await ProductReviewEvidenceService.command(saved, 'execute', current, original); return ProductReviewEvidenceService.command(saved, 'observe', current);
    });
  },
  /** No bytes: qualify an escaped upload's exact object without requesting a new send. */
  reconcile(a: ProductReviewEvidenceAttempt, assertContext: () => void) {
    return locked(a.uid, a.context, assertContext, async current => {
      const saved = await exact(a, current); await ProductReviewEvidenceService.command(saved, 'execute', current); return ProductReviewEvidenceService.command(saved, 'observe', current);
    });
  },
  neutralize(a: ProductReviewEvidenceAttempt, assertContext: () => void) {
    return locked(a.uid, a.context, assertContext, async current => {
      const saved = await exact(a, current); await ProductReviewEvidenceService.command(saved, 'neutralize', current); return ProductReviewEvidenceService.command(saved, 'observe', current);
    });
  },
  acknowledge(a: ProductReviewEvidenceAttempt, assertContext: () => void) {
    return locked(a.uid, a.context, assertContext, async current => {
      const saved = await exact(a, current), receipt = await ProductReviewEvidenceService.command(saved, 'observe', current);
      if (!['received', 'stored_requires_review', 'not_executed'].includes(receipt.state) || receipt.state !== 'not_executed' && !receipt.storedNativeVerified) throw failure();
      await exact(saved, current); const file = await privateFile(saved.uid, saved.requestId, current); current();
      if (file.exists) file.delete(); current(); await AsyncStorage.removeItem(slot(saved.uid, saved.context)); current(); return receipt;
    });
  },
};
