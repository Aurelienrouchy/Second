import React from 'react';
import {Alert, AppState} from 'react-native';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';

const mockApprove = jest.fn();
const mockPending = jest.fn();
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({authenticatedUid: 'admin', user: {id: 'admin'}}))};
});
jest.mock('@/hooks/useAuth', () => ({useUser: () => ({id: 'admin'})}));
jest.mock('expo-router', () => ({useRouter: () => ({back: jest.fn(), push: jest.fn(), replace: jest.fn()}),
  useFocusEffect: (callback: () => () => void) => {const React = require('react'); React.useEffect(callback, [callback]);}}));
jest.mock('@/services/userService', () => ({UserService: {isUserAdmin: async () => true}}));
jest.mock('@/services/shopService', () => ({ShopService: {
  getPendingShops: (...args: unknown[]) => mockPending(...args), getApprovedShops: async () => [], getRejectedShops: async () => [], getSuspendedShops: async () => [],
  approveShop: (...args: unknown[]) => mockApprove(...args), rejectShop: jest.fn(), suspendShop: jest.fn(),
}}));
jest.mock('@/features/admin', () => ({AdminSectionNav: () => null}));
jest.mock('@/features/admin/components/ShopValidationCard', () => ({__esModule: true, default: ({shop, onApprove}: {shop: {name: string}; onApprove: () => void}) => {
  const React = require('react'); const {Pressable, Text} = require('react-native');
  return React.createElement(Pressable, {onPress: onApprove}, React.createElement(Text, null, `Approuver ${shop.name}`));
}}));
jest.mock('@/features/admin/components/RejectionModal', () => ({__esModule: true, default: require('react').forwardRef(() => null)}));
jest.mock('@/components/ui/Skeleton', () => ({Skeleton: () => null, SkeletonText: () => null}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: require('react-native').View}));
jest.mock('@expo/vector-icons', () => ({Ionicons: () => null}));
jest.mock('@shopify/flash-list', () => ({FlashList: ({data, renderItem, ListEmptyComponent}: {data: unknown[]; renderItem: (row: {item: unknown}) => React.ReactNode; ListEmptyComponent: () => React.ReactNode}) => {
  const React = require('react'); const {View} = require('react-native');
  return React.createElement(View, null, data.length ? data.map((item, index) => React.createElement(View, {key: index}, renderItem({item}))) : React.createElement(ListEmptyComponent));
}}));
import AdminShops from '@/app/admin/shops';

let client: QueryClient;
const originalState = Object.getOwnPropertyDescriptor(AppState, 'currentState');
function wrapper({children}: {children: React.ReactNode}) {return <QueryClientProvider client={client}>{children}</QueryClientProvider>;}
beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'admin'};
  mockPending.mockResolvedValue([{id: 'shop-A', ownerId: 'seller', name: 'Boutique A', status: 'pending'}]);
  mockApprove.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => {client.clear(); jest.restoreAllMocks(); if (originalState) Object.defineProperty(AppState, 'currentState', originalState);});
async function openConfirmation() {
  await waitFor(() => expect(screen.getByText('Approuver Boutique A')).toBeTruthy());
  fireEvent.press(screen.getByText('Approuver Boutique A'));
  const confirmation = (Alert.alert as jest.Mock).mock.calls.find(call => call[0] === 'Approuver la boutique')?.[2]?.find((button: {text: string}) => button.text === 'Approuver');
  expect(confirmation).toBeTruthy(); return confirmation;
}
it('does not execute an old approval confirmation after choosing another moderation tab', async () => {
  render(<AdminShops/>, {wrapper});
  const confirmation = await openConfirmation();
  fireEvent.press(screen.getByTestId('admin-shops-tab-approved'));
  await waitFor(() => expect(screen.getByText('Aucune boutique')).toBeTruthy());
  await act(async () => {await confirmation.onPress();});
  expect(mockApprove).not.toHaveBeenCalled();
});
it('locks the approval synchronously and preserves the exact administrative target', async () => {
  let finish!: () => void;
  mockApprove.mockImplementation(() => new Promise<void>(resolve => {finish = resolve;}));
  render(<AdminShops/>, {wrapper});
  const confirmation = await openConfirmation();
  let first!: Promise<void>;
  act(() => {first = confirmation.onPress(); void confirmation.onPress();});
  expect(mockApprove).toHaveBeenCalledTimes(1);
  expect(mockApprove).toHaveBeenCalledWith('shop-A', {expectedUid: 'admin', assertCurrent: expect.any(Function)});
  await act(async () => {finish(); await first;});
});
