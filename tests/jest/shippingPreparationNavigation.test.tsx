import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {ActionSheetIOS} from 'react-native';
import ArticleShipping from '@/app/article/shipping/[id]';
import type {StripeAccountStatus} from '@/features/wallet/utils/stripeRequirements';

const mockRouter = {push: jest.fn(), replace: jest.fn(), back: jest.fn()};
const mockAccount = jest.fn();
const mockReadParcel = jest.fn();
const mockSaveParcel = jest.fn();
const readyAccount: StripeAccountStatus = {
  success: true, hasAccount: true, chargesEnabled: true, payoutsEnabled: true,
  detailsSubmitted: true, status: 'active', requirementsCurrentlyDue: [], requirementsPastDue: [],
  verificationErrors: [], requirementsPendingVerification: [], disabledReason: null,
  currentDeadline: null, bankAccountLast4: '6789',
};
const readyMessage = 'Votre compte est prêt à recevoir les paiements des acheteurs.';
const parcel = {weight: {value: 1, unit: 'kilogram'}, dimensions: {length: 40, width: 30, height: 12, unit: 'centimeter'}};
const recommendation = {source: 'automatic_profile', profileSize: 'medium', profileVersion: 1, parcel, recommendationBasis: 'listing_package_size'};
const missingParcel = {version: 0, parcel: null, status: 'missing', source: null, profileSize: null, profileVersion: null, recommendation};
let mockFocused = true;
let mockRevision = '1';
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
useRouter: () => mockRouter, useLocalSearchParams: () => ({id: 'article_one'})}));
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => 'seller'}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({focused: mockFocused, focusRevision: mockRevision,
  capture: () => ({revision: mockRevision}), assertCurrent: (operation: {revision: string}) => {
    if (!mockFocused || operation.revision !== mockRevision) throw Object.assign(new Error('Ancienne lecture'), {code: 'client/stale-operation'});
  }, start: () => ({revision: mockRevision}), finish: jest.fn(), isCurrent: (operation: {revision: string}) => mockFocused && operation.revision === mockRevision,
})}));
jest.mock('@/services/articlesService', () => ({ArticlesService: {getArticleById: async () => ({id: 'article_one', sellerId: 'seller', title: 'Article test'})}}));
jest.mock('@/services/shippingParcelService', () => ({ShippingParcelService: {
  read: (...args: unknown[]) => mockReadParcel(...args), saveAutomatic: (...args: unknown[]) => mockSaveParcel(...args),
}}));
jest.mock('expo-crypto', () => ({randomUUID: () => 'parcel_request'}));
jest.mock('@/services/sellerShippingAddressService', () => ({SellerShippingAddressService: {read: async () => ({selected: null})}}));
jest.mock('@/features/wallet/services/stripeAccountService', () => ({StripeAccountService: {getAccountStatus: (...args: unknown[]) => mockAccount(...args)}}));
jest.mock('@/utils/ordinaryShippingAddress', () => ({ordinaryPhysicalAddress: () => null, hasCurrentOrdinaryShippingDeclaration: async () => false}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: true, SHIPPING_LISTINGS_ENABLED: true}));
jest.mock('@/components/ui', () => {
  const React = require('react'), {Pressable, Text} = require('react-native');
  return {ScreenHeader: () => null, Input: () => null,
    Button: ({children, onPress, disabled}: {children: React.ReactNode; onPress: () => void; disabled?: boolean}) =>
      React.createElement(Pressable, {onPress, disabled}, React.createElement(Text, null, children))};
});

