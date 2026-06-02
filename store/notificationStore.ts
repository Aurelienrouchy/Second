import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// ─── Types ──────────────────────────────────────────────────────────────────

// Mirrors the server producer union (functions/src/utils/notifications.ts
// `buildDeepLink`). Keep in sync so the client routing never sees an
// unhandled type.
export type PushNotificationType =
  | 'chat'
  | 'message'
  | 'new_message'
  | 'saved_search'
  | 'shop_approved'
  | 'shop_rejected'
  | 'shop_created'
  | 'article_favorited'
  | 'price_drop'
  | 'swap_zone_reminder'
  | 'swap_update'
  | 'offer'
  | 'offer_received'
  | 'offer_accepted'
  | 'offer_rejected'
  | 'offer_counter'
  | 'new_sale'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_cancelled'
  | 'order_refunded'
  | 'funds_released'
  | 'review_received'
  | 'privacy_incident';

export interface PushNotificationData {
  // Routing
  chatId?: string;
  articleId?: string;
  partyId?: string;
  swapId?: string;
  savedSearchId?: string;
  transactionId?: string;
  reviewId?: string;
  /**
   * Full universal-link URL built by the server
   * (functions/src/utils/notifications.ts `buildDeepLink`), e.g.
   * `https://seconde.app/my-orders?transactionId=…`. Preferred routing source.
   */
  deepLink?: string;

  // Display
  savedSearchName?: string;
  newItemsCount?: number;
  articleTitle?: string;
  partyName?: string;
  userName?: string;
  senderId?: string;
  senderName?: string;
  amount?: string;
  oldPrice?: string;
  newPrice?: string;
  status?: string;

  // Notification type for routing
  type?: PushNotificationType;
}

// ─── State ──────────────────────────────────────────────────────────────────

interface NotificationState {
  /** Nombre de notifications non lues (badge) */
  unreadCount: number;
  /** Si le setup initial est terminé */
  isSetupComplete: boolean;
  /** Token FCM actuel du device */
  pushToken: string | null;
}

interface NotificationActions {
  setUnreadCount: (count: number) => void;
  incrementUnreadCount: () => void;
  clearUnreadCount: () => void;
  setSetupComplete: (complete: boolean) => void;
  setPushToken: (token: string | null) => void;
  reset: () => void;
}

// ─── Initial state (extracté pour reset) ────────────────────────────────────

const initialState: NotificationState = {
  unreadCount: 0,
  isSetupComplete: false,
  pushToken: null,
};

// ─── Store ──────────────────────────────────────────────────────────────────

export const useNotificationStore = create<NotificationState & NotificationActions>()(
  subscribeWithSelector((set) => ({
    ...initialState,

    setUnreadCount: (count) => set({ unreadCount: count }),
    incrementUnreadCount: () => set((state) => ({ unreadCount: state.unreadCount + 1 })),
    clearUnreadCount: () => set({ unreadCount: 0 }),
    setSetupComplete: (complete) => set({ isSetupComplete: complete }),
    setPushToken: (token) => set({ pushToken: token }),
    reset: () => set(initialState),
  }))
);

// ─── Selectors ──────────────────────────────────────────────────────────────

export const selectUnreadCount = (
  state: NotificationState & NotificationActions
): number => state.unreadCount;
