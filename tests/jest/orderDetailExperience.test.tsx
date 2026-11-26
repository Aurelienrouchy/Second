import React from 'react';
import {Alert, Linking} from 'react-native';
import {act, fireEvent, render, renderHook, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import type {Transaction} from '@/types';

const mockRouter = {push: jest.fn(), back: jest.fn()};
let mockUid = 'seller', mockGeneration = 1, mockFocused = true;
let mockParams: {id: string; bankCaseNotice?: string} = {id: 'private_order'};
const mockFrame = Symbol('order-context');
const mockModeration = jest.fn();
const mockQueryError = jest.fn();
const mockRead = jest.fn(), mockObserveLabel = jest.fn(), mockConfirmLabel = jest.fn();
const mockTools = {shipment: jest.fn(), receipt: jest.fn(), bank: jest.fn(), convenience: jest.fn(), deadline: jest.fn(), test: jest.fn()};
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => mockGeneration, useAuthStore: {getState: () => ({authenticatedUid: mockUid})}}));
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => mockUid, useAuthGuardSession: () => ({normalUser: {id: mockUid}})}));
jest.mock('expo-router', () => ({useRouter: () => mockRouter, useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => {const React = require('react'); React.useEffect(effect, [effect]);}}));
jest.mock('@gorhom/bottom-sheet', () => ({BottomSheetModalProvider: ({children}: {children: React.ReactNode}) => children}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@/hooks/useShippingPurchaseContext', () => ({useShippingPurchaseContext: () => ({frame: mockFrame, focused: mockFocused, focusRevision: 1,
  capture: () => {if (!mockFocused) throw new Error('Old context'); return {frame: mockFrame, focusEpoch: 1, session: {uid: mockUid, generation: mockGeneration}};},
  start: () => {if (!mockFocused) throw new Error('Old context'); return {frame: mockFrame, focusEpoch: 1, session: {uid: mockUid, generation: mockGeneration}};},
  assertCurrent: (operation: {session: {uid: string; generation: number}}) => {if (!mockFocused || operation.session.uid !== mockUid || operation.session.generation !== mockGeneration) throw new Error('Old context');},
  isCurrent: (operation: {session: {uid: string; generation: number}}) => mockFocused && operation.session.uid === mockUid && operation.session.generation === mockGeneration,
  finish: jest.fn(),
})}));
jest.mock('@/services/transactionService', () => ({TransactionService: {getTransaction: (...args: unknown[]) => mockRead(...args), subscribeToTransaction: () => jest.fn()},
  getDeliveryCorrectionReview: (order: Transaction) => order.deliveryCorrection ? {message: 'Correction en cours'} : null}));
jest.mock('@/services/articleModerationService', () => ({ArticleModerationService: {readOrderModeration: (...args: unknown[]) => mockModeration(...args)}}));
jest.mock('@/services/articlesService', () => ({ArticlesService: {getArticleById: jest.fn()}}));
jest.mock('@/services/manualPaymentService', () => ({ManualPaymentService: {readAttempt: async () => null}, canReadExistingCheckoutWithoutCreation: () => false, exactPaymentCents: (n: number) => Math.round(n * 100)}));
jest.mock('@/services/transportReviewService', () => ({TransportReviewService: {source: jest.fn()}}));
jest.mock('@/services/labelDocumentService', () => ({LabelDocumentService: {observe: (...args: unknown[]) => mockObserveLabel(...args), confirmSource: (...args: unknown[]) => mockConfirmLabel(...args)}}));
jest.mock('@/services/bankDisputeCaseNoticeService', () => ({parseBankDisputeCaseNotice: (value: {ownerId: string; transactionId: string}, uid: string) => value.ownerId === uid ? value : null}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: true, SHIPPING_ENABLED: true, DEV_COMMERCE_TESTING_ENABLED: true}));
jest.mock('@/features/orders', () => {
  const React = require('react'), {Text} = require('react-native');
  return {OrderOptionsList: jest.requireActual('@/features/orders/components/OrderOptionsList').OrderOptionsList,
    OrderArticleSummary: ({terms}: {terms: {title: string}}) => React.createElement(Text, null, terms.title),
    ShipmentTracking: (props: unknown) => {mockTools.shipment(props); return React.createElement(Text, null, 'Outil de retour');},
    BuyerReceiptDeclaration: (props: unknown) => {mockTools.receipt(props); return React.createElement(Text, null, 'Confirmation de réception');}};
});
jest.mock('@/components/BankDisputeOwnerPanel', () => ({BankDisputeOwnerPanel: (props: unknown) => {mockTools.bank(props); return null;}}));
jest.mock('@/components/ConvenienceReturnPanel', () => ({ConvenienceReturnPanel: (props: unknown) => {mockTools.convenience(props); return null;}}));
jest.mock('@/components/ReturnDepositDeadlinePanel', () => ({ReturnDepositDeadlinePanel: (props: unknown) => {mockTools.deadline(props); return null;}}));
jest.mock('@/components/DevShippingControls', () => ({DevShippingControls: (props: unknown) => {mockTools.test(props); return null;}}));
jest.mock('@/components/ui', () => {
  const React = require('react'), {Pressable, Text, View} = require('react-native');
  return {Button: ({children, onPress, disabled}: {children: React.ReactNode; onPress: () => void; disabled?: boolean}) => React.createElement(Pressable, {onPress, disabled}, React.createElement(Text, null, children)),
    ScreenHeader: ({title, onBack, rightContent}: {title: string; onBack: () => void; rightContent?: React.ReactNode}) => React.createElement(View, null, React.createElement(Text, null, title), React.createElement(Pressable, {onPress: onBack, accessibilityLabel: 'Retour'}, React.createElement(Text, null, 'Retour')), rightContent),
    Skeleton: () => React.createElement(Text, null, 'Chargement')};
});

