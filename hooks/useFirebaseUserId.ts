import { useSyncExternalStore } from 'react';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '@/config/firebaseConfig';

function subscribe(onChange: () => void): () => void {
  return onIdTokenChanged(auth, () => onChange());
}

function currentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

/** Live SDK identity, including the render before an auth-change effect runs. */
export function useFirebaseUserId(): string | null {
  return useSyncExternalStore(subscribe, currentUid, currentUid);
}
