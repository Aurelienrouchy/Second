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
 *  TOKEN FCM (isFcmRegistrationToken, via le flux de setup) :
 *   - token Android FCM (contient ':') → persisté
 *   - token APNs brut iOS (hex 64) → IGNORÉ (backend ne peut pas l'envoyer)
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

// --- Capture des listeners / handler enregistrés par le module --------------
type Listener = (arg: unknown) => void;
const captured: {
  handler?: (n: unknown) => Promise<unknown>;
  received?: Listener;
  response?: Listener;
  token?: Listener;
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
const mockSetChannel = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockSetBadge = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockGetLastResponse = jest.fn((..._args: unknown[]) => Promise.resolve(null));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: (cfg: { handleNotification: (n: unknown) => Promise<unknown> }) => {
    captured.handler = cfg.handleNotification;
  },
  getPermissionsAsync: (...a: unknown[]) => mockGetPermissions(...a),
  requestPermissionsAsync: (...a: unknown[]) => mockRequestPermissions(...a),
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
  get router() {
    return mockRouter;
  },
}));

// Services : on les neutralise / pilote.
const mockCountUnread = jest.fn((..._args: unknown[]) => Promise.resolve(3));
jest.mock('@/services/notificationService', () => ({
  NotificationService: {
    countUnreadNotifications: (...a: unknown[]) => mockCountUnread(...a),
  },
}));

const mockSaveFcmToken = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockRemoveFcmToken = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('@/services/userService', () => ({
  UserService: {
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
import { useNotificationSetup } from '@/hooks/useNotificationSetup';

/** Monte le hook et laisse résoudre le setup async (channels/token/badge). */
async function mountSetup(userId: string | null = 'u1') {
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
  mockGetDevicePushToken.mockResolvedValue({ type: 'android', data: 'fcmtoken:APA91bXYZ' });
  mockGetLastResponse.mockResolvedValue(null);
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
  it('notif du chat actif → pas de banner/son, mais liste + badge maintenus', async () => {
    const { setActiveChatId } = require('@/hooks/useNotificationSetup');
    setActiveChatId('chatA');

    const result = await captured.handler?.({
      request: { content: { data: { chatId: 'chatA', type: 'new_message' } } },
    });

    expect(result).toMatchObject({
      shouldPlaySound: false,
      shouldShowBanner: false,
      // On garde l'UX silencieuse mais cohérente : badge + liste.
      shouldSetBadge: true,
      shouldShowList: true,
    });

    setActiveChatId(null);
  });

  it('notif d’un AUTRE chat → banner + son', async () => {
    const { setActiveChatId } = require('@/hooks/useNotificationSetup');
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

describe('token FCM — classification natif vs APNs brut', () => {
  it('token Android FCM (contient ":") → persisté via UserService', async () => {
    mockGetDevicePushToken.mockResolvedValue({ type: 'android', data: 'abc:APA91bDEF' });
    await mountSetup('u1');

    expect(mockSaveFcmToken).toHaveBeenCalledWith('u1', 'abc:APA91bDEF');
    expect(useNotificationStore.getState().pushToken).toBe('abc:APA91bDEF');
  });

  it('token APNs brut iOS (hex 64) → IGNORÉ (backend ne peut pas l’envoyer)', async () => {
    const apns = 'a'.repeat(64); // hex pur, pas de ':'
    mockGetDevicePushToken.mockResolvedValue({ type: 'ios', data: apns });
    await mountSetup('u1');

    expect(mockSaveFcmToken).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().pushToken).toBeNull();
  });
});

describe('cycle de vie — réception & déconnexion', () => {
  it('réception en foreground → incrément optimiste du badge in-app', async () => {
    await mountSetup('u1');
    // setup() a appelé refreshBadgeCount → count serveur = 3.
    expect(useNotificationStore.getState().unreadCount).toBe(3);

    // Nouvelle notif reçue : +1 optimiste immédiat.
    act(() => captured.received?.({}));
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