import OrderDetailScreen from '@/app/orders/[id]';
import {useOrderLabelDocument} from '@/features/orders/hooks/useOrderLabelDocument';

const order = (patch: Partial<Transaction> = {}): Transaction => ({id: 'private_order', chatId: 'private_chat', articleId: 'private_article', buyerId: 'buyer', sellerId: 'seller',
  amount: 32, totalAmount: 39.5, shippingCost: 4, serviceFee: 3.5, deliveryType: 'shipping', status: 'label_created',
  articleSnapshot: {title: 'Sweat Uniqlo'}, createdAt: new Date('2026-10-28T12:00:00Z'), paidAt: new Date('2026-10-28T12:01:00Z'),
  stripeChargeId: 'ch_paid', stripePaymentIntentId: 'pi_paid', capturedCardCents: 3950,
  shipEngineLabelId: 'se-label', shipEngineRateId: 'rate', labelCreatedAt: new Date('2026-10-28T12:02:00Z'),
  shippingLabelUrl: 'https://old.example/old.pdf', trackingNumber: 'TRACKING123',
  labelPurchase: {schemaVersion: 1, state: 'committed', transactionId: 'private_order', buyerId: 'buyer', sellerId: 'seller', attemptId: 'attempt',
    sourceHash: 'a'.repeat(64), providerLabelId: 'se-label', committedAt: new Date('2026-10-28T12:02:00Z'), shipmentId: 'shipment', rateId: 'rate',
    qualification: {schemaVersion: 1, currency: 'CAD', requestedRateId: 'rate', rateIdentitySource: 'request_path'}},
  shippingSnapshot: {schemaVersion: 1, provider: 'shipengine', currency: 'CAD', priceAcceptedBy: 'buyer', validatedAt: new Date('2026-10-28T12:00:00Z'),
    acceptanceValidatedAt: new Date('2026-10-28T12:00:00Z'), shipmentId: 'shipment', rate: {rateId: 'rate', shipmentId: 'shipment'}}, ...patch} as unknown as Transaction);
