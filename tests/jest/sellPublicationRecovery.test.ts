import { getEnvironmentStorageKey } from '@/config/firebaseEnvironment';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Article } from '@/types';
import { waitFor } from '@testing-library/react-native';

const mockAuth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'A' } };
let mockGeneration = 0;
const mockListeners: Array<(user: { uid: string } | null) => void> = [];
const mockCallable = jest.fn();
const mockUpload = jest.fn(async (..._args: unknown[]) => ({}));
const mockCompress = jest.fn(async (uri: string) => ({ compressedUri: uri, blurhash: 'hash' }));
jest.mock('@/config/firebaseConfig', () => ({ auth: mockAuth, functions: {}, firestore: {}, storage: { app: { options: { storageBucket: 'demo-second.appspot.com' } } } }));
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: { getState: () => ({ authenticatedUid: mockAuth.currentUser?.uid ?? null,
    user: mockAuth.currentUser ? { id: mockAuth.currentUser.uid } : null }) },
}));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, listener: (user: { uid: string } | null) => void) => { mockListeners.push(listener); return jest.fn(); } }));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('firebase/storage', () => ({ ref: (_storage: unknown, path: string) => ({ path }), uploadBytes: (...args: unknown[]) => mockUpload(...args), getDownloadURL: jest.fn(), deleteObject: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: true }) }));
jest.mock('@/utils/imageUtils', () => ({ processImageWithBlurhash: (uri: string) => mockCompress(uri) }));
jest.mock('@/services/nativeStorageUpload', () => ({ uploadPreparedJpeg: (...args: unknown[]) => mockUpload(...args) }));
const { ArticlesService } = require('@/services/articlesService') as typeof import('@/services/articlesService');

type PublicationInput = Parameters<typeof ArticlesService.createArticle>[0];
const input = (images = [{ url: 'file:///photo.jpg' }]): PublicationInput => ({
  title: 'Article test', description: 'Description', price: 40, images, category: 'Haut',
  categoryIds: ['tops'], condition: 'bon état', sellerId: 'A', sellerName: 'A', isHandDelivery: true, isShipping: false, quantity: 1,
});
const key = getEnvironmentStorageKey('@article_publication:A:draft-A');
const lost = () => Object.assign(new Error('Réponse perdue'), { code: 'functions/unavailable' });
function switchTo(uid: string | null) { mockGeneration++; mockAuth.currentUser = uid ? { uid } : null; mockListeners.forEach(listener => listener(mockAuth.currentUser)); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }

beforeEach(async () => {
  jest.clearAllMocks(); switchTo('A'); await AsyncStorage.clear();
  mockCompress.mockImplementation(async uri => ({ compressedUri: uri, blurhash: 'hash' }));
  mockUpload.mockImplementation(async () => ({}));
  mockCallable.mockResolvedValue({ data: { articleId: 'article-A' } });
  global.fetch = jest.fn(async () => ({ blob: async () => ({}) })) as unknown as typeof fetch;
});

it('replays local photos with the exact persisted payload and one upload after a lost response', async () => {
  mockCallable.mockRejectedValueOnce(lost());
  await expect(ArticlesService.createArticle(input(), { requestId: 'draft-A' })).rejects.toThrow('Réponse perdue');
  const saved = await AsyncStorage.getItem(key);
  expect(JSON.parse(saved!).outcome).toBe('unknown');
  const first = JSON.parse(JSON.stringify(mockCallable.mock.calls[0][0]));
  expect(await ArticlesService.createArticle(input(), { requestId: 'draft-A' })).toBe('article-A');
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(mockCallable.mock.calls[1][0]).toEqual(first);
  expect(JSON.parse((await AsyncStorage.getItem(key))!).payload).toEqual(first);
});

it('blocks changed contents under an unknown key and preserves the exact saved intent', async () => {
  mockCallable.mockRejectedValueOnce(lost());
  await expect(ArticlesService.createArticle(input(), { requestId: 'draft-A' })).rejects.toThrow();
  const saved = await AsyncStorage.getItem(key);
  await expect(ArticlesService.createArticle({ ...input(), price: 41 }, { requestId: 'draft-A' })).rejects.toThrow('contenu initial');
  expect(mockCallable).toHaveBeenCalledTimes(1);
  expect(mockUpload).toHaveBeenCalledTimes(1);
  expect(await AsyncStorage.getItem(key)).toBe(saved);
});

it('can reload the persisted local intent in a new service instance without uploading again', async () => {
  mockCallable.mockRejectedValueOnce(lost());
  await expect(ArticlesService.createArticle(input(), { requestId: 'draft-A' })).rejects.toThrow();
  const first = JSON.parse(JSON.stringify(mockCallable.mock.calls[0][0]));
  // A real persistent store survives module reload; the Jest package's default
  // in-memory implementation is otherwise re-created by resetModules.
  jest.doMock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: AsyncStorage }));
  jest.resetModules();
  const reloaded = require('@/services/articlesService') as typeof import('@/services/articlesService');
  await reloaded.ArticlesService.createArticle(input(), { requestId: 'draft-A' });
  expect(mockCallable.mock.calls[1][0]).toEqual(first);
  expect(mockUpload).toHaveBeenCalledTimes(1);
});

