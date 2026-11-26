import {getEnvironmentStorageKey} from '@/config/firebaseEnvironment';
import {fixtureCommitListingReceipt as mockCommitListingReceipt, fixtureListingView as mockListingView} from '@/tests/jest/helpers/listingContentFixture';
import React from 'react';
import { act, fireEvent, render, waitFor, type RenderAPI } from '@testing-library/react-native';
import { Alert, TextInput } from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Article, ArticleImage } from '@/types';

// The route, ArticlesService (including uploader/read/delete), privateMedia
// helpers and private renderer/hooks run. Only IO/Auth/galerie/UI leaves below
// are doubles: neither prepared URLs nor uploader responses are fabricated.
let mockUid: string | null = 'A'; let mockGeneration = 1; let mockId = 'article-A';
const mockAuth: { currentUser: { uid: string; getIdToken?: () => Promise<string> } | null } = { currentUser: { uid: 'A' } };
const mockAuthListeners = new Set<(user: { uid: string } | null) => void>();
const mockTokenListeners = new Set<(user: { uid: string } | null) => void>();
const mockReadDoc = jest.fn(); const mockCompress = jest.fn(); const mockInfo = jest.fn();
const mockWebUpload = jest.fn(); const mockNativeUpload = jest.fn(); const mockGetURL = jest.fn(); const mockDeleteObject = jest.fn();
const mockGetBytes = jest.fn(); const mockFetch = jest.fn(); const mockUpdate = jest.fn();
const mockBack = jest.fn(); const mockGallery = jest.fn();
const mockFiles = new Map<string, { actor: string | null; metadata: unknown }>();
jest.mock('@/config/firebaseConfig', () => ({
  auth: mockAuth, firestore: {}, functions: {}, storage: { app: { options: { storageBucket: 'demo-second.appspot.com' } } },
}));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, listener: (user: { uid: string } | null) => void) => {
    mockAuthListeners.add(listener); listener(mockAuth.currentUser); return () => mockAuthListeners.delete(listener);
  },
  onIdTokenChanged: (_auth: unknown, listener: (user: { uid: string } | null) => void) => {
    mockTokenListeners.add(listener); listener(mockAuth.currentUser); return () => mockTokenListeners.delete(listener);
  },
}));
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _collection: string, id: string) => ({ id }),
  getDoc: ({ id }: { id: string }) => mockReadDoc(id),
  getDocFromServer: ({id}: {id:string}) => mockReadDoc(id),
}));
jest.mock('firebase/functions', () => ({ httpsCallable: () => async (payload: Record<string, unknown>) => {
 if (payload.mode === 'declaration_observe') return {data: mockListingView(mockStored)};
 const before = mockStored; const response = mockUpdate(payload);
 if (mockStored !== before) mockStored = mockCommitListingReceipt(mockStored, payload.updates as Record<string, unknown>);
 if (mockOtherReceipt && mockStored.saleDeclaration) mockStored.saleDeclaration.requestHash = 'f'.repeat(64);
 await response;
 return {data: {success: true, replayed: false, saleDeclarationView: mockListingView(mockStored)}};
} }));
jest.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => ({
    path: path.startsWith('https://') ? decodeURIComponent(new URL(path).pathname.split('/o/')[1]) : path,
  }),
  uploadBytes: (...args: unknown[]) => mockWebUpload(...args),
  getDownloadURL: (...args: unknown[]) => mockGetURL(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
  getBytes: (...args: unknown[]) => mockGetBytes(...args),
}));
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: (...args: unknown[]) => mockInfo(...args), FileSystemUploadType: {BINARY_CONTENT: 'binary'}, uploadAsync: (...args: unknown[]) => mockNativeUpload(...args) }));
jest.mock('@/utils/imageUtils', () => ({ processImageWithBlurhash: (...args: unknown[]) => mockCompress(...args) }));
jest.mock('@/store/authStore', () => {
  const state = () => ({ user: mockUid ? { id: mockUid } : null, authenticatedUid: mockUid });
  return { useAuthStore: Object.assign((selector: (value: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state }), getAuthSessionGeneration: () => mockGeneration };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
 useRouter: () => ({ back: mockBack, push: jest.fn() }), useLocalSearchParams: () => ({ id: mockId }), useNavigation: () => ({ addListener: () => jest.fn(), dispatch: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...args: unknown[]) => mockGallery(...args), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('@/features/sell/components/details/EditableField', () => ({ __esModule: true, default: ({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void }) => require('react').createElement(require('react-native').TextInput, { testID: 'field-' + label, value, onChangeText: onSave }) }));
jest.mock('@/features/sell/components/details/CategoryDisplay', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/sell/components/details/ConditionSelector', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/CategoryBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/SelectionBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/sell/components/pricing/NeighborhoodBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/sell', () => ({ ChipSelector: () => null }));
jest.mock('@/components/ui/Skeleton', () => ({ Skeleton: () => null }));
jest.mock('@/components/ui/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
const { default: Edit } = require('@/app/article/edit/[id]') as typeof import('@/app/article/edit/[id]');
const { privateMediaPath, privateMediaUrl, privateImageDataUri, PRIVATE_IMAGE_UPLOAD_METADATA } = require('@/utils/privateMedia') as typeof import('@/utils/privateMedia');

const bucket = 'demo-second.appspot.com';
const oldPath = 'articles/article-A/old.jpg';
const oldUrl = 'https://firebasestorage.googleapis.com/v0/b/' + bucket + '/o/' + encodeURIComponent(oldPath) + '?alt=media&token=published-old';
const oldImage = { url: oldUrl, blurhash: 'old-hash' };
const localUri = 'file:///new-edit.jpg';
const key = getEnvironmentStorageKey('@article_edit:A:article-A');
const imageBytes = new Uint8Array([1, 2, 3]).buffer;
const originalFetch = global.fetch;
const clients: QueryClient[] = [];
let mockOtherReceipt = false;
const mockUploadMetadata = new Map<string, Record<string, unknown>>();
let mockStored: Article; let alert: jest.SpyInstance;
const article = (id = 'article-A', sellerId = 'A'): Article => ({
  id, sellerId, quantity: 1, stock: 1, sellerName: sellerId, title: 'Article test', description: 'Description test', category: 'Haut',
  categoryIds: ['femme', 'vetements', 'tops'], condition: 'bon état', price: 40, isSold: false, isActive: true,
  isHandDelivery: true, isShipping: false, neighborhoods: [{ id: 'q', name: 'Quartier', borough: 'Montréal' }],
  images: [oldImage], createdAt: new Date('2026-01-01'), likes: 0, views: 0,
});
function snapshot() { return { id: mockStored.id, exists: () => true, data: () => mockStored }; }
function session(uid: string | null) {
  mockUid = uid; mockGeneration++; mockAuth.currentUser = uid ? { uid, getIdToken: async () => 'synthetic-native-token' } : null;
  mockAuthListeners.forEach(listener => listener(mockAuth.currentUser));
  mockTokenListeners.forEach(listener => listener(mockAuth.currentUser));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 15 * 60 * 1000 } } })) {
  if (!clients.includes(client)) clients.push(client);
  const element = () => <QueryClientProvider client={client}><Edit /></QueryClientProvider>;
  const view = render(element());
  return { view, client, rerender: () => view.rerender(element()) };
}
async function ready(view: RenderAPI) { await waitFor(() => expect(view.getByText('Enregistrer les modifications')).toBeTruthy()); }
async function add(view: RenderAPI) { await act(async () => { fireEvent.press(view.getByLabelText('Ajouter des photos')); }); }
async function save(view: RenderAPI) { await act(async () => { fireEvent.press(view.getByText('Enregistrer les modifications')); }); }
const imageUris = (view: RenderAPI) => view.UNSAFE_getAllByType(Image).map(node => node.props.source?.uri as string | undefined);
function promoteInDouble(updates: Record<string, unknown>) {
  // Shape of the existing writer's normalization, not execution of promotion.
  const images = (updates.images as ArticleImage[]).map(image => {
    const path = privateMediaPath(image.url, bucket);
    return path ? { ...image, url: 'https://firebasestorage.googleapis.com/v0/b/' + bucket + '/o/' + encodeURIComponent('articles/' + mockId + '/' + path.split('/').pop()) + '?alt=media&token=published-double' } : image;
  });
  mockStored = { ...mockStored, ...updates, images } as Article;
}
function assertNoPublicPreparation() {
  expect(mockGetURL).not.toHaveBeenCalled();
  expect(mockWebUpload).not.toHaveBeenCalled();
  for (const [uri, options] of mockFetch.mock.calls) {
    expect(new URL(String(uri)).origin).toBe(require('@/utils/fixStorageUrl').storageApiOrigin());
    expect(new URL(String(uri)).pathname).toBe('/v0/b/' + bucket + '/o');
    expect(String(uri)).not.toContain('alt=media');
    expect(options).toMatchObject({method: 'POST', headers: {'X-Goog-Upload-Command': 'start'}});
    expect(JSON.parse(options.body)).toMatchObject(PRIVATE_IMAGE_UPLOAD_METADATA);
  }
}
beforeEach(async () => {
  jest.clearAllMocks();
  [mockReadDoc, mockCompress, mockInfo, mockNativeUpload, mockGetURL, mockDeleteObject, mockGetBytes, mockFetch, mockUpdate, mockBack, mockGallery].forEach(mock => mock.mockReset());
  mockOtherReceipt = false; mockUploadMetadata.clear(); session('A'); mockId = 'article-A'; mockStored = article(); await AsyncStorage.clear();
  mockFiles.clear(); mockFiles.set(oldPath, { actor: null, metadata: 'published before edit' });
  mockReadDoc.mockImplementation(async () => snapshot());
  mockCompress.mockImplementation(async (uri: string) => ({ compressedUri: uri + '.compressed.jpg', blurhash: 'new-hash' }));
  mockInfo.mockResolvedValue({ exists: true, size: 2048 });
  mockFetch.mockImplementation(async (url: string, options: {body: string}) => {
    const metadata = JSON.parse(options.body); mockUploadMetadata.set(metadata.name, metadata);
    const target = new URL(url); target.searchParams.set('upload_id', 'synthetic-private-session');
    return {ok: true, status: 200, headers: {get: (key: string) => key === 'X-Goog-Upload-Status' ? 'active' : key === 'X-Goog-Upload-URL' ? target.toString() : null}};
  });
  global.fetch = mockFetch as unknown as typeof fetch;
  mockNativeUpload.mockImplementation(async (url: string) => {
    const path = new URL(url).searchParams.get('name')!;
    const metadata = mockUploadMetadata.get(path)!;
    mockFiles.set(path, {actor: mockAuth.currentUser?.uid ?? null, metadata: {contentType: metadata.contentType, cacheControl: metadata.cacheControl}});
    return {status: 200, headers: {'X-Goog-Upload-Status': 'final'}, body: '{}'};
  });
  mockDeleteObject.mockImplementation(async ({ path }: { path: string }) => { mockFiles.delete(path); });
  mockGetBytes.mockResolvedValue(imageBytes);
  mockGallery.mockResolvedValue({ canceled: false, assets: [{ uri: localUri }] });
  mockUpdate.mockImplementation(async ({ updates }: { updates: Record<string, unknown> }) => { promoteInDouble(updates); return { data: { success: true } }; });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { clients.splice(0).forEach(client => client.clear()); global.fetch = originalFetch; jest.restoreAllMocks(); });

it('prepares a local primary photo privately through the real uploader, preserving public photo/order/blurhash and confirming before success', async () => {
  const response = deferred<{ data: { success: boolean } }>();
  mockUpdate.mockImplementationOnce(async ({ updates }: { updates: Record<string, unknown> }) => { promoteInDouble(updates); return response.promise; });
  const { view } = mount(); await ready(view); await add(view);
  const localThumbnail = view.UNSAFE_getAllByType(Image).find(image => image.props.source?.uri === localUri);
  expect(localThumbnail).toBeTruthy(); fireEvent.press(localThumbnail!);
  expect(imageUris(view).filter(uri => uri === localUri)).toHaveLength(2);
  act(() => { fireEvent.press(view.getByText('Enregistrer les modifications')); });
  await waitFor(() => expect(mockNativeUpload).toHaveBeenCalledTimes(1));
  const path = new URL(mockNativeUpload.mock.calls[0][0] as string).searchParams.get('name')!;
  expect(mockFiles.has(path)).toBe(true);
  expect(path).toMatch(/^drafts\/A\/edit_article-A_[0-9a-f-]+\/image_0_\d+\.jpg$/);
  await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  expect(mockCompress).toHaveBeenCalledWith(localUri, { maxWidth: 1200, maxHeight: 1200, quality: 0.75 });
  const prepared = { url: privateMediaUrl(bucket, path), blurhash: 'new-hash' };
  const updates = mockUpdate.mock.calls[0][0].updates as Record<string, unknown>;
  expect(updates.images).toEqual([prepared, oldImage]);
  expect(privateMediaPath(prepared.url, bucket)).toBe(path); expect(prepared.url).not.toContain('token=');
  expect(mockFiles.get(path)?.metadata).toEqual(PRIVATE_IMAGE_UPLOAD_METADATA);
  expect(mockFiles.get(path)?.actor).toBe('A');
  const journal = JSON.parse((await AsyncStorage.getItem(key))!);
  expect(journal.images).toEqual([prepared, oldImage]); expect(journal.selected).toEqual([{ url: localUri }, oldImage]);
  expect(journal.uploaded).toEqual([prepared]); expect(journal.updates.images).toEqual(updates.images);
  expect(imageUris(view)).toContain(localUri); expect(imageUris(view)).toContain(oldUrl);
  expect(mockGetBytes).not.toHaveBeenCalled(); expect(mockBack).not.toHaveBeenCalled();
  expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(false);
  await act(async () => { response.resolve({ data: { success: true } }); });
  await waitFor(() => expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(true));
  await waitFor(() => expect(imageUris(view).filter(uri => uri === privateImageDataUri(imageBytes, path))).toHaveLength(2));
  expect(imageUris(view)).toContain(oldUrl); expect(imageUris(view)).not.toContain(prepared.url);
  expect(mockGetBytes.mock.calls.map(([reference]) => reference.path)).toEqual([path, path]);
  expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockDeleteObject).not.toHaveBeenCalled();
  assertNoPublicPreparation();
  const success = alert.mock.calls.find(([label]) => label === 'Succès')!;
  const buttons = success[2] as Array<{ onPress?: () => void }>;
  act(() => { buttons[0].onPress?.(); }); expect(mockBack).toHaveBeenCalledTimes(1);
});

it.each(['another intent with promoted URLs', 'unavailable read'])('keeps exact private intent after an unknown response and %s without reupload or blind resend', async readOutcome => {
  const first = mount(); await ready(first.view); await add(first.view);
  if (readOutcome === 'another intent with promoted URLs') mockOtherReceipt = true;
  if (readOutcome === 'unavailable read') mockReadDoc.mockRejectedValueOnce(new Error('Relecture indisponible'));
  mockUpdate.mockImplementationOnce(async ({ updates }: { updates: Record<string, unknown> }) => {
    promoteInDouble(updates); throw Object.assign(new Error('Réponse perdue'), { code: 'functions/unavailable' });
  });
  await save(first.view);
  await waitFor(() => expect(first.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  const raw = await AsyncStorage.getItem(key); expect(raw).not.toBeNull();
  const record = JSON.parse(raw!); const path = new URL(mockNativeUpload.mock.calls[0][0] as string).searchParams.get('name')!;
  expect(record.selected).toEqual([oldImage, { url: localUri }]);
  expect(record.images).toEqual([oldImage, { url: privateMediaUrl(bucket, path), blurhash: 'new-hash' }]);
  expect(record.updates.images).toEqual(record.images); expect(record.uploaded).toEqual([record.images[1]]);
  expect(mockStored.images[1].url).not.toBe(record.images[1].url); expect(mockReadDoc).toHaveBeenCalledTimes(readOutcome === 'unavailable read' ? 2 : 1);
  const generation = mockGeneration; first.view.unmount(); const second = mount(first.client);
  await waitFor(() => expect(second.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  expect(imageUris(second.view)).toContain(localUri); expect(imageUris(second.view)).toContain(oldUrl);
  expect(mockGeneration).toBe(generation);
  mockUpdate.mockImplementationOnce(async () => {
    if (readOutcome === 'another intent with promoted URLs') throw Object.assign(new Error('La précondition appartient à une autre intention'), {code: 'functions/failed-precondition'});
    return {data: {success: true, replayed: true}};
  });
  await act(async () => { fireEvent.press(second.view.getByText('Vérifier l’enregistrement')); });
  if (readOutcome === 'unavailable read') {
    await waitFor(() => expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(true));
    expect(await AsyncStorage.getItem(key)).toBeNull();
  } else {
    expect(await AsyncStorage.getItem(key)).toBe(raw);
    expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(false);
  }
  expect(mockUpdate).toHaveBeenCalledTimes(2); expect(mockUpdate.mock.calls[1]).toEqual(mockUpdate.mock.calls[0]); expect(mockNativeUpload).toHaveBeenCalledTimes(1);
  expect(mockFiles.has(path)).toBe(true); expect(mockDeleteObject).not.toHaveBeenCalled(); expect(mockBack).not.toHaveBeenCalled();
  assertNoPublicPreparation();
});

it('rejects A-B-A during actual uploader compression before any Storage IO or update', async () => {
  const compression = deferred<{ compressedUri: string; blurhash: string }>(); mockCompress.mockReturnValueOnce(compression.promise);
  const { view } = mount(); await ready(view); await add(view);
  act(() => { fireEvent.press(view.getByText('Enregistrer les modifications')); });
  await waitFor(() => expect(mockCompress).toHaveBeenCalledTimes(1));
  act(() => { session('B'); session('A'); });
  await act(async () => { compression.resolve({ compressedUri: localUri + '.compressed.jpg', blurhash: 'new-hash' }); });
  expect(mockNativeUpload).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockDeleteObject).not.toHaveBeenCalled(); expect(mockBack).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(key)).toBeNull(); expect(mockFiles.size).toBe(1);
});

it('does not adopt a prepared private photo after the article changes during compression', async () => {
  const compression = deferred<{ compressedUri: string; blurhash: string }>(); mockCompress.mockReturnValueOnce(compression.promise);
  const { view, rerender } = mount(); await ready(view); await add(view);
  act(() => { fireEvent.press(view.getByText('Enregistrer les modifications')); });
  await waitFor(() => expect(mockCompress).toHaveBeenCalledTimes(1));
  mockId = 'article-B'; mockStored = { ...article('article-B'), title: 'Article B intact' }; rerender(); await ready(view);
  await act(async () => { compression.resolve({ compressedUri: localUri + '.compressed.jpg', blurhash: 'new-hash' }); });
  expect(mockNativeUpload).not.toHaveBeenCalled(); expect(mockFiles.size).toBe(1);
  expect(mockUpdate).not.toHaveBeenCalled(); expect(mockDeleteObject).not.toHaveBeenCalled();
  expect(view.UNSAFE_getAllByType(TextInput).some(node => node.props.value === 'Article B intact')).toBe(true);
  expect(imageUris(view)).not.toContain(localUri); expect(mockGetBytes).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(key)).toBeNull(); expect(await AsyncStorage.getItem(getEnvironmentStorageKey('@article_edit:A:article-B'))).toBeNull();
  expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(false);
});

it('preserves selection after a Storage rejection before any update or journal is created', async () => {
  mockNativeUpload.mockRejectedValueOnce(Object.assign(new Error('Storage denied'), { code: 'storage/unauthorized' }));
  const { view } = mount(); await ready(view); await add(view); await save(view);
  expect(mockNativeUpload).toHaveBeenCalledTimes(1); expect(mockFiles.size).toBe(1);
  expect(mockUpdate).not.toHaveBeenCalled(); expect(mockDeleteObject).not.toHaveBeenCalled();
  expect(imageUris(view)).toContain(localUri); expect(imageUris(view)).toContain(oldUrl);
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(alert.mock.calls.some(([label, message]) => label === 'Erreur' && String(message).includes('n’a pas pu être confirmé'))).toBe(true);
  assertNoPublicPreparation();
});

it('retains a partially uploaded private object when another photo preparation rejects without claiming cleanup', async () => {
  mockGallery.mockResolvedValueOnce({ canceled: false, assets: [{ uri: localUri }, { uri: 'file:///second-edit.jpg' }] });
  mockNativeUpload.mockImplementationOnce(async (url: string) => {
    const path = new URL(url).searchParams.get('name')!;
    mockFiles.set(path, {actor: 'A', metadata: mockUploadMetadata.get(path)});
    return {status: 200, headers: {'X-Goog-Upload-Status': 'final'}, body: '{}'};
  }).mockRejectedValueOnce(new Error('Second photo failed'));
  const { view } = mount(); await ready(view); await add(view); await save(view);
  expect(mockNativeUpload).toHaveBeenCalledTimes(2);
  const path = new URL(mockNativeUpload.mock.calls[0][0] as string).searchParams.get('name')!;
  expect(path).toMatch(/^drafts\/A\/edit_article-A_[0-9a-f-]+\//); expect(mockFiles.has(path)).toBe(true);
  expect(mockFiles.size).toBe(2); expect(mockUpdate).not.toHaveBeenCalled(); expect(mockDeleteObject).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(key)).toBeNull(); expect(imageUris(view)).toContain(localUri);
  expect(imageUris(view)).toContain('file:///second-edit.jpg'); assertNoPublicPreparation();
});

it('renders a denied private read as empty after confirmation while retaining the public image without HTTP fallback', async () => {
  mockGetBytes.mockRejectedValue(new Error('Private read denied'));
  const { view } = mount(); await ready(view); await add(view); await save(view);
  await waitFor(() => expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(true));
  await waitFor(() => expect(mockGetBytes).toHaveBeenCalledTimes(1));
  const path = new URL(mockNativeUpload.mock.calls[0][0] as string).searchParams.get('name')!;
  expect(imageUris(view)).toContain(undefined); expect(imageUris(view)).toContain(oldUrl);
  expect(imageUris(view)).not.toContain(privateMediaUrl(bucket, path));
  expect(imageUris(view).some(uri => uri?.startsWith('data:image/'))).toBe(false);
  expect(mockDeleteObject).not.toHaveBeenCalled(); assertNoPublicPreparation();
});

it('does not display late private bytes from the previous account and article', async () => {
  const bytes = deferred<ArrayBuffer>(); mockGetBytes.mockReturnValueOnce(bytes.promise);
  const { view, rerender } = mount(); await ready(view); await add(view); await save(view);
  await waitFor(() => expect(mockGetBytes).toHaveBeenCalledTimes(1));
  const path = new URL(mockNativeUpload.mock.calls[0][0] as string).searchParams.get('name')!;
  act(() => { session('B'); }); mockId = 'article-B'; mockStored = { ...article('article-B', 'B'), title: 'Autre compte' };
  rerender(); await ready(view);
  await act(async () => { bytes.resolve(imageBytes); });
  expect(view.UNSAFE_getAllByType(TextInput).some(node => node.props.value === 'Autre compte')).toBe(true);
  expect(imageUris(view)).not.toContain(privateImageDataUri(imageBytes, path));
  expect(imageUris(view)).not.toContain(privateMediaUrl(bucket, path));
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(mockDeleteObject).not.toHaveBeenCalled();
});
