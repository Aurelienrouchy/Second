import React from 'react';
import {Alert, AppState} from 'react-native';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {MutationCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {GoogleSignin} from '@react-native-google-signin/google-signin';
import {reauthenticateWithCredential} from 'firebase/auth';
import {auth} from '@/config/firebaseConfig';
import {useAuthStore} from '@/store/authStore';
import type {StripeAccountStatus} from '@/features/wallet/utils/stripeRequirements';

let mockGeneration = 1;
const mockCreate = jest.fn(), mockMutationError = jest.fn();
const mockReplaceBank = jest.fn();
const mockRecoveryPanel = jest.fn(() => null);
const mockRefetch = jest.fn();
let mockHasAccount = false;
let mockBankFetching = false;
let mockStripeStatus: StripeAccountStatus | undefined;
let mockRouteParams: {from?: string; articleId?: string; intent?: string} = {};
const mockRouter = {back: jest.fn(), replace: jest.fn(), push: jest.fn()};
const mockFocusCleanups = new Set<() => void>();
const mockProfile = {id: 'seller', displayName: 'Jean Test', dateOfBirth: '1990-01-01', username: 'seller'};
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  const store = create(() => ({authenticatedUid: 'seller', user: mockProfile, identityUser: mockProfile, isLoading: false,
    bootstrap: async () => undefined, hydrateFromFirebase: jest.fn(async (user: {uid: string} | null) => {
      mockGeneration++; store.setState({authenticatedUid: user?.uid ?? null, user: {...mockProfile}, identityUser: {...mockProfile}});
    }), signOut: async () => {mockGeneration++; store.setState({authenticatedUid: null});},
  }));
  return {getAuthSessionGeneration: () => mockGeneration, useAuthStore: store};
});
jest.mock('expo-application', () => ({applicationId: 'com.seconde.app.dev'}));
jest.mock('@react-native-google-signin/google-signin', () => ({GoogleSignin: {
  configure: jest.fn(), hasPlayServices: jest.fn(async () => true), signIn: jest.fn(), signOut: jest.fn(),
}}));
jest.mock('expo-apple-authentication', () => ({isAvailableAsync: jest.fn(async () => true), signInAsync: jest.fn()}));
jest.mock('firebase/auth', () => ({reauthenticateWithCredential: jest.fn(async () => undefined),
  GoogleAuthProvider: {credential: jest.fn(() => ({providerId: 'google.com'}))}, onAuthStateChanged: jest.fn(() => jest.fn()),
}));
jest.mock('firebase/functions', () => ({httpsCallable: (_functions: unknown, name: string) => (input: unknown) => mockCreate(name, input)}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@/components/ConnectIdentityRecoveryPanel', () => ({ConnectIdentityRecoveryPanel: () => mockRecoveryPanel()}));
jest.mock('@/features/wallet/components/WithdrawalTimingNotice', () => ({WithdrawalTimingNotice: () => null}));
jest.mock('@/features/wallet/hooks/useStripeAccount', () => ({useStripeAccount: (_uid: unknown, _enabled: unknown, _assert: unknown, _key: unknown, options?: {includeBankAccounts?: boolean}) => ({
  status: mockStripeStatus ?? {success: true, hasAccount: mockHasAccount, requirementsCurrentlyDue: [], requirementsPastDue: [], verificationErrors: [], requirementsPendingVerification: [], bankAccounts: [], bankAccountsAvailable: true},
  isLoading: false, isFetching: !!options?.includeBankAccounts && mockBankFetching, isError: false, refetch: mockRefetch,
  replaceBankAccount: (...args: unknown[]) => mockReplaceBank(...args),
})}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: true, DEV_COMMERCE_TESTING_ENABLED: true}));
jest.mock('expo-router', () => ({useRouter: () => mockRouter, useLocalSearchParams: () => mockRouteParams,
  Link: ({children}: {children: React.ReactNode}) => {const React = require('react'), {Text} = require('react-native'); return React.createElement(Text, null, children);}, Stack: {Screen: () => null},
  Redirect: ({href}: {href: unknown}) => {mockRouter.replace(href); return null;},
  useFocusEffect: (effect: () => void | (() => void)) => {const React = require('react'); React.useEffect(() => {
    const cleanup = effect(); if (cleanup) mockFocusCleanups.add(cleanup);
    return () => {if (cleanup) {mockFocusCleanups.delete(cleanup); cleanup();}};
  }, [effect]);},
}));
jest.mock('@/components/ui', () => {
  const React = require('react'), {Pressable, Text, View} = require('react-native');
  return {Text, ScreenHeader: () => null, Skeleton: () => null,
    Checkbox: ({checked, onToggle, children, disabled}: {checked: boolean; onToggle: () => void; children: React.ReactNode; disabled?: boolean}) =>
      React.createElement(Pressable, {accessibilityRole: 'checkbox', accessibilityState: {checked}, onPress: onToggle, disabled}, React.createElement(View, null, children)),
    Button: ({children, onPress, disabled}: {children: React.ReactNode; onPress: () => void; disabled?: boolean}) =>
      React.createElement(Pressable, {onPress, disabled}, React.createElement(Text, null, children)),
  };
});
import StripeOnboarding from '@/app/settings/stripe-onboarding';
import {useAuthListener} from '@/features/auth/hooks/useAuthListener';
import {AuthService} from '@/services/authService';
import BankAccount from '@/app/settings/bank-account';
import AsyncStorage from '@/utils/environmentStorage';

const listeners = new Set<(state: 'active' | 'inactive' | 'background') => unknown>();
const firebaseUser = () => ({uid: 'seller', email: 'seller@example.test', providerData: [{providerId: 'google.com'}],
  reload: jest.fn(async () => undefined), getIdToken: jest.fn(async () => 'fresh-token')});
async function activity(state: 'active' | 'inactive' | 'background') {
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: state});
  await act(async () => {await Promise.all([...listeners].map(listener => listener(state)));});
}
function Subject() {useAuthListener(); return <StripeOnboarding/>;}
let client: QueryClient;
beforeEach(async () => {
  await AsyncStorage.getAllKeys().then(keys => Promise.all(keys.map(key => AsyncStorage.removeItem(key))));
  mockGeneration = 1; mockHasAccount = false; mockBankFetching = false; mockStripeStatus = undefined; mockRouteParams = {}; listeners.clear(); mockFocusCleanups.clear();
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  (auth as unknown as {currentUser: ReturnType<typeof firebaseUser> | null}).currentUser = firebaseUser();
  useAuthStore.setState({authenticatedUid: 'seller', user: mockProfile as never, identityUser: mockProfile as never});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {listeners.add(listener); return {remove: () => listeners.delete(listener)};});
  jest.spyOn(AuthService, 'initialize').mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockRefetch.mockResolvedValue({isError: false, status: 'success', fetchStatus: 'idle', data: {success: true, hasAccount: false}});
  mockCreate.mockResolvedValue({data: {success: true, stripeAccountId: 'acct_test', chargesEnabled: false, payoutsEnabled: false, status: 'pending', requirements: []}});
  mockReplaceBank.mockImplementation(async ({input, assertCurrent}: {input: {requestId: string}; assertCurrent: () => void}) => {
    assertCurrent(); return {success: true, requestId: input.requestId, action: null};
  });
  client = new QueryClient({mutationCache: new MutationCache({onError: mockMutationError}), defaultOptions: {queries: {retry: false, gcTime: 0}, mutations: {retry: false, gcTime: 0}}});
});
afterEach(() => {client.clear(); jest.restoreAllMocks();});
async function submit() {
  const view = render(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);
  fireEvent.press(screen.getByText('Utiliser des renseignements de test'));
  fireEvent.press(screen.getByText('Configurer mon compte de paiement'));
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.press(checkbox);
  fireEvent.press(screen.getByText('Confirmer et configurer'));
  return view;
}
const successfulGoogleReturn = async () => {
  await activity('inactive'); await activity('active');
  return {type: 'success', data: {idToken: 'google-test'}} as never;
};
it('continues real Google reauthentication after its native foreground return without losing the consent or creating twice', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  await submit();
  await waitFor(() => {
    const failure = mockMutationError.mock.calls[0]?.[0];
    if (failure) throw failure;
    expect(mockCreate).toHaveBeenCalledWith('createStripeConnectAccount', expect.objectContaining({expectedUid: 'seller',
    transitNumber: '11000', institutionNumber: '000', accountNumber: '000123456789', bankOwnershipAccepted: true,
    paymentAccountConsent: expect.objectContaining({accepted: true}),
  }));});
  expect(reauthenticateWithCredential).toHaveBeenCalledTimes(1);
  expect(mockCreate).toHaveBeenCalledTimes(1); expect(mockMutationError).not.toHaveBeenCalled();
});

