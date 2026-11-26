import {getEnvironmentStorageKey} from '@/config/firebaseEnvironment';
// The provider IO supplies current positive foundations; session/admission guards stay real.
jest.mock('@/services/eligibilityService', () => ({ EligibilityService: { getMine: jest.fn(async () => ({ decisions: Object.fromEntries(['buy', 'sell', 'new_paid_shipping'].map(scope => [scope, { scope, allowed: true, status: 'allowed', reasons: [], messages: [], policyVersion: 'fixture-policy', evaluationStage: 'foundations' }])) })) } }));
jest.mock('@/services/chat/offers', () => ({ hasMeetupAcceptanceAttempt: jest.fn(async () => false), acknowledgeMeetupProposal: jest.fn(), readMeetupProposalRecovery: jest.fn(async () => null) }));
import React, { useState } from 'react';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { ActionSheetIOS, Alert } from 'react-native';
import { auth } from '@/config/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Article, MeetupSpot } from '@/types';
let mockSold = true; let mockUid = 'A'; let mockGeneration = 1; let mockArticles: Article[] = [];
let mockRemovalClient: import('@tanstack/react-query').QueryClient | null = null;
const mockRead = jest.fn(); const mockDelete = jest.fn(); const mockChat = jest.fn(); const mockOffer = jest.fn();
const mockPush = jest.fn(); const mockBack = jest.fn(); const mockTrack = jest.fn(); const mockSetCache = jest.fn(); const mockInvalidate = jest.fn();
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (state: { user: { id: string }; authenticatedUid: string; identityUser?: {id:string}|null; identityError?:boolean; isLoading?:boolean }) => unknown) => selector({identityUser: { id: mockUid }, identityError: false, isLoading: false,  user: { id: mockUid }, authenticatedUid: mockUid }), {
    getState: () => ({identityUser: { id: mockUid }, identityError: false, isLoading: false,  user: { id: mockUid }, authenticatedUid: mockUid }),
  }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
 useRouter: () => ({ push: mockPush, back: mockBack }), useFocusEffect: (callback: () => void | (() => void)) => { const React = require('react'); React.useEffect(callback, [callback]); } }));
