/**
 * authStore — orchestration MÉTIER de la session (Zustand 5).
 *
 * Couvre les comportements observables du store, pas son câblage interne :
 *  - Consent gate (Loi 25) dans hydrateFromFirebase : un user Firestore SANS
 *    dateOfBirth ne doit JAMAIS être authentifié (user reste null, session invité).
 *  - hydrateFromFirebase avec dateOfBirth → user authentifié + persisté.
 *  - Social sign-in : needsConsent=true ⇒ l'utilisateur N'ENTRE PAS dans l'app
 *    (pas de signIn) ; needsConsent=false ⇒ signIn + merge invité.
 *  - rollbackSocialSignIn délègue à AuthService avec le bon isNewUser et remet
 *    l'état à zéro (user null).
 *  - reset() restaure l'état initial.
 *
 * On mocke AuthService + les services/stores satellites pour isoler la logique
 * du store. .test.tsx → périmètre Jest.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const mockGetCurrentUser = jest.fn();
const mockRollback = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockAuthSignOut = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockEnsureUsername = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockRecordConsent = jest.fn();
const mockSignInWithEmail = jest.fn();
const mockSignInWithGoogle = jest.fn();
const mockSignInWithApple = jest.fn();

jest.mock('@/services/authService', () => ({
  AuthService: {
    getCurrentUser: (...a: unknown[]) => mockGetCurrentUser(...a),
    rollbackUnconsentedAccount: (...a: unknown[]) => mockRollback(...a),
    signOut: (...a: unknown[]) => mockAuthSignOut(...a),
    ensureUsernameAssigned: (...a: unknown[]) => mockEnsureUsername(...a),
    recordConsentForCurrentUser: (...a: unknown[]) => mockRecordConsent(...a),
    signInWithEmail: (...a: unknown[]) => mockSignInWithEmail(...a),
    signInWithGoogle: (...a: unknown[]) => mockSignInWithGoogle(...a),
    signInWithApple: (...a: unknown[]) => mockSignInWithApple(...a),
  },
}));

const mockMerge = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('@/services/authMergeService', () => ({
  mergeGuestDataIntoUser: (...a: unknown[]) => mockMerge(...a),
}));

jest.mock('@/services/guestPreferencesService', () => ({
  guestPreferencesService: {
    getGuestSession: jest.fn((..._args: unknown[]) => Promise.resolve(null)),
    createGuestSession: jest.fn((..._args: unknown[]) => Promise.resolve({ guestId: 'guest-1' })),
    clearGuestSession: jest.fn((..._args: unknown[]) => Promise.resolve()),
  },
}));

jest.mock('@/services/userService', () => ({
  UserService: {
    getUserById: jest.fn((..._args: unknown[]) => Promise.resolve(null)),
    removeFcmToken: jest.fn((..._args: unknown[]) => Promise.resolve()),
  },
}));

jest.mock('@/lib/queryClient', () => ({
  queryClient: { clear: jest.fn() },
}));

jest.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('@/store/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ reset: jest.fn(), pushToken: null }) },
}));
jest.mock('@/store/immersiveOverlayStore', () => ({
  useImmersiveOverlayStore: { getState: () => ({ reset: jest.fn() }) },
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  updateDoc: jest.fn((..._args: unknown[]) => Promise.resolve()),
}));

import { useAuthStore } from '@/store/authStore';

const CONSENTED_USER = {
  id: 'uid-1',
  email: 'a@b.com',
  displayName: 'Anna',
  dateOfBirth: '1995-01-01',
  username: 'anna',
  createdAt: new Date(),
  isActive: true,
};

const fbUser = { uid: 'uid-1', email: 'a@b.com' };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  useAuthStore.getState().reset();
});

describe('authStore.hydrateFromFirebase — consent gate Loi 25', () => {
  it('compte SANS dateOfBirth → reste non-authentifié (user null) malgré un token Firebase', async () => {
    mockGetCurrentUser.mockResolvedValue({
      ...CONSENTED_USER,
      dateOfBirth: undefined,
    });

    await useAuthStore.getState().hydrateFromFirebase(fbUser);

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false);
    // Pas de persistance d'un user non-consenti.
    expect(await AsyncStorage.getItem('user_data')).toBeNull();
  });

  it('compte AVEC dateOfBirth → authentifié, isLoading false, persisté', async () => {
    mockGetCurrentUser.mockResolvedValue(CONSENTED_USER);

    await useAuthStore.getState().hydrateFromFirebase(fbUser);

    const state = useAuthStore.getState();
    expect(state.user?.id).toBe('uid-1');
    expect(state.isLoading).toBe(false);
    const persisted = await AsyncStorage.getItem('user_data');
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted as string).id).toBe('uid-1');
  });

  it('aucun firebaseUser → user null + session invité initialisée', async () => {
    await useAuthStore.getState().hydrateFromFirebase(null);
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.guestSession).not.toBeNull();
  });
});

describe('authStore.signInWithGoogle — gate de consentement', () => {
  it('needsConsent=true → NE fait PAS entrer dans l\'app (pas de signIn ni merge)', async () => {
    mockSignInWithGoogle.mockResolvedValue({
      user: { ...CONSENTED_USER, dateOfBirth: undefined },
      needsConsent: true,
      isNewUser: true,
    });

    const result = await useAuthStore.getState().signInWithGoogle();

    expect(result.needsConsent).toBe(true);
    // Pas d'authentification tant que le consentement n'est pas enregistré.
    expect(useAuthStore.getState().user).toBeNull();
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it('needsConsent=false → signIn + merge invité', async () => {
    mockSignInWithGoogle.mockResolvedValue({
      user: CONSENTED_USER,
      needsConsent: false,
      isNewUser: false,
    });

    await useAuthStore.getState().signInWithGoogle();

    expect(useAuthStore.getState().user?.id).toBe('uid-1');
    expect(mockMerge).toHaveBeenCalledWith('uid-1');
  });
});

describe('authStore.recordSocialConsent', () => {
  it('persiste le consentement via AuthService puis authentifie + merge', async () => {
    mockRecordConsent.mockResolvedValue(CONSENTED_USER);

    const pending = { ...CONSENTED_USER, dateOfBirth: undefined };
    const fresh = await useAuthStore.getState().recordSocialConsent(pending, {
      dateOfBirth: '1995-01-01',
      acceptedTerms: true,
      acceptedPrivacy: true,
      marketingOptIn: false,
    });

    expect(mockRecordConsent).toHaveBeenCalled();
    expect(fresh.id).toBe('uid-1');
    expect(useAuthStore.getState().user?.id).toBe('uid-1');
    expect(mockMerge).toHaveBeenCalledWith('uid-1');
  });
});

describe('authStore.rollbackSocialSignIn', () => {
  it('délègue à AuthService avec isNewUser=true et remet l\'état à zéro', async () => {
    // Simule un état déjà partiellement peuplé.
    await useAuthStore.getState().signIn(CONSENTED_USER);
    expect(useAuthStore.getState().user).not.toBeNull();

    await useAuthStore.getState().rollbackSocialSignIn(true);

    expect(mockRollback).toHaveBeenCalledWith(true);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('transmet isNewUser=false (compte existant jamais supprimé)', async () => {
    await useAuthStore.getState().rollbackSocialSignIn(false);
    expect(mockRollback).toHaveBeenCalledWith(false);
  });
});

describe('authStore.reset', () => {
  it('restaure l\'état initial (user null, isLoading true)', async () => {
    await useAuthStore.getState().signIn(CONSENTED_USER);
    useAuthStore.getState().reset();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(true);
    expect(state.guestSession).toBeNull();
  });
});
