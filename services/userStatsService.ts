import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import {
  collection,
  doc,
  limit as firestoreLimit,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where
} from '@react-native-firebase/firestore';
import { firestore } from '../config/firebaseConfig';
import { Article } from '../types';

export interface UserStats {
  articlesEnVente: number;
  articlesVendus: number;
  gainsTotal: number;
  totalVues: number;
  totalLikes: number;
  moyenneNote: number;
  nombreAvis: number;
}

export interface VentesRecentes {
  article: Article;
  datePaiement: Date;
  prixVente: number;
}

export class UserStatsService {
  
  /**
   * Récupère les statistiques complètes d'un vendeur
   */
  static async getUserStats(userId: string): Promise<UserStats> {
    try {
      // Récupérer tous les articles du vendeur
      const articlesRef = collection(firestore, 'articles');
      const articlesQuery = query(
        articlesRef,
        where('sellerId', '==', userId)
      );
      
      const articlesSnapshot = await getDocs(articlesQuery);
      const articles = articlesSnapshot.docs.map((docSnap: FirebaseFirestoreTypes.QueryDocumentSnapshot) => ({
        id: docSnap.id,
        ...docSnap.data()
      } as Article));
      
      // Calculer les statistiques
      const articlesEnVente = articles.filter(a => a.isActive && !a.isSold).length;
      const articlesVendus = articles.filter(a => a.isSold).length;
      
      const totalVues = articles.reduce((sum, article) => sum + (article.views || 0), 0);
      const totalLikes = articles.reduce((sum, article) => sum + (article.likes || 0), 0);
      
      // Calculer les gains (pour les articles vendus)
      let gainsTotal = 0;
      for (const article of articles.filter(a => a.isSold)) {
        // Récupérer les détails de vente si disponibles
        const venteRef = doc(firestore, 'ventes', article.id);
        const venteDoc = await getDoc(venteRef);
        if (venteDoc.exists()) {
          gainsTotal += venteDoc.data().prixVente || article.price;
        } else {
          gainsTotal += article.price;
        }
      }
      
      // Récupérer les avis du vendeur
      const avisRef = collection(firestore, 'avis');
      const avisQuery = query(
        avisRef,
        where('vendeurId', '==', userId)
      );
      
      const avisSnapshot = await getDocs(avisQuery);
      const avis = avisSnapshot.docs.map((docSnap: FirebaseFirestoreTypes.QueryDocumentSnapshot) => docSnap.data());
      
      const nombreAvis = avis.length;
      const moyenneNote = nombreAvis > 0 
        ? avis.reduce((sum, avis) => sum + avis.note, 0) / nombreAvis 
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
      
    } catch (error: any) {
      console.error('Erreur lors de la récupération des statistiques:', error);
      throw new Error('Impossible de récupérer les statistiques');
    }
  }
  
  /**
   * Récupère les ventes récentes d'un vendeur
   */
  static async getVentesRecentes(userId: string, limitCount: number = 5): Promise<VentesRecentes[]> {
    try {
      const ventesRef = collection(firestore, 'ventes');
      const ventesQuery = query(
        ventesRef,
        where('vendeurId', '==', userId),
        orderBy('datePaiement', 'desc'),
        firestoreLimit(limitCount)
      );
      
      const ventesSnapshot = await getDocs(ventesQuery);
      const ventes: VentesRecentes[] = [];
      
      for (const venteDoc of ventesSnapshot.docs) {
        const venteData = venteDoc.data();
        
        // Récupérer l'article associé
        const articleRef = doc(firestore, 'articles', venteData.articleId);
        const articleDoc = await getDoc(articleRef);
        if (articleDoc.exists()) {
          ventes.push({
            article: { id: articleDoc.id, ...articleDoc.data() } as Article,
            datePaiement: venteData.datePaiement.toDate(),
            prixVente: venteData.prixVente
          });
        }
      }
      
      return ventes;
      
    } catch (error: any) {
      console.error('Erreur lors de la récupération des ventes récentes:', error);
      return [];
    }
  }
  
  /**
   * Récupère les articles en vente d'un utilisateur
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
      
      return articlesSnapshot.docs.map((docSnap: FirebaseFirestoreTypes.QueryDocumentSnapshot) => ({
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: docSnap.data().createdAt.toDate()
      } as Article));
      
    } catch (error: any) {
      console.error('Erreur lors de la récupération des articles en vente:', error);
      return [];
    }
  }
  
  /**
   * Récupère les articles vendus d'un utilisateur
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
      
      return articlesSnapshot.docs.map((docSnap: FirebaseFirestoreTypes.QueryDocumentSnapshot) => ({
        id: docSnap.id,
        ...docSnap.data(),
        createdAt: docSnap.data().createdAt.toDate()
      } as Article));
      
    } catch (error: any) {
      console.error('Erreur lors de la récupération des articles vendus:', error);
      return [];
    }
  }
  
  /**
   * Met à jour les statistiques après une vente
   */
  static async enregistrerVente(articleId: string, vendeurId: string, acheteurId: string, prixVente: number): Promise<void> {
    try {
      // Créer l'enregistrement de vente
      const venteData = {
        articleId,
        vendeurId,
        acheteurId,
        prixVente,
        datePaiement: new Date(),
        statut: 'payee'
      };
      
      const venteRef = doc(firestore, 'ventes', articleId);
      await setDoc(venteRef, venteData);
      
      // Marquer l'article comme vendu
      const articleRef = doc(firestore, 'articles', articleId);
      await updateDoc(articleRef, {
        isSold: true,
        dateVente: new Date()
      });
      
    } catch (error: any) {
      console.error('Erreur lors de l\'enregistrement de la vente:', error);
      throw new Error('Impossible d\'enregistrer la vente');
    }
  }
}