it('does not dispatch Connect after Google cancellation', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(async () => {
    await activity('inactive'); await activity('active'); return {type: 'cancelled'} as never;
  });
  await submit();
  await waitFor(() => expect(mockMutationError).toHaveBeenCalled());
  expect(mockCreate).not.toHaveBeenCalled(); expect(reauthenticateWithCredential).not.toHaveBeenCalled();
});

it.each(['another-owner', 'same-owner-new-login', 'navigation'])('rejects an actual context change while Google is open: %s', async change => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(async () => {
    await activity('inactive');
    await act(async () => {
      if (change === 'navigation') {for (const cleanup of [...mockFocusCleanups]) cleanup();}
      else {
        (auth as unknown as {currentUser: ReturnType<typeof firebaseUser> | null}).currentUser = null;
        mockGeneration++; useAuthStore.setState({authenticatedUid: null});
        const next = {...firebaseUser(), uid: change === 'another-owner' ? 'other' : 'seller'};
        (auth as unknown as {currentUser: typeof next}).currentUser = next;
        mockGeneration++; useAuthStore.setState({authenticatedUid: next.uid});
      }
    });
    await activity('active'); return {type: 'success', data: {idToken: 'google-test'}} as never;
  });
  await submit();
  await waitFor(() => expect(mockMutationError).toHaveBeenCalled());
  expect(mockCreate).not.toHaveBeenCalled(); expect(reauthenticateWithCredential).not.toHaveBeenCalled();
});

