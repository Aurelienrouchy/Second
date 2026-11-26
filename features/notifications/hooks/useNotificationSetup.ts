import {accountControlNotificationContext} from '@/services/accountControlProofService';
import {hasSupportDeadlineNotice, supportDeadlineNotificationContext, hasSupportOwnerUpdateNotice, supportOwnerUpdateNotificationContext} from '@/services/supportRequestService';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus, InteractionManager, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { router as notificationRouter, type Href } from 'expo-router';

import { track } from '@/lib/analytics';
import { NotificationService } from '@/features/notifications/services/notificationService';
import { SavedSearchService } from '@/services/savedSearchService';
import { UserService } from '@/services/userService';
import { auth } from '@/config/firebaseConfig';
import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import {canRegisterDevPushDestination, prepareDevPushBinding, registerDevPushDestination, type DevPushBinding} from '@/services/devPushDestinationService';
import { useNotificationStore, PushNotificationData } from '@/store/notificationStore';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { useShallow } from 'zustand/react/shallow';
import { assertTradeSessionCurrent, captureTradeSession, type TradeSession } from '@/services/tradeOperation';
import { ShippingReceiptDeclarationService } from '@/services/shippingReceiptDeclarationService';
import { productReviewNotificationContext, isProductReviewContext } from '@/services/productReviewService';
import { labelLifecycleNotificationContext } from '@/services/labelLifecycleService';
import { hasLateCommercialNotice, lateCommercialNotificationContext } from '@/services/lateCommercialRecourseService';
import { hasAccountRelationshipNotice, accountRelationshipNotificationContext } from '@/services/accountRelationshipReviewService';
import {contentSafetyNotificationContext} from '@/services/contentSafetyService';
import {hasBankDisputeCaseNotice,bankDisputeCaseNotificationContext} from '@/services/bankDisputeCaseNoticeService';
import {sellerActivityReviewNotificationContext} from '@/services/sellerActivityReviewNoticeService';
import {isConversationNotification, synchronizeNotificationBadge} from '@/services/chatNotificationReadService';

// Maps a push payload to the coarse destination bucket for `push_opened`
// analytics (mirrors routeFromNotificationData without navigating).
type PushDestination =
  | 'chat'
  | 'article'
  | 'swap'
  | 'my-orders'
  | 'search'
  | 'notifications'
  | 'wallet'
  | 'deep_link_fallback';

function pushDestinationRoute(data: PushNotificationData): PushDestination {
  if (data.type === 'support_deadline' || hasSupportDeadlineNotice(data)) return 'notifications';
  if (hasSupportOwnerUpdateNotice(data)) return 'notifications';
  switch (data.type) {
    case 'account_security':
    case 'eligibility_review':
      return 'notifications';
    case 'meetup_confirmed':
    case 'meetup_completed':
      if (typeof data.chatId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.chatId)) return 'chat';
      return typeof data.transactionId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.transactionId) ? 'my-orders' : 'notifications';
    case 'withdrawal_update':
      return 'wallet';
    case 'article_favorited':
    case 'price_drop':
    case 'article_moderation':
      return 'article';
    case 'swap_zone_reminder':
    case 'swap_update':
      return 'swap';
    case 'offer_received':
    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_counter':
    case 'offer':
    case 'chat':
    case 'message':
    case 'new_message':
      return 'chat';
    case 'new_sale':
    case 'order_paid':
    case 'dispute_resolved':
    case 'order_shipped':
    case 'order_delivered':
    case 'buyer_receipt_declared':
    case 'shipping_update':
    case 'order_cancelled':
    case 'order_refunded':
    case 'order_moderation':
    case 'funds_released':
      return 'my-orders';
    case 'review_received':
    case 'product_review_update':
    case 'privacy_incident':
    case 'shop_approved':
    case 'shop_rejected':
    case 'shop_created':
      return 'notifications';
    case 'saved_search':
      return 'search';
    default:
      return 'deep_link_fallback';
  }
}

// ─── Active chat tracking ───────────────────────────────────────────────────
// The chat screen sets this on focus/blur so the foreground notification
// handler can suppress the banner for the conversation the user is already
// looking at (a banner over the open thread is pure noise). Module-level ref
// because `setNotificationHandler` runs outside React.
let activeChatId: string | null = null;

/** Called by the chat screen on focus (uid) / blur (null). */
export function setActiveChatId(chatId: string | null): void {
  activeChatId = chatId;
}

/** A queued push belongs to its original owner even after this iPhone changes
 * accounts. Dev never adopts an unmarked legacy/production destination. */
