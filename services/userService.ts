import { firestore } from '@/config/firebaseConfig';
import { User, UserPreferences } from '@/types';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch
} from '@react-native-firebase/firestore';

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

      const data = userDoc.data() as any;
      if (!data) return null;

      return {
        ...data,
        id: userDoc.id,
        createdAt: data.createdAt?.toDate() || new Date(),
      } as User;
    } catch (error) {
      console.error('Error fetching user:', error);
      return null;
    }
  }

  /**
   * Mettre à jour les préférences d'un utilisateur
   */
  static async updateUserPreferences(
    userId: string,
    preferences: UserPreferences
  ): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        preferences,
        onboardingCompleted: true,
        isActive: true, // S'assurer que l'utilisateur est actif pour valider les règles
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating user preferences:', error);
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
      console.error('Error fetching user preferences:', error);
      return null;
    }
  }

  /**
   * Vérifier si un utilisateur est admin
   */
  static async isUserAdmin(userId: string): Promise<boolean> {
    try {
      const user = await this.getUserById(userId);
      return user?.isAdmin === true;
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }

  /**
   * Définir un utilisateur comme admin (super admin uniquement)
   */
  static async setUserAsAdmin(userId: string): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        isAdmin: true,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error setting user as admin:', error);
      throw new Error('Erreur lors de la définition de l\'utilisateur comme admin');
    }
  }

  /**
   * Retirer les droits admin d'un utilisateur
   */
  static async removeAdminRights(userId: string): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        isAdmin: false,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error removing admin rights:', error);
      throw new Error('Erreur lors du retrait des droits admin');
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
      console.error('Error updating account type:', error);
      throw new Error('Erreur lors de la mise à jour du type de compte');
    }
  }

  /**
   * Marquer l'onboarding comme complété
   */
  static async markOnboardingCompleted(userId: string): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, userId), {
        onboardingCompleted: true,
        isActive: true, // S'assurer que l'utilisateur est actif pour valider les règles
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error marking onboarding completed:', error);
      throw new Error('Erreur lors de la finalisation de l\'onboarding');
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
      const updateData: any = {
        ...data,
        updatedAt: serverTimestamp(),
      };

      // Ne pas permettre la mise à jour de certains champs via cette méthode
      delete updateData.id;
      delete updateData.email;
      delete updateData.createdAt;
      delete updateData.isAdmin;

      await updateDoc(doc(firestore, this.COLLECTION, userId), updateData);
    } catch (error) {
      console.error('Error updating user profile:', error);
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
      console.log('FCM token saved successfully');
    } catch (error) {
      console.error('Error saving FCM token:', error);
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
      console.log('FCM token removed successfully');
    } catch (error) {
      console.error('Error removing FCM token:', error);
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
      console.error('Error fetching FCM tokens:', error);
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
      console.error('Error updating notification preferences:', error);
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
      console.error('Error fetching notification preferences:', error);
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
   * Supprimer toutes les données utilisateur (RGPD Art. 17 - Droit à l'effacement)
   * Supprime : profil, articles, favoris, notifications, chats
   */
  static async deleteAllUserData(userId: string): Promise<void> {
    try {
      const batch = writeBatch(firestore);

      // 1. Supprimer les articles de l'utilisateur
      const articlesQuery = query(
        collection(firestore, 'articles'),
        where('sellerId', '==', userId)
      );
      const articlesSnapshot = await getDocs(articlesQuery);
      articlesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      // 2. Supprimer les favoris de l'utilisateur
      const favoritesQuery = query(
        collection(firestore, 'favorites'),
        where('userId', '==', userId)
      );
      const favoritesSnapshot = await getDocs(favoritesQuery);
      favoritesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      // 3. Supprimer les notifications de l'utilisateur
      const notificationsQuery = query(
        collection(firestore, 'notifications'),
        where('userId', '==', userId)
      );
      const notificationsSnapshot = await getDocs(notificationsQuery);
      notificationsSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      // 4. Anonymiser les messages dans les chats (on ne supprime pas les chats pour l'autre participant)
      const chatsQuery = query(
        collection(firestore, 'chats'),
        where('participants', 'array-contains', userId)
      );
      const chatsSnapshot = await getDocs(chatsQuery);
      for (const chatDoc of chatsSnapshot.docs) {
        // Mettre à jour les infos du participant pour anonymiser
        const participantsInfo = chatDoc.data().participantsInfo || [];
        const updatedParticipantsInfo = participantsInfo.map((p: any) => {
          if (p.userId === userId) {
            return { ...p, userName: 'Utilisateur supprimé', userImage: null };
          }
          return p;
        });
        batch.update(chatDoc.ref, { participantsInfo: updatedParticipantsInfo });
      }

      // 5. Supprimer les swaps de l'utilisateur
      const swapsInitiatorQuery = query(
        collection(firestore, 'swaps'),
        where('initiatorId', '==', userId)
      );
      const swapsInitiatorSnapshot = await getDocs(swapsInitiatorQuery);
      swapsInitiatorSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      const swapsReceiverQuery = query(
        collection(firestore, 'swaps'),
        where('receiverId', '==', userId)
      );
      const swapsReceiverSnapshot = await getDocs(swapsReceiverQuery);
      swapsReceiverSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      // 6. Supprimer le profil utilisateur
      batch.delete(doc(firestore, this.COLLECTION, userId));

      // Exécuter toutes les suppressions
      await batch.commit();
      console.log('All user data deleted successfully');
    } catch (error) {
      console.error('Error deleting user data:', error);
      throw new Error('Erreur lors de la suppression des données');
    }
  }

  /**
   * Exporter toutes les données utilisateur (RGPD Art. 20 - Portabilité)
   * Retourne un objet JSON avec toutes les données de l'utilisateur
   */
  static async exportUserData(userId: string): Promise<object> {
    try {
      const exportData: any = {
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
      articlesSnapshot.forEach((doc) => {
        const data = doc.data();
        exportData.articles.push({
          id: doc.id,
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
      favoritesSnapshot.forEach((doc) => {
        const data = doc.data();
        exportData.favorites.push({
          id: doc.id,
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
      notificationsSnapshot.forEach((doc) => {
        const data = doc.data();
        exportData.notifications.push({
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate?.()?.toISOString(),
        });
      });

      // 5. Chats (messages où l'utilisateur participe)
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
        const messages: any[] = [];
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
      console.error('Error exporting user data:', error);
      throw new Error('Erreur lors de l\'export des données');
    }
  }
}

