import React from 'react';
import {AppState} from 'react-native';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';

let mockParams: Record<string, string> = {};
let mockPending: unknown = null;
const mockPush = jest.fn(), mockExecute = jest.fn(), mockObserve = jest.fn(), mockPanel = jest.fn();
const mockList = jest.fn();
const mockOrders = jest.fn();
const request = {id: 'private-ticket-id', kind: 'access_interruption', status: 'submitted', receivedAtMs: Date.UTC(2026, 9, 29), meetupReason: null};
jest.mock('expo-router', () => ({useLocalSearchParams: () => mockParams, useRouter: () => ({push: mockPush, back: jest.fn()}),
  useFocusEffect: (callback: () => () => void) => {const React = require('react'); React.useEffect(callback, [callback]);}}));
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => 'owner'}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({authenticatedUid: 'owner', user: {id: 'owner'}}))};
});
jest.mock('@/hooks/useSupportProjectionGeneration', () => ({useSupportProjectionGeneration: () => 1}));
jest.mock('@/services/supportProjectionGuard', () => ({areSupportProjectionPagesCurrent: (pages: unknown) => Array.isArray(pages), isSupportProjectionCurrent: () => true}));
jest.mock('@/services/supportRequestService', () => ({ACCOUNT_SUPPORT_KINDS: ['account_reconciliation', 'representation_review'],
  newSupportRequestId: () => 'private-send-id', supportError: (error: Error) => error.message, isLateTransportReference: () => false,
  supportAttemptCanNeutralize: () => true, supportCommandHash: async () => 'hash', isSupportOpaqueAttempt: (value: {version: number}) => value.version === 2,
  supportReceiptRequestId: (value: {requestId?: string}) => value.requestId,
  SupportRequestService: {journal: async () => mockPending, list: (...args: unknown[]) => mockList(...args),
    execute: (...args: unknown[]) => mockExecute(...args), observe: (...args: unknown[]) => mockObserve(...args)}}));
jest.mock('@/services/lateTransportIncidentService', () => ({LateTransportIncidentService: {}}));
jest.mock('@/services/returnToSenderService', () => ({ReturnToSenderService: {}, isReturnToSenderSupportReference: () => false}));
jest.mock('@/services/lateCommercialRecourseService', () => ({LateCommercialRecourseService: {}, isLateCommercialLink: () => false}));
jest.mock('@/services/productReviewService', () => ({productReviewEqual: () => false}));
jest.mock('@/services/swapHoldReviewService', () => ({SwapHoldReviewService: {}}));
jest.mock('@/services/transactionService', () => ({TransactionService: {getUserTransactions: (...args: unknown[]) => mockOrders(...args)}}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@shopify/flash-list', () => ({FlashList: ({ListHeaderComponent, ListEmptyComponent, ListFooterComponent, data, renderItem}: {
  ListHeaderComponent: React.ReactNode; ListEmptyComponent: React.ReactNode; ListFooterComponent: React.ReactNode;
  data: unknown[]; renderItem: (props: {item: unknown}) => React.ReactNode;
}) => {const React = require('react'); const {View} = require('react-native'); return React.createElement(View, null, ListHeaderComponent,
  data.length ? data.map((item, index) => React.createElement(View, {key: index}, renderItem({item}))) : ListEmptyComponent, ListFooterComponent);}}));
