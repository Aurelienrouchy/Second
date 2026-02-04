import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from '@react-native-firebase/firestore';
import { firestore } from '../config/firebaseConfig';
import { SearchFilters } from '../types';

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters: Partial<SearchFilters>;
  createdAt: Date;
  lastNotifiedAt?: Date;
  notifyNewItems: boolean;
  newItemsCount?: number; // Count of new items since last notification
}

interface SavedSearchDocument {
  name: string;
  query: string;
  filters: Partial<SearchFilters>;
  createdAt: Timestamp;
  lastNotifiedAt?: Timestamp;
  notifyNewItems: boolean;
  newItemsCount?: number;
}

/**
 * Service for managing saved searches with notification alerts.
 * Path: users/{userId}/savedSearches/
 */
export class SavedSearchService {
  /**
   * Save a new search with optional notification alerts.
   */
  static async saveSearch(
    userId: string,
    name: string,
    searchQuery: string,
    filters: Partial<SearchFilters>,
    notifyNewItems: boolean = false
  ): Promise<string> {
    try {
      const savedSearchesRef = collection(firestore, 'users', userId, 'savedSearches');

      const docRef = await addDoc(savedSearchesRef, {
        name: name.trim() || this.generateDefaultName(searchQuery, filters),
        query: searchQuery.trim(),
        filters: this.sanitizeFilters(filters),
        createdAt: serverTimestamp(),
        lastNotifiedAt: serverTimestamp(), // Start from now
        notifyNewItems,
        newItemsCount: 0,
      });

      return docRef.id;
    } catch (error: any) {
      console.error('Error saving search:', error);
      throw new Error(`Erreur lors de la sauvegarde: ${error.message}`);
    }
  }

  /**
   * Get all saved searches for a user.
   */
  static async getSavedSearches(userId: string): Promise<SavedSearch[]> {
    try {
      const savedSearchesRef = collection(firestore, 'users', userId, 'savedSearches');
      const q = query(savedSearchesRef, orderBy('createdAt', 'desc'));

      const snapshot = await getDocs(q);
      const searches: SavedSearch[] = [];

      snapshot.forEach((docSnap: any) => {
        const data = docSnap.data() as SavedSearchDocument;
        searches.push({
          id: docSnap.id,
          name: data.name,
          query: data.query,
          filters: data.filters,
          createdAt: data.createdAt?.toDate() || new Date(),
          lastNotifiedAt: data.lastNotifiedAt?.toDate(),
          notifyNewItems: data.notifyNewItems,
          newItemsCount: data.newItemsCount,
        });
      });

      return searches;
    } catch (error: any) {
      console.error('Error getting saved searches:', error);
      throw new Error(`Erreur lors de la récupération: ${error.message}`);
    }
  }

  /**
   * Get a single saved search by ID.
   */
  static async getSavedSearchById(userId: string, searchId: string): Promise<SavedSearch | null> {
    try {
      const docRef = doc(firestore, 'users', userId, 'savedSearches', searchId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        return null;
      }

      const data = docSnap.data() as SavedSearchDocument;
      return {
        id: docSnap.id,
        name: data.name,
        query: data.query,
        filters: data.filters,
        createdAt: data.createdAt?.toDate() || new Date(),
        lastNotifiedAt: data.lastNotifiedAt?.toDate(),
        notifyNewItems: data.notifyNewItems,
        newItemsCount: data.newItemsCount,
      };
    } catch (error: any) {
      console.error('Error getting saved search:', error);
      throw new Error(`Erreur lors de la récupération: ${error.message}`);
    }
  }

  /**
   * Update a saved search.
   */
  static async updateSavedSearch(
    userId: string,
    searchId: string,
    updates: Partial<Pick<SavedSearch, 'name' | 'notifyNewItems'>>
  ): Promise<void> {
    try {
      const docRef = doc(firestore, 'users', userId, 'savedSearches', searchId);
      await updateDoc(docRef, updates);
    } catch (error: any) {
      console.error('Error updating saved search:', error);
      throw new Error(`Erreur lors de la mise à jour: ${error.message}`);
    }
  }

  /**
   * Toggle notification alerts for a saved search.
   */
  static async toggleNotifications(userId: string, searchId: string): Promise<boolean> {
    try {
      const docRef = doc(firestore, 'users', userId, 'savedSearches', searchId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        throw new Error('Recherche sauvegardée introuvable');
      }

      const currentValue = (docSnap.data() as SavedSearchDocument).notifyNewItems;
      const newValue = !currentValue;

      await updateDoc(docRef, {
        notifyNewItems: newValue,
        // Reset lastNotifiedAt when enabling notifications
        ...(newValue && { lastNotifiedAt: serverTimestamp() }),
      });

      return newValue;
    } catch (error: any) {
      console.error('Error toggling notifications:', error);
      throw new Error(`Erreur lors du changement de notification: ${error.message}`);
    }
  }

  /**
   * Delete a saved search.
   */
  static async deleteSavedSearch(userId: string, searchId: string): Promise<void> {
    try {
      const docRef = doc(firestore, 'users', userId, 'savedSearches', searchId);
      await deleteDoc(docRef);
    } catch (error: any) {
      console.error('Error deleting saved search:', error);
      throw new Error(`Erreur lors de la suppression: ${error.message}`);
    }
  }

  /**
   * Update the lastNotifiedAt timestamp (called by Cloud Function).
   */
  static async updateLastNotified(
    userId: string,
    searchId: string,
    newItemsCount: number
  ): Promise<void> {
    try {
      const docRef = doc(firestore, 'users', userId, 'savedSearches', searchId);
      await updateDoc(docRef, {
        lastNotifiedAt: serverTimestamp(),
        newItemsCount,
      });
    } catch (error: any) {
      console.error('Error updating lastNotifiedAt:', error);
    }
  }

  /**
   * Reset new items count (called when user views the search).
   */
  static async resetNewItemsCount(userId: string, searchId: string): Promise<void> {
    try {
      const docRef = doc(firestore, 'users', userId, 'savedSearches', searchId);
      await updateDoc(docRef, {
        newItemsCount: 0,
      });
    } catch (error: any) {
      console.error('Error resetting new items count:', error);
    }
  }

  /**
   * Generate a default name for a saved search.
   */
  private static generateDefaultName(query: string, filters: Partial<SearchFilters>): string {
    const parts: string[] = [];

    if (query) {
      parts.push(query);
    }

    if (filters.categoryIds && filters.categoryIds.length > 0) {
      // Use last category ID as it's most specific
      parts.push(filters.categoryIds[filters.categoryIds.length - 1]);
    }

    if (filters.brands && filters.brands.length > 0) {
      parts.push(filters.brands[0]);
    }

    if (parts.length === 0) {
      return 'Ma recherche';
    }

    return parts.slice(0, 2).join(' - ');
  }

  /**
   * Sanitize filters for storage.
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
}

export default SavedSearchService;