let client: QueryClient;
const readError = jest.fn();
beforeEach(() => {
  mockFocused = true; mockRevision = '1';
  mockAccount.mockResolvedValue(readyAccount);
  mockReadParcel.mockResolvedValue(missingParcel);
  mockSaveParcel.mockImplementation(async () => {
    mockReadParcel.mockResolvedValue({...missingParcel, version: 1, parcel, status: 'estimated', source: 'automatic_profile', profileSize: 'medium', profileVersion: 1});
  });
  client = new QueryClient({queryCache: new QueryCache({onError: readError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => client.clear());
const subject = () => <QueryClientProvider client={client}><ArticleShipping/></QueryClientProvider>;

it('opens an existing payment account with consultation intent instead of a setup return', async () => {
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Consulter mon compte de paiement')).toBeTruthy());
  fireEvent.press(view.getByText('Consulter mon compte de paiement'));
  expect(mockRouter.push).toHaveBeenCalledWith({pathname: '/settings/stripe-onboarding', params: {
    from: 'shipping-preparation', articleId: 'article_one', intent: 'manage',
  }});
});

it('cancels only the previous account read when navigation invalidates its context', async () => {
  let resolveAccount!: (value: {hasAccount: boolean}) => void;
  mockAccount.mockImplementationOnce(() => new Promise(resolve => {resolveAccount = resolve;}));
  const view = render(subject());
  await waitFor(() => expect(mockAccount).toHaveBeenCalledTimes(1));
  mockFocused = false; mockRevision = '2';
  view.rerender(subject());
  await act(async () => {resolveAccount({hasAccount: true});});
  expect(readError).not.toHaveBeenCalled();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

it('keeps a current provider failure visible instead of treating it as a cancelled read', async () => {
  const failure = new Error('Service indisponible');
  mockAccount.mockRejectedValueOnce(failure);
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Le statut du compte reste à vérifier.')).toBeTruthy());
  expect(readError).toHaveBeenCalledWith(failure, expect.anything());
});

it.each([
  {name: 'restricted account', status: 'restricted', disabledReason: null, requirementsPastDue: []},
  {name: 'overdue information', status: 'active', disabledReason: null, requirementsPastDue: ['individual.phone']},
  {name: 'disabled account', status: 'active', disabledReason: 'rejected.fraud', requirementsPastDue: []},
])('does not promise buyer payments for $name even when charges remain enabled', async (state) => {
  mockAccount.mockResolvedValue({...readyAccount, ...state});
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Consultez les renseignements demandés pour terminer votre configuration.')).toBeTruthy());
  expect(view.queryByText(readyMessage)).toBeNull();
  fireEvent.press(view.getByText('Consulter mon compte de paiement'));
  expect(mockRouter.push).toHaveBeenCalledWith({pathname: '/settings/stripe-onboarding', params: {
    from: 'shipping-preparation', articleId: 'article_one', intent: 'manage',
  }});
});

it('allows buyer payments during a non-blocking review even when withdrawals are not ready', async () => {
  mockAccount.mockResolvedValue({...readyAccount, payoutsEnabled: false, status: 'pending_verification',
    disabledReason: 'requirements.pending_verification', requirementsPendingVerification: ['individual.verification.document']});
  const view = render(subject());
  await waitFor(() => expect(view.getByText(readyMessage)).toBeTruthy());
});

it('shows the current refresh instead of promising payments from cached account data', async () => {
  client.setQueryData(['article-shipping-payment-account', 'seller', 1, 'article_one', '1'], readyAccount);
  let resolveAccount!: (value: StripeAccountStatus) => void;
  mockAccount.mockImplementationOnce(() => new Promise(resolve => {resolveAccount = resolve;}));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Vérification du compte de paiement…')).toBeTruthy());
  expect(view.queryByText(readyMessage)).toBeNull();
  await act(async () => {resolveAccount(readyAccount);});
  await waitFor(() => expect(view.getByText(readyMessage)).toBeTruthy());
});

it('keeps a failed refresh visible even when cached account data allowed buyer payments', async () => {
  client.setQueryData(['article-shipping-payment-account', 'seller', 1, 'article_one', '1'], readyAccount);
  mockAccount.mockRejectedValueOnce(new Error('Service indisponible'));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Le statut du compte reste à vérifier.')).toBeTruthy());
  expect(view.queryByText(readyMessage)).toBeNull();
  expect(view.getByText('Consulter mon compte de paiement')).toBeTruthy();
});

it('shows the recommended format without asking for measurements or writing on mount', async () => {
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Moyen')).toBeTruthy());
  expect(view.queryByText('Poids (g)')).toBeNull();
  expect(view.queryByText('Longueur (cm)')).toBeNull();
  expect(mockSaveParcel).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Préparer mon colis'));
  await waitFor(() => expect(mockSaveParcel).toHaveBeenCalledWith('seller', 'article_one', 0, 'parcel_request', 'medium', expect.any(Function)));
  await waitFor(() => expect(view.queryByText('Préparer mon colis')).toBeNull());
  expect(view.getByText('Ajouter l’adresse d’envoi')).toBeTruthy();
});

it('keeps legacy measurements until an explicit simple format selection', async () => {
  mockReadParcel.mockResolvedValue({...missingParcel, version: 4, parcel, status: 'declared', source: 'seller_declared'});
  const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Colis enregistré')).toBeTruthy());
  expect(view.queryByText('Préparer mon colis')).toBeNull();
  expect(mockSaveParcel).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Modifier le format'));
  act(() => sheet.mock.calls[0][1](0));
  expect(view.getByText('Petit')).toBeTruthy();
  fireEvent.press(view.getByText('Préparer mon colis'));
  await waitFor(() => expect(mockSaveParcel).toHaveBeenCalledWith('seller', 'article_one', 4, 'parcel_request', 'small', expect.any(Function)));
  sheet.mockRestore();
});

it('does not save a new parcel version when the already prepared format is selected again', async () => {
  mockReadParcel.mockResolvedValue({...missingParcel, version: 3, parcel, status: 'estimated', source: 'automatic_profile', profileSize: 'medium', profileVersion: 1});
  const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Moyen')).toBeTruthy());
  fireEvent.press(view.getByText('Modifier le format'));
  act(() => sheet.mock.calls[0][1](1));
  expect(view.queryByText('Préparer mon colis')).toBeNull();
  expect(mockSaveParcel).not.toHaveBeenCalled();
  sheet.mockRestore();
});

it('ignores a format selection after its navigation context has changed', async () => {
  const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Moyen')).toBeTruthy());
  fireEvent.press(view.getByText('Modifier le format'));
  mockFocused = false;
  act(() => sheet.mock.calls[0][1](0));
  expect(view.queryByText('Petit')).toBeNull();
  expect(mockSaveParcel).not.toHaveBeenCalled();
  sheet.mockRestore();
});