jest.mock('@/hooks/useAuthRequired', () => ({ useRequireAuth: () => ({ requireAuth: (fn: () => void) => fn() }) }));
jest.mock('@/hooks/useFavorites', () => ({ useFavorites: () => ({ toggleFavorite: jest.fn(), isFavorite: jest.fn() }), favoritesKeys: { all: ['favorites'] } }));
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mockArticles, isLoading: false, isRefetching: false, isError: false, refetch: jest.fn() }), useQueryClient: () => mockRemovalClient ?? ({ getQueryData: () => mockArticles, setQueryData: mockSetCache, invalidateQueries: mockInvalidate }) }));
jest.mock('@/services/articlesService', () => ({ ArticlesService: { getArticleById: (...args: unknown[]) => mockRead(...args), deleteArticle: (...args: unknown[]) => mockDelete(...args) } }));
jest.mock('@/services/chatService', () => ({ ChatService: { createOrGetChat: (...args: unknown[]) => mockChat(...args), sendMeetupOffer: (...args: unknown[]) => mockOffer(...args) } }));
jest.mock('@/services/swapService', () => ({ GENERALIST_ZONE_ID: 'zone' }));
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('@/features/sell/services/draftService', () => ({ draftService: {} }));
jest.mock('@/components/ui', () => {
  const React = require('react'); const { View, Text } = require('react-native');
  return {
  Button: jest.requireActual('@/components/ui/Button').Button,
 Text, ScreenHeader: ({ title }: { title: string }) => React.createElement(Text, null, title), Skeleton: View };
});
jest.mock('@shopify/flash-list', () => {
  const React = require('react'); const { View } = require('react-native');
  return { FlashList: ({ data, renderItem }: { data: Article[]; renderItem: (value: { item: Article }) => React.ReactNode }) => React.createElement(View, null, data.map(item => React.createElement(React.Fragment, { key: item.id }, renderItem({ item })))) };
});
jest.mock('react-native-gesture-handler', () => {
  const React = require('react'); const { View } = require('react-native');
  return { Swipeable: React.forwardRef(({ children }: { children: React.ReactNode }, ref: React.Ref<{ close: () => void }>) => {
    React.useImperativeHandle(ref, () => ({ close: jest.fn() })); return React.createElement(View, null, children);
  }) };
});
import { useArticleActions } from '@/features/article/hooks/useArticleActions';
import MyArticlesScreen from '@/app/my-articles';
const article = (id = 'article-A', sellerId = 'A', isSold = true): Article => ({ id, sellerId, isSold, title: id, price: 40, images: [], isHandDelivery: true, isShipping: false, description: 'Description', category: 'top', categoryIds: ['top'], condition: 'bon état', sellerName: sellerId, createdAt: new Date('2026-10-12T00:00:00Z'), isActive: true, likes: 0, views: 0 });
const spot = { name: 'Lieu', category: 'metro', neighborhood: { id: 'q', name: 'Quartier', borough: 'Montréal' } } as MeetupSpot;
function session(uid: string, generation = mockGeneration + 1) { mockUid = uid; mockGeneration = generation; (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid }; }
function harness({ initial = article() }: { initial?: Article } = {}) {
  const [current, setCurrent] = useState<Article | null>(initial);
  return { current, setCurrent, ...useArticleActions({ article: current, setArticle: setCurrent, makeOfferModalRef: { current: null }, reportBottomSheetRef: { current: null } }) };
}
let menu: jest.SpyInstance; let alert: jest.SpyInstance; let dispatch: jest.Mock;
beforeEach(async () => {
  jest.clearAllMocks(); mockRemovalClient = null; await AsyncStorage.clear(); session('A', 1); mockArticles = [article()]; mockSold = true;
  mockSetCache.mockImplementation((_key: readonly string[], apply: (old: Article[]) => Article[]) => { mockArticles = apply(mockArticles); return mockArticles; });
  mockRead.mockImplementation(async (id: string) => article(id, mockUid, false)); mockChat.mockResolvedValue({ id: 'chat-A' }); mockOffer.mockResolvedValue('receipt-A'); mockDelete.mockResolvedValue(undefined);
  dispatch = jest.fn(async () => ({ data: { success: true } })); (httpsCallable as jest.Mock).mockImplementation(() => async(p:Record<string,unknown>) => { if(p.operation==='observe')return {data:{operation:'observe',articleId:p.articleId,isSold:mockSold,revision:'a'.repeat(64)}}; const result=await dispatch(p);return {data:{...result.data,operation:'set',outcome:'applied',articleId:p.articleId,requestId:p.requestId,isSold:p.desiredIsSold,revision:null}}; });
  menu = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined); alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => { mockRemovalClient?.clear(); mockRemovalClient = null; jest.restoreAllMocks(); });