it('keeps the normal foreground session invalidation outside an expected native challenge', async () => {
  render(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);
  fireEvent.press(screen.getByText('Utiliser des renseignements de test'));
  fireEvent.press(screen.getByText('Configurer mon compte de paiement'));
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.press(checkbox);
  await activity('background'); await activity('active');
  expect(mockGeneration).toBeGreaterThan(1);
  expect(screen.getAllByRole('checkbox').at(-1)?.props.accessibilityState.checked).toBe(false);
  expect(mockCreate).not.toHaveBeenCalled();
});

it('keeps the bank form bound to its original request during the same native Google return', async () => {
  mockHasAccount = true;
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  function BankSubject() {useAuthListener(); return <StripeOnboarding/>;}
  render(<QueryClientProvider client={client}><BankSubject/></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Ajouter un compte bancaire')).toBeTruthy());
  fireEvent.press(screen.getByText('Ajouter un compte bancaire'));
  fireEvent.changeText(screen.getByPlaceholderText('Nom figurant sur le compte'), 'Jean Test');
  fireEvent.changeText(screen.getByPlaceholderText('12345'), '11000');
  fireEvent.changeText(screen.getByPlaceholderText('001'), '000');
  fireEvent.changeText(screen.getByPlaceholderText('1234567'), '000123456789');
  fireEvent.press(screen.getByText('Continuer'));
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByText('Confirmer'));
  await waitFor(() => expect(mockReplaceBank).toHaveBeenCalledWith(expect.objectContaining({input: expect.objectContaining({
    transitNumber: '11000', institutionNumber: '000', accountNumber: '000123456789', bankOwnershipAccepted: true,
  })})));
  expect(mockReplaceBank).toHaveBeenCalledTimes(1); expect(reauthenticateWithCredential).toHaveBeenCalledTimes(1);
});

