import React from 'react';
import {AppState, Keyboard} from 'react-native';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';

let mockParams: Record<string, string> = {};
let mockAttempt: unknown = null;
let mockPaymentAttempt: unknown = null;
let mockConfirmed = false;
let mockRealShippingComponents = false;
let mockIdentity: unknown = null;
const mockRouter = {push: jest.fn(), back: jest.fn(), replace: jest.fn()};
const mockReserve = jest.fn(), mockQuote = jest.fn(), mockObservePayment = jest.fn(), mockConfirmPayment = jest.fn();
const mockPreparationPolicy = jest.fn();
const mockReadOrder = jest.fn(), mockReadShippingAttempt = jest.fn(), mockWalletPay = jest.fn(), mockRememberPayment = jest.fn(), mockQueryError = jest.fn();
const mockAddressSearch = jest.fn();
const mockOrder = {id: 'order', buyerId: 'owner', sellerId: 'seller', articleId: 'article', deliveryType: 'shipping',
  status: 'pending_payment', amount: 32, totalAmount: 37, shippingQuoteId: 'quote', shipEngineRateId: 'rate', stripePaymentIntentId: 'pi_test' as string | undefined,
  shippingAddress: {province: 'QC', country: 'CA'}, currency: 'CAD'};
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({authenticatedUid: 'owner', user: {id: 'owner'}}))};
});
jest.mock('expo-router', () => ({useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams, Redirect: () => null,
  useFocusEffect: (callback: () => () => void) => {const React = require('react'); React.useEffect(callback, [callback]);}}));
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedSession: () => ({uid: 'owner', identity: mockIdentity}), useAuthenticatedUid: () => 'owner', useUser: () => ({id: 'owner'})}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/hooks/useTradeAdmissionError', () => ({useTradeAdmissionError: () => () => false}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: true, SHIPPING_ENABLED: true, DEV_COMMERCE_TESTING_ENABLED: true}));
jest.mock('@/services/articlesService', () => ({ArticlesService: {getArticleById: async () => ({id: 'article', sellerId: 'seller', isActive: true, isSold: false, isShipping: true, price: 40})}}));
jest.mock('@/services/addressAutocompleteService', () => ({searchCanadianAddresses: (...args: unknown[]) => mockAddressSearch(...args)}));
jest.mock('expo-crypto', () => ({CryptoDigestAlgorithm: {SHA256: 'SHA-256'}, digestStringAsync: jest.fn(async () => 'c'.repeat(64))}));
jest.mock('@/services/shippingPurchaseService', () => ({ShippingPurchaseService: {
  readAttempt: (...args: unknown[]) => mockReadShippingAttempt(...args), quote: (...args: unknown[]) => mockQuote(...args), requiresPreparationPolicy: () => false,
  readPreparationPolicy: async () => null, hasCommittedCancellation: () => false,
  assertNewPreparationPolicy: (...args: unknown[]) => mockPreparationPolicy(...args),
}, isShippingQuoteExpiredError: () => false, shippingLaunchErrorMessage: () => null}));
jest.mock('@/services/transactionService', () => ({TransactionService: {
  reserveShippingPurchase: (...args: unknown[]) => mockReserve(...args), getTransaction: (...args: unknown[]) => mockReadOrder(...args),
}}));
jest.mock('@/services/manualPaymentService', () => ({
  exactPaymentCents: (value: number) => Math.round(value * 100), hasConfirmedPurchasePayment: () => mockConfirmed,
  hasExistingPaymentExposure: (order: {stripePaymentIntentId?: string}) => !!order.stripePaymentIntentId,
  canReadExistingCheckoutWithoutCreation: (order: {stripePaymentIntentId?: string}) => !!order.stripePaymentIntentId,
  ManualPaymentService: {run: async (_uid: string, _id: string, _assert: unknown, work: () => Promise<void>) => work(),
    readAttempt: async () => mockPaymentAttempt, remember: (...args: unknown[]) => mockRememberPayment(...args),
    observe: (...args: unknown[]) => mockObservePayment(...args), confirm: (...args: unknown[]) => mockConfirmPayment(...args)},
}));
jest.mock('@/features/wallet/hooks/useWallet', () => ({useWallet: () => ({wallet: null, refetch: jest.fn()})}));
jest.mock('@/features/wallet/services/walletService', () => ({WalletService: {payWithWallet: (...args: unknown[]) => mockWalletPay(...args)}}));
jest.mock('@/features/orders', () => ({OrderArticleSummary: () => null}));
jest.mock('@/features/checkout-shipping', () => {
  const React = require('react');
  const actual = (module: string, name: string) => (props: unknown) => mockRealShippingComponents ? React.createElement(jest.requireActual(module)[name], props) : null;
  return {INITIAL_ADDRESS: {fullName: '', address: '', city: '', province: '', postalCode: '', apartment: ''},
    ShippingAddressForm: actual('@/features/checkout-shipping/components/ShippingAddressForm', 'ShippingAddressForm'),
    ShippingEstimateList: actual('@/features/checkout-shipping/components/ShippingEstimateList', 'ShippingEstimateList'),
    PriceBreakdown: actual('@/features/checkout-shipping/components/PriceBreakdown', 'PriceBreakdown'),
    PayButton: actual('@/features/checkout-shipping/components/PayButton', 'PayButton'),
    ShippingPurchaseConditions: actual('@/features/checkout-shipping/components/ShippingPurchaseConditions', 'ShippingPurchaseConditions'), ShippingCheckoutSkeleton: () => null};
});
jest.mock('@/components/OrdinaryShippingAddressChoice', () => ({OrdinaryShippingAddressChoice: (props: unknown) => {
  const React = require('react'); return mockRealShippingComponents ? React.createElement(jest.requireActual('@/components/OrdinaryShippingAddressChoice').OrdinaryShippingAddressChoice, props) : null;
}}));
jest.mock('@/components/ShippingTransportTerms', () => ({ShippingTransportTerms: () => null}));
jest.mock('@/components/RefundStatusNotice', () => ({RefundStatusNotice: () => null}));
jest.mock('@/lib/stripe', () => ({CardField: () => null, useStripe: () => ({createPaymentMethod: jest.fn(), handleNextAction: jest.fn()})}));
jest.mock('@/components/ui', () => {
  const React = require('react'); const {Pressable, Text, View} = require('react-native');
  return {ScreenHeader: ({rightContent}: {rightContent?: React.ReactNode}) => React.createElement(View, null, rightContent), Checkbox: ({children, onToggle, checked, disabled, accessibilityLabel}: {children: React.ReactNode; onToggle: () => void; checked: boolean; disabled?: boolean; accessibilityLabel?: string}) =>
      React.createElement(Pressable, {onPress: onToggle, disabled, accessibilityRole: 'checkbox', accessibilityLabel, accessibilityState: {checked}}, children),
    Button: ({children, onPress, disabled}: {children: React.ReactNode; onPress: () => void; disabled?: boolean}) =>
      React.createElement(Pressable, {onPress, disabled}, React.createElement(Text, null, children))};
});
import ShippingCheckout from '@/app/checkout/shipping';
import Payment from '@/app/payment/[transactionId]';
import CheckoutSuccess from '@/app/checkout/success';

