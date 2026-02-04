"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSimilarProducts = exports.visualSearch = void 0;
/**
 * Visual Search & Similar Products callable functions
 * Firebase Functions v7 - using onCall
 *
 * - visualSearch: Search by image using Vertex AI multimodal embeddings
 * - getSimilarProducts: Find similar articles by articleId embedding
 */
const https_1 = require("firebase-functions/v2/https");
const aiplatform_1 = require("@google-cloud/aiplatform");
const firebase_1 = require("../config/firebase");
// Vertex AI configuration (same as triggers/embeddings.ts)
const VERTEX_PROJECT = process.env.GCLOUD_PROJECT || 'seconde-b47a6';
const VERTEX_LOCATION = 'us-central1';
const EMBEDDING_MODEL = 'multimodalembedding@001';
// Minimum similarity thresholds (cosine distance)
// Cosine distance: 0 = identical, 1 = orthogonal, 2 = opposite
// similarity% = (1 - distance) * 100
const VISUAL_SEARCH_MAX_DISTANCE = 0.55; // ~45% min similarity
const SIMILAR_PRODUCTS_MAX_DISTANCE = 0.60; // ~40% min similarity (more lenient)
// Vertex AI client (singleton)
let vertexClient = null;
function getVertexClient() {
    if (!vertexClient) {
        vertexClient = new aiplatform_1.PredictionServiceClient({
            apiEndpoint: `${VERTEX_LOCATION}-aiplatform.googleapis.com`,
        });
    }
    return vertexClient;
}
/**
 * Generate image embedding from base64 for search queries
 */
async function generateQueryEmbedding(imageBase64) {
    var _a, _b, _c, _d;
    try {
        const client = getVertexClient();
        const endpoint = `projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}`;
        const instanceValue = aiplatform_1.helpers.toValue({
            image: { bytesBase64Encoded: imageBase64 },
        });
        if (!instanceValue)
            return null;
        const [response] = await client.predict({
            endpoint,
            instances: [instanceValue],
        });
        if (!response.predictions || response.predictions.length === 0)
            return null;
        const prediction = response.predictions[0];
        const values = (_d = (_c = (_b = (_a = prediction === null || prediction === void 0 ? void 0 : prediction.structValue) === null || _a === void 0 ? void 0 : _a.fields) === null || _b === void 0 ? void 0 : _b.imageEmbedding) === null || _c === void 0 ? void 0 : _c.listValue) === null || _d === void 0 ? void 0 : _d.values;
        if (!values || values.length === 0)
            return null;
        return values.map((v) => v.numberValue || 0);
    }
    catch (error) {
        console.error('[visualSearch] Embedding generation error:', error);
        return null;
    }
}
/**
 * Visual Search - Search for similar products using an image
 *
 * Input: base64 image + optional filters
 * Output: ranked list of similar articles with similarity scores
 */
