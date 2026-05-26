import {
  collection,
  getDocs,
  orderBy,
  query,
  QueryDocumentSnapshot,
  where,
} from 'firebase/firestore';
import { firestore } from '@/config/firebaseConfig';
import { Article } from '@/types';
import { ArticlesService } from './articlesService';

export interface UserStats {
  articlesEnVente: number;
  articlesVendus: number;
  gainsTotal: number;
  totalVues: number;
  totalLikes: number;
  moyenneNote: number;
  nombreAvis: number;
}

export class UserStatsService {

  /**
   * Recupere les statistiques completes d'un vendeur
   */
  static async getUserStats(userId: string): Promise<UserStats> {
    try {
      // Recuperer tous les articles du vendeur
      const articlesRef = collection(firestore, 'articles');
      const articlesQuery = query(
        articlesRef,
        where('sellerId', '==', userId)
      );

      const articlesSnapshot = await getDocs(articlesQuery);
      const articles = articlesSnapshot.docs.map((docSnap: QueryDocumentSnapshot) => ({
        id: docSnap.id,
        ...docSnap.data()
      } as Article));

      // Calculer les statistiques
      const articlesEnVente = articles.filter(a => a.isActive && !a.isSold).length;
      const articlesVendus = articles.filter(a => a.isSold).length;

      const totalVues = articles.reduce((sum, article) => sum + (article.views || 0), 0);
      const totalLikes = articles.reduce((sum, article) => sum + (article.likes || 0), 0);

      // Calculer les gains (pour les articles vendus)
      const gainsTotal = articles.filter(a => a.isSold).reduce((sum, a) => sum + (a.price || 0), 0);

      // Recuperer les avis du vendeur
      const avisRef = collection(firestore, 'avis');
      const avisQuery = query(
        avisRef,
        where('vendeurId', '==', userId)
      );

      const avisSnapshot = await getDocs(avisQuery);
      const avis = avisSnapshot.docs.map((docSnap: QueryDocumentSnapshot) => docSnap.data());

      const nombreAvis = avis.length;
      const moyenneNote = nombreAvis > 0
        ? avis.reduce((sum, item) => sum + item.note, 0) / nombreAvis
        : 0;

      return {
        articlesEnVente,
        articlesVendus,
        gainsTotal,
        totalVues,
        totalLikes,
        moyenneNote,
        nombreAvis
      };

    } catch (error: unknown) {
      if (__DEV__) console.error('Erreur lors de la recuperation des statistiques:', error);
      throw new Error('Impossible de recuperer les statistiques');
    }
  }

  /**
   * Recupere les articles en vente d'un utilisateur
   */
  static async getArticlesEnVente(userId: string): Promise<Article[]> {
    try {
      const articlesRef = collection(firestore, 'articles');
      const articlesQuery = query(
        articlesRef,
        where('sellerId', '==', userId),
        where('isActive', '==', true),
        where('isSold', '==', false),
        orderBy('createdAt', 'desc')
      );

      const articlesSnapshot = await getDocs(articlesQuery);

      return articlesSnapshot.docs.map((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          images: ArticlesService.fixArticleImageUrls(data.images),
        } as Article;
      });

    } catch (error: unknown) {
      if (__DEV__) console.error('Erreur lors de la recuperation des articles en vente:', error);
      return [];
    }
  }

  /**
   * Recupere les articles vendus d'un utilisateur
   */
  static async getArticlesVendus(userId: string): Promise<Article[]> {
    try {
      const articlesRef = collection(firestore, 'articles');
      const articlesQuery = query(
        articlesRef,
        where('sellerId', '==', userId),
        where('isSold', '==', true),
        orderBy('createdAt', 'desc')
      );

      const articlesSnapshot = await getDocs(articlesQuery);

      return articlesSnapshot.docs.map((docSnap: QueryDocumentSnapshot) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          images: ArticlesService.fixArticleImageUrls(data.images),
        } as Article;
      });

    } catch (error: unknown) {
      if (__DEV__) console.error('Erreur lors de la recuperation des articles vendus:', error);
      return [];
    }
  }
}
