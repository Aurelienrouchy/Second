/**
 * Article embedding triggers
 * Firebase Functions v7 - Generates Vertex AI multimodal embeddings
 * for visual search and similar product recommendations.
 *
 * Model: multimodalembedding@001 (1408-dimension vectors)
 * Collection: embeddings/{articleId}
 *
 * Uses GCS URI (gs://bucket/path) to pass images to Vertex AI,
 * which avoids base64 encoding issues with HEIC and other non-JPEG formats.
 */
import { isDeepStrictEqual } from 'node:util';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import * as logger from 'firebase-functions/logger';
import { db, storage, FieldValue } from '../config/firebase';
import { isOwnBucketImageUrl, parseFirebaseStorageUrl } from '../utils/storagePaths';
import { isIndexableArticle } from '../utils/search';
import { requireRuntimeProjectId } from '../config/runtimeEnvironment';

// Vertex AI configuration
const VERTEX_LOCATION = 'us-central1';
const EMBEDDING_MODEL = 'multimodalembedding@001';
const EMBEDDING_DIMENSIONS = 1408;
// Eventarc retries transient failures; acknowledge old events instead of looping
// for the platform's full retry window. A relevant later edit can repair a miss.
const MAX_RETRY_EVENT_AGE_MS = 15 * 60 * 1000;