exports.visualSearch = (0, https_1.onCall)({
    invoker: 'public',
    timeoutSeconds: 60,
    memory: '512MiB',
}, async (request) => {
    var _a, _b, _c;
    const { imageBase64, filters, limit = 20 } = request.data;
    if (!imageBase64) {
        throw new https_1.HttpsError('invalid-argument', 'Image is required');
    }
    const startTime = Date.now();
    // 1. Generate embedding for the search image
    console.log('[visualSearch] Generating query embedding...');
    const queryEmbedding = await generateQueryEmbedding(imageBase64);
    if (!queryEmbedding) {
        throw new https_1.HttpsError('internal', 'Failed to generate image embedding');
    }
    const embeddingTime = Date.now() - startTime;
    console.log(`[visualSearch] Embedding generated in ${embeddingTime}ms (${queryEmbedding.length} dims)`);
    // 2. Build Firestore query with filters
    let baseQuery = firebase_1.db.collection('embeddings')
        .where('isActive', '==', true);
    if ((_a = filters === null || filters === void 0 ? void 0 : filters.categoryIds) === null || _a === void 0 ? void 0 : _a.length) {
        baseQuery = baseQuery.where('categoryIds', 'array-contains-any', filters.categoryIds);
    }
    if (filters === null || filters === void 0 ? void 0 : filters.priceRange) {
        baseQuery = baseQuery.where('priceRange', '==', filters.priceRange);
    }
    // 3. Vector similarity search
    const vectorQuery = baseQuery.findNearest({
        vectorField: 'embedding',
        queryVector: firebase_1.FieldValue.vector(queryEmbedding),
        limit: Math.min(limit + 1, 50), // +1 to filter out self if needed
        distanceMeasure: 'COSINE',
    });
    const snapshot = await vectorQuery.get();
    const queryTime = Date.now() - startTime - embeddingTime;
    console.log(`[visualSearch] Vector query returned ${snapshot.docs.length} results in ${queryTime}ms`);
    // 4. Fetch full article data
    const articleIds = snapshot.docs
        .filter(doc => doc.id !== (filters === null || filters === void 0 ? void 0 : filters.excludeArticleId))
        .slice(0, limit)
        .map(doc => doc.id);
    if (articleIds.length === 0) {
        return { results: [], queryEmbeddingGenerated: true };
    }
    // Batch fetch articles (Firestore 'in' supports max 30)
    const batches = [];
    for (let i = 0; i < articleIds.length; i += 30) {
        const batch = articleIds.slice(i, i + 30);
        batches.push(firebase_1.db.collection('articles')
            .where('__name__', 'in', batch)
            .get());
    }
    const batchResults = await Promise.all(batches);
    const articlesMap = new Map();
    for (const batchSnapshot of batchResults) {
        for (const doc of batchSnapshot.docs) {
            articlesMap.set(doc.id, doc.data());
        }
    }
    // 5. Build results with similarity scores
    const results = [];
    for (const doc of snapshot.docs) {
        if (doc.id === (filters === null || filters === void 0 ? void 0 : filters.excludeArticleId))
            continue;
        if (results.length >= limit)
            break;
        const article = articlesMap.get(doc.id);
        if (!article)
            continue;
        // Cosine distance to similarity percentage (1 - distance) * 100
        const distance = doc.get('__distance__') || 0;
        // Skip results below similarity threshold
        if (distance > VISUAL_SEARCH_MAX_DISTANCE) {
            console.log(`[visualSearch] Skipping ${doc.id} (distance ${distance.toFixed(3)}, below threshold)`);
            continue;
        }
        const similarity = Math.round((1 - distance) * 100);
        results.push({
            articleId: doc.id,
            similarity,
            title: article.title,
            price: article.price,
            imageUrl: (_c = (_b = article.images) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.url,
            brand: article.brand || undefined,
            condition: article.condition,
        });
    }
    const totalTime = Date.now() - startTime;
    console.log(`[visualSearch] Complete: ${results.length} results in ${totalTime}ms`);
    return { results };
});
/**
 * Get Similar Products - Find articles similar to a given article
 *
 * Uses the article's stored embedding to find visually similar items.
 * Falls back gracefully if no embedding exists.
 */
exports.getSimilarProducts = (0, https_1.onCall)({ invoker: 'public', timeoutSeconds: 30, memory: '512MiB' }, async (request) => {
    var _a, _b;
    const { articleId, limit = 10, includeScore = false } = request.data;
    if (!articleId) {
        throw new https_1.HttpsError('invalid-argument', 'articleId is required');
    }
    // 1. Get source article embedding
    const embeddingDoc = await firebase_1.db.collection('embeddings').doc(articleId).get();
    if (!embeddingDoc.exists) {
        // No embedding yet, return empty with fallback flag
        return { results: [], fallback: true };
    }
    const embeddingData = embeddingDoc.data();
    const sourceEmbedding = embeddingData.embedding;
    if (!sourceEmbedding) {
        return { results: [], fallback: true };
    }
    // 2. Vector similarity search
    const vectorQuery = firebase_1.db.collection('embeddings')
        .where('isActive', '==', true)
        .findNearest({
        vectorField: 'embedding',
        queryVector: sourceEmbedding,
        limit: limit + 1, // +1 to exclude self
        distanceMeasure: 'COSINE',
    });
    const snapshot = await vectorQuery.get();
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
        batches.push(firebase_1.db.collection('articles')
            .where('__name__', 'in', batch)
            .get());
    }
    const batchResults = await Promise.all(batches);
    const articlesMap = new Map();
    for (const batchSnapshot of batchResults) {
        for (const doc of batchSnapshot.docs) {
            articlesMap.set(doc.id, doc.data());
        }
    }
    // 4. Build results
    const results = [];
    for (const doc of snapshot.docs) {
        if (doc.id === articleId)
            continue;
        if (results.length >= limit)
            break;
        const article = articlesMap.get(doc.id);
        if (!article)
            continue;
        const distance = doc.get('__distance__') || 0;
        // Skip results below similarity threshold
        if (distance > SIMILAR_PRODUCTS_MAX_DISTANCE)
            break; // results are ordered, so no need to continue
        const result = {
            articleId: doc.id,
            title: article.title,
            price: article.price,
            imageUrl: (_b = (_a = article.images) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.url,
            brand: article.brand || undefined,
            condition: article.condition,
        };
        if (includeScore) {
            result.similarity = Math.round((1 - distance) * 100);
        }
        results.push(result);
    }
    console.log(`[getSimilarProducts] ${results.length} results for article ${articleId}`);
    return { results };
});
//# sourceMappingURL=search.js.map