import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpsCallable } from 'firebase/functions';
import { TransactionService } from '@/services/transactionService';
import type { Transaction } from '@/types/transaction';
import type { StripePaymentResult } from '@/components/StripePayment';

let mockUid = 'buyer';
let mockId = 'sale';
let mockOnResult: ((result: StripePaymentResult) => Promise<void>) | undefined;
const mockRouter = {push: jest.fn(), back: jest.fn(), replace: jest.fn()};
jest.mock('@/hooks/useAuth', () => ({
  useAuthenticatedUid: () => require('@/config/firebaseConfig').auth.currentUser?.uid ?? null,
  useAuthenticatedIdentity: () => { const user = require('@/hooks/useAuth').useUser(); return user?.id === require('@/config/firebaseConfig').auth.currentUser?.uid ? user : null; },
  useAuthenticatedSession: () => ({ uid: require('@/config/firebaseConfig').auth.currentUser?.uid ?? null, identity: require('@/hooks/useAuth').useAuthenticatedIdentity() }),
  useAuthGuardSession: () => ({ normalUser: require('@/hooks/useAuth').useUser(), identity: require('@/hooks/useAuth').useAuthenticatedIdentity(), isAuthLoading: false }),
useUser: () => ({id: mockUid})}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
useLocalSearchParams: () => ({transactionId: mockId}), useRouter: () => mockRouter}));
jest.mock('@/features/wallet/hooks/useWallet', () => ({useWallet: () => ({wallet: null})}));
jest.mock('@/features/wallet/services/walletService', () => ({WalletService: {payWithWallet: jest.fn()}}));
jest.mock('@/components/StripePayment', () => {
  const React = require('react'); const {Text} = require('react-native');
  return {StripePayment: ({clientSecret, onResult}: {clientSecret: string; onResult: (result: StripePaymentResult) => Promise<void>}) => {mockOnResult = onResult; return React.createElement(Text, {}, `SECRET:${clientSecret}`);}};
});
jest.mock('@/components/ui', () => ({
  Button: jest.requireActual('@/components/ui/Button').Button,
ScreenHeader: () => null}));
jest.mock('@/components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('react-native-safe-area-context', () => ({...jest.requireActual('react-native-safe-area-context'), useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
import PaymentScreen from '@/app/payment/[transactionId]';

let client: QueryClient;
let current: Transaction;
let onChange: (() => void) | undefined;
const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({id: 'sale', articleId: 'article', chatId: 'chat', buyerId: 'buyer', sellerId: 'seller', amount: 50, shippingCost: 0, totalAmount: 50, deliveryType: 'shipping', status: 'pending_payment', createdAt: new Date(), ...overrides});
const tree = () => <QueryClientProvider client={client}><PaymentScreen /></QueryClientProvider>;
beforeEach(() => {
  mockUid = 'buyer'; mockId = 'sale'; mockOnResult = undefined; current = makeTx();
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(TransactionService, 'getTransaction').mockImplementation(async () => current);
  jest.spyOn(TransactionService, 'subscribeToTransaction').mockImplementation((_id, change) => {onChange = change; return jest.fn();});
  (httpsCallable as jest.Mock).mockReturnValue(jest.fn(async () => ({data: {success: true, clientSecret: 'synthetic'}})));
});
afterEach(() => {jest.restoreAllMocks(); client.clear(); jest.useRealTimers();});
async function openSheet() {
  const view = render(tree());
  await waitFor(() => expect(screen.getByText(/^PAYER/)).toBeTruthy());
  fireEvent.press(screen.getByText(/^PAYER/));
  await waitFor(() => expect(screen.getByText('SECRET:synthetic')).toBeTruthy());
  return view;
}

it.each([{refundBlocked: true}, {bankDispute: {id: 'dp', state: 'open' as const}}])('pending_payment with independent liability offers no new payment', async marker => {
  current = makeTx(marker);
  render(tree());
  await waitFor(() => expect(screen.getByText('Voir le suivi de cette commande')).toBeTruthy());
  expect(screen.queryByText(/^PAYER/)).toBeNull();
  expect(httpsCallable).not.toHaveBeenCalled();
});
it('removes the payable surface when an external refund/bank update arrives without notification', async () => {
  render(tree());
  await waitFor(() => expect(screen.getByText(/^PAYER/)).toBeTruthy());
  current = makeTx({refundBlocked: true, refund: {intentId: 'intent', state: 'unknown', outstandingCardCents: null}});
  act(() => onChange?.());
  await waitFor(() => expect(screen.getByText('Montant sur le moyen de paiement à vérifier.')).toBeTruthy());
  expect(screen.queryByText(/^PAYER/)).toBeNull();
  expect(httpsCallable).not.toHaveBeenCalled();
});
it('ignores a delayed checkout secret belonging to the previous account', async () => {
  let resolve!: (value: unknown) => void;
  (httpsCallable as jest.Mock).mockReturnValue(jest.fn(() => new Promise(res => {resolve = res;})));
  const {rerender} = render(tree());
  await waitFor(() => expect(screen.getByText(/^PAYER/)).toBeTruthy());
  fireEvent.press(screen.getByText(/^PAYER/));
  await waitFor(() => expect(httpsCallable).toHaveBeenCalled());
  mockUid = 'another-buyer'; current = makeTx({buyerId: mockUid});
  rerender(tree());
  await waitFor(() => expect(TransactionService.getTransaction).toHaveBeenCalledTimes(2));
  await act(async () => {resolve({data: {success: true, clientSecret: 'previous-account-secret'}});});
  expect(screen.queryByText('SECRET:previous-account-secret')).toBeNull();
});

it('confirms nominal fresh paid proof without classifying paid as a new-payment refusal', async () => {
  await openSheet();
  current = makeTx({status: 'paid'});
  await act(async () => {await mockOnResult!({success: true});});
  const confirmation = (Alert.alert as jest.Mock).mock.calls.find(call => call[0] === 'Paiement confirmé !');
  expect(confirmation?.[1]).toContain('Le paiement de cette commande est confirmé');
  expect(confirmation?.[1]).not.toContain('générée automatiquement');
  expect(mockRouter.back).not.toHaveBeenCalled();
  act(() => confirmation![2][0].onPress());
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
});

it('times out without financial proof, then ignores its follow-up button after a scope change', async () => {
  jest.useFakeTimers();
  const view = await openSheet();
  let work!: Promise<void>;
  act(() => {work = mockOnResult!({success: true});});
  await act(async () => {await jest.advanceTimersByTimeAsync(13_000); await work;});
  const pending = (Alert.alert as jest.Mock).mock.calls.find(call => call[0] === 'Paiement en cours de confirmation');
  expect(pending?.[1]).toContain('ne pouvons pas encore confirmer');
  expect(pending?.[1]).not.toContain('a bien été pris en compte');
  mockId = 'new-sale'; current = makeTx({id: mockId});
  view.rerender(tree());
  await waitFor(() => expect(screen.getByText(/^PAYER/)).toBeTruthy());
  act(() => pending![2][0].onPress());
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

it('uses a nominal paid document from the active listener during the polling sleep', async () => {
  jest.useFakeTimers();
  await openSheet();
  let work!: Promise<void>;
  act(() => {work = mockOnResult!({success: true});});
  await act(async () => {await Promise.resolve();});
  current = makeTx({status: 'paid'});
  act(() => onChange?.());
  await act(async () => {await jest.advanceTimersByTimeAsync(1500); await work;});
  expect((Alert.alert as jest.Mock).mock.calls.some(call => call[0] === 'Paiement confirmé !')).toBe(true);
  expect((Alert.alert as jest.Mock).mock.calls.some(call => call[0] === 'Paiement en cours de confirmation')).toBe(false);
});

it('keeps an active cancellation error visible and restores the button for that same scope', async () => {
  (httpsCallable as jest.Mock).mockReturnValue(jest.fn().mockRejectedValue({code: 'functions/failed-precondition', message: 'Annulation refusée.'}));
  render(tree());
  await waitFor(() => expect(screen.getByText('Annuler la commande')).toBeTruthy());
  fireEvent.press(screen.getByText('Annuler la commande'));
  const confirm = (Alert.alert as jest.Mock).mock.calls[0][2][1];
  await act(async () => {await confirm.onPress();});
  expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[0]).toBe('Action impossible');
  expect(screen.getByText('Annuler la commande')).toBeTruthy();
  expect(mockRouter.back).not.toHaveBeenCalled();
});

it('a deferred retry reads current obligations before submitting another checkout', async () => {
  await openSheet();
  await act(async () => {await mockOnResult!({success: false, error: 'network_error'});});
  const retry = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2]?.find((button: {text: string}) => button.text === 'Réessayer');
  expect(retry).toBeTruthy();
  current = makeTx({status: 'disputed', bankDispute: {id: 'bank', state: 'open'}});
  act(() => onChange?.());
  await waitFor(() => expect(screen.getByText('Voir le suivi de cette commande')).toBeTruthy());
  (httpsCallable as jest.Mock).mockClear();
  await act(async () => {await retry.onPress();});
  expect(httpsCallable).not.toHaveBeenCalled();
});

it('an old retry stays inert through A to B to A, including old pay handlers', async () => {
  const view = await openSheet();
  let payNode: ReturnType<typeof screen.getByText> | null = screen.getByText(/^PAYER/);
  while (payNode && typeof payNode.props.onPress !== 'function') payNode = payNode.parent;
  expect(payNode).toBeTruthy();
  const pay = payNode!.props.onPress as () => Promise<void>;
  await act(async () => {await mockOnResult!({success: false, error: 'network_error'});});
  const retry = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2]?.find((button: {text: string}) => button.text === 'Réessayer');
  mockId = 'new-sale'; current = makeTx({id: mockId}); view.rerender(tree());
  await waitFor(() => expect(screen.getByText(/^PAYER/)).toBeTruthy());
  mockId = 'sale'; current = makeTx(); view.rerender(tree());
  await waitFor(() => expect(screen.getByText(/^PAYER/)).toBeTruthy());
  (httpsCallable as jest.Mock).mockClear();
  await act(async () => {await retry.onPress(); await pay();});
  expect(httpsCallable).not.toHaveBeenCalled();
});

