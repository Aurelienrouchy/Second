import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

// ─── Types ──────────────────────────────────────────────────────────────────

// Mirrors the server producer union (functions/src/utils/notifications.ts
// `buildDeepLink`). Keep in sync so the client routing never sees an
// unhandled type.
export type PushNotificationType =
  | 'support_deadline'
  | 'account_security'
  | 'eligibility_review'
  | 'chat'
  | 'message'
  | 'new_message'
  | 'meetup_confirmed'
  | 'meetup_completed'
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
  | 'order_paid'
  | 'order_shipped'
  | 'order_delivered'
  | 'buyer_receipt_declared'
  | 'order_cancelled'
  | 'order_refunded'
  | 'order_moderation'
  | 'shipping_update'
  | 'article_moderation'
  | 'product_review_update'
  | 'dispute_resolved'
  | 'withdrawal_update'
  | 'funds_released'
  | 'review_received'
  | 'moderation_update'
  | 'privacy_incident';

export interface PushNotificationData {
  pushEnvironment?: 'seconde_dev';
  deadlineLane?: 'dated' | 'unknown' | 'bank';
  sourceCollection?: 'support_requests' | 'bank_dispute_cases';
  alertId?: string;
  proofId?: string;
  sourceHash?: string;
  event?: string;
  reviewCapability?: 'seller_activity_review_v1';
  bankCaseCapability?: 'bank_dispute_case_v1';
  bankCaseEntryId?: string;
  bankCaseEntryHash?: string;
  disputeId?: string;
  supportRequestId?: string;
  accountRelationshipCapability?: 'account_relationship_review_v1';
  accountRelationshipPairId?: string;
  accountRelationshipEntryId?: string;
  accountRelationshipEntryHash?: string;
  accountRelationshipVersion?: string;
  contentSafetyCapability?: 'content_safety_v1';
  contentTargetType?: 'review'|'message';
  contentTargetId?: string;
  contentCaseId?: string;
  contentEntryId?: string;
  contentEntryHash?: string;
  contentEntryVersion?: string;
  reportId?: string;
  // Routing
  ownerId?: string;
  labelLifecycleCaseId?: string;
  labelLifecycleLeg?: 'forward' | 'return';
  labelLifecycleEntryId?: string;
  labelLifecycleNoticeState?: 'intent_reserved' | 'entry_recorded';
  labelRouteAmendmentEntryId?: string;
  labelRouteAmendmentContentHash?: string;
  routeAmendmentCapability?: 'label_route_amendment_v1';
  parcelAmendmentCapability?: 'label_parcel_amendment_v1';
  productReviewCaseId?: string;
  contextKind?: 'order' | 'article_report' | 'article_listing';
  contextId?: string;
  productReviewEventId?: string;
  productReviewEvidenceId?: string;
  productReviewAdmissionId?: string;
  lateCommercialCapability?: 'late_commercial_recourse_v1';
  lateCommercialAdmissionId?: string;
  lateCommercialAdmissionHash?: string;
  productPhysicalInstructionId?: string;
  productPhysicalSignalId?: string;
  childPublicationCommandId?: string;
  withdrawalRequestId?: string;
  chatId?: string;
  articleId?: string;
  decisionId?: string;
  favorableRecorded?: 'true';
  listingReactivated?: 'true' | 'false';
  partyId?: string;
  swapId?: string;
  savedSearchId?: string;
  transactionId?: string;
  receiptDeclarationCommandId?: string;
  reviewId?: string;
  /**
   * Full universal-link URL built by the server
   * (functions/src/utils/notifications.ts `buildDeepLink`), e.g.
   * `https://seconde.ca/my-orders?transactionId=…`. Preferred routing source.
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