let client: QueryClient;
beforeEach(() => {
  mockUid = 'seller'; mockGeneration = 1; mockFocused = true; mockParams = {id: 'private_order'};
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: mockUid};
  mockRead.mockResolvedValue(order());
  mockModeration.mockResolvedValue({moderation: null});
  mockObserveLabel.mockResolvedValue({observation: 'document_available', documentUrl: 'https://fresh.example/label.pdf'});
  mockConfirmLabel.mockResolvedValue({observation: 'source_matches'});
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  client = new QueryClient({queryCache: new QueryCache({onError: mockQueryError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {client.clear(); jest.restoreAllMocks();});
const subject = () => <QueryClientProvider client={client}><OrderDetailScreen/></QueryClientProvider>;

it('shows the essential seller flow without internal references or mounting incident tools', async () => {
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Votre étiquette est prête')).toBeTruthy());
  expect(view.getByText('Sweat Uniqlo')).toBeTruthy();
  expect(view.getByText('32 $')).toBeTruthy();
  expect(view.queryByText('39,50 $')).toBeNull();
  expect(view.queryByText(/private_order|Référence|Défauts déclarés|Retouches déclarées/)).toBeNull();
  expect(view.getByText('Paiement confirmé')).toBeTruthy();
  expect(view.getByText('Étiquette prête')).toBeTruthy();
  for (const tool of Object.values(mockTools)) expect(tool).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Ouvrir la conversation'));
  expect(mockRouter.push).toHaveBeenCalledWith({pathname: '/chat/[id]', params: {id: 'private_chat', transactionId: 'private_order'}});
});

it('opens only the freshly observed label after the source check', async () => {
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Voir mon étiquette')).toBeTruthy());
  fireEvent.press(view.getByText('Voir mon étiquette'));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://fresh.example/label.pdf'));
  expect(mockObserveLabel).toHaveBeenCalledWith('seller', 'private_order', 'forward', 'se-label', expect.any(Function));
  expect(mockConfirmLabel.mock.invocationCallOrder[0]).toBeGreaterThan(mockObserveLabel.mock.invocationCallOrder[0]);
  expect(jest.mocked(Linking.openURL).mock.invocationCallOrder[0]).toBeGreaterThan(mockConfirmLabel.mock.invocationCallOrder[0]);
});

it('does not open the stored URL when the current source check fails', async () => {
  mockConfirmLabel.mockRejectedValue(new Error('Source changed'));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Voir mon étiquette')).toBeTruthy());
  fireEvent.press(view.getByText('Voir mon étiquette'));
  await waitFor(() => expect(view.getByText('Impossible d’ouvrir l’étiquette. Actualisez la commande puis réessayez.')).toBeTruthy());
  expect(Linking.openURL).not.toHaveBeenCalled();
});

it('discards a late label response after the original session changes', async () => {
  let finish!: (value: unknown) => void;
  mockObserveLabel.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Voir mon étiquette')).toBeTruthy());
  fireEvent.press(view.getByText('Voir mon étiquette'));
  await waitFor(() => expect(mockObserveLabel).toHaveBeenCalledTimes(1));
  mockGeneration++;
  await act(async () => {finish({observation: 'document_available', documentUrl: 'https://fresh.example/label.pdf'});});
  expect(mockConfirmLabel).not.toHaveBeenCalled();
  expect(Linking.openURL).not.toHaveBeenCalled();
});

it('keeps test controls secondary and requires the non-shippable warning before opening a Dev label', async () => {
  mockRead.mockResolvedValue(order({carrierCode: 'seconde_dev'}));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Voir mon étiquette')).toBeTruthy());
  expect(mockTools.test).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Voir mon étiquette'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Étiquette de test', expect.stringContaining('n’est pas expédiable'), expect.any(Array), expect.anything()));
  expect(Linking.openURL).not.toHaveBeenCalled();
  const accept = jest.mocked(Alert.alert).mock.calls[0][2]?.find(button => button.text === 'Ouvrir le document');
  await act(async () => {accept?.onPress?.();});
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByLabelText('Aide et options de la commande'));
  expect(view.queryByText('Retour convenu entre membres')).toBeNull();
  expect(view.queryByText('Faire examiner une décision')).toBeNull();
  fireEvent.press(view.getByText('Outils de test'));
  expect(mockTools.test).toHaveBeenCalledTimes(1);
});

it('keeps payment on the buyer flow and dispatches the exact order', async () => {
  mockUid = 'buyer'; (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'buyer'};
  mockRead.mockResolvedValue(order({status: 'pending_payment', stripePaymentIntentId: undefined, stripeChargeId: undefined, paidAt: undefined}));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Payer ma commande')).toBeTruthy());
  fireEvent.press(view.getByText('Payer ma commande'));
  expect(mockRouter.push).toHaveBeenCalledWith({pathname: '/payment/[transactionId]', params: {transactionId: 'private_order'}});
});

it('mounts only the chosen buyer incident tool after opening options', async () => {
  mockUid = 'buyer'; (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'buyer'};
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Le vendeur prépare votre colis')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Aide et options de la commande'));
  expect(mockTools.shipment).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Signaler un problème'));
  expect(mockTools.shipment).toHaveBeenCalledWith(expect.objectContaining({tool: 'report'}));
  expect(mockTools.convenience).not.toHaveBeenCalled();
  expect(mockTools.bank).not.toHaveBeenCalled();
});

it('does not qualify payment or label milestones from isolated timestamps', async () => {
  mockRead.mockResolvedValue(order({labelPurchase: undefined, stripeChargeId: undefined, capturedCardCents: undefined} as unknown as Partial<Transaction>));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Votre étiquette se prépare')).toBeTruthy());
  expect(view.queryByText('Paiement confirmé')).toBeNull();
  expect(view.queryByText('Étiquette prête')).toBeNull();
  expect(view.queryByText('Voir mon étiquette')).toBeNull();
});

