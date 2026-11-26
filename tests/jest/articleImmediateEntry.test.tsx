import { act, renderHook } from '@testing-library/react-native';
import { auth } from '@/config/firebaseConfig';
import type { Article } from '@/types';

const mockPush = jest.fn();
const mockPresent = jest.fn();
const mockAdmission = jest.fn();
const mockRecovery = jest.fn();
let mockUid = 'buyer';
let mockGeneration = 1;
let mockUser = {id: 'buyer'};
const mockRouter = {push: mockPush};
const mockRequireAuth = (callback: () => void) => callback();
const mockOfferRef = {current: {present: mockPresent}};
const mockReportRef = {current: null};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (callback: () => void | (() => void)) => {const React = require('react'); React.useEffect(callback, [callback]);},
}));
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (state: {user: {id: string}}) => unknown) => selector({user: mockUser}), {
    getState: () => ({authenticatedUid: mockUid, user: mockUser}),
  }),
}));
jest.mock('@tanstack/react-query', () => ({useQueryClient: () => ({invalidateQueries: jest.fn()})}));
jest.mock('@/hooks/useAuthRequired', () => ({useRequireAuth: () => ({requireAuth: mockRequireAuth})}));
jest.mock('@/hooks/useFavorites', () => ({useFavorites: () => ({toggleFavorite: jest.fn(), isFavorite: jest.fn()}), favoritesKeys: {all: []}}));
jest.mock('@/hooks/useMeetupProposalRecovery', () => ({useMeetupProposalRecovery: () => mockRecovery}));
jest.mock('@/hooks/useTradeAdmissionError', () => ({useTradeAdmissionError: () => jest.fn()}));
jest.mock('@/services/newSaleAdmission', () => ({assertNewSaleAdmission: (...args: unknown[]) => mockAdmission(...args), assertNewProposalAdmission: jest.fn()}));
jest.mock('@/services/articlesService', () => ({ArticlesService: {}}));
jest.mock('@/services/chatService', () => ({ChatService: {}}));
jest.mock('@/services/chat/offers', () => ({acknowledgeMeetupProposal: jest.fn()}));
jest.mock('@/services/swapService', () => ({GENERALIST_ZONE_ID: 'zone'}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
import {useArticleActions} from '@/features/article/hooks/useArticleActions';

const article = {id: 'listing', sellerId: 'seller', price: 20, isActive: true, isSold: false,
  isHandDelivery: true, isShipping: true, title: 'Veste', images: []} as unknown as Article;
function screen() {
  return useArticleActions({article, setArticle: jest.fn(), makeOfferModalRef: mockOfferRef, reportBottomSheetRef: mockReportRef});
}
beforeEach(() => {
  mockUid = 'buyer'; mockGeneration = 1; mockUser = {id: 'buyer'};
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'buyer'};
  mockAdmission.mockImplementation(() => new Promise(() => undefined));
  mockRecovery.mockImplementation(() => new Promise(() => undefined));
});
it('opens checkout synchronously without waiting on eligibility or storage reads and locks repeated taps', () => {
  const {result} = renderHook(screen);
  act(() => {result.current.handleBuy(); result.current.handleBuy();});
  expect(mockPush).toHaveBeenCalledTimes(1);
  expect(mockPush).toHaveBeenCalledWith({pathname: '/checkout', params: {articleId: 'listing'}});
  expect(mockAdmission).not.toHaveBeenCalled(); expect(mockRecovery).not.toHaveBeenCalled();
});
it('presents the offer form synchronously while remote eligibility and recovery remain deferred to submit', () => {
  const {result} = renderHook(screen);
  act(() => {result.current.handleMakeOffer();});
  expect(mockPresent).toHaveBeenCalledTimes(1);
  expect(mockAdmission).not.toHaveBeenCalled(); expect(mockRecovery).not.toHaveBeenCalled();
});
it('rejects an opener retained from an earlier session before opening a new buyer interface', () => {
  const {result} = renderHook(screen);
  const buy = result.current.handleBuy, offer = result.current.handleMakeOffer;
  mockGeneration++;
  act(() => {buy(); offer();});
  expect(mockPush).not.toHaveBeenCalled(); expect(mockPresent).not.toHaveBeenCalled();
});

it.each(['buy', 'offer'] as const)('uses the committed article epoch for %s after a cache object replacement with stable wrappers', action => {
  const next = {...article, title: 'Autre veste'};
  let cacheArticle = article;
  const isArticleCurrent = (expected: Article) => expected === cacheArticle;
  const {result, rerender} = renderHook(({item}: {item: Article}) => useArticleActions({article: item,
    setArticle: jest.fn(), isArticleCurrent, makeOfferModalRef: mockOfferRef, reportBottomSheetRef: mockReportRef}), {initialProps: {item: article}});
  cacheArticle = next;
  rerender({item: next});
  act(() => {if (action === 'buy') result.current.handleBuy(); else result.current.handleMakeOffer();});
  if (action === 'buy') expect(mockPush).toHaveBeenCalledWith({pathname: '/checkout', params: {articleId: 'listing'}});
  else expect(mockPresent).toHaveBeenCalledTimes(1);
  expect(mockAdmission).not.toHaveBeenCalled(); expect(mockRecovery).not.toHaveBeenCalled();
});

it('still refuses entry when the cached source was replaced before the screen received it', () => {
  const {result} = renderHook(() => useArticleActions({article, setArticle: jest.fn(), isArticleCurrent: () => false,
    makeOfferModalRef: mockOfferRef, reportBottomSheetRef: mockReportRef}));
  act(() => {result.current.handleBuy(); result.current.handleMakeOffer();});
  expect(mockPush).not.toHaveBeenCalled(); expect(mockPresent).not.toHaveBeenCalled();
});

it('rejects retained openers after article A → B → A while allowing the current committed opener', () => {
  const next = {...article, title: 'Autre veste'};
  let cacheArticle = article;
  const isArticleCurrent = (expected: Article) => expected === cacheArticle;
  const {result, rerender} = renderHook(({item}: {item: Article}) => useArticleActions({article: item,
    setArticle: jest.fn(), isArticleCurrent, makeOfferModalRef: mockOfferRef, reportBottomSheetRef: mockReportRef}), {initialProps: {item: article}});
  const oldBuy = result.current.handleBuy, oldOffer = result.current.handleMakeOffer;
  cacheArticle = next; rerender({item: next});
  cacheArticle = article; rerender({item: article});
  act(() => {oldBuy(); oldOffer();});
  expect(mockPush).not.toHaveBeenCalled(); expect(mockPresent).not.toHaveBeenCalled();
  act(() => {result.current.handleBuy();});
  expect(mockPush).toHaveBeenCalledTimes(1);
});
