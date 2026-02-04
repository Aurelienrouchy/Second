---
title: 'Complete Notification System'
slug: 'complete-notification-system'
created: '2026-01-20'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - React Native / Expo
  - Firebase Cloud Messaging (FCM)
  - Firebase Cloud Functions (triggers)
  - Firestore
  - expo-notifications
  - '@react-native-firebase/messaging'
  - firebase-admin (Cloud Functions)
files_to_modify:
  - types/index.ts
  - services/userService.ts
  - services/notificationService.ts
  - contexts/NotificationContext.tsx
  - contexts/AuthContext.tsx
  - functions/src/index.ts
  - app/(tabs)/_layout.tsx
  - app/settings/preferences.tsx
files_to_create:
  - app/notifications.tsx
  - components/NotificationBellIcon.tsx
  - hooks/useFcmToken.ts
code_patterns:
  - 'Static class services (NotificationService, UserService, FavoritesService)'
  - 'React Context + hooks for state (AuthContext, NotificationContext)'
  - 'Firestore triggers in Cloud Functions (onCreate, onUpdate)'
  - 'FCM pattern: get fcmTokens[], build messages[], admin.messaging().sendEach()'
  - 'expo-router navigation (router.push)'
  - 'Bottom sheet modals (@gorhom/bottom-sheet)'
test_patterns: []
---

# Tech-Spec: Complete Notification System

**Created:** 2026-01-20

## Overview

### Problem Statement

Les utilisateurs n'ont aucun moyen de recevoir des mises à jour en temps réel sur l'activité de leurs articles ou des articles qui les intéressent, ce qui entraîne des opportunités manquées et un faible engagement.

### Solution

Implémenter un système de notifications complet avec :
- **Push notifications FCM** pour les utilisateurs hors de l'app
- **Notifications in-app** (toast + badge) pour les utilisateurs actifs
- **Centre de notifications** (écran dédié avec historique)
- **Préférences utilisateur** pour contrôler chaque type de notification
- **Deep linking** pour rediriger vers l'écran pertinent au tap

### Scope

**In Scope:**
- 5 types de notifications :
  1. Article ajouté en favori (notify vendeur)
  2. Baisse de prix sur article favori (notify acheteurs)
  3. Rappel Swap Zone 3 jours avant (notify inscrits)
  4. Proposition d'achat reçue (notify vendeur)
  5. Réponse à proposition (notify acheteur)
- Setup FCM complet (tokens, permissions, envoi)
- UI in-app (bell icon avec badge + écran notifications)
- Préférences utilisateur (toggles par type)
- Cloud Functions triggers
- Deep linking sur tap notification

**Out of Scope:**
- Notifications email
- Notifications SMS
- Notifications admin
- Analytics des notifications
- Notifications pour les messages chat (déjà existant)

## Context for Development

### Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| FCM Token Storage | `fcmTokens: string[]` sur User document | Simple, multi-device natif, pas besoin d'une collection séparée |
| Existing Triggers | Retrofit + nouveaux | Cohérence avec l'existant, évite la duplication |
| Price Drop Detection | Firestore trigger `onUpdate` | Capture le "before" automatiquement, pas de pollution du schéma Article |
| Swap Zone Registration | Utiliser `swapPartyParticipants` | Structure déjà en place |
| In-App UI | Bell icon + écran dédié | Standard UX (comme Vinted), badge + liste complète |

### Codebase Patterns

**Service Pattern:**
```typescript
// Static class avec méthodes async
export class NotificationService {
  private static readonly COLLECTION = 'notifications';
  static async createNotification(...) { ... }
}
```

**Context Pattern:**
```typescript
// Context + Provider + hook
const NotificationContext = createContext<NotificationContextType | undefined>(undefined);
export const NotificationProvider: React.FC<{ children }> = ({ children }) => { ... };
export const useNotifications = () => useContext(NotificationContext);
```

**Cloud Function Trigger Pattern:**
```typescript
// Firestore trigger avec FCM
export const sendMessageNotification = functions.firestore
  .document('messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const fcmTokens = userData.fcmTokens || [];
    const messages = fcmTokens.map(token => ({ token, notification: {...}, data: {...} }));
    await admin.messaging().sendEach(messages);
  });
```