it.each([{refundBlocked: true}, {fraudReview: null}])('shows a concise review instead of inviting parcel deposit for %j', async flags => {
  mockRead.mockResolvedValue(order(flags as Partial<Transaction>));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Votre commande est en cours d’examen')).toBeTruthy());
  expect(view.queryByText('Imprimez-la, puis déposez votre colis.')).toBeNull();
  expect(view.queryByText('Voir mon étiquette')).toBeNull();
  fireEvent.press(view.getByLabelText('Aide et options de la commande'));
  expect(view.getByText('Consulter l’étiquette')).toBeTruthy();
});

it('keeps a failed current moderation read visible without inviting a new shipment', async () => {
  mockModeration.mockRejectedValue(new Error('Service failure'));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Votre commande doit être actualisée')).toBeTruthy());
  expect(view.queryByText('Voir mon étiquette')).toBeNull();
  fireEvent.press(view.getByText('Voir les détails'));
  expect(view.getByText('Contacter Seconde')).toBeTruthy();
  expect(mockQueryError).toHaveBeenCalled();
});

it('preserves the decisions route for a completed agreement without loading it on the normal page', async () => {
  mockRead.mockResolvedValue(order({status: 'completed', fundsReleasedAt: new Date('2026-10-29T12:00:00Z')}));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('La vente est terminée')).toBeTruthy());
  expect(view.queryByText('Décisions et recours')).toBeNull();
  fireEvent.press(view.getByLabelText('Aide et options de la commande'));
  fireEvent.press(view.getByText('Décisions et recours'));
  expect(mockRouter.push).toHaveBeenCalledWith({pathname: '/orders/decisions/[id]', params: {id: 'private_order'}});
});

it('keeps the addressed banking notice exact when opening its compact tool', async () => {
  const notice = {ownerId: 'seller', transactionId: 'private_order', disputeId: 'du_original', bankCaseEntryId: 'entry_original'};
  mockParams.bankCaseNotice = JSON.stringify(notice);
  const view = render(subject());
  await waitFor(() => expect(mockTools.bank).toHaveBeenCalledWith(expect.objectContaining({noticeReference: notice, transactionId: 'private_order', compact: true})));
  expect(view.queryByText(/entry_original|du_original|private_order/)).toBeNull();
});

it('cancels an obsolete moderation response without reporting a current provider error', async () => {
  let finish!: (value: unknown) => void;
  mockModeration.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const view = render(subject());
  await waitFor(() => expect(mockModeration).toHaveBeenCalledTimes(1));
  mockFocused = false;
  view.rerender(subject());
  await act(async () => {finish({moderation: null});});
  expect(mockQueryError).not.toHaveBeenCalled();
});

it('clears only its own pending label when the parent selection expires while its local frame remains alive', async () => {
  let fail!: (error: Error) => void, parentCurrent = true;
  mockObserveLabel.mockImplementationOnce(() => new Promise((_resolve, reject) => {fail = reject;}));
  const {result} = renderHook(() => useOrderLabelDocument(order(), null, () => {if (!parentCurrent) throw new Error('Parent expired');}));
  let work!: Promise<void>;
  act(() => {work = result.current.open('forward', 'se-label');});
  await waitFor(() => expect(mockObserveLabel).toHaveBeenCalledTimes(1));
  parentCurrent = false;
  await act(async () => {fail(new Error('Old source failure')); await work;});
  expect(result.current.loading).toBe(false);
  expect(result.current.message).toBeNull();
  expect(mockConfirmLabel).not.toHaveBeenCalled();
  expect(Linking.openURL).not.toHaveBeenCalled();
});

it.each([
  {user: 'seller', patch: {status: 'shipped', carrierCode: 'seconde_dev', trackingUrl: undefined}},
  {user: 'buyer', patch: {status: 'disputed', disputed: true, trackingUrl: undefined}},
] as const)('opens native tracking without an external URL for $user ($patch.status)', async ({user, patch}) => {
  mockUid = user; (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: user};
  mockRead.mockResolvedValue(order(patch));
  const view = render(subject());
  await waitFor(() => expect(view.getByText('Suivre mon colis')).toBeTruthy());
  fireEvent.press(view.getByText('Suivre mon colis'));
  expect(mockRouter.push).toHaveBeenCalledWith({pathname: '/orders/tracking/[id]', params: {id: 'private_order'}});
  expect(Linking.openURL).not.toHaveBeenCalled(); expect(mockObserveLabel).not.toHaveBeenCalled();
});
