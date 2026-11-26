import React from 'react';
import {AppState, Linking, Platform} from 'react-native';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {fetch as expoFetch} from 'expo/fetch';
import {auth} from '@/config/firebaseConfig';
import {useAuthStore} from '@/store/authStore';
import {AccountErasureJournal} from '@/services/accountErasureJournal';
import {AccountErasureService} from '@/services/accountErasureService';
import {AuthService} from '@/services/authService';
import {issueAppleErasureAuthorization} from '@/services/accountErasureAppleAuthorization';
import {useAccountErasureRecoveryGuard} from '@/hooks/useAccountErasureRecovery';
import {useConsentGuard} from '@/features/auth/hooks/useConsentGuard';
import type {AccountErasureAttempt, AccountErasureReceipt} from '@/types/accountErasure';

let mockGeneration = 1, mockPath = '/settings/erase-account';
let mockSegments = ['settings', 'erase-account'];
const mockMemory = new Map<string, string>(), mockCleanups = new Set<() => void>();
const mockPublicMemory = new Map<string, string>();
jest.mock('@/utils/environmentStorage', () => ({__esModule: true, default: {
  getItem: async (key: string) => mockPublicMemory.get(key) ?? null,
  setItem: async (key: string, value: string) => {mockPublicMemory.set(key, value);},
}}));
const mockRouter = {back: jest.fn(), replace: jest.fn(), push: jest.fn()};
const mockListeners = new Set<(state: 'active' | 'inactive' | 'background') => void>();
jest.mock('expo-secure-store', () => ({WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only', isAvailableAsync: async () => true,
  getItemAsync: async (key: string) => mockMemory.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {mockMemory.set(key, value);},
  deleteItemAsync: async (key: string) => {mockMemory.delete(key);},
}));
jest.mock('expo/fetch', () => ({fetch: jest.fn()}));
jest.mock('@/config/firebaseEnvironment', () => ({runtimeEnvironment: {name: 'production', projectId: 'seconde-b47a6',
  useEmulators: false, storageNamespace: 'production'}}));
jest.mock('@/lib/analytics', () => ({track: jest.fn(), suspendAnalytics: jest.fn(), setAnalyticsEnabled: jest.fn(async () => undefined)}));
jest.mock('@/services/tradeOperation', () => ({captureTradeSession: (uid: string) => {
  const {auth} = jest.requireMock('@/config/firebaseConfig') as {auth: {currentUser: {uid: string} | null}};
  if (auth.currentUser?.uid !== uid) throw new Error('Invalid SDK identity'); return {uid};
}, staleTradeOperation: () => new Error('stale native challenge')}));
jest.mock('@/services/authService', () => ({AuthService: {reauthenticate: jest.fn(async (_password: string, check: () => void) => {check();}),
  reauthenticateWithGoogle: jest.fn(), reauthenticateWithApple: jest.fn(), reauthenticateWithAppleForErasure: jest.fn()}}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  const {subscribeWithSelector} = jest.requireActual<typeof import('zustand/middleware')>('zustand/middleware');
  return {getAuthSessionGeneration: () => mockGeneration, useAuthStore: create(subscribeWithSelector(() => ({
    authenticatedUid: 'erasure-owner', isLoading: false, user: null, pendingConsent: false})))};
});
jest.mock('expo-router', () => ({router: mockRouter, useRouter: () => mockRouter, usePathname: () => mockPath,
  useSegments: () => mockSegments, useRootNavigationState: () => ({key: 'root'}),
  Stack: () => {const React = require('react'), {Text} = require('react-native'); return React.createElement(Text, null, 'settings-stack');},
  Redirect: ({href}: {href: string}) => {mockRouter.replace(href); return null;},
  useFocusEffect: (effect: () => void | (() => void)) => {const React = require('react'); React.useEffect(() => {
    const cleanup = effect(); if (cleanup) mockCleanups.add(cleanup);
    return () => {if (cleanup) {mockCleanups.delete(cleanup); cleanup();}};
  }, [effect]);},
}));
jest.mock('@/components/ui', () => {
  const React = require('react'), {Pressable, Text} = require('react-native');
  return {Text, Caption: Text, Label: Text, ScreenHeader: () => null,
    Button: ({children, disabled, loading, onPress}: {children: React.ReactNode; disabled?: boolean; loading?: boolean; onPress: () => void}) =>
      React.createElement(Pressable, {accessibilityRole: 'button', disabled: disabled || loading, onPress}, React.createElement(Text, null, children))};
});
jest.mock('@/features/account', () => ({AccountErasureStatus: ({receipt}: {receipt: AccountErasureReceipt}) => {
  const React = require('react'), {Text} = require('react-native'); return React.createElement(Text, {testID: 'status'}, receipt.state);
}}));
import EraseAccountScreen from '@/app/settings/erase-account';
import AccountDeletionTrackingScreen from '@/app/account-deletion';
import SettingsLayout from '@/app/settings/_layout';

