// B3: explicit current foundations fixture; the existing parent/service currentness checks remain real.
jest.mock('@/services/eligibilityService', () => ({ EligibilityService: { getMine: jest.fn(async () => ({ decisions: Object.fromEntries(['buy', 'sell', 'new_paid_shipping'].map(scope => [scope, { scope, allowed: true, status: 'allowed', reasons: [], messages: [], policyVersion: 'fixture-policy', evaluationStage: 'foundations' }])) })) } }));
const mockAck = jest.fn();
jest.mock('@/services/chat/offers', () => ({ acknowledgeMeetupProposal: (...args: unknown[]) => mockAck(...args), readMeetupProposalRecovery: jest.fn(async () => null) }));
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { MeetupSpot } from '@/types';
let mockChatId = 'original-chat'; let mockArticleId = 'original-parent-article'; let mockFocused = true;
let mockModalProps: { articleId: string; onMeetupOfferSubmit: (amount: number, message: string, spot: MeetupSpot) => Promise<void> };
const mockSend = jest.fn(); const mockTrack = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),

 useRouter: () => ({ push: jest.fn() }),
 useLocalSearchParams: () => ({ id: mockChatId }), Redirect: require('react-native').View,
 useFocusEffect: (callback: () => (() => void) | undefined) => { const React = require('react'); React.useEffect(() => { if (mockFocused) return callback(); }, [callback, mockFocused]); },
}));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => 6, useAuthStore: Object.assign((selector: (state: unknown) => unknown) => selector(require('@/store/authStore').useAuthStore.getState()), { getState: () => ({ authenticatedUid: 'reviewer', user: { id: 'reviewer' }, identityUser: { id: 'reviewer', isActive: true }, identityError: false, isLoading: false }) }) }));
jest.mock('@/hooks/useAuth', () => ({
  useAuthenticatedUid: () => require('@/config/firebaseConfig').auth.currentUser?.uid ?? null,
  useAuthenticatedIdentity: () => { const user = require('@/hooks/useAuth').useUser(); return user?.id === require('@/config/firebaseConfig').auth.currentUser?.uid ? user : null; },
  useAuthenticatedSession: () => ({ uid: require('@/config/firebaseConfig').auth.currentUser?.uid ?? null, identity: require('@/hooks/useAuth').useAuthenticatedIdentity() }),
  useAuthGuardSession: () => ({ normalUser: require('@/hooks/useAuth').useUser(), identity: require('@/hooks/useAuth').useAuthenticatedIdentity(), isAuthLoading: false }),
 useUser: () => ({ id: 'reviewer' }) }));
