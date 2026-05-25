import { firestore } from '@/config/firebaseConfig';
import { Notification, NotificationType } from '@/types';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore';

export class NotificationService {
  private static readonly COLLECTION = 'notifications';

  /**
   * Créer une nouvelle notification
   */
  private static async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: any
  ): Promise<string> {
    try {
      const notificationData = {
        userId,
        type,
        title,
        message,
        data: data || null,
        isRead: false,
        createdAt: serverTimestamp(),
      };

      const docRef = await addDoc(
        collection(firestore, this.COLLECTION),
        notificationData
      );

      // Mettre à jour l'ID dans le document
      await updateDoc(docRef, { id: docRef.id });

      return docRef.id;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw new Error('Erreur lors de la création de la notification');
    }
  }

  /**
   * Notifier l'admin qu'une nouvelle boutique a été créée
   */
  static async notifyAdminNewShop(shopId: string): Promise<void> {
    try {
      // Récupérer tous les admins
      const admins = await this.getAdminUsers();

      // Créer une notification pour chaque admin
      const promises = admins.map((adminId) =>
        this.createNotification(
          adminId,
          'shop_created',
          'Nouvelle boutique à valider',
          'Une nouvelle boutique attend votre validation',
          { shopId }
        )
      );

      await Promise.all(promises);
    } catch (error) {
      console.error('Error notifying admin new shop:', error);
    }
  }

  /**
   * Notifier une boutique qu'elle a été approuvée
   */
  static async notifyShopApproved(shopId: string, ownerId: string): Promise<void> {
    try {
      await this.createNotification(
        ownerId,
        'shop_approved',
        'Boutique approuvée !',
        'Votre boutique a été validée. Vous pouvez maintenant publier vos articles.',
        { shopId }
      );
    } catch (error) {
      console.error('Error notifying shop approved:', error);
    }
  }

  /**
   * Notifier une boutique qu'elle a été rejetée
   */
  static async notifyShopRejected(
    shopId: string,
    ownerId: string,
    reason: string
  ): Promise<void> {
    try {
      await this.createNotification(
        ownerId,
        'shop_rejected',
        'Boutique refusée',
        `Votre boutique n'a pas été approuvée. Raison : ${reason}`,
        { shopId, reason }
      );
    } catch (error) {
      console.error('Error notifying shop rejected:', error);
    }
  }

  /**
   * Récupérer les notifications d'un utilisateur
   */
  static async getUserNotifications(userId: string): Promise<Notification[]> {
    try {
      const q = query(
        collection(firestore, this.COLLECTION),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      );

      const querySnapshot = await getDocs(q);
      const notifications: Notification[] = [];

      querySnapshot.forEach((docSnapshot: any) => {
        const data = docSnapshot.data() as any;
        notifications.push({
          ...data,
          id: docSnapshot.id,
          createdAt: data.createdAt?.toDate() || new Date(),
        } as Notification);
      });

      return notifications;
    } catch (error) {
      console.error('Error fetching user notifications:', error);
      return [];
    }
  }

  /**
   * Marquer une notification comme lue
   */
  static async markAsRead(notificationId: string): Promise<void> {
    try {
      await updateDoc(doc(firestore, this.COLLECTION, notificationId), {
        isRead: true,
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      throw new Error('Erreur lors du marquage de la notification');
    }
  }

  /**
   * Marquer toutes les notifications d'un utilisateur comme lues
   */
  static async markAllAsRead(userId: string): Promise<void> {
    try {
      const notifications = await this.getUserNotifications(userId);
      const unreadNotifications = notifications.filter((n) => !n.isRead);

      const promises = unreadNotifications.map((n) => this.markAsRead(n.id));
      await Promise.all(promises);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  }

  /**
   * Supprimer une notification
   */
  static async deleteNotification(notificationId: string): Promise<void> {
    try {
      await deleteDoc(doc(firestore, this.COLLECTION, notificationId));
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw new Error('Erreur lors de la suppression de la notification');
    }
  }

  /**
   * Supprimer toutes les notifications d'un utilisateur
   */
  static async deleteAllUserNotifications(userId: string): Promise<void> {
    try {
      const notifications = await this.getUserNotifications(userId);
      const promises = notifications.map((n) => this.deleteNotification(n.id));
      await Promise.all(promises);
    } catch (error) {
      console.error('Error deleting all notifications:', error);
    }
  }

  /**
   * Compter le nombre de notifications non lues
   */
  static async countUnreadNotifications(userId: string): Promise<number> {
    try {
      const notifications = await this.getUserNotifications(userId);
      return notifications.filter((n) => !n.isRead).length;
    } catch (error) {
      console.error('Error counting unread notifications:', error);
      return 0;
    }
  }

  /**
   * Récupérer tous les IDs des utilisateurs admin
   */
  private static async getAdminUsers(): Promise<string[]> {
    try {
      const q = query(
        collection(firestore, 'users'),
        where('isAdmin', '==', true)
      );

      const querySnapshot = await getDocs(q);
      const adminIds: string[] = [];

      querySnapshot.forEach((docSnapshot: any) => {
        adminIds.push(docSnapshot.id);
      });

      return adminIds;
    } catch (error) {
      console.error('Error fetching admin users:', error);
      return [];
    }
  }

  // ============================================
  // NOTIFICATION METHODS FOR NEW FEATURES
  // ============================================

  /**
   * Notifier le vendeur qu'un utilisateur a ajouté son article en favori
   */
  static async notifyArticleFavorited(
    sellerId: string,
    articleId: string,
    articleTitle: string,
    buyerName: string
  ): Promise<string> {
    return this.createNotification(
      sellerId,
      'article_favorited',
      'Nouvel intérêt pour votre article',
      `${buyerName} a ajouté "${articleTitle}" à ses favoris`,
      { articleId, articleTitle, userName: buyerName }
    );
  }

  /**
   * Notifier les utilisateurs d'une baisse de prix sur un article en favori
   */
  static async notifyPriceDrop(
    userId: string,
    articleId: string,
    articleTitle: string,
    oldPrice: number,
    newPrice: number
  ): Promise<string> {
    const discount = Math.round(((oldPrice - newPrice) / oldPrice) * 100);
    return this.createNotification(
      userId,
      'price_drop',
      'Baisse de prix !',
      `"${articleTitle}" est passé de ${oldPrice} $ à ${newPrice} $ (-${discount}%)`,
      { articleId, articleTitle, oldPrice, newPrice }
    );
  }

  /**
   * Notifier les utilisateurs d'une baisse de prix (batch)
   */
  static async notifyPriceDropBatch(
    userIds: string[],
    articleId: string,
    articleTitle: string,
    oldPrice: number,
    newPrice: number
  ): Promise<void> {
    try {
      const promises = userIds.map((userId) =>
        this.notifyPriceDrop(userId, articleId, articleTitle, oldPrice, newPrice)
      );
      await Promise.all(promises);
    } catch (error) {
      console.error('Error batch notifying price drop:', error);
    }
  }

  /**
   * Notifier les utilisateurs inscrits à une Swap Zone (rappel 3 jours avant)
   */
  static async notifySwapZoneReminder(
    userId: string,
    partyId: string,
    partyName: string,
    daysUntil: number = 3
  ): Promise<string> {
    return this.createNotification(
      userId,
      'swap_zone_reminder',
      `Swap Zone dans ${daysUntil} jours !`,
      `N'oubliez pas d'ajouter vos articles à "${partyName}"`,
      { partyId, partyName, daysUntil }
    );
  }

  /**
   * Notifier les utilisateurs inscrits à une Swap Zone (batch)
   */
  static async notifySwapZoneReminderBatch(
    userIds: string[],
    partyId: string,
    partyName: string,
    daysUntil: number = 3
  ): Promise<void> {
    try {
      const promises = userIds.map((userId) =>
        this.notifySwapZoneReminder(userId, partyId, partyName, daysUntil)
      );
      await Promise.all(promises);
    } catch (error) {
      console.error('Error batch notifying swap zone reminder:', error);
    }
  }

  /**
   * Notifier le vendeur qu'il a reçu une proposition d'achat
   */
  static async notifyOfferReceived(
    sellerId: string,
    articleId: string,
    articleTitle: string,
    amount: number,
    buyerName: string,
    chatId: string
  ): Promise<string> {
    return this.createNotification(
      sellerId,
      'offer_received',
      `Nouvelle offre de ${buyerName}`,
      `${amount} $ pour "${articleTitle}"`,
      { articleId, articleTitle, amount, userName: buyerName, chatId }
    );
  }

  /**
   * Notifier l'acheteur de la réponse à son offre
   */
  static async notifyOfferResponse(
    buyerId: string,
    articleId: string,
    articleTitle: string,
    status: 'accepted' | 'rejected' | 'counter',
    sellerName: string,
    chatId: string,
    counterAmount?: number
  ): Promise<string> {
    let title: string;
    let message: string;
    let type: NotificationType;

    switch (status) {
      case 'accepted':
        title = 'Offre acceptée !';
        message = `${sellerName} a accepté votre offre pour "${articleTitle}"`;
        type = 'offer_accepted';
        break;
      case 'rejected':
        title = 'Offre refusée';
        message = `${sellerName} a refusé votre offre pour "${articleTitle}"`;
        type = 'offer_rejected';
        break;
      case 'counter':
        title = 'Contre-offre reçue';
        message = `${sellerName} propose ${counterAmount} $ pour "${articleTitle}"`;
        type = 'offer_counter';
        break;
    }

    return this.createNotification(
      buyerId,
      type,
      title,
      message,
      { articleId, articleTitle, userName: sellerName, chatId, amount: counterAmount }
    );
  }
}
