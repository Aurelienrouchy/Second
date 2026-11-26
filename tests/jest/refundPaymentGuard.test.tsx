import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react-native';
import {Alert, AppState, Modal} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {getDoc, getDocFromServer, doc} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import {ManualPaymentService} from '@/services/manualPaymentService';
import type {Transaction} from '@/types/transaction';
import type {ManualCheckout} from '@/types/manualPayment';

let mockId = 'sale', mockCommerceEnabled = true;
const mockRouter = {push: jest.fn(), back: jest.fn(), replace: jest.fn()};
jest.mock('expo-router', () => ({useRouter: () => mockRouter, useLocalSearchParams: () => ({transactionId: mockId}),
  useNavigation: () => ({isFocused: () => true}), useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect])}));
jest.mock('@/config/featureFlags', () => ({get PAYMENTS_ENABLED() {return mockCommerceEnabled;}, get SHIPPING_ENABLED() {return mockCommerceEnabled;}, DEV_COMMERCE_TESTING_ENABLED: false}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}), SafeAreaProvider: require('react-native').View}));
jest.mock('@/features/orders', () => ({OrderArticleSummary: () => null}));
jest.mock('@/lib/stripe', () => ({CardField: () => null, useStripe: () => ({createPaymentMethod: jest.fn(), handleNextAction: jest.fn()})}));
// Native/transport leaves only. Identity, frame guards, payment service and
// its durable journal remain real throughout these migrated legacy cases.
import PaymentScreen from '@/app/payment/[transactionId]';

let client: QueryClient, current: Transaction;
const rpc = jest.fn();
const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({id: mockId, articleId: 'article', chatId: 'chat', buyerId: 'buyer', sellerId: 'seller', amount: 50,
  shippingCost: 0, totalAmount: 50, deliveryType: 'shipping', status: 'pending_payment', createdAt: new Date(), currency: 'CAD',
  shippingQuoteId: 'quote', shipEngineRateId: 'rate', shippingAddress: {name: 'QA', street: 'Rue QA', city: 'Montréal', province: 'QC', postalCode: 'H2J2K1', country: 'CA'}, ...overrides});
