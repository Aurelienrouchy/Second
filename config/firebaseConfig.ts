import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
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

if (
  __DEV__ &&
  Object.entries(firebaseConfig).some(
    ([key, value]) => value === FALLBACK_CONFIG[key as keyof typeof FALLBACK_CONFIG]
  )
) {
  console.warn(
    '[firebaseConfig] Using hardcoded fallback for at least one Firebase key. ' +
      'Configure EXPO_PUBLIC_FIREBASE_* in .env to override.'
  );
}

// Initialize Firebase (prevent double init)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Auth with AsyncStorage persistence for React Native
const auth = getApps().length <= 1
  ? initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    })
  : getAuth(app);

const firestore = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

export { app, auth, firestore, storage, functions };