let client: QueryClient;
const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
function wrapper({children}: {children: React.ReactNode}) {return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'owner'};
  mockAttempt = null; mockPaymentAttempt = null; mockConfirmed = false; mockIdentity = null; mockRealShippingComponents = false;
  mockOrder.status = 'pending_payment';
  mockOrder.stripePaymentIntentId = 'pi_test';
  mockReadOrder.mockResolvedValue(mockOrder);
  mockReadShippingAttempt.mockImplementation(async () => mockAttempt);
  mockAddressSearch.mockResolvedValue([]);
  mockRememberPayment.mockImplementation(async attempt => {mockPaymentAttempt = attempt;});
  mockWalletPay.mockImplementation(async () => {mockOrder.status = 'paid'; mockConfirmed = true;
    return {success: true, transactionId: 'order', paymentCommitted: true, replay: false, currentStatus: 'paid'};});
  mockPreparationPolicy.mockResolvedValue(undefined);
  mockReserve.mockImplementation(async () => {mockAttempt = {...mockAttempt as object, receipt: {transactionId: 'order', replay: true}}; return {transactionId: 'order', replay: true};});
  mockObservePayment.mockResolvedValue({protocol: 'server_manual_v1', transactionId: 'order', intentVersion: 1, totalCents: 3700,
    walletCents: 0, cardCents: 3700, confirmationRequired: true, action: 'confirmOnServer', providerStatus: 'requires_confirmation'});
  client = new QueryClient({queryCache: new QueryCache({onError: mockQueryError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {client.clear(); if (originalState) Object.defineProperty(AppState, 'currentState', originalState);});

it('automatically recovers the exact accepted reservation, without requesting another quote or starting payment', async () => {
  mockParams = {articleId: 'article'};
  const destination = {street: 'Rue exemple', city: 'Montréal', province: 'QC', postalCode: 'H2J2K1', country: 'CA'};
  const input = {deliveryType: 'shipping', quoteId: 'quote', rateId: 'rate', expectedTotal: 37};
  mockAttempt = {articleId: 'article', destination, input};
  render(<ShippingCheckout/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Continuer vers le paiement')).toBeTruthy());
  expect(mockReserve).toHaveBeenCalledTimes(1);
  expect(mockReserve).toHaveBeenCalledWith('owner', 'article', destination, input, expect.any(Function), true);
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/payment/[transactionId]', params: {transactionId: 'order'}}));
  expect(mockQuote).not.toHaveBeenCalled(); expect(mockObservePayment).not.toHaveBeenCalled(); expect(mockConfirmPayment).not.toHaveBeenCalled();
});

it('opens the order after its payment is confirmed, without dispatching another payment', async () => {
  mockParams = {transactionId: 'order'}; mockOrder.status = 'paid'; mockConfirmed = true;
  render(<Payment/>, {wrapper});
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'order'}}));
  expect(mockConfirmPayment).not.toHaveBeenCalled(); expect(mockReserve).not.toHaveBeenCalled();
});

