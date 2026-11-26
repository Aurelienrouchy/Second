import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {CancelledError} from '@tanstack/react-query';

const mockPush = jest.fn(), mockExport = jest.fn();
const mockHistoryRead = jest.fn(), mockHoldsRead = jest.fn();
let mockScopeCurrent = true;
const mockQueries = new Map<string, (input: {pageParam: string | null; signal: AbortSignal}) => Promise<unknown>>();
jest.mock('expo-linear-gradient', () => ({LinearGradient: require('react-native').View}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('@/components/ui', () => ({Button: jest.requireActual('@/components/ui/Button').Button,
  Text: jest.requireActual('@/components/ui/Text').Text, ScreenHeader: jest.requireActual('@/components/ui/ScreenHeader').ScreenHeader,
}));
const mockHold = {transactionId: 'ORDER_PRIVATE', reviewQualification: 'native', review: {
  reason: 'commercial_dispute', currentSourceMatches: true, observedAt: '2026-10-29T12:00:00Z',
  amountCents: 3200, startedAt: '2026-10-28T12:00:00Z', initialDeadlineAt: '2026-11-04T12:00:00Z',
  operationalThresholdExceeded: false, operationalAgingThresholdMs: null, message: 'Source interne ORDER_PRIVATE',
}};
jest.mock('expo-router', () => ({useRouter: () => ({push: mockPush, back: jest.fn()})}));
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedSession: () => ({uid: 'seller'})}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1,
  useAuthStore: (selector: (state: {authenticatedUid: string}) => unknown) => selector({authenticatedUid: 'seller'}),
}));
jest.mock('@/hooks/useShippingPurchaseContext', () => ({useShippingPurchaseContext: () => ({focused: true, focusRevision: 1,
  capture: () => {if (!mockScopeCurrent) throw new Error('capture expired'); return {session: {uid: 'seller'}};},
  assertCurrent: () => {if (!mockScopeCurrent) throw new Error('source expired');},
})}));
jest.mock('@/features/wallet/services/walletHistoryService', () => ({getWalletHistoryPage: (...args: unknown[]) => mockHistoryRead(...args), exportWalletHistory: jest.fn()}));
jest.mock('@/services/holdReviewService', () => ({getSellerHoldReviews: (...args: unknown[]) => mockHoldsRead(...args)}));
jest.mock('@tanstack/react-query', () => ({CancelledError: jest.requireActual('@tanstack/react-query').CancelledError,
  useMutation: () => ({isPending: false, mutate: mockExport}),
  useInfiniteQuery: ({queryKey, queryFn}: {queryKey: string[]; queryFn: (input: {pageParam: string | null; signal: AbortSignal}) => Promise<unknown>}) => {
    mockQueries.set(queryKey[0], queryFn);
    return {isSuccess: true, isFetching: false, isError: false, isPending: false,
    hasNextPage: false, data: queryKey[0] === 'seller-hold-reviews'
      ? {pages: [{ownerId: 'seller', readAt: '2026-10-29T12:00:00Z', rows: [mockHold], nextCursor: null, coverage: {inspectedCount: 3}}], pageParams: [null]}
      : {pages: [{entries: [{id: 'LEDGER_PRIVATE', source: 'ledger', type: 'sale_credit', amountCents: 3200,
        currency: 'CAD', createdAt: '2026-10-29T12:00:00Z', description: 'Référence technique ORDER_PRIVATE',
        balanceAfterCents: 10000, amountMeaning: 'wallet_movement', anomalies: [], debtRecordedCents: null}], hasMore: false}]},
    refetch: jest.fn(), fetchNextPage: jest.fn(),
  };},
}));
jest.mock('@shopify/flash-list', () => {
  const {View} = require('react-native');
  return {FlashList: ({data, renderItem, ListHeaderComponent, ListFooterComponent}: {
    data: unknown[]; renderItem: (row: {item: unknown}) => React.ReactNode; ListHeaderComponent?: React.ReactNode; ListFooterComponent?: React.ReactNode;
  }) => <View>{ListHeaderComponent}{data.map((item, index) => <View key={index}>{renderItem({item})}</View>)}{ListFooterComponent}</View>};
});

import WalletHistoryScreen from '@/app/wallet/history';
import WalletHoldsScreen from '@/app/wallet/holds';

beforeEach(() => {mockScopeCurrent = true; mockHistoryRead.mockReset(); mockHoldsRead.mockReset(); mockQueries.clear();});

it('keeps history filters and export available on demand without exposing raw ledger descriptions', () => {
  const screen = render(<WalletHistoryScreen/>);
  expect(screen.getByText('Crédit de vente')).toBeTruthy();
  expect(screen.queryByText(/ORDER_PRIVATE|LEDGER_PRIVATE/)).toBeNull();
  expect(screen.queryByText('Exporter mon historique')).toBeNull();
  fireEvent.press(screen.getByText('Filtrer et exporter'));
  expect(screen.getByText('Exporter mon historique')).toBeEnabled();
  fireEvent.press(screen.getByText('Exporter mon historique'));
  expect(mockExport).toHaveBeenCalledTimes(1);
  fireEvent.changeText(screen.getByLabelText('Début inclus UTC, AAAA-MM-JJ'), '2026-10-01');
  expect(screen.getByText('Exporter mon historique')).toBeDisabled();
});

it('keeps the exact held sale accessible using its reason and amount instead of its internal ID', () => {
  const screen = render(<WalletHoldsScreen/>);
  expect(screen.queryByText(/ORDER_PRIVATE|3 ventes consultées/)).toBeNull();
  expect(screen.getByText('Litige commercial')).toBeTruthy();
  expect(screen.getByText('Montant concerné : 32,00 $ CAD')).toBeTruthy();
  fireEvent.press(screen.getByText('Voir la commande'));
  expect(mockPush).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'ORDER_PRIVATE'}});
});

it.each(['wallet-history', 'seller-hold-reviews'])('cancels an obsolete %s GET while preserving its original owner and cursor', async key => {
  render(key === 'wallet-history' ? <WalletHistoryScreen/> : <WalletHoldsScreen/>);
  let resolve!: (value: unknown) => void;
  const read = key === 'wallet-history' ? mockHistoryRead : mockHoldsRead;
  read.mockImplementation(() => new Promise(done => {resolve = done;}));
  const pending = mockQueries.get(key)!({pageParam: 'original-cursor', signal: new AbortController().signal});
  expect(read.mock.calls[0][0]).toBe('seller');
  expect(key === 'wallet-history' ? read.mock.calls[0][1].cursor : read.mock.calls[0][1]).toBe('original-cursor');
  mockScopeCurrent = false; resolve({});
  await expect(pending).rejects.toBeInstanceOf(CancelledError);
  expect(read).toHaveBeenCalledTimes(1);
});

it.each(['wallet-history', 'seller-hold-reviews'])('keeps a current %s GET failure visible', async key => {
  render(key === 'wallet-history' ? <WalletHistoryScreen/> : <WalletHoldsScreen/>);
  const read = key === 'wallet-history' ? mockHistoryRead : mockHoldsRead, error = new Error('permission denied');
  read.mockRejectedValue(error);
  await expect(mockQueries.get(key)!({pageParam: null, signal: new AbortController().signal})).rejects.toBe(error);
});
