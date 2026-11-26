import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { auth } from '@/config/firebaseConfig';
import { useAuthStore } from '@/store/authStore';
import { AuthService } from '@/services/authService';
import { EligibilityService } from '@/services/eligibilityService';
import { sellerActivityPolicy, signupConsentPolicy, type SignupConsent } from '@/services/signupConsentJournal';
import CompleteProfileScreen from '@/app/complete-profile';

const mockCompleteConsent = jest.fn();
const mockSignOut = jest.fn();
const mockReplace = jest.fn();
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual('zustand');
  const useStore = create(() => ({authenticatedUid: 'owner', pendingConsent: true, generation: 1,
    pendingConsentUser: {id: 'owner', authProvider: 'google'},
    signOut: (...args: unknown[]) => mockSignOut(...args),
    completeConsent: (...args: unknown[]) => mockCompleteConsent(...args)}));
  return {useAuthStore: useStore, getAuthSessionGeneration: () => useStore.getState().generation};
});
jest.mock('@/services/authService', () => ({AuthService: {
  getPendingSignupConsent: jest.fn(), checkUsernameAvailability: jest.fn(),
}}));
jest.mock('@/services/eligibilityService', () => ({EligibilityService: {getMine: jest.fn()}, newEligibilityRequestId: () => 'signup-request-stable'}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('@/components/ui', () => ({
  Input: jest.requireActual('@/components/ui/Input').Input,
  Checkbox: jest.requireActual('@/components/ui/Checkbox').Checkbox,
}));
jest.mock('expo-router', () => {
  const ReactRuntime: typeof import('react') = jest.requireActual('react');
  const {Text}: typeof import('react-native') = jest.requireActual('react-native');
  return {router: {replace: (...args: unknown[]) => mockReplace(...args)}, Link: ({children}: {children: React.ReactNode}) => ReactRuntime.createElement(Text, null, children),
    useFocusEffect: (effect: () => void | (() => void)) => ReactRuntime.useEffect(effect, [effect])};
});

const eligibility = (version = 'a'.repeat(64)) => ({version, statementVersion: sellerActivityPolicy.version,
  statements: sellerActivityPolicy.statements});
const pending: SignupConsent = {dateOfBirth: '1990-01-01', acceptedTerms: true, acceptedPrivacy: true, marketingOptIn: false,
  desiredUsername: 'member', policyVersion: signupConsentPolicy.version, sellerActivityDeclaration: {
    kind: 'personal', statementVersion: sellerActivityPolicy.version, personalDeclarationAccepted: true,
    expectedVersion: 'a'.repeat(64), requestId: 'original-request', expectedUid: 'owner'}};
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  clients.push(client);
  return render(<QueryClientProvider client={client}><CompleteProfileScreen /></QueryClientProvider>);
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {value: 'active', configurable: true});
  Object.defineProperty(auth, 'currentUser', {value: {uid: 'owner'}, writable: true, configurable: true});
  useAuthStore.setState({authenticatedUid: 'owner', pendingConsent: true, generation: 1} as never);
  jest.mocked(AuthService.getPendingSignupConsent).mockResolvedValue(null);
  jest.mocked(AuthService.checkUsernameAvailability).mockResolvedValue({ok: true, available: true});
  jest.mocked(EligibilityService.getMine).mockResolvedValue(eligibility() as never);
  mockCompleteConsent.mockResolvedValue({id: 'owner'});
  mockSignOut.mockResolvedValue(undefined);
});
afterEach(() => {clients.splice(0).forEach(client => client.clear());});

async function fillForm(view: ReturnType<typeof mount>) {
  fireEvent.changeText(view.getByTestId('complete-profile-username'), 'member');
  fireEvent.changeText(view.getByTestId('signup-dob-day'), '01');
  fireEvent.changeText(view.getByTestId('signup-dob-month'), '01');
  fireEvent.changeText(view.getByTestId('signup-dob-year'), '1990');
  fireEvent.press(view.getByTestId('signup-consent-terms'));
  fireEvent.press(view.getByTestId('signup-consent-privacy'));
  await waitFor(() => expect(AuthService.checkUsernameAvailability).toHaveBeenCalled());
  await waitFor(() => expect(view.getByTestId('signup-consent-seller-activity')).toBeEnabled());
}

