import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from '@react-native-firebase/firestore';
import { firestore } from '../config/firebaseConfig';
import { Article } from '../types';

export class FavoritesService {
  static async addToFavorites(userId: string, articleId: string): Promise<void> {
    try {
      const userFavoritesRef = doc(firestore, 'favorites', userId);
      await setDoc(userFavoritesRef, {
        userId,
        articleIds: arrayUnion(articleId),
        updatedAt: new Date(),
        createdAt: new Date(),
      }, { merge: true });
    } catch (error: any) {
      throw new Error(`Erreur lors de l'ajout aux favoris: ${error.message}`);
    }
  }

  static async removeFromFavorites(userId: string, articleId: string): Promise<void> {
    try {
      const userFavoritesRef = doc(firestore, 'favorites', userId);
      await setDoc(userFavoritesRef, { userId, updatedAt: new Date() }, { merge: true });
      await updateDoc(userFavoritesRef, {
        articleIds: arrayRemove(articleId),
        updatedAt: new Date(),
      });
    } catch (error: any) {
      throw new Error(`Erreur lors de la suppression des favoris: ${error.message}`);
    }
  }

  static async getUserFavorites(userId: string): Promise<string[]> {
    try {
      const userFavoritesRef = doc(firestore, 'favorites', userId);
      const userFavoritesDoc = await getDoc(userFavoritesRef);

      if (userFavoritesDoc.exists()) {
        const data = (userFavoritesDoc.data() as any) || {};
        return Array.isArray(data.articleIds) ? data.articleIds : [];
      }

      return [];
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des favoris: ${error.message}`);
    }
  }

  static async getUserFavoriteArticles(userId: string): Promise<Article[]> {
    try {
      const favoriteIds = await this.getUserFavorites(userId);
      
      if (favoriteIds.length === 0) {
        return [];
      }

      // Récupérer les articles favoris (par batch de 10 car Firestore limite les requêtes 'in')
      const articles: Article[] = [];
      const batchSize = 10;
      
      for (let i = 0; i < favoriteIds.length; i += batchSize) {
        const batch = favoriteIds.slice(i, i + batchSize);
        
        const articlesRef = collection(firestore, 'articles');
        const qRef = query(
          articlesRef,
          where('__name__', 'in', batch)
        );
        const querySnapshot = await getDocs(qRef);
        
        querySnapshot.forEach((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) => {
          if (d.exists()) {
            articles.push({
              id: d.id,
              ...d.data(),
              createdAt: d.data().createdAt.toDate(),
            } as Article);
          }
        });
      }

      return articles;
    } catch (error: any) {
      throw new Error(`Erreur lors de la récupération des articles favoris: ${error.message}`);
    }
  }

  static async isFavorite(userId: string, articleId: string): Promise<boolean> {
    try {
      const favoriteIds = await this.getUserFavorites(userId);
      return favoriteIds.includes(articleId);
    } catch (error: any) {
      console.error('Erreur lors de la vérification des favoris:', error);
      return false;
    }
  }

  static async getFavoriteCount(articleId: string): Promise<number> {
    try {
      const favoritesRef = collection(firestore, 'favorites');
      const q = query(
        favoritesRef,
        where('articleIds', 'array-contains', articleId)
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.size;
    } catch (error: any) {
      console.error('Erreur lors du comptage des favoris:', error);
      return 0;
    }
  }
}