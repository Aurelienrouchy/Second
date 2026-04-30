import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getReactNativePersistence, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyABP_QVBln4VORUy5w_vCgmYYqbZZbVMSA',
  authDomain: 'seconde-b47a6.firebaseapp.com',
  projectId: 'seconde-b47a6',
  storageBucket: 'seconde-b47a6.firebasestorage.app',
  messagingSenderId: '628214013296',
  appId: '1:628214013296:ios:f8cb32e7616df1b0dd83b5',
};

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