it('skips the intermediate success page only after a confirmed native payment', async () => {
  mockParams = {transactionId: 'order', deliveryType: 'shipping'}; mockOrder.status = 'paid'; mockConfirmed = true;
  render(<CheckoutSuccess/>, {wrapper});
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'order'}}));
  expect(mockConfirmPayment).not.toHaveBeenCalled(); expect(mockObservePayment).not.toHaveBeenCalled();
});

it('keeps an unconfirmed payment in a clear waiting state instead of claiming success', async () => {
  mockParams = {transactionId: 'order', deliveryType: 'shipping'};
  render(<CheckoutSuccess/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Consulter cette commande')).toBeTruthy());
  expect(screen.getByText('Paiement en cours')).toBeTruthy();
  expect(mockRouter.replace).not.toHaveBeenCalled(); expect(mockConfirmPayment).not.toHaveBeenCalled();
});

it('automatically observes an existing payment and leaves its confirmation to the buyer', async () => {
  mockParams = {transactionId: 'order'};
  render(<Payment/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Confirmer le paiement')).toBeTruthy());
  expect(mockObservePayment).toHaveBeenCalledTimes(1);
  expect(mockObservePayment).toHaveBeenCalledWith('owner', mockOrder, undefined, expect.any(Function), true);
  expect(mockConfirmPayment).not.toHaveBeenCalled();
});

it('explicitly resumes the same interrupted card preparation with its original wallet share, without charging', async () => {
  mockParams = {transactionId: 'order'};
  mockOrder.stripePaymentIntentId = undefined;
  const attempt = {version: 1, uid: 'owner', transactionId: 'order', mode: 'card', phase: 'prepare_requested', totalCents: 3700, walletCents: 500};
  mockPaymentAttempt = attempt;
  mockObservePayment.mockResolvedValue({protocol: 'server_manual_v1', transactionId: 'order', intentVersion: 1, totalCents: 3700,
    walletCents: 500, cardCents: 3200, confirmationRequired: true, action: 'confirmOnServer', providerStatus: 'requires_confirmation'});
  render(<Payment/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Actualiser le paiement')).toBeTruthy());
  expect(mockObservePayment).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Actualiser le paiement'));
  await waitFor(() => expect(screen.getByText('Confirmer le paiement')).toBeTruthy());
  expect(mockPreparationPolicy).toHaveBeenCalledWith('owner', mockOrder, expect.any(Function));
  expect(mockObservePayment).toHaveBeenCalledTimes(1);
  expect(mockObservePayment).toHaveBeenCalledWith('owner', mockOrder, attempt, expect.any(Function), false);
  expect(mockConfirmPayment).not.toHaveBeenCalled();
});

it.each([{phase: 'confirmation_requested'}, {phase: 'prepare_requested', intentVersion: 1}, {phase: 'prepare_requested', totalCents: 4000}])(
  'does not recreate a preparation from later or changed payment terms: %p', async changed => {
    mockParams = {transactionId: 'order'}; mockOrder.stripePaymentIntentId = undefined;
    mockPaymentAttempt = {version: 1, uid: 'owner', transactionId: 'order', mode: 'card', phase: 'prepare_requested', totalCents: 3700, walletCents: 500, ...changed};
    render(<Payment/>, {wrapper});
    await waitFor(() => expect(screen.getByText('Actualiser le paiement')).toBeTruthy());
    fireEvent.press(screen.getByText('Actualiser le paiement'));
    await waitFor(() => expect(screen.getByText(/^Impossible de reprendre ce paiement/)).toBeTruthy());
    expect(mockObservePayment).not.toHaveBeenCalled(); expect(mockConfirmPayment).not.toHaveBeenCalled(); expect(mockPreparationPolicy).not.toHaveBeenCalled();
  },
);

const walletAttempt = () => ({version: 1, uid: 'owner', transactionId: 'order', mode: 'wallet', phase: 'wallet_requested', totalCents: 3700, walletCents: 3700});

it('restores an interrupted wallet payment without sending any card or wallet command automatically', async () => {
  mockParams = {transactionId: 'order'}; mockOrder.stripePaymentIntentId = undefined; mockPaymentAttempt = walletAttempt();
  render(<Payment/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Reprendre le paiement avec mon solde')).toBeTruthy());
  expect(mockWalletPay).not.toHaveBeenCalled(); expect(mockObservePayment).not.toHaveBeenCalled();
  expect(screen.queryByText('Annuler la commande')).toBeNull();
  fireEvent.press(screen.getByLabelText('Options du paiement'));
  fireEvent.press(screen.getByText('Actualiser le paiement'));
  await waitFor(() => expect(screen.getByText('Le paiement avec votre solde n’est pas encore confirmé. Vous pouvez le reprendre ci-dessous.')).toBeTruthy());
  expect(mockWalletPay).not.toHaveBeenCalled(); expect(mockObservePayment).not.toHaveBeenCalled();
});

it('replays only the same wallet order on an explicit click and recognizes payment from the current order', async () => {
  mockParams = {transactionId: 'order'}; mockOrder.stripePaymentIntentId = undefined; mockPaymentAttempt = walletAttempt();
  render(<Payment/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Reprendre le paiement avec mon solde')).toBeTruthy());
  fireEvent.press(screen.getByText('Reprendre le paiement avec mon solde'));
  fireEvent.press(screen.getByText('Reprendre le paiement avec mon solde'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'order'}}));
  expect(mockWalletPay).toHaveBeenCalledTimes(1);
  expect(mockWalletPay).toHaveBeenCalledWith('order', {expectedUid: 'owner', assertCurrent: expect.any(Function)});
  expect(mockRememberPayment).toHaveBeenCalledWith(expect.objectContaining({mode: 'wallet', phase: 'settled', transactionId: 'order'}), expect.any(Function));
  expect(mockObservePayment).not.toHaveBeenCalled(); expect(mockConfirmPayment).not.toHaveBeenCalled();
});

it('does not debit again when the fresh order proves that the wallet payment already completed', async () => {
  mockParams = {transactionId: 'order'}; mockOrder.stripePaymentIntentId = undefined; mockPaymentAttempt = walletAttempt();
  render(<Payment/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Reprendre le paiement avec mon solde')).toBeTruthy());
  mockReadOrder.mockImplementation(async () => {mockConfirmed = true; return {...mockOrder, status: 'paid'};});
  fireEvent.press(screen.getByText('Reprendre le paiement avec mon solde'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'order'}}));
  expect(mockWalletPay).not.toHaveBeenCalled(); expect(mockObservePayment).not.toHaveBeenCalled();
});

it('refuses a wallet recovery whose current total differs from the recorded amount', async () => {
  mockParams = {transactionId: 'order'}; mockOrder.stripePaymentIntentId = undefined; mockPaymentAttempt = walletAttempt();
  render(<Payment/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Reprendre le paiement avec mon solde')).toBeTruthy());
  mockReadOrder.mockResolvedValue({...mockOrder, totalAmount: 38});
  fireEvent.press(screen.getByText('Reprendre le paiement avec mon solde'));
  await waitFor(() => expect(screen.getByText('Le montant du paiement a changé. Consultez la commande avant de poursuivre.')).toBeTruthy());
  expect(mockWalletPay).not.toHaveBeenCalled(); expect(mockObservePayment).not.toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled();
});

it('does not continue a wallet payment after the app loses its active scope', async () => {
  mockParams = {transactionId: 'order'}; mockOrder.stripePaymentIntentId = undefined; mockPaymentAttempt = walletAttempt();
  let complete!: () => void;
  mockPreparationPolicy.mockImplementationOnce(() => new Promise<void>(resolve => {complete = resolve;}));
  render(<Payment/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Reprendre le paiement avec mon solde')).toBeTruthy());
  fireEvent.press(screen.getByText('Reprendre le paiement avec mon solde'));
  await waitFor(() => expect(mockPreparationPolicy).toHaveBeenCalled());
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'background'});
  await act(async () => {complete();});
  expect(mockWalletPay).not.toHaveBeenCalled(); expect(mockObservePayment).not.toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled();
});

it.each(['payment', 'shipping', 'success'] as const)('silently cancels a pending %s read after leaving that page', async page => {
  let fail!: (error: unknown) => void;
  const response = new Promise<unknown>((_resolve, reject) => {fail = reject;});
  mockReadOrder.mockReturnValue(response);
  mockReadShippingAttempt.mockReturnValue(response);
  mockParams = page === 'shipping' ? {articleId: 'article'} : {transactionId: 'order', deliveryType: 'shipping'};
  const view = render(page === 'payment' ? <Payment/> : page === 'shipping' ? <ShippingCheckout/> : <CheckoutSuccess/>, {wrapper});
  await waitFor(() => expect(page === 'shipping' ? mockReadShippingAttempt : mockReadOrder).toHaveBeenCalled());
  view.unmount();
  await act(async () => {fail(new Error('Old page request finished after leaving'));});
  expect(mockQueryError).not.toHaveBeenCalled(); expect(mockWalletPay).not.toHaveBeenCalled(); expect(mockConfirmPayment).not.toHaveBeenCalled();
});

const profile = {id: 'owner', displayName: 'Alice Test', address: {street: '123 Rue Test', line2: 'Appartement 5', city: 'Montréal', province: 'QC', postalCode: 'H2J 2K1', country: 'CA'}};
const addressSuggestion = {id: 'suggestion', label: '4899 Avenue du Parc, Montréal, QC, H2V 4E7', street: '4899 Avenue du Parc', city: 'Montréal', province: 'QC', postalCode: 'H2V 4E7', country: 'Canada'};

it('keeps a complete profile address compact until the member chooses to modify it', async () => {
  mockParams = {articleId: 'article'}; mockIdentity = profile; mockRealShippingComponents = true;
  render(<ShippingCheckout/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Livrer à')).toBeTruthy());
  expect(screen.queryByLabelText('Rechercher une adresse')).toBeNull();
  fireEvent.press(screen.getByLabelText('Modifier l’adresse de livraison'));
  expect(screen.getByDisplayValue('123 Rue Test')).toBeTruthy();
  expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy();
  expect(mockReserve).not.toHaveBeenCalled(); expect(mockQuote).not.toHaveBeenCalled();
});

it('defaults a new blank destination to Quebec but never rewrites an existing Ontario address', async () => {
  mockParams = {articleId: 'article'}; mockRealShippingComponents = true;
  const blank = render(<ShippingCheckout/>, {wrapper});
  await waitFor(() => expect(screen.getByRole('radio', {name: 'Québec'}).props.accessibilityState.checked).toBe(true));
  blank.unmount();
  mockIdentity = {...profile, address: {...profile.address, city: 'Ottawa', province: 'ON', postalCode: 'K1A 0B1'}};
  render(<ShippingCheckout/>, {wrapper});
  await waitFor(() => expect(screen.getByRole('radio', {name: 'Québec'}).props.accessibilityState.checked).toBe(false));
  expect(screen.getByDisplayValue('Ottawa')).toBeTruthy(); expect(screen.getByDisplayValue('K1A 0B1')).toBeTruthy();
  expect(screen.getByText('L’adresse actuelle est hors Québec. Indiquez une adresse de livraison au Québec.')).toBeTruthy();
});

it('fills the selected Quebec suggestion without losing name/apartment or creating a reservation', async () => {
  mockParams = {articleId: 'article'}; mockIdentity = profile; mockRealShippingComponents = true;
  mockAddressSearch.mockResolvedValue([addressSuggestion, {...addressSuggestion, id: 'outside', label: 'Ontario result', province: 'ON'}]);
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  render(<ShippingCheckout/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Livrer à')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Modifier l’adresse de livraison'));
  fireEvent.changeText(screen.getByLabelText('Rechercher une adresse'), '4899 parc');
  await waitFor(() => expect(screen.getByRole('button', {name: addressSuggestion.label})).toBeTruthy());
  expect(screen.queryByText('Ontario result')).toBeNull();
  fireEvent.press(screen.getByRole('button', {name: addressSuggestion.label}));
  expect(dismiss).toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Modifier l’adresse de livraison'));
  expect(screen.getByDisplayValue('4899 Avenue du Parc')).toBeTruthy(); expect(screen.getByDisplayValue('Montréal')).toBeTruthy();
  expect(screen.getByDisplayValue('H2V 4E7')).toBeTruthy(); expect(screen.getByDisplayValue('Alice Test')).toBeTruthy(); expect(screen.getByDisplayValue('Appartement 5')).toBeTruthy();
  expect(mockQuote).not.toHaveBeenCalled(); expect(mockReserve).not.toHaveBeenCalled();
  dismiss.mockRestore();
});

it('ignores an older autocomplete response after the address text has changed', async () => {
  mockParams = {articleId: 'article'}; mockIdentity = profile; mockRealShippingComponents = true;
  let complete!: (value: typeof addressSuggestion[]) => void;
  mockAddressSearch.mockImplementationOnce(() => new Promise(resolve => {complete = resolve;}));
  mockAddressSearch.mockResolvedValueOnce([{...addressSuggestion, id: 'new', label: 'Nouvelle recherche'}]);
  render(<ShippingCheckout/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Livrer à')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Modifier l’adresse de livraison'));
  fireEvent.changeText(screen.getByLabelText('Rechercher une adresse'), 'premiere');
  await waitFor(() => expect(mockAddressSearch).toHaveBeenCalledTimes(1));
  fireEvent.changeText(screen.getByLabelText('Rechercher une adresse'), 'deuxieme');
  await waitFor(() => expect(screen.getByRole('button', {name: 'Nouvelle recherche'})).toBeTruthy());
  await act(async () => {complete([addressSuggestion]);});
  expect(screen.queryByText(addressSuggestion.label)).toBeNull(); expect(mockReserve).not.toHaveBeenCalled();
});

it.each(['pending_payment', 'label_created'])('opens the exact existing %s order without a new quote or reservation', async status => {
  mockParams = {existingTransactionId: 'order', articleId: 'article'}; mockOrder.status = status;
  mockAttempt = {articleId: 'article', receipt: {transactionId: 'another-order', replay: true}};
  client.setQueryData(['shipping-reservation', 'owner', 1, 'article', 1], mockAttempt);
  const service = jest.requireMock('@/services/transactionService').TransactionService;
  service.readExistingShippingReservation = jest.fn(async () => ({transactionId: 'order', replay: true}));
  render(<ShippingCheckout/>, {wrapper});
  const label = status === 'pending_payment' ? 'Continuer vers le paiement' : 'Suivre ma commande';
  await waitFor(() => expect(screen.getByText(label)).toBeTruthy());
  fireEvent.press(screen.getByText(label));
  expect(mockRouter.push).toHaveBeenCalledWith(status === 'pending_payment'
    ? {pathname: '/payment/[transactionId]', params: {transactionId: 'order'}}
    : {pathname: '/orders/[id]', params: {id: 'order'}});
  expect(mockReadShippingAttempt).not.toHaveBeenCalled();
  expect(mockReadOrder).toHaveBeenCalledWith('order', expect.any(Object));
  expect(mockReadOrder).not.toHaveBeenCalledWith('another-order', expect.anything());
  expect(mockQuote).not.toHaveBeenCalled(); expect(mockReserve).not.toHaveBeenCalled();
});

it('never opens an existing order from a receipt for a different route target', async () => {
  mockParams = {existingTransactionId: 'order', articleId: 'article'};
  const service = jest.requireMock('@/services/transactionService').TransactionService;
  service.readExistingShippingReservation = jest.fn(async () => ({transactionId: 'another-order', replay: true}));
  render(<ShippingCheckout/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Impossible de vérifier cette commande.')).toBeTruthy());
  expect(screen.queryByText('Continuer vers le paiement')).toBeNull();
  expect(screen.queryByText('Suivre ma commande')).toBeNull();
  expect(mockReadOrder).not.toHaveBeenCalled(); expect(mockReadShippingAttempt).not.toHaveBeenCalled();
  expect(mockReserve).not.toHaveBeenCalled(); expect(mockQuote).not.toHaveBeenCalled();
});

it('clears the quoted rate and explicit total acceptance when a suggestion changes the destination', async () => {
  mockParams = {articleId: 'article'}; mockIdentity = profile; mockRealShippingComponents = true;
  mockAddressSearch.mockResolvedValue([addressSuggestion]);
  mockQuote.mockImplementation(async (_uid: string, _article: string, destination: unknown) => ({quoteId: 'quote', destination,
    serverTime: Date.now(), validUntil: Date.now() + 600000, item: {title: 'Veste'},
    rates: [{rateId: 'rate', carrierFriendlyName: 'Test', serviceType: 'Standard', estimatedDeliveryDays: null, amount: 32, shippingCost: 2, serviceFee: 3, taxTotal: 0, totalAmount: 37, componentsCents: {insurance: 0}}],
    taxSnapshot: {gst: 0, qst: 0, taxTotal: 0}, transport: {testMode: 'seconde_dev_commerce_v1'},
    purchasePolicy: {policyVersion: 'shipping_purchase_2026_02', hash: 'd'.repeat(64), parameters: {deliveryProtectionMs: 604800000, fundsHoldMs: 604800000, nonShipmentMs: 604800000}},
  }));
  render(<ShippingCheckout/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Livrer à')).toBeTruthy());
  fireEvent.press(screen.getByText('Adresse résidentielle ordinaire'));
  fireEvent.press(screen.getByRole('checkbox', {name: 'Je confirme le type de cette adresse'}));
  fireEvent.press(screen.getByText('Voir les tarifs de livraison'));
  await waitFor(() => expect(screen.getByText('Test · Standard')).toBeTruthy());
  fireEvent.press(screen.getByText('Test · Standard'));
  expect(screen.queryByText('TPS sur le service')).toBeNull(); expect(screen.queryByText(/4 × 6/)).toBeNull();
  expect(screen.getByText('Continuer vers le paiement')).toBeDisabled();
  fireEvent.press(screen.getByText('J’accepte le total et les conditions de l’achat.'));
  expect(screen.getByText('Continuer vers le paiement')).not.toBeDisabled();
  fireEvent.press(screen.getByLabelText('Modifier l’adresse de livraison'));
  fireEvent.changeText(screen.getByLabelText('Rechercher une adresse'), '4899 parc');
  await waitFor(() => expect(screen.getByRole('button', {name: addressSuggestion.label})).toBeTruthy());
  fireEvent.press(screen.getByRole('button', {name: addressSuggestion.label}));
  expect(screen.queryByText('Continuer vers le paiement')).toBeNull();
  expect(screen.queryByText('Test · Standard')).toBeNull();
  expect(screen.getByRole('checkbox', {name: 'Je confirme le type de cette adresse'}).props.accessibilityState.checked).toBe(false);
  expect(mockQuote).toHaveBeenCalledTimes(1); expect(mockReserve).not.toHaveBeenCalled();
});

const confirmCardExplicitly = async () => {
  await waitFor(() => expect(screen.getByText('Confirmer le paiement')).toBeTruthy());
  fireEvent.press(screen.getByText(/^Je confirme le paiement de ce total/));
  fireEvent.press(screen.getByText('Confirmer le paiement'));
};

it('adopts a payment proved on the same order and PI after the confirmation response loses a webhook race', async () => {
  mockParams = {transactionId: 'order'};
  mockConfirmPayment.mockImplementationOnce(async () => {
    mockPaymentAttempt = {...mockPaymentAttempt as object, phase: 'confirmation_requested'};
    mockConfirmed = true;
    mockReadOrder.mockResolvedValue({...mockOrder, status: 'label_created'});
    throw Object.assign(new Error('Confirmation response is stale'), {code: 'functions/aborted', details: {reason: 'stripe_checkout_stale', detail: 'confirmation_post_response_observed'}});
  });
  render(<Payment/>, {wrapper});
  await confirmCardExplicitly();
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'order'}}));
  expect(mockConfirmPayment).toHaveBeenCalledTimes(1); expect(mockObservePayment).toHaveBeenCalledTimes(1);
  expect(mockWalletPay).not.toHaveBeenCalled();
  expect(mockRememberPayment).toHaveBeenCalledWith(expect.objectContaining({mode: 'card', phase: 'settled', transactionId: 'order'}), expect.any(Function));
});

