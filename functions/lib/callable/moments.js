"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMomentProducts = exports.getActiveMoments = void 0;
/**
 * Moments callable functions
 * Firebase Functions v7 - using onCall
 */
const https_1 = require("firebase-functions/v2/https");
const firebase_1 = require("../config/firebase");
const ai_1 = require("../services/ai");
/**
 * Get active moments based on current date
 */
exports.getActiveMoments = (0, https_1.onCall)({ invoker: 'public', memory: '512MiB' }, async () => {
    try {
        const today = new Date();
        const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const momentsSnapshot = await firebase_1.db
            .collection('moments')
            .where('isActive', '==', true)
            .orderBy('priority', 'asc')
            .get();
        const activeMoments = [];
        momentsSnapshot.docs.forEach((doc) => {
            const moment = doc.data();
            const { start, end } = moment.dateRange;
            // Handle year wrap (e.g., 12-20 to 01-07)
            let isActive = false;
            if (start <= end) {
                // Normal range within same year
                isActive = monthDay >= start && monthDay <= end;
            }
            else {
                // Wraps around year end
                isActive = monthDay >= start || monthDay <= end;
            }
            if (isActive) {
                activeMoments.push({
                    id: moment.id,
                    name: moment.name,
                    emoji: moment.emoji,
                    priority: moment.priority,
                });
            }
        });
        return { moments: activeMoments };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error getting active moments:', error);
        throw new https_1.HttpsError('internal', 'Failed to get active moments: ' + message);
    }
});
/**
 * Get products matching a specific moment using vector similarity
 */
exports.getMomentProducts = (0, https_1.onCall)({ invoker: 'public', memory: '512MiB' }, async (request) => {
    var _a, _b;
    try {
        const { momentId, limit: limitParam = 20, minScore = 0.5 } = request.data;
        if (!momentId) {
            throw new https_1.HttpsError('invalid-argument', 'momentId is required');
        }
        // 1. Get moment embedding
        const momentDoc = await firebase_1.db.collection('moments').doc(momentId).get();
        if (!momentDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Moment not found');
        }
        const momentData = momentDoc.data();
        const momentEmbedding = momentData.embedding;
        if (!momentEmbedding || momentEmbedding.length === 0) {
            throw new https_1.HttpsError('internal', 'Moment has no embedding');
        }
        // 2. Get all active article embeddings
        const embeddingsSnapshot = await firebase_1.db
            .collection('embeddings')
            .where('isActive', '==', true)
            .where('isSold', '==', false)
            .limit(500)
            .get();
        if (embeddingsSnapshot.empty) {
            return {
                results: [],
                moment: {
                    id: momentData.id,
                    name: momentData.name,
                    emoji: momentData.emoji,
                },
            };
        }
        // 3. Compute similarities
        const similarities = [];
        embeddingsSnapshot.docs.forEach((doc) => {
            const docEmbedding = doc.data().embedding;
            if (docEmbedding && docEmbedding.length === momentEmbedding.length) {
                const score = (0, ai_1.computeCosineSimilarity)(momentEmbedding, docEmbedding);
                if (score >= minScore) {
                    similarities.push({ articleId: doc.id, score });
                }
            }
        });
        // 4. Sort by similarity and take top N
        similarities.sort((a, b) => b.score - a.score);
        const topMatches = similarities.slice(0, Math.min(limitParam, 50));
        // 5. Batch fetch article details
        const results = [];
        for (const match of topMatches) {
            const articleDoc = await firebase_1.db.collection('articles').doc(match.articleId).get();
            if (articleDoc.exists) {
                const article = articleDoc.data();
                results.push({
                    articleId: match.articleId,
                    similarity: Math.round(match.score * 100),
                    title: article.title,
                    price: article.price,
                    imageUrl: ((_b = (_a = article.images) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.url) || null,
                    brand: article.brand || null,
                    condition: article.condition,
                });
            }
        }
        return {
            results,
            moment: {
                id: momentData.id,
                name: momentData.name,
                emoji: momentData.emoji,
            },
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error getting moment products:', error);
        throw new https_1.HttpsError('internal', 'Failed to get moment products: ' + message);
    }
});
//# sourceMappingURL=moments.js.map