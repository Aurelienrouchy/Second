import { useCallback, useEffect, useState } from 'react';

import { getActiveMoments, getMomentProducts, Moment, MomentProduct } from '@/services/momentsService';
import { Article } from '@/types';

interface MomentSection {
  moment: Moment;
  articles: Article[];
  isLoading: boolean;
}

interface UseMomentsResult {
  momentSections: MomentSection[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook to fetch active moments and their matching products for the homepage
 */
export function useMoments(limit: number = 10): UseMomentsResult {
  const [momentSections, setMomentSections] = useState<MomentSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMoments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // 1. Get active moments for today
      const activeMoments = await getActiveMoments();

      if (activeMoments.length === 0) {
        setMomentSections([]);
        return;
      }

      // 2. Initialize sections with loading state
      const initialSections: MomentSection[] = activeMoments.map((moment) => ({
        moment,
        articles: [],
        isLoading: true,
      }));
      setMomentSections(initialSections);

      // 3. Fetch products for each moment in parallel
      const productPromises = activeMoments.map((moment) =>
        getMomentProducts(moment.id, limit)
      );

      const results = await Promise.all(productPromises);

      // 4. Transform results to Article format and update sections
      const finalSections: MomentSection[] = activeMoments.map((moment, index) => {
        const result = results[index];
        const articles: Article[] = result?.results.map((product: MomentProduct) => ({
          id: product.articleId,
          title: product.title,
          price: product.price,
          images: product.imageUrl ? [{ url: product.imageUrl }] : [],
          brand: product.brand || undefined,
          condition: product.condition,
          // Additional fields for Article type
          description: '',
          categoryPath: [],
          categoryIds: [],
          sellerId: '',
          sellerName: '',
          isActive: true,
          isSold: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })) || [];

        return {
          moment,
          articles,
          isLoading: false,
        };
      });

      // Filter out sections with no articles
      const nonEmptySections = finalSections.filter(
        (section) => section.articles.length > 0
      );

      setMomentSections(nonEmptySections);
    } catch (err) {
      console.error('Error fetching moments:', err);
      setError('Erreur lors du chargement des moments');
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchMoments();
  }, [fetchMoments]);

  return {
    momentSections,
    isLoading,
    error,
    refresh: fetchMoments,
  };
}

/**
 * Hook to fetch products for a single moment
 */
export function useMomentProducts(momentId: string, limit: number = 20) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [moment, setMoment] = useState<Moment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    if (!momentId) return;

    try {
      setIsLoading(true);
      setError(null);

      const result = await getMomentProducts(momentId, limit);

      if (result) {
        setMoment(result.moment);
        setArticles(
          result.results.map((product: MomentProduct) => ({
            id: product.articleId,
            title: product.title,
            price: product.price,
            images: product.imageUrl ? [{ url: product.imageUrl }] : [],
            brand: product.brand || undefined,
            condition: product.condition,
            description: '',
            categoryPath: [],
            categoryIds: [],
            sellerId: '',
            sellerName: '',
            isActive: true,
            isSold: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          }))
        );
      }
    } catch (err) {
      console.error('Error fetching moment products:', err);
      setError('Erreur lors du chargement des produits');
    } finally {
      setIsLoading(false);
    }
  }, [momentId, limit]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return {
    articles,
    moment,
    isLoading,
    error,
    refresh: fetchProducts,
  };
}