it('keeps the in-memory form and choices after confirmed input rejection, then submits only the corrected input on another click', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  mockCreate.mockRejectedValueOnce(Object.assign(new Error('Le numéro de transit doit être corrigé.'), {code: 'functions/invalid-argument'}));
  await submit();
  await waitFor(() => expect(mockMutationError).toHaveBeenCalledTimes(1));
  expect(screen.getByPlaceholderText('12345').props.value).toBe('11000');
  expect(screen.getByPlaceholderText('001').props.value).toBe('000');
  expect(screen.getByPlaceholderText('1234567').props.value).toBe('000123456789');
  expect(screen.getByPlaceholderText('Nom figurant sur le compte').props.value).toBe('Jean Test');
  fireEvent.press(screen.getByText('Configurer mon compte de paiement'));
  expect(screen.getAllByRole('checkbox').every(checkbox => checkbox.props.accessibilityState.checked)).toBe(true);
  fireEvent.changeText(screen.getByPlaceholderText('12345'), '12346');
  fireEvent.press(screen.getAllByRole('checkbox')[0]);
  fireEvent.press(screen.getByText('Confirmer et configurer'));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  expect(mockCreate.mock.calls[1][1]).toEqual(expect.objectContaining({transitNumber: '12346', expectedUid: 'seller'}));
});

it.each([
  ['an unresolved creation', {isError: false, status: 'success', fetchStatus: 'idle', data: {
    success: true, hasAccount: false, connectActionRequired: true, connectOperationState: 'unknown',
  }}],
  ['unqualified absence', {isError: false, status: 'success', fetchStatus: 'idle', data: {
    success: true, hasAccount: false, connectActionRequired: false,
  }}],
  ['a failed refresh with previous ready data', {isError: true, status: 'error', fetchStatus: 'idle', data: {
    success: true, hasAccount: false, connectActionRequired: false, connectCreationReady: true,
  }}],
])('preserves an unknown INTERNAL outcome without a new POST after %s', async (_label, result) => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  mockCreate.mockRejectedValueOnce(Object.assign(new Error('INTERNAL'), {code: 'functions/internal'}));
  mockRefetch.mockResolvedValue(result);
  await submit();
  await waitFor(() => expect(mockMutationError).toHaveBeenCalledTimes(1));
  expect(mockMutationError.mock.calls[0][0].message).toContain('Votre saisie est conservée');
  expect(screen.getByPlaceholderText('1234567').props.value).toBe('000123456789');
  expect(screen.getByPlaceholderText('1234567').props.editable).toBe(false);
  fireEvent.press(screen.getByText('Configurer mon compte de paiement'));
  fireEvent.press(screen.getByText('Actualiser le statut'));
  await waitFor(() => expect(mockRefetch).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByText('Configurer mon compte de paiement'));
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

it('allows another explicit click only after a fresh server-qualified absence, preserving the current input and choices', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  mockCreate.mockRejectedValueOnce(Object.assign(new Error('Indisponible'), {code: 'functions/unavailable',
    details: {reason: 'connect_service_unavailable', action: 'getStripeAccountStatus'}}));
  mockRefetch.mockResolvedValue({isError: false, status: 'success', fetchStatus: 'idle', data: {
    success: true, hasAccount: false, connectActionRequired: false, connectCreationReady: true,
  }});
  await submit();
  await waitFor(() => expect(mockMutationError).toHaveBeenCalledTimes(1));
  expect(screen.getByPlaceholderText('1234567').props.editable).toBe(false);
  fireEvent.press(screen.getByText('Actualiser le statut'));
  await waitFor(() => expect(screen.getByPlaceholderText('1234567').props.editable).toBe(true));
  expect(screen.getByPlaceholderText('1234567').props.value).toBe('000123456789');
  fireEvent.press(screen.getByText('Configurer mon compte de paiement'));
  expect(screen.getAllByRole('checkbox').every(checkbox => checkbox.props.accessibilityState.checked)).toBe(true);
  expect(mockCreate).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Confirmer et configurer'));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  expect(mockCreate.mock.calls[1][1]).toEqual(mockCreate.mock.calls[0][1]);
});