it.each([false, true])('keeps an ambiguous confirmation unconfirmed without native proof or with a different PI (%s)', async changedIntent => {
  mockParams = {transactionId: 'order'};
  mockConfirmPayment.mockImplementationOnce(async () => {
    mockPaymentAttempt = {...mockPaymentAttempt as object, phase: 'confirmation_requested'};
    mockConfirmed = changedIntent;
    if (changedIntent) mockReadOrder.mockResolvedValue({...mockOrder, status: 'paid', stripePaymentIntentId: 'pi_other'});
    throw Object.assign(new Error('Confirmation response is stale'), {code: 'functions/aborted'});
  });
  render(<Payment/>, {wrapper});
  await confirmCardExplicitly();
  await waitFor(() => expect(screen.getByText('Le paiement n’est pas encore confirmé. Actualisez le paiement pour connaître son résultat.')).toBeTruthy());
  expect(mockRouter.replace).not.toHaveBeenCalled(); expect(mockConfirmPayment).toHaveBeenCalledTimes(1);
  expect(mockObservePayment).toHaveBeenCalledTimes(1); expect(mockWalletPay).not.toHaveBeenCalled();
});

it('does not read or adopt a confirmation result after its original SDK identity is lost', async () => {
  mockParams = {transactionId: 'order'};
  let fail!: (error: unknown) => void;
  mockConfirmPayment.mockImplementationOnce(() => new Promise((_resolve, reject) => {fail = reject;}));
  render(<Payment/>, {wrapper});
  await confirmCardExplicitly();
  await waitFor(() => expect(mockConfirmPayment).toHaveBeenCalledTimes(1));
  const reads = mockReadOrder.mock.calls.length;
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'other'};
  await act(async () => {fail(Object.assign(new Error('Lost response'), {code: 'functions/aborted'}));});
  expect(mockReadOrder).toHaveBeenCalledTimes(reads); expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockConfirmPayment).toHaveBeenCalledTimes(1); expect(mockWalletPay).not.toHaveBeenCalled();
});