### Files to Reference

| File | Purpose | Key Functions/Patterns |
| ---- | ------- | --------------------- |
| `services/notificationService.ts` | In-app notifications CRUD | `createNotification`, `getUserNotifications`, `markAsRead` |
| `contexts/NotificationContext.tsx` | Notification state + listeners | `expo-notifications` listeners, `handleNotificationTap` routing |
| `services/userService.ts` | User operations | `getUserById`, `updateUserPreferences` - **needs FCM methods** |
| `services/favoritesService.ts` | Favorites CRUD | `addToFavorites`, `getFavoriteCount` |
| `services/swapService.ts` | Swap Zone participation | `joinSwapParty`, `isParticipant`, `getPartyParticipants` |
| `functions/src/index.ts:845-1099` | Existing FCM triggers | `sendMessageNotification`, `sendOfferStatusNotification` |
| `types/index.ts:356-382` | Notification types | `NotificationType`, `Notification`, `SwapNotificationType` |
| `contexts/AuthContext.tsx` | Auth state | Login/logout hooks - **add FCM token registration** |
| `app/_layout.tsx` | App providers | `NotificationProvider` already wrapped |
| `app/(tabs)/_layout.tsx` | Tab navigation | Add bell icon to header |

### Files to Create

| File | Purpose |
| ---- | ------- |
| `app/notifications.tsx` | Notification list screen with routing on tap |
| `components/NotificationBellIcon.tsx` | Bell icon with unread badge |
| `hooks/useFcmToken.ts` | Hook for FCM token registration/refresh |

### Files to Modify

| File | Changes |
| ---- | ------- |
| `types/index.ts` | Add `fcmTokens: string[]` to User, add new NotificationTypes |
| `services/userService.ts` | Add `saveFcmToken()`, `removeFcmToken()`, `updateNotificationPreferences()` |
| `services/notificationService.ts` | Add `notifyArticleFavorited()`, `notifyPriceDrop()`, etc. |
| `contexts/NotificationContext.tsx` | Integrate FCM token registration, handle all notification types |
| `contexts/AuthContext.tsx` | Call FCM token registration on login, cleanup on logout |
| `functions/src/index.ts` | Add 4 new triggers: favorites, price drop, swap reminder, offers |
| `app/(tabs)/_layout.tsx` | Add bell icon in header |
| `app/settings/preferences.tsx` | Add notification preference toggles

## Implementation Plan

### Tasks

#### Phase 1: Foundation (Types & Services)

- [ ] **Task 1: Update User type with FCM tokens**
  - File: `types/index.ts`
  - Action: Add `fcmTokens?: string[]` to `User` interface (line ~56)
  - Action: Add new notification types to `NotificationType`: `'article_favorited'`, `'price_drop'`, `'swap_zone_reminder'`
  - Action: Update `UserPreferences.notifications` to include all 5 notification toggles
  - Notes: Keep backward compatible (optional fields)

- [ ] **Task 2: Add FCM token management to UserService**
  - File: `services/userService.ts`
  - Action: Add `saveFcmToken(userId: string, token: string): Promise<void>` using `arrayUnion`
  - Action: Add `removeFcmToken(userId: string, token: string): Promise<void>` using `arrayRemove`
  - Action: Add `updateNotificationPreferences(userId: string, prefs: NotificationPreferences): Promise<void>`
  - Notes: Follow existing pattern with `updateDoc` and `serverTimestamp()`

- [ ] **Task 3: Extend NotificationService for new notification types**
  - File: `services/notificationService.ts`
  - Action: Add `notifyArticleFavorited(sellerId, articleId, articleTitle, buyerName): Promise<string>`
  - Action: Add `notifyPriceDrop(userIds[], articleId, articleTitle, oldPrice, newPrice): Promise<void>`
  - Action: Add `notifySwapZoneReminder(userIds[], partyId, partyName, daysUntil): Promise<void>`
  - Action: Add `notifyOfferReceived(sellerId, articleId, articleTitle, amount, buyerName): Promise<string>`
  - Action: Add `notifyOfferResponse(buyerId, articleId, articleTitle, status, sellerName): Promise<string>`
  - Notes: All methods create in-app notification via existing `createNotification` (make it public)

