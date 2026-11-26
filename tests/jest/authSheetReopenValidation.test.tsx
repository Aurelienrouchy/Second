import React from 'react';
import {Alert} from 'react-native';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {useAuthSheetStore} from '@/store/authSheetStore';
import {useAuthStore} from '@/store/authStore';
import {auth} from '@/config/firebaseConfig';
import {AuthService} from '@/services/authService';
import AuthBottomSheet from '@/features/auth/components/AuthBottomSheet';

jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, left: 0, right: 0, bottom: 0})}));
// Native boundary only: closed Gorhom sheets keep their React children mounted.
// onNativeClose models its swipe/backdrop close callback, using the real store.
jest.mock('@gorhom/bottom-sheet', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const {View, ScrollView, TextInput} = jest.requireActual<typeof import('react-native')>('react-native');
  const Sheet = React.forwardRef<{close: () => void; snapToIndex: (index: number) => void}, {children?: React.ReactNode; onClose?: () => void}>((props, ref) => {
    const opened = React.useRef(false);
    const close = () => {if (opened.current) {opened.current = false; props.onClose?.();}};
    React.useImperativeHandle(ref, () => ({snapToIndex: index => {opened.current = index >= 0;}, close}));
    // Synthetic native callback exists only at this test's Gorhom boundary.
    const NativeBoundary = View as unknown as React.ComponentType<React.ComponentProps<typeof View> & {onNativeClose: () => void}>;
    return <NativeBoundary testID="native-auth-sheet" onNativeClose={close}>{props.children}</NativeBoundary>;
  });
  return {__esModule: true, default: Sheet, BottomSheetBackdrop: View, BottomSheetScrollView: ScrollView, BottomSheetTextInput: TextInput};
});

beforeEach(() => {
  useAuthStore.getState().reset(); useAuthStore.setState({isLoading: false});
  Object.defineProperty(auth, 'currentUser', {configurable: true, writable: true, value: null});
  useAuthSheetStore.getState().reset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {cleanup(); useAuthSheetStore.getState().reset(); jest.restoreAllMocks();});
function open() {act(() => useAuthSheetStore.getState().show('Connexion QA'));}
function close() {fireEvent(screen.getByTestId('native-auth-sheet'), 'nativeClose');}
function enterValid() {
  fireEvent.changeText(screen.getByTestId('signin-email-input'), 'synthetic@example.test');
  fireEvent.changeText(screen.getByTestId('signin-password-input'), 'synthetic-passphrase');
  fireEvent(screen.getByTestId('signin-email-input'), 'blur');
  fireEvent(screen.getByTestId('signin-password-input'), 'blur');
}
function expectPristine() {
  expect(screen.getByTestId('signin-email-input')).toHaveDisplayValue('');
  expect(screen.getByTestId('signin-password-input')).toHaveDisplayValue('');
  expect(screen.queryByText('Adresse email invalide')).toBeNull();
  expect(screen.queryByText('6 caractères minimum')).toBeNull();
}

it('reopens a failed signin with blank untouched fields and no new auth request', async () => {
  const signin = jest.spyOn(AuthService, 'signInWithEmail').mockRejectedValueOnce(new Error('Email ou mot de passe incorrect'));
  open(); render(<AuthBottomSheet/>); expectPristine(); enterValid();
  fireEvent.press(screen.getByRole('button', {name: 'Se connecter'}));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Erreur', 'Email ou mot de passe incorrect'));
  expect(screen.queryByText('Adresse email invalide')).toBeNull();
  close(); expect(useAuthSheetStore.getState().isVisible).toBe(false);
  open(); expectPristine();
  expect(screen.getByRole('button', {name: 'Se connecter'})).toBeDisabled();
  expect(signin).toHaveBeenCalledTimes(1);
});
it('keeps current-opening field validation and the actual provider failure visible', async () => {
  const signin = jest.spyOn(AuthService, 'signInWithEmail').mockRejectedValueOnce(new Error('Email ou mot de passe incorrect'));
  open(); render(<AuthBottomSheet/>);
  fireEvent.changeText(screen.getByTestId('signin-email-input'), 'bad');
  fireEvent.changeText(screen.getByTestId('signin-password-input'), '1');
  fireEvent(screen.getByTestId('signin-email-input'), 'blur');
  fireEvent(screen.getByTestId('signin-password-input'), 'blur');
  expect(screen.getByText('Adresse email invalide')).toBeOnTheScreen();
  expect(screen.getByText('6 caractères minimum')).toBeOnTheScreen();
  expect(signin).not.toHaveBeenCalled(); enterValid();
  fireEvent.press(screen.getByRole('button', {name: 'Se connecter'}));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Erreur', 'Email ou mot de passe incorrect'));
  expect(signin).toHaveBeenCalledTimes(1);
});
it('does not start concurrent auth or publish a previous-opening error after close and reopen', async () => {
  let fail!: (error: Error) => void;
  const signin = jest.spyOn(AuthService, 'signInWithEmail').mockImplementationOnce(() => new Promise((_resolve, reject) => {fail = reject;}));
  open(); render(<AuthBottomSheet/>); enterValid(); fireEvent.press(screen.getByRole('button', {name: 'Se connecter'}));
  await waitFor(() => expect(signin).toHaveBeenCalledTimes(1)); close(); open(); enterValid();
  expect(screen.getByRole('button', {name: 'Se connecter'})).toBeDisabled();
  fireEvent.press(screen.getByRole('button', {name: 'Se connecter'})); expect(signin).toHaveBeenCalledTimes(1);
  await act(async () => {fail(new Error('Erreur de la précédente ouverture'));});
  await waitFor(() => expect(screen.getByRole('button', {name: 'Se connecter'})).toBeEnabled());
  expect(Alert.alert).not.toHaveBeenCalled(); expect(signin).toHaveBeenCalledTimes(1);
});
