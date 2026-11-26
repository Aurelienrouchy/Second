import {auth} from '@/config/firebaseConfig';
import {useAuthStore} from '@/store/authStore';
/**
 * useNotificationSetup — orchestration push (channels Android, token FCM,
 * routing au tap, badge) + handler foreground.
 *
 * Comportement MÉTIER couvert (le cœur de valeur du domaine notifications) :
 *
 *  ROUTING (routeFromNotificationData, via le listener "tap") :
 *   - article_favorited / price_drop → /article/:id
 *   - swap_zone_reminder → /swap-party/:id
 *   - offer_* / chat / message → /chat/:id
 *   - new_sale / order_* / funds_released → /my-orders?transactionId (ou /my-orders)
 *   - review_received / shop_* → /notifications (in-app only)
 *   - fallback : si type absent mais deepLink serveur présent → suit le deepLink
 *   - saved_search : reset du compteur "nouveaux items" + ouvre /search avec query+filtres
 *
 *  HANDLER FOREGROUND (setNotificationHandler) :
 *   - notif du chat ACTIF → pas de banner/son (bruit), mais on garde la liste/badge
 *   - notif d'un AUTRE chat → banner + son
 *
 *  TRANSPORT PUSH (via le flux de setup) :
 *   - token Android FCM (contient ':') → persisté
 *   - iOS → token Expo persisté séparément (APNs natif jamais envoyé via FCM)
 *
 *  CYCLE DE VIE :
 *   - réception foreground → incrément optimiste du badge
 *   - déconnexion (userId null) → reset du store
 *
 * .tsx pour le périmètre Jest. On remocke expo-notifications localement car le
 * mock global (jest.setup.js) ne couvre pas addPushTokenListener /
 * getLastNotificationResponseAsync / setBadgeCountAsync / getDevicePushTokenAsync,
 * et on a besoin de CAPTURER les listeners + le handler pour les déclencher.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

jest.mock('expo-application', () => ({applicationId: 'com.seconde.app'}));
jest.mock('@/config/firebaseEnvironment', () => ({...jest.requireActual('@/config/firebaseEnvironment'), runtimeEnvironment: {...jest.requireActual('@/config/firebaseEnvironment').runtimeEnvironment, name: 'production', projectId: 'seconde-b47a6', useEmulators: false}}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({authenticatedUid: 'u1'}))};
});

// --- Capture des listeners / handler enregistrés par le module --------------
type Listener = (arg: unknown) => void;
const captured: {
  handler?: (n: unknown) => Promise<unknown>;
  received?: Listener;
  response?: Listener;
  token?: Listener;
  appState?: (state: AppStateStatus) => void;
} = {};

const mockGetPermissions = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ status: 'granted', granted: true, canAskAgain: true }),
);
const mockRequestPermissions = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ status: 'granted', granted: true }),
);
const mockGetDevicePushToken = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ type: 'android', data: 'fcmtoken:APA91bXYZ' }),
);
const mockGetExpoPushToken = jest.fn((..._args: unknown[]) =>
  Promise.resolve({ type: 'expo', data: 'ExpoPushToken[ios-device]' }),
);
jest.mock('expo-constants', () => ({
  __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } },
}));
const mockSetChannel = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockSetBadge = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockGetLastResponse = jest.fn((..._args: unknown[]) => Promise.resolve(null));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: (cfg: { handleNotification: (n: unknown) => Promise<unknown> }) => {
    captured.handler = cfg.handleNotification;
  },
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
  getExpoPushTokenAsync: (...a: unknown[]) => mockGetExpoPushToken(...a),
  getDevicePushTokenAsync: (...a: unknown[]) => mockGetDevicePushToken(...a),
  setNotificationChannelAsync: (...a: unknown[]) => mockSetChannel(...a),
  setBadgeCountAsync: (...a: unknown[]) => mockSetBadge(...a),
  getLastNotificationResponseAsync: (...a: unknown[]) => mockGetLastResponse(...a),
  addNotificationReceivedListener: (cb: Listener) => {
    captured.received = cb;
    return { remove: jest.fn() };
  },
  addNotificationResponseReceivedListener: (cb: Listener) => {
    captured.response = cb;
    return { remove: jest.fn() };
  },
  addPushTokenListener: (cb: Listener) => {
    captured.token = cb;
    return { remove: jest.fn() };
  },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
}));

// expo-linking : parse réaliste d'une URL universelle (https://seconde.ca/...).
jest.mock('expo-linking', () => ({
  parse: (url: string) => {
    const m = /^https?:\/\/[^/]+\/([^?]*)(?:\?(.*))?$/.exec(url);
    if (!m) return { path: null, queryParams: {} };
    const path = m[1] || null;
    const queryParams: Record<string, string> = {};
    if (m[2]) {
      for (const pair of m[2].split('&')) {
        const [k, v] = pair.split('=');
        queryParams[k] = decodeURIComponent(v ?? '');
      }
    }
    return { path, queryParams };
  },
}));

// Router : on observe les pushs. `router` est un objet stable dont `push`
// délègue à un spy réinitialisé dans beforeEach (évite que clearMocks /
// le double mock global ne casse la référence destructurée à l'import).
const mockPush = jest.fn();
const mockRouter = { push: (...args: unknown[]) => mockPush(...args) };
jest.mock('expo-router', () => ({
  useRouter: () => require('expo-router').router,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),

  get router() {
    return mockRouter;
  },
}));

// Services : on les neutralise / pilote.
const mockCountUnread = jest.fn((..._args: unknown[]) => Promise.resolve(3));
jest.mock('@/features/notifications/services/notificationService', () => ({
  NotificationService: {
    countUnreadNotifications: (...a: unknown[]) => mockCountUnread(...a),
  },
}));

const mockSaveFcmToken = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockSaveExpoPushToken = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockRemoveExpoPushToken = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockRemoveFcmToken = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('@/services/userService', () => ({
  UserService: {
    saveExpoPushToken: (...a: unknown[]) => mockSaveExpoPushToken(...a),
    removeExpoPushToken: (...a: unknown[]) => mockRemoveExpoPushToken(...a),
    saveFcmToken: (...a: unknown[]) => mockSaveFcmToken(...a),
    removeFcmToken: (...a: unknown[]) => mockRemoveFcmToken(...a),
  },
}));

const mockGetSavedSearchById = jest.fn();
const mockResetNewItemsCount = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('@/services/savedSearchService', () => ({
  SavedSearchService: {
    getSavedSearchById: (...a: unknown[]) => mockGetSavedSearchById(...a),
    resetNewItemsCount: (...a: unknown[]) => mockResetNewItemsCount(...a),
  },
}));

// InteractionManager.runAfterInteractions : exécution synchrone en test.
jest.spyOn(
  require('react-native').InteractionManager,
  'runAfterInteractions',
).mockImplementation((cb: unknown) => {
  if (typeof cb === 'function') (cb as () => void)();
  return { then: jest.fn(), done: jest.fn(), cancel: jest.fn() };
});

import { useNotificationStore } from '@/store/notificationStore';

// Le module importé APRÈS les mocks (setNotificationHandler s'exécute à l'import).
import { useNotificationSetup } from '@/features/notifications/hooks/useNotificationSetup';

/** Monte le hook et laisse résoudre le setup async (channels/token/badge). */
function setNativeOwner(uid: string | null) { Object.defineProperty(auth, 'currentUser', {value: uid ? {uid} : null, writable: true, configurable: true}); useAuthStore.setState({authenticatedUid: uid}); }
async function mountSetup(userId: string | null = 'u1') {
  setNativeOwner(userId);
  const view = renderHook<void, { uid: string | null }>(
    ({ uid }) => useNotificationSetup(uid),
    { initialProps: { uid: userId } },
  );
  // Laisse les microtasks du setup() async se vider.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

/** Construit l'argument d'un listener de réponse (tap) depuis une data. */
function tap(data: Record<string, unknown>) {
  return { notification: { request: { content: { data } } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPermissions.mockResolvedValue({ status: 'granted', granted: true, canAskAgain: true });
  mockGetDevicePushToken.mockResolvedValue({ type: 'ios', data: 'apns-initial' });
  mockGetLastResponse.mockResolvedValue(null);
  mockGetExpoPushToken.mockResolvedValue({ type: 'expo', data: 'ExpoPushToken[ios-device]' });
  mockSaveExpoPushToken.mockResolvedValue(undefined);
  mockSaveFcmToken.mockResolvedValue(undefined);
  mockRemoveExpoPushToken.mockResolvedValue(undefined);
  mockRemoveFcmToken.mockResolvedValue(undefined);
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    captured.appState = callback;
    return { remove: jest.fn() };
  });
  require('react-native').Platform.OS = 'ios';
  act(() => useNotificationStore.getState().reset());
});

