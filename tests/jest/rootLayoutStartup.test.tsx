import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

let mockFontsReady = false;
const mockPrefetchHome = jest.fn<Promise<void>, unknown[]>();
const mockNavigatorMount = jest.fn();
const mockNavigatorUnmount = jest.fn();

jest.mock('expo-font', () => ({ useFonts: () => [mockFontsReady, null] }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn(async () => undefined) }));
jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Stack = Object.assign(function Navigator({ children }: { children: React.ReactNode }) {
    React.useEffect(() => { mockNavigatorMount(); return () => { mockNavigatorUnmount(); }; }, []);
    return React.createElement(View, { testID: 'startup-navigator' }, children);
  }, { Screen: () => null });
  return { Stack, ThemeProvider: ({ children }: { children: React.ReactNode }) => children };
});
jest.mock('@/store/authStore', () => ({ useAuthStore: require('zustand').create(() => ({ isLoading: true, user: null })) }));
jest.mock('@/features/home', () => ({ prefetchHome: (...args: unknown[]) => mockPrefetchHome(...args) }));
jest.mock('@/features/auth/hooks/useAuthListener', () => ({ useAuthListener: () => undefined }));
jest.mock('@/hooks/useAccountErasureRecovery', () => ({ useAccountErasureRecoveryGuard: () => undefined }));
jest.mock('@/features/auth/hooks/useConsentGuard', () => ({ useConsentGuard: () => undefined }));
jest.mock('@/features/chat/hooks/useChatListener', () => ({ useChatListener: () => undefined }));
jest.mock('@/features/notifications/hooks/useNotificationSetup', () => ({ useNotificationSetup: () => undefined }));
jest.mock('@/hooks/useDeepLinking', () => ({ useDeepLinking: () => undefined }));
jest.mock('@/hooks/useScreenTracking', () => ({ useScreenTracking: () => undefined }));
jest.mock('@/features/auth/components/AuthBottomSheet', () => () => null);
jest.mock('@/components/ui/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('@/features/sell/services/draftService', () => ({ draftService: { cleanupExpiredDrafts: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ initAnalytics: jest.fn() }));
jest.mock('@/lib/stripe', () => ({ StripeProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetModalProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

import RootLayout from '@/app/_layout';
import { useAuthStore } from '@/store/authStore';

beforeEach(() => {
  jest.clearAllMocks();
  mockFontsReady = false;
  useAuthStore.setState({ isLoading: true });
});

it('keeps startup behind the splash until fonts, home prefetch and initial auth hydration are ready', async () => {
  let finishPrefetch!: () => void;
  mockPrefetchHome.mockImplementationOnce(() => new Promise<void>(resolve => { finishPrefetch = resolve; }));
  const { rerender } = render(<RootLayout />);
  expect(screen.queryByTestId('startup-navigator')).toBeNull();
  mockFontsReady = true;
  rerender(<RootLayout />);
  expect(screen.queryByTestId('startup-navigator')).toBeNull();
  await act(async () => { finishPrefetch(); });
  expect(screen.queryByTestId('startup-navigator')).toBeNull();
  act(() => useAuthStore.setState({ isLoading: false }));
  expect(screen.getByTestId('startup-navigator')).toBeOnTheScreen();
  expect(mockNavigatorMount).toHaveBeenCalledTimes(1);
});

it('keeps the navigator mounted through foreground auth revalidation after startup', async () => {
  mockFontsReady = true;
  mockPrefetchHome.mockResolvedValueOnce(undefined);
  useAuthStore.setState({ isLoading: false });
  render(<RootLayout />);
  await act(async () => undefined);
  const navigator = screen.getByTestId('startup-navigator');
  expect(mockNavigatorMount).toHaveBeenCalledTimes(1);
  act(() => useAuthStore.setState({ isLoading: true }));
  expect(screen.getByTestId('startup-navigator')).toBe(navigator);
  expect(mockNavigatorUnmount).not.toHaveBeenCalled();
  act(() => useAuthStore.setState({ isLoading: false }));
  expect(screen.getByTestId('startup-navigator')).toBe(navigator);
  expect(mockNavigatorMount).toHaveBeenCalledTimes(1);
  expect(mockNavigatorUnmount).not.toHaveBeenCalled();
});
