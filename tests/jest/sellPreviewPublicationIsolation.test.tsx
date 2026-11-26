import {getDoc} from 'firebase/firestore';
import { getEnvironmentFileDirectory } from '@/utils/environmentStorage';
import { renderWithQuery as render } from '@/tests/jest/helpers/queryRender';
import { getEnvironmentStorageKey } from '@/config/firebaseEnvironment';
import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ArticleDraft } from '@/features/sell/services/draftService';
const mockAuth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'A' } };
const {establishIdentityFixture, clearIdentityFixture} = require('@/tests/jest/helpers/identityFixture') as typeof import('@/tests/jest/helpers/identityFixture');
const mockListeners: Array<(user: { uid: string } | null) => void> = [];
const mockCreate = jest.fn(); const mockUpload = jest.fn(async (..._args: unknown[]) => ({status: 200, headers: {'X-Goog-Upload-Status': 'final'}, body: '{}'}));
const mockRemoteCleanup = jest.fn(); const mockReplace = jest.fn();
jest.mock('@/config/firebaseConfig', () => ({ auth: mockAuth, functions: {}, firestore: {}, storage: { app: { options: { storageBucket: 'demo-second.appspot.com' } } } }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, listener: (user: { uid: string } | null) => void) => { mockListeners.push(listener); return jest.fn(); } }));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCreate }));
jest.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => ({ path }), uploadBytes: (...args: unknown[]) => mockUpload(...args), deleteObject: jest.fn(), getDownloadURL: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ documentDirectory: 'file:///documents/', getInfoAsync: async () => ({ exists: true, size: 2048 }), FileSystemUploadType: {BINARY_CONTENT: 'binary'}, uploadAsync: (...args: unknown[]) => mockUpload(...args), readDirectoryAsync: async () => [], deleteAsync: jest.fn() }));
jest.mock('@/utils/imageUtils', () => ({ processImageWithBlurhash: async (uri: string) => ({ compressedUri: uri, blurhash: 'hash' }) }));
jest.mock('@/features/sell/services/aiService', () => ({ deleteDraftImagesFromStorage: (...args: unknown[]) => mockRemoteCleanup(...args) }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
 useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }), useLocalSearchParams: () => ({ resumeDraft: 'true' }), useNavigation: () => ({ addListener: () => jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/features/sell/components/shared/PhotoCarousel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/sell/components/shared/SuccessModal', () => ({ __esModule: true, default: ({ visible }: { visible: boolean }) => visible ? require('react').createElement(require('react-native').Text, { testID: 'success-publication' }, 'Publié') : null }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
const { draftService } = require('@/features/sell/services/draftService') as typeof import('@/features/sell/services/draftService');
const { default: Preview } = require('@/app/sell/preview') as typeof import('@/app/sell/preview');
const key = getEnvironmentStorageKey('@article_draft:user:A'); const intentKey = getEnvironmentStorageKey('@article_publication:A:original');
let alert: jest.SpyInstance;
const draft = (id = 'original', local = false): ArticleDraft => ({ id, ownerUid: 'A', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentStep: 4,
  photos: local ? [`file:///documents/${getEnvironmentFileDirectory('draft_images')}/A/photo.jpg`] : [], originalPhotoUris: [], storageUrls: local ? [] : ['https://firebasestorage.googleapis.com/photo.jpg'],
  fields: { title: 'Article test', description: 'Description', categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'], categoryDisplay: { icon: '', name: 'Haut', context: '' }, condition: 'bon état', conditionConfirmed: true, quantity: 1, colors: [], materials: [], brands: [], size: 'M', brand: null },
  pricing: { price: 40, isHandDelivery: true, isShipping: false, neighborhood: null, neighborhoods: [], packageSize: null }, aiResult: null });
function session(uid: string | null) { if (uid) establishIdentityFixture(uid); else clearIdentityFixture(); mockListeners.forEach(listener => listener(mockAuth.currentUser)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => { jest.clearAllMocks(); (getDoc as jest.Mock).mockResolvedValue({id: 'article-A', exists: () => true, data: () => ({sellerId: 'A', isActive: true, title: 'Article test', images: []})}); session('A'); await AsyncStorage.clear(); await draftService.saveDraft(draft()); mockCreate.mockResolvedValue({ data: { articleId: 'article-A' } }); global.fetch = jest.fn(async (url: string) => {const target = new URL(url); target.searchParams.set('upload_id', 'synthetic-session'); return {ok: true, status: 200, headers: {get: (key: string) => key === 'X-Goog-Upload-Status' ? 'active' : key === 'X-Goog-Upload-URL' ? target.toString() : null}};}) as unknown as typeof fetch; alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());
async function mount() { const view = render(<Preview />); await waitFor(() => expect(view.getByText('Article test')).toBeTruthy()); return view; }

it('a known publication uses real services, finishes its local receipt and synchronously fences a second tap', async () => {
  const pause = deferred<{ data: { articleId: string } }>(); mockCreate.mockReturnValueOnce(pause.promise); const view = await mount();
  act(() => { fireEvent.press(view.getByTestId('sell-publish-button')); fireEvent.press(view.getByTestId('sell-publish-button')); });
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  await act(async () => { pause.resolve({ data: { articleId: 'article-A' } }); });
  await waitFor(() => expect(view.getByTestId('success-publication')).toBeTruthy());
  expect(await AsyncStorage.getItem(key)).toBeNull(); expect(await AsyncStorage.getItem(intentKey)).toBeNull();
  expect(draftService.wasPublished).toBe(true); expect(mockRemoteCleanup).not.toHaveBeenCalled();
});

it('an old A-B-A publication cannot delete, purge or mark the replacement as published', async () => {
  const pause = deferred<{ data: { articleId: string } }>(); mockCreate.mockReturnValueOnce(pause.promise); const view = await mount();
  act(() => { fireEvent.press(view.getByTestId('sell-publish-button')); }); await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  session('B'); session('A'); await draftService.saveDraft(draft('replacement')); const saved = await AsyncStorage.getItem(key);
  await act(async () => { pause.resolve({ data: { articleId: 'article-A' } }); });
  expect(await AsyncStorage.getItem(key)).toBe(saved); expect(draftService.wasPublished).toBe(false);
  expect(mockRemoteCleanup).not.toHaveBeenCalled(); expect(view.queryByTestId('success-publication')).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(intentKey))!).outcome).toBe('confirmed');
});

it('a replacement in the same generation during publication remains byte exact and gets no success modal', async () => {
  const pause = deferred<{ data: { articleId: string } }>(); mockCreate.mockReturnValueOnce(pause.promise); const view = await mount();
  act(() => { fireEvent.press(view.getByTestId('sell-publish-button')); }); await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  await draftService.saveDraft(draft('replacement')); const saved = await AsyncStorage.getItem(key);
  await act(async () => { pause.resolve({ data: { articleId: 'article-A' } }); });
  expect(await AsyncStorage.getItem(key)).toBe(saved); expect(draftService.wasPublished).toBe(false);
  expect(view.queryByTestId('success-publication')).toBeNull(); expect(mockRemoteCleanup).not.toHaveBeenCalled();
});

it('does not attach the old preview contents to a draft replaced before the publish tap', async () => {
  const view = await mount(); await draftService.saveDraft(draft('replacement')); const saved = await AsyncStorage.getItem(key);
  await act(async () => { fireEvent.press(view.getByTestId('sell-publish-button')); });
  expect(mockCreate).not.toHaveBeenCalled(); expect(await AsyncStorage.getItem(key)).toBe(saved);
  expect(alert.mock.calls.some(([, message]) => String(message).includes('brouillon a changé'))).toBe(true);
});

it('retries a lost local-photo publication with one upload and its exact original payload', async () => {
  await draftService.saveDraft(draft('original', true)); mockCreate.mockRejectedValueOnce(Object.assign(new Error('Réponse perdue'), { code: 'functions/unavailable' }));
  const view = await mount(); const savedDraft = await AsyncStorage.getItem(key);
  await act(async () => { fireEvent.press(view.getByTestId('sell-publish-button')); });
  expect(await AsyncStorage.getItem(key)).toBe(savedDraft); expect(view.queryByTestId('success-publication')).toBeNull();
  const first = JSON.parse(JSON.stringify(mockCreate.mock.calls[0][0]));
  await act(async () => { fireEvent.press(view.getByTestId('sell-publish-button')); });
  await waitFor(() => expect(view.getByTestId('success-publication')).toBeTruthy());
  expect(mockCreate.mock.calls[1][0]).toEqual(first); expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockRemoteCleanup).not.toHaveBeenCalled();
});

it('keeps its draft and media when the screen unmounts before a known receipt arrives', async () => {
  const pause = deferred<{ data: { articleId: string } }>(); mockCreate.mockReturnValueOnce(pause.promise); const view = await mount();
  const saved = await AsyncStorage.getItem(key);
  act(() => { fireEvent.press(view.getByTestId('sell-publish-button')); }); await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  view.unmount(); await act(async () => { pause.resolve({ data: { articleId: 'article-A' } }); });
  expect(await AsyncStorage.getItem(key)).toBe(saved); expect(mockRemoteCleanup).not.toHaveBeenCalled();
  expect(draftService.wasPublished).toBe(false); expect(mockReplace).not.toHaveBeenCalled();
});