function acceptsCurrentPush(data: PushNotificationData | undefined): data is PushNotificationData {
  if (!data) return false;
  const uid = useAuthStore.getState().authenticatedUid;
  const currentOwner = !!uid && auth.currentUser?.uid === uid;
  if (runtimeEnvironment.name === 'development') return canRegisterDevPushDestination() && currentOwner &&
    data.pushEnvironment === 'seconde_dev' && data.ownerId === uid;
  if (data.pushEnvironment === 'seconde_dev') return false;
  return data.ownerId === undefined || currentOwner && data.ownerId === uid;
}

// ─── Notification handler (configuré au niveau module, une seule fois) ──────
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as PushNotificationData | undefined;
    if (!acceptsCurrentPush(data)) return {shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false};
    // Already in the matching chat → no banner/sound, just keep the list/badge
    // in sync (the chat listener already shows the message in-thread).
    const inActiveChat = AppState.currentState === 'active' && isConversationNotification(data.type) &&
      data.chatId != null && data.chatId === activeChatId;

    return {
      shouldPlaySound: !inActiveChat,
      shouldSetBadge: !inActiveChat,
      shouldShowBanner: !inActiveChat,
      shouldShowList: true,
    };
  },
});

// ─── Android notification channels ─────────────────────────────────────────
async function setupAndroidChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Promise.all([
    // Canaux critiques (HIGH) : son par défaut pour que la notif soit
    // perçue (messages, offres, commandes). Les canaux DEFAULT restent muets.
    Notifications.setNotificationChannelAsync('messages', {
      name: 'Messages',
      description: 'Notifications de nouveaux messages',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      enableLights: true,
      enableVibrate: true,
    }),
    Notifications.setNotificationChannelAsync('offers', {
      name: 'Offres',
      description: 'Notifications d\'offres et propositions',
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: true,
    }),
    Notifications.setNotificationChannelAsync('notifications', {
      name: 'Notifications',
      description: 'Notifications générales (favoris, baisses de prix, etc.)',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    }),
    Notifications.setNotificationChannelAsync('swaps', {
      name: 'Le Troc',
      description: 'Rappels et mises à jour du Troc',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    }),
    // Le backend (functions/src/scheduled/savedSearches.ts) envoie sur le
    // channel 'saved_searches'. Sans channel correspondant, Android 8+ jette
    // silencieusement la notif → le tap (et le reset du compteur) ne se produit
    // jamais. Channel obligatoire pour que R1/M3 fonctionne.
    Notifications.setNotificationChannelAsync('saved_searches', {
      name: 'Recherches sauvegardées',
      description: 'Nouveaux articles correspondant à vos recherches',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    }),
    // Le backend (getAndroidChannel) route les notifs de commande sur 'orders'.
    Notifications.setNotificationChannelAsync('orders', {
      name: 'Commandes',
      description: 'Ventes, expéditions, livraisons et remboursements',
      importance: Notifications.AndroidImportance.HIGH,
      enableVibrate: true,
    }),
  ]);
}

// ─── Routing logic ─────────────────────────────────────────────────────────

let notificationNavigationChoice = {explicit: false, consumed: false};
/** Shared by centre taps and OS responses. Deferred initial reads retain an
 * initial token and can never acquire authority after a newer explicit choice. */
export function captureNotificationNavigationChoice(initial = false) {
  if (!initial) notificationNavigationChoice = {explicit: true, consumed: false};
  const choice = notificationNavigationChoice;
  const assertCurrent = () => {
    if (choice !== notificationNavigationChoice || choice.consumed || initial && choice.explicit) throw new Error('Un autre avis a été choisi.');
  };
  const commit = (action: () => void) => {assertCurrent(); choice.consumed = true; action();};
  return {assertCurrent, commit, navigate: (href: Href) => commit(() => notificationRouter.push(href))};
}
type NotificationNavigationChoice = ReturnType<typeof captureNotificationNavigationChoice>;

/**
 * Convertit le `deepLink` produit par le backend
 * (functions/src/utils/notifications.ts `buildDeepLink`, ex.
 * `https://seconde.ca/my-orders?transactionId=…`) en href interne consommable
 * par Expo Router. Renvoie `null` si l'URL ne contient pas de path exploitable.
 */
export function deepLinkToHref(deepLink: string | undefined): Href | null {
  if (!deepLink) return null;
  try {
    const parsed = Linking.parse(deepLink);
    if (!parsed.path) return null;
    const query = parsed.queryParams
      ? Object.entries(parsed.queryParams)
          .filter(([, v]) => v != null)
          .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map(value => `${encodeURIComponent(k)}=${encodeURIComponent(String(value))}`))
          .join('&')
      : '';
    return (`/${parsed.path}${query ? `?${query}` : ''}` as Href);
  } catch {
    return null;
  }
}