it('purges retained bank input when leaving the screen after a server rejection', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  mockCreate.mockRejectedValueOnce(Object.assign(new Error('Adresse à corriger.'), {code: 'functions/invalid-argument'}));
  await submit();
  await waitFor(() => expect(mockMutationError).toHaveBeenCalledTimes(1));
  await act(async () => {for (const cleanup of [...mockFocusCleanups]) cleanup();});
  expect(screen.getByPlaceholderText('12345').props.value).toBe('');
  expect(screen.getByPlaceholderText('1234567').props.value).toBe('');
  expect(mockCreate).toHaveBeenCalledTimes(1);
});

const pendingStripeAccount: StripeAccountStatus = {
  success: true, hasAccount: true, status: 'pending_verification', chargesEnabled: true, payoutsEnabled: false,
  payoutEligible: false, detailsSubmitted: true, disabledReason: 'requirements.pending_verification', currentDeadline: null,
  requirementsCurrentlyDue: [], requirementsPastDue: [], requirementsPendingVerification: [], verificationErrors: [], bankAccountLast4: '6789',
};
const activeStripeAccount: StripeAccountStatus = {...pendingStripeAccount, status: 'active', payoutsEnabled: true, payoutEligible: true, disabledReason: null};

it('keeps the ordinary page free of agreements and sends nothing until the dedicated conditions are explicitly confirmed', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  render(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);
  expect(screen.queryByText('Accord sur les comptes connectés Stripe')).toBeNull();
  expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  fireEvent.press(screen.getByText('Utiliser des renseignements de test'));
  fireEvent.press(screen.getByText('Configurer mon compte de paiement'));
  expect(screen.getByText('Accord sur les comptes connectés Stripe')).toBeTruthy();
  expect(screen.getAllByRole('checkbox').every(checkbox => !checkbox.props.accessibilityState.checked)).toBe(true);
  fireEvent.press(screen.getByText('Confirmer et configurer'));
  expect(mockCreate).not.toHaveBeenCalled();
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.press(checkbox);
  expect(mockCreate).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Confirmer et configurer'));
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
});

it('does not navigate back when consulting an already active payment account', async () => {
  mockStripeStatus = activeStripeAccount;
  mockRouteParams = {from: 'shipping-preparation', articleId: 'article_one', intent: 'manage'};
  render(<QueryClientProvider client={client}><StripeOnboarding/></QueryClientProvider>);
  await act(async () => undefined);
  expect(screen.getByText('Votre compte est actif')).toBeTruthy();
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRefetch).not.toHaveBeenCalled();
});

it('returns to preparation only after a configuration submitted here and a fresh confirmed active read', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  mockRouteParams = {from: 'shipping-preparation', articleId: 'article_one', intent: 'setup'};
  mockRefetch.mockResolvedValue({isError: false, fetchStatus: 'idle', data: activeStripeAccount});
  const view = await submit();
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockRouter.back).not.toHaveBeenCalled();
  mockStripeStatus = activeStripeAccount;
  view.rerender(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
});

it('shows a concise factual verification state without recovery instructions or legal warning blocks', () => {
  mockStripeStatus = pendingStripeAccount;
  render(<QueryClientProvider client={client}><StripeOnboarding/></QueryClientProvider>);
  expect(screen.getByText('Vérification en cours')).toBeTruthy();
  expect(screen.getByText('Votre compte est en cours de validation. Le statut se met à jour automatiquement.')).toBeTruthy();
  expect(mockRecoveryPanel).not.toHaveBeenCalled();
  expect(screen.queryByText('Échéance de vérification')).toBeNull();
  expect(screen.queryByText(/Cette déclaration ne constitue pas une preuve/)).toBeNull();
  expect(screen.queryByText('Informations en cours de vérification')).toBeNull();
  expect(screen.queryByText('Votre compte est actif')).toBeNull();
  expect(screen.getByText('Actualiser le statut')).toBeTruthy();
  expect(screen.getByText('Comptes bancaires')).toBeTruthy();
});