it('starts unchecked, requires the distinct visible declaration, and sends its canonical version', async () => {
  const view = mount();
  await fillForm(view);
  const declaration = view.getByTestId('signup-consent-seller-activity');
  expect(declaration.props.accessibilityLabel).toBe(sellerActivityPolicy.statements.personal);
  expect(declaration.props.accessibilityState.checked).toBe(false);
  expect(view.getByTestId('complete-profile-submit')).toBeDisabled();
  fireEvent.press(declaration);
  fireEvent.press(view.getByTestId('complete-profile-submit'));
  await waitFor(() => expect(mockCompleteConsent).toHaveBeenCalledTimes(1));
  expect(mockCompleteConsent.mock.calls[0][0]).toEqual({...pending, sellerActivityDeclaration: {
    ...pending.sellerActivityDeclaration, requestId: 'signup-request-stable'}});
  expect(mockCompleteConsent.mock.calls[0][1].assertCurrent).toEqual(expect.any(Function));
});

it('does not mutate when the member leaves the declaration unchecked', async () => {
  const view = mount();
  await fillForm(view);
  fireEvent.press(view.getByTestId('complete-profile-submit'));
  expect(mockCompleteConsent).not.toHaveBeenCalled();
});

it('allows leaving an incomplete signup by signing out without recording consent', async () => {
  const view = mount();
  fireEvent.press(view.getByTestId('complete-profile-leave'));
  await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({expectedUid: 'owner', expectedGeneration: 1}));
  expect(mockCompleteConsent).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('requires a new explicit confirmation if the fresh version changed before submission', async () => {
  const view = mount();
  await fillForm(view);
  fireEvent.press(view.getByTestId('signup-consent-seller-activity'));
  jest.mocked(EligibilityService.getMine).mockResolvedValue(eligibility('b'.repeat(64)) as never);
  fireEvent.press(view.getByTestId('complete-profile-submit'));
  await waitFor(() => expect(view.getByText('Vos renseignements ont changé. Relisez votre déclaration avant de continuer.')).toBeTruthy());
  expect(mockCompleteConsent).not.toHaveBeenCalled();
  expect(view.getByTestId('signup-consent-seller-activity').props.accessibilityState.checked).toBe(false);
});

it('ignores a fresh response from an identity that has since changed', async () => {
  const view = mount();
  await fillForm(view);
  fireEvent.press(view.getByTestId('signup-consent-seller-activity'));
  let finish!: (value: unknown) => void;
  jest.mocked(EligibilityService.getMine).mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  fireEvent.press(view.getByTestId('complete-profile-submit'));
  await act(async () => {
    Object.defineProperty(auth, 'currentUser', {value: {uid: 'other'}, writable: true, configurable: true});
    useAuthStore.setState({authenticatedUid: 'other', generation: 2} as never);
    finish(eligibility());
  });
  expect(mockCompleteConsent).not.toHaveBeenCalled();
  expect(view.getByTestId('complete-profile-username').props.value).toBe('');
  expect(view.getByTestId('signup-consent-seller-activity').props.accessibilityState.checked).toBe(false);
});

it('restores and retries an uncertain signup verbatim without adopting the new CAS version', async () => {
  jest.mocked(AuthService.getPendingSignupConsent).mockResolvedValue(pending);
  jest.mocked(EligibilityService.getMine).mockResolvedValue(eligibility('b'.repeat(64)) as never);
  const view = mount();
  await waitFor(() => expect(view.getByTestId('complete-profile-submit')).toBeEnabled());
  expect(view.getByTestId('complete-profile-username').props.editable).toBe(false);
  fireEvent.press(view.getByTestId('complete-profile-submit'));
  fireEvent.press(view.getByTestId('complete-profile-submit'));
  await waitFor(() => expect(mockCompleteConsent).toHaveBeenCalledTimes(1));
  expect(mockCompleteConsent.mock.calls[0][0]).toEqual(pending);
  expect(EligibilityService.getMine).toHaveBeenCalledTimes(1);
});