#### Phase 2: FCM Token Registration (Client)

- [ ] **Task 4: Create useFcmToken hook**
  - File: `hooks/useFcmToken.ts` (NEW)
  - Action: Create hook that:
    1. Requests notification permissions via `expo-notifications`
    2. Gets FCM token via `@react-native-firebase/messaging`
    3. Listens for token refresh
    4. Saves token to Firestore via `UserService.saveFcmToken()`
  - Notes: Handle both iOS and Android permission flows

- [ ] **Task 5: Integrate FCM token in AuthContext**
  - File: `contexts/AuthContext.tsx`
  - Action: On successful login, call FCM token registration
  - Action: On logout, remove current device's FCM token
  - Action: Add `registerForPushNotifications()` method to context
  - Notes: Don't block login on FCM registration - do it async

- [ ] **Task 6: Update NotificationContext for deep linking**
  - File: `contexts/NotificationContext.tsx`
  - Action: Extend `NotificationData` interface with new types
  - Action: Update `handleNotificationTap` to route:
    - `article_favorited` → `/article/[articleId]`
    - `price_drop` → `/article/[articleId]`
    - `swap_zone_reminder` → `/swap-party/[partyId]`
    - `offer_received` → `/chat/[chatId]`
    - `offer_response` → `/chat/[chatId]`
  - Notes: Follow existing pattern for chat routing

#### Phase 3: Cloud Functions (Push Notifications)

- [ ] **Task 7: Add onArticleFavorited trigger**
  - File: `functions/src/index.ts`
  - Action: Create `onArticleFavorited` Firestore trigger on `favorites/{userId}` onUpdate
  - Logic:
    1. Detect new articleId added to `articleIds` array
    2. Get article's sellerId
    3. Get seller's fcmTokens
    4. Send push notification "❤️ {userName} a ajouté votre article en favori"
    5. Create in-app notification in `notifications` collection
  - Notes: Check seller's notification preferences before sending

- [ ] **Task 8: Add onArticlePriceDropped trigger**
  - File: `functions/src/index.ts`
  - Action: Create `onArticlePriceDropped` Firestore trigger on `articles/{articleId}` onUpdate
  - Logic:
    1. Compare `before.price` vs `after.price`
    2. If price decreased, query all favorites containing this articleId
    3. Get each user's fcmTokens
    4. Send push notification "💰 Baisse de prix sur {articleTitle}!"
    5. Create in-app notifications
  - Notes: Batch notifications efficiently, respect user preferences

- [ ] **Task 9: Add Swap Zone reminder scheduled function**
  - File: `functions/src/index.ts`
  - Action: Create `sendSwapZoneReminders` scheduled function (runs daily at 10:00 AM)
  - Logic:
    1. Query `swapParties` where `startDate` is 3 days from now
    2. For each party, get all participants from `swapPartyParticipants`
    3. Send push notification "📦 La Swap Zone {partyName} commence dans 3 jours!"
    4. Create in-app notifications
  - Notes: Use `functions.pubsub.schedule('0 10 * * *')`

- [ ] **Task 10: Enhance offer notification triggers**
  - File: `functions/src/index.ts`
  - Action: Update `sendMessageNotification` to also create in-app notification for offers
  - Action: Update `sendOfferStatusNotification` to handle counter-offers
  - Notes: Existing triggers work, just need to add in-app notification creation

#### Phase 4: UI Components

- [ ] **Task 11: Create NotificationBellIcon component**
  - File: `components/NotificationBellIcon.tsx` (NEW)
  - Action: Create bell icon component with:
    - Bell icon (IconSymbol or custom)
    - Red badge with unread count
    - Tap navigates to `/notifications`
  - Props: `size`, `color`, `onPress`
  - Notes: Use `useNotifications().notificationCount` for badge

