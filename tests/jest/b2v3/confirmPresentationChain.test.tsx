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
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert, Pressable } from 'react-native';
import ConfirmStep from '@/features/offers/components/MakeOfferModal/ConfirmStep';
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
 const React = require('react'); const View = require('react-native').View; const TextInput = require('react-native').TextInput;
 return { BottomSheetTextInput: TextInput, __esModule: true, default: React.forwardRef((props: { children: React.ReactNode; onChange: (index: number) => void }, ref: unknown) => { mockSheetChange = props.onChange; React.useImperativeHandle(ref, () => ({ expand: jest.fn(), close: jest.fn() })); return React.createElement(View, null, props.children); }), BottomSheetBackdrop: View, BottomSheetView: View, BottomSheetScrollView: View };
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
beforeEach(async () => {
 await AsyncStorage.clear(); mockUseActualProposal = false; jest.clearAllMocks(); mockFocused = true; mockChatId = 'original-chat'; mockArticleId = 'original-parent-article'; (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'reviewer' }; jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// FRESH reviewer cases. All three business steps are actual imports. Low UI leaves/IO remain simulated.
jest.mock('@shopify/flash-list', () => { const React=require('react');const View=require('react-native').View;return {FlashList:({data,renderItem}: {data: unknown[];renderItem:(item: {item: unknown})=>React.ReactNode})=>React.createElement(View,null,data.map((item,index)=>React.createElement(React.Fragment,{key:index},renderItem({item}))))}; });
let seq=0; let sent: Record<string,unknown>[]=[]; let leaf: jest.Mock;
function setupIO() {
 mockUseActualProposal=true;seq=0;sent=[];(doc as jest.Mock).mockImplementation(()=>({id:`independent-real-${++seq}`}));
 leaf=jest.fn(async(value:Record<string,unknown>)=>{sent.push(value);return {data:{success:true,messageId:value.requestId}};});
 (httpsCallable as jest.Mock).mockImplementation(()=>leaf);
 mockSend.mockImplementation(jest.requireActual<typeof import('@/services/chat/meetup')>('@/services/chat/meetup').sendMeetupOffer);
}
function fill(screen: ReturnType<typeof render>) {
 act(()=>mockModalRef.current!.present());
 fireEvent.changeText(screen.getByTestId('offer-amount-input'),'23');
 fireEvent.changeText(screen.getByPlaceholderText('Expliquez pourquoi vous faites cette offre...'),'Vraie saisie');
 fireEvent.press(screen.getByTestId('offer-step-continue'));
 expect(screen.getByText('Où voulez-vous vous rencontrer?')).toBeTruthy();
 fireEvent.press(screen.getByTestId('offer-location-to-arrange'));
 fireEvent.press(screen.getByTestId('offer-location-continue'));
 expect(screen.getByText('RÉCAPITULATIF')).toBeTruthy();
 return screen.UNSAFE_getByType(ConfirmStep).find(node=>node.props.testID==='offer-confirm-submit' && typeof node.props.onPress==='function').props.onPress as ()=>Promise<void>;
}
const proofKey=getEnvironmentStorageKey('meetup-proposal:v1:reviewer:original-chat:receipts');
it('I-CHAIN01 actual OfferStep LocationStep ConfirmStep modal parent and service: nominal receipt then new identical intention',async()=>{
 setupIO();const screen=render(<ChatScreen/>);let submit=fill(screen);
 await act(async()=>submit());expect(leaf).toHaveBeenCalledTimes(1);expect(sent[0]).toMatchObject({amount:23,message:'Vraie saisie',location:{toArrange:true}});
 expect(mockAck).toHaveBeenCalledTimes(1);expect(mockTrack.mock.calls.filter(([n])=>n==='offer_sent')).toHaveLength(1);expect(screen.queryByTestId('offer-confirm-submit')).toBeNull();
 submit=fill(screen);await act(async()=>submit());expect(sent[1].requestId).not.toBe(sent[0].requestId);expect(mockAck).toHaveBeenCalledTimes(2);
});
it('I-CHAIN02 actual steps dismiss during IO, exact recovery and next fresh intention remain actionable',async()=>{
 setupIO();let release!:()=>void;leaf.mockImplementationOnce(async(value:Record<string,unknown>)=>{sent.push(value);await new Promise<void>(r=>{release=r;});return {data:{success:true,messageId:value.requestId}};});
 const screen=render(<ChatScreen/>);const submit=fill(screen);let pending!:Promise<void>;act(()=>{pending=submit();});await waitFor(()=>expect(leaf).toHaveBeenCalledTimes(1));
 act(()=>mockModalRef.current!.dismiss());await act(async()=>{release();await pending;});expect(mockAck).not.toHaveBeenCalled();expect(mockTrack.mock.calls.filter(([n])=>n==='offer_sent')).toEqual([]);expect(Haptics.notificationAsync).not.toHaveBeenCalled();expect(await AsyncStorage.getItem(proofKey)).toContain('independent-real-1');
 const retry=fill(screen);await act(async()=>retry());expect(sent[1]).toEqual(sent[0]);expect(mockAck).toHaveBeenCalledTimes(1);
 const fresh=fill(screen);await act(async()=>fresh());expect(sent[2].requestId).not.toBe(sent[0].requestId);
});
it('I-CHAIN03 actual ConfirmStep callback closed and reopened BEFORE next render is silent before IO',async()=>{
 setupIO();const screen=render(<ChatScreen/>);const old=fill(screen);jest.clearAllMocks();
 await act(async()=>{mockModalRef.current!.dismiss();mockModalRef.current!.present();await old();});
 expect(leaf).not.toHaveBeenCalled();expect(mockAck).not.toHaveBeenCalled();expect(mockTrack.mock.calls.filter(([n])=>n==='offer_sent')).toEqual([]);
 expect(Haptics.notificationAsync).not.toHaveBeenCalled();expect(Alert.alert).not.toHaveBeenCalled();
});
it('I-CHAIN04 actual old ConfirmStep callback after dismissal RENDER is silent and fresh chain works',async()=>{
 setupIO();const screen=render(<ChatScreen/>);const old=fill(screen);act(()=>mockModalRef.current!.dismiss());jest.clearAllMocks();await act(async()=>old());
 expect(leaf).not.toHaveBeenCalled();expect(Haptics.notificationAsync).not.toHaveBeenCalled();expect(Alert.alert).not.toHaveBeenCalled();const fresh=fill(screen);await act(async()=>fresh());expect(leaf).toHaveBeenCalledTimes(1);
});
it('I-CHAIN05 actual current error retains all terms and releases locks for exact retry',async()=>{
 setupIO();leaf.mockRejectedValue(Object.assign(new Error('transport unknown'),{code:'functions/unavailable'}));const screen=render(<ChatScreen/>);let submit=fill(screen);await act(async()=>submit());
 expect(mockAck).not.toHaveBeenCalled();expect(screen.getByText('"Vraie saisie"')).toBeTruthy();expect(screen.UNSAFE_getByType(ConfirmStep).find(node=>node.props.testID==='offer-confirm-submit' && typeof node.props.onPress==='function').props.disabled).toBe(false);expect(Alert.alert).toHaveBeenCalledWith('Connexion interrompue',expect.any(String),expect.any(Array));
 leaf.mockImplementation(async(value:Record<string,unknown>)=>({data:{success:true,messageId:value.requestId}})); const priorCalls=leaf.mock.calls.length; submit=screen.UNSAFE_getByType(ConfirmStep).find(node=>node.props.testID==='offer-confirm-submit' && typeof node.props.onPress==='function').props.onPress;await act(async()=>submit());expect(leaf).toHaveBeenCalledTimes(priorCalls+1);expect(mockAck).toHaveBeenCalledTimes(1);expect(leaf.mock.calls[1][0]).toEqual(leaf.mock.calls[0][0]);
});
it('I-CHAIN06 actual steps first mount without focus blocks IO until real focus entry',async()=>{
 setupIO();mockFocused=false;const screen=render(<ChatScreen/>);let submit=fill(screen);await act(async()=>submit());expect(leaf).not.toHaveBeenCalled();expect(Alert.alert).not.toHaveBeenCalled();
 mockFocused=true;await screen.rerenderAsync(<ChatScreen/>);submit=screen.UNSAFE_getByType(ConfirmStep).find(node=>node.props.testID==='offer-confirm-submit' && typeof node.props.onPress==='function').props.onPress;await act(async()=>submit());expect(leaf).toHaveBeenCalledTimes(1);expect(mockAck).toHaveBeenCalledTimes(1);
});
it('I-CHAIN07 actual parent article A B A invalidates old confirmed terms and current real chain stays usable',async()=>{
 setupIO();const screen=render(<ChatScreen/>);const old=fill(screen);mockArticleId='replacement';await screen.rerenderAsync(<ChatScreen/>);mockArticleId='original-parent-article';await screen.rerenderAsync(<ChatScreen/>);jest.clearAllMocks();await act(async()=>old());expect(leaf).not.toHaveBeenCalled();expect(Alert.alert).not.toHaveBeenCalled();const fresh=fill(screen);await act(async()=>fresh());expect(leaf).toHaveBeenCalledTimes(1);
});
it('V3-CHAIN08 stale pre-render ConfirmStep stays silent and the fresh real form still submits',async()=>{
 setupIO();const screen=render(<ChatScreen/>);const old=fill(screen);jest.clearAllMocks();let beforeRendered=false;
 await act(async()=>{mockModalRef.current!.dismiss();mockModalRef.current!.present();await old();beforeRendered=screen.queryByTestId('offer-confirm-submit')!==null;console.info('I-CHAIN08 before rendering', {beforeRendered,leaf:leaf.mock.calls.length,ack:mockAck.mock.calls.length,notifications:(Haptics.notificationAsync as jest.Mock).mock.calls,alerts:(Alert.alert as jest.Mock).mock.calls});});
 expect(beforeRendered).toBe(true);expect(leaf).not.toHaveBeenCalled();expect(mockAck).not.toHaveBeenCalled();expect(Haptics.notificationAsync).not.toHaveBeenCalled();expect(Alert.alert).not.toHaveBeenCalled();
 expect(screen.getByTestId('offer-amount-input').props.value).toBe('');const fresh=fill(screen);await act(async()=>fresh());expect(leaf).toHaveBeenCalledTimes(1);expect(mockAck).toHaveBeenCalledTimes(1);expect(mockTrack.mock.calls.filter(([n])=>n==='offer_sent')).toHaveLength(1);
});
it('I-CHAIN09 actual step back and restore identical location creates fresh confirmation while old receipt remains recoverable',async()=>{
 setupIO();let release!:()=>void;leaf.mockImplementationOnce(async(value:Record<string,unknown>)=>{sent.push(value);await new Promise<void>(r=>{release=r;});return {data:{success:true,messageId:value.requestId}};});const screen=render(<ChatScreen/>);const old=fill(screen);let pending!:Promise<void>;act(()=>{pending=old();});await waitFor(()=>expect(leaf).toHaveBeenCalledTimes(1));
 fireEvent.press(screen.getByTestId('icon-arrow-back'));expect(screen.queryByTestId('offer-confirm-submit')).toBeNull();fireEvent.press(screen.getByTestId('offer-location-to-arrange'));fireEvent.press(screen.getByTestId('offer-location-continue'));expect(screen.getByText('RÉCAPITULATIF')).toBeTruthy();await act(async()=>{release();await pending;});expect(mockAck).not.toHaveBeenCalled();expect(mockTrack.mock.calls.filter(([n])=>n==='offer_sent')).toEqual([]);expect(await AsyncStorage.getItem(proofKey)).toContain('independent-real-1');const fresh=screen.UNSAFE_getByType(ConfirmStep).find(n=>n.props.testID==='offer-confirm-submit'&&typeof n.props.onPress==='function').props.onPress;await act(async()=>fresh());expect(sent[1]).toEqual(sent[0]);expect(mockAck).toHaveBeenCalledTimes(1);
});
it('V3-CHAIN10 artificial malformed DTO rejects without IO then a valid parent intention succeeds',async()=>{
 setupIO();render(<ChatScreen/>);const invalid=undefined as unknown as MeetupSpot;
 await expect(mockModalProps.onMeetupOfferSubmit(23,'Artificiel',invalid)).rejects.toThrow();expect(mockSend).not.toHaveBeenCalled();
 await mockModalProps.onMeetupOfferSubmit(23,'Valide',spot);expect(mockSend).toHaveBeenCalledTimes(1);expect(leaf).toHaveBeenCalledTimes(1);expect(mockAck).toHaveBeenCalledTimes(1);
});

it('V3-CHAIN11 pending real ConfirmStep error after synchronous close and reopen stays silent and exact retry works',async()=>{
 setupIO();let reject!:(error:Error)=>void;
 leaf.mockImplementationOnce((value:Record<string,unknown>)=>{sent.push(value);return new Promise((_resolve,rejectPromise)=>{reject=rejectPromise;});});
 const screen=render(<ChatScreen/>);const submit=fill(screen);let pending!:Promise<void>;
 act(()=>{pending=submit();});await waitFor(()=>expect(leaf).toHaveBeenCalledTimes(1));jest.clearAllMocks();
 await act(async()=>{mockModalRef.current!.dismiss();mockModalRef.current!.present();reject(Object.assign(new Error('late transport unknown'),{code:'functions/unavailable'}));await pending;});
 expect(mockAck).not.toHaveBeenCalled();expect(Haptics.notificationAsync).not.toHaveBeenCalled();expect(Alert.alert).not.toHaveBeenCalled();
 expect(screen.getByTestId('offer-amount-input').props.value).toBe('');
 const retry=fill(screen);await act(async()=>retry());expect(sent[1]).toEqual(sent[0]);expect(mockAck).toHaveBeenCalledTimes(1);
});

it('V3-CHAIN12 old catch and finally preserve the reopened real form terms and its fresh confirmation',async()=>{
 setupIO();let reject!:(error:Error)=>void;
 leaf.mockImplementationOnce((value:Record<string,unknown>)=>{sent.push(value);return new Promise((_resolve,rejectPromise)=>{reject=rejectPromise;});});
 const screen=render(<ChatScreen/>);const submit=fill(screen);let pending!:Promise<void>;
 act(()=>{pending=submit();});await waitFor(()=>expect(leaf).toHaveBeenCalledTimes(1));
 act(()=>mockModalRef.current!.dismiss());act(()=>mockModalRef.current!.present());
 fireEvent.changeText(screen.getByTestId('offer-amount-input'),'24');
 fireEvent.changeText(screen.getByPlaceholderText('Expliquez pourquoi vous faites cette offre...'),'Nouveaux termes');
 fireEvent.press(screen.getByTestId('offer-step-continue'));fireEvent.press(screen.getByTestId('offer-location-to-arrange'));fireEvent.press(screen.getByTestId('offer-location-continue'));
 expect(screen.getByText('"Nouveaux termes"')).toBeTruthy();jest.clearAllMocks();
 await act(async()=>{reject(Object.assign(new Error('old failure'),{code:'functions/unavailable'}));await pending;});
 expect(screen.getByText('"Nouveaux termes"')).toBeTruthy();expect(Alert.alert).not.toHaveBeenCalled();expect(Haptics.notificationAsync).not.toHaveBeenCalled();expect(mockAck).not.toHaveBeenCalled();
 const fresh=screen.UNSAFE_getByType(ConfirmStep).find(node=>node.props.testID==='offer-confirm-submit'&&typeof node.props.onPress==='function');
 expect(fresh.props.disabled).toBe(false);await act(async()=>fresh.props.onPress());
 expect(sent[1]).toMatchObject({amount:24,message:'Nouveaux termes'});expect(sent[1].requestId).not.toBe(sent[0].requestId);expect(mockAck).toHaveBeenCalledTimes(1);
});