it('observes pending verification but keeps a consultation open when the account becomes active', async () => {
  jest.useFakeTimers();
  try {
    mockStripeStatus = pendingStripeAccount;
    mockRouteParams = {from: 'shipping-preparation', articleId: 'article_one', intent: 'manage'};
    mockRefetch.mockResolvedValue({isError: false, fetchStatus: 'idle', data: activeStripeAccount});
    const subject = <QueryClientProvider client={client}><StripeOnboarding/></QueryClientProvider>;
    const view = render(subject);
    await act(async () => undefined);
    expect(mockRefetch).not.toHaveBeenCalled();
    expect(mockRouter.back).not.toHaveBeenCalled();
    await act(async () => {jest.advanceTimersByTime(10_000);});
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    mockStripeStatus = activeStripeAccount;
    view.rerender(<QueryClientProvider client={client}><StripeOnboarding/></QueryClientProvider>);
    await act(async () => undefined);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).not.toHaveBeenCalled();
    await act(async () => {jest.advanceTimersByTime(60_000);});
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  } finally {jest.useRealTimers();}
});

it('pauses verification reads in the background and stops them when the payment screen loses focus', async () => {
  jest.useFakeTimers();
  try {
    mockStripeStatus = pendingStripeAccount;
    mockRefetch.mockResolvedValue({isError: false, fetchStatus: 'idle', data: pendingStripeAccount});
    render(<QueryClientProvider client={client}><StripeOnboarding/></QueryClientProvider>);
    await activity('background');
    await act(async () => {jest.advanceTimersByTime(30_000);});
    expect(mockRefetch).not.toHaveBeenCalled();
    await activity('active');
    await act(async () => {jest.advanceTimersByTime(10_000);});
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    await act(async () => {for (const cleanup of [...mockFocusCleanups]) cleanup();});
    await act(async () => {jest.advanceTimersByTime(30_000);});
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  } finally {jest.useRealTimers();}
});

const savedBanks = [
  {id: 'ba_current', bankName: 'Banque actuelle', last4: '6789', currency: 'CAD' as const, country: 'CA' as const,
    status: 'verified', isDefault: true, isSelected: true, canSelect: false, canDelete: false,
    deleteBlockedReason: 'selected_bank' as const, selectionDeclarationRequired: false},
  {id: 'ba_old', bankName: 'Autre banque', last4: '2345', currency: 'CAD' as const, country: 'CA' as const,
    status: 'verified', isDefault: false, isSelected: false, canSelect: true, canDelete: true,
    deleteBlockedReason: null, selectionDeclarationRequired: false},
];
function renderBankManagement(banks = savedBanks) {
  mockHasAccount = true;
  mockStripeStatus = {...activeStripeAccount, bankAccountsAvailable: true, bankAccounts: banks};
  return render(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);
}
async function bankMenu(action: string, account = 'Autre banque') {
  await waitFor(() => expect(screen.getByLabelText(new RegExp(`Gérer ${account}`))).toBeTruthy());
  fireEvent.press(screen.getByLabelText(new RegExp(`Gérer ${account}`)));
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)?.[2];
  const button = buttons?.find(item => item.text === action);
  expect(button).toBeTruthy();
  act(() => {button?.onPress?.();});
}

it('shows the masked bank inventory directly and preserves legacy navigation parameters', async () => {
  renderBankManagement();
  await waitFor(() => expect(screen.getByText('Banque actuelle')).toBeTruthy());
  expect(screen.getByText('•••• 6789')).toBeTruthy();
  expect(screen.getByText('Pour vos retraits')).toBeTruthy();
  expect(screen.queryByText('Compte bancaire')).toBeNull();
  expect(screen.queryByPlaceholderText('1234567')).toBeNull();
  expect(mockRouter.back).not.toHaveBeenCalled();
  mockRouteParams = {from: 'shipping-preparation', articleId: 'article_native', intent: 'manage'};
  render(<BankAccount/>);
  expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/settings/stripe-onboarding', params: mockRouteParams});
});

it('selects an existing bank using its exact identity without resending coordinates or rebuilding a declaration', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  renderBankManagement();
  await bankMenu('Utiliser pour mes retraits');
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.press(screen.getByText('Utiliser pour mes retraits'));
  await waitFor(() => expect(mockReplaceBank).toHaveBeenCalledWith(expect.objectContaining({input: {
    mode: 'select_existing', bankAccountId: 'ba_old', requestId: expect.any(String),
  }})));
  expect(mockReplaceBank).toHaveBeenCalledTimes(1);
  expect(mockRouter.back).not.toHaveBeenCalled();
});

