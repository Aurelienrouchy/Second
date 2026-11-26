import { useState } from 'react';
import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
/** The SDK object never enters a query key; an opaque local epoch forces a
 * new read even when the UID and auth generation happen to stay identical. */
export function useBusinessCessationIdentity(uid: string) {
  const generation = useAuthStore(() => getAuthSessionGeneration()), owner = auth.currentUser;
  const [identity, setIdentity] = useState({owner, epoch: 0});
  if (identity.owner !== owner) setIdentity({owner, epoch: identity.epoch + 1});
  return {owner, ready: identity.owner === owner, key: JSON.stringify([uid, generation, identity.epoch])};
}
