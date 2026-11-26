import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AsyncStorage from '@/utils/environmentStorage';
import type { Article } from '@/types';
import type { ArticleSaleDeclarationView } from '@/types/article';
import { buildLegacyArticleUpdates, getArticleDefectReviewKey } from '@/features/article/services/buildArticleUpdates';

const mockGet = jest.fn();
const mockRead = jest.fn();
const mockUpdate = jest.fn();
const mockInventoryUpdate = jest.fn();
const mockInventoryRead = jest.fn();
const mockMatches = jest.fn();
const mockOperation = {};
const mockBack = jest.fn();
jest.mock('@/config/firebaseConfig', () => ({ auth: { currentUser: { uid: 'A' } }, storage: {} }));
jest.mock('@/config/featureFlags', () => ({ SHIPPING_ENABLED: false, SHIPPING_LISTINGS_ENABLED: true }));
jest.mock('@/hooks/useAuth', () => ({ useAuthenticatedUid: () => 'A' }));
jest.mock('@/hooks/useTradeAdmissionError', () => ({ useTradeAdmissionError: () => jest.fn() }));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({ useLabelLifecycleContext: () => ({
  frame: mockOperation, focused: true, focusRevision: '1', capture: () => mockOperation, isCurrent: () => true,
}) }));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => 1,
  useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(require('@/store/authStore').useAuthStore.getState()), { getState: () => ({ authenticatedUid: 'A', user: { id: 'A' } }) }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),

  useRouter: () => ({ back: mockBack }), useLocalSearchParams: () => ({ id: 'article-A' }),
  useNavigation: () => ({ addListener: () => jest.fn(), dispatch: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/services/articlesService', () => ({
  isInventoryUnitDeclaration: (value: { kind?: string } | null) => value?.kind === 'new_unit',
  isArticleSaleDeclarationInput: () => false,
  ArticlesService: {
    getArticleById: (...args: unknown[]) => mockGet(...args),
    readSaleDeclaration: (...args: unknown[]) => mockRead(...args),
    saleDeclarationMatchesUpdate: (...args: unknown[]) => mockMatches(...args),
    updateArticleWithDeclaration: (...args: unknown[]) => mockUpdate(...args),
    updateArticleWithInventory: (...args: unknown[]) => mockInventoryUpdate(...args),
    readInventoryUnit: (...args: unknown[]) => mockInventoryRead(...args),
  },
}));
jest.mock('@/components/ArticleChildSafetyFields', () => ({ ArticleChildSafetyFields: () => null }));
jest.mock('@/features/sell/components/details/EditableField', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { TextInput } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true,
    default: ({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void }) =>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onSave} />,
  };
});
jest.mock('@/features/sell/components/details/CategoryDisplay', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/sell/components/details/ConditionSelector', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/CategoryBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/SelectionBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/BrandSelectionSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/sell/components/pricing/NeighborhoodBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/features/sell', () => ({ ChipSelector: () => null }));
jest.mock('@/components/ui/Skeleton', () => ({ Skeleton: () => null }));
jest.mock('@/components/ui/ScreenHeader', () => ({ ScreenHeader: () => null }));
jest.mock('@/components/ui', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Button: ({ children, onPress }: { children: React.ReactNode; onPress: () => void }) => <Pressable onPress={onPress}><Text>{children}</Text></Pressable> };
});
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const Edit = require('@/app/article/edit/[id]').default as typeof import('@/app/article/edit/[id]').default;
const key = '@article_edit:A:article-A';
const beforeHash = 'a'.repeat(64), afterHash = 'b'.repeat(64), requestHash = 'd'.repeat(64);
const images = [{ url: 'https://example.com/article.jpg' }];
const neighborhoods = [{ id: 'q', name: 'Quartier', borough: 'Montréal' }];
let stored: Article;
let nativeView: ArticleSaleDeclarationView;
let alert: jest.SpyInstance;
const clients: QueryClient[] = [];
const technicalView = (previousContentHash: string | null = beforeHash,
  version: 'listing_content_v1' | 'listing_content_v2' = 'listing_content_v2'): ArticleSaleDeclarationView => ({
  schemaVersion: 1, articleId: 'article-A', ownerId: 'A', currentContentHash: afterHash, content: {}, quantity: 1,
  qualification: 'matching_listing_content', platformVerificationGranted: false, commonPhysicalIdentityProven: false,
  declaration: { version, scope: 'single_listing', actorUid: 'A', contentHash: afterHash,
    declaredAtMs: 1, requestHash, previousContentHash },
});
function commit(view = technicalView(), updates: Record<string, unknown> = {}) {
  nativeView = view;
  const content = {...updates}; delete content.expectedSaleDeclarationContentHash;
  stored = { ...stored, ...content, saleDeclaration: { schemaVersion: 1, source: 'seller_publication', articleId: stored.id,
    quantity: 1, declaredAt: new Date(1), ...view.declaration! } } as Article;
  return view;
}
function historicalJournal() {
  const fields = {
    title: stored.title, description: stored.description, categoryIds: stored.categoryIds!,
    categoryDisplay: { icon: 'pricetag-outline', name: 'Haut', context: '' }, condition: stored.condition,
    colors: [], materials: [], size: null, sizeSystem: 'EU' as const, brand: '', brandChanged: false,
    price: stored.price, isHandDelivery: true, isShipping: false, neighborhoods, packageSize: null,
    inventoryUnitDeclaration: { kind: 'new_unit' }, expectedInventoryUnitRevision: 'c'.repeat(64),
    brandStatus: 'unknown' as const, saleUnit: 'single_article', counterfeitStatus: 'not_counterfeit',
    hasAlterations: true, alterationsDescription: 'Ancienne retouche', alterationsChanged: false,
    hasKnownDefects: true, defectsDescription: 'Ancienne tache', defectsChanged: true,
    defectReviewSource: getArticleDefectReviewKey(stored.description, stored.condition),
    defectsReviewedFor: getArticleDefectReviewKey(stored.description, stored.condition),
  };
  const updates = { ...buildLegacyArticleUpdates(fields, images), inventoryUnitDeclaration: fields.inventoryUnitDeclaration,
    expectedInventoryUnitRevision: fields.expectedInventoryUnitRevision };
  return { fields, updates, images, selected: images, uploaded: [], sourceFingerprint: JSON.stringify({ fields, images }) };
}
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client);
  const view = render(<QueryClientProvider client={client}><Edit /></QueryClientProvider>);
  await waitFor(() => expect(view.getByText(/Enregistrer les modifications|Vérifier l’enregistrement/)).toBeTruthy());
  return view;
}
async function save(view: Awaited<ReturnType<typeof mount>>) {
  await act(async () => { fireEvent.press(view.getByText(/Enregistrer les modifications|Vérifier l’enregistrement/)); });
}
const succeeded = () => alert.mock.calls.some(([title]) => title === 'Succès');
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.removeItem(key);
  stored = { id: 'article-A', sellerId: 'A', sellerName: 'A', title: 'Article test', description: 'Description test',
    category: 'Haut', categoryIds: ['femme', 'vetements', 'tops'], condition: 'bon état', price: 40,
    isSold: false, isActive: true, isHandDelivery: true, isShipping: false, neighborhoods, neighborhood: neighborhoods[0], images,
    createdAt: new Date(1), likes: 0, views: 0 };
  nativeView = { ...technicalView(), currentContentHash: beforeHash, qualification: 'missing', declaration: null };
  mockGet.mockImplementation(async () => stored);
  mockRead.mockImplementation(async () => nativeView);
  mockMatches.mockResolvedValue(true);
  mockUpdate.mockImplementation(async (_id: string, updates: Record<string, unknown>) => commit(technicalView(), updates));
  mockInventoryUpdate.mockImplementation(async () => commit(technicalView(null)));
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { clients.splice(0).forEach(client => client.clear()); jest.restoreAllMocks(); });