describe('routing au tap — par type de notification', () => {
  it('article_favorited / price_drop → ouvre la fiche article', async () => {
    await mountSetup();
    act(() => captured.response?.(tap({ type: 'price_drop', articleId: 'art9' })));
    expect(mockPush).toHaveBeenCalledWith('/article/art9');
  });

  it('swap_zone_reminder → ouvre la swap party', async () => {
    await mountSetup();
    act(() => captured.response?.(tap({ type: 'swap_zone_reminder', partyId: 'p1' })));
    expect(mockPush).toHaveBeenCalledWith('/swap-party/p1');
  });

  it('offre / message → ouvre la conversation', async () => {
    await mountSetup();
    act(() => captured.response?.(tap({ type: 'offer_received', chatId: 'c1' })));
    expect(mockPush).toHaveBeenCalledWith('/chat/c1');

    mockPush.mockClear();
    act(() => captured.response?.(tap({ type: 'new_message', chatId: 'c2' })));
    expect(mockPush).toHaveBeenCalledWith('/chat/c2');
  });

  it('cycle commande (new_sale / order_* / funds_released) → /my-orders?transactionId', async () => {
    await mountSetup();
    act(() => captured.response?.(tap({ type: 'order_shipped', transactionId: 'tx7' })));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/my-orders',
      params: { transactionId: 'tx7' },
    });

    mockPush.mockClear();
    // Sans transactionId : ouvre la liste des commandes sans param.
    act(() => captured.response?.(tap({ type: 'funds_released' })));
    expect(mockPush).toHaveBeenCalledWith('/my-orders');
  });

  it('review_received / shop_* → centre de notifications (in-app only)', async () => {
    await mountSetup();
    act(() => captured.response?.(tap({ type: 'review_received', reviewId: 'r1' })));
    expect(mockPush).toHaveBeenCalledWith('/notifications');

    mockPush.mockClear();
    act(() => captured.response?.(tap({ type: 'shop_approved' })));
    expect(mockPush).toHaveBeenCalledWith('/notifications');
  });

  it('fallback : type absent mais deepLink serveur présent → suit le deepLink', async () => {
    await mountSetup();
    act(() =>
      captured.response?.(
        tap({ deepLink: 'https://seconde.ca/my-orders?transactionId=tx42' }),
      ),
    );
    expect(mockPush).toHaveBeenCalledWith('/my-orders?transactionId=tx42');
  });

  it('saved_search → reset du compteur "nouveaux items" puis ouvre /search avec query+filtres', async () => {
    mockGetSavedSearchById.mockResolvedValueOnce({
      query: 'robe',
      filters: { brand: 'Zara' },
    });
    await mountSetup('user1');

    await act(async () => {
      await captured.response?.(
        tap({ type: 'saved_search', savedSearchId: 'ss1' }),
      );
    });

    expect(mockResetNewItemsCount).toHaveBeenCalledWith('user1', 'ss1');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/search',
      params: { query: 'robe', filters: JSON.stringify({ brand: 'Zara' }) },
    });
  });
});

