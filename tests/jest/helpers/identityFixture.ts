import type { User as FirebaseUser } from 'firebase/auth';
import { auth } from '@/config/firebaseConfig';
import { useAuthStore } from '@/store/authStore';
import type { User } from '@/types';

/** Explicit native-provider fixture, never a mock of the session/admission guard. */
export function establishIdentityFixture(uid: string): void {
  const profile: User = { id: uid, username: uid, email: `${uid}@example.test`,
    dateOfBirth: '1990-01-01', createdAt: new Date('2020-01-01'), isActive: true,
    preferences: { sizes: [], favoriteBrands: [], analyticsConsent: false } };
  Object.defineProperty(auth, 'currentUser', { configurable: true, writable: true, value: {
    uid, email: profile.email, emailVerified: true, providerData: [{ providerId: 'password' }],
    getIdToken: async () => 'synthetic-test-token',
    getIdTokenResult: async () => ({ claims: { auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'password' } } }),
  } as unknown as FirebaseUser });
  useAuthStore.setState({ authenticatedUid: uid, user: profile, identityUser: profile,
    identityError: false, isLoading: false });
}

export function clearIdentityFixture(): void {
  Object.defineProperty(auth, 'currentUser', { value: null, configurable: true, writable: true });
  useAuthStore.setState({ authenticatedUid: null, user: null, identityUser: null, identityError: false, isLoading: false });
}
