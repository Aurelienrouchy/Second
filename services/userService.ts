import { auth, firestore } from '@/config/firebaseConfig';
import { User, UserPreferences } from '@/types';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';

interface ExportedUserData {
  exportedAt: string;
  user: (Record<string, unknown> & { createdAt?: string }) | null;
  articles: Record<string, unknown>[];
  favorites: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  chats: Record<string, unknown>[];
}

export class UserService {
  private static readonly COLLECTION = 'users';

  /**
   * Récupérer un utilisateur par son ID
   */
  static async getUserById(userId: string): Promise<User | null> {
    try {
      const userDoc = await getDoc(doc(firestore, this.COLLECTION, userId));

      if (!userDoc.exists()) {
        return null;
      }

      const data = userDoc.data();
      if (!data) return null;

      return {
        ...data,
        id: userDoc.id,
        createdAt: (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(),
      } as User;
    } catch (error) {
      if (__DEV__) console.error('Error fetching user:', error);
      return null;
    }
  }

  /**
   * Mettre à jour les préférences d'un utilisateur
   */
  static async updateUserPreferences(
    userId: string,
    preferences: Partial<UserPreferences>
  ): Promise<void> {
    try {
      // Use dot notation so partial updates merge into the existing
      // preferences map instead of overwriting unrelated sub-fields.
      const dottedPreferences: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(preferences)) {
        dottedPreferences[`preferences.${key}`] = value;
      }

      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        ...dottedPreferences,
        isActive: true, // S'assurer que l'utilisateur est actif pour valider les règles
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      if (__DEV__) console.error('Error updating user preferences:', error);
      throw new Error('Erreur lors de la mise à jour des préférences');
    }
  }

  /**
   * Récupérer les préférences d'un utilisateur
   */
  static async getUserPreferences(userId: string): Promise<UserPreferences | null> {
    try {
      const user = await this.getUserById(userId);
      return user?.preferences || null;
    } catch (error) {
      if (__DEV__) console.error('Error fetching user preferences:', error);
      return null;
    }
  }

  /**
   * Vérifier si un utilisateur est admin.
   *
   * SECURITY: prefers the `admin` custom claim on the Firebase Auth ID
   * token (set server-side via Admin SDK and not user-writable). Falls
   * back to the Firestore `isAdmin` field only if the claim is missing
   * — and that field is now write-protected by the users/{uid} rule, so
   * a self-elevation attempt would be rejected before reaching here.
   */
  static async isUserAdmin(userId: string): Promise<boolean> {
    try {
      const currentUser = auth.currentUser;
      if (currentUser && currentUser.uid === userId) {
        const tokenResult = await currentUser.getIdTokenResult();
        if (tokenResult.claims?.admin === true) {
          return true;
        }
      }

      // Fallback for compatibility while custom claims are rolled out.
      const user = await this.getUserById(userId);
      return user?.isAdmin === true;
    } catch (error) {
      if (__DEV__) console.error('Error checking admin status:', error);
      return false;
    }
  }

