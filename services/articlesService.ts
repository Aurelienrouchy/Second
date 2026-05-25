import {
    collection,
    doc,
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
import { Article, ArticleImage } from '../types';
import {
  fixStorageUrl as fixStorageUrlUtil,
  isStorageUrl as isStorageUrlUtil,
} from '../utils/fixStorageUrl';
import { processImageWithBlurhash } from '../utils/imageUtils';

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
      const message = error.message || 'Erreur lors de la creation';
      throw new Error(`Erreur lors de la creation de l'article: ${message}`);
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

  static async searchArticles(
    searchTerm?: string,
    filters?: {
      category?: string;
      categoryIds?: string[];
      colors?: string[];
      sizes?: string[];
      materials?: string[];
      condition?: string;
      minPrice?: number;
      maxPrice?: number;
      brands?: string[];
      patterns?: string[];
      sortBy?: 'recent' | 'price_asc' | 'price_desc' | 'popular';
      excludeUserId?: string;
    },
    limitCount: number = 20,
    lastVisible?: QueryDocumentSnapshot
  ): Promise<{ articles: Article[], lastVisible: QueryDocumentSnapshot | null }> {
    try {
      if (__DEV__) {
        console.log('searchArticles called with:', { searchTerm, filters, limitCount });
      }
      const articlesRef = collection(firestore, 'articles');
      let constraints: any[] = [
        where('isActive', '==', true),
        where('isSold', '==', false)
      ];

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

      const hasClientSideFilter = !!(
        (searchTerm && searchTerm.trim()) ||
        (filters?.colors && filters.colors.length > 0) ||
        (filters?.sizes && filters.sizes.length > 0) ||
        (filters?.materials && filters.materials.length > 0) ||
        (filters?.brands && filters.brands.length > 0) ||
        (filters?.patterns && filters.patterns.length > 0)
      );
      const fetchLimit = hasClientSideFilter ? limitCount * 3 : limitCount;
      constraints.push(orderBy('createdAt', 'desc'));
      constraints.push(firestoreLimit(fetchLimit));

      if (lastVisible) {
        constraints.push(startAfter(lastVisible));
      }

      const q = query(articlesRef, ...constraints);
      const querySnapshot = await getDocs(q);
      if (__DEV__) {
        console.log('Documents fetched:', querySnapshot.docs.length);
      }
      const articles: Article[] = [];

      querySnapshot.forEach((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();
        const article = {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt.toDate(),
          images: this.fixArticleImageUrls(data.images),
        } as Article;

        if (filters?.excludeUserId && article.sellerId === filters.excludeUserId) {
          return;
        }

        let matches = true;

        if (searchTerm && searchTerm.trim()) {
          const searchLower = searchTerm.toLowerCase();
          const titleMatch = (article.title || '').toLowerCase().includes(searchLower);
          matches = matches && titleMatch;
        }

        if (filters?.colors && filters.colors.length > 0 && article.color) {
          matches = matches && filters.colors.some(color =>
            article.color?.toLowerCase().includes(color.toLowerCase())
          );
        }

        if (filters?.sizes && filters.sizes.length > 0 && article.size) {
          matches = matches && filters.sizes.includes(article.size);
        }

        if (filters?.materials && filters.materials.length > 0 && article.material) {
          matches = matches && filters.materials.some(material =>
            article.material?.toLowerCase().includes(material.toLowerCase())
          );
        }

        if (filters?.brands && filters.brands.length > 0 && article.brand) {
          matches = matches && filters.brands.some(brand =>
            article.brand?.toLowerCase().includes(brand.toLowerCase())
          );
        }

        if (filters?.patterns && filters.patterns.length > 0 && article.pattern) {
          matches = matches && filters.patterns.some(pattern =>
            article.pattern?.toLowerCase().includes(pattern.toLowerCase())
          );
        }

        if (matches) {
          articles.push(article);
        }
      });

      if (filters?.sortBy) {
        switch (filters.sortBy) {
          case 'price_asc':
            articles.sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
            break;
          case 'price_desc':
            articles.sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
            break;
          case 'popular':
            articles.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
            break;
          case 'recent':
          default:
            articles.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            break;
        }
      }

      const limitedArticles = articles.slice(0, limitCount);
      const idx = Math.min(querySnapshot.docs.length - 1, limitedArticles.length - 1);
      const lastVisibleDoc = (querySnapshot.docs[idx] as QueryDocumentSnapshot) || null;

      if (__DEV__) {
        console.log('Final results:', limitedArticles.length, 'articles');
      }
      return { articles: limitedArticles, lastVisible: lastVisibleDoc };
    } catch (error: any) {
      if (__DEV__) console.error('searchArticles error:', error);
      throw new Error(`Erreur lors de la recherche: ${error.message}`);
    }
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
        orderBy('createdAt', 'desc')
      );

      const querySnapshot = await getDocs(q);
      const articles: Article[] = [];

      querySnapshot.forEach((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();
        if (data.isActive === false) return;

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
      await this.updateArticle(articleId, { isActive: false });
    } catch (error: any) {
      throw new Error(`Erreur lors de la suppression de l'article: ${error.message}`);
    }
  }

  static async markAsSold(articleId: string): Promise<void> {
    try {
      await this.updateArticle(articleId, { isSold: true });
    } catch (error: any) {
      throw new Error(`Erreur lors du marquage comme vendu: ${error.message}`);
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
