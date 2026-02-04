import { SavedSearchService } from '@/services/savedSearchService';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { NotificationService } from '../services/notificationService';
import { useAuth } from './AuthContext';

// Configure notification handling behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export interface NotificationData {
  // Routing data
  chatId?: string;
  articleId?: string;
  partyId?: string;
  savedSearchId?: string;

  // Display data
  savedSearchName?: string;
  newItemsCount?: number;
  articleTitle?: string;
  partyName?: string;
  userName?: string;
  amount?: number;
  oldPrice?: number;
  newPrice?: number;

  // Notification type for routing
  type?:
    | 'chat'
    | 'saved_search'
    | 'shop_approved'
    | 'shop_rejected'
    | 'shop_created'
    | 'article_favorited'
    | 'price_drop'
    | 'swap_zone_reminder'
    | 'offer_received'
    | 'offer_accepted'
    | 'offer_rejected'
    | 'offer_counter';
}

interface NotificationContextType {
  notificationCount: number;
  clearNotifications: () => Promise<void>;
  refreshBadgeCount: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [notificationCount, setNotificationCount] = useState(0);
  const notificationListener = useRef<Notifications.Subscription | undefined>(undefined);
  const responseListener = useRef<Notifications.Subscription | undefined>(undefined);

  useEffect(() => {
    if (!user) return;

    // Get initial badge count
    refreshBadgeCount();

    // Set up notification listeners
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log('Notification received:', notification);
      refreshBadgeCount();
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationTap(response);
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [user]);

  const handleNotificationTap = async (response: Notifications.NotificationResponse) => {
    const data = response.notification.request.content.data as NotificationData;

    if (!data) return;

    // Route based on notification type
    switch (data.type) {
      // Article favorited - go to article detail
      case 'article_favorited':
        if (data.articleId) {
          router.push(`/article/${data.articleId}`);
        }
        return;

      // Price drop - go to article detail
      case 'price_drop':
        if (data.articleId) {
          router.push(`/article/${data.articleId}`);
        }
        return;

      // Swap zone reminder - go to swap party
      case 'swap_zone_reminder':
        if (data.partyId) {
          router.push(`/swap-party/${data.partyId}`);
        }
        return;

      // Offer notifications - go to chat
      case 'offer_received':
      case 'offer_accepted':
      case 'offer_rejected':
      case 'offer_counter':
        if (data.chatId) {
          router.push(`/chat/${data.chatId}`);
        }
        return;

      // Chat notifications
      case 'chat':
        if (data.chatId) {
          router.push(`/chat/${data.chatId}`);
        }
        return;

      // Saved search notifications
      case 'saved_search':
        if (data.savedSearchId && user) {
          try {
            const savedSearch = await SavedSearchService.getSavedSearchById(user.id, data.savedSearchId);

            if (savedSearch) {
              await SavedSearchService.resetNewItemsCount(user.id, data.savedSearchId);

              const filtersParam = JSON.stringify({
                ...savedSearch.filters,
              });

              router.push({
                pathname: '/search-results',
                params: {
                  query: savedSearch.query || '',
                  filters: filtersParam,
                },
              });
            }
          } catch (error) {
            console.error('Error handling saved search notification:', error);
            router.push('/search-results');
          }
        }
        return;

      default:
        // Fallback: check for chatId (legacy support)
        if (data.chatId) {
          router.push(`/chat/${data.chatId}`);
          return;
        }

        // Fallback: check for articleId
        if (data.articleId) {
          router.push(`/article/${data.articleId}`);
          return;
        }

        // Fallback: check for partyId
        if (data.partyId) {
          router.push(`/swap-party/${data.partyId}`);
          return;
        }

        console.log('Unhandled notification type:', data.type);
    }
  };

  const refreshBadgeCount = async () => {
    if (!user) return;
    const count = await NotificationService.countUnreadNotifications(user.id);
    setNotificationCount(count);
  };

  const clearNotifications = async () => {
    if (!user) return;
    await NotificationService.markAllAsRead(user.id);
    setNotificationCount(0);
  };

  return (
    <NotificationContext.Provider
      value={{
        notificationCount,
        clearNotifications,
        refreshBadgeCount,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = (): NotificationContextType => {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
