/**
 * Firebase Admin initialization
 * Firebase Functions v7 / firebase-admin v13.6.0
 */
import * as admin from 'firebase-admin';

// Unit tests mock this module. Integration tests must explicitly configure all
// emulators on a demo project; an accidental unmocked import fails before ADC
// or any network access can reach a real Firebase project.
const testProjectId = process.env.GCLOUD_PROJECT;
if (process.env.NODE_ENV === 'test') {
  if (!testProjectId?.startsWith('demo-') ||
      !process.env.FIRESTORE_EMULATOR_HOST ||
      !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error('Functions tests must mock Firebase or configure all Firebase emulators on a demo project.');
  }
  if (admin.apps.some((app) => app?.options.projectId !== testProjectId)) {
    throw new Error('Functions tests cannot reuse an app from a real Firebase project.');
  }
}

// Initialize Firebase Admin (singleton)
if (!admin.apps.length) {
  admin.initializeApp(process.env.NODE_ENV === 'test'
    ? { projectId: testProjectId, storageBucket: `${testProjectId}.appspot.com` }
    : undefined);
}

export const db = admin.firestore();
export const auth = admin.auth();
export const messaging = admin.messaging();
export const storage = admin.storage();

export { admin };
export { FieldValue } from 'firebase-admin/firestore';