const noView = () => undefined;
const sdkUser = (uid = 'erasure-owner', providers = ['password']) => ({uid, email: 'synthetic@example.test',
  providerData: providers.map(providerId => ({providerId})), getIdToken: jest.fn(async () => 'synthetic-jwt'),
  getIdTokenResult: jest.fn(async () => ({claims: {auth_time: Math.floor(Date.now() / 1000)}}))});
let owner = sdkUser(), client: QueryClient;
function login(user: ReturnType<typeof sdkUser> | null) {mockGeneration++; Object.assign(auth, {currentUser: user}); useAuthStore.setState({authenticatedUid: user?.uid ?? null, isLoading: false});}
const receipt = (attempt: Pick<AccountErasureAttempt, 'requestId' | 'commandId'>, state: AccountErasureReceipt['state'] = 'inspecting', version = 1): AccountErasureReceipt => ({
  kind: 'account_erasure_receipt_v1', commandId: attempt.commandId, requestId: attempt.requestId, state, version, accountAccessClosed: false,
  deletionComplete: false, appleAuthorizationRequired: state === 'awaiting_apple_authorization', progress: {completedSteps: 1, totalSteps: 4},
  reasons: state === 'awaiting_apple_authorization' ? ['authorization_required'] : [], updatedAt: '2026-11-25T10:00:00.000Z',
  completedAt: null, retentionPolicyVersion: 'seconde-erasure-2026-11-25-v1', observationExpiresAt: null,
  success: false, status: 'incomplete', newOperationsBlocked: true,
});
const operations = () => jest.mocked(expoFetch).mock.calls.map(call => JSON.parse(String(call[1]?.body)).data.operation as string);
function Subject({tracking = false}: {tracking?: boolean}) {useAccountErasureRecoveryGuard(); return tracking ? <AccountDeletionTrackingScreen/> : <EraseAccountScreen/>;}
function mount(tracking = false) {return render(<QueryClientProvider client={client}><Subject tracking={tracking}/></QueryClientProvider>);}
async function activity(state: 'active' | 'inactive' | 'background') {
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: state});
  await act(async () => {for (const listener of mockListeners) listener(state);});
}
async function prepare() {
  fireEvent.press(await screen.findByText('Préparer ma demande de suppression'));
  await screen.findByTestId('erasure-password');
}
async function verifyPassword() {
  fireEvent.changeText(screen.getByTestId('erasure-password'), 'synthetic-password');
  fireEvent.press(screen.getByText('Vérifier avec mon mot de passe'));
  await screen.findByText('Identité vérifiée pour cette intention. Aucune étape de suppression n’a été envoyée par cette vérification.');
}
beforeEach(() => {
  mockMemory.clear(); mockPublicMemory.clear(); mockCleanups.clear(); mockListeners.clear(); mockGeneration++;
  jest.clearAllMocks(); owner = sdkUser(); login(owner); useAuthStore.setState({user: null, pendingConsent: false});
  mockSegments = ['settings', 'erase-account']; mockPath = '/settings/erase-account';
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    mockListeners.add(listener); return {remove: () => mockListeners.delete(listener)};
  });
  jest.spyOn(Linking, 'openURL').mockResolvedValue();
  jest.mocked(expoFetch).mockImplementation(async (_url, options) => {
    const payload = JSON.parse(String(options?.body)).data as AccountErasureAttempt;
    return {ok: true, status: 200, text: async () => JSON.stringify({result: receipt(payload)})} as Response;
  });
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}, mutations: {retry: false}}});
});
afterEach(() => {client.clear(); jest.restoreAllMocks();});

