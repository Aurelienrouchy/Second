/**
 * Firebase Admin initialization
 * Firebase Functions v7 / firebase-admin v13.6.0
 */
import * as admin from 'firebase-admin';
import {installFinancialSubjectTransactions} from '../utils/financialSubjectTransaction';
import { requireRuntimeProjectId, runtimeStorageBucket } from './runtimeEnvironment';

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

// Refuse a dev/prod target mismatch before Admin can initialize ADC clients.
const runtimeProject = requireRuntimeProjectId();
const runtimeBucket = runtimeStorageBucket();
if (admin.apps.some(app => app && (app.options.projectId !== runtimeProject || app.options.storageBucket !== runtimeBucket))) {
  throw new Error('Firebase Admin cannot reuse an app from another or unqualified environment.');
}

// Initialize Firebase Admin (singleton)
if (!admin.apps.length) {
  // Pass only the validated tuple. initializeApp(undefined) would independently
  // adopt FIREBASE_CONFIG.storageBucket, even when its projectId is correct.
  admin.initializeApp({ projectId: runtimeProject, storageBucket: runtimeBucket });
}

export const db = admin.firestore();
installFinancialSubjectTransactions(db);
export const auth = admin.auth();
export const messaging = admin.messaging();
export const storage = admin.storage();

export { admin };
export { FieldValue } from 'firebase-admin/firestore';
