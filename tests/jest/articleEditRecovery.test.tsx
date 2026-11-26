import {getEnvironmentStorageKey} from '@/config/firebaseEnvironment';
import {fixtureCommitListingReceipt as mockCommitListingReceipt, fixtureListingView as mockListingView} from '@/tests/jest/helpers/listingContentFixture';
import React from 'react';
import { act, fireEvent, render, waitFor, type RenderAPI } from '@testing-library/react-native';
import { Alert, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Article } from '@/types';

let mockUid: string | null = 'A'; let mockGeneration = 1; let mockId = 'article-A';
const mockAuth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'A' } };
const mockReadSale = jest.fn(); const mockGet = jest.fn(); const mockUpload = jest.fn(); const mockDelete = jest.fn(); const mockUpdate = jest.fn();
const mockBack = jest.fn(); const mockGallery = jest.fn();
jest.mock('@/config/firebaseConfig', () => ({ auth: mockAuth, functions: {} }));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockUpdate }));
jest.mock('@/store/authStore', () => {
  const state = () => ({ user: mockUid ? { id: mockUid } : null, authenticatedUid: mockUid });
  return { useAuthStore: Object.assign((selector: (value: ReturnType<typeof state>) => unknown) => selector(state()), { getState: state }), getAuthSessionGeneration: () => mockGeneration };
});
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
 useRouter: () => ({ back: mockBack, push: jest.fn() }), useLocalSearchParams: () => ({ id: mockId }), useNavigation: () => ({ addListener: () => jest.fn(), dispatch: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/services/articlesService', () => {
 const actual = jest.requireActual<typeof import('@/services/articlesService')>('@/services/articlesService');
 return {...actual, ArticlesService: {
  getArticleById: (...args: unknown[]) => mockGet(...args), uploadImagesReactNative: (...args: unknown[]) => mockUpload(...args), deleteImage: (...args: unknown[]) => mockDelete(...args),
  readSaleDeclaration: (...args: unknown[]) => mockReadSale(...args),
  saleDeclarationMatchesUpdate: actual.ArticlesService.saleDeclarationMatchesUpdate,
  updateArticleWithDeclaration: async (articleId: string, updates: Record<string, unknown>) => {
   const before = mockStored; const response = mockUpdate({articleId, updates});
   if (mockStored !== before && mockStored.id === articleId && mockStored.sellerId === before.sellerId) mockStored = mockCommitListingReceipt(mockStored, updates);
   const ownReceipt = mockListingView(mockStored.id === articleId ? mockStored : before);
   await response;
   return ownReceipt;
  },
 }};
});
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...args: unknown[]) => mockGallery(...args), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('@/features/sell/components/details/EditableField', () => ({ __esModule: true, default: ({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void }) => require('react').createElement(require('react-native').TextInput, { testID: `field-${label}`, value, onChangeText: onSave }) }));
jest.mock('@/features/sell/components/details/CategoryDisplay', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/sell/components/details/ConditionSelector', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/CategoryBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/SelectionBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/BrandSelectionSheet', () => ({__esModule: true, default: () => null}));
jest.mock('@/features/sell/components/pricing/NeighborhoodBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/sell', () => ({ ChipSelector: () => null }));
jest.mock('@/components/ui/Skeleton', () => ({ Skeleton: () => null }));
jest.mock('@/components/ui/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
const { default: Edit } = require('@/app/article/edit/[id]') as typeof import('@/app/article/edit/[id]');

const oldUrl = 'https://firebasestorage.googleapis.com/v0/b/test/o/articles%2Farticle-A%2Fold.jpg?alt=media';
const newUrl = 'https://firebasestorage.googleapis.com/v0/b/test/o/articles%2Farticle-A%2Fnew.jpg?alt=media';
const key = getEnvironmentStorageKey('@article_edit:A:article-A');
let mockStored: Article; let files: Set<string>; let alert: jest.SpyInstance; const clients: QueryClient[] = [];
const article = (id = 'article-A', sellerId = 'A'): Article => ({ id, sellerId, sellerName: sellerId, quantity: 1, stock: 1, title: 'Article test', description: 'Description test', category: 'Haut', categoryIds: ['femme', 'vetements', 'tops'], condition: 'bon état', price: 40, isSold: false, isActive: true, isHandDelivery: true, isShipping: false, neighborhoods: [{ id: 'q', name: 'Quartier', borough: 'Montréal' }], images: [{ url: oldUrl }], createdAt: new Date('2026-01-01'), likes: 0, views: 0 });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
function session(uid: string | null) { mockUid = uid; mockAuth.currentUser = uid ? { uid } : null; mockGeneration++; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  const element = () => <QueryClientProvider client={client}><Edit /></QueryClientProvider>;
  const view = render(element()); return { view, rerender: () => view.rerender(element()) };
}
async function ready(view: RenderAPI) { await waitFor(() => expect(view.getByText('Enregistrer les modifications')).toBeTruthy()); }
async function add(view: RenderAPI) { await act(async () => { fireEvent.press(view.getByLabelText('Ajouter des photos')); }); }
async function save(view: RenderAPI) { await act(async () => { fireEvent.press(view.getByText('Enregistrer les modifications')); }); }
function title(view: RenderAPI) { return view.UNSAFE_getAllByType(TextInput).find(node => node.props.value === 'Article test')!; }
beforeEach(async () => {
  jest.clearAllMocks(); [mockGet, mockUpload, mockDelete, mockUpdate, mockReadSale, mockGallery].forEach(mock => mock.mockReset()); session('A'); mockId = 'article-A'; await AsyncStorage.clear(); mockStored = article(); files = new Set([oldUrl]);
  mockGet.mockImplementation(async () => mockStored);
  mockReadSale.mockImplementation(async () => mockListingView(mockStored));
  mockUpload.mockImplementation(async () => { files.add(newUrl); return [{ url: newUrl }]; });
  mockDelete.mockImplementation(async (url: string) => { files.delete(url); });
  mockGallery.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///new.jpg' }] });
  mockUpdate.mockImplementation(async ({ updates }: { updates: Partial<Article> }) => { mockStored = { ...mockStored, ...updates }; return { data: { success: true } }; });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { clients.splice(0).forEach(client => client.clear()); jest.restoreAllMocks(); });

it('reads back a lost committed edit, preserves adopted photos and confirms only the matching content', async () => {
  mockUpdate.mockImplementationOnce(async ({ updates }: { updates: Partial<Article> }) => { mockStored = { ...mockStored, ...updates }; throw Object.assign(new Error('Réponse perdue'), { code: 'functions/unavailable' }); });
  const { view } = mount(); await ready(view); await add(view); await save(view);
  await waitFor(() => expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(true));
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
  expect(mockGet.mock.calls.slice(0, 2)).toEqual([['article-A', 'A'], ['article-A', 'A']]); expect(mockStored.images).toEqual([{ url: oldUrl }, { url: newUrl }]);
  expect(files.has(newUrl)).toBe(true); expect(mockDelete).not.toHaveBeenCalled(); expect(await AsyncStorage.getItem(key)).toBeNull();
});

it('actually exercises an unavailable reconciliation read and retains exact intent/photos for explicit verification', async () => {
  mockReadSale.mockResolvedValueOnce(mockListingView(mockStored)).mockResolvedValueOnce(mockListingView(mockStored)).mockRejectedValueOnce(new Error('Relecture indisponible'));
  mockUpdate.mockRejectedValue(Object.assign(new Error('Réponse perdue'), { code: 'functions/deadline-exceeded' }));
  const { view } = mount(); await ready(view); await add(view); await save(view);
  await waitFor(() => expect(view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  const saved = await AsyncStorage.getItem(key); expect(saved).not.toBeNull(); expect(mockGet).toHaveBeenCalledTimes(1); expect(mockReadSale).toHaveBeenCalledTimes(3);
  expect(JSON.parse(saved!).images).toEqual([{ url: oldUrl }, { url: newUrl }]);
  expect(JSON.parse(saved!).selected).toEqual([{ url: oldUrl }, { url: 'file:///new.jpg' }]);
  expect(files.has(newUrl)).toBe(true); expect(mockDelete).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(view.getByText('Vérifier l’enregistrement')); });
  expect(mockGet).toHaveBeenCalledTimes(1); expect(mockUpdate).toHaveBeenCalledTimes(2); expect(mockUpdate.mock.calls[1]).toEqual(mockUpdate.mock.calls[0]); expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(key)).toBe(saved); expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(false);
});

it('keeps a divergent read and changed form without blindly resending the unknown update', async () => {
  mockUpdate.mockRejectedValue(Object.assign(new Error('Réponse perdue'), { code: 'functions/unavailable' }));
  const { view } = mount(); await ready(view); await add(view); await save(view);
  await waitFor(() => expect(view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  const saved = await AsyncStorage.getItem(key);
  fireEvent.changeText(title(view), 'Ma saisie conservée');
  await act(async () => { fireEvent.press(view.getByText('Vérifier l’enregistrement')); });
  expect(view.UNSAFE_getAllByType(TextInput).some(node => node.props.value === 'Ma saisie conservée')).toBe(true);
  expect(await AsyncStorage.getItem(key)).toBe(saved); expect(mockUpdate).toHaveBeenCalledTimes(2); expect(mockUpdate.mock.calls[1]).toEqual(mockUpdate.mock.calls[0]); expect(mockDelete).not.toHaveBeenCalled();
});

it('cleans only a fresh non-referenced upload after a definitive precommit refusal and an actual owned read', async () => {
  mockUpdate.mockRejectedValueOnce(Object.assign(new Error('Article indisponible'), { code: 'functions/failed-precondition' }));
  const { view } = mount(); await ready(view); await add(view); await save(view);
  await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(newUrl));
  expect(mockGet).toHaveBeenCalledTimes(2); expect(files.has(newUrl)).toBe(false); expect(files.has(oldUrl)).toBe(true);
  expect(mockStored.images).toEqual([{ url: oldUrl }]); expect(await AsyncStorage.getItem(key)).toBeNull();
});

it('does not clean a referenced upload even when the callable returns a definitive refusal', async () => {
  mockUpdate.mockImplementationOnce(async ({ updates }: { updates: Partial<Article> }) => { mockStored = { ...mockStored, images: updates.images! }; throw Object.assign(new Error('Refus'), { code: 'functions/failed-precondition' }); });
  const { view } = mount(); await ready(view); await add(view); await save(view);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  expect(files.has(newUrl)).toBe(true); expect(mockDelete).not.toHaveBeenCalled();
});

it('retains media when the post-refusal reference read is unavailable', async () => {
  mockGet.mockResolvedValueOnce(mockStored).mockRejectedValueOnce(new Error('Lecture refusée'));
  mockUpdate.mockRejectedValueOnce(Object.assign(new Error('Refus'), { code: 'functions/permission-denied' }));
  const { view } = mount(); await ready(view); await add(view); await save(view);
  await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  expect(files.has(newUrl)).toBe(true); expect(mockDelete).not.toHaveBeenCalled();
});

it('does not send an update or delete media after A-B-A while upload awaits', async () => {
  const pause = deferred<Article['images']>(); mockUpload.mockReturnValueOnce(pause.promise);
  const { view } = mount(); await ready(view); await add(view);
  act(() => { fireEvent.press(view.getByText('Enregistrer les modifications')); }); await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
  session('B'); session('A'); await act(async () => { pause.resolve([{ url: newUrl }]); });
  expect(mockUpdate).not.toHaveBeenCalled(); expect(mockDelete).not.toHaveBeenCalled(); expect(mockBack).not.toHaveBeenCalled();
});

it('does not project a late save onto another article, account or generation', async () => {
  const pause = deferred<{ data: { success: boolean } }>(); mockUpdate.mockImplementationOnce(({updates}: {updates: Partial<Article>}) => {mockStored = {...mockStored, ...updates}; return pause.promise;});
  const { view, rerender } = mount(); await ready(view); await add(view);
  act(() => { fireEvent.press(view.getByText('Enregistrer les modifications')); }); await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  session('B'); mockId = 'article-B'; mockStored = article('article-B', 'B'); rerender(); await ready(view);
  const before = JSON.stringify(mockStored); await act(async () => { pause.resolve({ data: { success: true } }); });
  expect(JSON.stringify(mockStored)).toBe(before); expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(false);
  expect(mockDelete).not.toHaveBeenCalled(); expect(await AsyncStorage.getItem(key)).not.toBeNull();
  expect(await AsyncStorage.getItem(getEnvironmentStorageKey('@article_edit:B:article-B'))).toBeNull();
});

it('retains an unknown attempt across unmount/remount without automatic mutation or upload', async () => {
  mockUpdate.mockRejectedValue(Object.assign(new Error('Réponse perdue'), { code: 'functions/unavailable' }));
  const first = mount(); await ready(first.view); await add(first.view); await save(first.view);
  await waitFor(() => expect(first.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  const saved = await AsyncStorage.getItem(key); first.view.unmount(); session('A');
  const second = mount(); await waitFor(() => expect(second.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  expect(await AsyncStorage.getItem(key)).toBe(saved); expect(mockUpdate).toHaveBeenCalledTimes(1); expect(mockUpload).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.press(second.view.getByText('Vérifier l’enregistrement')); });
  expect(mockUpdate).toHaveBeenCalledTimes(2); expect(mockUpdate.mock.calls[1]).toEqual(mockUpdate.mock.calls[0]); expect(files.has(newUrl)).toBe(true);
});

it('keeps new typing made while the previous save awaited instead of closing it as saved', async () => {
  const pause = deferred<{ data: { success: boolean } }>(); mockUpdate.mockImplementationOnce(({updates}: {updates: Partial<Article>}) => {mockStored = {...mockStored, ...updates}; return pause.promise;});
  const { view } = mount(); await ready(view); await add(view);
  act(() => { fireEvent.press(view.getByText('Enregistrer les modifications')); }); await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
  fireEvent.changeText(title(view), 'Nouvelle saisie'); await act(async () => { pause.resolve({ data: { success: true } }); });
  await waitFor(() => expect(alert.mock.calls.some(([label]) => label === 'Modification enregistrée')).toBe(true));
  expect(view.UNSAFE_getAllByType(TextInput).some(node => node.props.value === 'Nouvelle saisie')).toBe(true);
  expect(mockBack).not.toHaveBeenCalled(); expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(false);
});

it('refuses a stale gallery result after the article context changes', async () => {
  const pause = deferred<{ canceled: boolean; assets: Array<{ uri: string }> }>(); mockGallery.mockReturnValueOnce(pause.promise);
  const { view, rerender } = mount(); await ready(view);
  act(() => { fireEvent.press(view.getByLabelText('Ajouter des photos')); });
  mockId = 'article-B'; mockStored = article('article-B'); rerender(); await ready(view);
  await act(async () => { pause.resolve({ canceled: false, assets: [{ uri: 'file:///from-A.jpg' }] }); });
  await save(view);
  expect(mockUpload).not.toHaveBeenCalled(); expect(mockUpdate.mock.calls[0][0].articleId).toBe('article-B');
  expect(mockUpdate.mock.calls[0][0].updates.images).toEqual([{ url: oldUrl }]);
});

function retainedClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 15 * 60 * 1000 } } });
  clients.push(client);
  return client;
}
function mountRetained(client: QueryClient) {
  const element = () => <QueryClientProvider client={client}><Edit /></QueryClientProvider>;
  const view = render(element());
  return { view, rerender: () => view.rerender(element()) };
}
async function createUnknownInRetainedCache(client: QueryClient) {
  mockUpdate.mockRejectedValue(Object.assign(new Error('Réponse inconnue conservée'), { code: 'functions/unavailable' }));
  const first = mountRetained(client); await ready(first.view);
  fireEvent.changeText(title(first.view), 'Titre du journal conservé');
  await add(first.view); await save(first.view);
  await waitFor(() => expect(first.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  const saved = await AsyncStorage.getItem(key);
  expect(typeof saved).toBe('string');
  expect(JSON.parse(saved!).updates.title).toBe('Titre du journal conservé');
  expect(JSON.parse(saved!).selected).toEqual([{ url: oldUrl }, { url: 'file:///new.jpg' }]);
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  return { ...first, saved };
}

it('restores the exact unknown journal with the same retained QueryClient and unchanged generation', async () => {
  const client = retainedClient(); const first = await createUnknownInRetainedCache(client);
  const generation = mockGeneration; first.view.unmount();
  const read = jest.spyOn(AsyncStorage, 'getItem');
  const second = mountRetained(client);
  await waitFor(() => expect(second.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  expect(read).toHaveBeenCalledWith(key); expect(mockGeneration).toBe(generation);
  expect(second.view.UNSAFE_getAllByType(TextInput).some(node => node.props.value === 'Titre du journal conservé')).toBe(true);
  expect(await AsyncStorage.getItem(key)).toBe(first.saved);
  await act(async () => { fireEvent.press(second.view.getByText('Vérifier l’enregistrement')); });
  expect(mockUpdate).toHaveBeenCalledTimes(2); expect(mockUpdate.mock.calls[1]).toEqual(mockUpdate.mock.calls[0]); expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockGet).toHaveBeenCalledTimes(1); expect(mockDelete).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(key)).toBe(first.saved);
});

it('keeps mutation controls unavailable while the durable journal read is pending despite a fresh article cache', async () => {
  const client = retainedClient(); const first = await createUnknownInRetainedCache(client); first.view.unmount();
  const originalGet = AsyncStorage.getItem.bind(AsyncStorage); const pause = deferred<void>();
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(async requested => { await pause.promise; return originalGet(requested); });
  const second = mountRetained(client);
  expect(second.view.queryByText('Enregistrer les modifications')).toBeNull();
  expect(second.view.queryByText('Vérifier l’enregistrement')).toBeNull();
  expect(second.view.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(mockUpload).toHaveBeenCalledTimes(1);
  await act(async () => { pause.resolve(undefined); });
  await waitFor(() => expect(second.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  expect(await AsyncStorage.getItem(key)).toBe(first.saved); expect(mockGet).toHaveBeenCalledTimes(1);
});

it('blocks on a journal read failure and retries the local read without clearing cache or changing generation', async () => {
  const client = retainedClient(); const first = await createUnknownInRetainedCache(client); first.view.unmount();
  const generation = mockGeneration;
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('Storage indisponible'));
  const second = mountRetained(client);
  await waitFor(() => expect(second.view.getByText('Réessayer le chargement')).toBeTruthy());
  expect(second.view.queryByText('Enregistrer les modifications')).toBeNull();
  expect(second.view.queryByText('Vérifier l’enregistrement')).toBeNull();
  expect(await AsyncStorage.getItem(key)).toBe(first.saved);
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(mockUpload).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.press(second.view.getByText('Réessayer le chargement')); });
  await waitFor(() => expect(second.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  expect(second.view.UNSAFE_getAllByType(TextInput).some(node => node.props.value === 'Titre du journal conservé')).toBe(true);
  expect(mockGeneration).toBe(generation); expect(mockGet).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(key)).toBe(first.saved);
});

it('rejects a late journal restoration for the previous article while preserving its exact record', async () => {
  const client = retainedClient(); const first = await createUnknownInRetainedCache(client); first.view.unmount();
  const originalGet = AsyncStorage.getItem.bind(AsyncStorage); const pause = deferred<void>();
  jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(async requested => {
    const saved = await originalGet(requested); await pause.promise; return saved;
  });
  const second = mountRetained(client);
  mockId = 'article-B'; mockStored = { ...article('article-B'), title: 'Titre du nouvel article' }; second.rerender();
  await ready(second.view);
  await act(async () => { pause.resolve(undefined); });
  expect(second.view.UNSAFE_getAllByType(TextInput).some(node => node.props.value === 'Titre du nouvel article')).toBe(true);
  expect(second.view.queryByText('Vérifier l’enregistrement')).toBeNull();
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(mockUpload).toHaveBeenCalledTimes(1); expect(mockDelete).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(key)).toBe(first.saved); expect(await AsyncStorage.getItem(getEnvironmentStorageKey('@article_edit:A:article-B'))).toBeNull();
});


type RecordedJournal = {
  fields: Parameters<typeof import('@/features/article/services/buildArticleUpdates').buildArticleUpdates>[0] & {
    categoryDisplay: { icon: string; name: string; context: string };
  };
  updates: Record<string, unknown>;
  images: Article['images']; selected: Article['images']; uploaded: Article['images'];
  sourceFingerprint: string;
};
const invalidJournalVariants: Array<[string, (record: RecordedJournal) => unknown]> = [
  ['empty object', record => ({ ...record, updates: {} })],
  ['empty array', record => ({ ...record, updates: [] })],
  ['only a matching unrelated title', record => ({ ...record, updates: { title: mockStored.title } })],
  ['missing prepared-photo constraint', record => {
    const updates = { ...record.updates }; delete updates.images; return { ...record, updates };
  }],
  ['price different from the recorded form', record => ({ ...record, updates: { ...record.updates, price: 999 } })],
  ['prepared photos different from the callable payload', record => ({ ...record, images: [{ url: oldUrl }, { url: `${newUrl}&changed=1` }] })],
  ['missing upload provenance', record => ({ ...record, uploaded: [] })],
  ['fingerprint from another form', record => ({ ...record, sourceFingerprint: JSON.stringify({ fields: { ...record.fields, title: 'Autre intention' }, images: record.selected }) })],
  ['non-array selected colors', record => ({ ...record, fields: { ...record.fields, colors: 'bleu' } })],
  ['array in the scalar size system', record => ({ ...record, fields: { ...record.fields, sizeSystem: ['EU'] } })],
];

it.each(invalidJournalVariants)('blocks an incoherent durable journal (%s), preserving exact bytes and all media on retries', async (_label, invalidate) => {
  const client = retainedClient(); const first = await createUnknownInRetainedCache(client); first.view.unmount();
  const record = JSON.parse(first.saved!) as RecordedJournal;
  const invalid = JSON.stringify(invalidate(record));
  await AsyncStorage.setItem(key, invalid);
  const remove = jest.spyOn(AsyncStorage, 'removeItem'); const write = jest.spyOn(AsyncStorage, 'setItem');
  const writesBeforeResume = write.mock.calls.length;
  const generation = mockGeneration;
  const second = mountRetained(client);
  await waitFor(() => expect(second.view.getByText('Réessayer le chargement')).toBeTruthy());
  expect(second.view.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
  expect(second.view.queryByText('Vérifier l’enregistrement')).toBeNull();
  expect(second.view.queryByText('Enregistrer les modifications')).toBeNull();
  await act(async () => { fireEvent.press(second.view.getByText('Réessayer le chargement')); });
  await waitFor(() => expect(second.view.getByText('Réessayer le chargement')).toBeTruthy());
  expect(await AsyncStorage.getItem(key)).toBe(invalid);
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockGet).toHaveBeenCalledTimes(1); expect(mockGeneration).toBe(generation);
  expect(mockDelete).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(write).toHaveBeenCalledTimes(writesBeforeResume);
  expect(files).toEqual(new Set([oldUrl, newUrl])); expect(mockBack).not.toHaveBeenCalled();
  expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(false);

  // An external repair to the original, actually produced record permits only
  // verification; retrying the local read cannot submit the previous update.
  await AsyncStorage.setItem(key, first.saved!);
  await act(async () => { fireEvent.press(second.view.getByText('Réessayer le chargement')); });
  await waitFor(() => expect(second.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  expect(await AsyncStorage.getItem(key)).toBe(first.saved);
  expect(mockUpdate).toHaveBeenCalledTimes(1); expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockDelete).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});

it('permits only exact native replay of a coherent recorded delivery intention independently of the current shipping flag', async () => {
  const client = retainedClient(); const first = await createUnknownInRetainedCache(client); first.view.unmount();
  const record = JSON.parse(first.saved!) as RecordedJournal;
  record.fields = { ...record.fields, isHandDelivery: false, isShipping: true, packageSize: 'small' };
  record.updates = { ...record.updates, isHandDelivery: false, isShipping: true, packageSize: 'small' };
  record.sourceFingerprint = JSON.stringify({ fields: record.fields, images: record.selected });
  const saved = JSON.stringify(record); await AsyncStorage.setItem(key, saved);
  mockStored = mockCommitListingReceipt({ ...mockStored, ...record.updates } as Article, record.updates);
  mockUpdate.mockImplementation(async () => ({data: {success: true, replayed: true}}));
  const second = mountRetained(client);
  await waitFor(() => expect(second.view.getByText('Vérifier l’enregistrement')).toBeTruthy());
  expect(await AsyncStorage.getItem(key)).toBe(saved);
  await act(async () => { fireEvent.press(second.view.getByText('Vérifier l’enregistrement')); });
  await waitFor(() => expect(alert.mock.calls.some(([label]) => label === 'Succès')).toBe(true));
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(mockUpdate).toHaveBeenCalledTimes(2); expect(mockUpdate.mock.calls[1][0].updates).toEqual(record.updates); expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockDelete).not.toHaveBeenCalled(); expect(files).toEqual(new Set([oldUrl, newUrl]));
  expect(mockStored.isShipping).toBe(true); expect(mockStored.isHandDelivery).toBe(false); expect(mockStored.packageSize).toBe('small');
});