- [ ] **Task 12: Create Notifications screen**
  - File: `app/notifications.tsx` (NEW)
  - Action: Create notification list screen with:
    - FlatList of notifications
    - Each item shows: icon, title, message, time ago
    - Tap marks as read + navigates to relevant screen
    - Swipe to delete
    - "Mark all as read" header button
    - Empty state when no notifications
  - Notes: Use existing `NotificationService` methods

- [ ] **Task 13: Add bell icon to tab layout**
  - File: `app/(tabs)/_layout.tsx`
  - Action: Add `NotificationBellIcon` to header right of home tab
  - Notes: Could also add to Stack header in `app/_layout.tsx` for global access

- [ ] **Task 14: Register notifications screen in router**
  - File: `app/_layout.tsx`
  - Action: Add `<Stack.Screen name="notifications" />` to Stack navigator
  - Notes: Standard card presentation

#### Phase 5: User Preferences

- [ ] **Task 15: Add notification preferences UI**
  - File: `app/settings/preferences.tsx`
  - Action: Add "Notifications" section with toggles:
    - "Articles favorisés" (article_favorited)
    - "Baisses de prix" (price_drop)
    - "Rappels Swap Zone" (swap_zone_reminder)
    - "Propositions d'achat" (offer_received)
    - "Réponses aux offres" (offer_response)
    - Master toggle "Notifications push"
  - Action: Save preferences via `UserService.updateNotificationPreferences()`
  - Notes: Load current preferences on mount, debounce saves

### Acceptance Criteria

#### FCM Token Registration
- [ ] **AC1:** Given a logged-in user on iOS, when the app launches, then notification permission is requested and FCM token is saved to `users/{userId}.fcmTokens[]`
- [ ] **AC2:** Given a logged-in user on Android 13+, when the app launches, then POST_NOTIFICATIONS permission is requested and FCM token is saved
- [ ] **AC3:** Given a user who logs out, when logout completes, then the device's FCM token is removed from their user document
- [ ] **AC4:** Given a user with multiple devices, when they log in on a new device, then both device tokens exist in `fcmTokens[]`

#### Push Notifications - Article Favorited
- [ ] **AC5:** Given a seller with push enabled, when someone adds their article to favorites, then seller receives push notification within 5 seconds
- [ ] **AC6:** Given a seller with push disabled for favorites, when someone adds their article to favorites, then no push is sent but in-app notification is created
- [ ] **AC7:** Given a seller, when they tap the "article favorited" notification, then app opens to that article's detail page

#### Push Notifications - Price Drop
- [ ] **AC8:** Given a user with an article in favorites, when the seller lowers the price, then user receives push notification "💰 Baisse de prix!"
- [ ] **AC9:** Given 50 users with same article favorited, when price drops, then all 50 receive notifications (batched efficiently)
- [ ] **AC10:** Given a user, when they tap "price drop" notification, then app opens to that article's detail page

#### Push Notifications - Swap Zone Reminder
- [ ] **AC11:** Given a user registered for a swap party starting in 3 days, when the daily reminder job runs, then user receives push notification
- [ ] **AC12:** Given a user, when they tap "swap zone reminder" notification, then app opens to that swap party's page

#### Push Notifications - Offers
- [ ] **AC13:** Given a seller, when buyer sends purchase offer, then seller receives push notification with offer amount
- [ ] **AC14:** Given a buyer, when seller accepts/rejects offer, then buyer receives push notification with status
- [ ] **AC15:** Given a user, when they tap offer notification, then app opens to the chat conversation

#### In-App Notifications
- [ ] **AC16:** Given a logged-in user, when any notification event occurs while app is open, then badge count increases on bell icon
- [ ] **AC17:** Given a user with unread notifications, when they open notifications screen, then all notifications are listed newest first
- [ ] **AC18:** Given a user viewing notifications, when they tap a notification, then it's marked as read and they navigate to relevant screen
- [ ] **AC19:** Given a user viewing notifications, when they swipe left on a notification, then it's deleted
- [ ] **AC20:** Given a user viewing notifications, when they tap "Mark all as read", then all notifications are marked read and badge clears

