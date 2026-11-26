import {getEnvironmentStorageKey} from '@/config/firebaseEnvironment';
// The provider IO supplies current positive foundations; session/admission guards stay real.
jest.mock('@/services/eligibilityService', () => ({ EligibilityService: { getMine: jest.fn(async () => ({ decisions: Object.fromEntries(['buy', 'sell', 'new_paid_shipping'].map(scope => [scope, { scope, allowed: true, status: 'allowed', reasons: [], messages: [], policyVersion: 'fixture-policy', evaluationStage: 'foundations' }])) })) } }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import { doc } from 'firebase/firestore';
let mockUseActualProposal = false;
const mockAck = jest.fn();
jest.mock('@/services/chat/offers', () => { const actual = jest.requireActual<typeof import('@/services/chat/offers')>('@/services/chat/offers'); return { ...actual, acknowledgeMeetupProposal: (messageId: string, assertContext: () => void) => { mockAck(messageId, assertContext); if (mockUseActualProposal) actual.acknowledgeMeetupProposal(messageId, assertContext); } }; });
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
  useRouter: () => require('expo-router').router,
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),

 useLocalSearchParams: () => ({ id: mockChatId }), Redirect: require('react-native').View,
 useFocusEffect: (callback: () => (() => void) | undefined) => { const React = require('react'); React.useEffect(() => { if (mockFocused) return callback(); }, [callback, mockFocused]); },
}));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => 6, useAuthStore: Object.assign((selector: (value: { authenticatedUid: string; user: { id: string }; identityUser?: {id:string}; identityError?: boolean; isLoading?: boolean }) => unknown) => selector({identityUser: { id: 'reviewer' }, identityError: false, isLoading: false,  authenticatedUid: 'reviewer', user: { id: 'reviewer' } }), { getState: () => ({identityUser: { id: 'reviewer' }, identityError: false, isLoading: false,  authenticatedUid: 'reviewer', user: { id: 'reviewer' } }) }) }));
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
let mockModalRef: { current: { present: () => void; dismiss: () => void } | null };
let mockModalContext: import('@/features/offers/components/MakeOfferModal/types').MakeOfferContext;
let mockSheetChange: (index: number) => void;
let mockConfirm: { onSubmitMeetup: (amount: number, message: string, spot: MeetupSpot, assertIntention?: () => void) => Promise<void>; presentationKey?: number };
jest.mock('@/features/offers/components/MakeOfferModal', () => {
 const React = require('react'); const View = require('react-native').View; const Actual = jest.requireActual('@/features/offers/components/MakeOfferModal').default;
 return React.forwardRef((props: typeof mockModalProps, ref: typeof mockModalRef) => { React.useLayoutEffect(() => { mockModalRef = ref; mockModalProps = props; }, [props, ref]); return React.createElement(View, { testID: 'parent-modal', articleId: props.articleId }, React.createElement(Actual, { ...props, ref })); });
});
jest.mock('@gorhom/bottom-sheet', () => {
 const React = require('react'); const View = require('react-native').View;
 return { __esModule: true, default: React.forwardRef((props: { children: React.ReactNode; onChange: (index: number) => void }, ref: unknown) => { mockSheetChange = props.onChange; React.useImperativeHandle(ref, () => ({ expand: jest.fn(), close: jest.fn() })); return React.createElement(View, null, props.children); }), BottomSheetBackdrop: View, BottomSheetView: View, BottomSheetScrollView: View };
});
jest.mock('@/features/offers/components/MakeOfferModal/ConfirmStep', () => ({ __esModule: true, default: (props: typeof mockConfirm) => { const React = require('react'); const View = require('react-native').View; React.useLayoutEffect(() => { mockConfirm = props; }, [props]); return React.createElement(View); } }));
jest.mock('@/features/offers/components/MakeOfferModal/OfferStep', () => ({ __esModule: true, default: (props: { context: typeof mockModalContext }) => { const React = require('react'); const View = require('react-native').View; React.useLayoutEffect(() => { mockModalContext = props.context; }, [props]); return React.createElement(View); } }));
jest.mock('@/features/offers/components/MakeOfferModal/LocationStep', () => ({ __esModule: true, default: require('react-native').View }));
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
beforeEach(async () => {
 await AsyncStorage.clear(); mockUseActualProposal = false; jest.clearAllMocks(); mockFocused = true; mockChatId = 'original-chat'; mockArticleId = 'original-parent-article'; (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'reviewer' }; jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
it('V2-CHAIN01 actual parent plus actual modal suppress effects after dismissal without changing route IDs', async () => {
 let release!: () => void; mockSend.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve('chain-receipt'); }));
 render(<ChatScreen />); act(() => mockModalRef.current!.present()); act(() => { mockModalContext.actions.setOfferAmount('23'); mockModalContext.actions.setSelectedSpot(spot); mockModalContext.actions.setStep('confirm'); });
 let pending!: Promise<void>; act(() => { pending = mockConfirm.onSubmitMeetup(23, 'Saisie', spot); }); const observed = pending.catch(error => error);
 await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
 act(() => { mockModalRef.current!.dismiss(); mockSheetChange(-1); });
 await act(async () => { release(); await observed; });
 expect(mockAck).not.toHaveBeenCalled(); expect(mockTrack.mock.calls.filter(([name]) => name === 'offer_sent')).toEqual([]); expect(Haptics.notificationAsync).not.toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
});
it('V2-CHAIN02 actual modal carries a distinct presentation to ConfirmStep even when article and form display repeat', () => {
 render(<ChatScreen />); act(() => mockModalRef.current!.present()); act(() => { mockModalContext.actions.setOfferAmount('23'); mockModalContext.actions.setSelectedSpot(spot); mockModalContext.actions.setStep('confirm'); }); const first = mockConfirm.presentationKey;
 act(() => { mockModalRef.current!.dismiss(); mockSheetChange(-1); }); act(() => mockModalRef.current!.present()); act(() => { mockModalContext.actions.setOfferAmount('23'); mockModalContext.actions.setSelectedSpot(spot); mockModalContext.actions.setStep('confirm'); });
 expect(mockConfirm.presentationKey).not.toBe(first);
});
it('V2-CHAIN03 current parent plus actual modal remains nominally actionable and recognizes a receipt', async () => {
 mockSend.mockResolvedValue('chain-current'); render(<ChatScreen />); act(() => mockModalRef.current!.present()); act(() => { mockModalContext.actions.setOfferAmount('23'); mockModalContext.actions.setSelectedSpot(spot); mockModalContext.actions.setStep('confirm'); });
 await act(async () => mockConfirm.onSubmitMeetup(23, 'Saisie', spot)); expect(mockAck).toHaveBeenCalledWith('chain-current', expect.any(Function)); expect(mockTrack.mock.calls.filter(([name]) => name === 'offer_sent')).toHaveLength(1);
});

