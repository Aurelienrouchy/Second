import React from 'react';
import { Alert, Modal, Platform } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { auth } from '@/config/firebaseConfig';
import { useImmersiveOverlayStore } from '@/store/immersiveOverlayStore';
import type { ArticleDraft } from '@/features/sell/services/draftService';
import TabLayout from '@/app/(tabs)/_layout';

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockAdmission = jest.fn<Promise<void>, [string, () => void]>();
const mockLoadDraft = jest.fn<Promise<ArticleDraft | null>, []>();
const mockDeleteDraft = jest.fn<Promise<void>, []>();
const mockAdmissionError = jest.fn(() => true);
let mockVerified = true;

jest.mock('react-native-reanimated', () => {
  const official = jest.requireActual('react-native-reanimated/mock');
  const react = jest.requireActual<typeof import('react')>('react');
  return {
    ...official,
    Easing: {
      ...official.Easing,
      bezier: (...controlPoints: [number, number, number, number]) => ({
        factory: () => jest.requireActual<typeof import('react-native')>('react-native').Easing.bezier(...controlPoints),
      }),
    },
    useSharedValue: (initial: number) => {
      const [shared] = react.useState(() => official.useSharedValue(initial));
      return shared;
    },
  };
});
jest.mock('react-native-worklets', () => ({
  ...jest.requireActual('react-native-worklets'),
  scheduleOnRN: (callback: (...args: unknown[]) => void, ...args: unknown[]) => callback(...args),
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('@/components/ui/ImmersiveOverlay/Gradient', () => ({ Gradient: () => null }));
jest.mock('@/components/HapticTab', () => ({ HapticTab: () => null }));
jest.mock('@/components/ui/TabBarIcons', () => ({
  HomeIcon: () => null, PlusIcon: () => null, HeartIcon: () => null, MessageIcon: () => null, UserIcon: () => null,
}));
jest.mock('expo-router', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const { View, Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  const Tabs = Object.assign(({ children }: { children: React.ReactNode }) => react.createElement(View, {}, children), {
    Screen: ({ name, listeners }: { name: string; listeners?: (context: { navigation: { navigate: typeof mockNavigate } }) => { tabPress: (event: { preventDefault: () => void }) => void } }) =>
      name === 'sell' ? react.createElement(Pressable, {
        testID: 'sell-tab',
        onPress: () => listeners?.({ navigation: { navigate: mockNavigate } }).tabPress({ preventDefault: () => undefined }),
      }) : null,
  });
  return {
    Tabs,
    useRouter: () => ({ push: mockPush }),
    useFocusEffect: (callback: () => void | (() => void)) => react.useEffect(callback, [callback]),
  };
});
jest.mock('@/store/authStore', () => {
  const { create } = jest.requireActual<typeof import('zustand')>('zustand');
  return {
    getAuthSessionGeneration: () => 1,
    useAuthStore: create(() => ({ authenticatedUid: 'owner', user: { id: 'owner' } })),
  };
});
jest.mock('@/hooks/useAuth', () => ({
  useUser: () => ({ id: 'owner' }),
  useAuthenticatedUid: () => 'owner',
}));
jest.mock('@/store/chatStore', () => ({ useChatStore: () => 0, selectUnreadChatCount: () => () => 0 }));
jest.mock('@/services/authService', () => ({
  AuthService: { hasPasswordProvider: () => true, isEmailVerified: () => mockVerified },
}));
jest.mock('@/services/newSaleAdmission', () => ({
  assertSalePreparationAdmission: (uid: string, guard: () => void) => mockAdmission(uid, guard),
  eligibilityReadUnavailable: () => new Error('Eligibility unavailable'),
}));
jest.mock('@/hooks/useTradeAdmissionError', () => ({ useTradeAdmissionError: () => mockAdmissionError }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/features/sell', () => ({
  SellOverlayCapture: () => {
    const react = jest.requireActual<typeof import('react')>('react');
    return react.createElement(jest.requireActual('react-native').Text, {}, 'Capture mounted');
  },
}));
jest.mock('@/features/sell/services/draftService', () => ({
  __esModule: true,
  default: { loadDraft: () => mockLoadDraft(), deleteDraft: () => mockDeleteDraft() },
  hasDraftProgress: (draft: ArticleDraft | null) => !!draft && (draft.photos.length > 0 || draft.currentStep > 1),
  getDaysUntilExpiration: () => 14,
}));
jest.mock('@/components/PrivateStorageImage', () => ({ PrivateStorageImage: () => null }));
jest.mock('@/hooks/useFirebaseUserId', () => ({ useFirebaseUserId: () => 'owner' }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function draft(step = 1): ArticleDraft {
  return {
    id: 'draft', ownerUid: 'owner', createdAt: '2026-10-26T12:00:00Z', updatedAt: '2026-10-26T12:00:00Z',
    currentStep: step, photos: ['file:///a.jpg'], originalPhotoUris: [], storageUrls: [], fields: null, pricing: null, aiResult: null,
  };
}

// These tests exercise the actual route, trade-operation lock, overlay and store.
// Network/native implementations are controlled; admission policy is unchanged.
describe('Sell tab immediate shell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useImmersiveOverlayStore.getState().reset();
    (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'owner' };
    mockVerified = true;
    mockAdmission.mockReset().mockImplementation(async (_uid, guard) => { guard(); });
    mockLoadDraft.mockReset().mockResolvedValue(null);
    mockDeleteDraft.mockReset().mockResolvedValue(undefined);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows a shell before a suspended admission and draft read, without mounting capture', async () => {
    const admission = deferred<void>();
    const draftRead = deferred<ArticleDraft | null>();
    mockAdmission.mockImplementationOnce(() => {
      expect(useImmersiveOverlayStore.getState().isActive).toBe(true);
      return admission.promise;
    });
    mockLoadDraft.mockReturnValueOnce(draftRead.promise);
    const screen = render(<TabLayout />);
    fireEvent.press(screen.getByTestId('sell-tab'));
    expect(screen.getByTestId('immersive-overlay-layer')).toBeOnTheScreen();
    expect(screen.getByTestId('immersive-overlay-cancel')).toBeOnTheScreen();
    expect(screen.queryByText('Capture mounted')).toBeNull();
    expect(mockLoadDraft).not.toHaveBeenCalled();
    await act(async () => admission.resolve());
    expect(mockLoadDraft).toHaveBeenCalledTimes(1);
    expect(useImmersiveOverlayStore.getState().contentComponent).toBeNull();
    expect(useImmersiveOverlayStore.getState().preparedContent).toBeNull();
    await act(async () => draftRead.resolve(null));
    expect(useImmersiveOverlayStore.getState().preparedContent).toEqual(expect.any(Function));
    expect(screen.queryByText('Capture mounted')).toBeNull();
  });

  it('releases the lock on cancel so a new press can open while the old network read is still pending', async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    mockAdmission.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const screen = render(<TabLayout />);
    fireEvent.press(screen.getByTestId('sell-tab'));
    fireEvent.press(screen.getByTestId('immersive-overlay-cancel'));
    fireEvent.press(screen.getByTestId('sell-tab'));
    expect(mockAdmission).toHaveBeenCalledTimes(2);
    await act(async () => first.resolve());
    expect(mockLoadDraft).not.toHaveBeenCalled();
    expect(mockAdmissionError).not.toHaveBeenCalled();
    expect(useImmersiveOverlayStore.getState().isActive).toBe(true);
    await act(async () => second.resolve());
    expect(mockLoadDraft).toHaveBeenCalledTimes(1);
    expect(useImmersiveOverlayStore.getState().preparedContent).toEqual(expect.any(Function));
  });

  it('keeps the draft modal above one shell and admits step-one resume afresh without another entrance', async () => {
    mockLoadDraft.mockResolvedValueOnce(draft());
    const screen = render(<TabLayout />);
    fireEvent.press(screen.getByTestId('sell-tab'));
    await waitFor(() => expect(screen.getByTestId('draft-resume-button')).toBeOnTheScreen());
    const shell = screen.getByTestId('immersive-overlay-layer');
    const obsoleteModalDismiss = screen.UNSAFE_getByType(Modal).props.onRequestClose;
    expect(useImmersiveOverlayStore.getState().contentComponent).toBeNull();
    expect(useImmersiveOverlayStore.getState().preparedContent).toBeNull();
    fireEvent.press(screen.getByTestId('draft-resume-button'));
    await waitFor(() => expect(useImmersiveOverlayStore.getState().preparedContent).toEqual(expect.any(Function)));
    expect(screen.getByTestId('immersive-overlay-layer')).toBe(shell);
    expect(mockAdmission).toHaveBeenCalledTimes(2);
    expect(mockPush).not.toHaveBeenCalled();
    act(() => obsoleteModalDismiss());
    expect(useImmersiveOverlayStore.getState().isActive).toBe(true);
    expect(useImmersiveOverlayStore.getState().preparedContent).toEqual(expect.any(Function));
  });

  it('retains explicit discard confirmation and fresh admission before deleting the draft', async () => {
    mockLoadDraft.mockResolvedValueOnce(draft());
    const screen = render(<TabLayout />);
    fireEvent.press(screen.getByTestId('sell-tab'));
    await waitFor(() => expect(screen.getByTestId('draft-discard-button')).toBeOnTheScreen());
    fireEvent.press(screen.getByTestId('draft-discard-button'));
    expect(mockDeleteDraft).not.toHaveBeenCalled();
    const confirmation = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
    expect(confirmation?.[1].style).toBe('destructive');
    await act(async () => confirmation?.[1].onPress?.());
    expect(mockAdmission).toHaveBeenCalledTimes(2);
    expect(mockDeleteDraft).toHaveBeenCalledTimes(1);
    expect(useImmersiveOverlayStore.getState().preparedContent).toEqual(expect.any(Function));
  });

  it('keeps email and refusal gates before draft reads or capture, closing their own shell first', async () => {
    mockVerified = false;
    const screen = render(<TabLayout />);
    fireEvent.press(screen.getByTestId('sell-tab'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/settings/verify-email'));
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
    expect(mockLoadDraft).not.toHaveBeenCalled();

    mockVerified = true;
    const refused = new Error('Admission refused');
    mockAdmission.mockRejectedValueOnce(refused);
    fireEvent.press(screen.getByTestId('sell-tab'));
    await waitFor(() => expect(mockAdmissionError).toHaveBeenCalledWith(refused, expect.objectContaining({ retry: expect.any(Function) })));
    expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
    expect(mockLoadDraft).not.toHaveBeenCalled();
  });

  it('keeps Android on its existing guarded navigation path without mounting an iOS shell', async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    try {
      const screen = render(<TabLayout />);
      fireEvent.press(screen.getByTestId('sell-tab'));
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('sell'));
      expect(useImmersiveOverlayStore.getState().isActive).toBe(false);
      expect(mockAdmission).toHaveBeenCalledTimes(1);
      expect(mockLoadDraft).not.toHaveBeenCalled();
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
  });
});
