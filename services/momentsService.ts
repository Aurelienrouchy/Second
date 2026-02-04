import { httpsCallable } from '@react-native-firebase/functions';
import { functions } from '@/config/firebaseConfig';

export interface Moment {
  id: string;
  name: string;
  emoji: string;
  priority?: number;
}

export interface MomentProduct {
  articleId: string;
  similarity: number;
  title: string;
  price: number;
  imageUrl?: string;
  brand?: string;
  condition?: string;
}

export interface GetMomentProductsResponse {
  results: MomentProduct[];
  moment: Moment;
}

export interface GetActiveMomentsResponse {
  moments: Moment[];
}

/**
 * Get currently active moments based on today's date
 */
export async function getActiveMoments(): Promise<Moment[]> {
  try {
    const getActiveMomentsFn = httpsCallable<void, GetActiveMomentsResponse>(
      functions,
      'getActiveMoments'
    );
    const result = await getActiveMomentsFn();
    return result.data.moments;
  } catch (error) {
    console.error('Error fetching active moments:', error);
    return [];
  }
}

/**
 * Get products matching a specific moment using vector similarity
 */
export async function getMomentProducts(
  momentId: string,
  limit: number = 20,
  minScore: number = 0.5
): Promise<GetMomentProductsResponse | null> {
  try {
    const getMomentProductsFn = httpsCallable<
      { momentId: string; limit: number; minScore: number },
      GetMomentProductsResponse
    >(functions, 'getMomentProducts');

    const result = await getMomentProductsFn({ momentId, limit, minScore });
    return result.data;
  } catch (error) {
    console.error('Error fetching moment products:', error);
    return null;
  }
}

/**
 * Hook-friendly function to get a moment section data for homepage
 */
export async function getMomentSectionData(momentId: string, limit: number = 10) {
  const response = await getMomentProducts(momentId, limit);

  if (!response || response.results.length === 0) {
    return null;
  }

  return {
    title: `${response.moment.emoji} ${response.moment.name}`,
    momentId: response.moment.id,
    products: response.results,
  };
}