function choose(label: string) {
  const [options, callback] = menu.mock.calls.at(-1)! as [{ options: string[] }, (index: number) => void];
  callback(options.options.findIndex(text => text.includes(label)));
}
it('a captured owner menu cannot dispatch after same UID changes generation without rerender', async () => {
  const { result } = renderHook(() => harness()); act(() => result.current.handleMoreOptions()); session('A', 3);
  act(() => choose('Remettre')); expect(dispatch).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
});
it('late toggle after actual dispatch cannot flip another article or emit success', async () => {
  let release: (value: unknown) => void = () => undefined; dispatch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const { result } = renderHook(() => harness()); await act(async () => { result.current.handleMoreOptions(); choose('Remettre'); });
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ operation: 'set', articleId: 'article-A', desiredIsSold: false })));
  act(() => result.current.setCurrent(article('article-B'))); await act(async () => release({ data: { success: true } }));
  expect(result.current.current?.id).toBe('article-B'); expect(result.current.current?.isSold).toBe(true);
  expect(mockRead).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled(); expect(mockTrack.mock.calls.some(([name, data]) => name === 'article_sold_toggled' && data.success)).toBe(false);
});
it('same UID generation change after offer dispatch prevents navigation, error and success adoption', async () => {
  let release: () => void = () => undefined; mockOffer.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve('receipt'); }));
  const { result } = renderHook(() => harness({ initial: article('article-A', 'seller', false) }));
  const pending = result.current.handleMeetupOfferSubmit(35, 'Saisie', spot); const observed = pending.catch(error => error);
  await waitFor(() => expect(mockOffer).toHaveBeenCalledTimes(1)); session('A', 3); release();
  expect(await observed).toMatchObject({ code: 'client/stale-operation' }); expect(mockPush).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
  expect(mockTrack.mock.calls.some(([name]) => name === 'offer_sent' || name === 'offer_send_failed')).toBe(false);
});
it('article replacement while the chat is read prevents the subsequent proposal call', async () => {
  let release: (value: { id: string }) => void = () => undefined; mockChat.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const { result } = renderHook(() => harness({ initial: article('article-A', 'seller', false) }));
  const pending = result.current.handleMeetupOfferSubmit(35, 'Saisie', spot); const observed = pending.catch(error => error);
  await waitFor(() => expect(mockChat).toHaveBeenCalledTimes(1)); act(() => result.current.setCurrent(article('article-B', 'seller', false)));
  release({ id: 'chat-A' }); expect(await observed).toMatchObject({ code: 'client/stale-operation' }); expect(mockOffer).not.toHaveBeenCalled(); expect(mockPush).not.toHaveBeenCalled();
});
it('the first proposal captures its location before the chat await', async () => {
  let release: (value: { id: string }) => void = () => undefined; mockChat.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const { result } = renderHook(() => harness({ initial: article('article-A', 'seller', false) })); const location = { ...spot, neighborhood: { ...spot.neighborhood } };
  const pending = result.current.handleMeetupOfferSubmit(35, 'Saisie', location); location.name = 'Changed'; await waitFor(() => expect(mockChat).toHaveBeenCalledTimes(1)); release({ id: 'chat-A' }); await pending;
  expect(mockOffer.mock.calls[0][4].name).toBe('Lieu'); expect(mockPush).toHaveBeenCalledWith('/chat/chat-A');
});
it('Mes articles old response never mutates a new account cache', async () => {
  let release: (value: unknown) => void = () => undefined; dispatch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const screen = render(<MyArticlesScreen />); await act(async () => { fireEvent.press(screen.getByTestId('icon-ellipsis-vertical')); choose('Remettre'); });
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ operation: 'set', articleId: 'article-A', desiredIsSold: false }))); session('B'); mockArticles = [article('article-B', 'B')];
  await screen.rerenderAsync(<MyArticlesScreen />); expect(screen.getByText('article-B')).toBeTruthy(); await act(async () => release({ data: { success: true } }));
  expect(mockSetCache).not.toHaveBeenCalled(); expect(mockRead).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
});
it('Mes articles displays new account actions with fresh callbacks after switching', async () => {
  const screen = render(<MyArticlesScreen />); session('B'); mockArticles = [article('article-B', 'B')]; await screen.rerenderAsync(<MyArticlesScreen />);
  expect(screen.getByText('article-B')).toBeTruthy(); await act(async () => { fireEvent.press(screen.getByTestId('icon-ellipsis-vertical')); choose('Remettre'); });
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ operation: 'set', articleId: 'article-B', desiredIsSold: false })));
  await waitFor(() => expect(mockSetCache).toHaveBeenCalled()); expect(JSON.stringify(mockSetCache.mock.calls[0][0])).toContain('B');
});

it('V2 article adopts its displayed receipt and permits a fresh nominal toggle of the same article', async () => {
 mockSold = true; mockRead.mockImplementation(async id => article(id, 'A', mockSold)); dispatch.mockImplementation(async () => { mockSold = !mockSold; return { data: { success: true } }; });
 const { result } = renderHook(() => harness()); await act(async () => { result.current.handleMoreOptions(); choose('Remettre'); });
 await waitFor(() => expect(result.current.current?.isSold).toBe(false)); expect(mockTrack.mock.calls.filter(([name]) => name === 'article_sold_toggled')).toHaveLength(1);
 await act(async () => { result.current.handleMoreOptions(); choose('vendu'); }); const confirm = (alert.mock.calls.at(-1)![2] as { style?: string; onPress?: () => void }[]).find(button => button.style !== 'cancel')!.onPress!;
 act(() => confirm()); await waitFor(() => expect(result.current.current?.isSold).toBe(true)); expect(dispatch).toHaveBeenCalledTimes(2);
 expect(mockTrack.mock.calls.filter(([name]) => name === 'article_sold_toggled')).toHaveLength(2);
});
it('V2 Mes articles applies current cache before acknowledgement and a fresh action remains usable', async () => {
 mockSold = true; mockRead.mockImplementation(async id => article(id, 'A', mockSold)); dispatch.mockImplementation(async () => { mockSold = !mockSold; return { data: { success: true } }; });
 mockSetCache.mockImplementation((_key: readonly string[], apply: (old: Article[]) => Article[]) => { mockArticles = apply(mockArticles); return mockArticles; });
 const screen = render(<MyArticlesScreen />); await act(async () => { fireEvent.press(screen.getByTestId('icon-ellipsis-vertical')); choose('Remettre'); });
 await waitFor(() => expect(mockArticles[0].isSold).toBe(false)); await screen.rerenderAsync(<MyArticlesScreen />);
 await act(async () => { fireEvent.press(screen.getByTestId('icon-ellipsis-vertical')); choose('vendu'); });
 const confirm = (alert.mock.calls.at(-1)![2] as { style?: string; onPress?: () => void }[]).find(button => button.style !== 'cancel')!.onPress!;
 act(() => confirm()); await waitFor(() => expect(mockArticles[0].isSold).toBe(true)); expect(dispatch).toHaveBeenCalledTimes(2);
 expect(mockTrack.mock.calls.filter(([name]) => name === 'article_sold_toggled')).toHaveLength(2);
});
it('V2 Mes articles cannot claim adoption or success when the current cache no longer contains the article', async () => {
 mockSetCache.mockImplementation((_key: readonly string[], apply: (old: Article[]) => Article[]) => apply([]));
 const screen = render(<MyArticlesScreen />); await act(async () => { fireEvent.press(screen.getByTestId('icon-ellipsis-vertical')); choose('Remettre'); });
 await waitFor(() => expect(mockRead).toHaveBeenCalled()); await waitFor(() => expect(mockSetCache).toHaveBeenCalled());
 expect(mockTrack.mock.calls.filter(([name]) => name === 'article_sold_toggled')).toEqual([]);
 expect(JSON.parse((await AsyncStorage.getItem(getEnvironmentStorageKey('article-sold:v1:A:article-A')))!)).toHaveProperty('receiptId');
});

