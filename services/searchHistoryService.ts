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
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { firestore } from '../config/firebaseConfig';
import { SearchFilters } from '../types';
import { getColorName } from '@/data/colors';
import { getMaterialName } from '@/data/materials';
import { getConditionLabel } from '@/data/conditions';
import { getLeafCategoryLabel } from '@/data/categories-v2';

export interface SearchHistoryItem {
  id: string;
  query: string;
  filters: Partial<SearchFilters>;
  timestamp: Date;
}

interface SearchHistoryDocument {
  query: string;
  filters: Partial<SearchFilters>;
  timestamp: Timestamp;
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
    filters: Partial<SearchFilters>
  ): Promise<string> {
    try {
      // Don't save empty searches
      if (!searchQuery.trim() && !this.hasActiveFilters(filters)) {
        return '';
      }

      const historyRef = collection(firestore, 'users', userId, 'searchHistory');
      const trimmedQuery = searchQuery.trim();
      const sanitizedFilters = this.sanitizeFilters(filters);

      // M8: dedupe — if an entry already exists for the same query + filters,
      // refresh its timestamp instead of creating a duplicate.
      const existingId = await this.findDuplicate(
        userId,
        trimmedQuery,
        sanitizedFilters
      );
      if (existingId) {
        await updateDoc(
          doc(firestore, 'users', userId, 'searchHistory', existingId),
          {
            timestamp: serverTimestamp(),
          }
        );
        return existingId;
      }

      // Add new search
      const docRef = await addDoc(historyRef, {
        query: trimmedQuery,
        filters: sanitizedFilters,
        timestamp: serverTimestamp(),
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
   * Find an existing history entry matching the same query + filters.
   * Returns the doc ID if found, otherwise null.
   */
  private static async findDuplicate(
    userId: string,
    trimmedQuery: string,
    sanitizedFilters: Partial<SearchFilters>
  ): Promise<string | null> {
    try {
      const historyRef = collection(firestore, 'users', userId, 'searchHistory');
      // Scope by timestamp DESC + cap to the same window we keep, then match
      // query + filters in memory (filters are not individually indexable).
      const q = query(historyRef, orderBy('timestamp', 'desc'), limit(MAX_HISTORY_ITEMS));
      const snapshot = await getDocs(q);

      const targetFilters = JSON.stringify(sanitizedFilters);
      let foundId: string | null = null;

      snapshot.forEach((docSnap: any) => {
        if (foundId) return;
        const data = docSnap.data() as SearchHistoryDocument;
        const sameQuery = (data.query || '') === trimmedQuery;
        const sameFilters = JSON.stringify(data.filters || {}) === targetFilters;
        if (sameQuery && sameFilters) {
          foundId = docSnap.id;
        }
      });

      return foundId;
    } catch {
      // Non-critical: fall back to creating a new entry.
      return null;
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
    const { filters } = item;

    if (item.query) {
      parts.push(`"${item.query}"`);
    }

    if (filters.categoryIds && filters.categoryIds.length > 0) {
      // Resolve the leaf category to a human label (falls back gracefully).
      const label = getLeafCategoryLabel(filters.categoryIds);
      if (label) parts.push(label);
    }

    if (filters.brands && filters.brands.length > 0) {
      parts.push(filters.brands.slice(0, 2).join(', '));
    }

    if (filters.colors && filters.colors.length > 0) {
      parts.push(filters.colors.slice(0, 2).map(getColorName).join(', '));
    }

    if (filters.sizes && filters.sizes.length > 0) {
      // Sizes are ArticleSize objects { value, system }; render value + system.
      const sizeLabels = filters.sizes
        .slice(0, 2)
        .map((s) => `${s.value} ${s.system}`)
        .join(', ');
      parts.push(`taille ${sizeLabels}`);
    }

    if (filters.materials && filters.materials.length > 0) {
      parts.push(filters.materials.slice(0, 2).map(getMaterialName).join(', '));
    }

    if (filters.condition) {
      parts.push(getConditionLabel(filters.condition));
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      if (filters.minPrice && filters.maxPrice) {
        parts.push(`${filters.minPrice}-${filters.maxPrice} $`);
      } else if (filters.minPrice) {
        parts.push(`>${filters.minPrice} $`);
      } else if (filters.maxPrice) {
        parts.push(`<${filters.maxPrice} $`);
      }
    }

    if (filters.sortBy) {
      const sortLabel = SORT_LABELS[filters.sortBy];
      if (sortLabel) parts.push(sortLabel);
    }

    // All active filters are collected above; the generic word is only a
    // last resort when nothing is set (e.g. an empty history entry).
    return parts.join(' • ') || 'Recherche';
  }
}

/**
 * Human-readable labels for sort options (mirrors the search UI).
 * Kept local to avoid the service (core layer) importing from a feature.
 */
const SORT_LABELS: Record<NonNullable<SearchFilters['sortBy']>, string> = {
  recent: 'Plus récents',
  popular: 'Populaires',
  price_asc: 'Prix croissant',
  price_desc: 'Prix décroissant',
};

export default SearchHistoryService;
