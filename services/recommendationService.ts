import { httpsCallable } from '@react-native-firebase/functions';
import { functions } from '@/config/firebaseConfig';

export interface SimilarProduct {
  articleId: string;
  similarity?: number;
  title: string;
  price: number;
  imageUrl: string;
  brand: string | null;
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

      if (response.data.fallback) {
        console.log('getSimilarProducts: No embedding found, fallback mode');
      }

      return response.data.results;
    } catch (error) {
      console.error('Error getting similar products:', error);
      return [];
    }
  }
}

export const RecommendationService = new RecommendationServiceClass();