function checkout(id = mockId, overrides: Partial<ManualCheckout> = {}): ManualCheckout {
  return {protocol: 'server_manual_v1', transactionId: id, intentVersion: 1, preparationState: 'prepared', providerStatus: 'requires_confirmation',
    totalCents: 5000, walletCents: 0, cardCents: 5000, currency: 'CAD', paymentPermissionGranted: false, confirmationRequired: true,
    settlementPending: false, action: 'confirmOnServer', ...overrides};
}
function settle() {current = {...current, status: 'paid', paidAt: new Date(), stripePaymentIntentId: 'pi_fixture', stripeCheckoutProtocol: 'server_manual_v1', stripeChargeId: 'ch_fixture', capturedCardCents: 5000, walletAmountUsed: 0};}
const tree = () => <QueryClientProvider client={client}><PaymentScreen/></QueryClientProvider>;
function calls(name: string) {return rpc.mock.calls.filter(([method]) => method === name);}
function retainedPress(label: string, option = false) {
  let node: ReturnType<typeof screen.getByText> | null = option ? within(screen.UNSAFE_getByType(Modal)).getByText(label) : screen.getByText(label);
  while (node && typeof node.props.onPress !== 'function') node = node.parent;
  expect(node).not.toBeNull(); return node!.props.onPress as () => void;
}
async function prepare() {
  const view = render(tree()); fireEvent.press(await screen.findByText('Continuer par carte'));
  await screen.findByText('Confirmer le paiement'); expect(calls('confirmStripeCheckout')).toHaveLength(0);
  return view;
}
async function confirm() {
  fireEvent.press(screen.getByText(/Je confirme le paiement de ce total : 50,00\s\$\sCA par carte\./));
  fireEvent.press(screen.getByText('Confirmer le paiement'));
}
async function options() {fireEvent.press(screen.getByLabelText('Options du paiement')); await within(screen.UNSAFE_getByType(Modal)).findByText('Actualiser le paiement');}
async function refreshOrder() {await act(async () => {await client.invalidateQueries({predicate: query => query.queryKey.includes(mockId)});});}
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks(); mockId = 'sale'; mockCommerceEnabled = true; establishIdentityFixture('buyer'); current = makeTx();
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}, mutations: {retry: false}}});
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(doc).mockImplementation(((_db: unknown, ...parts: string[]) => ({id: parts.at(-1), path: parts.join('/')})) as typeof doc);
  const read = async () => ({id: current.id, exists: () => true, data: () => current});
  jest.mocked(getDoc).mockImplementation(read as unknown as typeof getDoc); jest.mocked(getDocFromServer).mockImplementation(read as unknown as typeof getDocFromServer);
  rpc.mockReset().mockImplementation(async (name: string, input: {transactionId?: string}) => {
    if (name === 'getWalletInfo') return {data: {hasWallet: false, balance: 0}};
    if (name === 'checkTrackingStatus') return {data: {protocol: 'purchase_preparation_policy_observation_v1', transactionId: input.transactionId, ownerId: current.buyerId,
      qualification: 'unknown', policyVersion: null, policyHash: null, terms: null, pendingPayment: null, labelAbandonment: null,
      automatedEffectAuthorized: false, providerObserved: false, financialResolutionVerified: false}};
    if (name === 'createStripeCheckout') return {data: checkout(input.transactionId)};
    if (name === 'confirmStripeCheckout') {settle(); return {data: checkout(input.transactionId, {providerStatus: 'succeeded', preparationState: 'succeeded', confirmationRequired: false, settlementPending: true, action: 'refreshCheckout'})};}
    throw new Error(`Unexpected payment transport ${name}`);
  });
  jest.mocked(httpsCallable).mockImplementation(((_functions: unknown, name: string) => (input: unknown) => rpc(name, input)) as typeof httpsCallable);
});
afterEach(() => {cleanup(); client.clear(); jest.restoreAllMocks(); clearIdentityFixture(); jest.useRealTimers();});