jest.mock('@/components/ui', () => {
  const React = require('react'); const {Pressable, Text, TextInput, View} = require('react-native');
  return {ScreenHeader: ({title, onBack}: {title: string; onBack: () => void}) => React.createElement(View, null, React.createElement(Text, null, title), React.createElement(Pressable, {onPress: onBack, accessibilityLabel: 'Retour'})),
    Button: ({children, onPress, disabled}: {children: React.ReactNode; onPress: () => void; disabled?: boolean}) => React.createElement(Pressable, {onPress, disabled}, React.createElement(Text, null, children)),
    Input: ({label, disabled, ...props}: {label: string; disabled?: boolean}) => React.createElement(TextInput, {...props, accessibilityLabel: label, editable: !disabled})};
});
jest.mock('@/components/LateTransportRecoveryJournal', () => ({LateTransportRecoveryJournal: () => {mockPanel('transport'); return null;}}));
jest.mock('@/components/AccountRelationshipJournal', () => ({AccountRelationshipJournal: () => {mockPanel('accounts'); return null;}}));
jest.mock('@/components/SupportLegalReviewJournal', () => ({SupportLegalReviewJournal: ({area}: {area: string}) => {mockPanel(area); return null;}}));
jest.mock('@/components/PrivacyOperationsJournal', () => ({PrivacyOperationsJournal: () => {mockPanel('privacy'); return null;}}));
jest.mock('@/components/BusinessCessationHistory', () => ({BusinessCessationHistory: () => {mockPanel('continuity'); return null;}}));
jest.mock('@/components/SupportConfidentialityPanel', () => ({SupportConfidentialityPanel: () => {mockPanel('confidentiality'); return null;}}));
jest.mock('@/components/SupportPrivacyScopeFields', () => ({SupportPrivacyScopeFields: () => null}));
import SupportRequests from '@/app/settings/support';

let client: QueryClient;
const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
const wrapper = ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'owner'};
  mockParams = {}; mockPending = null;
  mockList.mockResolvedValue({items: [request], cursor: null});
  mockOrders.mockResolvedValue([]);
  mockExecute.mockResolvedValue({state: 'committed', requestId: 'private-send-id'});
  mockObserve.mockResolvedValue({state: 'unrecorded'});
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(async () => {await act(async () => {client.clear();}); jest.clearAllMocks();});
afterAll(() => {if (originalState) Object.defineProperty(AppState, 'currentState', originalState);});