it('requires an explicit confirmed send after preparation and fresh identity, and never sends on mount', async () => {
  mount(); await prepare(); expect(expoFetch).not.toHaveBeenCalled();
  await verifyPassword(); expect(expoFetch).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Envoyer ma demande de suppression')); expect(expoFetch).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId('erasure-confirmation'), 'SUPPRIMER');
  fireEvent.press(screen.getByText('Envoyer ma demande de suppression'));
  await waitFor(() => expect(operations().filter(operation => operation === 'request')).toHaveLength(1));
  await screen.findByTestId('status'); expect(operations()).not.toContain('resume');
});
it('restores an unknown result by observing only, even after foreground and refocus', async () => {
  const pending = await AccountErasureJournal.beginSubmission(await AccountErasureService.prepare(owner.uid, noView), noView);
  mount(); await waitFor(() => expect(operations()).toEqual(['observe']));
  expect(JSON.parse(String(jest.mocked(expoFetch).mock.calls[0][1]?.body)).data.commandId).toBe(pending.commandId);
  await activity('background'); await activity('active');
  await screen.findByTestId('status'); expect(operations().every(operation => operation === 'observe')).toBe(true);
  expect(AuthService.reauthenticate).not.toHaveBeenCalled();
});
it('invalidates a verified confirmation on backgrounding and never sends it automatically on return', async () => {
  mount(); await prepare(); await verifyPassword();
  fireEvent.changeText(screen.getByTestId('erasure-confirmation'), 'SUPPRIMER');
  await activity('background'); await activity('active');
  await screen.findByTestId('erasure-confirmation'); fireEvent.press(screen.getByText('Envoyer ma demande de suppression'));
  expect(expoFetch).not.toHaveBeenCalled(); expect(screen.getByTestId('erasure-confirmation').props.value).toBe('');
});
it('rejects a late password identity check after the screen loses focus', async () => {
  let finish!: () => void;
  jest.mocked(AuthService.reauthenticate).mockImplementationOnce(async (_password, check) => {await new Promise<void>(resolve => {finish = resolve;}); check?.();});
  mount(); await prepare(); fireEvent.changeText(screen.getByTestId('erasure-password'), 'synthetic-password');
  fireEvent.press(screen.getByText('Vérifier avec mon mot de passe'));
  act(() => {for (const cleanup of mockCleanups) cleanup();});
  await act(async () => {finish();}); expect(expoFetch).not.toHaveBeenCalled();
  expect(screen.queryByText('Identité vérifiée pour cette intention. Aucune étape de suppression n’a été envoyée par cette vérification.')).toBeNull();
});
it('does not adopt or show the prior owner after an intervening account B, even if B never opens a screen', async () => {
  await AccountErasureJournal.beginSubmission(await AccountErasureService.prepare(owner.uid, noView), noView);
  const rendered = mount(true); await screen.findByTestId('status');
  await act(async () => {login(sdkUser('account-B')); login(null);});
  await screen.findByText('Aucun suivi éligible n’est disponible dans la session actuelle sur cet appareil.');
  expect(screen.queryByTestId('status')).toBeNull(); rendered.unmount();
  mount(true); await screen.findByText('Aucun suivi éligible n’est disponible dans la session actuelle sur cet appareil.');
});
it('only observes a signed-out device capability and links to the public legal route', async () => {
  await AccountErasureJournal.beginSubmission(await AccountErasureService.prepare(owner.uid, noView), noView); login(null); mount(true);
  await screen.findByTestId('status'); expect(operations()).toEqual(['observe']); expect(owner.getIdToken).not.toHaveBeenCalled();
  expect(screen.queryByText('Ouvrir les étapes de cette demande')).toBeNull();
  fireEvent.press(screen.getByText('Politique de confidentialité')); expect(mockRouter.push).toHaveBeenCalledWith('/legal/privacy-policy');
});
it('waits for Auth hydration before discovering a signed-out capability', async () => {
  await AccountErasureJournal.beginSubmission(await AccountErasureService.prepare(owner.uid, noView), noView); login(null);
  useAuthStore.setState({isLoading: true}); mount(true);
  expect(expoFetch).not.toHaveBeenCalled(); expect(screen.queryByTestId('status')).toBeNull();
  await act(async () => {useAuthStore.setState({isLoading: false});}); await screen.findByTestId('status');
});
it('shows Apple linked despite a password primary, and returning with its code does not send authorization', async () => {
  owner = sdkUser('erasure-owner', ['password', 'apple.com']); login(owner);
  const pending = await AccountErasureJournal.beginSubmission(await AccountErasureService.prepare(owner.uid, noView), noView);
  await AccountErasureJournal.record(pending, receipt(pending, 'awaiting_apple_authorization'), noView);
  jest.mocked(expoFetch).mockImplementation(async () => ({ok: true, status: 200, text: async () => JSON.stringify({result: receipt(pending, 'awaiting_apple_authorization')})}) as Response);
  jest.mocked(AuthService.reauthenticateWithAppleForErasure).mockImplementationOnce(async (attempt, generation, check, waitForActive) => {
    for (const state of ['inactive', 'active'] as const) {
      Object.defineProperty(AppState, 'currentState', {configurable: true, value: state});
      for (const listener of mockListeners) listener(state);
    }
    await waitForActive?.(); check();
    return issueAppleErasureAuthorization(attempt, owner as never, generation, 'synthetic-apple-code');
  });
  mount(); const button = await screen.findByText('Obtenir une nouvelle autorisation Apple');
  await act(async () => {fireEvent.press(button);});
  await screen.findByText('Autorisation Apple obtenue. Confirmez explicitement son envoi pour cette demande.');
  expect(operations().every(operation => operation === 'observe')).toBe(true);
  fireEvent.changeText(screen.getByTestId('erasure-confirmation'), 'SUPPRIMER');
  fireEvent.press(screen.getByText('Envoyer cette autorisation Apple'));
  await waitFor(() => expect(operations().filter(operation => operation === 'authorize_apple')).toHaveLength(1));
});
it('offers the browser authorization for newly creatable Android Apple+password accounts', async () => {
  jest.replaceProperty(Platform, 'OS', 'android'); owner = sdkUser('erasure-owner', ['password', 'apple.com']); login(owner);
  mount(); await prepare();
  expect(screen.getByText(/confirmez votre identité avec votre mot de passe puis ouvrez l’étape Apple dans le navigateur/)).toBeTruthy();
  expect(screen.queryByText('Obtenir une nouvelle autorisation Apple')).toBeNull();
});
it('opens a short Apple challenge only after confirmation, then waits for an explicit read after the browser returns', async () => {
  jest.replaceProperty(Platform, 'OS', 'android'); owner = sdkUser('erasure-owner', ['password', 'apple.com']); login(owner);
  const pending = await AccountErasureJournal.beginSubmission(await AccountErasureService.prepare(owner.uid, noView), noView);
  const awaiting = receipt(pending, 'awaiting_apple_authorization'); await AccountErasureJournal.record(pending, awaiting, noView);
  const browserUrl = `https://seconde-b47a6.firebaseapp.com/account-erasure-apple#challengeId=synthetic-challenge-123&cap=${'c'.repeat(43)}`;
  jest.mocked(expoFetch).mockImplementation(async (url) => ({ok: true, status: 200, text: async () => JSON.stringify({result:
    String(url).endsWith('/startAccountErasureAppleWeb') ? {capability: 'account_erasure_apple_web_v1', challengeId: 'synthetic-challenge-123',
      browserUrl, expiresAt: new Date(Date.now() + 240_000).toISOString()} : awaiting})}) as Response);
  mount(); await screen.findByText('Autoriser Apple dans le navigateur'); await verifyPassword();
  expect(Linking.openURL).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId('erasure-confirmation'), 'SUPPRIMER');
  await waitFor(() => expect(screen.getByText('Autoriser Apple dans le navigateur')).toBeEnabled());
  fireEvent.press(screen.getByText('Autoriser Apple dans le navigateur'));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(browserUrl));
  const requests = jest.mocked(expoFetch).mock.calls.length;
  await activity('inactive'); await activity('active');
  await screen.findByText(/Après l’étape dans le navigateur, vérifiez ici le résultat/);
  expect(expoFetch).toHaveBeenCalledTimes(requests);
  fireEvent.press(screen.getByText('Vérifier le résultat de cette même demande'));
  await waitFor(() => expect(expoFetch).toHaveBeenCalledTimes(requests + 1));
  expect(operations().filter(operation => ['request', 'resume', 'authorize_apple'].includes(operation))).toEqual([]);
  expect(JSON.stringify([...mockMemory.values()])).not.toContain('synthetic-challenge-123');
});
it('prepares recovery without rotating a key until fresh identity and REPRENDRE are explicitly confirmed', async () => {
  mount(); fireEvent.press(await screen.findByText('Reprendre une demande lancée sur un autre appareil'));
  await screen.findByText('Récupérer le suivi de ma demande existante'); expect(expoFetch).not.toHaveBeenCalled();
  await verifyPassword(); expect(expoFetch).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId('erasure-confirmation'), 'REPRENDRE');
  fireEvent.press(screen.getByText('Récupérer le suivi de ma demande existante'));
  await waitFor(() => expect(operations()).toContain('recover_owner')); expect(operations()).not.toContain('request');
});
it('retains the erasure settings route for an SDK owner with no profile and pending consent', () => {
  useAuthStore.setState({user: null, pendingConsent: true});
  function Guards() {useConsentGuard(); return <SettingsLayout/>;}
  render(<Guards/>); expect(screen.getByText('settings-stack')).toBeTruthy(); expect(mockRouter.replace).not.toHaveBeenCalled();
});
it('keeps public tracking reachable during pending consent but does not open all settings to guests', () => {
  useAuthStore.setState({pendingConsent: true}); mockSegments = ['account-deletion'];
  function Guard() {useConsentGuard(); return null;}
  const rendered = render(<Guard/>); expect(mockRouter.replace).not.toHaveBeenCalled(); rendered.unmount();
  login(null); mockPath = '/settings/erase-account'; render(<SettingsLayout/>);
  expect(mockRouter.replace).toHaveBeenCalledWith('/(tabs)/profile');
});
it('only signs out a closed SDK owner after their explicit action, retaining the signed-out observation', async () => {
  const pending = await AccountErasureJournal.beginSubmission(await AccountErasureService.prepare(owner.uid, noView), noView);
  const closed = {...receipt(pending, 'erasing'), accountAccessClosed: true};
  await AccountErasureJournal.record(pending, closed, noView);
  jest.mocked(expoFetch).mockResolvedValue({ok: true, status: 200, text: async () => JSON.stringify({result: closed})} as Response);
  const signOut = jest.fn(async () => {login(null);}); useAuthStore.setState({signOut});
  mount(); const button = await screen.findByText('Me déconnecter et garder le suivi'); expect(signOut).not.toHaveBeenCalled();
  fireEvent.press(button);
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/account-deletion'));
  expect(signOut).toHaveBeenCalledWith({skipRemoteFcmCleanup: true, expectedUid: owner.uid, expectedGeneration: expect.any(Number)});
  expect((await AccountErasureJournal.discover(noView))?.phase).toBe('submitted');
});
it('does not navigate over B after a pending logout completion for closed account A', async () => {
  const pending = await AccountErasureJournal.beginSubmission(await AccountErasureService.prepare(owner.uid, noView), noView);
  const closed = {...receipt(pending, 'erasing'), accountAccessClosed: true};
  await AccountErasureJournal.record(pending, closed, noView);
  jest.mocked(expoFetch).mockResolvedValue({ok: true, status: 200, text: async () => JSON.stringify({result: closed})} as Response);
  let finish!: () => void; const signOut = jest.fn(async () => {await new Promise<void>(resolve => {finish = resolve;});});
  useAuthStore.setState({signOut}); mount(); fireEvent.press(await screen.findByText('Me déconnecter et garder le suivi'));
  await act(async () => {login(sdkUser('account-B')); finish();});
  expect(mockRouter.replace).not.toHaveBeenCalled(); expect(auth.currentUser?.uid).toBe('account-B');
});
