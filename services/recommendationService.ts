import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/config/firebaseConfig';

export interface SimilarProduct {
  articleId: string;
  similarity?: number;
  title: string;
  price: number;
  imageUrl: string;
  brand: string | null;
  size?: string;
  condition: string;
}

interface GetSimilarProductsResponse {
  results: SimilarProduct[];
  fallback?: boolean;
}

class RecommendationServiceClass {
  /**
   * Get AI-powered similar products for an article
   * Falls back gracefully if embedding doesn't exist
   */
  async getSimilarProducts(
    articleId: string,
    limit: number = 10,
    includeScore: boolean = false
  ): Promise<SimilarProduct[]> {
    // The CF is `invoker: public` so it tolerates unauthenticated callers,
    // but the Firebase Functions client SDK still surfaces an
    // 'unauthenticated' error during the brief window between app boot
    // and Firebase Auth hydration. Skip silently — the consumer falls
    // back to category-based recs.
    if (!auth.currentUser) {
      return [];
    }

    try {
      const getSimilarFn = httpsCallable<
        { articleId: string; limit: number; includeScore: boolean },
        GetSimilarProductsResponse
      >(functions, 'getSimilarProducts');

      const response = await getSimilarFn({
        articleId,
        limit,
        includeScore,
      });

      if (response.data.fallback && __DEV__) {
        console.log('getSimilarProducts: No embedding found, fallback mode');
      }

      return response.data.results;
    } catch (error: any) {
      // Don't pollute the console for the known transient auth race.
      if (error?.code !== 'functions/unauthenticated' && __DEV__) {
        console.error('Error getting similar products:', error);
      }
      return [];
    }
  }
}

export const RecommendationService = new RecommendationServiceClass();
