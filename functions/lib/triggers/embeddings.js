"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEmbeddingOnUpdate = exports.generateEmbeddingOnCreate = void 0;
exports.parseFirebaseStorageUrl = parseFirebaseStorageUrl;
exports.generateMultimodalEmbedding = generateMultimodalEmbedding;
exports.generateAndStoreEmbedding = generateAndStoreEmbedding;
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
const firestore_1 = require("firebase-functions/v2/firestore");
const aiplatform_1 = require("@google-cloud/aiplatform");
const logger = __importStar(require("firebase-functions/logger"));
const firebase_1 = require("../config/firebase");
// Vertex AI configuration
const VERTEX_PROJECT = process.env.GCLOUD_PROJECT || 'seconde-b47a6';
const VERTEX_LOCATION = 'us-central1';
const EMBEDDING_MODEL = 'multimodalembedding@001';
const EMBEDDING_DIMENSIONS = 1408;
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
 * Price range helper for denormalized filtering
 */
function getPriceRange(price) {
    if (price < 20)
        return 'low';
    if (price <= 100)
        return 'medium';
    return 'high';
}
/**
 * Parse Firebase Storage URL and extract bucket and path
 */
function parseFirebaseStorageUrl(url) {
    const match = url.match(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/);
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
function buildGcsUri(imageUrl) {
    const parsed = parseFirebaseStorageUrl(imageUrl);
    if (!parsed)
        return null;
    return `gs://${parsed.bucketName}/${parsed.filePath}`;
}
/**
 * Download image from Firebase Storage and return as base64 (fallback)
 * Used only when GCS URI approach fails.
 */
async function downloadImageAsBase64(imageUrl) {
    const parsed = parseFirebaseStorageUrl(imageUrl);
    if (parsed) {
        try {
            const bucket = firebase_1.storage.bucket(parsed.bucketName);
            const file = bucket.file(parsed.filePath);
            const [exists] = await file.exists();
            if (!exists) {
                logger.error('[embeddings] File does not exist', { filePath: parsed.filePath });
                return null;
            }
            const [buffer] = await file.download();
            return buffer.toString('base64');
        }
        catch (error) {
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
    }
    catch (error) {
        logger.error('[embeddings] Error downloading via HTTP', { error });
        return null;
    }
}
/**
 * Generate multimodal image embedding using Vertex AI.
 * Accepts either a GCS URI or base64-encoded image data.
 * Returns a 1408-dimension vector from image pixels.
 */
async function generateMultimodalEmbedding(imageInput) {
    var _a, _b, _c, _d;
    try {
        const client = getVertexClient();
        const endpoint = `projects/${VERTEX_PROJECT}/locations/${VERTEX_LOCATION}/publishers/google/models/${EMBEDDING_MODEL}`;
        const instanceValue = aiplatform_1.helpers.toValue({
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
        const values = (_d = (_c = (_b = (_a = prediction === null || prediction === void 0 ? void 0 : prediction.structValue) === null || _a === void 0 ? void 0 : _a.fields) === null || _b === void 0 ? void 0 : _b.imageEmbedding) === null || _c === void 0 ? void 0 : _c.listValue) === null || _d === void 0 ? void 0 : _d.values;
        if (!values || values.length === 0) {
            logger.error('[embeddings] No embedding values in response');
            return null;
        }
        const embedding = values.map((v) => v.numberValue || 0);
        if (embedding.length !== EMBEDDING_DIMENSIONS) {
            logger.warn('[embeddings] Unexpected dimension', { got: embedding.length, expected: EMBEDDING_DIMENSIONS });
        }
        return embedding;
    }
    catch (error) {
        logger.error('[embeddings] Vertex AI error', { error });
        return null;
    }
}
/**
 * Generate embedding and store in embeddings collection.
 * Uses GCS URI (preferred) with base64 fallback for non-Storage URLs.
 */
async function generateAndStoreEmbedding(articleId, article) {
    var _a, _b, _c;
    const imageUrl = (_b = (_a = article.images) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.url;
    if (!imageUrl) {
        logger.info('[embeddings] No image for article, skipping', { articleId });
        return;
    }
    try {
        // Try GCS URI first (handles HEIC and all formats natively)
        const gcsUri = buildGcsUri(imageUrl);
        let embedding = null;
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
        await firebase_1.db.collection('embeddings').doc(articleId).set({
            articleId,
            embedding: firebase_1.FieldValue.vector(embedding),
            imageUrl,
            categoryIds: article.categoryIds || (article.category ? [article.category] : []),
            brand: article.brand || null,
            priceRange: getPriceRange(article.price || 0),
            isActive: (_c = article.isActive) !== null && _c !== void 0 ? _c : true,
            createdAt: firebase_1.FieldValue.serverTimestamp(),
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        });
        logger.info('[embeddings] Stored embedding', { articleId, dims: embedding.length });
    }
    catch (error) {
        logger.error('[embeddings] Error generating/storing embedding', { articleId, error });
    }
}
/**
 * Update denormalized metadata without regenerating embedding
 */
async function updateEmbeddingMetadata(articleId, article) {
    var _a;
    const embeddingRef = firebase_1.db.collection('embeddings').doc(articleId);
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
        isActive: (_a = article.isActive) !== null && _a !== void 0 ? _a : true,
        updatedAt: firebase_1.FieldValue.serverTimestamp(),
    });
    logger.info('[embeddings] Updated metadata', { articleId });
}
/**
 * Generate embedding when article is created
 */
exports.generateEmbeddingOnCreate = (0, firestore_1.onDocumentCreated)({ document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120 }, async (event) => {
    var _a, _b, _c;
    const articleId = event.params.articleId;
    const article = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!article)
        return;
    // Only process active articles with images
    if (!((_c = (_b = article.images) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.url)) {
        logger.info('[embeddings] No image for new article, skipping', { articleId });
        return;
    }
    await generateAndStoreEmbedding(articleId, article);
});
/**
 * Update embedding when article is updated
 */
exports.generateEmbeddingOnUpdate = (0, firestore_1.onDocumentUpdated)({ document: 'articles/{articleId}', region: 'northamerica-northeast1', memory: '512MiB', timeoutSeconds: 120 }, async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const articleId = event.params.articleId;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!after)
        return;
    // If article was deactivated, update isActive flag
    if ((before === null || before === void 0 ? void 0 : before.isActive) && !after.isActive) {
        const embeddingRef = firebase_1.db.collection('embeddings').doc(articleId);
        const doc = await embeddingRef.get();
        if (doc.exists) {
            await embeddingRef.update({ isActive: false, updatedAt: firebase_1.FieldValue.serverTimestamp() });
            logger.info('[embeddings] Deactivated embedding', { articleId });
        }
        return;
    }
    // Check if main image changed
    const beforeImage = (_d = (_c = before === null || before === void 0 ? void 0 : before.images) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.url;
    const afterImage = (_f = (_e = after.images) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.url;
    if (beforeImage !== afterImage && afterImage) {
        // Image changed: regenerate embedding
        await generateAndStoreEmbedding(articleId, after);
    }
    else {
        // Only metadata changed: update denormalized fields
        await updateEmbeddingMetadata(articleId, after);
    }
});
//# sourceMappingURL=embeddings.js.map