it('requires an explicit current declaration only when selection needs it', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  renderBankManagement(savedBanks.map(account => account.id === 'ba_old' ? {...account, selectionDeclarationRequired: true} : account));
  await bankMenu('Utiliser pour mes retraits');
  fireEvent.changeText(screen.getByPlaceholderText('Nom figurant sur le compte'), 'Jean Test');
  fireEvent.press(screen.getByText('Continuer'));
  expect(screen.getByRole('checkbox').props.accessibilityState.checked).toBe(false);
  fireEvent.press(screen.getByText('Confirmer'));
  expect(mockReplaceBank).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('checkbox'));
  fireEvent.press(screen.getByText('Confirmer'));
  await waitFor(() => expect(mockReplaceBank).toHaveBeenCalledWith(expect.objectContaining({input: expect.objectContaining({
    mode: 'select_existing', bankAccountId: 'ba_old', accountHolderName: 'Jean Test', bankOwnershipAccepted: true,
  })})));
});

it('offers a single deletion confirmation for an old bank and never deletes the current destination', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  renderBankManagement();
  await bankMenu('Remplacer', 'Banque actuelle');
  expect(jest.mocked(Alert.alert).mock.calls.at(-1)?.[2]?.some(button => button.text === 'Supprimer')).toBe(false);
  fireEvent.press(screen.getByText('Annuler'));
  await bankMenu('Supprimer');
  expect(screen.getByText('Ce compte sera retiré de vos comptes bancaires enregistrés.')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.press(screen.getByText('Supprimer ce compte'));
  await waitFor(() => expect(mockReplaceBank).toHaveBeenCalledWith(expect.objectContaining({input: {
    mode: 'delete_existing', bankAccountId: 'ba_old', requestId: expect.any(String),
  }})));
  expect(mockReplaceBank).toHaveBeenCalledTimes(1);
});

it('does not invent an empty inventory or expose mutations when the provider inventory is unavailable', async () => {
  mockHasAccount = true;
  mockStripeStatus = {...activeStripeAccount, bankAccountsAvailable: false, bankAccounts: []};
  render(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Impossible de charger vos comptes bancaires.')).toBeTruthy());
  fireEvent.press(screen.getByText('Ajouter un compte bancaire'));
  expect(screen.queryByPlaceholderText('1234567')).toBeNull();
  expect(mockReplaceBank).not.toHaveBeenCalled();
});

it('resumes only the same opaque bank request after reopening, without inventing new coordinates', async () => {
  await AsyncStorage.setItem('second:bank-operation:v1:seller', JSON.stringify({requestId: 'bank_pending_17'}));
  renderBankManagement();
  await waitFor(() => expect(screen.getByText('Actualiser la modification')).toBeTruthy());
  fireEvent.press(screen.getByText('Actualiser la modification'));
  await waitFor(() => expect(mockReplaceBank).toHaveBeenCalledWith(expect.objectContaining({input: {requestId: 'bank_pending_17'}})));
  expect(GoogleSignin.signIn).not.toHaveBeenCalled();
});

it.each(['another-owner', 'same-owner-new-login', 'navigation'])('never changes a bank after its native authentication loses the original context: %s', async change => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(async () => {
    await activity('inactive');
    await act(async () => {
      if (change === 'navigation') {for (const cleanup of [...mockFocusCleanups]) cleanup();}
      else {
        (auth as unknown as {currentUser: ReturnType<typeof firebaseUser> | null}).currentUser = null;
        mockGeneration++; useAuthStore.setState({authenticatedUid: null});
        const next = {...firebaseUser(), uid: change === 'another-owner' ? 'other' : 'seller'};
        (auth as unknown as {currentUser: typeof next}).currentUser = next;
        mockGeneration++; useAuthStore.setState({authenticatedUid: next.uid});
      }
    });
    await activity('active');
    return {type: 'success', data: {idToken: 'google-test'}} as never;
  });
  renderBankManagement();
  await bankMenu('Utiliser pour mes retraits');
  fireEvent.press(screen.getByText('Utiliser pour mes retraits'));
  await waitFor(() => expect(GoogleSignin.signIn).toHaveBeenCalledTimes(1));
  await act(async () => {await Promise.resolve();});
  expect(mockReplaceBank).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem('second:bank-operation:v1:seller')).toBeNull();
});