it('keeps ordinary help concise and opens a request using its internal exact id', async () => {
  render(<SupportRequests/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Demande enregistrée')).toBeTruthy());
  expect(screen.queryByText('private-ticket-id')).toBeNull(); expect(screen.queryByRole('radio')).toBeNull();
  expect(mockPanel).not.toHaveBeenCalled();
  expect(mockOrders).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Demande enregistrée'));
  expect(mockPush).toHaveBeenCalledWith({pathname: '/settings/support/[id]', params: {id: 'private-ticket-id'}});
});

it('requires an explicit subject for generic help while keeping the written request', async () => {
  render(<SupportRequests/>, {wrapper});
  await waitFor(() => expect(screen.getByLabelText('Comment pouvons-nous vous aider ?').props.editable).toBe(true));
  expect(screen.getByText('Choisir un sujet')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Comment pouvons-nous vous aider ?'), 'Je souhaite de l’aide pour me connecter.');
  expect(screen.getByText('Envoyer ma demande')).toBeDisabled();
  fireEvent.press(screen.getByLabelText('Choisir le sujet de ma demande'));
  fireEvent.press(screen.getByRole('radio', {name: 'Interruption d’accès au compte'}));
  expect(screen.getByDisplayValue('Je souhaite de l’aide pour me connecter.')).toBeTruthy();
  expect(screen.getByText('Envoyer ma demande')).not.toBeDisabled();
  expect(mockExecute).not.toHaveBeenCalled();
});

it('mounts only the particular follow-up selected voluntarily', async () => {
  render(<SupportRequests/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Demande enregistrée')).toBeTruthy());
  fireEvent.press(screen.getByText('Autres démarches et suivis'));
  expect(mockPanel).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Continuité du service'));
  expect(mockPanel).toHaveBeenCalledWith('continuity');
  expect(mockPanel.mock.calls.every(([name]) => name === 'continuity')).toBe(true);
  expect(mockExecute).not.toHaveBeenCalled(); expect(mockObserve).not.toHaveBeenCalled();
});

it('submits the inherited order context without exposing it or changing the command', async () => {
  mockParams = {kind: 'commercial_late', transactionId: 'private-order-id'};
  render(<SupportRequests/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Votre commande est jointe à cette demande.')).toBeTruthy());
  await waitFor(() => expect(screen.getByLabelText('Comment pouvons-nous vous aider ?').props.editable).toBe(true));
  expect(screen.queryByText('private-order-id')).toBeNull(); expect(screen.queryByDisplayValue('private-order-id')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Comment pouvons-nous vous aider ?'), 'Mon colis est endommagé.');
  await waitFor(() => expect(screen.getByText('Envoyer ma demande')).not.toBeDisabled());
  fireEvent.press(screen.getByText('Envoyer ma demande'));
  await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
  expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({uid: 'owner', command: {action: 'submit', kind: 'commercial_late', narrative: 'Mon colis est endommagé.', transactionId: 'private-order-id'}}), expect.any(Function));
});

it('retains the saved request recovery while keeping its private id out of the page', async () => {
  mockPending = {version: 2, requestId: 'private-pending-id', uid: 'owner'};
  render(<SupportRequests/>, {wrapper});
  await waitFor(() => expect(screen.getByText('Votre demande est en attente')).toBeTruthy());
  expect(screen.queryByText(/private-pending-id/)).toBeNull(); expect(screen.queryByText('Envoyer ma demande')).toBeNull();
  fireEvent.press(screen.getByText('Actualiser le résultat'));
  await waitFor(() => expect(mockObserve).toHaveBeenCalledTimes(1));
  expect(mockObserve).toHaveBeenCalledWith(mockPending, expect.any(Function)); expect(mockExecute).not.toHaveBeenCalled();
});

it('selects a native sale in place, retains the narrative and sends its internal order context', async () => {
  mockParams = {kind: 'commercial_late'};
  mockOrders.mockResolvedValue([
    {id: 'private-sale-id', sellerId: 'owner', buyerId: 'buyer', articleId: 'coat', articleSnapshot: {title: 'Manteau vert'}},
    {id: 'private-purchase-id', buyerId: 'owner', sellerId: 'seller', articleId: 'shoe', articleSnapshot: {title: 'Chaussures'}},
    {id: 'not-a-participant', buyerId: 'other', sellerId: 'another', articleId: 'hidden', articleSnapshot: {title: 'Article privé tiers'}},
  ]);
  render(<SupportRequests/>, {wrapper});
  await waitFor(() => expect(screen.getByLabelText('Comment pouvons-nous vous aider ?').props.editable).toBe(true));
  fireEvent.changeText(screen.getByLabelText('Comment pouvons-nous vous aider ?'), 'Le colis de ma vente a un problème.');
  expect(mockOrders).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Choisir la commande concernée'));
  await waitFor(() => expect(screen.getByText('Ma vente')).toBeTruthy());
  expect(screen.getByText('Mon achat')).toBeTruthy(); expect(screen.queryByText('Article privé tiers')).toBeNull();
  expect(screen.queryByText('private-sale-id')).toBeNull();
  fireEvent.press(screen.getByLabelText('Choisir Manteau vert'));
  expect(screen.getByDisplayValue('Le colis de ma vente a un problème.')).toBeTruthy();
  expect(mockExecute).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Envoyer ma demande'));
  await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
  expect(mockExecute).toHaveBeenCalledWith(expect.objectContaining({command: expect.objectContaining({transactionId: 'private-sale-id', narrative: 'Le colis de ma vente a un problème.'})}), expect.any(Function));
});

it('does not expose a late order-list response from a lost account session', async () => {
  mockParams = {kind: 'commercial_late'};
  let resolve!: (orders: unknown[]) => void;
  mockOrders.mockImplementationOnce(() => new Promise(value => {resolve = value;}));
  render(<SupportRequests/>, {wrapper});
  await waitFor(() => expect(screen.getByLabelText('Comment pouvons-nous vous aider ?').props.editable).toBe(true));
  fireEvent.press(screen.getByText('Choisir la commande concernée'));
  await waitFor(() => expect(mockOrders).toHaveBeenCalledTimes(1));
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'other'};
  await act(async () => {resolve([{id: 'private-sale-id', sellerId: 'owner', buyerId: 'buyer', articleId: 'coat', articleSnapshot: {title: 'Manteau vert'}}]);});
  expect(screen.queryByText('Manteau vert')).toBeNull(); expect(mockExecute).not.toHaveBeenCalled();
});