describe('handler foreground — suppression du banner dans le chat actif', () => {
  it('notif du chat actif → pas de banner/son ni réapplication du badge ancien du push', async () => {
    const { setActiveChatId } = require('@/features/notifications/hooks/useNotificationSetup');
    setActiveChatId('chatA');

    const result = await captured.handler?.({
      request: { content: { data: { chatId: 'chatA', type: 'new_message' } } },
    });

    expect(result).toMatchObject({
      shouldPlaySound: false,
      shouldShowBanner: false,
      // The server payload may precede the read acknowledgement; the fresh recount owns the badge.
      shouldSetBadge: false,
      shouldShowList: true,
    });

    setActiveChatId(null);
  });

  it('notif d’un AUTRE chat → banner + son', async () => {
    const { setActiveChatId } = require('@/features/notifications/hooks/useNotificationSetup');
    setActiveChatId('chatA');

    const result = await captured.handler?.({
      request: { content: { data: { chatId: 'chatB', type: 'new_message' } } },
    });

    expect(result).toMatchObject({
      shouldPlaySound: true,
      shouldShowBanner: true,
    });

    setActiveChatId(null);
  });
});

describe('push transport — Expo iOS / FCM Android', () => {
  it('registers once when native APNs registration echoes the same token to its listener', async () => {
    const nativeToken = { type: 'ios', data: 'apns-initial' };
    let nativeRequests = 0;
    mockGetDevicePushToken.mockImplementation(async () => {
      nativeRequests += 1;
      // Match Expo's native registerForRemoteNotifications → onDevicePushToken.
      // Bound the faulty cycle so a regression fails without hanging Jest.
      if (nativeRequests < 8) captured.token?.(nativeToken);
      return nativeToken;
    });
    mockGetExpoPushToken.mockImplementation(async (...args: unknown[]) => {
      const options = args[0] as { devicePushToken?: unknown };
      if (!options.devicePushToken) await mockGetDevicePushToken();
      return { type: 'expo', data: 'ExpoPushToken[ios-device]' };
    });

    await mountSetup('u1');

    expect(mockGetDevicePushToken).toHaveBeenCalledTimes(1);
    expect(mockGetExpoPushToken).toHaveBeenCalledTimes(1);
    expect(mockSaveExpoPushToken).toHaveBeenCalledTimes(1);
  });

  it('persists Android FCM in the existing transport', async () => {
    require('react-native').Platform.OS = 'android';
    mockGetDevicePushToken.mockResolvedValue({ type: 'android', data: 'abc:APA91bDEF' });
    await mountSetup('u1');
    expect(mockSaveFcmToken).toHaveBeenCalledWith('u1', 'abc:APA91bDEF');
    expect(mockGetExpoPushToken).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().pushToken).toBe('abc:APA91bDEF');
  });

  it('obtains and stores an Expo token on iOS instead of an APNs token', async () => {
    await mountSetup('u1');
    expect(mockGetExpoPushToken).toHaveBeenCalledWith({
      projectId: 'test-project',
      devicePushToken: { type: 'ios', data: 'apns-initial' },
    });
    expect(mockGetDevicePushToken).toHaveBeenCalledTimes(1);
    expect(mockSaveFcmToken).not.toHaveBeenCalled();
    expect(mockSaveExpoPushToken).toHaveBeenCalledWith('u1', 'ExpoPushToken[ios-device]');
    expect(useNotificationStore.getState().pushToken).toBe('ExpoPushToken[ios-device]');
  });

  it('APNs refresh obtains a fresh Expo token and removes the old Expo token', async () => {
    await mountSetup('u1');
    mockGetExpoPushToken.mockResolvedValue({ type: 'expo', data: 'ExpoPushToken[new-device]' });
    await act(async () => {
      captured.token?.({ type: 'ios', data: 'a'.repeat(64) });
      await Promise.resolve();
    });
    expect(mockSaveExpoPushToken).toHaveBeenLastCalledWith('u1', 'ExpoPushToken[new-device]');
    expect(mockRemoveExpoPushToken).toHaveBeenCalledWith('u1', 'ExpoPushToken[ios-device]');
    expect(mockSaveFcmToken).not.toHaveBeenCalled();
  });

  it('denied permission never requests or persists a push token', async () => {
    mockGetPermissions.mockResolvedValue({ status: 'denied', granted: false, canAskAgain: false });
    await mountSetup('u1');
    expect(mockGetExpoPushToken).not.toHaveBeenCalled();
    expect(mockGetDevicePushToken).not.toHaveBeenCalled();
    expect(mockSaveExpoPushToken).not.toHaveBeenCalled();
  });

  it('ignores repeated APNs events and foregrounds after successful registration', async () => {
    await mountSetup('u1');
    await act(async () => {
      for (let index = 0; index < 20; index += 1) {
        captured.token?.({ type: 'ios', data: 'apns-initial' });
      }
      captured.appState?.('background');
      captured.appState?.('active');
    });
    expect(mockGetDevicePushToken).toHaveBeenCalledTimes(1);
    expect(mockGetExpoPushToken).toHaveBeenCalledTimes(1);
    expect(mockSaveExpoPushToken).toHaveBeenCalledTimes(1);
  });

  it('serializes token rotations and persists the newest event received during registration', async () => {
    let finishFirstRequest!: (token: { type: string; data: string }) => void;
    mockGetExpoPushToken.mockReturnValueOnce(new Promise((resolve) => {
      finishFirstRequest = resolve;
    }));
    await mountSetup('u1');
    await act(async () => {
      captured.token?.({ type: 'ios', data: 'apns-intermediate' });
      captured.token?.({ type: 'ios', data: 'apns-newest' });
    });
    expect(mockGetExpoPushToken).toHaveBeenCalledTimes(1);
    mockGetExpoPushToken.mockResolvedValue({ type: 'expo', data: 'ExpoPushToken[newest]' });
    await act(async () => finishFirstRequest({ type: 'expo', data: 'ExpoPushToken[first]' }));
    expect(mockGetExpoPushToken).toHaveBeenCalledTimes(2);
    expect(mockGetExpoPushToken).toHaveBeenLastCalledWith({
      projectId: 'test-project', devicePushToken: { type: 'ios', data: 'apns-newest' },
    });
    expect(mockGetDevicePushToken).toHaveBeenCalledTimes(1);
    expect(mockSaveExpoPushToken.mock.calls).toEqual([
      ['u1', 'ExpoPushToken[first]'], ['u1', 'ExpoPushToken[newest]'],
    ]);
    expect(mockRemoveExpoPushToken).toHaveBeenCalledWith('u1', 'ExpoPushToken[first]');
    expect(useNotificationStore.getState().pushToken).toBe('ExpoPushToken[newest]');
  });

  it('does not rewrite the profile when an APNs rotation maps to the same Expo token', async () => {
    await mountSetup('u1');
    await act(async () => captured.token?.({ type: 'ios', data: 'apns-rotated' }));
    expect(mockGetExpoPushToken).toHaveBeenCalledTimes(2);
    expect(mockSaveExpoPushToken).toHaveBeenCalledTimes(1);
    expect(mockRemoveExpoPushToken).not.toHaveBeenCalled();
  });

  it('retries a failed Expo request on foreground without restarting native registration', async () => {
    mockGetExpoPushToken.mockRejectedValueOnce(new Error('offline'));
    await mountSetup('u1');
    expect(mockGetExpoPushToken).toHaveBeenCalledTimes(1);
    expect(mockSaveExpoPushToken).not.toHaveBeenCalled();
    await act(async () => {
      captured.appState?.('background');
      captured.appState?.('active');
    });
    expect(mockGetExpoPushToken).toHaveBeenCalledTimes(2);
    expect(mockGetDevicePushToken).toHaveBeenCalledTimes(1);
    expect(mockSaveExpoPushToken).toHaveBeenCalledTimes(1);
  });

  it('does not consider a failed profile write registered, and retries on a later token event', async () => {
    mockSaveExpoPushToken.mockRejectedValueOnce(new Error('profile unavailable'));
    await mountSetup('u1');
    expect(useNotificationStore.getState().pushToken).toBeNull();
    await act(async () => captured.token?.({ type: 'ios', data: 'apns-initial' }));
    expect(mockSaveExpoPushToken).toHaveBeenCalledTimes(2);
    expect(useNotificationStore.getState().pushToken).toBe('ExpoPushToken[ios-device]');
  });

  it('retries removal of the old token without writing the new token twice', async () => {
    await mountSetup('u1');
    mockGetExpoPushToken.mockResolvedValue({ type: 'expo', data: 'ExpoPushToken[rotated]' });
    mockRemoveExpoPushToken.mockRejectedValueOnce(new Error('temporary removal failure'));
    await act(async () => captured.token?.({ type: 'ios', data: 'apns-rotated' }));
    expect(useNotificationStore.getState().pushToken).toBe('ExpoPushToken[rotated]');
    await act(async () => {
      captured.appState?.('background');
      captured.appState?.('active');
    });
    expect(mockSaveExpoPushToken).toHaveBeenCalledTimes(2);
    expect(mockRemoveExpoPushToken.mock.calls).toEqual([
      ['u1', 'ExpoPushToken[ios-device]'], ['u1', 'ExpoPushToken[ios-device]'],
    ]);
    await act(async () => captured.token?.({ type: 'ios', data: 'apns-rotated' }));
    expect(mockGetExpoPushToken).toHaveBeenCalledTimes(3);
  });

  it('ignores an old user request and its removed listener after switching accounts', async () => {
    let finishOldRequest!: (token: { type: string; data: string }) => void;
    mockGetExpoPushToken.mockReturnValueOnce(new Promise((resolve) => {
      finishOldRequest = resolve;
    }));
    const view = await mountSetup('u1');
    const oldListener = captured.token;
    act(() => {setNativeOwner('u2'); view.rerender({ uid: 'u2' });});
    await act(async () => {
      finishOldRequest({ type: 'expo', data: 'ExpoPushToken[old-user]' });
      oldListener?.({ type: 'ios', data: 'old-apns-event' });
    });
    expect(mockSaveExpoPushToken.mock.calls).toEqual([['u2', 'ExpoPushToken[ios-device]']]);
    expect(mockRemoveExpoPushToken).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().pushToken).toBe('ExpoPushToken[ios-device]');
  });

  it('does not persist or update the store after unmounting during registration', async () => {
    let finishRequest!: (token: { type: string; data: string }) => void;
    mockGetExpoPushToken.mockReturnValueOnce(new Promise((resolve) => {
      finishRequest = resolve;
    }));
    const view = await mountSetup('u1');
    view.unmount();
    await act(async () => finishRequest({ type: 'expo', data: 'ExpoPushToken[too-late]' }));
    expect(mockSaveExpoPushToken).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().pushToken).toBeNull();
  });

  it('does not replace the new account token when an already dispatched old write resolves', async () => {
    let finishOldWrite!: () => void;
    mockSaveExpoPushToken.mockReturnValueOnce(new Promise((resolve) => {
      finishOldWrite = resolve;
    }));
    mockGetExpoPushToken.mockResolvedValueOnce({ type: 'expo', data: 'ExpoPushToken[old-user]' });
    const view = await mountSetup('u1');
    act(() => {setNativeOwner('u2'); view.rerender({ uid: 'u2' });});
    await act(async () => { await Promise.resolve(); });
    expect(useNotificationStore.getState().pushToken).toBe('ExpoPushToken[ios-device]');
    await act(async () => finishOldWrite());
    expect(useNotificationStore.getState().pushToken).toBe('ExpoPushToken[ios-device]');
    expect(mockRemoveExpoPushToken).not.toHaveBeenCalled();
    expect(mockSaveExpoPushToken.mock.calls).toEqual([
      ['u1', 'ExpoPushToken[old-user]'], ['u2', 'ExpoPushToken[ios-device]'],
    ]);
  });

  it('persists Android rotations directly and deduplicates repeated FCM events', async () => {
    require('react-native').Platform.OS = 'android';
    mockGetDevicePushToken.mockResolvedValue({ type: 'android', data: 'fcm:initial' });
    await mountSetup('u1');
    await act(async () => {
      captured.token?.({ type: 'android', data: 'fcm:rotated' });
      captured.token?.({ type: 'android', data: 'fcm:rotated' });
    });
    expect(mockGetDevicePushToken).toHaveBeenCalledTimes(1);
    expect(mockGetExpoPushToken).not.toHaveBeenCalled();
    expect(mockSaveFcmToken.mock.calls).toEqual([['u1', 'fcm:initial'], ['u1', 'fcm:rotated']]);
    expect(mockRemoveFcmToken).toHaveBeenCalledWith('u1', 'fcm:initial');
    expect(useNotificationStore.getState().pushToken).toBe('fcm:rotated');
  });
});