  /**
   * Mettre à jour le type de compte utilisateur
   */
  static async updateAccountType(
    userId: string,
    accountType: 'user' | 'shop'
  ): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        accountType,
        isActive: true, // S'assurer que l'utilisateur est actif pour valider les règles
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      if (__DEV__) console.error('Error updating account type:', error);
      throw new Error('Erreur lors de la mise à jour du type de compte');
    }
  }

  /**
   * Mettre à jour le profil utilisateur
   */
  static async updateUserProfile(
    userId: string,
    data: Partial<User>
  ): Promise<void> {
    try {
      const updateData: Record<string, unknown> = {
        ...data,
        isActive: true,
        updatedAt: serverTimestamp(),
      };

      // Ne pas permettre la mise à jour de certains champs via cette methode
      delete updateData.id;
      delete updateData.email;
      delete updateData.createdAt;
      delete updateData.isAdmin;
      delete updateData.role;
      delete updateData.customClaims;
      delete updateData.onboardingCompleted;
      delete updateData.onboardingPreferences;

      await updateDoc(doc(firestore, this.COLLECTION, userId), updateData);
    } catch (error) {
      if (__DEV__) console.error('Error updating user profile:', error);
      throw new Error('Erreur lors de la mise à jour du profil');
    }
  }

  // ============================================
  // FCM TOKEN MANAGEMENT
  // ============================================

  /**
   * Enregistrer un token FCM pour les push notifications
   * Utilise arrayUnion pour supporter plusieurs appareils
   */
  static async saveFcmToken(userId: string, token: string): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        fcmTokens: arrayUnion(token),
        updatedAt: serverTimestamp(),
      });
      if (__DEV__) console.log('FCM token saved successfully');
    } catch (error) {
      if (__DEV__) console.error('Error saving FCM token:', error);
      throw new Error('Erreur lors de l\'enregistrement du token FCM');
    }
  }

  /**
   * Supprimer un token FCM (déconnexion ou token invalide)
   */
  static async removeFcmToken(userId: string, token: string): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        fcmTokens: arrayRemove(token),
        updatedAt: serverTimestamp(),
      });
      if (__DEV__) console.log('FCM token removed successfully');
    } catch (error) {
      if (__DEV__) console.error('Error removing FCM token:', error);
      // Ne pas throw ici car ce n'est pas critique
    }
  }

  /**
   * Récupérer les tokens FCM d'un utilisateur
   */
  static async getFcmTokens(userId: string): Promise<string[]> {
    try {
      const user = await this.getUserById(userId);
      return user?.fcmTokens || [];
    } catch (error) {
      if (__DEV__) console.error('Error fetching FCM tokens:', error);
      return [];
    }
  }

  // ============================================
  // NOTIFICATION PREFERENCES
  // ============================================

  /**
   * Mettre à jour les préférences de notification
   */
  static async updateNotificationPreferences(
    userId: string,
    notificationPrefs: NonNullable<UserPreferences['notifications']>
  ): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        'preferences.notifications': notificationPrefs,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      if (__DEV__) console.error('Error updating notification preferences:', error);
      throw new Error('Erreur lors de la mise à jour des préférences de notification');
    }
  }

  /**
   * Récupérer les préférences de notification avec valeurs par défaut
   */
  static async getNotificationPreferences(
    userId: string
  ): Promise<NonNullable<UserPreferences['notifications']>> {
    try {
      const user = await this.getUserById(userId);
      return user?.preferences?.notifications || {
        email: true,
        push: true,
        newMessages: true,
        newOrders: true,
        priceDrops: true,
        articleFavorited: true,
        swapZoneReminder: true,
        offerReceived: true,
        offerResponse: true,
      };
    } catch (error) {
      if (__DEV__) console.error('Error fetching notification preferences:', error);
      // Retourner les valeurs par défaut en cas d'erreur
      return {
        email: true,
        push: true,
        newMessages: true,
        newOrders: true,
        priceDrops: true,
        articleFavorited: true,
        swapZoneReminder: true,
        offerReceived: true,
        offerResponse: true,
      };
    }
  }

  // ============================================
  // RGPD COMPLIANCE
  // ============================================

  /**
   * Exporter toutes les données utilisateur (RGPD Art. 20 - Portabilité)
   * Retourne un objet JSON avec toutes les données de l'utilisateur
   */
  static async exportUserData(userId: string): Promise<ExportedUserData> {
    try {
      const exportData: ExportedUserData = {
        exportedAt: new Date().toISOString(),
        user: null,
        articles: [],
        favorites: [],
        notifications: [],
        chats: [],
      };

      // 1. Profil utilisateur
      const user = await this.getUserById(userId);
      if (user) {
        exportData.user = {
          ...user,
          createdAt: user.createdAt?.toISOString(),
        };
      }

      // 2. Articles
      const articlesQuery = query(
        collection(firestore, 'articles'),
        where('sellerId', '==', userId)
      );
      const articlesSnapshot = await getDocs(articlesQuery);
      articlesSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        exportData.articles.push({
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString(),
        });
      });

      // 3. Favoris
      const favoritesQuery = query(
        collection(firestore, 'favorites'),
        where('userId', '==', userId)
      );
      const favoritesSnapshot = await getDocs(favoritesQuery);
      favoritesSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        exportData.favorites.push({
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString(),
        });
      });

      // 4. Notifications
      const notificationsQuery = query(
        collection(firestore, 'notifications'),
        where('userId', '==', userId)
      );
      const notificationsSnapshot = await getDocs(notificationsQuery);
      notificationsSnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        exportData.notifications.push({
          id: docSnap.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString(),
        });
      });

      // 5. Chats (messages ou l'utilisateur participe)
      const chatsQuery = query(
        collection(firestore, 'chats'),
        where('participants', 'array-contains', userId)
      );
      const chatsSnapshot = await getDocs(chatsQuery);
      for (const chatDoc of chatsSnapshot.docs) {
        const chatData = chatDoc.data();
        const messagesQuery = query(
          collection(firestore, 'chats', chatDoc.id, 'messages'),
          where('senderId', '==', userId)
        );
        const messagesSnapshot = await getDocs(messagesQuery);
        const messages: Record<string, unknown>[] = [];
        messagesSnapshot.forEach((msgDoc) => {
          const msgData = msgDoc.data();
          messages.push({
            id: msgDoc.id,
            ...msgData,
            timestamp: msgData.timestamp?.toDate?.()?.toISOString(),
          });
        });

        exportData.chats.push({
          id: chatDoc.id,
          createdAt: chatData.createdAt?.toDate?.()?.toISOString(),
          myMessages: messages,
        });
      }

      return exportData;
    } catch (error) {
      if (__DEV__) console.error('Error exporting user data:', error);
      throw new Error('Erreur lors de l\'export des donnees');
    }
  }
}

