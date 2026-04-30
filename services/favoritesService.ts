/**
 * FavoritesService — Firestore operations for the favorites system.
 *
 * Unified on a single structure: `favorites/{userId}.articleIds` (string[]).
 * The old `products` array with metadata has been removed — article details
 * are fetched on-demand via paginated queries.
 *
 * Changes from previous version:
 * - Removed getFavoriteCount() (use denormalised `favoritesCount` on articles)
 * - Added getUserFavoriteArticlesPaginated() for the favorites screen
 * - addToFavorites / removeFromFavorites simplified (single write)
 */

import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  QueryDocumentSnapshot,
  setDoc,
  updateDoc,
  where,
  limit as firestoreLimit,
  orderBy,
} from 'firebase/firestore';
import { firestore } from '../config/firebaseConfig';
import { Article } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginatedFavorites {
  articles: Article[];
  /** Cursor for the next page (index into the articleIds array) */
  nextCursor: number | null;
}

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

export class FavoritesService {
  /**
   * Add an article to the user's favorites.
   * Uses arrayUnion for atomic, idempotent add.
   */
  static async addToFavorites(userId: string, articleId: string): Promise<void> {
    const ref = doc(firestore, 'favorites', userId);
    await setDoc(
      ref,
      {
        userId,
        articleIds: arrayUnion(articleId),
        updatedAt: new Date(),
      },
      { merge: true }
    );
  }

  /**
   * Remove an article from the user's favorites.
   * Uses arrayRemove for atomic removal.
   */
  static async removeFromFavorites(userId: string, articleId: string): Promise<void> {
    const ref = doc(firestore, 'favorites', userId);
    await updateDoc(ref, {
      articleIds: arrayRemove(articleId),
      updatedAt: new Date(),
    });
  }

  /**
   * Get the raw list of favorite article IDs for a user.
   */
  static async getUserFavorites(userId: string): Promise<string[]> {
    const ref = doc(firestore, 'favorites', userId);
    const snap = await getDoc(ref);

    if (!snap.exists()) return [];
    const data = (snap.data() as Record<string, unknown>) || {};
    return Array.isArray(data.articleIds) ? (data.articleIds as string[]) : [];
  }

  // ---------------------------------------------------------------------------
  // Paginated article fetching (for the Favorites screen)
  // ---------------------------------------------------------------------------

  /**
   * Fetch a page of favorite articles with full Article data.
   *
   * Instead of loading ALL favorites at once, this slices the `articleIds`
   * array and fetches only the articles for that page.
   *
   * @param userId  - Authenticated user ID
   * @param cursor  - Start index in the articleIds array (0 for first page)
   * @param pageSize - Number of articles per page (default 20)
   */
  static async getUserFavoriteArticlesPaginated(
    userId: string,
    cursor: number = 0,
    pageSize: number = 20
  ): Promise<PaginatedFavorites> {
    // 1. Get all favorite IDs (single doc read, very cheap)
    const allIds = await this.getUserFavorites(userId);

    if (allIds.length === 0 || cursor >= allIds.length) {
      return { articles: [], nextCursor: null };
    }

    // 2. Slice the page from the IDs array (most recent first)
    const reversedIds = [...allIds].reverse();
    const pageIds = reversedIds.slice(cursor, cursor + pageSize);

    // 3. Fetch articles in batches of 10 (Firestore `in` limit)
    const articles: Article[] = [];
    const batchSize = 10;

    for (let i = 0; i < pageIds.length; i += batchSize) {
      const batch = pageIds.slice(i, i + batchSize);
      const articlesRef = collection(firestore, 'articles');
      const qRef = query(articlesRef, where('__name__', 'in', batch));
      const snapshot = await getDocs(qRef);

      snapshot.forEach((d: QueryDocumentSnapshot) => {
        if (d.exists()) {
          articles.push({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() ?? new Date(),
          } as Article);
        }
      });
    }

    // 4. Preserve the order from pageIds (Firestore `in` doesn't guarantee order)
    const orderMap = new Map(pageIds.map((id, idx) => [id, idx]));
    articles.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));

    // 5. Determine next cursor
    const nextCursor = cursor + pageSize < reversedIds.length ? cursor + pageSize : null;

    return { articles, nextCursor };
  }

  /**
   * Legacy method — fetch ALL favorite articles at once.
   * Kept for backward compatibility but prefer the paginated version.
   */
  static async getUserFavoriteArticles(userId: string): Promise<Article[]> {
    const result = await this.getUserFavoriteArticlesPaginated(userId, 0, 1000);
    return result.articles;
  }

  /**
   * Check if an article is in the user's favorites.
   * Prefer using the Zustand store's `isFavorite()` for O(1) checks.
   */
  static async isFavorite(userId: string, articleId: string): Promise<boolean> {
    const ids = await this.getUserFavorites(userId);
    return ids.includes(articleId);
  }
}
