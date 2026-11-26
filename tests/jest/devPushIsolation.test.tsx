import {act, renderHook} from '@testing-library/react-native';
import {auth} from '@/config/firebaseConfig';
import {useNotificationStore} from '@/store/notificationStore';

let mockUid = 'buyer-B';
let mockGeneration = 1;
let mockNativeApp = 'com.seconde.app.dev';
const mockPush = jest.fn();
const mockTrack = jest.fn();
const mockCount = jest.fn(async () => 3);
const mockSetBadge = jest.fn(async () => undefined);
const mockLast = jest.fn(async (): Promise<unknown> => null);
let mockHandler: (value: unknown) => Promise<unknown>;
let mockReceived: (value: unknown) => void;
let mockResponse: (value: unknown) => void;

jest.mock('@/config/firebaseEnvironment', () => ({runtimeEnvironment: {
  name: 'development', projectId: 'seconde-dev', useEmulators: false,
}}));
jest.mock('expo-application', () => ({get applicationId() {return mockNativeApp;}}));
jest.mock('expo-constants', () => ({__esModule: true, default: {
  expoConfig: {extra: {eas: {projectId: '5f72091d-3473-467c-a4fd-96fe18cda4d2'}}},
}}));
jest.mock('@/utils/environmentStorage', () => ({__esModule: true, default: {getItem: jest.fn(), setItem: jest.fn()}}));
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (value: {authenticatedUid: string}) => unknown) => selector({authenticatedUid: mockUid}), {
    getState: () => ({authenticatedUid: mockUid}),
  }),
}));
jest.mock('expo-router', () => ({router: {push: (...args: unknown[]) => mockPush(...args)}}));
jest.mock('expo-linking', () => ({parse: () => ({path: null})}));
jest.mock('@/lib/analytics', () => ({track: (...args: unknown[]) => mockTrack(...args)}));
jest.mock('@/features/notifications/services/notificationService', () => ({NotificationService: {
  countUnreadNotifications: (...args: unknown[]) => mockCount(...args),
}}));
jest.mock('@/services/userService', () => ({UserService: {}}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: (value: {handleNotification: typeof mockHandler}) => {mockHandler = value.handleNotification;},
  getPermissionsAsync: async () => ({status: 'denied', canAskAgain: false}),
  getLastNotificationResponseAsync: () => mockLast(),
  setBadgeCountAsync: (...args: unknown[]) => mockSetBadge(...args),
  addNotificationReceivedListener: (callback: typeof mockReceived) => {mockReceived = callback; return {remove: jest.fn()};},
  addNotificationResponseReceivedListener: (callback: typeof mockResponse) => {mockResponse = callback; return {remove: jest.fn()};},
  addPushTokenListener: () => ({remove: jest.fn()}),
}));
import {refreshNotificationBadge, useNotificationSetup} from '@/features/notifications/hooks/useNotificationSetup';
import {canRegisterDevPushDestination} from '@/services/devPushDestinationService';

function notification(owner = 'buyer-B', marker: string | undefined = 'seconde_dev') {
  return {request: {content: {data: {type: 'offer_accepted', chatId: 'chat', ownerId: owner, pushEnvironment: marker}}}};
}
async function mount() {
  const hook = renderHook(() => useNotificationSetup('buyer-B'));
  await act(async () => {for (let i = 0; i < 4; i++) await Promise.resolve();});
  useNotificationStore.getState().setUnreadCount(0);
  mockSetBadge.mockClear(); mockTrack.mockClear(); mockPush.mockClear();
  return hook;
}
beforeEach(() => {
  mockUid = 'buyer-B'; mockGeneration++; mockNativeApp = 'com.seconde.app.dev';
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: mockUid};
  useNotificationStore.getState().reset();
  mockCount.mockImplementation(async () => 3); mockLast.mockResolvedValue(null);
});
it('refuses foreground banners, counters, analytics and navigation for a queued push of the previous owner', async () => {
  await mount();
  const old = notification('seller-A');
  expect(await mockHandler(old)).toEqual({shouldPlaySound: false, shouldSetBadge: false, shouldShowBanner: false, shouldShowList: false});
  act(() => {mockReceived(old); mockResponse({notification: old});});
  expect(useNotificationStore.getState().unreadCount).toBe(0);
  expect(mockSetBadge).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled(); expect(mockTrack).not.toHaveBeenCalled();
});
it('keeps matching Dev offer taps usable while refusing unmarked pushes and a production native binary', async () => {
  await mount();
  const unmarked = notification();
  delete unmarked.request.content.data.pushEnvironment;
  expect(await mockHandler(unmarked)).toMatchObject({shouldShowBanner: false});
  act(() => {mockResponse({notification: notification()});});
  expect(mockPush).toHaveBeenCalledWith('/chat/chat');
  mockNativeApp = 'com.seconde.app';
  expect(canRegisterDevPushDestination()).toBe(false);
  expect(await mockHandler(notification())).toMatchObject({shouldShowBanner: false, shouldSetBadge: false});
});
it('does not adopt the previous owner from the notification that launched a terminated app', async () => {
  mockLast.mockResolvedValue({notification: notification('seller-A')});
  await mount();
  expect(mockPush).not.toHaveBeenCalled();
  expect(mockTrack.mock.calls.some(([event]) => event === 'push_opened')).toBe(false);
});
it('discards a badge read that completes after the SDK account and generation changed', async () => {
  let finish!: (count: number) => void;
  mockCount.mockImplementation(() => new Promise<number>(resolve => {finish = resolve;}));
  const pending = refreshNotificationBadge('buyer-B');
  mockUid = 'seller-A'; mockGeneration++;
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: mockUid};
  finish(99); await pending;
  expect(useNotificationStore.getState().unreadCount).toBe(0); expect(mockSetBadge).not.toHaveBeenCalled();
});
