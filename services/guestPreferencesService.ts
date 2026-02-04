import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

// Constants for AsyncStorage keys
export const GUEST_KEYS = {
  SESSION: '@guest_session',
  LIKED: '@guest_liked_articles',
  SEARCHES: '@guest_searches',
  VIEWED: '@guest_viewed_articles',
} as const;

// Article metadata for tracking
export interface ArticleMeta {
  id: string;
  brand?: string;
  size?: string;
  price: number;
  category: string;
  timestamp: string; // ISO string
}

// Guest session structure
export interface GuestSession {
  guestId: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
  likedArticles: ArticleMeta[];
  searches: string[];
  viewedArticles: ArticleMeta[];
}

// Local preferences calculated from behavior
export interface LocalPreferences {
  topBrands: string[];
  probableSizes: { top: string; bottom: string };
  priceRange: { min: number; max: number };
  topCategories: string[];
}

class GuestPreferencesService {
  /**
   * Create a new guest session
   */
  async createGuestSession(): Promise<GuestSession> {
    const now = new Date().toISOString();
    const session: GuestSession = {
      guestId: Crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      likedArticles: [],
      searches: [],
      viewedArticles: [],
    };

    await AsyncStorage.setItem(GUEST_KEYS.SESSION, JSON.stringify(session));
    return session;
  }

  /**
   * Get current guest session
   */
  async getGuestSession(): Promise<GuestSession | null> {
    try {
      const sessionData = await AsyncStorage.getItem(GUEST_KEYS.SESSION);
      if (!sessionData) {
        return null;
      }
      return JSON.parse(sessionData) as GuestSession;
    } catch (error) {
      console.error('Error getting guest session:', error);
      return null;
    }
  }

  /**
   * Check if a guest session exists
   */
  async hasGuestSession(): Promise<boolean> {
    const session = await this.getGuestSession();
    return session !== null;
  }

  /**
   * Update guest session
   */
  async updateGuestSession(updates: Partial<GuestSession>): Promise<GuestSession | null> {
    try {
      const session = await this.getGuestSession();
      if (!session) {
        return null;
      }

      const updatedSession: GuestSession = {
        ...session,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      await AsyncStorage.setItem(GUEST_KEYS.SESSION, JSON.stringify(updatedSession));
      return updatedSession;
    } catch (error) {
      console.error('Error updating guest session:', error);
      return null;
    }
  }

  /**
   * Track article view
   */
  async trackView(article: ArticleMeta): Promise<void> {
    try {
      const session = await this.getGuestSession();
      if (!session) {
        return;
      }

      // Check if already viewed (avoid duplicates in short time)
      const alreadyViewed = session.viewedArticles.some(
        (a) => a.id === article.id
      );

      if (!alreadyViewed) {
        const updatedViewed = [
          ...session.viewedArticles,
          { ...article, timestamp: new Date().toISOString() },
        ].slice(-100); // Keep last 100 views

        await this.updateGuestSession({ viewedArticles: updatedViewed });
      }
    } catch (error) {
      console.error('Error tracking view:', error);
    }
  }

  /**
   * Track search query
   */
  async trackSearch(query: string): Promise<void> {
    try {
      const session = await this.getGuestSession();
      if (!session) {
        return;
      }

      const trimmedQuery = query.trim().toLowerCase();
      if (!trimmedQuery) {
        return;
      }

      // Avoid duplicate consecutive searches
      if (session.searches[session.searches.length - 1] === trimmedQuery) {
        return;
      }

      const updatedSearches = [...session.searches, trimmedQuery].slice(-50); // Keep last 50 searches
      await this.updateGuestSession({ searches: updatedSearches });
    } catch (error) {
      console.error('Error tracking search:', error);
    }
  }

  /**
   * Track article like
   */
  async trackLike(article: ArticleMeta): Promise<void> {
    try {
      const session = await this.getGuestSession();
      if (!session) {
        return;
      }

      // Check if already liked
      const alreadyLiked = session.likedArticles.some(
        (a) => a.id === article.id
      );

      if (!alreadyLiked) {
        const updatedLiked = [
          ...session.likedArticles,
          { ...article, timestamp: new Date().toISOString() },
        ];

        await this.updateGuestSession({ likedArticles: updatedLiked });
      }
    } catch (error) {
      console.error('Error tracking like:', error);
    }
  }

  /**
   * Remove a liked article (unlike)
   */
  async removeLike(articleId: string): Promise<void> {
    try {
      const session = await this.getGuestSession();
      if (!session) {
        return;
      }

      const updatedLiked = session.likedArticles.filter(
        (a) => a.id !== articleId
      );

      await this.updateGuestSession({ likedArticles: updatedLiked });
    } catch (error) {
      console.error('Error removing like:', error);
    }
  }

  /**
   * Calculate local preferences from guest behavior
   * Triggered after ~15 interactions
   */
  async calculateLocalPreferences(): Promise<LocalPreferences | null> {
    try {
      const session = await this.getGuestSession();
      if (!session) {
        return null;
      }

      const allArticles = [...session.likedArticles, ...session.viewedArticles];

      if (allArticles.length < 5) {
        return null; // Not enough data
      }

      // Calculate top brands
      const brandCounts: Record<string, number> = {};
      allArticles.forEach((a) => {
        if (a.brand) {
          brandCounts[a.brand] = (brandCounts[a.brand] || 0) + 1;
        }
      });
      const topBrands = Object.entries(brandCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([brand]) => brand);

      // Calculate probable sizes
      const sizeCounts: Record<string, number> = {};
      allArticles.forEach((a) => {
        if (a.size) {
          sizeCounts[a.size] = (sizeCounts[a.size] || 0) + 1;
        }
      });
      const sortedSizes = Object.entries(sizeCounts)
        .sort((a, b) => b[1] - a[1]);

      const probableSizes = {
        top: sortedSizes[0]?.[0] || '',
        bottom: sortedSizes[1]?.[0] || sortedSizes[0]?.[0] || '',
      };

      // Calculate price range
      const prices = allArticles.map((a) => a.price).filter((p) => p > 0);
      const priceRange = {
        min: prices.length > 0 ? Math.min(...prices) : 0,
        max: prices.length > 0 ? Math.max(...prices) : 100,
      };

      // Calculate top categories
      const categoryCounts: Record<string, number> = {};
      allArticles.forEach((a) => {
        if (a.category) {
          categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1;
        }
      });
      const topCategories = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([category]) => category);

      return {
        topBrands,
        probableSizes,
        priceRange,
        topCategories,
      };
    } catch (error) {
      console.error('Error calculating local preferences:', error);
      return null;
    }
  }

  /**
   * Get total interaction count
   */
  async getInteractionCount(): Promise<number> {
    const session = await this.getGuestSession();
    if (!session) {
      return 0;
    }
    return (
      session.likedArticles.length +
      session.viewedArticles.length +
      session.searches.length
    );
  }

  /**
   * Clear guest session (on account creation or logout)
   */
  async clearGuestSession(): Promise<void> {
    try {
      await AsyncStorage.removeItem(GUEST_KEYS.SESSION);
    } catch (error) {
      console.error('Error clearing guest session:', error);
    }
  }

  /**
   * Export guest data for merging to user account
   */
  async exportGuestData(): Promise<GuestSession | null> {
    return await this.getGuestSession();
  }
}

export const guestPreferencesService = new GuestPreferencesService();
