import { firestore } from '@/config/firebaseConfig';
import { Article, Shop } from '@/types';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from '@react-native-firebase/firestore';
import { geohashForLocation, geohashQueryBounds } from 'geofire-common';

export class ShopService {
  private static readonly COLLECTION = 'shops';

  /**
   * Créer une nouvelle boutique (status: pending par défaut)
   */
  static async createShop(shopData: Omit<Shop, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      // Calculer le geohash pour la localisation
      const geohash = geohashForLocation([
        shopData.location.latitude,
        shopData.location.longitude,
      ]);

      const shopToCreate = {
        ...shopData,
        location: {
          ...shopData.location,
          geohash,
        },
        status: 'pending',
        reviewCount: 0,
        articlesCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const docRef = await addDoc(
        collection(firestore, this.COLLECTION),
        shopToCreate
      );

      // Mettre à jour l'ID dans le document
      await updateDoc(docRef, { id: docRef.id });

      return docRef.id;
    } catch (error) {
      console.error('Error creating shop:', error);
      throw new Error('Erreur lors de la création de la boutique');
    }
  }

    static async getShopById(id: string): Promise<Shop | null> {
    try {
      const shopDoc = await getDoc(doc(firestore, this.COLLECTION, id));

      if (!shopDoc.exists()) {
        return null;
      }

      const data = shopDoc.data() as any;
      if (!data) return null;

      return {
        ...data,
        id: shopDoc.id,
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date(),
        verificationDetails: data.verificationDetails
          ? {
              ...data.verificationDetails,
              verifiedAt: data.verificationDetails.verifiedAt?.toDate(),
            }
          : undefined,
      } as Shop;
    } catch (error) {
      console.error('Error fetching shop:', error);
      return null;
    }
  }

  /**
   * Récupérer toutes les boutiques en attente de validation (pour admin)
   */
  static async getPendingShops(): Promise<Shop[]> {
    try {
      const q = query(
        collection(firestore, this.COLLECTION),
        where('status', '==', 'pending')
      );

      const querySnapshot = await getDocs(q);
      const shops: Shop[] = [];

      querySnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data() as any;
        shops.push({
          ...data,
          id: docSnapshot.id,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          verificationDetails: data.verificationDetails
            ? {
                ...data.verificationDetails,
                verifiedAt: data.verificationDetails.verifiedAt?.toDate(),
              }
            : undefined,
        } as Shop);
      });

