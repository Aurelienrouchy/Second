import React from 'react';
import {act, cleanup, fireEvent, render, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {AppState, type AppStateStatus} from 'react-native';
import {getDoc, getDocFromServer, doc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import {automaticShippingFamilyProfile} from '@/functions/src/shared/automaticShippingEstimate';
import type {ShippingParcelObservation} from '@/services/shippingParcelService';
import type {StripeAccountStatus} from '@/features/wallet/utils/stripeRequirements';
import ArticleShipping from '@/app/article/shipping/[id]';

let mockFocused = true;
const mockRouter = {push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true};
jest.mock('expo-router', () => ({
  useNavigation: () => ({isFocused: () => mockFocused, canGoBack: () => true}),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react'); React.useEffect(() => {if (mockFocused) return callback();}, [callback, mockFocused]);
  }, useRouter: () => mockRouter, useLocalSearchParams: () => ({id: 'article_one'}),
}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
// The phase2 preparation fixture explicitly opens these two rails. Guards,
// session store, services, parser and pure family estimator remain real.
jest.mock('@/config/featureFlags', () => ({...jest.requireActual('@/config/featureFlags'),
  PAYMENTS_ENABLED: true, SHIPPING_LISTINGS_ENABLED: true,
}));

const accountRpc = jest.fn(), parcelReadRpc = jest.fn(), parcelSaveRpc = jest.fn();
const readError = jest.fn();
const readyAccount: StripeAccountStatus = {
  success: true, hasAccount: true, chargesEnabled: true, payoutsEnabled: true,
  detailsSubmitted: true, status: 'active', requirementsCurrentlyDue: [], requirementsPastDue: [],
  verificationErrors: [], requirementsPendingVerification: [], disabledReason: null,
  currentDeadline: null, bankAccountLast4: '6789',
};
const readyMessage = 'Votre compte est prêt à recevoir les paiements des acheteurs.';
const dressFamily = automaticShippingFamilyProfile('dress');
const missingParcel = (): ShippingParcelObservation => ({articleId: 'article_one', version: 0, parcel: null, status: 'missing',
  measurementVerified: false, source: null, profileSize: null, profileVersion: null, profileFamily: null,
  recommendation: {...dressFamily, recommendationBasis: 'category_family'}});
const preparedParcel = (version = 1): ShippingParcelObservation => ({...missingParcel(), version, parcel: dressFamily.parcel,
  status: 'estimated', source: 'automatic_profile', profileSize: dressFamily.profileSize, profileVersion: 2, profileFamily: 'dress'});
type ParcelInput = {articleId: string; expectedVersion: number; requestId: string; profileVersion: 2; profileFamily: 'dress'; profileSize: 'medium'};
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
let client: QueryClient, serverParcel: ShippingParcelObservation;
let activity: AppStateStatus;
const originalActivity = Object.getOwnPropertyDescriptor(AppState, 'currentState');
const listeners = new Set<(state: AppStateStatus) => void>();
function subject() {return <QueryClientProvider client={client}><ArticleShipping/></QueryClientProvider>;}
function accountQueryKey() {
  const query = client.getQueryCache().findAll({queryKey: ['article-shipping-payment-account']})[0];
  expect(query).toBeDefined(); return query.queryKey;
}
function retainedPress(view: ReturnType<typeof render>, label: string): () => void {
  let node: ReturnType<typeof view.getByText> | null = view.getByText(label);
  while (node && typeof node.props.onPress !== 'function') node = node.parent;
  expect(node).not.toBeNull(); return node!.props.onPress as () => void;
}
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true; activity = 'active'; listeners.clear();
  Object.assign(jest.requireMock('@/config/featureFlags'), {PAYMENTS_ENABLED: true, SHIPPING_LISTINGS_ENABLED: true});
  establishIdentityFixture('seller'); serverParcel = missingParcel();
  Object.defineProperty(AppState, 'currentState', {configurable: true, get: () => activity});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    const listener = callback as (state: AppStateStatus) => void; listeners.add(listener); return {remove: () => {listeners.delete(listener);}};
  });
  (doc as jest.Mock).mockImplementation((_db: unknown, ...segments: string[]) => ({path: segments.join('/')}));
  (getDoc as jest.Mock).mockImplementation(async (reference: {path: string}) => {
    if (reference.path !== 'articles/article_one') throw new Error(`Unexpected document: ${reference.path}`);
    return {id: 'article_one', exists: () => true, data: () => ({sellerId: 'seller', title: 'Article test', isActive: true, isSold: false, images: []})};
  });
  (getDocFromServer as jest.Mock).mockImplementation(async (reference: {path: string}) => {
    if (reference.path !== 'users/seller') throw new Error(`Unexpected private document: ${reference.path}`);
    return {id: 'seller', exists: () => true, data: () => ({addresses: []})};
  });
  accountRpc.mockReset().mockResolvedValue(readyAccount);
  parcelReadRpc.mockReset().mockImplementation(async () => serverParcel);
  parcelSaveRpc.mockReset().mockImplementation(async (input: ParcelInput) => {
    serverParcel = preparedParcel(input.expectedVersion + 1); return {...serverParcel, replay: false};
  });
  (httpsCallable as jest.Mock).mockImplementation((_functions: unknown, name: string) => {
    if (name === 'getStripeAccountStatus' || name === 'getStripeAccountStatusV2') return async (input: unknown) => ({data: await accountRpc(input)});
    if (name === 'getArticleShippingParcel') return async (input: unknown) => ({data: await parcelReadRpc(input)});
    if (name === 'setArticleShippingParcel') return async (input: unknown) => ({data: await parcelSaveRpc(input)});
    throw new Error(`Unexpected RPC: ${name}`);
  });
  client = new QueryClient({queryCache: new QueryCache({onError: readError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {cleanup(); client.clear(); jest.restoreAllMocks(); clearIdentityFixture();
  if (originalActivity) Object.defineProperty(AppState, 'currentState', originalActivity);
});

it('opens an existing payment account with consultation intent instead of a setup return', async () => {
  const view = render(subject());
  fireEvent.press(await view.findByText('Consulter mon compte de paiement'));
  expect(mockRouter.push).toHaveBeenCalledWith({pathname: '/settings/stripe-onboarding', params: {
    from: 'shipping-preparation', articleId: 'article_one', intent: 'manage',
  }});
});

it('cancels only the previous account read when navigation invalidates its context', async () => {
  const pending = deferred<StripeAccountStatus>(); accountRpc.mockReturnValueOnce(pending.promise);
  const view = render(subject()); await waitFor(() => expect(accountRpc).toHaveBeenCalledTimes(1));
  mockFocused = false; view.rerender(subject());
  await act(async () => {pending.resolve(readyAccount);});
  expect(readError).not.toHaveBeenCalled(); expect(mockRouter.back).not.toHaveBeenCalled();
});

it('keeps a current provider failure visible instead of treating it as a cancelled read', async () => {
  const failure = new Error('Service indisponible'); accountRpc.mockRejectedValueOnce(failure);
  const view = render(subject()); await view.findByText('Le statut du compte reste à vérifier.');
  expect(readError).toHaveBeenCalledWith(failure, expect.anything());
});

it.each([
  {name: 'restricted account', status: 'restricted', disabledReason: null, requirementsPastDue: []},
  {name: 'overdue information', status: 'active', disabledReason: null, requirementsPastDue: ['individual.phone']},
  {name: 'disabled account', status: 'active', disabledReason: 'rejected.fraud', requirementsPastDue: []},
])('does not promise buyer payments for $name even when charges remain enabled', async state => {
  accountRpc.mockResolvedValue({...readyAccount, ...state}); const view = render(subject());
  await view.findByText('Consultez les renseignements demandés pour terminer votre configuration.');
  expect(view.queryByText(readyMessage)).toBeNull(); fireEvent.press(view.getByText('Consulter mon compte de paiement'));
  expect(mockRouter.push).toHaveBeenCalledWith({pathname: '/settings/stripe-onboarding', params: {
    from: 'shipping-preparation', articleId: 'article_one', intent: 'manage',
  }});
});

it('allows buyer payments during a non-blocking review even when withdrawals are not ready', async () => {
  accountRpc.mockResolvedValue({...readyAccount, payoutsEnabled: false, status: 'pending_verification',
    disabledReason: 'requirements.pending_verification', requirementsPendingVerification: ['individual.verification.document']});
  const view = render(subject()); await view.findByText(readyMessage);
});

it('shows the current refresh instead of promising payments from cached account data', async () => {
  const view = render(subject()); await view.findByText(readyMessage);
  const pending = deferred<StripeAccountStatus>(); accountRpc.mockReturnValueOnce(pending.promise);
  act(() => {void client.invalidateQueries({queryKey: accountQueryKey()});});
  await view.findByText('Vérification du compte de paiement…'); expect(view.queryByText(readyMessage)).toBeNull();
  await act(async () => {pending.resolve(readyAccount);}); await view.findByText(readyMessage);
});

it('keeps a failed refresh visible even when cached account data allowed buyer payments', async () => {
  const view = render(subject()); await view.findByText(readyMessage);
  accountRpc.mockRejectedValueOnce(new Error('Service indisponible'));
  act(() => {void client.invalidateQueries({queryKey: accountQueryKey()});});
  await view.findByText('Le statut du compte reste à vérifier.');
  expect(view.queryByText(readyMessage)).toBeNull(); expect(view.getByText('Consulter mon compte de paiement')).toBeTruthy();
});

it('shows the native familyV2 estimate without asking for measurements or writing on mount, then records only the explicit exact version', async () => {
  const view = render(subject()); await view.findByText('Robe et jupe');
  expect(view.queryByText('Poids (g)')).toBeNull(); expect(view.queryByText('Longueur (cm)')).toBeNull();
  expect(parcelSaveRpc).not.toHaveBeenCalled(); const oldSave = retainedPress(view, 'Préparer mon colis');
  fireEvent.press(view.getByText('Préparer mon colis'));
  await waitFor(() => expect(parcelSaveRpc).toHaveBeenCalledTimes(1));
  expect(parcelSaveRpc).toHaveBeenCalledWith({articleId: 'article_one', expectedVersion: 0,
    requestId: expect.stringMatching(/^[a-f0-9-]{36}$/), profileVersion: 2, profileFamily: 'dress', profileSize: 'medium'});
  await waitFor(() => expect(view.queryByText('Préparer mon colis')).toBeNull());
  expect(view.getByText('Ajouter l’adresse d’envoi')).toBeTruthy();
  act(() => oldSave()); expect(parcelSaveRpc).toHaveBeenCalledTimes(1);
});

it('keeps legacy declared measurements untouched and does not invent an unsupported migration selector', async () => {
  const legacyParcel = {weight: {value: 1, unit: 'kilogram' as const}, dimensions: {length: 40, width: 30, height: 12, unit: 'centimeter' as const}};
  serverParcel = {...missingParcel(), version: 4, parcel: legacyParcel, status: 'declared', source: 'seller_declared'};
  const original = serverParcel; const view = render(subject()); await view.findByText('Colis enregistré');
  expect(view.queryByText('Préparer mon colis')).toBeNull(); expect(view.queryByText('Modifier le format')).toBeNull();
  expect(view.queryByText('Actualiser mon colis')).toBeNull(); expect(parcelSaveRpc).not.toHaveBeenCalled(); expect(serverParcel).toBe(original);
});

it('does not save a new parcel version when its already prepared family is still the recommendation', async () => {
  serverParcel = preparedParcel(3); const view = render(subject()); await view.findByText('Robe et jupe');
  expect(view.queryByText('Préparer mon colis')).toBeNull(); expect(view.queryByText('Actualiser mon colis')).toBeNull();
  act(() => {void client.invalidateQueries({queryKey: ['article-shipping-preparation']});});
  await waitFor(() => expect(parcelReadRpc).toHaveBeenCalledTimes(2));
  expect(parcelSaveRpc).not.toHaveBeenCalled(); expect(serverParcel.version).toBe(3);
});

it('ignores a retained preparation action after its real navigation context has changed', async () => {
  const view = render(subject()); await view.findByText('Robe et jupe'); const oldSave = retainedPress(view, 'Préparer mon colis');
  mockFocused = false; view.rerender(subject()); act(() => oldSave());
  expect(parcelSaveRpc).not.toHaveBeenCalled(); expect(serverParcel.version).toBe(0);
});

it('updates a changed familyV2 only after an explicit current action using the original version', async () => {
  const oldFamily = automaticShippingFamilyProfile('knitwear');
  serverParcel = {...preparedParcel(4), parcel: oldFamily.parcel, profileFamily: 'knitwear'};
  const view = render(subject()); await view.findByText('Robe et jupe'); expect(parcelSaveRpc).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Actualiser mon colis'));
  await waitFor(() => expect(parcelSaveRpc).toHaveBeenCalledTimes(1));
  expect(parcelSaveRpc).toHaveBeenCalledWith(expect.objectContaining({expectedVersion: 4, profileVersion: 2, profileFamily: 'dress', profileSize: 'medium'}));
  await waitFor(() => expect(view.queryByText('Actualiser mon colis')).toBeNull()); expect(serverParcel.version).toBe(5);
});

it('does not read or write parcel/account sources when the V1 commerce flags are closed', async () => {
  Object.assign(jest.requireMock('@/config/featureFlags'), {PAYMENTS_ENABLED: false, SHIPPING_LISTINGS_ENABLED: false});
  const view = render(subject()); await view.findByText('La préparation des expéditions n’est pas disponible.');
  expect(accountRpc).not.toHaveBeenCalled(); expect(parcelReadRpc).not.toHaveBeenCalled(); expect(parcelSaveRpc).not.toHaveBeenCalled();
  expect(getDoc).not.toHaveBeenCalled(); expect(getDocFromServer).not.toHaveBeenCalled();
});
