import { arrayRemove, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, firestore } from '@/config/firebaseConfig';
import { runtimeEnvironment } from '@/config/firebaseEnvironment';
import { removeDevPushDestination } from '@/services/devPushDestinationService';
import type { User, UserPreferences } from '@/types';

/** Basic account I/O used while the auth store itself is initializing. */
export async function getUserById(userId: string): Promise<User | null> {
  try {
    const userDoc = await getDoc(doc(firestore, 'users', userId));
    if (!userDoc.exists()) return null;
    const data = userDoc.data();
    if (!data) return null;
    return {
      ...data,
      id: userDoc.id,
      createdAt: (data.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() || new Date(),
    } as User;
  } catch (error) {
    if (__DEV__) console.error('Error fetching user:', error);
    return null;
  }
}

export async function getUserPreferences(userId: string): Promise<UserPreferences | null> {
  try {
    const user = await getUserById(userId);
    return user?.preferences || null;
  } catch (error) {
    if (__DEV__) console.error('Error fetching user preferences:', error);
    return null;
  }
}

/** Logout cleanup remains best-effort and only touches the current SDK owner. */
export async function removeFcmToken(userId: string, token: string): Promise<void> {
  if (auth.currentUser?.uid !== userId) return;
  try {
    await updateDoc(doc(firestore, 'users', userId), {
      fcmTokens: arrayRemove(token),
      updatedAt: serverTimestamp(),
    });
    if (__DEV__) console.log('FCM token removed successfully');
  } catch (error) {
    if (__DEV__) console.error('Error removing FCM token:', error);
  }
}

export async function removeExpoPushToken(userId: string, token: string): Promise<void> {
  if (auth.currentUser?.uid !== userId) return;
  if (runtimeEnvironment.name === 'development') {
    await removeDevPushDestination(userId, token || undefined);
    return;
  }
  await updateDoc(doc(firestore, 'users', userId), {
    expoPushTokens: arrayRemove(token),
    updatedAt: serverTimestamp(),
  });
}
