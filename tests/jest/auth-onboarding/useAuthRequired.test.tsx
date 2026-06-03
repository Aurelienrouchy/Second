/**
 * useAuthRequired — gating MÉTIER d'une action derrière l'authentification.
 *
 * Comportement observable :
 *  - utilisateur connecté → requireAuth exécute l'action immédiatement et
 *    retourne true, SANS ouvrir la bottom sheet.
 *  - invité → requireAuth N'exécute PAS l'action, retourne false, et ouvre la
 *    bottom sheet avec l'action en callback de succès (le message est transmis).
 *  - isLoggedIn reflète la présence d'un user.
 *
 * On pilote l'état d'auth via le vrai store (authStore) pour exercer le vrai
 * câblage useUser/useIsLoading. La sheet est observée via authSheetStore.
 */

const mockMerge = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('@/services/authMergeService', () => ({
  mergeGuestDataIntoUser: (...a: unknown[]) => mockMerge(...a),
}));
jest.mock('@/services/guestPreferencesService', () => ({
  guestPreferencesService: {
    getGuestSession: jest.fn((..._args: unknown[]) => Promise.resolve(null)),
    createGuestSession: jest.fn((..._args: unknown[]) => Promise.resolve({ guestId: 'g' })),
    clearGuestSession: jest.fn((..._args: unknown[]) => Promise.resolve()),
  },
}));
jest.mock('@/services/userService', () => ({
  UserService: { getUserById: jest.fn(), removeFcmToken: jest.fn() },
}));
jest.mock('@/services/authService', () => ({ AuthService: {} }));
jest.mock('@/lib/queryClient', () => ({ queryClient: { clear: jest.fn() } }));
jest.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('@/store/notificationStore', () => ({
  useNotificationStore: { getState: () => ({ reset: jest.fn(), pushToken: null }) },
}));
jest.mock('@/store/immersiveOverlayStore', () => ({
  useImmersiveOverlayStore: { getState: () => ({ reset: jest.fn() }) },
}));

import { act, renderHook } from '@testing-library/react-native';

import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useAuthStore } from '@/store/authStore';
import { useAuthSheetStore } from '@/store/authSheetStore';
import type { User } from '@/types';

const USER: User = {
  id: 'u-1',
  email: 'a@b.com',
  displayName: 'Anna',
  createdAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ user: null, isLoading: false });
  useAuthSheetStore.getState().reset();
});

describe('useAuthRequired — invité', () => {
  it('isLoggedIn=false et requireAuth N\'exécute PAS l\'action, ouvre la sheet', () => {
    const { result } = renderHook(() => useAuthRequired());
    expect(result.current.isLoggedIn).toBe(false);

    const action = jest.fn();
    let returned: boolean | undefined;
    act(() => {
      returned = result.current.requireAuth(action, 'Connectez-vous pour liker');
    });

    expect(returned).toBe(false);
    expect(action).not.toHaveBeenCalled();
    // La sheet s'ouvre, le message est transmis, et l'action devient le
    // callback de succès (exécutée après login).
    const sheet = useAuthSheetStore.getState();
    expect(sheet.isVisible).toBe(true);
    expect(sheet.message).toBe('Connectez-vous pour liker');
    expect(sheet.onSuccess).toBe(action);
  });

  it('showAuthSheet ouvre la sheet avec message + callback', () => {
    const { result } = renderHook(() => useAuthRequired());
    const onSuccess = jest.fn();
    act(() => {
      result.current.showAuthSheet('Inscris-toi', onSuccess);
    });
    const sheet = useAuthSheetStore.getState();
    expect(sheet.isVisible).toBe(true);
    expect(sheet.message).toBe('Inscris-toi');
    expect(sheet.onSuccess).toBe(onSuccess);
  });
});

describe('useAuthRequired — connecté', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: USER, isLoading: false });
  });

  it('isLoggedIn=true et requireAuth exécute l\'action immédiatement SANS sheet', () => {
    const { result } = renderHook(() => useAuthRequired());
    expect(result.current.isLoggedIn).toBe(true);

    const action = jest.fn();
    let returned: boolean | undefined;
    act(() => {
      returned = result.current.requireAuth(action);
    });

    expect(returned).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    expect(useAuthSheetStore.getState().isVisible).toBe(false);
  });

  it('expose le user courant', () => {
    const { result } = renderHook(() => useAuthRequired());
    expect(result.current.user?.id).toBe('u-1');
  });
});
