import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from '@react-native-firebase/firestore';
import { firestore } from '../config/firebaseConfig';
import { SearchFilters } from '../types';

export interface SearchHistoryItem {
  id: string;
  query: string;
  filters: Partial<SearchFilters>;
  timestamp: Date;
  resultCount?: number;
}

interface SearchHistoryDocument {
  query: string;
  filters: Partial<SearchFilters>;
  timestamp: Timestamp;
  resultCount?: number;
}

const MAX_HISTORY_ITEMS = 20;

/**
 * Service for managing user search history in Firestore.
 * Path: users/{userId}/searchHistory/
 */
export class SearchHistoryService {
  /**
   * Add a search to user's history.
   * Automatically removes oldest entries if exceeding MAX_HISTORY_ITEMS.
   */
  static async addSearchToHistory(
    userId: string,
    searchQuery: string,
    filters: Partial<SearchFilters>,
    resultCount?: number
  ): Promise<string> {
    try {
      // Don't save empty searches
      if (!searchQuery.trim() && !this.hasActiveFilters(filters)) {
        return '';
      }

      const historyRef = collection(firestore, 'users', userId, 'searchHistory');

      // Add new search
      const docRef = await addDoc(historyRef, {
        query: searchQuery.trim(),
        filters: this.sanitizeFilters(filters),
        timestamp: serverTimestamp(),
        resultCount: resultCount ?? null,
      });

      // Clean up old entries if needed
      await this.cleanupOldEntries(userId);

      return docRef.id;
    } catch (error: any) {
      console.error('Error adding search to history:', error);
      throw new Error(`Erreur lors de l'ajout à l'historique: ${error.message}`);
    }
  }

  /**
   * Get recent searches for a user.
   */
  static async getRecentSearches(
    userId: string,
    limitCount: number = MAX_HISTORY_ITEMS
  ): Promise<SearchHistoryItem[]> {
    try {
      const historyRef = collection(firestore, 'users', userId, 'searchHistory');
      const q = query(
        historyRef,
        orderBy('timestamp', 'desc'),
        limit(limitCount)
      );

      const snapshot = await getDocs(q);
      const items: SearchHistoryItem[] = [];

      snapshot.forEach((docSnap: any) => {
        const data = docSnap.data() as SearchHistoryDocument;
        items.push({
          id: docSnap.id,
          query: data.query,
          filters: data.filters,
          timestamp: data.timestamp?.toDate() || new Date(),
          resultCount: data.resultCount,
        });
      });

      return items;
    } catch (error: any) {
      console.error('Error getting search history:', error);
      throw new Error(`Erreur lors de la récupération de l'historique: ${error.message}`);
    }
  }

  /**
   * Delete a specific search from history.
   */
  static async deleteSearchFromHistory(userId: string, searchId: string): Promise<void> {
    try {
      const docRef = doc(firestore, 'users', userId, 'searchHistory', searchId);
      await deleteDoc(docRef);
    } catch (error: any) {
      console.error('Error deleting search from history:', error);
      throw new Error(`Erreur lors de la suppression: ${error.message}`);
    }
  }

  /**
   * Clear all search history for a user.
   */
  static async clearHistory(userId: string): Promise<void> {
    try {
      const historyRef = collection(firestore, 'users', userId, 'searchHistory');
      const snapshot = await getDocs(historyRef);

      if (snapshot.empty) return;

      const batch = writeBatch(firestore);
      snapshot.forEach((docSnap: any) => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();
    } catch (error: any) {
      console.error('Error clearing search history:', error);
      throw new Error(`Erreur lors de la suppression de l'historique: ${error.message}`);
    }
  }

  /**
   * Remove old entries if exceeding MAX_HISTORY_ITEMS.
   */
  private static async cleanupOldEntries(userId: string): Promise<void> {
    try {
      const historyRef = collection(firestore, 'users', userId, 'searchHistory');
      const q = query(historyRef, orderBy('timestamp', 'desc'));
      const snapshot = await getDocs(q);

      if (snapshot.size <= MAX_HISTORY_ITEMS) return;

      const batch = writeBatch(firestore);
      let count = 0;

      snapshot.forEach((docSnap: any) => {
        count++;
        if (count > MAX_HISTORY_ITEMS) {
          batch.delete(docSnap.ref);
        }
      });

      await batch.commit();
    } catch (error) {
      // Non-critical error, just log
      console.warn('Error cleaning up old history entries:', error);
    }
  }

  /**
   * Check if filters have any active values.
   */
  private static hasActiveFilters(filters: Partial<SearchFilters>): boolean {
    return !!(
      (filters.colors && filters.colors.length > 0) ||
      (filters.sizes && filters.sizes.length > 0) ||
      (filters.materials && filters.materials.length > 0) ||
      (filters.brands && filters.brands.length > 0) ||
      (filters.patterns && filters.patterns.length > 0) ||
      filters.condition ||
      filters.minPrice !== undefined ||
      filters.maxPrice !== undefined ||
      (filters.categoryIds && filters.categoryIds.length > 0)
    );
  }

  /**
   * Remove undefined/empty values from filters for storage.
   */
  private static sanitizeFilters(filters: Partial<SearchFilters>): Partial<SearchFilters> {
    const sanitized: Partial<SearchFilters> = {};

    if (filters.categoryIds && filters.categoryIds.length > 0) {
      sanitized.categoryIds = filters.categoryIds;
    }
    if (filters.colors && filters.colors.length > 0) {
      sanitized.colors = filters.colors;
    }
    if (filters.sizes && filters.sizes.length > 0) {
      sanitized.sizes = filters.sizes;
    }
    if (filters.materials && filters.materials.length > 0) {
      sanitized.materials = filters.materials;
    }
    if (filters.brands && filters.brands.length > 0) {
      sanitized.brands = filters.brands;
    }
    if (filters.patterns && filters.patterns.length > 0) {
      sanitized.patterns = filters.patterns;
    }
    if (filters.condition) {
      sanitized.condition = filters.condition;
    }
    if (filters.minPrice !== undefined) {
      sanitized.minPrice = filters.minPrice;
    }
    if (filters.maxPrice !== undefined) {
      sanitized.maxPrice = filters.maxPrice;
    }
    if (filters.sortBy) {
      sanitized.sortBy = filters.sortBy;
    }

    return sanitized;
  }

  /**
   * Format a search history item for display.
   */
  static formatSearchDisplay(item: SearchHistoryItem): string {
    const parts: string[] = [];

    if (item.query) {
      parts.push(`"${item.query}"`);
    }

    if (item.filters.categoryIds && item.filters.categoryIds.length > 0) {
      // Just show that category filter is applied
      parts.push('dans catégorie');
    }

    if (item.filters.brands && item.filters.brands.length > 0) {
      parts.push(item.filters.brands.slice(0, 2).join(', '));
    }

    if (item.filters.sizes && item.filters.sizes.length > 0) {
      parts.push(`taille ${item.filters.sizes.slice(0, 2).join(', ')}`);
    }

    if (item.filters.minPrice !== undefined || item.filters.maxPrice !== undefined) {
      if (item.filters.minPrice && item.filters.maxPrice) {
        parts.push(`${item.filters.minPrice}-${item.filters.maxPrice}€`);
      } else if (item.filters.minPrice) {
        parts.push(`>${item.filters.minPrice}€`);
      } else if (item.filters.maxPrice) {
        parts.push(`<${item.filters.maxPrice}€`);
      }
    }

    return parts.join(' • ') || 'Recherche';
  }
}

export default SearchHistoryService;
