"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateArticleEmbedding = void 0;
/**
 * Article Firestore triggers - Visual Search V2
 * Firebase Functions v7 - using onDocumentWritten
 *
 * V2 Changes:
 * - Generates embeddings for ALL images (max 5) per article
 * - Stores embeddings in separate collection 'article_images'
 * - Embeddings generated from image analysis (not text metadata)
 */
const firestore_1 = require("firebase-functions/v2/firestore");
const firebase_1 = require("../config/firebase");
const ai_1 = require("../services/ai");
// Maximum number of images to embed per article
const MAX_IMAGES_TO_EMBED = 5;
/**
 * Generate embeddings for article images when article is created or updated
 * Stores each image embedding in the 'article_images' collection
 */
exports.generateArticleEmbedding = (0, firestore_1.onDocumentWritten)({
    document: 'articles/{articleId}',
    memory: '1GiB',
    timeoutSeconds: 300, // 5 minutes for multiple images
}, async (event) => {
    var _a, _b;
    const articleId = event.params.articleId;
    const beforeData = ((_a = event.data) === null || _a === void 0 ? void 0 : _a.before.exists) ? event.data.before.data() : null;
    const afterData = ((_b = event.data) === null || _b === void 0 ? void 0 : _b.after.exists) ? event.data.after.data() : null;
    // === DELETION: Remove all article_images for this article ===
    if (!afterData) {
        console.log(`Article ${articleId} deleted, removing all image embeddings`);
        await deleteAllArticleImages(articleId);
        return;
    }
    // Get image arrays - images can be strings (URLs) or objects with url property
    const extractUrls = (images) => {
        if (!images || !Array.isArray(images))
            return [];
        return images.map((img) => {
            if (typeof img === 'string')
                return img;
            if (img && typeof img === 'object' && 'url' in img)
                return img.url;
            return '';
        }).filter(Boolean);
    };
    const beforeImages = extractUrls((beforeData === null || beforeData === void 0 ? void 0 : beforeData.images) || []);
    const afterImages = extractUrls(afterData.images || []);
    // Determine availability
    const isAvailable = afterData.isActive !== false && afterData.isSold !== true;
    // === CHECK FOR FORCED REGENERATION (for migration) ===
    const forceRegenerate = afterData.forceRegenerateEmbedding === true &&
        (!beforeData || beforeData.forceRegenerateEmbedding !== true);
    // === AVAILABILITY CHANGE ONLY ===
    const imagesChanged = !arraysEqual(beforeImages, afterImages);
    const availabilityChanged = beforeData && (beforeData.isActive !== afterData.isActive || beforeData.isSold !== afterData.isSold);
    if (!imagesChanged && availabilityChanged && !forceRegenerate) {
        console.log(`Article ${articleId}: availability changed to ${isAvailable}`);
        await updateAvailabilityForArticle(articleId, isAvailable);
        return;
    }
    // === NEW ARTICLE, IMAGES CHANGED, OR FORCED REGENERATION ===
    if (!beforeData || imagesChanged || forceRegenerate) {
        if (forceRegenerate) {
            console.log(`Article ${articleId}: FORCED regeneration triggered`);
        }
        console.log(`Article ${articleId}: ${!beforeData ? 'NEW' : 'images changed'}, generating embeddings for ${Math.min(afterImages.length, MAX_IMAGES_TO_EMBED)} images`);
        // Delete existing embeddings first if updating
        if (beforeData) {
            await deleteAllArticleImages(articleId);
        }
        // Generate embeddings for each image (max 5)
        const imagesToProcess = afterImages.slice(0, MAX_IMAGES_TO_EMBED);
        let successCount = 0;
        for (let i = 0; i < imagesToProcess.length; i++) {
            const imageUrl = imagesToProcess[i];
            try {
                console.log(`  Processing image ${i + 1}/${imagesToProcess.length}: ${imageUrl.slice(0, 50)}...`);
                const result = await (0, ai_1.generateImageEmbedding)(imageUrl);
                if (result) {
                    // Store in article_images collection
                    console.log(`  DEBUG: Embedding generated for image ${i + 1}`);
                    console.log(`    - Description: ${result.description.slice(0, 100)}...`);
                    console.log(`    - Embedding dimensions: ${result.embedding.length}`);
                    console.log(`    - First 5 values: [${result.embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}]`);
                    console.log(`    - isAvailable: ${isAvailable}`);
                    const docRef = await firebase_1.db.collection('article_images').add({
                        articleId,
                        imageUrl,
                        imageIndex: i,
                        embedding: firebase_1.FieldValue.vector(result.embedding),
                        description: result.description,
                        isAvailable,
                        createdAt: firebase_1.FieldValue.serverTimestamp(),
                        updatedAt: firebase_1.FieldValue.serverTimestamp(),
                    });
                    console.log(`  ✓ Image ${i + 1} embedded successfully, docId: ${docRef.id}`);
                    successCount++;
                }
                else {
                    console.warn(`  ✗ Failed to generate embedding for image ${i + 1}`);
                }
                // Rate limiting between images
                if (i < imagesToProcess.length - 1) {
                    await sleep(500);
                }
            }
            catch (error) {
                console.error(`  ✗ Error processing image ${i + 1}:`, error);
            }
        }
        console.log(`Article ${articleId}: completed ${successCount}/${imagesToProcess.length} image embeddings`);
    }
    // ============================================
    // TEXT EMBEDDING: Generate semantic text embedding for dual search
    // Triggers on: creation, or change in title/description/category/brand
    // ============================================
    const textFieldsChanged = !beforeData ||
        beforeData.title !== afterData.title ||
        beforeData.description !== afterData.description ||
        beforeData.category !== afterData.category ||
        beforeData.brand !== afterData.brand ||
        forceRegenerate;
    if (textFieldsChanged && afterData.title) {
        console.log(`Article ${articleId}: generating text embedding...`);
        try {
            const semanticDescription = (0, ai_1.buildArticleSemanticDescription)(afterData);
            console.log(`  Semantic description: "${semanticDescription.slice(0, 120)}..."`);
            const textEmbedding = await (0, ai_1.generateTextEmbeddingForSearch)(semanticDescription, 'RETRIEVAL_DOCUMENT');
            if (textEmbedding) {
                await firebase_1.db.collection('articles').doc(articleId).update({
                    textEmbedding: firebase_1.FieldValue.vector(textEmbedding),
                    semanticDescription,
                    textEmbeddingUpdatedAt: firebase_1.FieldValue.serverTimestamp(),
                });
                console.log(`  Text embedding stored (${textEmbedding.length} dims)`);
            }
            else {
                console.warn(`  Failed to generate text embedding`);
            }
        }
        catch (error) {
            console.error(`  Error generating text embedding:`, error);
        }
    }
});
/**
 * Delete all article_images documents for an article
 */
async function deleteAllArticleImages(articleId) {
    const snapshot = await firebase_1.db
        .collection('article_images')
        .where('articleId', '==', articleId)
        .get();
    if (snapshot.empty) {
        return;
    }
    const batch = firebase_1.db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`Deleted ${snapshot.docs.length} image embeddings for article ${articleId}`);
}
/**
 * Update isAvailable flag for all article_images of an article
 */
async function updateAvailabilityForArticle(articleId, isAvailable) {
    const snapshot = await firebase_1.db
        .collection('article_images')
        .where('articleId', '==', articleId)
        .get();
    if (snapshot.empty) {
        return;
    }
    const batch = firebase_1.db.batch();
    snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, {
            isAvailable,
            updatedAt: firebase_1.FieldValue.serverTimestamp(),
        });
    });
    await batch.commit();
    console.log(`Updated availability to ${isAvailable} for ${snapshot.docs.length} images of article ${articleId}`);
}
/**
 * Compare two arrays for equality
 */
function arraysEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=articles.js.map