it.each([{refundBlocked: true}, {bankDispute: {id: 'dp', state: 'open' as const}}])('pending_payment with independent liability offers no new payment', async marker => {
  mockCommerceEnabled = false; current = makeTx(marker); render(tree());
  await screen.findByText('Suivre ma commande'); expect(screen.queryByText('Continuer par carte')).toBeNull(); expect(calls('createStripeCheckout')).toHaveLength(0);
});
it('removes the payable surface when an external refund/bank update arrives without notification', async () => {
  render(tree()); await screen.findByText('Continuer par carte'); current = makeTx({refundBlocked: true, refund: {intentId: 'intent', state: 'unknown', outstandingCardCents: null}});
  await refreshOrder(); await screen.findByText('Montant sur le moyen de paiement à vérifier.');
  expect(screen.queryByText('Continuer par carte')).toBeNull(); expect(calls('createStripeCheckout')).toHaveLength(0);
});
it('ignores a delayed checkout observation belonging to the previous account', async () => {
  let release!: (value: unknown) => void; const baseline = rpc.getMockImplementation()!;
  rpc.mockImplementation((name: string, input: unknown) => name === 'createStripeCheckout' ? new Promise(resolve => {release = resolve;}) : baseline(name, input));
  const view = render(tree()); fireEvent.press(await screen.findByText('Continuer par carte')); await waitFor(() => expect(calls('createStripeCheckout')).toHaveLength(1));
  act(() => {establishIdentityFixture('another-buyer'); current = makeTx({buyerId: 'another-buyer'});}); view.rerender(tree());
  await act(async () => {release({data: checkout('sale', {intentVersion: 99})});});
  await screen.findByText('Continuer par carte'); expect(screen.queryByText('Confirmer le paiement')).toBeNull(); expect(calls('confirmStripeCheckout')).toHaveLength(0);
  const own = await ManualPaymentService.readAttempt('another-buyer', 'sale', () => undefined); expect(own).toBeNull();
});
it('confirms nominal fresh paid proof without classifying paid as a new-payment refusal', async () => {
  await prepare(); await confirm(); await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'sale'}}));
  expect(calls('confirmStripeCheckout')).toHaveLength(1); expect((await ManualPaymentService.readAttempt('buyer', 'sale', () => undefined))?.phase).toBe('settled');
  expect(screen.queryByText(/n’est pas encore confirmé/)).toBeNull();
});
it('times out without financial proof, then ignores its follow-up button after a scope change', async () => {
  jest.useFakeTimers(); const baseline = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name: string, input: unknown) => name === 'confirmStripeCheckout' ? {data: checkout('sale', {providerStatus: 'processing', preparationState: 'processing', confirmationRequired: false, settlementPending: true, action: 'refreshCheckout'})} : baseline(name, input));
  const view = await prepare(); await confirm(); await act(async () => {await jest.advanceTimersByTimeAsync(8500);});
  await screen.findByText('Le paiement n’est pas encore confirmé dans la commande. Vérifiez son résultat ; ne renvoyez pas une nouvelle demande.'); expect(mockRouter.replace).not.toHaveBeenCalled();
  await options(); const refresh = retainedPress('Actualiser le paiement', true); mockId = 'new-sale'; current = makeTx();
  // A new route owns a new frame; a retained control cannot read or dispatch it.
  view.rerender(tree()); await screen.findByText('Continuer par carte'); rpc.mockClear(); act(refresh); expect(rpc).not.toHaveBeenCalled();
});
it('uses a nominal paid document from the current query during the polling sleep', async () => {
  jest.useFakeTimers(); const baseline = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name: string, input: unknown) => name === 'confirmStripeCheckout' ? {data: checkout('sale', {providerStatus: 'processing', preparationState: 'processing', confirmationRequired: false, settlementPending: true, action: 'refreshCheckout'})} : baseline(name, input));
  await prepare(); await confirm(); await waitFor(() => expect(calls('confirmStripeCheckout')).toHaveLength(1)); settle(); await refreshOrder();
  await act(async () => {await jest.advanceTimersByTimeAsync(1500);});
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'sale'}}));
  expect(screen.queryByText(/n’est pas encore confirmé/)).toBeNull();
});
it('keeps an active cancellation error visible and restores the button for that same scope', async () => {
  mockCommerceEnabled = false; const baseline = rpc.getMockImplementation()!;
  rpc.mockImplementation((name: string, input: unknown) => name === 'cancelPendingTransaction' ? Promise.reject(Object.assign(new Error('Annulation refusée.'), {code: 'functions/failed-precondition'})) : baseline(name, input));
  render(tree()); await screen.findByText('Le paiement est actuellement indisponible.'); await options(); fireEvent.press(screen.getByText('Annuler la commande'));
  const confirmCancellation = jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1]; await act(async () => {confirmCancellation.onPress!();});
  await screen.findByText('Annulation refusée.'); await options(); expect(screen.getByText('Annuler la commande')).toBeOnTheScreen(); expect(mockRouter.back).not.toHaveBeenCalled();
});
it('a deferred retry reads current obligations before submitting another checkout', async () => {
  const baseline = rpc.getMockImplementation()!; rpc.mockImplementation((name: string, input: unknown) => name === 'createStripeCheckout' ? Promise.reject(new Error('Réseau indisponible.')) : baseline(name, input));
  render(tree()); fireEvent.press(await screen.findByText('Continuer par carte')); await screen.findByText('Réseau indisponible.');
  await options(); const retry = retainedPress('Actualiser le paiement', true); current = makeTx({status: 'disputed', bankDispute: {id: 'bank', state: 'open'}});
  rpc.mockClear(); act(retry); await screen.findByText('Cette commande a évolué. Consultez son suivi pour connaître la suite.'); expect(calls('createStripeCheckout')).toHaveLength(0);
});
it('an old retry stays inert through A to B to A, including old pay handlers', async () => {
  const baseline = rpc.getMockImplementation()!; rpc.mockImplementation((name: string, input: unknown) => name === 'createStripeCheckout' ? Promise.reject(new Error('Réseau indisponible.')) : baseline(name, input));
  const view = render(tree()); await screen.findByText('Continuer par carte'); const oldPay = retainedPress('Continuer par carte'); act(oldPay); await screen.findByText('Réseau indisponible.');
  await options(); const retry = retainedPress('Actualiser le paiement', true);
  act(() => establishIdentityFixture('another-buyer')); view.rerender(tree()); await act(async () => {});
  act(() => establishIdentityFixture('buyer')); view.rerender(tree()); await screen.findAllByText('Actualiser le paiement'); rpc.mockClear();
  act(() => {retry(); oldPay();}); expect(calls('createStripeCheckout')).toHaveLength(0); expect(calls('confirmStripeCheckout')).toHaveLength(0);
});
it('does not submit an old cancellation confirmation after a same-scope bank update', async () => {
  mockCommerceEnabled = false; render(tree()); await screen.findByText('Le paiement est actuellement indisponible.'); await options(); fireEvent.press(screen.getByText('Annuler la commande'));
  const confirmCancellation = jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1]; current = makeTx({bankDispute: {id: 'bank', state: 'open'}}); await refreshOrder();
  await act(async () => {confirmCancellation.onPress!();}); expect(calls('cancelPendingTransaction')).toHaveLength(0);
});
it('an old checkout rejection and finally cannot clear the new scope busy state', async () => {
  let rejectOld!: (error: unknown) => void, resolveNew!: (value: unknown) => void; const baseline = rpc.getMockImplementation()!;
  rpc.mockImplementation((name: string, input: unknown) => name !== 'createStripeCheckout' ? baseline(name, input) : calls(name).length === 1
    ? new Promise((_resolve, reject) => {rejectOld = reject;}) : new Promise(resolve => {resolveNew = resolve;}));
  const view = render(tree()); fireEvent.press(await screen.findByText('Continuer par carte')); await waitFor(() => expect(calls('createStripeCheckout')).toHaveLength(1));
  mockId = 'new-sale'; current = makeTx(); view.rerender(tree()); fireEvent.press(await screen.findByText('Continuer par carte')); await waitFor(() => expect(calls('createStripeCheckout')).toHaveLength(2));
  await act(async () => {rejectOld(new Error('Old request failed'));}); expect(screen.queryByText('Old request failed')).toBeNull();
  expect(screen.getByRole('button', {name: 'Continuer par carte'}).props.accessibilityState).toMatchObject({busy: true});
  await act(async () => {resolveNew({data: checkout('new-sale')});}); await screen.findByText('Confirmer le paiement');
});

it('keeps a clean new shipping payment closed by the V1 flags before any card command', async () => {
  mockCommerceEnabled = false; render(tree()); await screen.findByText('Le paiement est actuellement indisponible.');
  expect(screen.queryByText('Continuer par carte')).toBeNull(); expect(screen.queryByText('Confirmer le paiement')).toBeNull();
  expect(calls('createStripeCheckout')).toHaveLength(0); expect(calls('confirmStripeCheckout')).toHaveLength(0);
});

it('does not accept a paid status or provider success without native settlement evidence in the current order', async () => {
  const baseline = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name: string, input: unknown) => {
    if (name !== 'confirmStripeCheckout') return baseline(name, input);
    current = makeTx({status: 'paid'});
    return {data: checkout('sale', {providerStatus: 'succeeded', preparationState: 'succeeded', confirmationRequired: false, settlementPending: true, action: 'refreshCheckout'})};
  });
  await prepare(); await confirm(); await screen.findByText('Cette commande a évolué. Consultez son suivi pour connaître la suite.');
  expect(mockRouter.replace).not.toHaveBeenCalled(); expect((await ManualPaymentService.readAttempt('buyer', 'sale', () => undefined))?.phase).not.toBe('settled');
});
