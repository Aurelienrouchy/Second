/* eslint-disable no-undef */
/**
 * Setup Jest (jest-expo) — mocks pour les tests composant / écran / hook RN.
 *
 * RNTL v13 étend automatiquement les matchers (toBeOnTheScreen, toHaveTextContent…)
 * dès l'import de la lib ; pas besoin de '@testing-library/jest-native'.
 *
 * Ces mocks couvrent les modules natifs Expo/RN qui n'ont pas d'implémentation
 * sous Node : caméra, image-picker, notifications, haptics, image, router,
 * reanimated, gesture-handler, async-storage, et le SDK Firebase Web.
 */

// --- react-native-reanimated (mock officiel) ---------------------------------
jest.mock('react-native-reanimated', () => {
  const official = require('react-native-reanimated/mock');
  return {
    ...official,
    Easing: {
      ...official.Easing,
      bezier: (...controlPoints) => ({ factory: () => require('react-native').Easing.bezier(...controlPoints) }),
    },
  };
});

// --- react-native-gesture-handler --------------------------------------------
require('react-native-gesture-handler/jestSetup');

// --- expo-haptics ------------------------------------------------------------
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// --- expo-image --------------------------------------------------------------
jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Image = (props) => React.createElement(View, props, props.children);
  Image.generateBlurhashAsync = jest.fn(() => Promise.resolve(null));
  return { Image };
});

jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(async () => { throw new Error('Supply an explicit sharing fixture before exporting a private file.'); }),
}));
jest.mock('expo-application', () => ({
  applicationId: 'com.seconde.app.dev',
  nativeApplicationVersion: '1.0.1',
  nativeBuildVersion: '1',
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: '5f72091d-3473-467c-a4fd-96fe18cda4d2' } } },
    easConfig: { projectId: '5f72091d-3473-467c-a4fd-96fe18cda4d2' },
  },
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(async () => true),
    signIn: jest.fn(),
    signOut: jest.fn(async () => undefined),
  },
}));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: jest.fn(async () => false),
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
// Rendering a screen does not install GPU or payment native modules in Node.
// Tests that exercise those providers must supply their own explicit results.
jest.mock('@shopify/react-native-skia', () => {
  const { View } = require('react-native');
  return { Canvas: View, Circle: View, Group: View, RadialGradient: View, Blur: View, Fill: View,
    vec: (x, y) => ({ x, y }) };
});
jest.mock('@stripe/stripe-react-native', () => {
  const { View } = require('react-native');
  const unconfigured = jest.fn(async () => { throw new Error('Supply an explicit Stripe provider fixture before exercising payments.'); });
  return { StripeProvider: View, CardField: View, useStripe: () => ({
    confirmPayment: unconfigured, handleNextAction: unconfigured,
    initPaymentSheet: unconfigured, presentPaymentSheet: unconfigured,
  }) };
});
jest.mock('expo-file-system', () => {
  class UnconfiguredFile {
    constructor(...parts) { this.uri = parts.map(part => typeof part === 'string' ? part : part.uri).join('/'); }
    exists = false;
    size = 0;
    bytes = async () => { throw new Error('Supply an explicit file fixture before reading private bytes.'); };
    create() { throw new Error('Supply an explicit file fixture before creating private files.'); }
    copy() { throw new Error('Supply an explicit file fixture before copying private files.'); }
    delete() { throw new Error('Supply an explicit file fixture before deleting private files.'); }
  }
  return { File: UnconfiguredFile, Directory: UnconfiguredFile, Paths: { document: 'file:///jest-documents' } };
});

// --- @expo/vector-icons ------------------------------------------------------
// Les icônes tirent expo-font (ESM non transformé) ; on les remplace par une
// View légère qui expose le `name` de l'icône (utile pour les assertions).
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { View } = require('react-native');
  const makeIcon = () => (props) =>
    React.createElement(View, {
      ...props,
      accessibilityLabel: props.name,
      testID: props.testID ?? `icon-${props.name}`,
    });
  return new Proxy(
    {},
    {
      get: (_target, key) => (key === '__esModule' ? false : makeIcon()),
    },
  );
});

// --- expo-image-manipulator --------------------------------------------------
// Évite de tirer le runtime `expo` (Expo.fx -> expo-asset, ESM) dans les tests
// composant qui importent transitivement aiService / draftService.
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn((uri) => Promise.resolve({ uri: `processed-${uri}` })),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: {
    manipulate: jest.fn(() => ({
      resize: jest.fn().mockReturnThis(),
      renderAsync: jest.fn(() => Promise.resolve({ saveAsync: jest.fn() })),
    })),
  },
  useImageManipulator: jest.fn(),
}));

// --- expo-status-bar ---------------------------------------------------------
jest.mock('expo-status-bar', () => {
  const React = require('react');
  const { View } = require('react-native');
  const StatusBar = (props) => React.createElement(View, props, props.children);
  return {
    StatusBar,
    setStatusBarStyle: jest.fn(),
    setStatusBarHidden: jest.fn(),
  };
});

