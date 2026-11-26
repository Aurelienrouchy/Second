/**
 * Visual Search & Similar Products callable functions
 * Firebase Functions v7 - using onCall
 *
 * - visualSearch: Search by image using Vertex AI multimodal embeddings
 * - getSimilarProducts: Find similar articles by articleId embedding
 * - backfillEmbeddings: Admin-only batch generation of missing embeddings
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';
import { PredictionServiceClient, helpers } from '@google-cloud/aiplatform';
import { db, FieldValue } from '../config/firebase';
import { checkRateLimit, resolveCallerKey } from '../utils/rateLimit';
import { generateAndStoreEmbedding } from '../triggers/embeddings';
import {assertPrivateAccountSession,withPrivateAccountSession} from '../utils/privateAccountSession';
import { isIndexableArticle } from '../utils/search';
import { requireRuntimeProjectId } from '../config/runtimeEnvironment';

// Vertex AI configuration (same as triggers/embeddings.ts)
const VERTEX_LOCATION = 'us-central1';
const EMBEDDING_MODEL = 'multimodalembedding@001';

// Minimum similarity thresholds (cosine distance)
// Cosine distance: 0 = identical, 1 = orthogonal, 2 = opposite
// similarity% = (1 - distance) * 100
const VISUAL_SEARCH_MAX_DISTANCE = 0.55;   // ~45% min similarity
const SIMILAR_PRODUCTS_MAX_DISTANCE = 0.60; // ~40% min similarity (more lenient)

// Rate limiting: protect Vertex AI from abuse
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_AUTHENTICATED = 20;     // 20 req/min for authenticated users
const RATE_LIMIT_UNAUTHENTICATED = 5;    // 5 req/min for unauthenticated users

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
 * Generate image embedding from base64 for search queries
 */
async function generateQueryEmbedding(imageBase64: string): Promise<number[] | null> {
  try {
    const client = getVertexClient();
    const endpoint = `projects/${requireRuntimeProjectId()}/locations/${VERTEX_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}`;

    const instanceValue = helpers.toValue({
      image: { bytesBase64Encoded: imageBase64 },
    });

    if (!instanceValue) return null;

    const [response] = await client.predict({
      endpoint,
      instances: [instanceValue],
    });

    if (!response.predictions || response.predictions.length === 0) return null;

    const prediction = response.predictions[0];
    const values = prediction?.structValue?.fields?.imageEmbedding?.listValue?.values;

    if (!values || values.length === 0) return null;

    return values.map((v: { numberValue?: number | null }) => v.numberValue || 0);
  } catch (error) {
    logger.error('[visualSearch] Embedding generation error', { error });
    return null;
  }
}

/**
 * Visual Search - Search for similar products using an image
 *
 * Input: base64 image + optional filters
 * Output: ranked list of similar articles with similarity scores
 */
