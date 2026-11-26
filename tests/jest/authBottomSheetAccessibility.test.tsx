import React, {createRef} from 'react';
import {Keyboard, TextInput} from 'react-native';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {useAuthSheetStore} from '@/store/authSheetStore';
import {useAuthStore} from '@/store/authStore';
import {auth} from '@/config/firebaseConfig';
import {AuthService} from '@/services/authService';
import AuthBottomSheet from '@/features/auth/components/AuthBottomSheet';
import CategoryBottomSheet, {type CategoryBottomSheetRef} from '@/components/CategoryBottomSheet';

jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, left: 0, right: 0, bottom: 0})}));
// Gorhom's native content defaults to one accessible group. Preserve that
// default here so the explicit opt-out is tested, without claiming device AX.
jest.mock('@gorhom/bottom-sheet', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const {View, ScrollView, TextInput} = jest.requireActual<typeof import('react-native')>('react-native');
  const Sheet = React.forwardRef<{close: () => void; snapToIndex: (index: number) => void}, {children?: React.ReactNode; accessible?: boolean; index?: number; onClose?: () => void}>((props, ref) => {
    const opened = React.useRef((props.index ?? -1) >= 0);
    React.useImperativeHandle(ref, () => ({snapToIndex: index => {opened.current = index >= 0;}, close: () => {if (opened.current) {opened.current = false; props.onClose?.();}}}));
    return <View testID="native-sheet-boundary" accessible={props.accessible ?? true}>{props.children}</View>;
  });
  return {__esModule: true, default: Sheet, BottomSheetBackdrop: View, BottomSheetScrollView: ScrollView, BottomSheetTextInput: TextInput};
});

beforeEach(() => {
  useAuthStore.getState().reset(); useAuthStore.setState({isLoading: false});
  Object.defineProperty(auth, 'currentUser', {configurable: true, writable: true, value: null});
  useAuthSheetStore.getState().reset();
});
afterEach(() => {cleanup(); useAuthSheetStore.getState().reset(); jest.restoreAllMocks();});

it('keeps the actual signin/signup/forgot inputs and actions outside an accessible sheet group', async () => {
  const signin = jest.spyOn(AuthService, 'signInWithEmail'), signup = jest.spyOn(AuthService, 'signUpWithEmail');
  act(() => useAuthSheetStore.getState().show('Connexion QA'));
  render(<AuthBottomSheet/>);
  const expectUngrouped = () => expect(screen.getByTestId('native-sheet-boundary').props.accessible).toBe(false);
  expectUngrouped();
  expect(screen.getByTestId('signin-email-input')).toBeOnTheScreen(); expect(screen.getByTestId('signin-password-input')).toBeOnTheScreen();
  expect(screen.getByRole('button', {name: 'Se connecter'})).toBeDisabled();
  fireEvent.changeText(screen.getByTestId('signin-email-input'), 'synthetic@example.test'); fireEvent.changeText(screen.getByTestId('signin-password-input'), 'synthetic-passphrase');
  expect(screen.getByRole('button', {name: 'Se connecter'})).toBeEnabled();
  fireEvent.press(screen.getByRole('tab', {name: "S'inscrire"})); expectUngrouped();
  expect(screen.getByTestId('signup-email-input')).toHaveDisplayValue('synthetic@example.test');
  expect(screen.getByLabelText("Nom d'affichage")).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('tab', {name: 'Se connecter'}));
  fireEvent.press(screen.getByRole('link', {name: 'Mot de passe oublié'})); expectUngrouped();
  expect(screen.getByLabelText('Adresse email')).toHaveDisplayValue('synthetic@example.test');
  expect(screen.getByRole('button', {name: 'Envoyer le lien de réinitialisation'})).toBeEnabled();
  fireEvent.press(screen.getByRole('link', {name: 'Retour à la connexion'}));
  await waitFor(() => expect(screen.getByTestId('signin-password-input')).toBeOnTheScreen());
  expect(signin).not.toHaveBeenCalled(); expect(signup).not.toHaveBeenCalled();
});

it.each(['default', 'troc'] as const)('opens the real %s category sheet after dismissing the keyboard, preserving the caller input and explicit selection', appearance => {
  const ref = createRef<CategoryBottomSheetRef>(), selected = jest.fn(), dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  render(<><TextInput value="Description conservée"/><CategoryBottomSheet ref={ref} appearance={appearance} onSelect={selected}/></>);
  expect(screen.queryByTestId('native-sheet-boundary')).toBeNull(); act(() => ref.current?.show());
  expect(dismiss).toHaveBeenCalledTimes(1); expect(screen.getByTestId('native-sheet-boundary').props.accessible).toBe(false);
  expect(screen.getByDisplayValue('Description conservée')).toBeOnTheScreen(); expect(selected).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Femmes')); expect(selected).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Choisir')); expect(selected).toHaveBeenCalledTimes(1); expect(selected).toHaveBeenCalledWith(['women']);
  expect(screen.queryByTestId('native-sheet-boundary')).toBeNull(); expect(screen.getByDisplayValue('Description conservée')).toBeOnTheScreen();
});