it('does not launch the automatic card observer after an ambiguous confirmation of a newly prepared PI', async () => {
  mockParams = {transactionId: 'order'}; mockOrder.stripePaymentIntentId = undefined;
  mockObservePayment.mockImplementationOnce(async () => {
    mockOrder.stripePaymentIntentId = 'pi_test';
    return {protocol: 'server_manual_v1', transactionId: 'order', intentVersion: 1, totalCents: 3700, walletCents: 0, cardCents: 3700,
      confirmationRequired: true, action: 'confirmOnServer', providerStatus: 'requires_confirmation'};
  });
  mockConfirmPayment.mockImplementationOnce(async () => {
    mockPaymentAttempt = {...mockPaymentAttempt as object, phase: 'confirmation_requested'};
    throw Object.assign(new Error('Lost confirmation response'), {code: 'functions/aborted'});
  });
  render(<Payment/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Continuer par carte')).toBeTruthy());
  fireEvent.press(screen.getByText('Continuer par carte'));
  await confirmCardExplicitly();
  await waitFor(() => expect(screen.getByText('Le paiement n’est pas encore confirmé. Actualisez le paiement pour connaître son résultat.')).toBeTruthy());
  await act(async () => undefined);
  expect(mockObservePayment).toHaveBeenCalledTimes(1); expect(mockConfirmPayment).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).not.toHaveBeenCalled(); expect(mockWalletPay).not.toHaveBeenCalled();
});