export const visualSearch = onCall(
  {
    region: 'northamerica-northeast1',
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async (request) => {
    // Rate limiting: protect Vertex AI from abuse
    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'visualSearch',
      maxCallsAuthenticated: RATE_LIMIT_AUTHENTICATED,
      maxCallsUnauthenticated: RATE_LIMIT_UNAUTHENTICATED,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { imageBase64, filters, limit = 20 } = request.data;

    if (!imageBase64) {
      throw new HttpsError('invalid-argument', 'Image is required');
    }

    const startTime = Date.now();

    // 1. Generate embedding for the search image
    logger.info('[visualSearch] Generating query embedding...');
    const queryEmbedding = await generateQueryEmbedding(imageBase64);

    if (!queryEmbedding) {
      throw new HttpsError('internal', 'Failed to generate image embedding');
    }

    const embeddingTime = Date.now() - startTime;
    logger.info('[visualSearch] Embedding generated', { embeddingTime, dims: queryEmbedding.length });

    // 2. Build Firestore query with filters
    let baseQuery: FirebaseFirestore.Query = db.collection('embeddings')
      .where('isActive', '==', true);

    if (filters?.categoryIds?.length) {
      baseQuery = baseQuery.where('categoryIds', 'array-contains-any', filters.categoryIds);
    }
    if (filters?.priceRange) {
      baseQuery = baseQuery.where('priceRange', '==', filters.priceRange);
    }

    // 3. Vector similarity search
    const vectorQuery = baseQuery.findNearest({
      vectorField: 'embedding',
      queryVector: FieldValue.vector(queryEmbedding),
      limit: Math.min(limit + 1, 50), // +1 to filter out self if needed
      distanceMeasure: 'COSINE',
      // Materialize the computed distance so doc.get('vector_distance') is real.
      // Without this the field is never written and similarity is always 100%.
      // Names wrapped in double underscores (e.g. __distance__) are reserved by
      // Firestore and rejected with INVALID_ARGUMENT.
      distanceResultField: 'vector_distance',
    });

    let snapshot: Awaited<ReturnType<typeof vectorQuery.get>>;
    try {
      snapshot = await vectorQuery.get();
    } catch (error) {
      logger.error('[visualSearch] Vector query failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpsError('internal', 'Vector similarity search failed');
    }

    const queryTime = Date.now() - startTime - embeddingTime;
    logger.info('[visualSearch] Vector query returned results', { resultCount: snapshot.docs.length, queryTime });

    // 4. Fetch full article data
    const articleIds = snapshot.docs
      .filter(doc => doc.id !== filters?.excludeArticleId)
      .slice(0, limit)
      .map(doc => doc.id);

    if (articleIds.length === 0) {
      return { results: [], queryEmbeddingGenerated: true };
    }

    // Batch fetch articles (Firestore 'in' supports max 30)
    const batches = [];
    for (let i = 0; i < articleIds.length; i += 30) {
      const batch = articleIds.slice(i, i + 30);
      batches.push(
        db.collection('articles')
          .where('__name__', 'in', batch)
          .get()
      );
    }

    const batchResults = await Promise.all(batches);
    const articlesMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const batchSnapshot of batchResults) {
      for (const doc of batchSnapshot.docs) {
        articlesMap.set(doc.id, doc.data());
      }
    }

    // 5. Build results with similarity scores
    const results: Array<{
      articleId: string;
      similarity: number;
      title: string;
      price: number;
      imageUrl: string;
      brand?: string;
      size?: string;
      condition: string;
    }> = [];

    for (const doc of snapshot.docs) {
      if (doc.id === filters?.excludeArticleId) continue;
      if (results.length >= limit) break;

      const article = articlesMap.get(doc.id);
      if (!article) continue;

      // The projection is asynchronous: always recheck current public visibility.
      if (!isIndexableArticle(article) || doc.data().imageUrl !== article.images?.[0]?.url) continue;

      // Cosine distance to similarity percentage (1 - distance) * 100
      const distance = doc.get('vector_distance') || 0;

      // Skip results below similarity threshold
      if (distance > VISUAL_SEARCH_MAX_DISTANCE) {
        logger.info('[visualSearch] Skipping result below threshold', { docId: doc.id, distance: distance.toFixed(3) });
        continue;
      }

      const similarity = Math.round((1 - distance) * 100);

      results.push({
        articleId: doc.id,
        similarity,
        title: article.title,
        price: article.price,
        imageUrl: article.images?.[0]?.url,
        brand: article.brand || null,
        // article.size is now an ArticleSize object { value, system };
        // the DTO exposes a plain string to the client.
        size: article.size?.value ?? null,
        condition: article.condition,
      });
    }

    const totalTime = Date.now() - startTime;
    logger.info('[visualSearch] Complete', { resultCount: results.length, totalTime });

    return { results };
  }
);

/**
 * Get Similar Products - Find articles similar to a given article
 *
 * Uses the article's stored embedding to find visually similar items.
 * Falls back gracefully if no embedding exists.
 */
export const getSimilarProducts = onCall(
  { region: 'northamerica-northeast1', invoker: 'public', timeoutSeconds: 30, memory: '512MiB' },
  async (request) => {
    // Rate limiting: protect Vertex AI from abuse
    const { callerKey, isAuthenticated } = resolveCallerKey(request);
    await checkRateLimit(callerKey, isAuthenticated, {
      functionName: 'getSimilarProducts',
      maxCallsAuthenticated: RATE_LIMIT_AUTHENTICATED,
      maxCallsUnauthenticated: RATE_LIMIT_UNAUTHENTICATED,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    const { articleId, limit = 10, includeScore = false } = request.data;

    if (!articleId) {
      throw new HttpsError('invalid-argument', 'articleId is required');
    }

    // 1. Get source article embedding
    const [embeddingDoc, sourceArticle] = await Promise.all([
      db.collection('embeddings').doc(articleId).get(),
      db.collection('articles').doc(articleId).get(),
    ]);

    if (!embeddingDoc.exists || !sourceArticle.exists || !isIndexableArticle(sourceArticle.data()!)) {
      // No embedding yet, return empty with fallback flag
      return { results: [], fallback: true };
    }

    const embeddingData = embeddingDoc.data()!;
    const sourceEmbedding = embeddingData.embedding;

    if (!sourceEmbedding || embeddingData.imageUrl !== sourceArticle.data()!.images?.[0]?.url) {
      return { results: [], fallback: true };
    }

    // 2. Vector similarity search
    const vectorQuery = db.collection('embeddings')
      .where('isActive', '==', true)
      .findNearest({
        vectorField: 'embedding',
        queryVector: sourceEmbedding,
        limit: limit + 1, // +1 to exclude self
        distanceMeasure: 'COSINE',
        // Materialize the computed distance so doc.get('vector_distance') is real.
        // Without this the field is never written and similarity is always 100%.
        // Names wrapped in double underscores (e.g. __distance__) are reserved by
        // Firestore and rejected with INVALID_ARGUMENT.
        distanceResultField: 'vector_distance',
      });

    let snapshot: Awaited<ReturnType<typeof vectorQuery.get>>;
    try {
      snapshot = await vectorQuery.get();
    } catch (error) {
      logger.error('[getSimilarProducts] Vector query failed', {
        articleId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpsError('internal', 'Vector similarity search failed');
    }

    // 3. Fetch articles
    const articleIds = snapshot.docs
      .filter(doc => doc.id !== articleId)
      .slice(0, limit)
      .map(doc => doc.id);

    if (articleIds.length === 0) {
      return { results: [] };
    }

    // Batch fetch articles
    const batches = [];
    for (let i = 0; i < articleIds.length; i += 30) {
      const batch = articleIds.slice(i, i + 30);
      batches.push(
        db.collection('articles')
          .where('__name__', 'in', batch)
          .get()
      );
    }

    const batchResults = await Promise.all(batches);
    const articlesMap = new Map<string, FirebaseFirestore.DocumentData>();
    for (const batchSnapshot of batchResults) {
      for (const doc of batchSnapshot.docs) {
        articlesMap.set(doc.id, doc.data());
      }
    }

    // 4. Build results
    const results: Array<{
      articleId: string;
      similarity?: number;
      title: string;
      price: number;
      imageUrl: string;
      brand?: string;
      size?: string;
      condition: string;
    }> = [];

    for (const doc of snapshot.docs) {
      if (doc.id === articleId) continue;
      if (results.length >= limit) break;

      const article = articlesMap.get(doc.id);
      if (!article) continue;

      if (!isIndexableArticle(article) || doc.data().imageUrl !== article.images?.[0]?.url) continue;

      const distance = doc.get('vector_distance') || 0;

      // Skip results below similarity threshold
      if (distance > SIMILAR_PRODUCTS_MAX_DISTANCE) break; // results are ordered, so no need to continue

      const result: {
        articleId: string;
        similarity?: number;
        title: string;
        price: number;
        imageUrl: string;
        brand?: string;
        size?: string;
        condition: string;
      } = {
        articleId: doc.id,
        title: article.title,
        price: article.price,
        imageUrl: article.images?.[0]?.url,
        brand: article.brand || null,
        // article.size is now an ArticleSize object { value, system };
        // the DTO exposes a plain string to the client.
        size: article.size?.value ?? null,
        condition: article.condition,
      };

      if (includeScore) {
        result.similarity = Math.round((1 - distance) * 100);
      }

      results.push(result);
    }

    logger.info('[getSimilarProducts] Complete', { resultCount: results.length, articleId });

    return { results };
  }
);

// ============================================================
// BACKFILL EMBEDDINGS (Admin-only)
// ============================================================

// Delay between Vertex AI calls to respect quotas (600 req/min for multimodal)
const BACKFILL_DELAY_MS = 200;
// Max articles per invocation to avoid Cloud Function timeout
const BACKFILL_BATCH_SIZE = 200;

/**
 * Sleep helper for rate limiting between Vertex AI calls
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backfill Embeddings - Generate embeddings for articles that don't have one yet.
 *
 * Admin-only callable. Processes up to BACKFILL_BATCH_SIZE articles per invocation.
 * Uses GCS URI via the shared generateAndStoreEmbedding function.
 *
 * Input: { batchSize?: number } (optional, defaults to BACKFILL_BATCH_SIZE)
 * Output: { processed: number, succeeded: number, failed: number, errors: Array<{ articleId, error }> }
 */
export const backfillEmbeddings = onCall(
  {
    region: 'northamerica-northeast1',
    timeoutSeconds: 540, // 9 minutes max (Cloud Functions v2 limit is 540s for callable)
    memory: '1GiB',
  },
  async (request) => withPrivateAccountSession(request, async () => {
    // Auth check: must be authenticated
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    // Admin check: verify custom claim or isAdmin field in Firestore
    const uid = request.auth.uid;
    const admit = async (tx?: FirebaseFirestore.Transaction): Promise<void> => {
      if (!tx) return db.runTransaction(current => admit(current));
      const session = await assertPrivateAccountSession(request,tx);
      const admin = (await tx.get(db.collection('users').doc(uid))).data();
      if (admin?.isActive === false || !session.currentAdminClaim && admin?.isAdmin !== true)
        throw new HttpsError('permission-denied','Admin access required');
    };
    await admit();

    const batchSize = Math.min(
      Math.max(request.data?.batchSize || BACKFILL_BATCH_SIZE, 1),
      BACKFILL_BATCH_SIZE
    );

    logger.info('[backfillEmbeddings] Starting backfill', { uid, batchSize });

    // 1. Get all active, unsold articles
    const articlesSnapshot = await db.collection('articles')
      .where('isActive', '==', true)
      .where('isSold', '==', false)
      .select('images', 'categoryIds', 'category', 'brand', 'price', 'isActive', 'isSold',
        'moderationStatus', 'privacyWithdrawal', 'sellerId')
      .get();
    await admit();

    if (articlesSnapshot.empty) {
      logger.info('[backfillEmbeddings] No active articles found');
      return { processed: 0, succeeded: 0, failed: 0, errors: [] };
    }

    logger.info('[backfillEmbeddings] Found active articles', { total: articlesSnapshot.size });

    // 2. Get all existing embeddings to find which articles are missing
    const existingEmbeddingIds = new Set<string>();
    const embeddingsSnapshot = await db.collection('embeddings')
      .select() // only need doc IDs, no fields
      .get();
    await admit();

    for (const doc of embeddingsSnapshot.docs) {
      existingEmbeddingIds.add(doc.id);
    }

    logger.info('[backfillEmbeddings] Existing embeddings count', { count: existingEmbeddingIds.size });

    // 3. Filter to articles missing embeddings
    const missingArticles: Array<{ id: string; data: FirebaseFirestore.DocumentData }> = [];
    for (const doc of articlesSnapshot.docs) {
      if (!existingEmbeddingIds.has(doc.id)) {
        const data = doc.data();
        // Only include articles with at least one image
        if (isIndexableArticle(data) && data.images?.[0]?.url) {
          missingArticles.push({ id: doc.id, data });
        }
      }
    }

    logger.info('[backfillEmbeddings] Articles missing embeddings', { count: missingArticles.length });

    if (missingArticles.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0, errors: [], message: 'All articles already have embeddings' };
    }

    // 4. Process in batches with rate limiting
    const toProcess = missingArticles.slice(0, batchSize);
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ articleId: string; error: string }> = [];

    for (let i = 0; i < toProcess.length; i++) {
      const { id, data } = toProcess[i];
      let authorizationFailure: unknown;
      const authorize = async (tx?: FirebaseFirestore.Transaction): Promise<void> => {
        if (!tx) return db.runTransaction(current => authorize(current));
        try {
          await admit(tx);
          const current = (await tx.get(db.collection('articles').doc(id))).data();
          if (!current || !isIndexableArticle(current) ||
              current.sellerId !== data.sellerId || current.images?.[0]?.url !== data.images?.[0]?.url)
            throw new HttpsError('failed-precondition','La source de cet article a changé. Relancez le rattrapage après vérification.');
        } catch (error) {authorizationFailure=error;throw error;}
      };

      try {
        await authorize();
        await generateAndStoreEmbedding(id, data, authorize);

        // Verify the embedding was actually stored
        await authorize();
        const embDoc = await db.collection('embeddings').doc(id).get();
        await authorize();
        if (embDoc.exists) {
          succeeded++;
        } else {
          failed++;
          errors.push({ articleId: id, error: 'Embedding generation returned no error but doc was not stored' });
        }
      } catch (error) {
        if (error === authorizationFailure) throw error;
        await admit();
        failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({ articleId: id, error: errorMessage });
        logger.error('[backfillEmbeddings] Error processing article', { articleId: id, error: errorMessage });
      }

      // Rate limit: wait between calls (skip after last item)
      if (i < toProcess.length - 1) {
        await sleep(BACKFILL_DELAY_MS);
      }
    }

    const result = {
      processed: toProcess.length,
      succeeded,
      failed,
      remaining: missingArticles.length - toProcess.length,
      errors: errors.slice(0, 50), // Cap error list to avoid huge responses
    };
    await admit();

    logger.info('[backfillEmbeddings] Backfill complete', result);

    return result;
  })
);
