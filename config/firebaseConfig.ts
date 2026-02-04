import { getApp } from '@react-native-firebase/app';
import { getAuth } from '@react-native-firebase/auth';
import { getFirestore } from '@react-native-firebase/firestore';
import { getStorage } from '@react-native-firebase/storage';
import { getFunctions } from '@react-native-firebase/functions';

// Initialize Firebase instances using modular API
const app = getApp();
const auth = getAuth(app);
const firestore = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app);

export { app, auth, firestore, storage, functions };
