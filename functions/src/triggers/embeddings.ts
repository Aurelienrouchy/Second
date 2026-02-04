/**
 * Article embedding triggers
 * Firebase Functions v7 - Generates Vertex AI multimodal embeddings
 * for visual search and similar product recommendations.
 *
 * Model: multimodalembedding@001 (1408-dimension vectors)
 * Collection: embeddings/{articleId}
 */
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
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
function parseFirebaseStorageUrl(url: string): { bucketName: string; filePath: string } | null {
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
 * Download image from Firebase Storage and return as base64
 */
async function downloadImageAsBase64(imageUrl: string): Promise<string | null> {
  // Try Firebase Storage URL first
  const parsed = parseFirebaseStorageUrl(imageUrl);

  if (parsed) {
    try {
      const bucket = storage.bucket(parsed.bucketName);
      const file = bucket.file(parsed.filePath);

      const [exists] = await file.exists();
      if (!exists) {
        console.error(`[embeddings] File does not exist: ${parsed.filePath}`);
        return null;
      }

      const [buffer] = await file.download();
      return buffer.toString('base64');
    } catch (error) {
      console.error('[embeddings] Error downloading from Storage:', error);
    }
  }

  // Fallback: HTTP fetch
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(`[embeddings] HTTP download failed: ${response.status}`);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
  } catch (error) {
    console.error('[embeddings] Error downloading via HTTP:', error);
    return null;
  }
}

/**
 * Generate multimodal image embedding using Vertex AI
 * Returns a 1408-dimension vector from image pixels
 */
async function generateMultimodalEmbedding(imageBase64: string): Promise<number[] | null> {
  try {
    const client = getVertexClient();
    const endpoint = `projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}`;

    const instanceValue = helpers.toValue({
      image: { bytesBase64Encoded: imageBase64 },
    });

    if (!instanceValue) {
      console.error('[embeddings] Failed to create instance value');
      return null;
    }

    const [response] = await client.predict({
      endpoint,
      instances: [instanceValue],
    });

    if (!response.predictions || response.predictions.length === 0) {
      console.error('[embeddings] No predictions returned');
      return null;
    }

    const prediction = response.predictions[0];
    const values = prediction?.structValue?.fields?.imageEmbedding?.listValue?.values;

    if (!values || values.length === 0) {
      console.error('[embeddings] No embedding values in response');
      return null;
    }

    const embedding = values.map((v: { numberValue?: number | null }) => v.numberValue || 0);

    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      console.warn(`[embeddings] Unexpected dimension: ${embedding.length}, expected ${EMBEDDING_DIMENSIONS}`);
    }

    return embedding;
  } catch (error) {
    console.error('[embeddings] Vertex AI error:', error);
    return null;
  }
}

/**
 * Generate embedding and store in embeddings collection
 */
async function generateAndStoreEmbedding(
  articleId: string,
  article: FirebaseFirestore.DocumentData
): Promise<void> {
  const imageUrl = article.images?.[0]?.url;
  if (!imageUrl) {
    console.log(`[embeddings] No image for article ${articleId}, skipping`);
    return;
  }

  try {
    // Download image
    const imageBase64 = await downloadImageAsBase64(imageUrl);
    if (!imageBase64) {
      console.error(`[embeddings] Failed to download image for ${articleId}`);
      return;
    }

    console.log(`[embeddings] Generating embedding for ${articleId} (${Math.round(imageBase64.length / 1024)}KB)`);

    // Generate embedding via Vertex AI
    const embedding = await generateMultimodalEmbedding(imageBase64);
    if (!embedding) {
      console.error(`[embeddings] Failed to generate embedding for ${articleId}`);
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

    console.log(`[embeddings] Stored embedding for ${articleId} (${embedding.length} dims)`);
  } catch (error) {
    console.error(`[embeddings] Error for ${articleId}:`, error);
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

  console.log(`[embeddings] Updated metadata for ${articleId}`);
}

/**
 * Generate embedding when article is created
 */
export const generateEmbeddingOnCreate = onDocumentCreated(
  { document: 'articles/{articleId}', memory: '512MiB', timeoutSeconds: 120 },
  async (event) => {
    const articleId = event.params.articleId;
    const article = event.data?.data();

    if (!article) return;

    // Only process active articles with images
    if (!article.images?.[0]?.url) {
      console.log(`[embeddings] No image for new article ${articleId}, skipping`);
      return;
    }

    await generateAndStoreEmbedding(articleId, article);
  }
);

/**
 * Update embedding when article is updated
 */
export const generateEmbeddingOnUpdate = onDocumentUpdated(
  { document: 'articles/{articleId}', memory: '512MiB', timeoutSeconds: 120 },
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
        console.log(`[embeddings] Deactivated embedding for ${articleId}`);
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