function isTransientEmbeddingError(error: unknown): boolean {
  const code = (error as { code?: unknown; statusCode?: unknown } | null)?.code
    ?? (error as { statusCode?: unknown } | null)?.statusCode;
  return [4, 8, 10, 13, 14, 408, 429, 500, 502, 503, 504].includes(Number(code))
    || ['DEADLINE_EXCEEDED', 'RESOURCE_EXHAUSTED', 'ABORTED', 'INTERNAL', 'UNAVAILABLE',
      'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(code));
}

function retryWindowExpired(time: string): boolean {
  return Date.now() - Date.parse(time) > MAX_RETRY_EVENT_AGE_MS;
}

// Vertex AI client (singleton)
let vertexClient: PredictionServiceClient | null = null;

function getVertexClient(): PredictionServiceClient {
  if (!vertexClient) {
    vertexClient = new PredictionServiceClient({
      apiEndpoint: `${VERTEX_LOCATION}-aiplatform.googleapis.com`,
    });
  }
  return vertexClient;
}

/**
 * Price range helper for denormalized filtering
 */
function getPriceRange(price: number): 'low' | 'medium' | 'high' {
  if (price < 20) return 'low';
  if (price <= 100) return 'medium';
  return 'high';
}

/**
 * An embedding is searchable only for an article that is online AND not sold:
 * a sold article stayed active in the vector index, and « Articles
 * similaires » and photo search offered it again and again.
 */
function isEmbeddingActive(article: FirebaseFirestore.DocumentData): boolean {
  return isIndexableArticle(article);
}

/**
 * Build a GCS URI from a Firebase Storage URL.
 * Returns gs://bucket/path or null if URL is not a valid Firebase Storage URL.
 */
function buildGcsUri(imageUrl: string): string | null {
  // Only the project's bucket: the bucket name comes from a URL the seller
  // wrote, and it is read with the function's admin rights.
  if (!isOwnBucketImageUrl(imageUrl)) return null;
  const parsed = parseFirebaseStorageUrl(imageUrl);
  if (!parsed) return null;
  return `gs://${parsed.bucketName}/${parsed.filePath}`;
}

/**
 * Download image from Firebase Storage and return as base64 (fallback)
 * Used only when GCS URI approach fails.
 */
async function downloadImageAsBase64(imageUrl: string, authorize?: () => Promise<void>): Promise<string | null> {
  // An image outside the project's bucket is not embedded. The former HTTP
  // fallback fetched whatever URL the seller wrote: an arbitrary outbound
  // request from the function, with no allow-list and no size cap.
  if (!isOwnBucketImageUrl(imageUrl)) return null;
  const parsed = parseFirebaseStorageUrl(imageUrl);

  if (parsed) {
    try {
      if (authorize) await authorize();
      const bucket = storage.bucket(parsed.bucketName);
      const file = bucket.file(parsed.filePath);

      const [exists] = await file.exists();
      if (authorize) await authorize();
      if (!exists) {
        logger.error('[embeddings] File does not exist', { filePath: parsed.filePath });
        return null;
      }

      const [buffer] = await file.download();
      if (authorize) await authorize();
      return buffer.toString('base64');
    } catch (error) {
      // The optional maintenance authority is not a provider/media failure.
      // Its caller preserves and rethrows the original refusal below.
      if (authorize) await authorize();
      logger.error('[embeddings] Error downloading from Storage', { error });
      if (isTransientEmbeddingError(error)) throw error;
    }
  }

  return null;
}

/**
 * Generate multimodal image embedding using Vertex AI.
 * Accepts either a GCS URI or base64-encoded image data.
 * Returns a 1408-dimension vector from image pixels.
 */
export async function generateMultimodalEmbedding(
  imageInput: { gcsUri: string } | { bytesBase64Encoded: string }
): Promise<number[] | null> {
  try {
    const client = getVertexClient();
    const endpoint = `projects/${requireRuntimeProjectId()}/locations/${VERTEX_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}`;

    const instanceValue = helpers.toValue({
      image: imageInput,
    });

    if (!instanceValue) {
      logger.error('[embeddings] Failed to create instance value');
      return null;
    }

    const [response] = await client.predict({
      endpoint,
      instances: [instanceValue],
    });

    if (!response.predictions || response.predictions.length === 0) {
      logger.error('[embeddings] No predictions returned');
      return null;
    }

    const prediction = response.predictions[0];
    const values = prediction?.structValue?.fields?.imageEmbedding?.listValue?.values;

    if (!values || values.length === 0) {
      logger.error('[embeddings] No embedding values in response');
      return null;
    }

    const embedding = values.map((v: { numberValue?: number | null }) => v.numberValue ?? NaN);

    if (embedding.length !== EMBEDDING_DIMENSIONS || !embedding.every(Number.isFinite)) {
      logger.error('[embeddings] Invalid embedding vector', { got: embedding.length, expected: EMBEDDING_DIMENSIONS });
      return null;
    }

    return embedding;
  } catch (error) {
    logger.error('[embeddings] Vertex AI error', { error });
    if (isTransientEmbeddingError(error)) throw error;
    return null;
  }
}

/**
 * Generate an embedding for a currently public article in this project's
 * bucket. GCS is preferred, with a base64 fallback for supported media errors.
 */
export async function generateAndStoreEmbedding(
  articleId: string,
  article: FirebaseFirestore.DocumentData,
  authorize?: (tx?: FirebaseFirestore.Transaction) => Promise<void>,
): Promise<void> {
  let authorizationFailure: unknown;
  const qualify = async (tx?: FirebaseFirestore.Transaction) => {
    if (!authorize) return;
    try { await authorize(tx); } catch (error) { authorizationFailure = error; throw error; }
  };
  await qualify();
  const imageUrl = article.images?.[0]?.url;
  if (typeof imageUrl !== 'string' || !isOwnBucketImageUrl(imageUrl)) {
    logger.info('[embeddings] No admissible image for article, skipping', { articleId });
    return;
  }

  try {
    // Events can arrive late or twice. Never send an old/private photo to
    // Vertex, and reuse an already generated vector for this exact source.
    const needsEmbedding = await db.runTransaction(async tx => {
      await qualify(tx);
      const [currentSnap, existing] = await Promise.all([
        tx.get(db.collection('articles').doc(articleId)),
        tx.get(db.collection('embeddings').doc(articleId)),
      ]);
      const current = currentSnap.data();
      if (!current || !isEmbeddingActive(current)) {
        tx.delete(existing.ref);
        return false;
      }
      if (current.images?.[0]?.url !== imageUrl || current.sellerId !== article.sellerId) return false;
      if (existing.exists && existing.data()?.imageUrl === imageUrl && existing.data()?.embedding) {
        tx.update(existing.ref, { ...embeddingProjection(current), updatedAt: FieldValue.serverTimestamp() });
        return false;
      }
      return true;
    });
    if (!needsEmbedding) return;

    // Try GCS URI first (handles HEIC and all formats natively)
    const gcsUri = buildGcsUri(imageUrl);
    let embedding: number[] | null = null;

    if (gcsUri) {
      await qualify();
      logger.info('[embeddings] Generating embedding via GCS URI', { articleId, gcsUri });
      embedding = await generateMultimodalEmbedding({ gcsUri });
      await qualify();
    }

    // Fallback for a permanent GCS media-format error, not transient outages.
    if (!embedding) {
      logger.info('[embeddings] GCS URI failed or unavailable, falling back to base64', { articleId });
      await qualify();
      const imageBase64 = await downloadImageAsBase64(imageUrl, authorize ? () => qualify() : undefined);
      if (authorizationFailure) throw authorizationFailure;
      if (!imageBase64) {
        logger.error('[embeddings] Failed to download image', { articleId });
        return;
      }
      logger.info('[embeddings] Generating embedding via base64', { articleId, sizeKB: Math.round(imageBase64.length / 1024) });
      await qualify();
      embedding = await generateMultimodalEmbedding({ bytesBase64Encoded: imageBase64 });
      await qualify();
    }

    if (!embedding) {
      logger.error('[embeddings] Failed to generate embedding', { articleId });
      return;
    }

    // Store in embeddings collection
    const stored = await db.runTransaction(async tx => {
      await qualify(tx);
      const current = (await tx.get(db.collection('articles').doc(articleId))).data();
      const ref = db.collection('embeddings').doc(articleId);
      await qualify(tx);
      if (!current || !isEmbeddingActive(current)) {
        tx.delete(ref); return false;
      }
      if (current.images?.[0]?.url !== imageUrl || current.sellerId !== article.sellerId) return false;
      tx.set(ref, {
        articleId,
        embedding: FieldValue.vector(embedding!),
        imageUrl,
        categoryIds: current.categoryIds || (current.category ? [current.category] : []),
        brand: current.brand || null,
        priceRange: getPriceRange(current.price || 0),
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });

    if (stored) logger.info('[embeddings] Stored embedding', { articleId, dims: embedding.length });
  } catch (error) {
    if (error === authorizationFailure) throw error;
    logger.error('[embeddings] Error generating/storing embedding', { articleId, error });
    if (isTransientEmbeddingError(error)) throw error;
  }
}

/**
 * Ce que le document d'embedding retient de l'article. Tout le reste — le nom
 * du vendeur, sa photo, les compteurs — ne le concerne pas.
 */
function embeddingProjection(
  article: FirebaseFirestore.DocumentData
): Record<string, unknown> {
  return {
    imageUrl: article.images?.[0]?.url ?? null,
    categoryIds: article.categoryIds || (article.category ? [article.category] : []),
    brand: article.brand || null,
    priceRange: getPriceRange(article.price || 0),
    isActive: isEmbeddingActive(article),
  };
}

/**
 * Update denormalized metadata without regenerating embedding
 */
async function updateEmbeddingMetadata(
  articleId: string,
  article: FirebaseFirestore.DocumentData
): Promise<FirebaseFirestore.DocumentData | undefined> {
  const embeddingRef = db.collection('embeddings').doc(articleId);
  return db.runTransaction(async tx => {
    const [doc, articleSnap] = await Promise.all([tx.get(embeddingRef), tx.get(db.collection('articles').doc(articleId))]);
    const current = articleSnap.data();
    if (!current || !isEmbeddingActive(current)) { tx.delete(embeddingRef); return; }
    if (current.images?.[0]?.url !== article.images?.[0]?.url || current.sellerId !== article.sellerId) return;
    if (!doc.exists || doc.data()?.imageUrl !== current.images?.[0]?.url || !doc.data()?.embedding) {
      // Only reached for a meaningful photo/index metadata/visibility edit.
      // Views and profile changes are filtered before this transaction.
      return current;
    }
    tx.update(embeddingRef, {
      ...embeddingProjection(current),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return;
  });
}

async function processEmbeddingEvent(time: string, articleId: string, work: () => Promise<void>): Promise<void> {
  if (retryWindowExpired(time)) {
    logger.error('[embeddings] Retry window expired; repair on a relevant edit or targeted backfill', { articleId });
    return;
  }
  try { await work(); } catch (error) {
    if (isTransientEmbeddingError(error)) throw error;
    logger.error('[embeddings] Permanent indexing failure; not retrying event', { articleId, error });
  }
}

/**
 * Generate embedding when article is created
 */
export const generateEmbeddingOnCreate = onDocumentCreated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120, retry: true },
  async (event) => {
    const articleId = event.params.articleId;
    const article = event.data?.data();

    if (!article) return;

    if (!isEmbeddingActive(article)) {
      logger.info('[embeddings] Non-public new article, skipping', { articleId });
      return;
    }

    // Only process active articles with images
    if (!article.images?.[0]?.url) {
      logger.info('[embeddings] No image for new article, skipping', { articleId });
      return;
    }

    await processEmbeddingEvent(event.time, articleId, () => generateAndStoreEmbedding(articleId, article));
  }
);

/**
 * Update embedding when article is updated
 */
export const generateEmbeddingOnUpdate = onDocumentUpdated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120, retry: true },
  async (event) => {
    const articleId = event.params.articleId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!after) return;

    // Changer sa photo de profil réécrit tous les articles du vendeur : sans
    // cette garde, chaque article coûtait une lecture et une écriture
    // d'embedding pour des champs qui n'avaient pas bougé.
    if (before && isDeepStrictEqual(embeddingProjection(before), embeddingProjection(after))) {
      return;
    }

    await processEmbeddingEvent(event.time, articleId, async () => {
      const missingSource = await updateEmbeddingMetadata(articleId, after);
      if (missingSource) await generateAndStoreEmbedding(articleId, missingSource);
    });
  }
);
