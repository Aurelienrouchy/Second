// The provider IO supplies current positive foundations; session/admission guards stay real.
jest.mock('@/services/eligibilityService', () => ({ EligibilityService: { getMine: jest.fn(async () => ({ decisions: Object.fromEntries(['buy', 'sell', 'new_paid_shipping'].map(scope => [scope, { scope, allowed: true, status: 'allowed', reasons: [], messages: [], policyVersion: 'fixture-policy', evaluationStage: 'foundations' }])) })) } }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { getEnvironmentStorageKey } from '@/config/firebaseEnvironment';
const mockAck = jest.fn();
jest.mock('@/services/chat/offers', () => { const actual = jest.requireActual<typeof import('@/services/chat/offers')>('@/services/chat/offers'); return { ...actual, acknowledgeMeetupProposal: (messageId: string, assertContext: () => void) => { mockAck(messageId, assertContext); actual.acknowledgeMeetupProposal(messageId, assertContext); } }; });
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useRouter: () => require('expo-router').router,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
 useFocusEffect: (callback: () => void | (() => void)) => { const React = require('react'); React.useEffect(callback, [callback]); } }));
import React from 'react';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { auth } from '@/config/firebaseConfig';
import type { MeetupSpot } from '@/types';
let mockUid: string | null = 'A'; let mockGeneration = 1;
const mockCounter = jest.fn(); const mockAccept = jest.fn(); const mockExit = jest.fn(); const mockTrack = jest.fn();
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (state: { user: { id: string } | null; authenticatedUid: string | null; identityUser?: {id:string}|null; identityError?:boolean; isLoading?:boolean }) => unknown) => selector({identityUser: mockUid ? { id: mockUid } : null, identityError: false, isLoading: false,  user: mockUid ? { id: mockUid } : null, authenticatedUid: mockUid }), {
    getState: () => ({identityUser: mockUid ? { id: mockUid } : null, identityError: false, isLoading: false,  authenticatedUid: mockUid, user: mockUid ? { id: mockUid } : null }),
  }),
}));
jest.mock('@/services/chatService', () => ({ ChatService: {
  counterOfferPrice: (...args: unknown[]) => mockCounter(...args), counterOfferLocation: (...args: unknown[]) => mockCounter(...args), counterOfferTime: (...args: unknown[]) => mockCounter(...args),
  confirmMeetup: (...args: unknown[]) => mockExit(...args), reportNoShow: (...args: unknown[]) => mockExit(...args), completeMeetup: (...args: unknown[]) => mockExit(...args), cancelMeetup: (...args: unknown[]) => mockExit(...args),
} }));
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
import { acknowledgeMeetupProposal } from '@/services/chat/offers';
import { useChatOfferActions } from '@/features/chat/hooks/useChatOfferActions';
import { useCounterOfferDialogs } from '@/features/offers/components/offer-bubble/useCounterOfferDialogs';
import { useOfferResponseDialogs } from '@/features/offers/components/offer-bubble/useOfferResponseDialogs';
import ConfirmStep from '@/features/offers/components/MakeOfferModal/ConfirmStep';
import type { MakeOfferContext } from '@/features/offers/components/MakeOfferModal/types';

