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
let mockUid = 'A'; let mockGeneration = 1; let mockArticles: Article[] = [];
const mockRead = jest.fn(); const mockDelete = jest.fn(); const mockChat = jest.fn(); const mockOffer = jest.fn();
const mockPush = jest.fn(); const mockBack = jest.fn(); const mockTrack = jest.fn(); const mockSetCache = jest.fn(); const mockInvalidate = jest.fn();
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (state: { user: { id: string }; authenticatedUid: string }) => unknown) => selector({identityUser: { id: mockUid }, identityError: false, isLoading: false,  user: { id: mockUid }, authenticatedUid: mockUid }), {
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
jest.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mockArticles, isLoading: false, isRefetching: false, isError: false, refetch: jest.fn() }), useQueryClient: () => ({ setQueryData: mockSetCache, invalidateQueries: mockInvalidate }) }));
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
  jest.clearAllMocks(); await AsyncStorage.clear(); session('A', 1); mockArticles = [article()];
  mockRead.mockImplementation(async (id: string) => article(id, mockUid, false)); mockChat.mockResolvedValue({ id: 'chat-A' }); mockOffer.mockResolvedValue('receipt-A'); mockDelete.mockResolvedValue(undefined);
  dispatch = jest.fn(async () => ({ data: { success: true } })); (httpsCallable as jest.Mock).mockImplementation(() => dispatch);
  menu = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => undefined); alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
function choose(label: string) {
  const [options, callback] = menu.mock.calls.at(-1)! as [{ options: string[] }, (index: number) => void];
  callback(options.options.findIndex(text => text.includes(label)));
}

it('V3-CLONE01 artificial malformed spot rejects before IO and releases the slot for a valid intention',async()=>{const {result}=renderHook(()=>harness({initial:article('article-A','seller',false)}));await expect(result.current.handleMeetupOfferSubmit(23,'Artificiel',undefined as unknown as MeetupSpot)).rejects.toThrow();expect(mockChat).not.toHaveBeenCalled();mockChat.mockResolvedValue({id:'chat-A'}); mockOffer.mockResolvedValue('receipt-A'); await result.current.handleMeetupOfferSubmit(23,'Valide',spot); expect(mockChat).toHaveBeenCalledTimes(1); expect(mockOffer).toHaveBeenCalledTimes(1);});