it('propose la livraison en Dev et enregistre sans défauts avec le reçu V2 et le formulaire intact', async () => {
  stored = { ...stored, brandStatus: 'unknown', saleUnit: 'set_as_one', counterfeitStatus: 'declared_counterfeit',
    hasAlterations: true, alterationsDescription: 'Ancienne retouche', hasKnownDefects: true,
    defectsDescription: 'Ancienne tache', quantity: 3, stock: 2 };
  const view = await mount();
  expect(view.queryByText('Marque connue')).toBeNull();
  expect(view.queryByText('Retouches')).toBeNull();
  expect(view.queryByText('Défauts connus')).toBeNull();
  fireEvent.changeText(view.getByLabelText('Description'), 'Description modifiée');
  fireEvent.press(view.getByText('Expédition'));
  expect(view.getByText('Expédition')).toBeOnTheScreen();
  await save(view);
  await waitFor(() => expect(succeeded()).toBe(true));
  const updates = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
  expect(updates.expectedSaleDeclarationContentHash).toBe(beforeHash);
  expect(updates).toMatchObject({ description: 'Description modifiée', isShipping: true, packageSize: require('@/functions/src/shared/automaticShippingEstimate').automaticShippingEstimate({categoryIds: stored.categoryIds}).profileSize });
  for (const field of ['saleDeclaration', 'saleUnit', 'counterfeitStatus', 'inventoryUnitDeclaration', 'brandStatus',
    'hasAlterations', 'alterationsDescription', 'hasKnownDefects', 'defectsDescription', 'quantity', 'stock']) expect(updates).not.toHaveProperty(field);
  expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(alert.mock.calls.some(([title]) => title === 'Modification enregistrée')).toBe(false);
});

it('rejoue exactement un ancien inventaire et accepte son reçu V5 sans exiger de groupe', async () => {
  const journal = historicalJournal(); await AsyncStorage.setItem(key, JSON.stringify(journal));
  mockInventoryUpdate.mockImplementationOnce(async () => commit(technicalView(null, 'listing_content_v1')));
  const view = await mount(); await save(view);
  await waitFor(() => expect(succeeded()).toBe(true));
  expect(mockInventoryUpdate.mock.calls[0][1]).toEqual(journal.updates);
  expect(mockInventoryRead).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(key)).toBeNull();
});

it('rapproche un journal inventaire apparu avant l’envoi avec son reçu V2 sans le renvoyer', async () => {
  const view = await mount();
  const journal = historicalJournal(); await AsyncStorage.setItem(key, JSON.stringify(journal)); commit(technicalView(null));
  fireEvent.changeText(view.getByLabelText('Titre'), 'Nouvelle saisie');
  await save(view);
  await waitFor(() => expect(alert.mock.calls.some(([title]) => title === 'Modification enregistrée')).toBe(true));
  expect(mockInventoryUpdate).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockInventoryRead).not.toHaveBeenCalled(); expect(await AsyncStorage.getItem(key)).toBeNull();
  expect(view.getByLabelText('Titre').props.value).toBe('Nouvelle saisie');
});

it('conserve le journal exact si la relecture porte une autre précondition', async () => {
  const journal = historicalJournal(); const raw = JSON.stringify(journal); await AsyncStorage.setItem(key, raw);
  mockInventoryUpdate.mockImplementation(async () => {
    const own = technicalView(null); commit(technicalView('e'.repeat(64))); return own;
  });
  const view = await mount(); await save(view);
  expect(succeeded()).toBe(false); expect(await AsyncStorage.getItem(key)).toBe(raw);
  expect(mockInventoryRead).not.toHaveBeenCalled();
});