function openRemoval(entry: 'my_articles' | 'article_detail') {
  if (entry === 'my_articles') {
    const screen = render(<MyArticlesScreen />);
    act(() => fireEvent.press(screen.getByTestId('icon-ellipsis-vertical')));
  } else {
    const { result } = renderHook(() => harness());
    act(() => result.current.handleMoreOptions());
  }
  act(() => choose('Supprimer'));
  return (alert.mock.calls.at(-1)![2] as { text: string; onPress?: () => Promise<void> }[])
    .find(button => button.text === 'Retirer')!.onPress!;
}

function setupRemovalCache() {
  const { QueryClient } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  mockRemovalClient = client;
  client.setQueryData(['articles', 'user', 'A'], mockArticles);
  client.setQueryData(['home', 'new-arrivals'], mockArticles);
  client.setQueryData(['home', 'discover'], { pages: [{ articles: mockArticles, lastDocId: 'cursor' }], pageParams: [null] });
  return client;
}

it.each(['my_articles', 'article_detail'] as const)('%s removal confirmation purges the actual QueryClient Home cache', async entry => {
  const client = setupRemovalCache();
  const confirm = openRemoval(entry);
  await act(async () => { await confirm(); });
  expect(mockDelete).toHaveBeenCalledWith('article-A');
  expect(client.getQueryData(['articles', 'user', 'A'])).toEqual([]);
  expect(client.getQueryData(['home', 'new-arrivals'])).toEqual([]);
  expect(client.getQueryData(['home', 'discover'])).toEqual({ pages: [{ articles: [], lastDocId: 'cursor' }], pageParams: [null] });
  expect(client.getQueryState(['home', 'new-arrivals'])?.isInvalidated).toBe(true);
  expect(mockTrack).toHaveBeenCalledWith('article_deleted', expect.objectContaining({ article_id: 'article-A', outcome: 'success', source: entry }));
});

it.each(['my_articles', 'article_detail'] as const)('%s obsolete withdrawal response leaves the replacement account cache unchanged', async entry => {
  const client = setupRemovalCache();
  let finish!: () => void;
  mockDelete.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const confirm = openRemoval(entry);
  let pending!: Promise<void>;
  act(() => { pending = confirm(); });
  expect(mockDelete).toHaveBeenCalledTimes(1);
  session('B', 2);
  const replacement = [article('article-B', 'B')];
  client.setQueryData(['home', 'new-arrivals'], replacement);
  const replacementCache = client.getQueryData(['home', 'new-arrivals']);
  await act(async () => { finish(); await pending; });
  expect(client.getQueryData(['home', 'new-arrivals'])).toBe(replacementCache);
  expect(client.getQueryState(['home', 'new-arrivals'])?.isInvalidated).toBe(false);
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockTrack.mock.calls.some(([name]) => name === 'article_deleted')).toBe(false);
});