jest.mock('@/features/chat/hooks/useChat', () => ({ useChat: () => ({
 chat: { id: mockChatId, participants: ['reviewer', 'seller'], participantsInfo: [{ userId: 'reviewer' }, { userId: 'seller' }], sellerId: 'seller', articleId: mockArticleId, articleTitle: 'Même présentation', articlePrice: 40 },
 messages: [], isLoading: false, error: null, isSending: false, sendMessage: jest.fn(), sendImage: jest.fn(), acceptOffer: jest.fn(), rejectOffer: jest.fn(), retry: jest.fn(),
}) }));
jest.mock('@/features/chat', () => {
 const View = require('react-native').View; return { ChatArticleBar: View, ChatEmptyState: View, ChatErrorState: View, ChatHeader: View, ChatInputBar: View, ChatLoadingSkeleton: View, useChatModeration: () => ({ handleMoreOptions: jest.fn() }) };
});
jest.mock('@/features/chat/components/ChatBubble', () => require('react-native').View);
jest.mock('@/features/offers/components/OfferBubble', () => require('react-native').View);
jest.mock('@/components/ReportBottomSheet', () => {
 const React = require('react'); const View = require('react-native').View; return React.forwardRef((_props: unknown, _ref: unknown) => React.createElement(View));
});
jest.mock('@/features/offers/components/MakeOfferModal', () => {
 const React = require('react'); const View = require('react-native').View;
 return React.forwardRef((props: typeof mockModalProps, ref: unknown) => { React.useLayoutEffect(() => { mockModalProps = props; }, [props]); React.useImperativeHandle(ref, () => ({ present: jest.fn(), dismiss: jest.fn() })); return React.createElement(View, { testID: 'parent-modal', articleId: props.articleId }); });
});
jest.mock('@/features/orders', () => ({ ShipmentTracking: require('react-native').View, ChatTransactionHistory: require('react-native').View }));
jest.mock('@/hooks/useChatTransactions', () => ({ useChatTransactions: () => ({ transaction: null, transactions: [], isLoading: false, isFetching: false, error: null, refresh: jest.fn() }) }));
jest.mock('@/features/notifications/hooks/useNotificationSetup', () => ({ setActiveChatId: jest.fn() }));
jest.mock('@/hooks/useUserProfile', () => ({ useUserProfile: () => ({ data: {} }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({ data: queryKey[0] === 'blockedUsers' ? [] : { id: mockArticleId, title: 'Même présentation', price: 40, sellerId: 'seller', isSold: false, isActive: true, images: [] } }) }));
jest.mock('@/services/articlesService', () => ({ ArticlesService: { getArticleById: jest.fn() } }));
jest.mock('@/services/chatService', () => ({ ChatService: { sendMeetupOffer: (...args: unknown[]) => mockSend(...args) } }));
jest.mock('@/services/moderationService', () => ({ ModerationService: { getBlockedUsers: jest.fn() } }));
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('@/components/ui/Skeleton', () => ({ SkeletonText: require('react-native').View }));
import ChatScreen from '@/app/chat/[id]';
import { auth } from '@/config/firebaseConfig';
const spot: MeetupSpot = { name: 'Lieu valide', category: 'metro', neighborhood: { id: 'review-area', name: 'Quartier', borough: 'Montréal' } };
beforeEach(() => {
 jest.clearAllMocks(); mockFocused = true; mockChatId = 'original-chat'; mockArticleId = 'original-parent-article'; (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'reviewer' }; jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
it('R-P01 true chat parent handler cannot emit old-dossier success before its modal wrapper rejects adoption', async () => {
 let release!: () => void; mockSend.mockImplementationOnce(() => new Promise<string>(r => { release = () => r('known-receipt'); }));
 const screen = render(<ChatScreen />); expect(screen.getByTestId('parent-modal').props.articleId).toBe('original-parent-article');
 const old = mockModalProps.onMeetupOfferSubmit; let pending!: Promise<void>; act(() => { pending = old(23, 'Saisie', spot).catch(error => error); });
 await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1)); expect(mockSend.mock.calls[0].slice(0, 4)).toEqual(['original-chat', 'reviewer', 'seller', 23]);
 mockChatId = 'replacement-chat'; mockArticleId = 'replacement-parent-article'; await screen.rerenderAsync(<ChatScreen />);
 expect(screen.getByTestId('parent-modal').props.articleId).toBe('replacement-parent-article'); expect(mockModalProps.onMeetupOfferSubmit).not.toBe(old);
 await act(async () => { release(); expect(await pending).toMatchObject({ code: 'client/stale-operation' }); });
 const success = mockTrack.mock.calls.filter(([name]) => name === 'offer_sent');
 console.info('R-P01 reached', { actualParentArticleId: mockModalProps.articleId, success, haptics: (Haptics.notificationAsync as jest.Mock).mock.calls });
 const successHaptic = (Haptics.notificationAsync as jest.Mock).mock.calls.some(c => c[0] === Haptics.NotificationFeedbackType.Success);
 expect({ success, successHaptic }).toEqual({ success: [], successHaptic: false });
});

it('V2-PARENT01 current parent receipt adopts before success and remains nominally actionable', async () => {
 mockSend.mockResolvedValue('current-receipt'); const screen = render(<ChatScreen />);
 await act(async () => mockModalProps.onMeetupOfferSubmit(23, 'Saisie', spot));
 expect(mockAck).toHaveBeenCalledWith('current-receipt', expect.any(Function)); expect(mockTrack.mock.calls.filter(([name]) => name === 'offer_sent')).toHaveLength(1);
 await act(async () => mockModalProps.onMeetupOfferSubmit(23, 'Saisie', spot)); expect(mockSend).toHaveBeenCalledTimes(2); screen.unmount();
});
it('V2-PARENT02 old parent callback cannot send after route IDs change, even with identical display fields', async () => {
 const screen = render(<ChatScreen />); const old = mockModalProps.onMeetupOfferSubmit;
 mockArticleId = 'replacement-parent-article'; await screen.rerenderAsync(<ChatScreen />);
 await expect(old(23, 'Saisie', spot)).rejects.toThrow(); expect(mockSend).not.toHaveBeenCalled(); expect(mockTrack).not.toHaveBeenCalled();
});
it('V2-PARENT03 parent cannot send before route focus and cannot adopt after blur without unmount', async () => {
 mockFocused = false; const screen = render(<ChatScreen />);
 await expect(mockModalProps.onMeetupOfferSubmit(23, 'Saisie', spot)).rejects.toThrow(); expect(mockSend).not.toHaveBeenCalled();
 mockFocused = true; await screen.rerenderAsync(<ChatScreen />); let release!: () => void; mockSend.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve('receipt'); }));
 let pending!: Promise<void>; act(() => { pending = mockModalProps.onMeetupOfferSubmit(23, 'Saisie', spot).catch(error => error); }); await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
 mockFocused = false; await screen.rerenderAsync(<ChatScreen />); await act(async () => { release(); expect(await pending).toMatchObject({ code: 'client/stale-operation' }); });
 expect(mockAck).not.toHaveBeenCalled(); expect(mockTrack.mock.calls.filter(([name]) => name === 'offer_sent')).toEqual([]); expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});
it('V2-PARENT04 parent freezes location before IO and displays current errors without success', async () => {
 let reject!: (error: Error) => void; mockSend.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })); render(<ChatScreen />);
 const mutable = { ...spot, neighborhood: { ...spot.neighborhood } }; let pending!: Promise<void>; act(() => { pending = mockModalProps.onMeetupOfferSubmit(23, 'Saisie', mutable); }); const observed = pending.catch(error => error);
 await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1)); mutable.name = 'modified'; expect(mockSend.mock.calls[0][4].name).toBe('Lieu valide');
 reject(new Error('Impossible : current refusal')); expect(await observed).toMatchObject({ message: 'Impossible : current refusal' }); expect(Alert.alert).toHaveBeenCalledWith('Erreur', 'Impossible : current refusal');
 expect(mockAck).not.toHaveBeenCalled(); expect(mockTrack.mock.calls.filter(([name]) => name === 'offer_sent')).toEqual([]);
});