#### User Preferences
- [ ] **AC21:** Given a user in settings, when they toggle off "Baisses de prix", then they stop receiving price drop push notifications
- [ ] **AC22:** Given a user in settings, when they toggle off master "Push notifications", then they receive no push notifications (but in-app still work)
- [ ] **AC23:** Given a user's preferences, when Cloud Function sends notification, then it respects user's preference settings

## Additional Context

### Dependencies

- `expo-notifications` (already installed)
- `@react-native-firebase/messaging` (already installed, v23.2.0)
- `firebase-admin` (for Cloud Functions FCM)

### Existing Infrastructure

- iOS: `UIBackgroundModes` with `remote-notification` configured
- Android: `POST_NOTIFICATIONS` and `VIBRATE` permissions configured
- Notification types already defined in `types/index.ts`

### Critical Gaps to Address

1. **No FCM token registration** - `User` type missing `fcmTokens: string[]` field, no registration on app launch
2. **No token persistence** - AuthContext doesn't register/cleanup FCM tokens on login/logout
3. **No notification preferences storage** - `UserPreferences.notifications` structure exists but unused
4. **Missing UserService methods** - Need `saveFcmToken()`, `removeFcmToken()`, `updateNotificationPreferences()`
5. **Incomplete deep linking** - `handleNotificationTap` only handles chat + saved_search, not new types
6. **No notification UI** - Missing notifications list screen and bell icon

### Existing Infrastructure (Ready to Use)

1. **FCM Pattern Exists** - `sendMessageNotification` (line 845-989) shows exact pattern to follow
2. **In-app Notification CRUD** - `NotificationService` already handles Firestore notifications collection
3. **expo-notifications Setup** - `NotificationContext` has listeners configured
4. **Notification Types Defined** - Most types already in `NotificationType` enum
5. **User Preferences Structure** - `UserPreferences.notifications` already defined in types

### Testing Strategy

#### Manual Testing

1. **FCM Token Registration**
   - Fresh install → check token appears in Firestore
   - Re-login → verify token persists
   - Logout → verify token removed
   - Multiple devices → verify multiple tokens stored

2. **Push Notifications**
   - Close app completely → trigger each notification type → verify push received
   - App in background → verify push appears
   - App in foreground → verify in-app toast/badge

3. **Deep Linking**
   - Tap each notification type → verify correct screen opens
   - Cold start from notification → verify correct screen after app loads

4. **Preferences**
   - Toggle off each type → verify notifications stop
   - Toggle master off → verify all push stops
   - Verify in-app notifications still work when push disabled

#### Integration Testing (Firebase Emulator)

```bash
# Run emulator suite
firebase emulators:start --only functions,firestore

# Test triggers manually:
# 1. Add article to favorites → check notification created
# 2. Update article price (lower) → check notifications sent
# 3. Run scheduled function manually → check reminder sent
```

#### Edge Cases to Test

- User with no FCM tokens (old account) → graceful handling
- Invalid FCM token → token cleanup
- Very long article titles → truncation in notification
- Rapid favoriting → no duplicate notifications
- Price increase (not decrease) → no notification sent

### Notes

#### Implementation Notes
- Le système de chat a déjà des fonctions `sendMessageNotification` et `sendOfferStatusNotification` qui fonctionnent avec FCM - répliquer ce pattern exact
- 18+ types de notifications sont déjà définis dans `types/index.ts` - réutiliser au maximum
- La structure `UserPreferences.notifications` existe mais n'est pas utilisée - l'activer

#### High-Risk Items
1. **iOS Push Permissions** - Users may deny, need graceful degradation
2. **Token Refresh** - FCM tokens expire, need refresh listener
3. **Batch Limits** - FCM has 500 messages/request limit, need batching for popular articles
4. **Firestore Reads** - Price drop on popular article could trigger many reads, consider caching

#### Future Considerations (Out of Scope)
- Notification analytics (open rates, engagement)
- Rich notifications with images
- Notification scheduling (quiet hours)
- Email fallback for important notifications
- Web push notifications for future web app

#### Performance Considerations
- Use Firestore batch writes for multiple notifications
- Consider Cloud Tasks for large-scale notifications
- Index `favorites` collection on `articleIds` for price drop queries
