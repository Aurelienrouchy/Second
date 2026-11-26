import React from 'react';
import {AppState} from 'react-native';
import {fireEvent, render, waitFor, act} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import type {Notification} from '@/types/notification';
const mockPush = jest.fn(), mockMark = jest.fn(), mockSearch = jest.fn(), mockReset = jest.fn();
let mockRows: Notification[];
jest.mock('@expo/vector-icons', () => ({Ionicons: () => null}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('expo-constants', () => ({__esModule: true, default: {expoConfig: {extra: {eas: {projectId: 'test'}}}}}));
jest.mock('expo-application', () => ({applicationId: 'com.seconde.app.dev'}));
jest.mock('expo-router', () => ({router: {push: (...args: unknown[]) => mockPush(...args), back: jest.fn()},
  Stack: {Screen: () => null}, useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => () => void) => {const React = require('react'); React.useEffect(callback, [callback]);}}));
jest.mock('expo-linking', () => ({parse: (url: string) => {
  const parsed = new URL(url); return {path: parsed.pathname.slice(1), queryParams: Object.fromEntries(parsed.searchParams.entries())};
}}));
jest.mock('expo-notifications', () => ({setNotificationHandler: jest.fn(), setBadgeCountAsync: jest.fn()}));
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => 'owner'}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({authenticatedUid: 'owner', user: {id: 'owner'}}))};
});
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@/services/userService', () => ({UserService: {}}));
jest.mock('@/services/savedSearchService', () => ({SavedSearchService: {
  getSavedSearchById: (...args: unknown[]) => mockSearch(...args), resetNewItemsCount: (...args: unknown[]) => mockReset(...args),
}}));
jest.mock('@/features/notifications/services/notificationService', () => ({NotificationService: {
  getUserNotifications: async () => mockRows, markAsRead: (...args: unknown[]) => mockMark(...args),
  countUnreadNotifications: async () => 0, deleteNotification: jest.fn(), markAllAsRead: jest.fn(),
}}));
jest.mock('@/components/ui', () => ({ScreenHeader: ({rightContent}: {rightContent: React.ReactNode}) => rightContent ?? null}));
jest.mock('@/components/ui/Skeleton', () => ({Skeleton: () => null}));
jest.mock('@/components/ReportBottomSheet', () => ({__esModule: true, default: require('react').forwardRef(() => null)}));
jest.mock('react-native-gesture-handler/Swipeable', () => ({__esModule: true, default: ({children}: {children: React.ReactNode}) => children}));
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  return {FlashList: ({data, renderItem}: {data: Notification[]; renderItem: (row: {item: Notification}) => React.ReactNode}) => data.map(item => <React.Fragment key={item.id}>{renderItem({item})}</React.Fragment>)};
});
import NotificationsScreen from '@/app/notifications';
import {deepLinkToHref} from '@/features/notifications/hooks/useNotificationSetup';
let client: QueryClient;
beforeEach(() => {
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'owner'};
  mockRows = [{id: 'notice', userId: 'owner', type: 'new_message', title: 'Message', message: 'Un message', isRead: false,
    createdAt: new Date(), data: {chatId: 'chat', deepLink: 'https://seconde.ca/chat/chat?transactionId=order&leg=return'}}];
  mockMark.mockResolvedValue(undefined); mockReset.mockResolvedValue(undefined);
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
});
afterEach(() => client.clear());
function screen() {return render(<QueryClientProvider client={client}><NotificationsScreen/></QueryClientProvider>);}
it('preserves encoded query parameters in backend-built links', () => {
  expect(deepLinkToHref('https://seconde.ca/search?query=robe%20rouge&sellerId=seller')).toBe('/search?query=robe%20rouge&sellerId=seller');
});
it('opens immediately with all parameters while its read marker is still pending, and blocks a double tap', async () => {
  let reject!: (error: Error) => void; mockMark.mockImplementationOnce(() => new Promise((_resolve, fail) => {reject = fail;}));
  const view = screen(); await waitFor(() => expect(view.getByTestId('notification-item-notice')).toBeTruthy());
  fireEvent.press(view.getByTestId('notification-item-notice'), {nativeEvent: {pageX: 1}});
  fireEvent.press(view.getByTestId('notification-item-notice'), {nativeEvent: {pageX: 1}});
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith('/chat/chat?transactionId=order&leg=return');
  await act(async () => {reject(new Error('Read marker unavailable'));});
  expect(mockPush).toHaveBeenCalledTimes(1);
});
it('restores a saved search query and filters even when resetting its unread count fails', async () => {
  mockRows[0] = {...mockRows[0], type: 'saved_search', data: {savedSearchId: 'saved', deepLink: 'https://seconde.ca/search?savedSearchId=saved'}};
  mockSearch.mockResolvedValue({query: 'robe', filters: {brand: 'Maison', maxPrice: 40}});
  mockReset.mockRejectedValueOnce(new Error('Counter unavailable'));
  const view = screen(); await waitFor(() => expect(view.getByTestId('notification-item-notice')).toBeTruthy());
  fireEvent.press(view.getByTestId('notification-item-notice'), {nativeEvent: {pageX: 1}});
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith({pathname: '/search', params: {query: 'robe', filters: JSON.stringify({brand: 'Maison', maxPrice: 40})}}));
  expect(mockSearch).toHaveBeenCalledWith('owner', 'saved');
});
