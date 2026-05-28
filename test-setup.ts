import { vi } from 'vitest';

// Firebase SDK mocks — all services import from @/config/firebaseConfig
vi.mock('@/config/firebaseConfig', () => ({
  auth: { currentUser: null, onAuthStateChanged: vi.fn() },
  firestore: {},
  storage: {},
  functions: {},
}));

// Firebase modular API mocks
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  onSnapshot: vi.fn(),
  serverTimestamp: vi.fn(() => new Date()),
  arrayUnion: vi.fn((...args: unknown[]) => args),
  arrayRemove: vi.fn((...args: unknown[]) => args),
  increment: vi.fn((n: number) => n),
  Timestamp: { now: vi.fn(), fromDate: vi.fn((d: Date) => d) },
}));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
  updateProfile: vi.fn(),
  updateEmail: vi.fn(),
  updatePassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendEmailVerification: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
  GoogleAuthProvider: { credential: vi.fn() },
  OAuthProvider: vi.fn(),
  linkWithCredential: vi.fn(),
  deleteUser: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(),
  uploadBytesResumable: vi.fn(),
  getDownloadURL: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(),
}));

// React Native mocks
vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: vi.fn((obj: Record<string, unknown>) => obj.ios) },
  Alert: { alert: vi.fn() },
  Dimensions: { get: vi.fn(() => ({ width: 375, height: 812 })) },
  StyleSheet: { create: vi.fn((styles: unknown) => styles) },
}));

// AsyncStorage mock
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    getAllKeys: vi.fn(),
    multiGet: vi.fn(),
    multiSet: vi.fn(),
    multiRemove: vi.fn(),
  },
}));

// Expo mocks
vi.mock('expo-image', () => ({
  Image: { generateBlurhashAsync: vi.fn() },
}));

vi.mock('expo-image-manipulator', () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
}));

vi.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: vi.fn(),
  EncodingType: { Base64: 'base64' },
}));

vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: vi.fn(),
    hasPlayServices: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock('expo-apple-authentication', () => ({
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

vi.mock('expo-crypto', () => ({
  digestStringAsync: vi.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