const spot: MeetupSpot = { name: 'Métro', category: 'metro', neighborhood: { id: 'q', name: 'Quartier', borough: 'Montréal' } };
function session(uid: string | null, generation = mockGeneration + 1) {
  mockUid = uid; mockGeneration = generation;
  (auth as unknown as { currentUser: { uid: string } | null }).currentUser = uid ? { uid } : null;
}
function actions(chatId = 'chat-A') {
  return useChatOfferActions({ chatId, userId: mockUid ?? undefined, otherParticipantId: 'other', sellerId: 'other', acceptOffer: mockAccept, rejectOffer: mockAccept });
}
function counter({ chat = 'chat-A', message = 'm-A' }: { chat?: string; message?: string } = {}) {
  const handlers = actions(chat);
  return useCounterOfferDialogs({ chatId: chat, articleId: 'article', messageId: message, amount: 40, meetup: { location: spot, proposedBy: 'buyer' }, onCounterPrice: handlers.handleCounterPrice, onCounterLocation: handlers.handleCounterLocation, onCounterTime: handlers.handleCounterTime });
}
function responses({ chat = 'chat-A', message = 'm-A', amount = 40 }: { chat?: string; message?: string; amount?: number } = {}) {
  const handlers = actions(chat);
  return useOfferResponseDialogs({ chatId: chat, articleId: 'article', messageId: message, amount, isMeetupOffer: true, isSeller: true, onAcceptOffer: handlers.handleAcceptOffer, onRejectOffer: handlers.handleRejectOffer });
}
let alert: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks(); session('A', 1); mockCounter.mockResolvedValue('receipt'); mockAccept.mockResolvedValue(undefined); mockExit.mockResolvedValue(undefined);
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
function confirm(): () => Promise<void> {
  const buttons = alert.mock.calls.find(call => call[0] === "Accepter l'offre")?.[2] as { text: string; onPress: () => Promise<void> }[];
  return buttons.find(button => button.text === 'Accepter')!.onPress;
}
function fill(result: { current: ReturnType<typeof counter> }, price = '35', message = 'Saisie') {
  act(() => { result.current.setActiveCounterPanel('price'); result.current.setCounterPriceAmount(price); result.current.setCounterLocationName('Autre lieu'); result.current.setCounterDateTime('2030-01-01 14:30'); result.current.setCounterMessage(message); });
}

it.each(['price', 'location', 'time'] as const)('V2-COUNTER-REAL actual %s service keeps closed edited intent recoverable, exact retry then fresh intent', async kind => {
 const actual = jest.requireActual<typeof import('@/services/chat/offers')>('@/services/chat/offers'); mockCounter.mockImplementation(kind === 'price' ? actual.counterOfferPrice : kind === 'location' ? actual.counterOfferLocation : actual.counterOfferTime);
 (getDoc as jest.Mock).mockResolvedValue({data: () => ({chatId: 'chat-A', type: 'offer', senderId: 'other', receiverId: 'A', offer: {meetup: {location: spot}}})});
 let id = 0; (doc as jest.Mock).mockImplementation(() => ({ id: `counter-real-${++id}` })); const sent: Record<string, unknown>[] = []; let release!: () => void;
 const dispatch = jest.fn(async (value: Record<string, unknown>) => { sent.push(value); if (sent.length === 1) await new Promise<void>(resolve => { release = resolve; }); return { data: { success: true, messageId: value.requestId } }; }); (httpsCallable as jest.Mock).mockImplementation(() => dispatch);
 const { result } = renderHook(() => counter()); fill(result); act(() => result.current.setActiveCounterPanel(kind));
 const run = () => kind === 'price' ? result.current.handleCounterPrice() : kind === 'location' ? result.current.handleCounterLocation() : result.current.handleCounterTime();
 let pending!: Promise<void>; act(() => { pending = run(); }); await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1)); const key = getEnvironmentStorageKey('meetup-proposal:v1:A:chat-A'); expect(await AsyncStorage.getItem(key)).toContain(String(sent[0].requestId));
 act(() => { result.current.setActiveCounterPanel(null); result.current.setCounterMessage('Different'); }); act(() => { result.current.setActiveCounterPanel(kind); result.current.setCounterMessage('Saisie'); });
 await act(async () => { release(); await pending; }); expect(mockAck).not.toHaveBeenCalled(); expect(result.current.counterMessage).toBe('Saisie'); expect(await AsyncStorage.getItem(`${key}:receipts`)).toContain(String(sent[0].requestId));
 await act(async () => run()); expect(sent[1]).toEqual(sent[0]); expect(mockAck).toHaveBeenCalledTimes(1); expect(result.current.activeCounterPanel).toBeNull();
 fill(result); act(() => result.current.setActiveCounterPanel(kind)); await act(async () => run()); expect(sent[2].requestId).not.toBe(sent[0].requestId); expect(mockAck).toHaveBeenCalledTimes(2);
});
