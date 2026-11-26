import {renderWithQuery as render} from '@/tests/jest/helpers/queryRender';
import {auth} from '@/config/firebaseConfig';
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => 1,
  useAuthStore: Object.assign((selector: (state: { user: unknown; authenticatedUid: string | null }) => unknown) => selector({ user: mockUser, authenticatedUid: mockUser?.id ?? null }), {
    getState: () => ({ user: mockUser, authenticatedUid: mockUser?.id ?? null }),
  }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-media-id' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: require('react-native').View }));
/**
 * Composants UI Swap Zone / détail d'échange — comportements MÉTIER ciblés.
 *
 *  - MultiSelectBar : nombre d’articles, annulation et permission de continuer.
 *  - SwapStatusView : statut, perspective et conservation des articles.
 *  - Catalogue : navigation, auth, sélection, confirmation et états du dépôt.
 */

import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert, BackHandler } from 'react-native';
import { router } from 'expo-router';

// Le barrel @/components/ui ré-exporte des composants natifs lourds
// (ThemedBottomSheet → @expo/ui → expo-asset, OfflineBanner → expo-network…)
// non transformés par le preset. MultiSelectBar / SwapSummaryBox n'en
// consomment que Text/Caption : on réduit le barrel à ces primitives.
jest.mock('@/components/ui', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');
  const Text = (props: Record<string, unknown>) => React.createElement(RNText, props);
  const Caption = (props: Record<string, unknown>) => React.createElement(RNText, props);
  return {
  Button: jest.requireActual('@/components/ui/Button').Button, Checkbox: jest.requireActual('@/components/ui/Checkbox').Checkbox,
 Text, Caption };
});

// Import direct (et non via le barrel @/features/swap) pour ne pas tirer
// AddItemSheet et sa dépendance bottom-sheet dans un test isolé de composant.
import { MultiSelectBar } from '@/features/swap/components/party/MultiSelectBar';
import { SwapStatusView } from '@/features/swap/components/detail/SwapStatusView';
import type { Article, SwapPartyItemExtended, SwapItemInfo, SwapStatus } from '@/types';