it('persists only the opaque identity while a bank update is in flight', async () => {
  jest.mocked(GoogleSignin.signIn).mockImplementation(successfulGoogleReturn);
  let finish: (() => void) | undefined;
  mockReplaceBank.mockImplementation(async ({input, assertCurrent}: {input: {requestId: string}; assertCurrent: () => void}) => {
    assertCurrent();
    const stored = await AsyncStorage.getItem('second:bank-operation:v1:seller');
    expect(JSON.parse(stored!)).toEqual({requestId: input.requestId});
    await new Promise<void>(resolve => {finish = resolve;});
    return {success: true, requestId: input.requestId, action: null};
  });
  renderBankManagement();
  await bankMenu('Utiliser pour mes retraits');
  fireEvent.press(screen.getByText('Utiliser pour mes retraits'));
  await waitFor(() => expect(finish).toBeDefined());
  expect(client.getMutationCache().getAll().every(mutation => !JSON.stringify(mutation.state.variables).includes('ba_old'))).toBe(true);
  await act(async () => {finish?.();});
  await waitFor(async () => expect(await AsyncStorage.getItem('second:bank-operation:v1:seller')).toBeNull());
});

it('does not invite adding or replacing a bank during a withdrawal', async () => {
  mockHasAccount = true;
  mockStripeStatus = {...activeStripeAccount, bankAccountsAvailable: true, bankAccounts: savedBanks,
    bankChangesBlockedReason: 'withdrawal_in_progress'};
  render(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Un retrait est en cours sur ce compte.')).toBeTruthy());
  fireEvent.press(screen.getByText('Ajouter un compte bancaire'));
  expect(screen.queryByPlaceholderText('1234567')).toBeNull();
  fireEvent.press(screen.getByLabelText('Gérer Banque actuelle finissant par 6789'));
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(GoogleSignin.signIn).not.toHaveBeenCalled();
  expect(mockReplaceBank).not.toHaveBeenCalled();
});

it('keeps a previously qualified inventory visible and read-only during refresh', async () => {
  const view = renderBankManagement();
  await waitFor(() => expect(screen.getByText('Banque actuelle')).toBeTruthy());
  mockBankFetching = true;
  view.rerender(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);
  expect(screen.getByText('Banque actuelle')).toBeTruthy();
  expect(screen.getByText('•••• 6789')).toBeTruthy();
  expect(screen.queryByText('Impossible de charger vos comptes bancaires.')).toBeNull();
  fireEvent.press(screen.getByText('Ajouter un compte bancaire'));
  fireEvent.press(screen.getByLabelText('Gérer Autre banque finissant par 2345'));
  expect(screen.queryByPlaceholderText('1234567')).toBeNull();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(mockReplaceBank).not.toHaveBeenCalled();
});

it('keeps observation available after a lost deletion response without sending another deletion', async () => {
  await AsyncStorage.setItem('second:bank-operation:v1:seller', JSON.stringify({requestId: 'bank_delete_17'}));
  mockHasAccount = true;
  mockStripeStatus = {...activeStripeAccount, bankAccountsAvailable: true, bankAccounts: savedBanks,
    bankOperation: {requestId: 'bank_delete_17', operationId: 'operation_17', state: 'deletion_unknown', action: 'contactSupport'}};
  render(<QueryClientProvider client={client}><Subject/></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Actualiser la modification')).toBeTruthy());
  fireEvent.press(screen.getByText('Actualiser la modification'));
  await waitFor(() => expect(mockReplaceBank).toHaveBeenCalledWith(expect.objectContaining({input: {requestId: 'bank_delete_17'}})));
  expect(mockReplaceBank).toHaveBeenCalledTimes(1);
});