it('V2-CHAIN04 actual modal-parent-service persists an unadopted closed receipt, replays exact key and permits a fresh intention', async () => {
 mockUseActualProposal = true; let nextId = 0; (doc as jest.Mock).mockImplementation(() => ({ id: `chain-request-${++nextId}` }));
 const sent: Record<string, unknown>[] = []; let release!: () => void;
 const dispatch = jest.fn(async (value: Record<string, unknown>) => { sent.push(value); if (sent.length === 1) await new Promise<void>(resolve => { release = resolve; }); return { data: { success: true, messageId: value.requestId } }; });
 (httpsCallable as jest.Mock).mockImplementation(() => dispatch);
 const actual = jest.requireActual<typeof import('@/services/chat/meetup')>('@/services/chat/meetup'); mockSend.mockImplementation(actual.sendMeetupOffer);
 render(<ChatScreen />); act(() => mockModalRef.current!.present()); act(() => { mockModalContext.actions.setOfferAmount('23'); mockModalContext.actions.setSelectedSpot(spot); mockModalContext.actions.setStep('confirm'); });
 let first!: Promise<void>; act(() => { first = mockConfirm.onSubmitMeetup(23, 'Saisie', spot); }); const observed = first.catch(error => error);
 await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1)); const key = getEnvironmentStorageKey('meetup-proposal:v1:reviewer:original-chat'); expect(await AsyncStorage.getItem(key)).toContain('chain-request-1');
 act(() => mockModalRef.current!.dismiss()); await act(async () => { release(); await observed; });
 expect(mockAck).not.toHaveBeenCalled(); expect(mockTrack.mock.calls.filter(([name]) => name === 'offer_sent')).toEqual([]); expect(await AsyncStorage.getItem(`${key}:receipts`)).toContain('chain-request-1');
 act(() => mockModalRef.current!.present()); act(() => { mockModalContext.actions.setOfferAmount('23'); mockModalContext.actions.setSelectedSpot(spot); mockModalContext.actions.setStep('confirm'); });
 await act(async () => mockConfirm.onSubmitMeetup(23, 'Saisie', spot)); expect(sent[1]).toEqual(sent[0]); expect(mockAck).toHaveBeenCalledTimes(1);
 await act(async () => mockConfirm.onSubmitMeetup(23, 'Saisie', spot)); expect(sent[2].requestId).not.toBe(sent[0].requestId); expect(mockTrack.mock.calls.filter(([name]) => name === 'offer_sent')).toHaveLength(2);
});
it('V2-CHAIN05 close and reopen in one render batch invalidates the captured submit before IO', async () => {
 render(<ChatScreen />); act(() => mockModalRef.current!.present()); act(() => { mockModalContext.actions.setOfferAmount('23'); mockModalContext.actions.setSelectedSpot(spot); mockModalContext.actions.setStep('confirm'); }); const old = mockConfirm.onSubmitMeetup;
 let pending!: Promise<void>; act(() => { mockModalRef.current!.dismiss(); mockModalRef.current!.present(); pending = old(23, 'Saisie', spot); }); await expect(pending).rejects.toThrow(); expect(mockSend).not.toHaveBeenCalled();
});
it('V2-CHAIN06 caller intent changed while the receipt waits suppresses parent effects even if modal and route remain current', async () => {
 let release!: () => void; let intentCurrent = true; mockSend.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve('intent-receipt'); }));
 render(<ChatScreen />); act(() => mockModalRef.current!.present()); act(() => { mockModalContext.actions.setOfferAmount('23'); mockModalContext.actions.setSelectedSpot(spot); mockModalContext.actions.setStep('confirm'); });
 let pending!: Promise<void>; act(() => { pending = mockConfirm.onSubmitMeetup(23, 'Saisie', spot, () => { if (!intentCurrent) throw new Error('intent replaced'); }); }); const observed = pending.catch(error => error);
 await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1)); intentCurrent = false; await act(async () => { release(); await observed; });
 expect(mockAck).not.toHaveBeenCalled(); expect(mockTrack.mock.calls.filter(([name]) => name === 'offer_sent')).toEqual([]);
});
