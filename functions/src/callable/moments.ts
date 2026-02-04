/**
 * Moments callable functions
 * Firebase Functions v7 - using onCall
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase';
import { computeCosineSimilarity } from '../services/ai';

/**
 * Get active moments based on current date
 */
export const getActiveMoments = onCall(
  { invoker: 'public', memory: '512MiB' },
  async () => {
  try {
    const today = new Date();
    const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const momentsSnapshot = await db
      .collection('moments')
      .where('isActive', '==', true)
      .orderBy('priority', 'asc')
      .get();

    const activeMoments: Array<{
      id: string;
      name: string;
      emoji: string;
      priority: number;
    }> = [];

    momentsSnapshot.docs.forEach((doc) => {
      const moment = doc.data();
      const { start, end } = moment.dateRange;

      // Handle year wrap (e.g., 12-20 to 01-07)
      let isActive = false;
      if (start <= end) {
        // Normal range within same year
        isActive = monthDay >= start && monthDay <= end;
      } else {
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting active moments:', error);
    throw new HttpsError('internal', 'Failed to get active moments: ' + message);
  }
});

/**
 * Get products matching a specific moment using vector similarity
 */
export const getMomentProducts = onCall(
  { invoker: 'public', memory: '512MiB' },
  async (request) => {
  try {
    const { momentId, limit: limitParam = 20, minScore = 0.5 } = request.data;

    if (!momentId) {
      throw new HttpsError('invalid-argument', 'momentId is required');
    }

    // 1. Get moment embedding
    const momentDoc = await db.collection('moments').doc(momentId).get();
    if (!momentDoc.exists) {
      throw new HttpsError('not-found', 'Moment not found');
    }

    const momentData = momentDoc.data()!;
    const momentEmbedding: number[] = momentData.embedding;

    if (!momentEmbedding || momentEmbedding.length === 0) {
      throw new HttpsError('internal', 'Moment has no embedding');
    }

    // 2. Get all active article embeddings
    const embeddingsSnapshot = await db
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
    const similarities: { articleId: string; score: number }[] = [];

    embeddingsSnapshot.docs.forEach((doc) => {
      const docEmbedding: number[] = doc.data().embedding;
      if (docEmbedding && docEmbedding.length === momentEmbedding.length) {
        const score = computeCosineSimilarity(momentEmbedding, docEmbedding);
        if (score >= minScore) {
          similarities.push({ articleId: doc.id, score });
        }
      }
    });

    // 4. Sort by similarity and take top N
    similarities.sort((a, b) => b.score - a.score);
    const topMatches = similarities.slice(0, Math.min(limitParam, 50));

    // 5. Batch fetch article details
    const results: Array<{
      articleId: string;
      similarity: number;
      title: string;
      price: number;
      imageUrl: string | null;
      brand: string | null;
      condition: string;
    }> = [];

    for (const match of topMatches) {
      const articleDoc = await db.collection('articles').doc(match.articleId).get();
      if (articleDoc.exists) {
        const article = articleDoc.data()!;
        results.push({
          articleId: match.articleId,
          similarity: Math.round(match.score * 100),
          title: article.title,
          price: article.price,
          imageUrl: article.images?.[0]?.url || null,
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
  } catch (error: unknown) {
    if (error instanceof HttpsError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error getting moment products:', error);
    throw new HttpsError('internal', 'Failed to get moment products: ' + message);
  }
});
