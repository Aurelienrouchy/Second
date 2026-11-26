import {accountControlNotificationContext} from '@/services/accountControlProofService';
import {hasSupportDeadlineNotice, supportDeadlineNotificationContext, hasSupportOwnerUpdateNotice, supportOwnerUpdateNotificationContext} from '@/services/supportRequestService';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import {privateNotificationPresentation} from '@/utils/notificationPresentation';
import {sellerActivityReviewNotificationContext} from '@/services/sellerActivityReviewNoticeService';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { captureNotificationNavigationChoice, deepLinkToHref, refreshNotificationBadge } from '@/features/notifications/hooks/useNotificationSetup';
import { track } from '@/lib/analytics';
import { NotificationService } from '@/features/notifications/services/notificationService';
import { SavedSearchService } from '@/services/savedSearchService';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { ShippingReceiptDeclarationService } from '@/services/shippingReceiptDeclarationService';
import { queryKeys } from '@/lib/queryKeys';
import { Notification, NotificationType } from '@/types';
import { productReviewNotificationContext, isProductReviewContext } from '@/services/productReviewService';
import { labelLifecycleNotificationContext } from '@/services/labelLifecycleService';
import { hasLateCommercialNotice, lateCommercialNotificationContext } from '@/services/lateCommercialRecourseService';
import { hasAccountRelationshipNotice, accountRelationshipNotificationContext } from '@/services/accountRelationshipReviewService';
import {contentSafetyNotificationContext} from '@/services/contentSafetyService';
import {hasBankDisputeCaseNotice,bankDisputeCaseNotificationContext} from '@/services/bankDisputeCaseNoticeService';
import {assertTradeSessionCurrent,captureTradeSession,type TradeSession} from '@/services/tradeOperation';
import ReportBottomSheet,{type ReportBottomSheetRef} from '@/components/ReportBottomSheet';
import { Ionicons } from '@expo/vector-icons';
import { CancelledError, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import {
  Pressable,
  AppState,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Skeleton } from '@/components/ui/Skeleton';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Swipeable from 'react-native-gesture-handler/Swipeable';

// Notification type to icon mapping
const notificationIcons: Record<NotificationType, { name: keyof typeof Ionicons.glyphMap; color: string }> = {
  support_deadline: {name: 'time-outline', color: colors.warning},
  account_security: {name: 'shield-checkmark-outline', color: colors.warning},
  eligibility_review: {name: 'document-text-outline', color: colors.warning},
  shipping_update: { name: 'pricetag-outline', color: colors.primary },
  article_favorited: { name: 'heart', color: colors.danger },
  price_drop: { name: 'pricetag', color: colors.success },
  saved_search: {name: 'search', color: colors.primary},
  swap_zone_reminder: { name: 'cube', color: colors.primary },
  offer_received: { name: 'cash', color: colors.success },
  offer_accepted: { name: 'checkmark-circle', color: colors.success },
  offer_rejected: { name: 'close-circle', color: colors.danger },
  offer_counter: { name: 'swap-horizontal', color: colors.warning },
  offer_expired: { name: 'time', color: colors.muted },
  new_message: { name: 'chatbubble', color: colors.primary },
  article_liked: { name: 'heart', color: colors.danger },
  article_sold: { name: 'bag-check', color: colors.success },
  shop_created: { name: 'storefront', color: colors.primary },
  shop_approved: { name: 'checkmark-circle', color: colors.success },
  shop_rejected: { name: 'close-circle', color: colors.danger },
  meetup_reminder: { name: 'location', color: colors.warning },
  meetup_confirmed: { name: 'checkmark-circle', color: colors.success },
  meetup_completed: { name: 'document-text-outline', color: colors.primary },
  meetup_cancelled: { name: 'close-circle', color: colors.danger },
  no_show_reported: { name: 'warning', color: colors.danger },
  swap_proposed: { name: 'swap-horizontal', color: colors.primary },
  swap_accepted: { name: 'checkmark-circle', color: colors.success },
  swap_declined: { name: 'close-circle', color: colors.danger },
  swap_photos_uploaded: { name: 'camera', color: colors.primary },
  swap_shipped: { name: 'send', color: colors.primary },
  swap_received: { name: 'cube', color: colors.success },
  swap_completed: { name: 'ribbon', color: colors.success },
  swap_party_starting: { name: 'people', color: colors.warning },
  swap_party_ending: { name: 'time', color: colors.warning },
  swap_match_found: { name: 'flash', color: colors.success },
  swap_update: { name: 'sync', color: colors.primary },
  new_sale: { name: 'bag-check', color: colors.success },
  order_paid: { name: 'card', color: colors.success },
  order_shipped: { name: 'send', color: colors.primary },
  order_delivered: { name: 'cube', color: colors.success },
  buyer_receipt_declared: { name: 'document-text-outline', color: colors.primary },
  order_cancelled: { name: 'close-circle', color: colors.danger },
  order_refunded: { name: 'card', color: colors.warning },
  order_moderation: { name: 'shield-checkmark-outline', color: colors.warning },
  product_review_update: { name: 'document-text-outline', color: colors.warning },
  article_moderation: { name: 'document-text-outline', color: colors.primary },
  dispute_resolved: { name: 'document-text-outline', color: colors.primary },
  withdrawal_update: { name: 'wallet-outline', color: colors.primary },
  funds_released: { name: 'cash', color: colors.success },
  review_received: { name: 'star', color: colors.warning },
  privacy_incident: { name: 'shield-checkmark', color: colors.danger },
  moderation_update: { name: 'shield-checkmark-outline',color:colors.warning },
};

// Strip leading emoji from notification titles/messages.
// Handles legacy data stored in Firestore that may still contain emoji prefixes.
const EMOJI_RE = /^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u;
function stripLeadingEmoji(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(EMOJI_RE, '').trim();
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "À l'instant";
  if (diffMins < 60) return `Il y a ${diffMins} min`;
  if (diffHours < 24) return `Il y a ${diffHours}h`;
  if (diffDays < 7) return `Il y a ${diffDays}j`;
  return date.toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short' });
}

interface NotificationItemProps {
  notification: Notification;
  onPress: (notification: Notification) => void;
  onDelete: (notificationId: string) => void;
  testID?: string;
}

function NotificationItem({ notification, onPress, onDelete, testID }: NotificationItemProps) {
  const iconConfig = notificationIcons[notification.type] || { name: 'notifications', color: colors.primary };
  const presentation = hasSupportOwnerUpdateNotice(notification.data)
    ? {title: 'Mise à jour du support', message: 'Une mise à jour de votre dossier de support est disponible dans votre espace privé.'}
    : notification.type === 'order_moderation' && hasAccountRelationshipNotice(notification.data)
    ? {title: 'Vérification de vos comptes', message: 'Une mise à jour est disponible dans le suivi de vos comptes.'}
    : privateNotificationPresentation(notification);

  const renderRightActions = () => (
    <Pressable
      style={styles.deleteAction}
      onPress={() => onDelete(notification.id)}
    >
      <Ionicons name="trash" size={24} color={colors.white} />
    </Pressable>
  );

  return (
    <Swipeable renderRightActions={renderRightActions}>
      <Pressable
        testID={testID}
        style={[
          styles.notificationItem,
          !notification.isRead && styles.notificationItemUnread,
        ]}
        onPress={() => onPress(notification)}
      >
        <View style={[styles.iconContainer, { backgroundColor: `${iconConfig.color}15` }]}>
          <Ionicons name={iconConfig.name} size={24} color={iconConfig.color} />
        </View>

        <View style={styles.notificationContent}>
          <Text style={styles.notificationTitle} numberOfLines={1}>
            {notification.type === 'buyer_receipt_declared' ? 'Réception déclarée par l’acheteur' : notification.type === 'article_moderation' ? 'Décision privée sur votre article' : stripLeadingEmoji(presentation.title)}
          </Text>
          <Text style={styles.notificationMessage} numberOfLines={notification.type === 'privacy_incident' ? undefined : 2}>
            {notification.type === 'buyer_receipt_declared' ? 'L’acheteur indique avoir reçu le colis. Consultez la commande pour la suite.' : notification.type === 'article_moderation' ? 'Consultez le suivi de votre annonce pour en savoir plus.' : stripLeadingEmoji(presentation.message)}
          </Text>
          <Text style={styles.notificationTime}>
            {formatTimeAgo(notification.createdAt)}
          </Text>
        </View>

        {!notification.isRead && <View style={styles.unreadDot} />}
      </Pressable>
    </Swipeable>
  );
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const userId = useAuthenticatedUid();
  const {contentSafetyNotice}=useLocalSearchParams<{contentSafetyNotice?:string|string[]}>();
  const reportSheet=useRef<ReportBottomSheetRef>(null),contentEpoch=useRef(0),initialSeen=useRef<unknown>(null);
  const initialPending=useRef<{choice:ReturnType<typeof captureNotificationNavigationChoice>;epoch:number;uid:string|null;session:TradeSession|null;data:unknown;started:boolean}|null>(null);
  const [contentNotice,setContentNotice]=useState('');
  const notificationContext = useLabelLifecycleContext('notifications', userId ?? null);
  const queryClient = useQueryClient();
  const generation = useAuthStore(getAuthSessionGeneration);
  const notificationQueryKey = [...queryKeys.notifications.list(userId ?? ''), generation, notificationContext.focusRevision];
  const modifying = useRef(new Set<string>());
  const routed = useRef<{frame: symbol; focus: string; id: string} | null>(null);
  const closeContent=()=>{contentEpoch.current++;captureNotificationNavigationChoice();};
  // Capture the arriving OS selection before later taps. Its async proof can
  // never acquire a fresh navigation token after another choice or close.
  useLayoutEffect(()=>{
    if(contentSafetyNotice!==undefined&&initialSeen.current!==contentSafetyNotice){
      initialSeen.current=contentSafetyNotice;initialPending.current=null;
      const choice=captureNotificationNavigationChoice(),epoch=++contentEpoch.current;
      if(typeof contentSafetyNotice!=='string'||contentSafetyNotice.length>12000)return;
      let data:unknown;try{data=JSON.parse(contentSafetyNotice);}catch{return;}
      let session:TradeSession|null=null;try{session=captureTradeSession(userId??undefined);}catch{/* Wait for the arriving SDK session, never for a profile. */}
      initialPending.current={choice,epoch,uid:userId,session,data,started:false};
    }
    const pending=initialPending.current;if(!pending||pending.started)return;
    if(pending.uid===null&&userId!==null){pending.uid=userId;try{pending.session=captureTradeSession(userId);}catch{return;}}
    try{pending.choice.assertCurrent();if(contentEpoch.current!==pending.epoch||pending.uid!==null&&pending.uid!==userId)throw new Error('Un autre contenu ou compte a été choisi.');if(pending.session)assertTradeSessionCurrent(pending.session);}
    catch{initialPending.current=null;return;}
    if(!userId||!notificationContext.focused)return;
    // A passive focus effect may not have activated the context at mount.
    // Preserve this original choice/epoch on that transient capture failure.
    let op;try{op=notificationContext.capture();}catch{return;}
    if(pending.session){try{assertTradeSessionCurrent(pending.session);}catch{initialPending.current=null;return;}}
    else{pending.uid=userId;pending.session=op.base.session;}
    pending.started=true;
    const current=()=>{pending.choice.assertCurrent();notificationContext.assertCurrent(op);assertTradeSessionCurrent(pending.session!);if(initialPending.current!==pending||contentEpoch.current!==pending.epoch)throw new Error('Un autre contenu a été choisi.');};
    void(async()=>{try{const selection=await contentSafetyNotificationContext(pending.data,userId,current);current();if(selection)pending.choice.commit(()=>reportSheet.current?.openReview(selection));else setContentNotice('Ce signalement est indisponible. Réessayez depuis Mes signalements.');}
      catch{try{current();setContentNotice('Impossible d’ouvrir cette décision. Réessayez depuis Mes signalements.');}catch{/* New selection/close wins. */}}})();
    // The hook owns SDK/activity/focus invalidation; no stale source survives.
  },[contentSafetyNotice,userId,notificationContext]);

  const refreshBadgeCount = useCallback(() => {
    if (userId) refreshNotificationBadge(userId);
  }, [userId]);

  const {
    data: notifications = [],
    isLoading,
    isError,
    isRefetching,
    refetch,
  } = useQuery<Notification[]>({
    queryKey: notificationQueryKey,
    queryFn: async ({signal}) => {
      try {
        if (signal.aborted) throw new CancelledError({revert: true});
        const operation = notificationContext.capture();
        const result = await NotificationService.getUserNotifications(operation.base.session.uid);
        notificationContext.assertCurrent(operation);
        return result;
      } catch (error) {
        if (signal.aborted || error && typeof error === 'object' && 'code' in error && error.code === 'client/stale-operation') throw new CancelledError({revert: true});
        throw error;
      }
    },
    enabled: !!userId && notificationContext.focused,
    staleTime: 2 * 60 * 1000,
  });

  const handleNotificationPress = async (notification: Notification) => {
    if (routed.current?.frame === notificationContext.frame && routed.current.focus === notificationContext.focusRevision && routed.current.id === notification.id) return;
    const choice = captureNotificationNavigationChoice();
    const epoch=++contentEpoch.current;setContentNotice('');
    let operation;
    try { operation = notificationContext.capture(); } catch { return; }
    if (notification.userId !== operation.base.session.uid) return;
    const assertCurrent = () => {choice.assertCurrent(); notificationContext.assertCurrent(operation);if(contentEpoch.current!==epoch)throw new Error('Un autre avis a été choisi.');};
    const router = {push: (href: Parameters<typeof choice.navigate>[0]) => {
      try {assertCurrent(); choice.navigate(href); routed.current = {frame: notificationContext.frame, focus: notificationContext.focusRevision, id: notification.id};} catch { /* A newer choice or an already routed choice has priority. */ }
    }};
    const wasUnread = !notification.isRead;
    // Navigation is immediate. This independent bookkeeping write cannot
    // block a conversation, and its late response cannot update another account.
    if (!notification.isRead) {
      void NotificationService.markAsRead(notification.id).then(() => {
        assertTradeSessionCurrent(operation.base.session);
        queryClient.setQueryData<Notification[]>(notificationQueryKey,
          old => old?.map(n => n.id === notification.id ? {...n, isRead: true} : n) ?? []);
        refreshBadgeCount();
      }).catch(error => {if (__DEV__) console.warn('Notification opened; read marker unavailable:', error);});
    }

    // Navigate using the server-built deepLink (buildDeepLink in
    // functions/src/utils/notifications.ts stores a full universal URL on
    // notification.data.deepLink).
    const data = notification.data;
    const deepLink = data?.deepLink;
    // Historical Stripe types can exist in storage before the app's type union.
    const legacyStripeRequirements = String(notification.type) === 'stripe_requirements_due';
    const destination: 'deep_link' | 'chat' | 'article' | 'swap_party' | 'none' = deepLink || legacyStripeRequirements
      ? 'deep_link'
      : data?.chatId
        ? 'chat'
        : data?.articleId
          ? 'article'
          : data?.partyId
            ? 'swap_party'
            : 'none';
    track('notification_opened', {
      notification_id: notification.id,
      notification_type: notification.type,
      was_unread: wasUnread,
      destination,
    });
    assertCurrent();
    if (notification.type === 'support_deadline' || hasSupportDeadlineNotice(data)) {
      if (notification.type !== 'support_deadline' || notification.userId !== operation.base.session.uid) return;
      try {const target = await supportDeadlineNotificationContext(data, operation.base.session.uid, assertCurrent); assertCurrent(); router.push({pathname: '/admin/support', params: {deadlineLane: target.lane}} as never);}
      catch {try {assertCurrent(); setContentNotice('Impossible d’ouvrir ce suivi. Actualisez la liste des demandes de support.');} catch {/* A newer SDK/focus choice wins. */}}
      return;
    }
    if (hasSupportOwnerUpdateNotice(data)) {
      if (notification.type !== 'order_moderation' || notification.userId !== operation.base.session.uid) return;
      try {const target = await supportOwnerUpdateNotificationContext(data, operation.base.session.uid, assertCurrent); assertCurrent();
        router.push({pathname: '/settings/support/[id]', params: {id: target.supportRequestId}} as never);
      } catch {try {assertCurrent(); setContentNotice('Impossible d’ouvrir cette notification. Retrouvez votre demande dans le support.');} catch {/* A later SDK or source choice wins. */}}
      return;
    }
    if (notification.type === 'account_security') {
      if (notification.userId !== operation.base.session.uid) return;
      try {const target = await accountControlNotificationContext({...data, ownerId: notification.userId}, operation.base.session.uid, assertCurrent); assertCurrent();
        router.push(target.reference ? {pathname: '/settings/account-control', params: {accountControlNotice: JSON.stringify(target.reference)}} as never : '/settings/account-control' as never);
      } catch {try {assertCurrent(); setContentNotice('Impossible d’ouvrir cette notification. Consultez le suivi de vos comptes.');} catch {/* A newer SDK choice wins. */}}
      return;
    }
    if (notification.type === 'eligibility_review') {
      if (notification.userId !== operation.base.session.uid) return;
      try {const target = await sellerActivityReviewNotificationContext(data, operation.base.session.uid, assertCurrent); assertCurrent(); router.push({pathname: '/settings/eligibility', params: {reviewId: target.reviewId}} as never);}
      catch {try {assertCurrent(); setContentNotice('Impossible d’ouvrir cet examen. Consultez le suivi de votre compte.');} catch {/* Latest SDK choice wins. */}}
      return;
    }
    if (hasBankDisputeCaseNotice(data)) {
      if(notification.type!=='order_moderation'||notification.userId!==operation.base.session.uid)return;
      try{const selected=await bankDisputeCaseNotificationContext(data,operation.base.session.uid,assertCurrent);assertCurrent();router.push({pathname:'/orders/[id]',params:{id:selected.transactionId,bankCaseNotice:JSON.stringify(selected)}} as never);}
      catch{try{assertCurrent();setContentNotice('Impossible d’ouvrir cette notification. Consultez le suivi de votre commande.');}catch{/* Newer choice wins. */}}
      return;
    }
    if(notification.type==='moderation_update'){
      if(notification.userId!==operation.base.session.uid)return;
      try{const selection=await contentSafetyNotificationContext(data,operation.base.session.uid,assertCurrent);assertCurrent();
        if(selection)choice.commit(()=>reportSheet.current?.openReview(selection));else setContentNotice('Ce signalement est indisponible. Réessayez depuis Mes signalements.');
      }catch{try{assertCurrent();setContentNotice('Impossible d’ouvrir cette décision. Réessayez depuis Mes signalements.');}catch{/* Latest choice wins. */}}
      return;
    }
    if (notification.type === 'shipping_update') {
      if (notification.userId !== operation.base.session.uid || data?.ownerId !== operation.base.session.uid) return;
      let active = AppState.currentState === 'active';
      const sub = AppState.addEventListener('change', state => {if (state !== 'active') active = false;});
      const current = () => {assertCurrent(); if (!active || AppState.currentState !== 'active') throw new Error('Relisez cet avis depuis le dossier actif.');};
      try {current(); const context = await labelLifecycleNotificationContext(data, operation.base.session.uid, current, notification.id); current();
        if (context) router.push({pathname: '/label-lifecycle', params: {transactionId: context.transactionId, leg: context.leg, ...(context.routeAmendmentNotice ? {routeEntryId: context.routeAmendmentNotice.entryId, routeContentHash: context.routeAmendmentNotice.contentHash, routeNotificationId: context.routeAmendmentNotice.notificationId} : {}), ...(context.parcelAmendmentCapability ? {parcelAmendmentCapability: context.parcelAmendmentCapability} : {})}} as never);
      } catch { /* An addressed notice is requalified natively; no historic URL grants access or use. */ }
      finally {sub.remove();}
      return;
    }
    if (notification.type === 'product_review_update') {
      if (notification.userId !== operation.base.session.uid) return;
      if (hasLateCommercialNotice(data)) {
        try {
          const current = assertCurrent;
          const result = await lateCommercialNotificationContext(data, operation.base.session.uid, current, notification.id); current();
          router.push({pathname: '/product-review', params: {contextKind: 'order', contextId: result.transactionId, lateCommercialNotice: JSON.stringify(result.noticeReference)}} as never);
        } catch { /* Keep an unqualified late notice closed, without a generic-route fallback. */ }
        return;
      }
      try {const context = await productReviewNotificationContext(data, operation.base.session.uid, assertCurrent);
        assertCurrent();
        if (context) router.push({pathname: '/product-review', params: {contextKind: context.kind, contextId: context.id}} as never);
      } catch { /* Keep native private admission at the destination. */ }
      return;
    }
    if (notification.type === 'buyer_receipt_declared') {
      if (notification.userId !== operation.base.session.uid || data?.ownerId !== operation.base.session.uid ||
        typeof data.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.transactionId) ||
        !/^[a-f0-9]{64}$/.test(data.receiptDeclarationCommandId ?? '')) return;
      try {
        const result = await ShippingReceiptDeclarationService.read(operation.base.session.uid, data.transactionId,
          assertCurrent);
        assertCurrent();
        if (result.current?.role === 'seller' && result.current.declaration?.commandId === data.receiptDeclarationCommandId)
          router.push({pathname: '/orders/[id]', params: {id: data.transactionId}});
      } catch { /* Keep the notice distinct from a verified carrier event or permission. */ }
      return;
    }
    if (notification.type === 'article_moderation') {
      if (notification.userId === operation.base.session.uid && data?.ownerId === operation.base.session.uid && typeof data.childPublicationCommandId === 'string' && /^cp_[a-f0-9]{64}$/.test(data.childPublicationCommandId) && typeof data.articleId === 'string' && isProductReviewContext({kind: 'article_listing', id: data.articleId})) {
        assertCurrent(); router.push({pathname: '/product-review', params: {contextKind: 'article_listing', contextId: data.articleId}} as never); return;
      }
      if (notification.userId !== operation.base.session.uid || data?.ownerId !== operation.base.session.uid ||
        typeof data.articleId !== 'string' || !data.articleId.trim() || data.articleId.trim() !== data.articleId || data.articleId.includes('/') ||
        !/^[a-f0-9]{64}$/.test(data.decisionId ?? '') || data.favorableRecorded !== 'true' || !['true', 'false'].includes(data.listingReactivated ?? '')) return;
      router.push({pathname: '/article/moderation/[id]', params: {id: data.articleId}});
      return;
    }
    if (notification.type === 'meetup_confirmed' || notification.type === 'meetup_completed') {
      if (notification.userId !== operation.base.session.uid || (data?.ownerId !== undefined && data.ownerId !== operation.base.session.uid)) return;
      if (typeof data?.chatId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.chatId)) {
        router.push({ pathname: '/chat/[id]', params: { id: data.chatId } });
      } else if (typeof data?.transactionId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.transactionId)) {
        router.push({ pathname: '/orders/[id]', params: { id: data.transactionId } });
      }
      return;
    }
    if (notification.type === 'withdrawal_update') {
      if (notification.userId === operation.base.session.uid && data?.ownerId === operation.base.session.uid) {
        router.push('/wallet');
      }
      return;
    }
    if (notification.type === 'order_moderation' && hasAccountRelationshipNotice(data)) {
      if (notification.userId !== operation.base.session.uid) return;
      try {const selected = await accountRelationshipNotificationContext(data, operation.base.session.uid, assertCurrent); assertCurrent();
        router.push({pathname: '/settings/support/[id]', params: {id: selected.supportRequestId, accountRelationship: JSON.stringify(selected.reference)}} as never);
      } catch { /* Unqualified account notice never falls back to a generic link or another member's private ticket. */ }
      return;
    }
    if (['order_moderation', 'order_paid', 'dispute_resolved'].includes(notification.type)) {
      if (typeof data?.transactionId === 'string' && data.transactionId && !data.transactionId.includes('/')) {
        router.push({ pathname: '/orders/[id]', params: { id: data.transactionId } });
      }
      return;
    }
    if (String(notification.type) === 'saved_search') {
      const searchId = data?.savedSearchId;
      if (typeof searchId !== 'string' || !searchId || searchId.includes('/')) return;
      try {
        const saved = await SavedSearchService.getSavedSearchById(operation.base.session.uid, searchId);
        assertCurrent();
        if (!saved) {setContentNotice('Cette recherche enregistrée n’est plus disponible.'); return;}
        router.push({pathname: '/search', params: {query: saved.query || '', filters: JSON.stringify(saved.filters || {})}});
        void SavedSearchService.resetNewItemsCount(operation.base.session.uid, searchId).catch(error => {
          if (__DEV__) console.warn('Saved search opened; counter refresh unavailable:', error);
        });
      } catch {try {assertCurrent(); setContentNotice('Impossible de charger cette recherche. Réessayez dans un instant.');} catch { /* The latest choice wins. */ }}
      return;
    }
    const href = deepLinkToHref(deepLink);
    if (href) {
      router.push(href);
      return;
    }

    // Legacy fallback for notifications stored before deepLink was emitted.
    if (legacyStripeRequirements) {
      router.push('/settings/stripe-onboarding');
    } else if (data?.chatId) {
      router.push(`/chat/${data.chatId}`);
    } else if (data?.articleId) {
      router.push(`/article/${data.articleId}`);
    } else if (data?.partyId) {
      router.push(`/swap-party/${data.partyId}`);
    }
  };

  const handleDeleteNotification = async (notificationId: string) => {
    const target = notifications.find((n) => n.id === notificationId);
    if (!target || target.userId !== userId) return;
    let operation;
    try {operation = notificationContext.capture();} catch {return;}
    const key = JSON.stringify([operation.base.session, 'delete', notificationId]);
    if (modifying.current.has(key)) return;
    modifying.current.add(key);
    try {
      await NotificationService.deleteNotification(notificationId);
      notificationContext.assertCurrent(operation);
      queryClient.setQueryData<Notification[]>(
        notificationQueryKey,
        (old) => old?.filter((n) => n.id !== notificationId) ?? [],
      );
      if (target) {
        track('notification_deleted', {
          notification_type: target.type,
          was_unread: !target.isRead,
        });
      }
      refreshBadgeCount();
    } catch (error) {
      if (notificationContext.isCurrent(operation)) setContentNotice('Impossible de supprimer cette notification pour le moment.');
    } finally {modifying.current.delete(key);}
  };

  const handleMarkAllAsRead = async () => {
    if (!userId) return;
    let operation;
    try {operation = notificationContext.capture();} catch {return;}
    const key = JSON.stringify([operation.base.session, 'mark-all']);
    if (modifying.current.has(key)) return;
    modifying.current.add(key);

    try {
      await NotificationService.markAllAsRead(userId);
      notificationContext.assertCurrent(operation);
      track('notifications_marked_all_read', {
        unread_count: notifications.filter((n) => !n.isRead).length,
        total_count: notifications.length,
      });
      queryClient.setQueryData<Notification[]>(
        notificationQueryKey,
        (old) => old?.map((n) => ({ ...n, isRead: true })) ?? [],
      );
      refreshBadgeCount();
    } catch (error) {
      if (notificationContext.isCurrent(operation)) setContentNotice('Impossible de marquer les notifications comme lues pour le moment.');
    } finally {modifying.current.delete(key);}
  };

  const unreadCount = notifications.filter((n) => !n.isRead).length;
  const contentTools=<>
    {contentNotice?<Text accessibilityRole="alert" style={styles.emptySubtitle}>{contentNotice}</Text>:null}
    <Pressable disabled={!userId} accessibilityRole="button" style={styles.headerButton} onPress={()=>{contentEpoch.current++;const choice=captureNotificationNavigationChoice();try{notificationContext.capture();choice.commit(()=>reportSheet.current?.openReview(null));}catch{/* SDK/activity required for own journal. */}}}><Text style={styles.markAllText}>Mes signalements</Text></Pressable>
    <ReportBottomSheet key={userId??'anonymous'} ref={reportSheet} onClose={closeContent}/>
  </>;

  if (isLoading || !!userId && !notificationContext.focused) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.container}>
          <ScreenHeader title="Notifications" onBack={() => router.back()} />
          <View style={{ paddingVertical: spacing.sm }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <View key={i} style={styles.notificationItem}>
                <Skeleton
                  width={48}
                  height={48}
                  borderRadius={radius.full}
                  style={{ marginRight: spacing.md }}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Skeleton width="60%" height={14} />
                  <Skeleton width="85%" height={13} />
                  <Skeleton width="25%" height={12} />
                </View>
              </View>
            ))}
          </View>
        </View>
        {contentTools}
      </>
    );
  }

  if (isError) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.container}>
          <ScreenHeader title="Notifications" onBack={() => router.back()} />
          <View style={styles.emptyState}>
            <Ionicons name="cloud-offline-outline" size={64} color={colors.muted} />
            <Text style={styles.emptyTitle}>Impossible de charger</Text>
            <Text style={styles.emptySubtitle}>
              Une erreur est survenue lors du chargement de vos notifications.
            </Text>
            <Pressable
              onPress={() => {
                track('error_retry_tapped', {
                  screen: 'notifications',
                  error_context: 'notifications_load',
                });
                refetch();
              }}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Réessayer</Text>
            </Pressable>
          </View>
        </View>
        {contentTools}
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.container} testID="notifications-screen">
        <ScreenHeader
          title="Notifications"
          onBack={() => router.back()}
          rightContent={
            unreadCount > 0 ? (
              <Pressable onPress={handleMarkAllAsRead} style={styles.headerButton}>
                <Text style={styles.markAllText}>Tout lire</Text>
              </Pressable>
            ) : undefined
          }
        />

        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        {notifications.length === 0 ? (
          <View style={styles.emptyState} testID="notifications-empty">
            <Ionicons name="notifications-off-outline" size={64} color={colors.muted} />
            <Text style={styles.emptyTitle}>Aucune notification</Text>
            <Text style={styles.emptySubtitle}>
              Vous recevrez des notifications pour les favoris, baisses de prix, et propositions d&apos;achat.
            </Text>
          </View>
        ) : (
          <FlashList
            data={notifications}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <NotificationItem
                notification={item}
                onPress={handleNotificationPress}
                onDelete={handleDeleteNotification}
                testID={`notification-item-${item.id}`}
              />
            )}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => {
                  track('list_refreshed', {
                    screen: 'notifications',
                    items_count: notifications.length,
                  });
                  refetch();
                }}
                tintColor={colors.primary}
              />
            }
          />
        )}
        </View>
      </View>
      {contentTools}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerButton: {
    padding: spacing.sm,
  },
  markAllText: {
    ...typography.label,
    color: colors.primary,
  },
  listContent: {
    paddingVertical: spacing.sm,
  },
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  notificationItemUnread: {
    backgroundColor: colors.primaryLight,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  notificationContent: {
    flex: 1,
  },
  notificationTitle: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: 2,
  },
  notificationMessage: {
    ...typography.bodySmall,
    color: colors.foregroundSecondary,
    marginBottom: 4,
  },
  notificationTime: {
    ...typography.caption,
    color: colors.muted,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    marginLeft: spacing.sm,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 76, // iconContainer width + marginRight
  },
  deleteAction: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.body,
    color: colors.foregroundSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  retryText: {
    ...typography.label,
    color: colors.white,
  },
});