describe('cycle de vie — réception & déconnexion', () => {
  it('réception en foreground → incrément optimiste du badge in-app', async () => {
    await mountSetup('u1');
    // setup() a appelé refreshBadgeCount → count serveur = 3.
    expect(useNotificationStore.getState().unreadCount).toBe(3);

    // Nouvelle notif reçue : +1 optimiste immédiat.
    act(() => captured.received?.({ request: { content: { data: { type: 'new_message', chatId: 'c2' } } } }));
    expect(useNotificationStore.getState().unreadCount).toBe(4);
  });

  it('déconnexion (userId null) → reset du store notifications', async () => {
    await mountSetup('u1');
    act(() => useNotificationStore.getState().setUnreadCount(9));

    // Re-render avec userId null = logout.
    const view = renderHook<void, { uid: string | null }>(
      ({ uid }) => useNotificationSetup(uid),
      { initialProps: { uid: null as string | null } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    view.unmount();

    expect(useNotificationStore.getState().unreadCount).toBe(0);
    expect(useNotificationStore.getState().pushToken).toBeNull();
  });
});

describe('channels Android — canaux requis par le backend', () => {
  it('crée les canaux que le backend cible (messages, orders, saved_searches…)', async () => {
    // Le preset jest-expo monte en iOS (setupAndroidChannels no-op). On force
    // Android pour exercer la vraie logique de création de canaux.
    const Platform = require('react-native').Platform;
    const originalOS = Platform.OS;
    Platform.OS = 'android';
    try {
      await mountSetup('u1');
    } finally {
      Platform.OS = originalOS;
    }
    const channelIds = mockSetChannel.mock.calls.map((c) => c[0]);
    // Sans ces canaux, Android 8+ jette silencieusement la notif (R1/M3).
    expect(channelIds).toEqual(
      expect.arrayContaining([
        'messages',
        'offers',
        'notifications',
        'swaps',
        'saved_searches',
        'orders',
      ]),
    );
  });
});