it('does not submit an old cancellation confirmation after a same-scope bank update', async () => {
  render(tree());
  await waitFor(() => expect(screen.getByText('Annuler la commande')).toBeTruthy());
  fireEvent.press(screen.getByText('Annuler la commande'));
  const confirm = (Alert.alert as jest.Mock).mock.calls[0][2][1];
  current = makeTx({bankDispute: {id: 'bank', state: 'open'}});
  act(() => onChange?.());
  await waitFor(() => expect(screen.getByText('Voir le suivi de cette commande')).toBeTruthy());
  await act(async () => {await confirm.onPress();});
  expect(httpsCallable).not.toHaveBeenCalled();
});

it('an old checkout rejection and finally cannot clear the new scope busy state', async () => {
  let rejectOld!: (error: unknown) => void;
  let resolveNew!: (value: unknown) => void;
  const callable = jest.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => {rejectOld = reject;}))
    .mockImplementationOnce(() => new Promise(resolve => {resolveNew = resolve;}));
  (httpsCallable as jest.Mock).mockReturnValue(callable);
  const view = render(tree());
  await waitFor(() => expect(screen.getByText(/^PAYER/)).toBeTruthy());
  fireEvent.press(screen.getByText(/^PAYER/));
  mockId = 'new-sale'; current = makeTx({id: mockId}); view.rerender(tree());
  await waitFor(() => expect(screen.getByText(/^PAYER/)).toBeTruthy());
  fireEvent.press(screen.getByText(/^PAYER/));
  await waitFor(() => expect(callable).toHaveBeenCalledTimes(2));
  await act(async () => {rejectOld(new Error('Old request failed'));});
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(screen.queryByText(/^PAYER/)).toBeNull();
  await act(async () => {resolveNew({data: {success: true, clientSecret: 'new-secret'}});});
  expect(screen.getByText('SECRET:new-secret')).toBeTruthy();
});