      return shops;
    } catch (error) {
      console.error('Error fetching pending shops:', error);
      return [];
    }
  }

  /**
   * Récupérer toutes les boutiques approuvées
   */
  static async getApprovedShops(): Promise<Shop[]> {
    try {
      const q = query(
        collection(firestore, this.COLLECTION),
        where('status', '==', 'approved')
      );

      const querySnapshot = await getDocs(q);
      const shops: Shop[] = [];

      querySnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data() as any;
        shops.push({
          ...data,
          id: docSnapshot.id,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          verificationDetails: data.verificationDetails
            ? {
                ...data.verificationDetails,
                verifiedAt: data.verificationDetails.verifiedAt?.toDate(),
              }
            : undefined,
        } as Shop);
      });

      return shops;
    } catch (error) {
      console.error('Error fetching approved shops:', error);
      return [];
    }
  }

  /**
   * Récupérer toutes les boutiques rejetées
   */
  static async getRejectedShops(): Promise<Shop[]> {
    try {
      const q = query(
        collection(firestore, this.COLLECTION),
        where('status', '==', 'rejected')
      );

      const querySnapshot = await getDocs(q);
      const shops: Shop[] = [];

      querySnapshot.forEach((docSnapshot) => {
        const data = docSnapshot.data() as any;
        shops.push({
          ...data,
          id: docSnapshot.id,
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date(),
          verificationDetails: data.verificationDetails
            ? {
                ...data.verificationDetails,
                verifiedAt: data.verificationDetails.verifiedAt?.toDate(),
              }
            : undefined,
        } as Shop);
      });

      return shops;
    } catch (error) {
      console.error('Error fetching rejected shops:', error);
      return [];
    }
  }

  /**
   * Récupérer les boutiques à proximité d'une localisation
   * @param lat Latitude
   * @param lng Longitude
   * @param radiusKm Rayon de recherche en kilomètres
   */
  static async getShopsNearLocation(
    lat: number,
    lng: number,
    radiusKm: number = 10
  ): Promise<Shop[]> {
    try {
      const center = [lat, lng];
      const radiusInM = radiusKm * 1000;

      // Calculer les bounds de geohash
      const bounds = geohashQueryBounds(center, radiusInM);
      const promises: Promise<any>[] = [];

      // Effectuer une requête pour chaque bound
      for (const b of bounds) {
        const q = query(
          collection(firestore, this.COLLECTION),
          where('status', '==', 'approved'),
          where('location.geohash', '>=', b[0]),
          where('location.geohash', '<=', b[1])
        );
        promises.push(getDocs(q));
      }

      // Attendre toutes les requêtes
      const snapshots = await Promise.all(promises);

      const shops: Shop[] = [];
      const shopIds = new Set<string>();

      for (const snap of snapshots) {
        snap.forEach((doc) => {
          if (!shopIds.has(doc.id)) {
            shopIds.add(doc.id);
            const data = doc.data();
            shops.push({
              ...data,
              id: doc.id,
              createdAt: data.createdAt?.toDate() || new Date(),
              updatedAt: data.updatedAt?.toDate() || new Date(),
              verificationDetails: data.verificationDetails
                ? {
                    ...data.verificationDetails,
                    verifiedAt: data.verificationDetails.verifiedAt?.toDate(),
                  }
                : undefined,
            } as Shop);
          }
        });
      }

      // Filtrer les boutiques pour ne garder que celles dans le rayon
      // (geohash donne des résultats approximatifs)
      const shopsInRadius = shops.filter((shop) => {
        const distance = this.calculateDistance(
          lat,
          lng,
          shop.location.latitude,
          shop.location.longitude
        );
        return distance <= radiusKm;
      });

      return shopsInRadius;
    } catch (error) {
      console.error('Error fetching shops near location:', error);
      return [];
    }
  }

  /**
   * Mettre à jour une boutique
   */
  static async updateShop(id: string, data: Partial<Shop>): Promise<void> {
    try {
      const updateData: any = {
        ...data,
        updatedAt: serverTimestamp(),
      };

      // Ne pas permettre la mise à jour du status via cette méthode
      delete updateData.status;
      delete updateData.verificationDetails;

      // Si la localisation est mise à jour, recalculer le geohash
      if (data.location) {
        updateData.location = {
          ...data.location,
          geohash: geohashForLocation([
            data.location.latitude,
            data.location.longitude,
          ]),
        };
      }

      await updateDoc(doc(firestore, this.COLLECTION, id), updateData);
    } catch (error) {
      console.error('Error updating shop:', error);
      throw new Error('Erreur lors de la mise à jour de la boutique');
    }
  }

  /**
   * Approuver une boutique (admin uniquement)
   */
  static async approveShop(id: string, adminId: string): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, id), {
        status: 'approved',
        verificationDetails: {
          verifiedAt: serverTimestamp(),
          verifiedBy: adminId,
        },
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error approving shop:', error);
      throw new Error('Erreur lors de l\'approbation de la boutique');
    }
  }

  /**
   * Rejeter une boutique (admin uniquement)
   */
  static async rejectShop(id: string, reason: string, adminId: string): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, id), {
        status: 'rejected',
        verificationDetails: {
          reason,
          verifiedAt: serverTimestamp(),
          verifiedBy: adminId,
        },
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error rejecting shop:', error);
      throw new Error('Erreur lors du rejet de la boutique');
    }
  }

  /**
   * Suspendre une boutique (admin uniquement)
   */
  static async suspendShop(id: string, reason: string, adminId: string): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, id), {
        status: 'suspended',
        verificationDetails: {
          reason,
          verifiedAt: serverTimestamp(),
          verifiedBy: adminId,
        },
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error suspending shop:', error);
      throw new Error('Erreur lors de la suspension de la boutique');
    }
  }

  /**
   * Récupérer les articles d'une boutique
   */
  static async getShopArticles(shopId: string): Promise<Article[]> {
    try {
      const q = query(
        collection(firestore, 'articles'),
        where('shopId', '==', shopId),
        where('isActive', '==', true),
        where('isSold', '==', false)
      );

      const querySnapshot = await getDocs(q);
      const articles: Article[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        articles.push({
          ...data,
          id: doc.id,
          createdAt: data.createdAt?.toDate() || new Date(),
        } as Article);
      });

      return articles;
    } catch (error) {
      console.error('Error fetching shop articles:', error);
      return [];
    }
  }

  /**
   * Mettre à jour les informations légales d'une boutique
   */
  static async updateLegalInfo(
    shopId: string,
    legalInfo: Partial<Shop['legalInfo']>
  ): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, shopId), {
        legalInfo,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating legal info:', error);
      throw new Error('Erreur lors de la mise à jour des informations légales');
    }
  }

  /**
   * Supprimer une boutique
   */
  static async deleteShop(id: string): Promise<void> {
    try {
      await deleteDoc(doc(firestore, this.COLLECTION, id));
    } catch (error) {
      console.error('Error deleting shop:', error);
      throw new Error('Erreur lors de la suppression de la boutique');
    }
  }

  /**
   * Calculer la distance entre deux points géographiques (formule de Haversine)
   * @returns Distance en kilomètres
   */
  private static calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Rayon de la Terre en km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) *
        Math.cos(this.deg2rad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
  }

  private static deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}

