import AsyncStorage from '@/utils/environmentStorage';
import NativeAsyncStorage from '@react-native-async-storage/async-storage';
import { createHash } from 'crypto';
import type { Article } from '@/types';

const mockAuth = { currentUser: { uid: 'A' } };
const mockCallable = jest.fn();
jest.mock('@/config/firebaseConfig', () => ({ auth: mockAuth, functions: {}, firestore: {}, storage: {} }));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => 1, useAuthStore: { getState: () => ({ authenticatedUid: 'A' }) } }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: () => jest.fn() }));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));
jest.mock('expo-crypto', () => ({ CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: unknown, value: string) => require('crypto').createHash('sha256').update(value).digest('hex'), randomUUID: () => 'unused' }));
jest.mock('@/utils/imageUtils', () => ({ processImageWithBlurhash: jest.fn() }));
const { ArticlesService } = require('@/services/articlesService') as typeof import('@/services/articlesService');
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const oldFields = { saleDeclaration: { version: 'personal_item_v3', accepted: true, saleUnit: 'single_article', counterfeitStatus: 'not_counterfeit' },
  inventoryUnitDeclaration: { kind: 'new_unit' }, brandStatus: 'unknown', hasAlterations: null, alterationsDescription: null,
  hasKnownDefects: true, defectsDescription: 'Une petite tache' };
const article = { title: 'Article', description: 'Description', price: 20, images: [{ url: 'https://firebasestorage.googleapis.com/photo.jpg' }],
  category: 'Haut', categoryIds: ['women', 'tops'], condition: 'bon état', sellerId: 'A', sellerName: 'Membre', quantity: 1, stock: 1,
  isHandDelivery: true, isShipping: false } satisfies Partial<Article>;
const key = '@article_publication:A:original';
function technicalReply(payload: Record<string, unknown>, version: 'listing_content_v1' | 'listing_content_v2' = 'listing_content_v2') {
  const retired = Object.keys(oldFields).filter(field => version === 'listing_content_v2' || !['hasKnownDefects', 'defectsDescription'].includes(field));
  const request = Object.fromEntries(Object.entries(payload).filter(([field]) =>
    !['clientRequestId', 'sellerId', 'sellerName', ...retired].includes(field)));
  const requestHash = hash(request), articleId = 'created';
  const content = Object.fromEntries(['quantity', 'stock', 'title', 'description', 'category', 'categoryIds', 'condition', 'brand', 'size',
    'colors', 'color', 'materials', 'material', ...(version === 'listing_content_v1' ? ['hasKnownDefects', 'defectsDescription'] : []), 'images', 'hygieneDeclaration'].map(field =>
      [field, field === 'images' ? article.images.map(image => image.url) : payload[field] ?? null]));
  return { data: { articleId, saleDeclarationView: { schemaVersion: 1, articleId, ownerId: 'A', currentContentHash: hash([articleId, 'A', content]),
    content, quantity: 1, qualification: 'matching_listing_content', declaration: { version, scope: 'single_listing', actorUid: 'A',
      contentHash: hash([articleId, 'A', content]), declaredAtMs: Date.now(), requestHash, previousContentHash: null },
    platformVerificationGranted: false, commonPhysicalIdentityProven: false },
    inventoryUnitView: { protocol: 'article_inventory_unit_view_v1', articleId, qualification: 'native_current', revision: 'b'.repeat(64),
      inventoryUnitId: `unit_${'a'.repeat(64)}`, memberArticleIds: [articleId], availability: 'available' },
    inventoryUnitReceipt: { protocol: 'article_inventory_unit_receipt_v1', articleId, unitId: `unit_${'a'.repeat(64)}`,
      requestHash, previousRevision: null, recordedAt: new Date().toISOString() } } };
}
beforeEach(async () => { jest.clearAllMocks(); await NativeAsyncStorage.clear(); mockCallable.mockImplementation(async payload => technicalReply(payload)); });

it.each(['listing_content_v1', 'listing_content_v2'] as const)('acknowledges %s and its versioned inventory hash for an older pending payload without rewriting its intent', async version => {
  mockCallable.mockImplementation(async payload => technicalReply(payload, version));
  const input = { ...article, ...oldFields };
  const { sellerId: _seller, ...payload } = { ...input, clientRequestId: 'original' };
  const original = { input: JSON.stringify(input), payload, outcome: 'unknown' };
  await AsyncStorage.setItem(key, JSON.stringify(original));
  // Historical journals retain their original DTO; new callers use the smaller current type.
  await expect(ArticlesService.createArticle(input as unknown as Parameters<typeof ArticlesService.createArticle>[0], { requestId: 'original' })).resolves.toBe('created');
  expect(mockCallable).toHaveBeenCalledTimes(1);
  expect(mockCallable).toHaveBeenCalledWith(payload);
  const saved = JSON.parse((await AsyncStorage.getItem(key))!);
  expect(saved.input).toBe(original.input);
  expect(saved.payload).toEqual(payload);
  expect(saved.outcome).toBe('confirmed');
});

it('omits retired questionnaire fields from every new publication payload, including stale runtime extras', async () => {
  const input = { ...article, ...oldFields };
  await expect(ArticlesService.createArticle(input as unknown as Parameters<typeof ArticlesService.createArticle>[0], { requestId: 'new-draft' })).resolves.toBe('created');
  const payload = mockCallable.mock.calls[0][0];
  for (const field of Object.keys(oldFields)) expect(payload).not.toHaveProperty(field);
  expect(payload.quantity).toBe(1);
});

it.each([false, true])('preserves the refusal envelope and %s prior uncertainty without deleting or rewriting the intent', async priorUnknown => {
  const input = JSON.stringify(article), {sellerId: _seller, ...payload} = {...article, clientRequestId: 'original'};
  if (priorUnknown) await AsyncStorage.setItem(key, JSON.stringify({input, payload, outcome: 'unknown'}));
  const details = {reason: 'admission_refused', automated: true, action: 'reviewAutomatedDecision', decisionId: `admission_${'a'.repeat(64)}`};
  mockCallable.mockRejectedValueOnce(Object.assign(new Error('admission_refused'), {code: 'functions/permission-denied', details}));
  await expect(ArticlesService.createArticle(article, {requestId: 'original'})).rejects.toMatchObject({code: 'functions/permission-denied', details});
  const saved = JSON.parse((await AsyncStorage.getItem(key))!);
  expect(saved.input).toBe(input); expect(saved.outcome).toBe(priorUnknown ? 'unknown' : 'refused');
  expect(await ArticlesService.getPendingPublicationInput('original', () => undefined)).toBe(priorUnknown ? input : null);
  expect(mockCallable).toHaveBeenCalledTimes(1);
});