// --- expo-blur ---------------------------------------------------------------
jest.mock('expo-blur', () => {
  const React = require('react');
  const { View } = require('react-native');
  const BlurView = (props) => React.createElement(View, props, props.children);
  return { BlurView };
});

// --- expo-camera -------------------------------------------------------------
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    CameraView: (props) => React.createElement(View, props, props.children),
    useCameraPermissions: () => [{ granted: true, status: 'granted' }, jest.fn()],
    Camera: { requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })) },
  };
});

// --- expo-image-picker -------------------------------------------------------
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
  launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  MediaTypeOptions: { Images: 'Images', Videos: 'Videos', All: 'All' },
  MediaType: { Images: 'images', Videos: 'videos' },
}));

// --- expo-notifications -------------------------------------------------------
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted', granted: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted', granted: true })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('notif-id')),
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3 },
}));

// --- expo-network -------------------------------------------------------------
// Tiré transitivement par lib/queryClient (détection online/offline). Sans ce
// mock, tout test qui importe un barrel de feature exposant un hook -> authStore
// -> queryClient échoue au parse du module natif.
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest.fn(() =>
    Promise.resolve({ isConnected: true, isInternetReachable: true })
  ),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  NetworkStateType: { WIFI: 'WIFI', CELLULAR: 'CELLULAR', NONE: 'NONE' },
}));

// --- expo-router --------------------------------------------------------------
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  const router = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    navigate: jest.fn(),
    setParams: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
    canGoBack: jest.fn(() => true),
  };
  const passthrough = (props) => React.createElement(View, props, props.children);
  const Link = (props) => React.createElement(View, props, props.children);
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: () => ({}),
    useGlobalSearchParams: () => ({}),
    useSegments: () => [],
    usePathname: () => '/',
    useFocusEffect: jest.fn((effect) => React.useEffect(effect, [effect])),
    Link,
    Redirect: passthrough,
    Slot: passthrough,
    Stack: Object.assign(passthrough, { Screen: passthrough }),
    Tabs: Object.assign(passthrough, { Screen: passthrough }),
  };
});

// A mounted test screen starts in the foreground. Individual lifecycle tests
// still drive the real AppState subscriptions and may explicitly blur it.
beforeEach(() => {
  Object.defineProperty(require('react-native').AppState, 'currentState', {
    value: 'active', writable: true, configurable: true,
  });
});

// --- @react-native-async-storage/async-storage --------------------------------
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// --- Firebase (SDK Web modular + config app) ---------------------------------
// Native UUID source: keep genuine UUID uniqueness in tests without loading
// Expo's ESM native module through the Jest runtime.
jest.mock('expo-crypto', () => ({
  randomUUID: () => require('node:crypto').randomUUID(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm, value) => require('node:crypto').createHash('sha256').update(value).digest('hex'),
  getRandomBytesAsync: async count => new Uint8Array(require('node:crypto').randomBytes(count)),
}));

jest.mock('@/config/firebaseConfig', () => ({
  auth: { currentUser: null, onAuthStateChanged: jest.fn() },
  firestore: {},
  storage: {},
  functions: {},
  db: {},
}));

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  documentId: jest.fn(() => '__name__'),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  getDocFromServer: jest.fn((...args) => require('firebase/firestore').getDoc(...args)),
  getDocsFromServer: jest.fn((...args) => require('firebase/firestore').getDocs(...args)),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  addDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  or: jest.fn((...constraints) => ({ type: 'or', constraints })),
  orderBy: jest.fn(),
  limit: jest.fn(),
  startAfter: jest.fn(),
  onSnapshot: jest.fn(() => jest.fn()),
  serverTimestamp: jest.fn(() => new Date()),
  arrayUnion: jest.fn((...args) => args),
  arrayRemove: jest.fn((...args) => args),
  increment: jest.fn((n) => n),
  Timestamp: { now: jest.fn(), fromDate: jest.fn((d) => d) },
}));

jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
  onAuthStateChanged: jest.fn(() => jest.fn()),
  onIdTokenChanged: jest.fn((auth, callback) => {
    callback(auth.currentUser || null);
    return jest.fn();
  }),
  updateProfile: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  EmailAuthProvider: { credential: jest.fn() },
  GoogleAuthProvider: { credential: jest.fn() },
  OAuthProvider: jest.fn(),
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => jest.fn(() => Promise.resolve({ data: {} }))),
}));

jest.mock('firebase/storage', () => ({
  ref: jest.fn(),
  uploadBytes: jest.fn(),
  uploadBytesResumable: jest.fn(),
  uploadString: jest.fn(),
  getDownloadURL: jest.fn(),
  getBytes: jest.fn(() => Promise.reject(new Error('Private media bytes must be explicitly mocked'))),
  deleteObject: jest.fn(),
  listAll: jest.fn(() => Promise.resolve({ items: [] })),
}));

// Silence l'avertissement act(...) sur les transitions hors test.
jest.spyOn(console, 'error').mockImplementation((...args) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  if (msg.includes('not wrapped in act')) return;
  // eslint-disable-next-line no-console
  console.warn(...args);
});
