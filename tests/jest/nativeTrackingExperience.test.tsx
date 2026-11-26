import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import type {Transaction} from '@/types';
import type {ObservedTrackingCapture, ObservedTrackingEvent, TrackingHistoryPage} from '@/types/trackingHistory';

const mockReadOrder = jest.fn(), mockReadHistory = jest.fn();
const mockRouter = {push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false)};
let mockUid = 'buyer', mockGeneration = 1, mockFocused = true, mockFrame = 1;
let mockParams: {id: string; leg?: string} = {id: 'order'};
jest.mock('expo-router', () => ({useRouter: () => mockRouter, useLocalSearchParams: () => mockParams}));
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => mockUid}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => mockGeneration}));
jest.mock('@/config/featureFlags', () => ({DEV_COMMERCE_TESTING_ENABLED: true}));
jest.mock('@/hooks/useShippingPurchaseContext', () => ({useShippingPurchaseContext: (source: string) => ({
  focused: mockFocused, frame: mockFrame, focusRevision: mockFrame,
  capture: () => {if (!mockFocused) throw new Error('old'); return {source, frame: mockFrame, uid: mockUid};},
  assertCurrent: (value: {source: string; frame: number; uid: string}) => {
    if (!mockFocused || value.frame !== mockFrame || value.uid !== mockUid) throw new Error('old');
  },
})}));
jest.mock('@/services/transactionService', () => ({TransactionService: {getTransaction: (...args: unknown[]) => mockReadOrder(...args),
  subscribeToTransaction: () => jest.fn()}}));
jest.mock('@/services/trackingHistoryService', () => ({
  TrackingHistoryService: {read: (...args: unknown[]) => mockReadHistory(...args)},
  nextTrackingHistoryPage: jest.requireActual('@/services/trackingHistoryService').nextTrackingHistoryPage,
}));
jest.mock('@/features/orders', () => ({ObservedTrackingHistory: jest.requireActual('@/features/orders/components/ObservedTrackingHistory').ObservedTrackingHistory}));
jest.mock('@/components/ui', () => {
  const {Pressable, Text, View} = require('react-native');
  return {Button: ({children, onPress, disabled}: {children: React.ReactNode; onPress: () => void; disabled?: boolean}) => <Pressable onPress={onPress} disabled={disabled}><Text>{children}</Text></Pressable>,
    Skeleton: () => <Text>Chargement</Text>,
    ScreenHeader: ({title, onBack, rightContent}: {title: string; onBack: () => void; rightContent?: React.ReactNode}) => <View><Text>{title}</Text><Pressable accessibilityLabel="Retour" onPress={onBack}/>{rightContent}</View>};
});
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  return {FlashList: ({data, renderItem, ListHeaderComponent, ListFooterComponent, ListEmptyComponent}: {
  data: Array<{key: string}>; renderItem: (item: {item: {key: string}; index: number}) => React.ReactNode;
  ListHeaderComponent: React.ReactNode; ListFooterComponent: React.ReactNode; ListEmptyComponent: React.ReactNode;
}) => <>{ListHeaderComponent}{data.length ? data.map((item, index) => <React.Fragment key={item.key}>{renderItem({item, index})}</React.Fragment>) : ListEmptyComponent}{ListFooterComponent}</>};
});

import OrderTrackingScreen from '@/app/orders/tracking/[id]';
import {ObservedTrackingHistory} from '@/features/orders/components/ObservedTrackingHistory';
import {trackingPresentation} from '@/features/orders/lib/trackingPresentation';

const order = (patch: Partial<Transaction> = {}): Transaction => ({id: 'order', buyerId: 'buyer', sellerId: 'seller',
  deliveryType: 'shipping', status: 'label_created', shipEngineLabelId: 'label', ...patch} as Transaction);
const capture = (patch: Partial<ObservedTrackingCapture> = {}): ObservedTrackingCapture => ({captureId: 'capture', sourceHash: 'source', readVersion: 1,
  displayHash: 'display', currentCapture: true, totalEvents: 0, providerStatusCode: 'IT', providerReadAt: '2026-10-29T12:00:00.000Z',
  estimatedDeliveryAtUtc: null, ...patch} as ObservedTrackingCapture);
const event = (index: number, code: string, at: string | null): ObservedTrackingEvent => ({index, statusCode: code,
  occurredAtUtc: at, occurredAtQualified: at !== null, city: 'Montréal', province: 'QC', description: null} as ObservedTrackingEvent);
const page = (patch: Partial<TrackingHistoryPage> = {}): TrackingHistoryPage => ({protocol: 'tracking_history_v1', ownerId: mockUid,
  transactionId: 'order', leg: 'forward', capture: null, reason: 'unrecorded', events: {items: [], hasMore: false, cursor: null}, ...patch});