it('takes an immutable input snapshot before compression while the caller object changes', async () => {
  const pause = deferred<{ compressedUri: string; blurhash: string }>();
  mockCompress.mockReturnValueOnce(pause.promise);
  const original = input(); const pending = ArticlesService.createArticle(original, { requestId: 'draft-A' });
  await waitFor(() => expect(mockCompress).toHaveBeenCalled());
  original.title = 'Nouveau contenu'; original.images[0].url = 'file:///other.jpg';
  pause.resolve({ compressedUri: 'file:///photo.jpg', blurhash: 'hash' });
  await pending;
  expect(mockCallable.mock.calls[0][0].title).toBe('Article test');
  expect(mockCompress).toHaveBeenCalledWith('file:///photo.jpg');
});

it('does not upload or send after A-B-A during compression', async () => {
  const pause = deferred<{ compressedUri: string; blurhash: string }>(); mockCompress.mockReturnValueOnce(pause.promise);
  const pending = ArticlesService.createArticle(input(), { requestId: 'draft-A' });
  const rejected = expect(pending).rejects.toThrow('session');
  await waitFor(() => expect(mockCompress).toHaveBeenCalled());
  switchTo('B'); switchTo('A'); pause.resolve({ compressedUri: 'file:///photo.jpg', blurhash: 'hash' });
  await rejected;
  expect(mockUpload).not.toHaveBeenCalled(); expect(mockCallable).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(key)).toBeNull();
});

it('keeps a late known receipt in its owner key but rejects projection to another generation', async () => {
  const pause = deferred<{ data: { articleId: string } }>(); mockCallable.mockReturnValueOnce(pause.promise);
  const pending = ArticlesService.createArticle(input(), { requestId: 'draft-A' });
  const rejected = expect(pending).rejects.toThrow('session');
  await waitFor(() => expect(mockCallable).toHaveBeenCalled());
  switchTo('B'); switchTo('A'); pause.resolve({ data: { articleId: 'article-A' } }); await rejected;
  const saved = JSON.parse((await AsyncStorage.getItem(key))!);
  expect(saved.outcome).toBe('confirmed'); expect(saved.articleId).toBe('article-A');
  expect(await AsyncStorage.getItem(getEnvironmentStorageKey('@article_publication:B:draft-A'))).toBeNull();
});

it('preserves an unknown result when its originating context expires after dispatch', async () => {
  const pause = deferred<never>(); mockCallable.mockReturnValueOnce(pause.promise);
  let valid = true; const assertContext = () => { if (!valid) throw new Error('Contexte expiré'); };
  const pending = ArticlesService.createArticle(input(), { requestId: 'draft-A', assertContext });
  const rejected = expect(pending).rejects.toThrow('Réponse perdue');
  await waitFor(() => expect(mockCallable).toHaveBeenCalled());
  valid = false;
  // The callable rejects rather than resolving: its unknown envelope remains unknown.
  pause.reject(lost());
  await rejected;
  expect(JSON.parse((await AsyncStorage.getItem(key))!).outcome).toBe('unknown');
});

it('allows correction after a proven server refusal and retains its structured envelope', async () => {
  const refusal = Object.assign(new Error('Déclaration requise'), { code: 'functions/permission-denied', details: { reason: 'eligibility_required', scope: 'sell' } });
  mockCallable.mockRejectedValueOnce(refusal);
  await expect(ArticlesService.createArticle(input(), { requestId: 'draft-A' })).rejects.toMatchObject({ code: refusal.code, details: refusal.details });
  expect(JSON.parse((await AsyncStorage.getItem(key))!).outcome).toBe('refused');
  await ArticlesService.createArticle({ ...input(), price: 41 }, { requestId: 'draft-A' });
  expect(mockCallable.mock.calls[1][0].price).toBe(41);
});

it('finishes only a confirmed receipt; unknown intent remains available', async () => {
  mockCallable.mockRejectedValueOnce(lost()); await expect(ArticlesService.createArticle(input(), { requestId: 'draft-A' })).rejects.toThrow();
  const saved = await AsyncStorage.getItem(key); await ArticlesService.finishPublication('draft-A', () => undefined);
  expect(await AsyncStorage.getItem(key)).toBe(saved);
  await ArticlesService.createArticle(input(), { requestId: 'draft-A' });
  await ArticlesService.finishPublication('draft-A', () => undefined);
  expect(await AsyncStorage.getItem(key)).toBeNull();
});

it('preserves already prepared Storage media in a mixed local selection', async () => {
  const prepared: Article['images'][number] = { url: 'https://firebasestorage.googleapis.com/existing.jpg' };
  await ArticlesService.createArticle(input([prepared, { url: 'file:///new.jpg' }]), { requestId: 'draft-A' });
  expect(mockCompress).toHaveBeenCalledTimes(1); expect(mockCompress).toHaveBeenCalledWith('file:///new.jpg');
  expect(mockCallable.mock.calls[0][0].images[0]).toEqual(prepared);
});