describe('<MultiSelectBar /> — sélection multiple', () => {
  it('permet d’annuler même si les filtres ont masqué toute la sélection', () => {
    const onCancel = jest.fn();
    const onPropose = jest.fn();
    render(<MultiSelectBar selectedCount={0} canPropose={false} onCancel={onCancel} onPropose={onPropose} />);
    expect(screen.getByText('Votre sélection')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Continuer'));
    expect(onPropose).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Annuler'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
  it('affiche le nombre d’articles et continue seulement si autorisé', () => {
    const onPropose = jest.fn();
    const { rerender } = render(<MultiSelectBar selectedCount={1} canPropose onCancel={jest.fn()} onPropose={onPropose} />);
    expect(screen.getByText('1 / 20')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Continuer'));
    expect(onPropose).toHaveBeenCalledTimes(1);
    rerender(<MultiSelectBar selectedCount={3} canPropose={false} onCancel={jest.fn()} onPropose={onPropose} />);
    expect(screen.getByText('3 / 20')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Continuer'));
    expect(onPropose).toHaveBeenCalledTimes(1);
  });
});

describe('<SwapStatusView /> — libellés de statut + résumé', () => {
  const senderItems: SwapItemInfo[] = [{ articleId: 'a', title: 'Robe noire', price: 40 }];
  const myItems: SwapItemInfo[] = [{ articleId: 'b', title: 'Veste', price: 50 }];

  const baseProps = {
    senderName: 'Alice',
    senderImage: undefined,
    senderItems,
    myItems,
    cashTopUpAmount: undefined,
  };

  it.each<[SwapStatus, string]>([
    ['accepted', 'Échange accepté'],
    ['declined', 'Proposition refusée'],
    ['cancelled', 'Échange annulé'],
    ['shipping', 'Échange en cours'],
    ['completed', 'Échange terminé'],
    ['disputed', 'Un problème est en cours d’examen'],
    ['payment_pending', 'Paiement historique en attente'],
  ])('mappe le statut %s vers le libellé "%s"', (status: SwapStatus, label: string) => {
    render(<SwapStatusView status={status} {...baseProps} />);
    expect(screen.getByText(label)).toBeOnTheScreen();
  });

  it('affiche les titres des articles de chaque côté', () => {
    // En statut "shipping" le résumé n'inclut pas de doublon de titres autre que
    // la carte article (le récap concatène les mêmes titres) → on tolère >= 1.
    render(<SwapStatusView status="accepted" {...baseProps} />);

    expect(screen.getAllByText('Robe noire').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Veste').length).toBeGreaterThanOrEqual(1);
  });

  it('présente les deux côtés de l’échange avec une perspective explicite', () => {
    render(<SwapStatusView status="accepted" {...baseProps} />);
    expect(screen.getByText('Vous recevez')).toBeOnTheScreen();
    expect(screen.getByText('Vous proposez')).toBeOnTheScreen();
    expect(screen.getByLabelText('Vous recevez, 40 $')).toBeOnTheScreen();
    expect(screen.getByLabelText('Vous proposez, 50 $')).toBeOnTheScreen();
  });
  it('garde les articles consultables pour un échange terminal', () => {
    render(<SwapStatusView status="declined" {...baseProps} />);
    expect(screen.getByText('Proposition refusée')).toBeOnTheScreen();
    expect(screen.getByText('Robe noire')).toBeOnTheScreen();
    expect(screen.getByText('Veste')).toBeOnTheScreen();
  });
});

const mockRequireAuth = jest.fn();
let mockUser: { id: string; displayName: string } | null = { id: 'me', displayName: 'Camille' };
const mockRefetchParty = jest.fn();
const mockRefetchArticles = jest.fn();
const mockInvalidate = jest.fn(() => Promise.resolve());
const mockSetCache = jest.fn();
let mockPartyResult: { data?: { party: { id: string; name: string } | null; items: SwapPartyItemExtended[] }; isLoading: boolean; isError: boolean; refetch: typeof mockRefetchParty };
let mockArticlesResult = { data: [] as Article[], isLoading: false, isError: false, refetch: mockRefetchArticles };
const mockAddItem = jest.fn((..._args: unknown[]) => Promise.resolve());
const mockRemoveItem = jest.fn((..._args: unknown[]) => Promise.resolve());

jest.mock('@/hooks/useAuth', () => ({
  useAuthenticatedUid: () => require('@/config/firebaseConfig').auth.currentUser?.uid ?? null,
  useAuthenticatedIdentity: () => { const user = require('@/hooks/useAuth').useUser(); return user?.id === require('@/config/firebaseConfig').auth.currentUser?.uid ? user : null; },
  useAuthenticatedSession: () => ({ uid: require('@/config/firebaseConfig').auth.currentUser?.uid ?? null, identity: require('@/hooks/useAuth').useAuthenticatedIdentity() }),
  useAuthGuardSession: () => ({ normalUser: require('@/hooks/useAuth').useUser(), identity: require('@/hooks/useAuth').useAuthenticatedIdentity(), isAuthLoading: false }),
 useUser: () => mockUser }));
jest.mock('@/hooks/useAuthRequired', () => ({ useRequireAuth: () => ({ requireAuth: mockRequireAuth }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
const mockEligibility = {version: 'a'.repeat(64), statementVersion: 'current', statements: {personal: 'Affaires personnelles', professional: 'Professionnel'}, activityDeclaration: {kind: 'personal', statementVersion: 'current'}, quebecResidenceStatementVersion: '2026-10-17.v1', quebecResidenceStatement: 'Résidence au Québec', swapLaunch: {allowed: true, reasons: [], policyVersion: '2026-10-17.v1'}};
jest.mock('@/services/eligibilityService', () => ({EligibilityService: {getMine: jest.fn(async () => mockEligibility)}}));
jest.mock('@/services/articlesService', () => ({ ArticlesService: { getUserArticles: jest.fn() } }));
jest.mock('@/services/swapService', () => ({
  GENERALIST_ZONE_ID: 'generalist', getSwapParty: jest.fn(), getPartyItemsExtended: jest.fn(),
  addItemToParty: (...args: unknown[]) => mockAddItem(...args),
  removeItemFromParty: (...args: unknown[]) => mockRemoveItem(...args),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ['eligibility', 'swap-launch-confirmation'].includes(queryKey[0]) ? {data: mockEligibility, isSuccess: true, isLoading: false, isError: false, isFetching: false} : queryKey[0] === 'swap-parties' ? mockPartyResult : mockArticlesResult,
  useQueryClient: () => Object.assign(jest.requireActual('@tanstack/react-query').useQueryClient(), { invalidateQueries: mockInvalidate, getQueryData: () => mockPartyResult.data, setQueryData: mockSetCache }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: require('react-native').View,
  useSafeAreaInsets: () => ({ top: 24, bottom: 20, left: 0, right: 0 }),
}));
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { FlashList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent, ListFooterComponent }: {
    data: unknown[]; renderItem: (props: { item: unknown }) => React.ReactNode;
    ListHeaderComponent: React.ReactNode; ListEmptyComponent: React.ReactNode; ListFooterComponent: React.ReactNode;
  }) => React.createElement(View, {}, ListHeaderComponent, data.length ? data.map((item, index) => React.createElement(View, { key: index }, renderItem({ item }))) : ListEmptyComponent, ListFooterComponent) };
});
jest.mock('@/features/search', () => ({ FilterChipsRow: () => null, CONDITION_ITEMS: [], SORT_ITEMS: [] }));
jest.mock('@/components/CategoryBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/SelectionBottomSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/SizeSelectionSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/BrandSelectionSheet', () => ({ __esModule: true, default: () => null }));
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View, Pressable } = require('react-native');
  return {
    BottomSheetModal: React.forwardRef(({ children, footerComponent, onDismiss }: { children: React.ReactNode; footerComponent?: (p: object) => React.ReactNode; onDismiss?: () => void }, ref: React.Ref<unknown>) => {
      React.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: () => onDismiss?.() }));
      return React.createElement(View, { testID: 'deposit-sheet' }, children, footerComponent?.({}));
    }),
    BottomSheetBackdrop: () => null,
    BottomSheetScrollView: View,
    BottomSheetFooter: View,
    TouchableOpacity: Pressable,
  };
});

import SwapZoneScreen from '@/app/swap-zone';
import AddItemSheet from '@/features/swap/components/party/AddItemSheet';
import { PartyItemCard } from '@/features/swap/components/party/PartyItemCard';
import { MyArticlesSection } from '@/features/swap/components/party/MyArticlesSection';
import { PartyEmptyGrid } from '@/features/swap/components/party/PartyEmptyGrid';

const catalogueItem = (id: string, sellerId = 'alice'): SwapPartyItemExtended => ({
  id, partyId: 'generalist', articleId: id, sellerId, sellerName: sellerId,
  title: `Article ${id}`, price: 30, imageUrl: `https://example.test/${id}.jpg`, isSwapped: false, addedAt: new Date(),
});
const ownArticle: Article = {
  id: 'own', title: 'Veste de Camille', description: 'Veste en bon état à échanger.',
  price: 30, images: [{ url: 'https://example.test/own.jpg' }],
  category: 'vêtements', categoryIds: ['femme', 'vestes'], condition: 'bon état',
  sellerId: 'me', sellerName: 'Camille', createdAt: new Date(),
  isActive: true, isSold: false, likes: 0, views: 0,
};

function resetCatalogue(items = [catalogueItem('a'), catalogueItem('b'), catalogueItem('c', 'bob')]) {
  mockUser = { id: 'me', displayName: 'Camille' }; Object.defineProperty(auth, 'currentUser', {value: {uid: 'me'}, writable: true, configurable: true});
  mockPartyResult = { data: { party: { id: 'generalist', name: 'Swap Zone' }, items }, isLoading: false, isError: false, refetch: mockRefetchParty };
  mockArticlesResult = { data: [ownArticle], isLoading: false, isError: false, refetch: mockRefetchArticles };
  mockRequireAuth.mockReset(); mockAddItem.mockReset(); mockRemoveItem.mockReset();
  mockAddItem.mockResolvedValue(undefined); mockRemoveItem.mockResolvedValue(undefined);
}

describe('Espace échanges — catalogue et navigation', () => {
  beforeEach(() => resetCatalogue());
  it('sépare vos articles de ceux à découvrir et masque les marques absentes', () => {
    resetCatalogue([catalogueItem('own', 'me'), catalogueItem('a'), catalogueItem('b'), catalogueItem('c', 'bob')]);
    render(<SwapZoneScreen />);
    expect(screen.getByText('LE TROC.')).toBeOnTheScreen();
    expect(screen.getByText('Vos articles')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sélectionner' })).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^troc-item-/)).toHaveLength(3);
    expect(screen.queryByText('BRAND')).toBeNull();
    expect(screen.queryByText('MARQUE')).toBeNull();
    fireEvent.press(screen.getByText('Mes échanges'));
    expect(router.push).toHaveBeenCalledWith('/my-swaps');
  });
  it.each(['loading', 'error', 'nozone'] as const)('garde un retour vers l’accueil dans l’état %s', (state) => {
    mockPartyResult = { ...mockPartyResult, data: undefined, isLoading: state === 'loading', isError: state === 'error' };
    jest.mocked(router.canGoBack).mockReturnValueOnce(false);
    render(<SwapZoneScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Retour' }));
    expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    if (state === 'error') {
      expect(screen.getByText('Le catalogue n’a pas pu être chargé')).toBeOnTheScreen();
      fireEvent.press(screen.getByText('Réessayer'));
      expect(mockRefetchParty).toHaveBeenCalledTimes(1);
    }
    if (state === 'nozone') expect(screen.getByText('Aucun espace disponible pour le moment')).toBeOnTheScreen();
  });
  it('guide la consultation en invité et reprend une proposition après connexion', () => {
    mockUser = null;
    render(<SwapZoneScreen />);
    expect(screen.getByText('Connectez-vous pour proposer vos articles à l’échange.')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: /^Article a/ }));
    expect(mockRequireAuth).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    const continueAfterAuth = mockRequireAuth.mock.calls[0][0] as () => void;
    act(() => { continueAfterAuth(); continueAfterAuth(); });
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/propose-swap', params: expect.objectContaining({ receiverId: 'alice' }) }));
  });
  it('bloque les doubles navigations sur des appuis rapprochés', () => {
    render(<SwapZoneScreen />);
    const article = screen.getByRole('button', { name: /^Article a/ });
    fireEvent.press(article); fireEvent.press(article);
    expect(router.push).toHaveBeenCalledTimes(1);
  });
  it('limite la sélection à une personne et annule avec le retour', () => {
    render(<SwapZoneScreen />);
    fireEvent(screen.getByRole('button', { name: /^Article a/ }), 'longPress');
    expect(screen.getByRole('checkbox', { name: /^Article c/ })).toBeDisabled();
    fireEvent.press(screen.getByRole('checkbox', { name: /^Article b/ }));
    expect(screen.getByText('2 / 20')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Retour' }));
    expect(screen.queryByText('Votre sélection')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Retour' }));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
  it('le retour Android annule aussi la sélection sans quitter', () => {
    const hardwareBack = jest.spyOn(BackHandler, 'addEventListener');
    render(<SwapZoneScreen />);
    fireEvent(screen.getByRole('button', { name: /^Article a/ }), 'longPress');
    const handler = hardwareBack.mock.calls.find(([event]) => event === 'hardwareBackPress')?.[1];
    act(() => { expect(handler?.()).toBe(true); });
    expect(screen.queryByText('Votre sélection')).toBeNull();
    hardwareBack.mockRestore();
  });
  it('l’action Sélectionner attend le premier choix puis verrouille le membre', () => {
    render(<SwapZoneScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Sélectionner' }));
    expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /^Article c/ })).toBeEnabled();
    fireEvent.press(screen.getByRole('checkbox', { name: /^Article a/ }));
    expect(screen.getByRole('checkbox', { name: /^Article c/ })).toBeDisabled();
    fireEvent.press(screen.getByRole('checkbox', { name: /^Article b/ }));
    fireEvent.press(screen.getByRole('button', { name: 'Continuer' }));
    expect(router.push).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/propose-swap', params: expect.objectContaining({ receiverId: 'alice' }) }));
  });
  it('la sélection envoie uniquement les articles de la personne choisie', () => {
    render(<SwapZoneScreen />);
    fireEvent(screen.getByRole('button', { name: /^Article a/ }), 'longPress');
    fireEvent.press(screen.getByRole('checkbox', { name: /^Article b/ }));
    fireEvent.press(screen.getByText('Continuer'));
    const destination = jest.mocked(router.push).mock.calls[0][0];
    if (typeof destination !== 'object' || !destination.params || !('receiverArticleIds' in destination.params) || typeof destination.params.receiverArticleIds !== 'string') {
      throw new Error('La proposition doit transmettre les articles sélectionnés.');
    }
    expect(JSON.parse(destination.params.receiverArticleIds).sort()).toEqual(['a', 'b']);
  });
  it('retirer un article demande confirmation et Annuler ne mute rien', () => {
    resetCatalogue([catalogueItem('own', 'me')]);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    render(<SwapZoneScreen />);
    expect(screen.queryByText('Article own')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Afficher 1 article' }));
    const remove = screen.getByRole('button', { name: 'Retirer Article own du Troc' });
    fireEvent.press(remove); fireEvent.press(remove);
    expect(alert).toHaveBeenCalledTimes(1);
    act(() => { alert.mock.calls[0][2]?.find((button) => button.text === 'Annuler')?.onPress?.(); });
    expect(mockRemoveItem).not.toHaveBeenCalled();
    fireEvent.press(remove);
    expect(alert).toHaveBeenCalledTimes(2);
    alert.mockRestore();
  });
  it('monte le dépôt après relecture de l’admission et le retire après fermeture', async () => {
    render(<SwapZoneScreen />);
    expect(screen.queryByTestId('deposit-sheet')).toBeNull();
    fireEvent.press(screen.getByTestId('troc-add-piece'));
    expect(screen.queryByTestId('deposit-sheet')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('deposit-sheet')).toBeOnTheScreen());
    expect(screen.getByTestId('deposit-sheet')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Fermer l’ajout d’articles' }));
    expect(screen.queryByTestId('deposit-sheet')).toBeNull();
  });
});

describe('Ajout d’articles — états et confirmation', () => {
  beforeEach(() => resetCatalogue());
  it('distingue erreur et garde-robe vide avec leurs actions', () => {
    const onRetry = jest.fn(); const onPublish = jest.fn();
    const { rerender } = render(<AddItemSheet articles={[]} userItems={[]} error onAddItems={jest.fn()} onRetry={onRetry} />);
    expect(screen.getByText('Vos articles n’ont pas pu être chargés')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Réessayer'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<AddItemSheet articles={[]} userItems={[]} onAddItems={jest.fn()} onPublish={onPublish} />);
    expect(screen.getByText('Votre garde-robe est encore vide')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Publier un article'));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
  it('n’ajoute pas les articles déjà déposés et protège la confirmation répétée', async () => {
    const onAdd = jest.fn();
    render(<AddItemSheet articles={[ownArticle, { ...ownArticle, id: 'already', title: 'Déjà déposé' }]} userItems={[catalogueItem('already', 'me')]} onAddItems={onAdd} />);
    expect(screen.queryByText('Déjà déposé')).toBeNull();
    const submit = screen.getByRole('button', { name: 'Ajouter au Troc' });
    expect(submit).toBeDisabled();
    fireEvent.press(screen.getByRole('checkbox', { name: 'Veste de Camille' }));
    act(() => { fireEvent.press(submit); fireEvent.press(submit); });
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith([ownArticle]);
  });
  it('une carte sans marque affiche uniquement les données connues', () => {
    render(<PartyItemCard item={catalogueItem('plain')} tone="dark" isSelected={false} isMultiSelectMode={false} onPress={jest.fn()} onLongPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Article plain, valeur 30 $' })).toBeOnTheScreen();
    expect(screen.queryByText(/Valeur indicative/)).toBeNull();
    expect(screen.queryByText('BRAND')).toBeNull();
    expect(screen.queryByText('U')).toBeNull();
  });
});


describe('Vos articles — catalogue compact', () => {
  const add = jest.fn();
  const remove = jest.fn();
  it('replie la garde-robe par défaut et conserve les actions de retrait après ouverture', () => {
    const items = Array.from({ length: 50 }, (_, index) => catalogueItem(`own-${index}`, 'me'));
    render(<MyArticlesSection userItems={items} onAddPress={add} onRemoveItem={remove} />);
    const show = screen.getByRole('button', { name: 'Afficher 50 articles', expanded: false });
    expect(screen.queryByText('Article own-0')).toBeNull();
    expect(screen.queryByRole('button', { name: /Retirer Article/ })).toBeNull();
    fireEvent.press(show);
    const hide = screen.getByRole('button', { name: 'Masquer 50 articles', expanded: true });
    expect(screen.getByText('Article own-49')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Retirer Article own-0 du Troc' }));
    expect(remove).toHaveBeenCalledWith('own-0');
    fireEvent.press(hide);
    expect(screen.queryByText('Article own-49')).toBeNull();
    expect(screen.getByRole('button', { name: 'Afficher 50 articles', expanded: false })).toBeOnTheScreen();
  });
  it('affiche les ajouts en cours même replié et garde le choix d’ouverture du membre', () => {
    const items = [catalogueItem('own', 'me')];
    const { rerender } = render(<MyArticlesSection userItems={items} pendingCount={2} onAddPress={add} onRemoveItem={remove} />);
    expect(screen.getByText('Ajout de 2 articles en cours…')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Ajout de votre article en cours')).toHaveLength(2);
    expect(screen.queryByText('Article own')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Afficher 1 article', expanded: false }));
    expect(screen.getByText('Article own')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Ajout de votre article en cours')).toHaveLength(2);
    rerender(<MyArticlesSection userItems={[...items, catalogueItem('new-1', 'me'), catalogueItem('new-2', 'me')]} onAddPress={add} onRemoveItem={remove} />);
    expect(screen.queryByText(/Ajout de .* en cours/)).toBeNull();
    expect(screen.getByText('Article new-2')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Masquer 3 articles', expanded: true })).toBeOnTheScreen();
  });
  it('utilise la même action pour invité et connecté tout en expliquant la connexion', () => {
    const { rerender } = render(<MyArticlesSection userItems={[]} isGuest onAddPress={add} onRemoveItem={remove} />);
    expect(screen.getByText('Connectez-vous pour proposer vos articles à l’échange.')).toBeOnTheScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Ajouter des articles' }));
    expect(add).toHaveBeenCalledTimes(1);
    rerender(<MyArticlesSection userItems={[]} onAddPress={add} onRemoveItem={remove} />);
    expect(screen.queryByText('Connectez-vous pour proposer vos articles à l’échange.')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Ajouter des articles' }));
    expect(add).toHaveBeenCalledTimes(2);
  });
  it('décrit le stock vide sans promettre de nouveaux articles', () => {
    render(<PartyEmptyGrid hasActiveFilters={false} onClearFilters={jest.fn()} />);
    expect(screen.getByText('Aucun article à échanger pour le moment.')).toBeOnTheScreen();
    expect(screen.getByText('Vous pouvez déjà ajouter les vôtres.')).toBeOnTheScreen();
    expect(screen.queryByText(/arriv|bientôt/i)).toBeNull();
  });
});