let client: QueryClient;
const mockOnError = jest.fn();
beforeEach(() => {
  mockUid = 'buyer'; mockGeneration = 1; mockFocused = true; mockFrame = 1; mockParams = {id: 'order'};
  mockReadOrder.mockResolvedValue(order()); mockReadHistory.mockResolvedValue(page());
  client = new QueryClient({queryCache: new QueryCache({onError: mockOnError}), defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => client.clear());
const wrapper = ({children}: {children: React.ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

it('reads only the exact private order and tracking observation, including label-only Dev orders', async () => {
  mockReadOrder.mockResolvedValue(order({carrierCode: 'seconde_dev', shipEngineLabelId: `se-devsim-${'a'.repeat(32)}`}));
  const view = render(<OrderTrackingScreen/>, {wrapper});
  await waitFor(() => expect(view.getByText('Prêt à être déposé')).toBeTruthy());
  expect(view.getByText('Simulation Seconde Dev')).toBeTruthy();
  expect(mockReadOrder).toHaveBeenCalledWith('order', {expectedUid: 'buyer', assertCurrent: expect.any(Function)});
  expect(mockReadHistory).toHaveBeenCalledWith('buyer', 'order', 'forward', undefined, expect.any(Function), true);
  fireEvent.press(view.getByLabelText('Retour'));
  expect(mockRouter.replace).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'order'}});
});

it.each([{id: '../other'}, {id: 'order', leg: 'bad'}])('does not read an invalid route %j', async params => {
  mockParams = params;
  const view = render(<OrderTrackingScreen/>, {wrapper});
  await act(async () => Promise.resolve());
  expect(view.getByText('Ce suivi est indisponible')).toBeTruthy();
  expect(mockReadOrder).not.toHaveBeenCalled(); expect(mockReadHistory).not.toHaveBeenCalled();
});

it('does not expose another party order and keeps current read errors visible', async () => {
  mockReadOrder.mockResolvedValue(order({buyerId: 'other', sellerId: 'someone'}));
  const view = render(<OrderTrackingScreen/>, {wrapper});
  await waitFor(() => expect(view.getByText('Ce suivi est indisponible')).toBeTruthy());
  expect(mockReadHistory).not.toHaveBeenCalled(); expect(mockOnError).toHaveBeenCalled();
});

it('reads the selected return separately without adopting forward events', async () => {
  mockReadOrder.mockResolvedValue(order({returnLabelId: 'return_label'}));
  mockReadHistory.mockImplementation(async (_uid: string, _id: string, leg: string) => page({leg: leg as 'forward' | 'return'}));
  const view = render(<OrderTrackingScreen/>, {wrapper});
  await waitFor(() => expect(view.getByText('Prêt à être déposé')).toBeTruthy());
  fireEvent.press(view.getByRole('tab', {name: 'Retour'}));
  await waitFor(() => expect(mockReadHistory).toHaveBeenLastCalledWith('buyer', 'order', 'return', undefined, expect.any(Function), false));
  expect(view.getByText('Suivi du retour')).toBeTruthy();
});

it('cancels a late tracking response after the original page loses focus', async () => {
  let resolve!: (value: TrackingHistoryPage) => void;
  mockReadHistory.mockReturnValue(new Promise(done => {resolve = done;}));
  const view = render(<ObservedTrackingHistory transaction={order()} leg="forward"/>, {wrapper});
  await waitFor(() => expect(mockReadHistory).toHaveBeenCalledTimes(1));
  mockFocused = false; mockFrame++;
  view.rerender(<ObservedTrackingHistory transaction={order()} leg="forward"/>);
  await act(async () => {resolve(page({capture: capture(), reason: null}));});
  expect(view.queryByText('Colis en route')).toBeNull();
  expect(mockOnError).not.toHaveBeenCalled();
});

it('does not turn an unrecorded label into scans, an ETA or out-for-delivery', () => {
  const result = trackingPresentation(order(), 'forward', null, []);
  expect(result.events).toEqual([]); expect(result.estimatedDeliveryLabel).toBeNull();
  expect(result.steps.map(step => step.state)).toEqual(['current', 'upcoming', 'upcoming']);
  expect(JSON.stringify(result)).not.toContain('En livraison');
});

it('sorts qualified event dates without changing native indexes and does not infer out-for-delivery from transit text', () => {
  const events = [event(0, 'IT', '2026-10-29T09:00:00.000Z'), event(1, 'AC', null), event(2, 'IT', '2026-10-29T10:00:00.000Z')];
  const result = trackingPresentation(order(), 'forward', capture({statusDescription: 'out for delivery'}), events);
  expect(events.map(item => item.index)).toEqual([0, 1, 2]);
  expect(result.events.map(item => item.key.split(':').at(-1))).toEqual(['2', '0', '1']);
  expect(result.title).toBe('Colis en route'); expect(result.steps.at(-1)?.state).toBe('upcoming');
  expect(result.estimatedDeliveryLabel).toBeNull();
});

it.each(['shipped', 'delivered', 'completed'] as const)('does not regress an order %s to preparation when its capture is absent', status => {
  const result = trackingPresentation(order({status}), 'forward', null, []);
  expect(result.title).toBe('Suivi en attente de mise à jour');
  expect(result.steps).toEqual([]); expect(result.events).toEqual([]);
});

it('does not invent preparation progress from an exception without dated transport history', () => {
  const result = trackingPresentation(order(), 'forward', capture({providerStatusCode: 'EX'}), []);
  expect(result.title).toBe('Incident d’acheminement'); expect(result.attention).toBe(true);
  expect(result.steps).toEqual([]);
});

it.each(['EX', 'AT'])('retains an observed delivery milestone while highlighting the current %s incident', providerStatusCode => {
  const result = trackingPresentation(order({status: 'disputed'}), 'forward', capture({providerStatusCode}),
    [event(0, 'DE', '2026-10-29T09:00:00.000Z')]);
  expect(result.attention).toBe(true); expect(result.steps.at(-1)?.state).toBe('current');
  expect(result.events[0].title).toBe('Colis livré');
});

it('keeps pagination bound to its native capture and labels it without assuming older events', async () => {
  const nativeCapture = capture({totalEvents: 51, estimatedDeliveryAtUtc: '2026-10-30T12:00:00.000Z'});
  const firstEvents = Array.from({length: 50}, (_, index) => event(index, 'IT', '2026-10-29T09:00:00.000Z'));
  mockReadHistory.mockResolvedValueOnce(page({capture: nativeCapture, reason: null,
    events: {items: firstEvents, hasMore: true, cursor: {captureId: nativeCapture.captureId, offset: 50}}}))
    .mockResolvedValueOnce(page({capture: nativeCapture, reason: null,
      events: {items: [event(50, 'AC', '2026-10-29T10:00:00.000Z')], hasMore: false, cursor: null}}));
  const view = render(<ObservedTrackingHistory transaction={order()} leg="forward"/>, {wrapper});
  await waitFor(() => expect(view.getByText('Voir plus d’événements')).toBeTruthy());
  expect(view.queryByText(/Mis à jour Mis à jour/)).toBeNull();
  expect(view.queryByText(/Livraison estimée Livraison estimée/)).toBeNull();
  fireEvent.press(view.getByText('Voir plus d’événements'));
  await waitFor(() => expect(view.getByText('Colis pris en charge')).toBeTruthy());
  expect(mockReadHistory.mock.calls[1][3]).toEqual({captureId: nativeCapture.captureId, expectedSourceHash: nativeCapture.sourceHash,
    expectedReadVersion: 1, expectedDisplayHash: nativeCapture.displayHash, cursor: {captureId: nativeCapture.captureId, offset: 50}});
});

it('discards a late history from a replaced label and shows only the newly qualified capture', async () => {
  let resolve!: (value: TrackingHistoryPage) => void;
  mockReadHistory.mockReturnValueOnce(new Promise(done => {resolve = done;}))
    .mockResolvedValue(page({capture: capture({captureId: 'new_capture', providerStatusCode: 'DE'}), reason: null}));
  const view = render(<ObservedTrackingHistory transaction={order()} leg="forward"/>, {wrapper});
  await waitFor(() => expect(mockReadHistory).toHaveBeenCalledTimes(1));
  view.rerender(<ObservedTrackingHistory transaction={order({shipEngineLabelId: 'replacement_label'})} leg="forward"/>);
  await waitFor(() => expect(view.getByText('Colis livré')).toBeTruthy());
  await act(async () => {resolve(page({capture: capture({providerStatusCode: 'IT'}), reason: null}));});
  expect(view.queryByText('Colis en route')).toBeNull(); expect(view.getByText('Colis livré')).toBeTruthy();
  expect(mockOnError).not.toHaveBeenCalled();
});

it('refreshes the same private order and captured history through reads only', async () => {
  const view = render(<OrderTrackingScreen/>, {wrapper});
  await waitFor(() => expect(view.getByText('Prêt à être déposé')).toBeTruthy());
  fireEvent.press(view.getByLabelText('Actualiser le suivi'));
  await waitFor(() => expect(mockReadHistory).toHaveBeenCalledTimes(2));
  expect(mockReadOrder.mock.calls.map(args => args[0])).toEqual(['order', 'order']);
  expect(mockReadHistory.mock.calls.every(args => args[0] === 'buyer' && args[1] === 'order' && args[2] === 'forward')).toBe(true);
});

it('honours a new return deep link for the same order after a local forward selection', async () => {
  mockReadOrder.mockResolvedValue(order({returnLabelId: 'return_label'}));
  mockReadHistory.mockImplementation(async (_uid: string, _id: string, leg: string) => page({leg: leg as 'forward' | 'return'}));
  const view = render(<OrderTrackingScreen/>, {wrapper});
  await waitFor(() => expect(view.getByRole('tab', {name: 'Envoi'})).toBeTruthy());
  fireEvent.press(view.getByRole('tab', {name: 'Envoi'}));
  mockParams = {id: 'order', leg: 'return'};
  view.rerender(<OrderTrackingScreen/>);
  await waitFor(() => expect(view.getByText('Suivi du retour')).toBeTruthy());
  expect(mockReadHistory).toHaveBeenLastCalledWith('buyer', 'order', 'return', undefined, expect.any(Function), false);
});
