import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getAuth } from 'firebase/auth';
// @ts-expect-error getReactNativePersistence exists at runtime
import { getReactNativePersistence } from '@firebase/auth';
import {
  initializeFirestore,
  memoryLocalCache,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Hardcoded fallbacks for the production project.
// Prefer EXPO_PUBLIC_FIREBASE_* env vars (see .env.example) so credentials
// can be rotated and per-environment configs (dev/staging/prod) work.
const FALLBACK_CONFIG = {
  apiKey: 'AIzaSyABP_QVBln4VORUy5w_vCgmYYqbZZbVMSA',
  authDomain: 'seconde-b47a6.firebaseapp.com',
  projectId: 'seconde-b47a6',
  storageBucket: 'seconde-b47a6.firebasestorage.app',
  messagingSenderId: '628214013296',
  appId: '1:628214013296:ios:f8cb32e7616df1b0dd83b5',
};

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || FALLBACK_CONFIG.apiKey,
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || FALLBACK_CONFIG.authDomain,
  projectId:
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || FALLBACK_CONFIG.projectId,
  storageBucket:
    process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    FALLBACK_CONFIG.storageBucket,
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ||
    FALLBACK_CONFIG.messagingSenderId,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || FALLBACK_CONFIG.appId,
};

// No warning when fallbacks are used: the hardcoded values ARE the
// canonical prod config, kept here so the app boots even when no .env
// is present (e.g. CI smoke runs, fresh clones). Set
// EXPO_PUBLIC_FIREBASE_* in .env only when targeting a different
// project (dev/staging) — they take precedence automatically.

// Initialize Firebase (prevent double init)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Auth with AsyncStorage persistence for React Native
const auth = getApps().length <= 1
  ? initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    })
  : getAuth(app);

// Memory cache: the Web SDK's persistentLocalCache needs IndexedDB, which
// React Native lacks — it always fell back to memory anyway (with a noisy
// warning). Offline cold-start of the user doc is handled separately via the
// AsyncStorage snapshot in authStore.hydrateFromFirebase.
const firestore = initializeFirestore(app, {
  localCache: memoryLocalCache(),
});
const storage = getStorage(app);
const functions = getFunctions(app, 'northamerica-northeast1');

export { app, auth, firestore, storage, functions };