async function routeFromNotificationData(
  data: PushNotificationData,
  userId: string | null,
  choice: NotificationNavigationChoice,
  articleOwnerSession: TradeSession | null = null,
  assertActive?: () => void
): Promise<void> {
  const assertCurrent = () => {choice.assertCurrent(); assertActive?.(); if (articleOwnerSession) assertTradeSessionCurrent(articleOwnerSession);
    if (!acceptsCurrentPush(data)) throw new Error('Cet avis ne correspond plus à la session courante.');};
  try {assertCurrent();} catch {return;}
  // Every destination consumes this exact choice once, including fallbacks.
  const router = {push: (href: Href) => {try {assertCurrent(); choice.navigate(href);} catch { /* Superseded or already routed. */ }}};
  const type = data.type;

  if (type === 'support_deadline' || hasSupportDeadlineNotice(data)) {
    if (type !== 'support_deadline' || !articleOwnerSession || !assertActive) return;
    let active = AppState.currentState === 'active'; const subscription = AppState.addEventListener('change', state => {if (state !== 'active') active = false;});
    const current = () => {assertCurrent(); if (!active || AppState.currentState !== 'active') throw new Error('Relisez cet avis depuis une session active.');};
    try {const target = await supportDeadlineNotificationContext(data, articleOwnerSession.uid, current); current(); router.push({pathname: '/admin/support', params: {deadlineLane: target.lane}} as never);} catch {/* A stale/unknown deadline notice never falls back to a supplied link. */} finally {subscription.remove();}
    return;
  }
  if (hasSupportOwnerUpdateNotice(data)) {
    if (type !== 'order_moderation' || !articleOwnerSession || !assertActive) return;
    let active = AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', state => {if (state !== 'active') active = false;});
    const current = () => {assertCurrent(); if (!active || AppState.currentState !== 'active') throw new Error('Relisez cet avis de support dans une session active.');};
    try {current(); const target = await supportOwnerUpdateNotificationContext(data, articleOwnerSession.uid, current); current();
      router.push({pathname: '/settings/support/[id]', params: {id: target.supportRequestId}} as never);
    } catch {/* Unknown/malformed support discriminants never use order or deep-link fallbacks. */} finally {subscription.remove();}
    return;
  }
  if(hasBankDisputeCaseNotice(data)){
    if(type!=='order_moderation'||!articleOwnerSession||!assertActive)return;
    let active=AppState.currentState==='active';const subscription=AppState.addEventListener('change',state=>{if(state!=='active')active=false;});
    const current=()=>{assertCurrent();if(!active||AppState.currentState!=='active')throw new Error('Relisez cet avis bancaire depuis une session active.');};
    try{current();const selected=await bankDisputeCaseNotificationContext(data,articleOwnerSession.uid,current);current();router.push({pathname:'/orders/[id]',params:{id:selected.transactionId,bankCaseNotice:JSON.stringify(selected)}} as never);}
    catch{/* Any present but invalid bank reference has no generic fallback. */}finally{subscription.remove();}
    return;
  }
  switch (type) {
    case 'account_security': {
      if (!articleOwnerSession || !assertActive) return;
      let active = AppState.currentState === 'active'; const subscription = AppState.addEventListener('change', state => {if (state !== 'active') active = false;});
      const current = () => {assertCurrent(); if (!active || AppState.currentState !== 'active') throw new Error('Relisez cet avis depuis une session active.');};
      try {const target = await accountControlNotificationContext(data, articleOwnerSession.uid, current); current();
        router.push(target.reference ? {pathname: '/settings/account-control', params: {accountControlNotice: JSON.stringify(target.reference)}} as never : '/settings/account-control' as never);
      } catch {/* No arbitrary deep link or another account's support ticket substitutes for this own reference. */} finally {subscription.remove();}
      return;
    }
    case 'eligibility_review': {
      if (!articleOwnerSession || !assertActive) return;
      let active = AppState.currentState === 'active'; const sub = AppState.addEventListener('change', state => {if (state !== 'active') active = false;});
      const current = () => {assertCurrent(); if (!active || AppState.currentState !== 'active') throw new Error('Relisez cet avis depuis une session active.');};
      try {const target = await sellerActivityReviewNotificationContext(data, articleOwnerSession.uid, current); current(); router.push({pathname: '/settings/eligibility', params: {reviewId: target.reviewId}} as never);}
      catch {/* No generic deep link fallback substitutes for this exact owner review. */} finally {sub.remove();}
      return;
    }
    case 'moderation_update': {
      if(!articleOwnerSession||!assertActive)return;
      let active=AppState.currentState==='active';const sub=AppState.addEventListener('change',state=>{if(state!=='active')active=false;});
      const current=()=>{assertCurrent();if(!active||AppState.currentState!=='active')throw new Error('Relisez cet avis depuis une session active.');};
      try{current();const selection=await contentSafetyNotificationContext(data,articleOwnerSession.uid,current);current();
        if(selection)router.push({pathname:'/notifications',params:{contentSafetyNotice:JSON.stringify({ownerId:data.ownerId,contentSafetyCapability:data.contentSafetyCapability,contentTargetType:data.contentTargetType,contentTargetId:data.contentTargetId,contentCaseId:data.contentCaseId,contentEntryId:data.contentEntryId,contentEntryHash:data.contentEntryHash,contentEntryVersion:data.contentEntryVersion,reportId:data.reportId})}} as never);
      }catch{/* No generic link fallback for an unqualified content decision. */}finally{sub.remove();}
      return;
    }
    case 'shipping_update': {
      if (!articleOwnerSession || !assertActive || data.ownerId !== articleOwnerSession.uid) return;
      let active = AppState.currentState === 'active';
      const sub = AppState.addEventListener('change', state => {if (state !== 'active') active = false;});
      const current = () => {assertCurrent(); if (!active || AppState.currentState !== 'active') throw new Error('Relisez cet avis depuis une session active.');};
      try {current(); const context = await labelLifecycleNotificationContext(data, articleOwnerSession.uid, current); current();
        if (context) router.push({pathname: '/label-lifecycle', params: {transactionId: context.transactionId, leg: context.leg, ...(context.routeAmendmentNotice ? {routeEntryId: context.routeAmendmentNotice.entryId, routeContentHash: context.routeAmendmentNotice.contentHash, routeNotificationId: context.routeAmendmentNotice.notificationId} : {}), ...(context.parcelAmendmentCapability ? {parcelAmendmentCapability: context.parcelAmendmentCapability} : {})}} as never);
      } catch { /* No routing after SDK/activity loss, unqualified notice or arbitrary link. */ }
      finally {sub.remove();}
      return;
    }
    case 'product_review_update': {
      if (!articleOwnerSession) return;
      if (hasLateCommercialNotice(data)) {
        if (!assertActive) return;
        let active = AppState.currentState === 'active';
        const subscription = AppState.addEventListener('change', state => {if (state !== 'active') active = false;});
        const current = () => {assertCurrent(); if (!active || AppState.currentState !== 'active') throw new Error('Relisez cet avis depuis une session active.');};
        try {
          current(); const result = await lateCommercialNotificationContext(data, articleOwnerSession.uid, current); current();
          router.push({pathname: '/product-review', params: {contextKind: 'order', contextId: result.transactionId, lateCommercialNotice: JSON.stringify(result.noticeReference)}} as never);
        } catch { /* No ordinary product route or deep link substitutes for this exact notice. */ }
        finally {subscription.remove();}
        return;
      }
      try {const context = await productReviewNotificationContext(data, articleOwnerSession.uid, assertCurrent);
        assertCurrent();
        if (context) router.push({pathname: '/product-review', params: {contextKind: context.kind, contextId: context.id}} as never);
      } catch { /* A notice never grants private admission. */ }
      return;
    }
    case 'buyer_receipt_declared': {
      if (!articleOwnerSession || data.ownerId !== articleOwnerSession.uid ||
        typeof data.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.transactionId) ||
        !/^[a-f0-9]{64}$/.test(data.receiptDeclarationCommandId ?? '')) return;
      try {
        assertCurrent();
        const result = await ShippingReceiptDeclarationService.read(articleOwnerSession.uid, data.transactionId,
          assertCurrent);
        assertCurrent();
        if (result.current?.role !== 'seller' || result.current.declaration?.commandId !== data.receiptDeclarationCommandId) return;
        router.push({pathname: '/orders/[id]', params: {id: data.transactionId}});
      } catch { /* The notice grants no rights if its native declaration cannot be read. */ }
      return;
    }
    case 'article_moderation':
      if (articleOwnerSession && data.ownerId === articleOwnerSession.uid && typeof data.childPublicationCommandId === 'string' && /^cp_[a-f0-9]{64}$/.test(data.childPublicationCommandId) && typeof data.articleId === 'string' && isProductReviewContext({kind: 'article_listing', id: data.articleId})) {
        try {assertTradeSessionCurrent(articleOwnerSession); router.push({pathname: '/product-review', params: {contextKind: 'article_listing', contextId: data.articleId}} as never);} catch { /* This own notice grants no publication or private access. */ }
        return;
      }
      // The notice only opens an owner dossier. Its payload never grants a
      // listing permission, and a previous SDK session cannot route this one.
      if (!articleOwnerSession || data.ownerId !== articleOwnerSession.uid ||
        typeof data.articleId !== 'string' || !data.articleId.trim() || data.articleId.trim() !== data.articleId || data.articleId.includes('/') ||
        !/^[a-f0-9]{64}$/.test(data.decisionId ?? '') || data.favorableRecorded !== 'true' || !['true', 'false'].includes(data.listingReactivated ?? '')) return;
      try { assertTradeSessionCurrent(articleOwnerSession); } catch { return; }
      router.push({pathname: '/article/moderation/[id]', params: {id: data.articleId}});
      return;
    case 'meetup_confirmed':
    case 'meetup_completed':
      if (data.ownerId !== undefined && (!userId || data.ownerId !== userId || auth.currentUser?.uid !== userId)) return;
      if (typeof data.chatId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.chatId)) {
        router.push({ pathname: '/chat/[id]', params: { id: data.chatId } });
      } else if (typeof data.transactionId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(data.transactionId)) {
        router.push({ pathname: '/orders/[id]', params: { id: data.transactionId } });
      } else router.push('/notifications');
      return;
    case 'withdrawal_update':
      // Un avis n'autorise aucune mutation. Un ancien push du compte A ne
      // doit pas être présenté comme un dossier du compte B sur cet appareil.
      if (userId && data.ownerId === userId && auth.currentUser?.uid === userId) {
        router.push('/wallet');
      }
      return;
    case 'order_moderation':
      if (hasAccountRelationshipNotice(data)) {
        if (!articleOwnerSession || !assertActive || data.ownerId !== articleOwnerSession.uid) return;
        let active = AppState.currentState === 'active'; const subscription = AppState.addEventListener('change', state => {if (state !== 'active') active = false;});
        const current = () => {assertCurrent(); if (!active || AppState.currentState !== 'active') throw new Error('Relisez cet avis depuis une session active.');};
        try {current(); const selected = await accountRelationshipNotificationContext(data, articleOwnerSession.uid, current); current();
          router.push({pathname: '/settings/support/[id]', params: {id: selected.supportRequestId, accountRelationship: JSON.stringify(selected.reference)}} as never);
        } catch { /* This native reference has no generic-route fallback. */ } finally {subscription.remove();}
        return;
      }
      if (data.ownerId !== undefined && (!userId || data.ownerId !== userId || auth.currentUser?.uid !== userId)) return;
      if (typeof data.transactionId === 'string' && data.transactionId && !data.transactionId.includes('/')) {
        router.push({ pathname: '/orders/[id]', params: { id: data.transactionId } });
      } else router.push('/notifications');
      return;
    case 'order_paid':
    case 'dispute_resolved':
      if (typeof data.transactionId === 'string' && data.transactionId && !data.transactionId.includes('/')) {
        router.push({ pathname: '/orders/[id]', params: { id: data.transactionId } });
      } else router.push('/notifications');
      return;
    case 'article_favorited':
    case 'price_drop':
      if (data.articleId) {
        router.push(`/article/${data.articleId}`);
      }
      return;

    case 'swap_zone_reminder':
      if (data.partyId) {
        router.push(`/swap-party/${data.partyId}`);
      }
      return;

    case 'swap_update':
      if (data.swapId) {
        router.push(`/swap/${data.swapId}`);
      }
      return;

    case 'offer_received':
    case 'offer_accepted':
    case 'offer_rejected':
    case 'offer_counter':
    case 'offer':
    case 'chat':
    case 'message':
    case 'new_message':
      if (data.chatId) {
        router.push(`/chat/${data.chatId}`);
      }
      return;

    case 'new_sale':
    case 'order_shipped':
    case 'order_delivered':
    case 'order_cancelled':
    case 'order_refunded':
    case 'funds_released':
      // Backend route les ventes/commandes vers /my-orders?transactionId=…
      // (app/my-orders.tsx consomme `transactionId` via useLocalSearchParams).
      router.push(
        data.transactionId
          ? { pathname: '/my-orders', params: { transactionId: data.transactionId } }
          : '/my-orders'
      );
      return;

    case 'review_received':
    case 'privacy_incident':
      // In-app only, route to notifications center (cf. buildDeepLink).
      router.push('/notifications');
      return;

    case 'saved_search':
      if (data.savedSearchId && userId) {
        try {
          const savedSearch = await SavedSearchService.getSavedSearchById(
            userId,
            data.savedSearchId
          );
          assertCurrent();
          if (savedSearch) {
            router.push({
              pathname: '/search',
              params: {
                query: savedSearch.query || '',
                filters: JSON.stringify(savedSearch.filters || {}),
              },
            });
            // A read-counter write must never veto the selected search.
            void SavedSearchService.resetNewItemsCount(userId, data.savedSearchId).catch(error => {
              if (__DEV__) console.warn('Saved search opened; counter refresh unavailable:', error);
            });
          }
        } catch (error) {
          if (__DEV__) console.error('Error handling saved search notification:', error);
          router.push('/search');
        }
      }
      return;

    case 'shop_approved':
    case 'shop_rejected':
    case 'shop_created':
      // In-app only, route to notifications center
      router.push('/notifications');
      return;

    case undefined:
      break;

    default: {
      // Type connu côté serveur mais non géré ici → erreur de compilation si la
      // chaîne diverge du producteur. Le runtime retombe sur le deepLink/data.
      const _exhaustive: never = type;
      void _exhaustive;
      break;
    }
  }

  // Fallback : consomme le deepLink construit par le backend (source unique),
  // puis les ids bruts si aucun deepLink exploitable n'est présent.
  const href = deepLinkToHref(data.deepLink);
  if (href) {
    router.push(href);
    return;
  }
  if (data.chatId) {
    router.push(`/chat/${data.chatId}`);
  } else if (data.articleId) {
    router.push(`/article/${data.articleId}`);
  } else if (data.transactionId) {
    router.push({ pathname: '/my-orders', params: { transactionId: data.transactionId } });
  } else if (data.partyId) {
    router.push(`/swap-party/${data.partyId}`);
  } else if (data.swapId) {
    router.push(`/swap/${data.swapId}`);
  }
}

