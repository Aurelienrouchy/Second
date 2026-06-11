import {
    collection,
    doc,
    documentId,
    limit as firestoreLimit,
    getDoc,
    getDocs,
    orderBy,
    query,
    QueryDocumentSnapshot,
    startAfter,
    updateDoc,
    where
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import * as FileSystem from 'expo-file-system/legacy';
import { firestore, auth, storage, functions } from '../config/firebaseConfig';
import { Article, ArticleImage, ArticleSize } from '../types';
import {
  fixStorageUrl as fixStorageUrlUtil,
  isStorageUrl as isStorageUrlUtil,
} from '../utils/fixStorageUrl';
import { brandKey } from '../utils/normalizeBrand';
import { processImageWithBlurhash } from '../utils/imageUtils';

/**
 * Normalize free text for search query matching.
 *
 * NOTE: this exact function is duplicated verbatim in
 * `functions/src/utils/search.ts` (the search indexer). There is no shared
 * module possible between the Expo app and Cloud Functions, so the two copies
 * MUST stay in sync — any change here must be mirrored there (and vice-versa),
 * otherwise the keywords written by the indexer and the keyword built by this
 * client query diverge and matches silently break.
 *
 * Steps: NFD decompose -> strip diacritics -> lowercase -> strip punctuation
 * -> collapse whitespace -> trim.
 */
function normalizeSearchText(input: string): string {
  return (input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // strip ponctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Max Firestore batches fetched while refilling a client-filtered page.
 *
 * When a page applies client-side filters (colors/sizes/materials/brands, or
 * the popular-browse / shop-scoped paths where category/condition/price run
 * client-side), each batch over-fetches `limitCount * 5` docs and the loop runs
 * at most MAX_REFILL_BATCHES times. The bounded worst case is therefore
 * `limitCount * 5 * MAX_REFILL_BATCHES` document reads per page; if the page
 * still isn't full after the cap, `hasMore` lets the UI keep paging from the
 * last fetched cursor. A future server-side index (B2) could push these
 * predicates into Firestore and remove the over-fetch entirely.
 */
const MAX_REFILL_BATCHES = 5;

/** A page of search results plus pagination metadata. */
interface SearchPage {
  articles: Article[];
  lastVisible: QueryDocumentSnapshot | null;
  hasMore: boolean;
}

export class ArticlesService {
  /** @deprecated Import { isStorageUrl } from '@/utils/fixStorageUrl'. */
  static isStorageUrl(url: string): boolean {
    return isStorageUrlUtil(url);
  }

  /** @deprecated Import { fixStorageUrl } from '@/utils/fixStorageUrl'. */
  static fixStorageUrl(url: string): string {
    return fixStorageUrlUtil(url);
  }

  /**
   * Fix all image URLs in an article
   */
  static fixArticleImageUrls(images: ArticleImage[] | undefined): ArticleImage[] {
    if (!images || !Array.isArray(images)) {
      return [];
    }
    return images.map(img => ({
      ...img,
      url: this.fixStorageUrl(img.url),
    }));
  }

  /**
   * Create an article via the createArticle Cloud Function.
   *
   * Flow:
   * 1. If images are already Storage URLs (fast path from AI analysis) --
   *    pass them directly to the callable.
   * 2. If images are local URIs (legacy path) -- upload to Storage first
   *    using a temp ID, then pass the resulting download URLs.
   * 3. The Cloud Function validates, sanitises, and creates the article
   *    atomically in Firestore.
   */
  static async createArticle(articleData: Omit<Article, 'id' | 'createdAt' | 'views' | 'likes' | 'isActive' | 'isSold'>): Promise<string> {
    try {
      let finalImages: ArticleImage[] = [];

      if (articleData.images && articleData.images.length > 0) {
        const imageUris = articleData.images.map(img => img.url);

        // Check if images are already Storage URLs (pre-uploaded during AI analysis)
        const allStorageUrls = imageUris.every(uri => this.isStorageUrl(uri));

        if (__DEV__) console.log('[ArticlesService] createArticle:', {
          imagesCount: imageUris.length,
          allStorageUrls,
        });

        if (allStorageUrls) {
          // Fast path: images already in Storage -- use them directly
          finalImages = articleData.images.map(img => {
            const entry: ArticleImage = { url: img.url };
            if (img.blurhash) entry.blurhash = img.blurhash;
            return entry;
          });
        } else {
          // Legacy path: local URIs -- upload to Storage first.
          // We use a temp ID for the storage path; the Cloud Function will
          // create the article with a different Firestore doc ID, but the
          // images remain accessible in Storage at this path.
          const tempId = `draft_${Date.now()}`;

          if (__DEV__) console.log('[ArticlesService] Uploading local images (legacy path)...');
          finalImages = await this.uploadImagesReactNative(imageUris, tempId);

          if (finalImages.length === 0) {
            throw new Error('Aucune image uploadee');
          }
        }
      }

      // Build the payload -- remove undefined values and let the callable
      // handle defaults / sanitisation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: Record<string, any> = {
        title: articleData.title,
        description: articleData.description,
        price: articleData.price,
        images: finalImages,
        category: articleData.category,
        categoryIds: articleData.categoryIds,
        condition: articleData.condition,
        sellerName: articleData.sellerName,
        isHandDelivery: articleData.isHandDelivery,
        isShipping: articleData.isShipping,
      };

      // Optional fields
      if (articleData.size) payload.size = articleData.size;
      if (articleData.brand) payload.brand = articleData.brand;
      if (articleData.pattern) payload.pattern = articleData.pattern;
      if (articleData.sellerImage) payload.sellerImage = articleData.sellerImage;

      if (articleData.colors && articleData.colors.length > 0) {
        payload.colors = articleData.colors;
      } else if (articleData.color) {
        payload.color = articleData.color;
      }

      if (articleData.materials && articleData.materials.length > 0) {
        payload.materials = articleData.materials;
      } else if (articleData.material) {
        payload.material = articleData.material;
      }

      if (articleData.neighborhoods && articleData.neighborhoods.length > 0) {
        payload.neighborhoods = articleData.neighborhoods;
      } else if (articleData.neighborhood) {
        payload.neighborhood = articleData.neighborhood;
      }

      if (articleData.packageSize) payload.packageSize = articleData.packageSize;

      // Remove undefined values -- Firestore / callable rejects them
      const cleanedPayload = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined),
      );

      const createArticleFn = httpsCallable<
        Record<string, unknown>,
        { articleId: string }
      >(functions, 'createArticle');

      const result = await createArticleFn(cleanedPayload);
      const articleId = result.data.articleId;

      if (__DEV__) console.log('[ArticlesService] Article created via callable:', articleId);

      return articleId;
    } catch (error: any) {
      // httpsCallable wraps errors in FirebaseError with .code and .message
      const message = error.message || 'Erreur lors de la création';
      throw new Error(`Erreur lors de la création de l'article: ${message}`);
    }
  }

  static async uploadImagesReactNative(imageUris: string[], articleId: string): Promise<ArticleImage[]> {
    try {
      // Verifier que l'utilisateur est authentifie
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Utilisateur non authentifie - impossible d\'uploader');
      }
      if (__DEV__) console.log('[ArticlesService] Upload images:', { imageUris, articleId, userId: currentUser.uid });

      const uploadPromises = imageUris.map(async (uri, index) => {
        try {
          if (__DEV__) console.log(`[ArticlesService] Processing image ${index}:`, uri);

          // Compress image and generate blurhash
          const { compressedUri, blurhash } = await processImageWithBlurhash(uri, {
            maxWidth: 1200,
            maxHeight: 1200,
            quality: 0.8,
          });

          // Create Firebase Storage reference
          const storagePath = `articles/${articleId}/image_${index}_${Date.now()}.jpg`;

          // Verify local file exists
          const fileInfo = await FileSystem.getInfoAsync(compressedUri);
          if (!fileInfo.exists) {
            throw new Error(`Local file does not exist: ${compressedUri}`);
          }

          // Read file as blob and upload using web SDK
          const storageRef = ref(storage, storagePath);

          const response = await fetch(compressedUri);
          const blob = await response.blob();
          await uploadBytes(storageRef, blob);

          const downloadURL = await getDownloadURL(storageRef);

          const articleImage: ArticleImage = {
            url: downloadURL,
          };

          if (blurhash) {
            articleImage.blurhash = blurhash;
          }

          return articleImage;
        } catch (imageError: any) {
          if (__DEV__) console.error(`[ArticlesService] Error uploading image ${index}:`, imageError);
          throw imageError;
        }
      });

      const uploadedImages = await Promise.all(uploadPromises);
      if (__DEV__) console.log('[ArticlesService] All uploads done:', uploadedImages);

      return uploadedImages;
    } catch (error: any) {
      console.error('[ArticlesService] Global upload error:', error);
      throw new Error(`Erreur lors de l'upload des images: ${error.message}`);
    }
  }

  static async getArticles(
    category?: string,
    lastVisible?: QueryDocumentSnapshot,
    limitCount: number = 20,
    excludeUserId?: string
  ): Promise<{ articles: Article[], lastVisible: QueryDocumentSnapshot | null }> {
    try {
      const articlesRef = collection(firestore, 'articles');
      let constraints: any[] = [
        where('isActive', '==', true),
        where('isSold', '==', false),
        orderBy('createdAt', 'desc'),
        firestoreLimit(limitCount)
      ];

      if (category) {
        constraints = [
          where('isActive', '==', true),
          where('isSold', '==', false),
          where('category', '==', category),
          orderBy('createdAt', 'desc'),
          firestoreLimit(limitCount)
        ];
      }

      if (lastVisible) {
        constraints.push(startAfter(lastVisible));
      }

      const q = query(articlesRef, ...constraints);
      const querySnapshot = await getDocs(q);
      const articles: Article[] = [];

      querySnapshot.forEach((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();
        const article = {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt.toDate(),
          images: this.fixArticleImageUrls(data.images),
        } as Article;

        if (!excludeUserId || article.sellerId !== excludeUserId) {
          articles.push(article);
        }
      });

      const lastVisibleDoc = (querySnapshot.docs[querySnapshot.docs.length - 1] as QueryDocumentSnapshot) || null;

      return { articles, lastVisible: lastVisibleDoc };
    } catch (error: any) {
      throw new Error(`Erreur lors de la recuperation des articles: ${error.message}`);
    }
  }

  static async getArticleById(articleId: string): Promise<Article | null> {
    try {
      const docRef = doc(firestore, 'articles', articleId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        if (!data) return null;
        // Inactive (soft-deleted) articles should not be visible
        if (!data.isActive) return null;
        return {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          images: ArticlesService.fixArticleImageUrls(data.images),
        } as Article;
      }

      return null;
    } catch (error: any) {
      throw new Error(`Erreur lors de la recuperation de l'article: ${error.message}`);
    }
  }

  /**
   * Batch-fetch articles by id, returning a Map keyed by id (missing/inactive
   * ids are simply absent). Replaces an N+1 of getArticleById calls (e.g. one
   * per order/sale row, F130) with `documentId() in [...]` chunks of 30 (the
   * Firestore `in` limit). Inactive (soft-deleted) articles are excluded, same
   * as getArticleById.
   */
  static async getArticlesByIds(ids: string[]): Promise<Map<string, Article>> {
    const result = new Map<string, Article>();
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return result;

    const CHUNK = 30; // Firestore `in` operator cap.
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      chunks.push(unique.slice(i, i + CHUNK));
    }

    const snaps = await Promise.all(
      chunks.map((chunk) =>
        getDocs(
          query(collection(firestore, 'articles'), where(documentId(), 'in', chunk)),
        ),
      ),
    );

    for (const snap of snaps) {
      snap.forEach((d) => {
        const data = d.data();
        if (!data || !data.isActive) return; // mirror getArticleById
        result.set(d.id, {
          id: d.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          images: ArticlesService.fixArticleImageUrls(data.images),
        } as Article);
      });
    }

    return result;
  }

  /**
   * Map a search_index document to an Article.
   * search_index has a subset of Article fields with slightly different shapes
   * (e.g. firstImage instead of images[], no categoryIds).
   */
  private static mapSearchIndexToArticle(
    docId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>,
  ): Article {
    return {
      id: docId,
      title: data.title ?? '',
      description: data.description ?? '',
      price: data.price ?? 0,
      images: data.firstImage ? [{ url: this.fixStorageUrl(data.firstImage) }] : [],
      category: data.category ?? '',
      categoryIds: data.categoryIds ?? [],
      size: data.size ?? null,
      brand: data.brand ?? undefined,
      color: data.color ?? undefined,
      colors: data.colors ?? undefined,
      material: data.material ?? undefined,
      materials: data.materials ?? undefined,
      condition: data.condition ?? 'bon état',
      sellerId: data.sellerId ?? '',
      sellerName: data.sellerName ?? '',
      createdAt: data.createdAt?.toDate?.() ?? new Date(),
      isActive: data.isActive ?? true,
      isSold: data.isSold ?? false,
      likes: data.likes ?? 0,
      views: data.views ?? 0,
    } as Article;
  }

  static async searchArticles(
    searchTerm?: string,
    filters?: {
      category?: string;
      categoryIds?: string[];
      colors?: string[];
      sizes?: ArticleSize[];
      materials?: string[];
      condition?: string;
      minPrice?: number;
      maxPrice?: number;
      brands?: string[];
      sortBy?: 'recent' | 'price_asc' | 'price_desc' | 'popular';
      excludeUserId?: string;
      sellerId?: string;
    },
    limitCount: number = 20,
    lastVisible?: QueryDocumentSnapshot
  ): Promise<SearchPage> {
    try {
      if (__DEV__) {
        console.log('searchArticles called with:', { searchTerm, filters, limitCount });
      }

      const trimmedSearch = searchTerm?.trim() ?? '';
      const sortBy = filters?.sortBy ?? 'recent';

      // Decide which collection to query:
      // - searchTerm present -> search_index (has keywords index)
      // - sortBy=popular -> search_index (has popularityScore)
      // - otherwise -> articles (has all fields + more indexes)
      const useSearchIndex = trimmedSearch.length > 0 || sortBy === 'popular';

      if (useSearchIndex) {
        return this.searchViaSearchIndex(trimmedSearch, filters, limitCount, lastVisible, sortBy);
      }

      return this.searchViaArticles(filters, limitCount, lastVisible, sortBy);
    } catch (error: any) {
      if (__DEV__) console.error('searchArticles error:', error);
      throw new Error(`Erreur lors de la recherche: ${error.message}`);
    }
  }

  /**
   * Query the search_index collection.
   * Used when a searchTerm is present (keywords array-contains) or sortBy=popular.
   */
  private static async searchViaSearchIndex(
    trimmedSearch: string,
    filters: Parameters<typeof ArticlesService.searchArticles>[1],
    limitCount: number,
    lastVisible: QueryDocumentSnapshot | undefined,
    // sortBy is intentionally unused on the text-search path: the only usable
    // server order with `keywords array-contains` is popularityScore DESC, and
    // the UI hides price/date sort while a text term is present. Re-sorting only
    // the current page client-side would corrupt the global order and skip docs.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _sortBy: 'recent' | 'price_asc' | 'price_desc' | 'popular',
  ): Promise<SearchPage> {
    const searchIndexRef = collection(firestore, 'search_index');

    const hasTerm = trimmedSearch.length > 0;

    // Normalize the search term exactly like the indexer (NFD + strip accents
    // + strip punctuation). The first normalized keyword drives the Firestore
    // `array-contains`; the remaining ones are matched client-side against the
    // doc's `keywords` (which already contains the description tokens).
    const normalized = hasTerm ? normalizeSearchText(trimmedSearch) : '';
    const keywords = normalized.split(' ').filter(Boolean);
    const firstKeyword = keywords[0];
    const remainingKeywords = keywords.slice(1);

    // A non-empty term that normalizes to no usable keyword (pure punctuation,
    // accents only, etc.) has nothing to match — return an empty page rather
    // than falling through to the popular-browse branch (which would ignore the
    // text term and return the full popular feed).
    if (hasTerm && !firstKeyword) {
      return { articles: [], lastVisible: null, hasMore: false };
    }

    // Build the immutable part of the query (everything except the cursor).
    const buildConstraints = (
      cursor: QueryDocumentSnapshot | undefined,
      fetchLimit: number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const constraints: any[] = [];

      if (hasTerm && firstKeyword) {
        constraints.push(where('keywords', 'array-contains', firstKeyword));
        // Only usable composite index: keywords CONTAINS + popularityScore DESC.
        constraints.push(orderBy('popularityScore', 'desc'));
      } else {
        // No search term but sortBy=popular -> isActive+isSold(+condition)+popularityScore
        constraints.push(where('isActive', '==', true));
        constraints.push(where('isSold', '==', false));

        if (filters?.category) {
          constraints.push(where('category', '==', filters.category));
        }
        if (filters?.condition) {
          constraints.push(where('condition', '==', filters.condition));
        }

        constraints.push(orderBy('popularityScore', 'desc'));
      }

      constraints.push(firestoreLimit(fetchLimit));
      if (cursor) {
        constraints.push(startAfter(cursor));
      }
      return constraints;
    };

    // Client-side filters that search_index has no composite index for.
    const hasClientSideFilter = !!(
      hasTerm ||
      (filters?.categoryIds && filters.categoryIds.length > 0) ||
      (filters?.colors && filters.colors.length > 0) ||
      (filters?.sizes && filters.sizes.length > 0) ||
      (filters?.materials && filters.materials.length > 0) ||
      (filters?.brands && filters.brands.length > 0) ||
      filters?.sellerId ||
      filters?.minPrice !== undefined ||
      filters?.maxPrice !== undefined
    );
    const fetchLimit = hasClientSideFilter ? limitCount * 5 : limitCount;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matchDoc = (data: Record<string, any>): boolean => {
      // The keywords array-contains query doesn't constrain isActive/isSold.
      if (hasTerm && (!data.isActive || data.isSold)) return false;

      if (filters?.excludeUserId && data.sellerId === filters.excludeUserId) return false;
      if (filters?.sellerId && data.sellerId !== filters.sellerId) return false;

      // M2: every remaining word must be present in the doc's keywords
      // (keywords already include description tokens), not just title/brand.
      if (remainingKeywords.length > 0) {
        const docKeywords: string[] = Array.isArray(data.keywords) ? data.keywords : [];
        const allMatch = remainingKeywords.every((kw) => docKeywords.includes(kw));
        if (!allMatch) return false;
      }

      // Category filter via canonical hierarchical IDs only (no legacy fallback).
      if (filters?.categoryIds && filters.categoryIds.length > 0) {
        const targetCategoryId = filters.categoryIds[filters.categoryIds.length - 1];
        const docCategoryIds: string[] = data.categoryIds || [];
        if (!docCategoryIds.includes(targetCategoryId)) return false;
      } else if (hasTerm && filters?.category) {
        if (data.category !== filters.category) return false;
      }

      if (hasTerm && filters?.condition) {
        if (data.condition !== filters.condition) return false;
      }

      if (filters?.minPrice !== undefined && data.price < filters.minPrice) return false;
      if (filters?.maxPrice !== undefined && data.price > filters.maxPrice) return false;

      return this.matchesClientSideFilters(data, filters);
    };

    const matches: Article[] = [];
    let cursor = lastVisible;
    let lastFetchedDoc: QueryDocumentSnapshot | null = null;
    let lastBatchFull = false;

    for (let batch = 0; batch < MAX_REFILL_BATCHES; batch++) {
      const q = query(searchIndexRef, ...buildConstraints(cursor, fetchLimit));
      const snap = await getDocs(q);

      if (__DEV__) {
        console.log('search_index docs fetched:', snap.docs.length, 'batch', batch);
      }

      // A batch that returns fewer docs than requested means the collection is
      // exhausted under this query (no more pages).
      lastBatchFull = snap.docs.length === fetchLimit;
      if (snap.docs.length > 0) {
        lastFetchedDoc = snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot;
        cursor = lastFetchedDoc;
      }

      snap.forEach((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();
        if (matchDoc(data)) {
          matches.push(this.mapSearchIndexToArticle(docSnap.id, data));
        }
      });

      // Stop refilling once the collection is exhausted or the page is full.
      if (!lastBatchFull || matches.length >= limitCount) break;
    }

    const limitedArticles = matches.slice(0, limitCount);

    // hasMore: page is full AND the last Firestore batch was full (more docs may
    // exist). If the cap (MAX_REFILL_BATCHES) was hit on a full batch we still
    // report true so the UI can keep paging from lastFetchedDoc.
    const hasMore = matches.length >= limitCount && lastBatchFull;

    if (__DEV__) {
      console.log('search_index results:', limitedArticles.length, 'articles, hasMore', hasMore);
    }

    // Cursor is the last document FETCHED from Firestore (server order), never
    // the last retained article, so pagination resumes correctly.
    return { articles: limitedArticles, lastVisible: lastFetchedDoc, hasMore };
  }

  /**
   * Query the articles collection directly.
   * Used when no searchTerm and sortBy != popular.
   */
  private static async searchViaArticles(
    filters: Parameters<typeof ArticlesService.searchArticles>[1],
    limitCount: number,
    lastVisible: QueryDocumentSnapshot | undefined,
    sortBy: 'recent' | 'price_asc' | 'price_desc' | 'popular',
  ): Promise<SearchPage> {
    const articlesRef = collection(firestore, 'articles');

    // Shop-scoped search (sellerId present): keep the server query to
    // isActive + isSold + sellerId + createdAt DESC (which has a simple index)
    // and apply categoryIds / category / condition / price client-side, exactly
    // like colors/sizes/materials/brands already are. This avoids requiring a
    // new composite index per attribute combination on top of sellerId.
    const isShopScoped = !!filters?.sellerId;

    const hasPriceFilter =
      filters?.minPrice !== undefined || filters?.maxPrice !== undefined;

    // C2: when a price inequality is present (and not shop-scoped), Firestore
    // REQUIRES the inequality field to lead the ordering. So `price` must be the
    // first orderBy, with `createdAt DESC` as a stable secondary. Direction:
    // price_desc -> desc, everything else (price_asc / recent / popular) -> asc.
    const priceDir: 'asc' | 'desc' = sortBy === 'price_desc' ? 'desc' : 'asc';

    const buildConstraints = (
      cursor: QueryDocumentSnapshot | undefined,
      fetchLimit: number,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const constraints: any[] = [
        where('isActive', '==', true),
        where('isSold', '==', false),
      ];

      if (isShopScoped) {
        // Shop-scoped: only sellerId server-side, ordered by recency. All other
        // attribute filters (category / condition / price) run client-side.
        constraints.push(where('sellerId', '==', filters!.sellerId));
        constraints.push(orderBy('createdAt', 'desc'));
        constraints.push(firestoreLimit(fetchLimit));
        if (cursor) {
          constraints.push(startAfter(cursor));
        }
        return constraints;
      }

      if (filters?.categoryIds && filters.categoryIds.length > 0) {
        const targetCategoryId = filters.categoryIds[filters.categoryIds.length - 1];
        constraints.push(where('categoryIds', 'array-contains', targetCategoryId));
      } else if (filters?.category) {
        constraints.push(where('category', '==', filters.category));
      }

      if (filters?.condition) {
        constraints.push(where('condition', '==', filters.condition));
      }

      if (filters?.minPrice !== undefined) {
        constraints.push(where('price', '>=', filters.minPrice));
      }
      if (filters?.maxPrice !== undefined) {
        constraints.push(where('price', '<=', filters.maxPrice));
      }

      // Ordering.
      if (hasPriceFilter) {
        // Inequality field must lead the orderBy. createdAt DESC is the stable
        // secondary key.
        constraints.push(orderBy('price', priceDir));
        constraints.push(orderBy('createdAt', 'desc'));
      } else {
        switch (sortBy) {
          case 'price_asc':
            constraints.push(orderBy('price', 'asc'));
            constraints.push(orderBy('createdAt', 'desc'));
            break;
          case 'price_desc':
            constraints.push(orderBy('price', 'desc'));
            constraints.push(orderBy('createdAt', 'desc'));
            break;
          case 'recent':
          default:
            constraints.push(orderBy('createdAt', 'desc'));
            break;
        }
      }

      constraints.push(firestoreLimit(fetchLimit));
      if (cursor) {
        constraints.push(startAfter(cursor));
      }
      return constraints;
    };

    // Filters resolved client-side. When shop-scoped, category / condition /
    // price join the always-client-side attribute filters.
    const hasShopAttributeFilter =
      isShopScoped &&
      !!(
        (filters?.categoryIds && filters.categoryIds.length > 0) ||
        filters?.category ||
        filters?.condition ||
        hasPriceFilter
      );

    const hasClientSideFilter = !!(
      (filters?.colors && filters.colors.length > 0) ||
      (filters?.sizes && filters.sizes.length > 0) ||
      (filters?.materials && filters.materials.length > 0) ||
      (filters?.brands && filters.brands.length > 0) ||
      hasShopAttributeFilter
    );
    const fetchLimit = hasClientSideFilter ? limitCount * 5 : limitCount;

    // Shop-scoped category / condition / price predicates, applied per doc.
    const matchesShopAttributes = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: Record<string, any>,
    ): boolean => {
      if (!isShopScoped) return true;

      if (filters?.categoryIds && filters.categoryIds.length > 0) {
        const targetCategoryId = filters.categoryIds[filters.categoryIds.length - 1];
        const docCategoryIds: string[] = Array.isArray(data.categoryIds) ? data.categoryIds : [];
        if (!docCategoryIds.includes(targetCategoryId)) return false;
      } else if (filters?.category) {
        if (data.category !== filters.category) return false;
      }

      if (filters?.condition && data.condition !== filters.condition) return false;

      if (filters?.minPrice !== undefined && data.price < filters.minPrice) return false;
      if (filters?.maxPrice !== undefined && data.price > filters.maxPrice) return false;

      return true;
    };

    const matches: Article[] = [];
    let cursor = lastVisible;
    let lastFetchedDoc: QueryDocumentSnapshot | null = null;
    let lastBatchFull = false;

    for (let batch = 0; batch < MAX_REFILL_BATCHES; batch++) {
      const q = query(articlesRef, ...buildConstraints(cursor, fetchLimit));
      const snap = await getDocs(q);

      if (__DEV__) {
        console.log('articles docs fetched:', snap.docs.length, 'batch', batch);
      }

      lastBatchFull = snap.docs.length === fetchLimit;
      if (snap.docs.length > 0) {
        lastFetchedDoc = snap.docs[snap.docs.length - 1] as QueryDocumentSnapshot;
        cursor = lastFetchedDoc;
      }

      snap.forEach((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();
        if (filters?.excludeUserId && data.sellerId === filters.excludeUserId) return;
        if (!matchesShopAttributes(data)) return;
        if (!this.matchesClientSideFilters(data, filters)) return;

        matches.push({
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt.toDate(),
          images: this.fixArticleImageUrls(data.images),
        } as Article);
      });

      if (!lastBatchFull || matches.length >= limitCount) break;
    }

    const limitedArticles = matches.slice(0, limitCount);
    const hasMore = matches.length >= limitCount && lastBatchFull;

    if (__DEV__) {
      console.log('articles results:', limitedArticles.length, 'articles, hasMore', hasMore);
    }

    // Cursor is the last document FETCHED from Firestore, never the last retained
    // article, so pagination resumes correctly even when a full batch is filtered out.
    return { articles: limitedArticles, lastVisible: lastFetchedDoc, hasMore };
  }

  /**
   * Apply client-side attribute filters (colors, sizes, materials, brands).
   * Works with both articles and search_index documents.
   *
   * All matching is strict equality on canonical IDs (no substring), so e.g.
   * `bleu` no longer matches `bleu-marine`, `or` no longer matches `bordeaux`,
   * `cuir` no longer matches `cuir-synthetique`, and `Gap` no longer matches
   * `Gap Kids`. Object sizes ({ value, system }) match exactly on both fields
   * so US/EU never collide; legacy string sizes match by value only.
   * Articles missing the filtered attribute are excluded.
   */
  private static matchesClientSideFilters(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>,
    filters?: {
      colors?: string[];
      sizes?: ArticleSize[];
      materials?: string[];
      brands?: string[];
    },
  ): boolean {
    if (filters?.colors && filters.colors.length > 0) {
      const articleColors: string[] = data.colors || (data.color ? [data.color] : []);
      if (articleColors.length === 0) return false;
      const matches = filters.colors.some((color) => articleColors.includes(color));
      if (!matches) return false;
    }

    if (filters?.sizes && filters.sizes.length > 0) {
      const articleSize = data.size;
      if (!articleSize) return false;
      if (typeof articleSize === 'object') {
        // Canonical ArticleSize { value, system }: match on both fields so
        // US/EU never collide.
        const matches = filters.sizes.some(
          (f) => f.value === articleSize.value && f.system === articleSize.system,
        );
        if (!matches) return false;
      } else {
        // Legacy size stored as a bare string: compare by value only (the
        // system is unknown), so legacy docs and personalized-feed string
        // filters still match.
        const articleSizeValue = String(articleSize);
        const matches = filters.sizes.some((f) => f.value === articleSizeValue);
        if (!matches) return false;
      }
    }

    if (filters?.materials && filters.materials.length > 0) {
      const articleMaterials: string[] = data.materials || (data.material ? [data.material] : []);
      if (articleMaterials.length === 0) return false;
      const matches = filters.materials.some((material) => articleMaterials.includes(material));
      if (!matches) return false;
    }

    if (filters?.brands && filters.brands.length > 0) {
      if (!data.brand) return false;
      // Normalize both sides (lowercase + trim via brandKey) then compare exactly.
      const docBrandKey = brandKey(data.brand as string);
      const matches = filters.brands.some((brand) => brandKey(brand) === docBrandKey);
      if (!matches) return false;
    }

    return true;
  }

  static async searchArticlesSimple(searchTerm: string, limitCount: number = 20): Promise<Article[]> {
    const result = await this.searchArticles(searchTerm, undefined, limitCount);
    return result.articles;
  }

  static async getUserArticles(userId: string): Promise<Article[]> {
    try {
      const articlesRef = collection(firestore, 'articles');
      const q = query(
        articlesRef,
        where('sellerId', '==', userId),
        where('isActive', '==', true),
        orderBy('createdAt', 'desc')
      );

      const querySnapshot = await getDocs(q);
      const articles: Article[] = [];

      querySnapshot.forEach((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();

        articles.push({
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt.toDate(),
          images: this.fixArticleImageUrls(data.images),
        } as Article);
      });

      return articles;
    } catch (error: any) {
      throw new Error(`Erreur lors de la recuperation des articles utilisateur: ${error.message}`);
    }
  }

  static async updateArticle(articleId: string, updates: Partial<Article>): Promise<void> {
    try {
      const docRef = doc(firestore, 'articles', articleId);
      await updateDoc(docRef, updates);
    } catch (error: any) {
      throw new Error(`Erreur lors de la mise a jour de l'article: ${error.message}`);
    }
  }

  static async deleteArticle(articleId: string): Promise<void> {
    try {
      const updateArticleFn = httpsCallable<
        { articleId: string; updates: { isActive: boolean } },
        { success: boolean }
      >(functions, 'updateArticle');

      await updateArticleFn({ articleId, updates: { isActive: false } });
    } catch (error: any) {
      const message = error.message || 'Erreur lors de la suppression';
      throw new Error(`Erreur lors de la suppression de l'article: ${message}`);
    }
  }

  static async uploadImages(files: File[], articleId: string): Promise<string[]> {
    try {
      const uploadPromises = files.map(async (file, index) => {
        const storagePath = `articles/${articleId}/image_${index}_${Date.now()}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        return getDownloadURL(storageRef);
      });

      return await Promise.all(uploadPromises);
    } catch (error: any) {
      throw new Error(`Erreur lors de l'upload des images: ${error.message}`);
    }
  }

  static async deleteImage(imageUrl: string): Promise<void> {
    try {
      const imageRef = ref(storage, imageUrl);
      await deleteObject(imageRef);
    } catch (error: any) {
      throw new Error(`Erreur lors de la suppression de l'image: ${error.message}`);
    }
  }
}
