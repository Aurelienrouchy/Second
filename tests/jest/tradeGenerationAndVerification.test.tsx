import React from 'react';
import {act, render, renderHook, screen, waitFor} from '@testing-library/react-native';
import {auth} from '@/config/firebaseConfig';
import {useAuthStore} from '@/store/authStore';
import {AuthService} from '@/services/authService';
let mockGeneration = 1;
const mockFocusCallbacks: Array<() => (() => void)> = [];
jest.mock('@/store/authStore', () => ({
  // A real Zustand subscription publishes a new snapshot with identical user,
  // UID and dossier. Only the generation getter changes its selected value.
  useAuthStore: require('zustand').create(() => ({user: {id: 'A', email: 'a@example.test'}, authenticatedUid: 'A', identityUser: {id: 'A'}, isLoading: false, signal: 0})),
  getAuthSessionGeneration: () => mockGeneration,
}));
jest.mock('expo-router', () => ({useRouter: () => ({back: jest.fn()}),
  useFocusEffect: (callback: () => (() => void)) => {mockFocusCallbacks.push(callback);}}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('@/services/authService', () => ({AuthService: {reloadUser: jest.fn(async () => undefined), isEmailVerified: jest.fn(() => true), sendEmailVerification: jest.fn(async () => undefined)}}));
jest.mock('@/components/ui', () => ({Text: jest.requireActual('@/components/ui/Text').Text, Caption: jest.requireActual('@/components/ui/Text').Caption,
  Button: jest.requireActual('@/components/ui/Button').Button, ScreenHeader: jest.requireActual('@/components/ui/ScreenHeader').ScreenHeader}));
import {useTradeOperation} from '@/hooks/useTradeOperation';
import VerifyEmailScreen from '@/app/settings/verify-email';
beforeEach(() => {
  mockGeneration = 1; mockFocusCallbacks.length = 0; jest.clearAllMocks(); useAuthStore.setState({isLoading: false});
  Object.defineProperty(auth, 'currentUser', {value: {uid: 'A'}, configurable: true, writable: true});
});
it('renews the operation from a native store generation emission without any parent or profile rerender', async () => {
  const {result} = renderHook(() => useTradeOperation('unchanged-dossier', 'A'));
  act(() => {mockFocusCallbacks[0]();});
  const oldCallback = result.current.capture, oldOperation = oldCallback(), profile = useAuthStore.getState().user;
  act(() => {mockGeneration++; useAuthStore.setState({isLoading: true});});
  expect(useAuthStore.getState().user).toBe(profile);
  expect(() => oldCallback()).toThrow(); expect(result.current.isCurrent(oldOperation)).toBe(false);
  await waitFor(() => expect(result.current.frame).not.toBe(oldOperation.frame));
  expect(result.current.capture().session.generation).toBe(mockGeneration);
});
it('starts one verification read on first focus after a refused pre-focus mount and avoids state-update loops', async () => {
  const view = render(<VerifyEmailScreen/>);
  expect(AuthService.reloadUser).not.toHaveBeenCalled();
  let blur!: () => void; act(() => {blur = mockFocusCallbacks[0]();});
  await waitFor(() => expect(AuthService.reloadUser).toHaveBeenCalledTimes(1));
  await screen.findByText('Email vérifié');
  view.rerender(<VerifyEmailScreen/>);
  expect(AuthService.reloadUser).toHaveBeenCalledTimes(1);
  act(() => {blur(); mockFocusCallbacks[0]();});
  await waitFor(() => expect(AuthService.reloadUser).toHaveBeenCalledTimes(2));
});