// ─── Handle initial notification (app killed → tap notification) ────────────

async function handleInitialNotification(userId: string | null, articleOwnerSession: TradeSession | null, choice: NotificationNavigationChoice, assertActive?: () => void): Promise<void> {
  const lastResponse = await Notifications.getLastNotificationResponseAsync();
  try {choice.assertCurrent(); assertActive?.();} catch {return;}
  if (!lastResponse) return;

  const data = lastResponse.notification.request.content.data as PushNotificationData;
  if (acceptsCurrentPush(data)) {
    if (data.type) {
      track('push_opened', {
        notification_type: data.type,
        from_killed_state: true,
        destination_route: pushDestinationRoute(data),
      });
    }
    InteractionManager.runAfterInteractions(() => {
      void routeFromNotificationData(data, userId, choice, articleOwnerSession, assertActive);
    });
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Hook principal pour le setup complet des notifications push.
 * Gère : channels Android, listeners, notification initiale (app killed),
 * enregistrement du token Expo iOS / FCM Android, badge count.
 *
 * Doit être appelé UNE SEULE FOIS dans le root layout.
 */
export function useNotificationSetup(userId: string | null): void {
  const sdk = useAuthStore(useShallow(state => ({uid: state.authenticatedUid, generation: getAuthSessionGeneration()})));
  // This hook is mounted at the root of the nav tree (RootLayoutNav). Reading
  // the whole store via `useNotificationStore()` would subscribe the root to
  // every snapshot change — each `incrementUnreadCount()` on an incoming push
  // (flat `set({...})`) re-renders the whole tree. Actions are stable refs in
  // Zustand 5, so we call them through `getState()` instead of subscribing.
  // This also keeps them out of the setup effect deps below, so the 4 OS
  // listeners are no longer torn down + recreated on every notification.
  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // ── Refresh badge count ──
  const refreshBadgeCount = useCallback(async () => {
    const uid = userIdRef.current;
    if (uid) await refreshNotificationBadge(uid);
  }, []);

  // ── Main setup effect ──
  useEffect(() => {
    const initialChoice = captureNotificationNavigationChoice(true);
    if (!userId) {
      // Keep only the existing owner notice tap available without a normal
      // profile. No token registration, badge work or commercial routes here.
      useNotificationStore.getState().reset();
      if (!sdk.uid) return;
      let articleOwnerSession: TradeSession;
      try {articleOwnerSession = captureTradeSession(sdk.uid);} catch {return;}
      let active = true;
      const routeOwnerNotice = (data: PushNotificationData | undefined, choice: NotificationNavigationChoice) => {
        if (active && (data?.type === 'support_deadline' || data?.type === 'article_moderation' || data?.type === 'buyer_receipt_declared' || data?.type === 'product_review_update' || data?.type === 'shipping_update' || data?.type === 'order_moderation' && (hasSupportOwnerUpdateNotice(data)||hasAccountRelationshipNotice(data)||hasBankDisputeCaseNotice(data)))) void routeFromNotificationData(data, null, choice, articleOwnerSession, () => {if (!active) throw new Error('La session a changé.');});
      };
      const subscription = Notifications.addNotificationResponseReceivedListener(response => {
        const choice = captureNotificationNavigationChoice();
        routeOwnerNotice(response.notification.request?.content?.data as PushNotificationData | undefined, choice);
      });
      void Notifications.getLastNotificationResponseAsync().then(response => {
        if (!active || !response) return;
        try {initialChoice.assertCurrent();} catch {return;}
        const data = response.notification.request.content.data as PushNotificationData | undefined;
        InteractionManager.runAfterInteractions(() => routeOwnerNotice(data, initialChoice));
      }).catch(error => {if (__DEV__) console.warn('Owner moderation notification remains available from its dossier:', error);});
      return () => {active = false; subscription.remove();};
    }

    let isActive = true;
    let articleOwnerSession: TradeSession | null = null;
    try {articleOwnerSession = captureTradeSession(userId);} catch { /* This notice needs a qualified SDK session. */ }
    // Registration belongs to this signed-in session, not to whichever user
    // happens to be current when an asynchronous token request finishes.
    let latestNativeToken: Notifications.DevicePushToken | null = null;
    let registeredNativeToken: string | null = null;
    let savedPushToken: string | null = null;
    let obsoletePushToken: string | null = null;
    let registration: Promise<void> | null = null;
    let devBinding: DevPushBinding | null = null;
    const registrationOwner = auth.currentUser;
    const isDevRuntime = runtimeEnvironment.name === 'development';
    const assertRegistrationCurrent = () => {
      if (!isActive || !registrationOwner || auth.currentUser !== registrationOwner || registrationOwner.uid !== userId ||
          useAuthStore.getState().authenticatedUid !== userId || sdk.generation !== getAuthSessionGeneration()) throw new Error('La session des notifications a changé.');
    };
    useNotificationStore.getState().setPushToken(null);

    const registerPushToken = (nativeToken?: Notifications.DevicePushToken): Promise<void> => {
      if (!isActive) return Promise.resolve();
      if (isDevRuntime && !canRegisterDevPushDestination()) return Promise.resolve();
      if (nativeToken) {
        if (typeof nativeToken.data !== 'string' || !nativeToken.data) return Promise.resolve();
        latestNativeToken = nativeToken;
      }
      if (registration) return registration;
      if (latestNativeToken?.data === registeredNativeToken && !obsoletePushToken) {
        return Promise.resolve();
      }

      // Deferring starts the single-flight guard before any SDK callback can
      // echo the bootstrap token. A rotation during a request replaces the
      // pending native token and is processed after the current request.
      registration = Promise.resolve().then(async () => {
        try {
          const existing = await Notifications.getPermissionsAsync();
          if (!isActive) return;
          let status = existing.status;
          if (status !== 'granted' && existing.canAskAgain) {
            status = (await Notifications.requestPermissionsAsync()).status;
          }
          if (!isActive) return;
          if (status !== 'granted') {
            track('push_token_registered', {
              permission_status: status,
              is_fcm_token: false,
              platform: Platform.OS as 'ios' | 'android',
            });
            return;
          }

          const isExpoToken = Platform.OS === 'ios';
          const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
          if (isExpoToken && !projectId) {
            if (__DEV__) console.warn('[push] EAS projectId absent');
            return;
          }
          if (!latestNativeToken) {
            const initialToken = await Notifications.getDevicePushTokenAsync();
            if (!isActive) return;
            // The SDK can emit a newer token before resolving the request.
            latestNativeToken ??= initialToken;
          }

          while (isActive && latestNativeToken && latestNativeToken.data !== registeredNativeToken) {
            const token = latestNativeToken;
            if (typeof token.data !== 'string' || !token.data) return;
            try {
              // Supplying APNs is essential: without it Expo calls native
              // registration again, which emits onDevicePushToken in a loop.
              const pushToken = isExpoToken
                ? await Notifications.getExpoPushTokenAsync({ projectId, devicePushToken: token })
                : token;
              if (!isActive) return;
              const tokenValue = pushToken.data;
              if (typeof tokenValue !== 'string' || !tokenValue) return;
              if (savedPushToken !== tokenValue) {
                assertRegistrationCurrent();
                if (isDevRuntime) {
                  if (!devBinding || devBinding.expoPushToken !== tokenValue) devBinding = await prepareDevPushBinding(userId, tokenValue, assertRegistrationCurrent);
                  assertRegistrationCurrent();
                  await registerDevPushDestination(devBinding, assertRegistrationCurrent);
                } else if (isExpoToken) await UserService.saveExpoPushToken(userId, tokenValue);
                else await UserService.saveFcmToken(userId, tokenValue);
                if (!isActive) return;
                obsoletePushToken = savedPushToken;
                savedPushToken = tokenValue;
                useNotificationStore.getState().setPushToken(tokenValue);
                track('push_token_registered', {
                  permission_status: status,
                  is_fcm_token: !isExpoToken,
                  platform: Platform.OS as 'ios' | 'android',
                });
                if (__DEV__) console.log('Push token registered');
              }
              if (obsoletePushToken) {
                // Dev registration atomically retires its previous private
                // destination; legacy user-document tokens are never touched.
                if (isDevRuntime) {obsoletePushToken = null;}
                else if (isExpoToken) await UserService.removeExpoPushToken(userId, obsoletePushToken);
                else await UserService.removeFcmToken(userId, obsoletePushToken);
                if (!isActive) return;
                obsoletePushToken = null;
              }
              registeredNativeToken = token.data;
            } catch (error) {
              if (__DEV__) console.warn('[push] token registration failed:', error);
              // A failed token can retry on a later event/foreground, never
              // immediately on its own echo. Still process a newer rotation.
              if (latestNativeToken.data === token.data) return;
            }
          }
        } catch (error) {
          if (__DEV__) console.warn('[push] token registration failed:', error);
        }
      }).finally(() => {
        registration = null;
      });
      return registration;
    };

    const setup = async () => {
      // 1. Setup Android channels
      await setupAndroidChannels();

      if (!isActive) return;

      // Opening a tapped notification does not wait for Expo registration or
      // the badge count. Those network requests cannot authorize navigation.
      await handleInitialNotification(userId, articleOwnerSession, initialChoice, () => {if (!isActive) throw new Error('La session a changé.');});

      if (!isActive) return;

      await Promise.allSettled([registerPushToken(), refreshBadgeCount()]);

      if (!isActive) return;

      useNotificationStore.getState().setSetupComplete(true);
    };

    setup();

    // 5. Listener: notification received (foreground)
    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request?.content?.data as PushNotificationData | undefined;
      if (!isActive || !acceptsCurrentPush(data)) return;
      if (data?.type) {
        track('push_received', {
          notification_type: data.type,
          suppressed_in_active_chat: data.chatId != null && data.chatId === activeChatId,
        });
      }
      // Feedback immédiat : incrémente le compteur in-app, puis réconcilie avec
      // le compteur serveur (qui réaligne aussi le badge OS).
      if (!(isConversationNotification(data?.type) && data.chatId === activeChatId)) useNotificationStore.getState().incrementUnreadCount();
      refreshBadgeCount();
    });

    // 6. Listener: notification tapped
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request?.content?.data as
        | PushNotificationData
        | undefined;
      if (isActive && acceptsCurrentPush(data)) {
        const choice = captureNotificationNavigationChoice();
        if (data.type) {
          track('push_opened', {
            notification_type: data.type,
            from_killed_state: false,
            destination_route: pushDestinationRoute(data),
          });
        }
        if ((data.type === 'article_moderation' || data.type === 'buyer_receipt_declared' || data.type === 'product_review_update' || data.type === 'shipping_update') && !isActive) return;
        void routeFromNotificationData(data, userIdRef.current, choice, articleOwnerSession, () => {if (!isActive) throw new Error('La session a changé.');});
      }
    });

    // 7. Native APNs/FCM rotation: consume the supplied token directly.
    const tokenSub = Notifications.addPushTokenListener((nativeToken) => {
      void registerPushToken(nativeToken);
    });

    // 8. Listener: app foregrounded → re-sync badge (notifications may have
    // arrived while backgrounded, or been read on another device).
    const appStateRef = { current: AppState.currentState as AppStateStatus };
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        refreshBadgeCount();
        // Retry a failed registration (or newly granted OS permission). A
        // successfully registered, unchanged token returns without a request.
        void registerPushToken();
      }
      appStateRef.current = nextState;
    });

    return () => {
      isActive = false;
      receivedSub.remove();
      responseSub.remove();
      tokenSub.remove();
      appStateSub.remove();
    };
    // Only account changes restart the session; store snapshots and incoming
    // notifications do not recreate the four OS listeners.
  }, [userId, sdk.uid, sdk.generation, refreshBadgeCount]);

  // ── Expose unregister for logout (via store or callback) ──
  // authStore removes the registered token from its matching transport on logout.
}

// ─── Exported helpers ───────────────────────────────────────────────────────

/**
 * Refresh the unread count from Firestore and align the OS badge on it.
 * Used by the notifications screen after read/delete/mark-all so the in-app
 * count AND the home-screen badge stay in sync with the server.
 */
export async function refreshNotificationBadge(userId: string): Promise<void> {
  await synchronizeNotificationBadge(userId, undefined, () => NotificationService.countUnreadNotifications(userId));
}
