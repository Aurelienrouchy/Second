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
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import * as logger from 'firebase-functions/logger';
import { db, storage, FieldValue } from '../config/firebase';

// Vertex AI configuration
const VERTEX_PROJECT = process.env.GCLOUD_PROJECT || 'seconde-b47a6';
const VERTEX_LOCATION = 'us-central1';
const EMBEDDING_MODEL = 'multimodalembedding@001';
const EMBEDDING_DIMENSIONS = 1408;

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
 * Parse Firebase Storage URL and extract bucket and path
 */
export function parseFirebaseStorageUrl(url: string): { bucketName: string; filePath: string } | null {
  const match = url.match(
    /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/
  );
  if (match) {
    const [, bucketName, encodedPath] = match;
    const filePath = decodeURIComponent(encodedPath);
    return { bucketName, filePath };
  }
  return null;
}

/**
 * Build a GCS URI from a Firebase Storage URL.
 * Returns gs://bucket/path or null if URL is not a valid Firebase Storage URL.
 */
function buildGcsUri(imageUrl: string): string | null {
  const parsed = parseFirebaseStorageUrl(imageUrl);
  if (!parsed) return null;
  return `gs://${parsed.bucketName}/${parsed.filePath}`;
}

/**
 * Download image from Firebase Storage and return as base64 (fallback)
 * Used only when GCS URI approach fails.
 */
async function downloadImageAsBase64(imageUrl: string): Promise<string | null> {
  const parsed = parseFirebaseStorageUrl(imageUrl);

  if (parsed) {
    try {
      const bucket = storage.bucket(parsed.bucketName);
      const file = bucket.file(parsed.filePath);

      const [exists] = await file.exists();
      if (!exists) {
        logger.error('[embeddings] File does not exist', { filePath: parsed.filePath });
        return null;
      }

      const [buffer] = await file.download();
      return buffer.toString('base64');
    } catch (error) {
      logger.error('[embeddings] Error downloading from Storage', { error });
    }
  }

  // Fallback: HTTP fetch
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      logger.error('[embeddings] HTTP download failed', { status: response.status });
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  } catch (error) {
    logger.error('[embeddings] Error downloading via HTTP', { error });
    return null;
  }
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
    const endpoint = `projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}`;

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

    const embedding = values.map((v: { numberValue?: number | null }) => v.numberValue || 0);

    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      logger.warn('[embeddings] Unexpected dimension', { got: embedding.length, expected: EMBEDDING_DIMENSIONS });
    }

    return embedding;
  } catch (error) {
    logger.error('[embeddings] Vertex AI error', { error });
    return null;
  }
}

/**
 * Generate embedding and store in embeddings collection.
 * Uses GCS URI (preferred) with base64 fallback for non-Storage URLs.
 */
export async function generateAndStoreEmbedding(
  articleId: string,
  article: FirebaseFirestore.DocumentData
): Promise<void> {
  const imageUrl = article.images?.[0]?.url;
  if (!imageUrl) {
    logger.info('[embeddings] No image for article, skipping', { articleId });
    return;
  }

  try {
    // Try GCS URI first (handles HEIC and all formats natively)
    const gcsUri = buildGcsUri(imageUrl);
    let embedding: number[] | null = null;

    if (gcsUri) {
      logger.info('[embeddings] Generating embedding via GCS URI', { articleId, gcsUri });
      embedding = await generateMultimodalEmbedding({ gcsUri });
    }

    // Fallback to base64 if GCS URI failed or URL is not a Storage URL
    if (!embedding) {
      logger.info('[embeddings] GCS URI failed or unavailable, falling back to base64', { articleId });
      const imageBase64 = await downloadImageAsBase64(imageUrl);
      if (!imageBase64) {
        logger.error('[embeddings] Failed to download image', { articleId });
        return;
      }
      logger.info('[embeddings] Generating embedding via base64', { articleId, sizeKB: Math.round(imageBase64.length / 1024) });
      embedding = await generateMultimodalEmbedding({ bytesBase64Encoded: imageBase64 });
    }

    if (!embedding) {
      logger.error('[embeddings] Failed to generate embedding', { articleId });
      return;
    }

    // Store in embeddings collection
    await db.collection('embeddings').doc(articleId).set({
      articleId,
      embedding: FieldValue.vector(embedding),
      imageUrl,
      categoryIds: article.categoryIds || (article.category ? [article.category] : []),
      brand: article.brand || null,
      priceRange: getPriceRange(article.price || 0),
      isActive: article.isActive ?? true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    logger.info('[embeddings] Stored embedding', { articleId, dims: embedding.length });
  } catch (error) {
    logger.error('[embeddings] Error generating/storing embedding', { articleId, error });
  }
}

/**
 * Update denormalized metadata without regenerating embedding
 */
async function updateEmbeddingMetadata(
  articleId: string,
  article: FirebaseFirestore.DocumentData
): Promise<void> {
  const embeddingRef = db.collection('embeddings').doc(articleId);
  const doc = await embeddingRef.get();

  if (!doc.exists) {
    // No embedding yet, generate one
    await generateAndStoreEmbedding(articleId, article);
    return;
  }

  await embeddingRef.update({
    categoryIds: article.categoryIds || (article.category ? [article.category] : []),
    brand: article.brand || null,
    priceRange: getPriceRange(article.price || 0),
    isActive: article.isActive ?? true,
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info('[embeddings] Updated metadata', { articleId });
}

/**
 * Generate embedding when article is created
 */
export const generateEmbeddingOnCreate = onDocumentCreated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120 },
  async (event) => {
    const articleId = event.params.articleId;
    const article = event.data?.data();

    if (!article) return;

    // Only process active articles with images
    if (!article.images?.[0]?.url) {
      logger.info('[embeddings] No image for new article, skipping', { articleId });
      return;
    }

    await generateAndStoreEmbedding(articleId, article);
  }
);

/**
 * Update embedding when article is updated
 */
export const generateEmbeddingOnUpdate = onDocumentUpdated(
  { document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120 },
  async (event) => {
    const articleId = event.params.articleId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!after) return;

    // If article was deactivated, update isActive flag
    if (before?.isActive && !after.isActive) {
      const embeddingRef = db.collection('embeddings').doc(articleId);
      const doc = await embeddingRef.get();
      if (doc.exists) {
        await embeddingRef.update({ isActive: false, updatedAt: FieldValue.serverTimestamp() });
        logger.info('[embeddings] Deactivated embedding', { articleId });
      }
      return;
    }

    // Check if main image changed
    const beforeImage = before?.images?.[0]?.url;
    const afterImage = after.images?.[0]?.url;

    if (beforeImage !== afterImage && afterImage) {
      // Image changed: regenerate embedding
      await generateAndStoreEmbedding(articleId, after);
    } else {
      // Only metadata changed: update denormalized fields
      await updateEmbeddingMetadata(articleId, after);
    }
  }
);
