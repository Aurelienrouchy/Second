/**
 * authStore — orchestration MÉTIER de la session (Zustand 5).
 *
 * Couvre les comportements observables du store APRÈS le refacto route plein
 * écran (pendingConsent + completeConsent), pas son câblage interne :
 *  - Consent gate (Loi 25) dans hydrateFromFirebase : un user Firestore SANS
 *    dateOfBirth n'est JAMAIS authentifié (user reste null) mais devient
 *    `pendingConsent` (avec pendingConsentUser) → le guard de démarrage route
 *    vers app/complete-profile.tsx. Pas de persistance USER_DATA_KEY.
 *  - hydrateFromFirebase avec dateOfBirth → user authentifié, pendingConsent
 *    effacé, persisté.
 *  - signUpWithEmail : crée un compte NU, NE signIn PAS, NE merge PAS (le flux
 *    passe par la route + completeConsent).
 *  - beginPendingConsent : pose pendingConsent + pendingConsentUser + onSuccess.
 *  - completeConsent : ORDRE STRICT recordSignupConsent → signIn → merge, puis
 *    efface pendingConsent et rejoue pendingConsentOnSuccess. Sur erreur du
 *    callable, n'authentifie PAS et ne touche pas pendingConsent.
 *  - Social sign-in : needsConsent=true ⇒ l'utilisateur N'ENTRE PAS dans l'app
 *    (pas de signIn) ; needsConsent=false ⇒ signIn + merge invité.
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
const mockSignUpWithEmail = jest.fn();
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
    signUpWithEmail: (...a: unknown[]) => mockSignUpWithEmail(...a),
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

const mockRemoveFcmToken = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('@/services/userService', () => ({
  UserService: {
    getUserById: jest.fn((..._args: unknown[]) => Promise.resolve(null)),
    removeFcmToken: (...a: unknown[]) => mockRemoveFcmToken(...a),
  },
}));

const mockQueryClientClear = jest.fn();
jest.mock('@/lib/queryClient', () => ({
  queryClient: { clear: (...a: unknown[]) => mockQueryClientClear(...a) },
}));

jest.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({ reset: jest.fn() }) },
}));
const notificationPushToken = { value: null as string | null };
jest.mock('@/store/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({ reset: jest.fn(), pushToken: notificationPushToken.value }),
  },
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
  notificationPushToken.value = null;
  await AsyncStorage.clear();
  useAuthStore.getState().reset();
});

describe('authStore.hydrateFromFirebase — consent gate Loi 25', () => {
  it('compte SANS dateOfBirth → user null MAIS pendingConsent + pendingConsentUser (pas persisté)', async () => {
    const bare = { ...CONSENTED_USER, dateOfBirth: undefined };
    mockGetCurrentUser.mockResolvedValue(bare);

    await useAuthStore.getState().hydrateFromFirebase(fbUser);

    const state = useAuthStore.getState();
    // Pas pleinement connecté, mais pas simple invité : pendingConsent route le
    // user vers app/complete-profile.tsx via le guard de démarrage.
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.pendingConsent).toBe(true);
    expect(state.pendingConsentUser?.id).toBe('uid-1');
    // Jamais de persistance d'un user non-consenti.
    expect(await AsyncStorage.getItem('user_data')).toBeNull();
  });

  it('compte AVEC dateOfBirth → authentifié, pendingConsent effacé, persisté', async () => {
    mockGetCurrentUser.mockResolvedValue(CONSENTED_USER);

    await useAuthStore.getState().hydrateFromFirebase(fbUser);

    const state = useAuthStore.getState();
    expect(state.user?.id).toBe('uid-1');
    expect(state.isLoading).toBe(false);
    expect(state.pendingConsent).toBe(false);
    expect(state.pendingConsentUser).toBeNull();
    const persisted = await AsyncStorage.getItem('user_data');
    expect(persisted).not.toBeNull();
    expect(JSON.parse(persisted as string).id).toBe('uid-1');
  });

  it('aucun firebaseUser → user null, pas de pendingConsent, session invité initialisée', async () => {
    await useAuthStore.getState().hydrateFromFirebase(null);
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(state.pendingConsent).toBe(false);
    expect(state.guestSession).not.toBeNull();
  });
});

describe('authStore.signUpWithEmail — compte NU (pas d\'entrée dans l\'app)', () => {
  it('crée le compte via AuthService MAIS ne signIn ni ne merge (route consentement à suivre)', async () => {
    const bare = { ...CONSENTED_USER, dateOfBirth: undefined };
    mockSignUpWithEmail.mockResolvedValue(bare);

    const created = await useAuthStore.getState().signUpWithEmail('m@x.com', 'pw', 'Marie');

    expect(mockSignUpWithEmail).toHaveBeenCalledWith('m@x.com', 'pw', 'Marie');
    expect(created.id).toBe('uid-1');
    // Pas authentifié : le user n'entre pas dans l'app tant que le consentement
    // n'est pas enregistré sur la route plein écran.
    expect(useAuthStore.getState().user).toBeNull();
    expect(mockMerge).not.toHaveBeenCalled();
  });
});

describe('authStore.beginPendingConsent', () => {
  it('marque pendingConsent + pendingConsentUser + onSuccess sans authentifier', () => {
    const bare = { ...CONSENTED_USER, dateOfBirth: undefined };
    const onSuccess = jest.fn();

    useAuthStore.getState().beginPendingConsent(bare, onSuccess);

    const state = useAuthStore.getState();
    expect(state.pendingConsent).toBe(true);
    expect(state.pendingConsentUser?.id).toBe('uid-1');
    expect(state.pendingConsentOnSuccess).toBe(onSuccess);
    expect(state.user).toBeNull();
  });
});

describe('authStore.completeConsent — ordre strict réserve → signIn → merge', () => {
  it('orchestre recordSignupConsent puis signIn puis merge, dans CET ordre', async () => {
    const order: string[] = [];
    mockRecordConsent.mockImplementation(() => {
      order.push('record');
      return Promise.resolve(CONSENTED_USER);
    });
    mockMerge.mockImplementation(() => {
      order.push('merge');
      return Promise.resolve();
    });

    const fresh = await useAuthStore.getState().completeConsent({
      dateOfBirth: '1995-01-01',
      acceptedTerms: true,
      acceptedPrivacy: true,
      marketingOptIn: false,
      desiredUsername: 'anna',
    });

    expect(order).toEqual(['record', 'merge']);
    expect(mockRecordConsent).toHaveBeenCalled();
    expect(mockMerge).toHaveBeenCalledWith('uid-1');
    expect(fresh.id).toBe('uid-1');
    // signIn (entre record et merge) a flippé authentifié + effacé pendingConsent.
    const state = useAuthStore.getState();
    expect(state.user?.id).toBe('uid-1');
    expect(state.pendingConsent).toBe(false);
    expect(state.pendingConsentUser).toBeNull();
  });

  it('rejoue puis nettoie pendingConsentOnSuccess à la complétion', async () => {
    mockRecordConsent.mockResolvedValue(CONSENTED_USER);
    const onSuccess = jest.fn();
    useAuthStore.getState().beginPendingConsent(
      { ...CONSENTED_USER, dateOfBirth: undefined },
      onSuccess,
    );

    await useAuthStore.getState().completeConsent({
      dateOfBirth: '1995-01-01',
      acceptedTerms: true,
      acceptedPrivacy: true,
      marketingOptIn: false,
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    // Nettoyé : pas de rejouage au prochain completeConsent.
    expect(useAuthStore.getState().pendingConsentOnSuccess).toBeNull();
  });

  it('erreur du callable (pseudo pris) → N\'authentifie PAS, ne merge PAS, propage l\'erreur', async () => {
    const takenError = Object.assign(new Error('taken'), {
      code: 'already-exists',
      details: { field: 'username' },
    });
    mockRecordConsent.mockRejectedValue(takenError);
    useAuthStore.getState().beginPendingConsent(
      { ...CONSENTED_USER, dateOfBirth: undefined },
      null,
    );

    await expect(
      useAuthStore.getState().completeConsent({
        dateOfBirth: '1995-01-01',
        acceptedTerms: true,
        acceptedPrivacy: true,
        marketingOptIn: false,
        desiredUsername: 'prise',
      }),
    ).rejects.toMatchObject({ code: 'already-exists' });

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(mockMerge).not.toHaveBeenCalled();
    // pendingConsent intact : l'user re-soumet avec un autre pseudo.
    expect(state.pendingConsent).toBe(true);
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

// @deprecated — remplacé par completeConsent (route plein écran). Conservé tant
// que le shim AuthContext l'expose : on vérifie qu'il reste fonctionnel.
describe('authStore.recordSocialConsent (shim déprécié)', () => {
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

// @deprecated — le nouveau flux ne rollback plus à la fermeture (pendingConsent
// + guard ramène à la route). Conservé pour le shim : on vérifie le filet.
describe('authStore.rollbackSocialSignIn (shim déprécié)', () => {
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

describe('authStore.signOut — teardown complet et robuste', () => {
  it('efface user, USER_DATA_KEY, Firebase et query cache', async () => {
    await useAuthStore.getState().signIn(CONSENTED_USER);
    expect(await AsyncStorage.getItem('user_data')).not.toBeNull();

    await useAuthStore.getState().signOut();

    expect(mockAuthSignOut).toHaveBeenCalled();
    expect(mockQueryClientClear).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('user_data')).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('un échec de removeFcmToken NE bloque PAS la suite du teardown', async () => {
    notificationPushToken.value = 'push-token-1';
    mockRemoveFcmToken.mockRejectedValueOnce(new Error('permission-denied'));
    await useAuthStore.getState().signIn(CONSENTED_USER);

    await useAuthStore.getState().signOut();

    expect(mockRemoveFcmToken).toHaveBeenCalledWith('uid-1', 'push-token-1');
    expect(mockAuthSignOut).toHaveBeenCalled();
    expect(await AsyncStorage.getItem('user_data')).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
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
