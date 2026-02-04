/**
 * Firebase Admin initialization
 * Firebase Functions v7 / firebase-admin v13.6.0
 */
import * as admin from 'firebase-admin';

// Initialize Firebase Admin (singleton)
if (!admin.apps.length) {
  admin.initializeApp();
}

export const db = admin.firestore();
export const auth = admin.auth();
export const messaging = admin.messaging();
export const storage = admin.storage();

export { admin };
export { FieldValue } from 'firebase-admin/firestore';
