import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    doc,
    limit as firestoreLimit,
    getDoc,
    getDocs,
    increment,
    orderBy,
    query,
    startAfter,
    updateDoc,
    where
} from '@react-native-firebase/firestore';
import storageModule from '@react-native-firebase/storage';
import * as FileSystem from 'expo-file-system';
import { firestore, auth } from '../config/firebaseConfig';
import { Article, ArticleImage } from '../types';
import { processImageWithBlurhash } from '../utils/imageUtils';

export class ArticlesService {
  /**
   * Check if a URL is already a Firebase Storage URL
   */
  static isStorageUrl(url: string): boolean {
    return url.startsWith('https://firebasestorage.googleapis.com') ||
           url.includes('.appspot.com') ||
           url.includes('.firebasestorage.app');
  }

  /**
   * Fix Firebase Storage URL to ensure path is properly URL-encoded
   * Some URLs may have been stored with un-encoded paths which causes 400 errors
   */
  static fixStorageUrl(url: string): string {
    if (!url || !this.isStorageUrl(url)) {
      return url;
    }

    try {
      // The path in Firebase Storage URLs is after /o/
      // e.g., https://firebasestorage.googleapis.com/v0/b/bucket/o/drafts/draftId/file.jpg
      const pathMatch = url.match(/\/o\/([^?]+)/);
      if (!pathMatch) {
        return url;
      }

      const storagePath = pathMatch[1];

      // Check if already encoded (contains %2F)
      if (storagePath.includes('%2F')) {
        return url; // Already encoded
      }

      // Encode the path segments
      const encodedPath = storagePath
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('%2F');

      // Reconstruct the URL
      return url.replace(`/o/${storagePath}`, `/o/${encodedPath}`);
    } catch (error) {
      console.warn('[ArticlesService] Failed to fix Storage URL:', error);
      return url;
    }
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

  static async createArticle(articleData: Omit<Article, 'id' | 'createdAt' | 'views' | 'likes' | 'isActive' | 'isSold'>): Promise<string> {
    try {
      // Ensure sellerId is present (handle stale closure case)
      let finalSellerId = articleData.sellerId;
      let finalSellerName = articleData.sellerName;

      if (!finalSellerId) {
        const currentUser = auth.currentUser;
        if (currentUser) {
          finalSellerId = currentUser.uid;
          if (!finalSellerName) {
            finalSellerName = currentUser.displayName || 'Utilisateur';
          }
        } else {
          throw new Error("Utilisateur non connecté");
        }
      }

      const newArticle = {
        ...articleData,
        sellerId: finalSellerId,
        sellerName: finalSellerName,
        images: [],
        createdAt: new Date(),
        views: 0,
        likes: 0,
        isActive: true,
        isSold: false,
      };

      // Remove undefined values - Firestore doesn't accept undefined
      const cleanedArticle = Object.fromEntries(
        Object.entries(newArticle).filter(([_, value]) => value !== undefined)
      );

      const docRef = await addDoc(collection(firestore, 'articles'), cleanedArticle);
      const articleId = docRef.id;

      console.log('📸 [ArticlesService] Article created:', {
        articleId,
        hasImages: !!(articleData.images && articleData.images.length > 0),
        imagesCount: articleData.images?.length || 0,
      });

      if (articleData.images && articleData.images.length > 0) {
        try {
          const imageUris = articleData.images.map(img => img.url);

          console.log('📸 [ArticlesService] Processing images:', {
            count: imageUris.length,
            urls: imageUris,
          });

          // Check if images are already Storage URLs (pre-uploaded during AI analysis)
          const allStorageUrls = imageUris.every(uri => this.isStorageUrl(uri));
          console.log('📸 [ArticlesService] isStorageUrl check:', {
            allStorageUrls,
            urlChecks: imageUris.map(uri => ({ uri: uri.substring(0, 80), isStorage: this.isStorageUrl(uri) })),
          });

          if (allStorageUrls) {
            // Images already in Storage - just use them directly (fast path!)
            console.log('📸 Images already in Storage, skipping re-upload');
            const existingImages: ArticleImage[] = articleData.images.map(img => ({
              url: img.url,
              ...(img.blurhash ? { blurhash: img.blurhash } : {}),
            }));

            console.log('📸 [ArticlesService] Updating article with images:', {
              articleId,
              imagesCount: existingImages.length,
              images: existingImages,
            });

            try {
              await updateDoc(docRef, {
                images: existingImages
              });
              console.log('📸 [ArticlesService] ✅ Article images updated successfully');
            } catch (updateError: any) {
              console.error('📸 [ArticlesService] ❌ Failed to update article with images:', updateError);
              throw updateError;
            }
          } else {
            // Local files - need to upload (legacy path)
            console.log('📸 [ArticlesService] Uploading local images to Storage (legacy path)...');
            console.log('📸 [ArticlesService] Local image URIs:', imageUris);
            const uploadedImages = await this.uploadImagesReactNative(imageUris, articleId);

            console.log('📸 [ArticlesService] Upload result:', {
              uploadedCount: uploadedImages.length,
              uploadedImages,
            });

            if (uploadedImages.length > 0) {
              try {
                await updateDoc(docRef, {
                  images: uploadedImages
                });
                console.log('📸 [ArticlesService] ✅ Article updated with uploaded images');
              } catch (updateError: any) {
                console.error('📸 [ArticlesService] ❌ Failed to update article with uploaded images:', updateError);
                throw updateError;
              }
            } else {
              console.log('📸 [ArticlesService] ⚠️ No images were uploaded, marking as failed');
              try {
                await updateDoc(docRef, {
                  images: articleData.images,
                  uploadStatus: 'failed'
                });
              } catch (updateError: any) {
                console.error('📸 [ArticlesService] ❌ Failed to update article with failed status:', updateError);
              }
            }
          }
        } catch (uploadError) {
          throw new Error(`Article créé mais erreur upload images: ${uploadError}`);
        }
      }

      return articleId;
    } catch (error: any) {
      throw new Error(`Erreur lors de la création de l'article: ${error.message}`);
    }
  }

  static async uploadImagesReactNative(imageUris: string[], articleId: string): Promise<ArticleImage[]> {
    try {
      // Vérifier que l'utilisateur est authentifié
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié - impossible d\'uploader');
      }
      console.log('🚀 Début upload images avec compression et blurhash:', { imageUris, articleId, userId: currentUser.uid });

      const uploadPromises = imageUris.map(async (uri, index) => {
        try {
          console.log(`📸 Traitement image ${index}:`, uri);

          // Compresser l'image et générer le blurhash
          const { compressedUri, blurhash } = await processImageWithBlurhash(uri, {
            maxWidth: 1200,
            maxHeight: 1200,
            quality: 0.8,
          });

          console.log(`🗜️ Image ${index} compressée:`, compressedUri);
          console.log(`🎨 Blurhash généré pour image ${index}:`, blurhash);

          // Créer une référence Firebase Storage
          const storagePath = `articles/${articleId}/image_${index}_${Date.now()}.jpg`;
          console.log(`☁️ Upload vers Firebase Storage:`, storagePath);

          // Utiliser l'API namespaced pour React Native (putFile)
          const localPath = compressedUri.startsWith('file://')
            ? compressedUri.replace('file://', '')
            : compressedUri;

          // Vérifier que le fichier local existe
          const fileInfo = await FileSystem.getInfoAsync(compressedUri);
          if (!fileInfo.exists) {
            throw new Error(`Local file does not exist: ${compressedUri}`);
          }
          console.log(`📤 Upload fichier local (${(fileInfo.size || 0) / 1024}KB):`, localPath);

          // Créer la référence et uploader avec l'API namespaced
          const storageRef = storageModule().ref(storagePath);

          try {
            // Attendre la completion de la tâche
            const taskResult = await storageRef.putFile(localPath);
            console.log(`✅ Upload terminé pour image ${index}:`, taskResult.state, `${taskResult.bytesTransferred} bytes`);

            // Vérifier que l'upload a réussi
            if (taskResult.state !== 'success') {
              throw new Error(`Upload failed with state: ${taskResult.state}`);
            }
          } catch (uploadError: any) {
            console.error(`❌ putFile error:`, uploadError.code, uploadError.message);
            throw uploadError;
          }

          const downloadURL = await storageRef.getDownloadURL();
          console.log(`🔗 URL générée pour image ${index}:`, downloadURL);

          const articleImage: ArticleImage = {
            url: downloadURL,
          };

          // Seulement ajouter blurhash s'il est défini
          if (blurhash) {
            articleImage.blurhash = blurhash;
          }

          return articleImage;
        } catch (imageError: any) {
          console.error(`❌ Erreur upload image ${index}:`, imageError);
          throw imageError;
        }
      });

      const uploadedImages = await Promise.all(uploadPromises);
      console.log('✅ Tous les uploads terminés avec blurhash:', uploadedImages);

      return uploadedImages;
    } catch (error: any) {
      console.error('❌ Erreur globale upload images:', error);
      throw new Error(`Erreur lors de l'upload des images: ${error.message}`);
    }
  }

  static async getArticles(
    category?: string,
    lastVisible?: FirebaseFirestoreTypes.QueryDocumentSnapshot,
    limitCount: number = 20,
    excludeUserId?: string
  ): Promise<{ articles: Article[], lastVisible: FirebaseFirestoreTypes.QueryDocumentSnapshot | null }> {
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
      
      querySnapshot.forEach((docSnap: FirebaseFirestoreTypes.QueryDocumentSnapshot) => {
        const data = docSnap.data();
        const article = {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt.toDate(),
          images: this.fixArticleImageUrls(data.images),
        } as Article;
        
        // Exclure les articles de l'utilisateur connecté
        if (!excludeUserId || article.sellerId !== excludeUserId) {
          articles.push(article);
        }
      });

      const lastVisibleDoc = (querySnapshot.docs[querySnapshot.docs.length - 1] as FirebaseFirestoreTypes.QueryDocumentSnapshot) || null;

      return { articles, lastVisible: lastVisibleDoc };
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des articles: ${error.message}`);
    }
  }

  static async getArticleById(articleId: string): Promise<Article | null> {
    try {
      const docRef = doc(firestore, 'articles', articleId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        // Incrémenter les vues
        // Note: Désactivé temporairement pour éviter les erreurs de permission si l'utilisateur n'est pas authentifié
        // L'idéal serait de faire cela via une Cloud Function ou d'autoriser l'écriture sur ce champ spécifique
        /*
        try {
          await updateDoc(docRef, {
            views: increment(1)
          });
        } catch (e) {
          console.warn('Impossible d\'incrémenter les vues:', e);
        }
        */

        const data = docSnap.data();
        if (!data) return null;
        return {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          images: ArticlesService.fixArticleImageUrls(data.images),
        } as Article;
      }

      return null;
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération de l'article: ${error.message}`);
    }
  }

  static async searchArticles(
    searchTerm?: string,
    filters?: {
      category?: string;
      categoryIds?: string[]; // Ajout du nouveau filtre
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
    lastVisible?: FirebaseFirestoreTypes.QueryDocumentSnapshot
  ): Promise<{ articles: Article[], lastVisible: FirebaseFirestoreTypes.QueryDocumentSnapshot | null }> {
    try {
      console.log('🔍 searchArticles appelé avec:', { searchTerm, filters, limitCount });
      const articlesRef = collection(firestore, 'articles');
      let constraints: any[] = [
        where('isActive', '==', true),
        where('isSold', '==', false)
      ];

      // Filtres Firebase (côté serveur)
      
      // Nouvelle méthode de filtrage par catégorie (plus flexible)
      if (filters?.categoryIds && filters.categoryIds.length > 0) {
        // On filtre sur le dernier ID (le plus spécifique)
        // Ex: si on cherche "Maison > Décoration", on cherche tous les articles ayant l'ID "home_decoration"
        const targetCategoryId = filters.categoryIds[filters.categoryIds.length - 1];
        constraints.push(where('categoryIds', 'array-contains', targetCategoryId));
      } 
      // Fallback sur l'ancienne méthode si pas de categoryIds
      else if (filters?.category) {
        constraints.push(where('category', '==', filters.category));
      }

      if (filters?.condition) {
        constraints.push(where('condition', '==', filters.condition));
      }

      // Filtres de prix
      if (filters?.minPrice !== undefined) {
        constraints.push(where('price', '>=', filters.minPrice));
      }
      if (filters?.maxPrice !== undefined) {
        constraints.push(where('price', '<=', filters.maxPrice));
      }

      // Ordre et limite (on utilise createdAt desc par défaut côté serveur)
      constraints.push(orderBy('createdAt', 'desc'));
      constraints.push(firestoreLimit(limitCount * 5)); // récupérer plus pour filtrage client

      // Pagination
      if (lastVisible) {
        constraints.push(startAfter(lastVisible));
      }

      const q = query(articlesRef, ...constraints);
      console.log('🔍 Exécution de la requête Firestore...');
      const querySnapshot = await getDocs(q);
      console.log('📊 Nombre de documents récupérés:', querySnapshot.docs.length);
      const articles: Article[] = [];

      querySnapshot.forEach((docSnap: FirebaseFirestoreTypes.QueryDocumentSnapshot) => {
        const data = docSnap.data();
        console.log('📄 Document trouvé:', docSnap.id, 'images:', data.images?.length || 0);
        const article = {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt.toDate(),
          images: this.fixArticleImageUrls(data.images),
        } as Article;

        // Exclure les articles de l'utilisateur connecté
        if (filters?.excludeUserId && article.sellerId === filters.excludeUserId) {
          return;
        }

        // Filtrage côté client pour les champs qui ne peuvent pas être indexés facilement
        let matches = true;

        // Recherche textuelle: titre uniquement
        if (searchTerm && searchTerm.trim()) {
          const searchLower = searchTerm.toLowerCase();
          const titleMatch = (article.title || '').toLowerCase().includes(searchLower);
          matches = matches && titleMatch;
        }

        // Filtres par couleur
        if (filters?.colors && filters.colors.length > 0 && article.color) {
          matches = matches && filters.colors.some(color => 
            article.color?.toLowerCase().includes(color.toLowerCase())
          );
        }

        // Filtres par taille
        if (filters?.sizes && filters.sizes.length > 0 && article.size) {
          matches = matches && filters.sizes.includes(article.size);
        }

        // Filtres par matière
        if (filters?.materials && filters.materials.length > 0 && article.material) {
          matches = matches && filters.materials.some(material =>
            article.material?.toLowerCase().includes(material.toLowerCase())
          );
        }

        // Filtres par marque
        if (filters?.brands && filters.brands.length > 0 && article.brand) {
          matches = matches && filters.brands.some(brand =>
            article.brand?.toLowerCase().includes(brand.toLowerCase())
          );
        }

        // Filtres par motif
        if (filters?.patterns && filters.patterns.length > 0 && article.pattern) {
          matches = matches && filters.patterns.some(pattern =>
            article.pattern?.toLowerCase().includes(pattern.toLowerCase())
          );
        }

        if (matches) {
          articles.push(article);
        }
      });

      // Tri côté client selon sortBy
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

      // Limiter les résultats après filtrage et tri
      const limitedArticles = articles.slice(0, limitCount);
      const idx = Math.min(querySnapshot.docs.length - 1, limitedArticles.length - 1);
      const lastVisibleDoc = (querySnapshot.docs[idx] as FirebaseFirestoreTypes.QueryDocumentSnapshot) || null;

      console.log('✅ Résultats finaux:', limitedArticles.length, 'articles');
      return { articles: limitedArticles, lastVisible: lastVisibleDoc };
    } catch (error: any) {
      console.error('❌ Erreur searchArticles:', error);
      throw new Error(`Erreur lors de la recherche: ${error.message}`);
    }
  }

  // Méthode pour recherche simple (rétrocompatibilité)
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

      querySnapshot.forEach((docSnap: FirebaseFirestoreTypes.QueryDocumentSnapshot) => {
        const data = docSnap.data();
        // Filtrer les articles supprimés (isActive === false)
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
      throw new Error(`Erreur lors de la récupération des articles utilisateur: ${error.message}`);
    }
  }

  static async updateArticle(articleId: string, updates: Partial<Article>): Promise<void> {
    try {
      const docRef = doc(firestore, 'articles', articleId);
      await updateDoc(docRef, updates);
    } catch (error: any) {
      throw new Error(`Erreur lors de la mise à jour de l'article: ${error.message}`);
    }
  }

  static async deleteArticle(articleId: string): Promise<void> {
    try {
      // Marquer comme inactif plutôt que supprimer
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
    // Note: This method is for web File objects. For React Native, use uploadImagesReactNative
    try {
      const uploadPromises = files.map(async (file, index) => {
        const storagePath = `articles/${articleId}/image_${index}_${Date.now()}`;
        const imageRef = ref(storage, storagePath);
        // For web, we'd use uploadBytes, but in RN we use putFile
        // This method should primarily be used with uploadImagesReactNative for mobile
        await storage.ref(storagePath).put(file);
        return getDownloadURL(imageRef);
      });

      return await Promise.all(uploadPromises);
    } catch (error: any) {
      throw new Error(`Erreur lors de l'upload des images: ${error.message}`);
    }
  }

  static async deleteImage(imageUrl: string): Promise<void> {
    try {
      const imageRef = ref(storage, imageUrl);
      await imageRef.delete();
    } catch (error: any) {
      throw new Error(`Erreur lors de la suppression de l'image: ${error.message}`);
    }
  }

  static async likeArticle(articleId: string, userId: string): Promise<void> {
    try {
      const docRef = doc(firestore, 'articles', articleId);
      await updateDoc(docRef, {
        likes: increment(1),
        likedBy: arrayUnion(userId)
      });
    } catch (error: any) {
      throw new Error(`Erreur lors du like: ${error.message}`);
    }
  }

  static async unlikeArticle(articleId: string, userId: string): Promise<void> {
    try {
      const docRef = doc(firestore, 'articles', articleId);
      await updateDoc(docRef, {
        likes: increment(-1),
        likedBy: arrayRemove(userId)
      });
    } catch (error: any) {
      throw new Error(`Erreur lors du unlike: ${error.message}`);
    }
  }
}