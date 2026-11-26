// The provider IO supplies current positive foundations; session/admission guards stay real.
jest.mock('@/services/eligibilityService', () => ({ EligibilityService: { getMine: jest.fn(async () => ({ decisions: Object.fromEntries(['buy', 'sell', 'new_paid_shipping'].map(scope => [scope, { scope, allowed: true, status: 'allowed', reasons: [], messages: [], policyVersion: 'fixture-policy', evaluationStage: 'foundations' }])) })) } }));
jest.mock('@/services/chat/offers', () => ({ hasMeetupAcceptanceAttempt: jest.fn(async () => false), acknowledgeMeetupProposal: jest.fn(), readMeetupProposalRecovery: jest.fn(async () => null) }));
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
beforeEach(() => {
  jest.clearAllMocks(); session('A', 1); mockCounter.mockResolvedValue('receipt'); mockAccept.mockResolvedValue(undefined); mockExit.mockResolvedValue(undefined);
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

it('late response after actual dispatch preserves all four fields and panel of the new dossier without any error or success', async () => {
  let release: () => void = () => undefined;
  mockCounter.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve('old'); }));
  const { result, rerender } = renderHook(counter, { initialProps: { chat: 'chat-A', message: 'm-A' } }); fill(result);
  let pending!: Promise<void>; act(() => { pending = result.current.handleCounterPrice(); });
  await waitFor(() => expect(mockCounter).toHaveBeenCalledTimes(1));
  rerender({ chat: 'chat-B', message: 'm-B' }); fill(result, '29', 'Nouveau dossier');
  const fields = [result.current.counterPriceAmount, result.current.counterLocationName, result.current.counterDateTime, result.current.counterMessage, result.current.activeCounterPanel];
  await act(async () => { release(); await pending; });
  expect([result.current.counterPriceAmount, result.current.counterLocationName, result.current.counterDateTime, result.current.counterMessage, result.current.activeCounterPanel]).toEqual(fields);
  expect(alert).not.toHaveBeenCalled(); expect(mockTrack.mock.calls.some(([name, data]) => name === 'offer_countered' && data.success === true)).toBe(false);
});

it('late rejection does not show an error or clear newer fields', async () => {
  let reject: (error: Error) => void = () => undefined;
  mockCounter.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const { result, rerender } = renderHook(counter, { initialProps: { chat: 'chat-A', message: 'm-A' } }); fill(result);
  let pending!: Promise<void>; act(() => { pending = result.current.handleCounterPrice(); }); await waitFor(() => expect(mockCounter).toHaveBeenCalledTimes(1));
  rerender({ chat: 'chat-B', message: 'm-B' }); fill(result, '29', 'Nouveau');
  await act(async () => { reject(new Error('old server refusal')); await pending; });
  expect(result.current.counterMessage).toBe('Nouveau'); expect(result.current.counterPriceAmount).toBe('29'); expect(alert).not.toHaveBeenCalled();
});

it('same-dossier input edited while its response is pending is retained', async () => {
  let release: () => void = () => undefined;
  mockCounter.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve('receipt'); }));
  const { result } = renderHook(() => counter()); fill(result);
  let pending!: Promise<void>; act(() => { pending = result.current.handleCounterPrice(); }); await waitFor(() => expect(mockCounter).toHaveBeenCalledTimes(1));
  fill(result, '31', 'Correction'); await act(async () => { release(); await pending; });
  expect(result.current.counterPriceAmount).toBe('31'); expect(result.current.counterMessage).toBe('Correction'); expect(result.current.activeCounterPanel).toBe('price');
});

it('the old finally cannot unlock a newer dossier pending operation', async () => {
  const releases: (() => void)[] = []; mockCounter.mockImplementation(() => new Promise(resolve => { releases.push(() => resolve('receipt')); }));
  const { result, rerender } = renderHook(counter, { initialProps: { chat: 'chat-A', message: 'm-A' } }); fill(result);
  let old!: Promise<void>; act(() => { old = result.current.handleCounterPrice(); });
  await waitFor(() => expect(mockCounter).toHaveBeenCalledTimes(1)); rerender({ chat: 'chat-B', message: 'm-B' }); fill(result, '29', 'New');
  let next!: Promise<void>; act(() => { next = result.current.handleCounterPrice(); }); await waitFor(() => expect(mockCounter).toHaveBeenCalledTimes(2));
  await act(async () => { releases[0](); await old; await result.current.handleCounterPrice(); });
  expect(mockCounter).toHaveBeenCalledTimes(2); expect(result.current.isCountering).toBe(true);
  await act(async () => { releases[1](); await next; }); expect(result.current.isCountering).toBe(false); expect(result.current.counterPriceAmount).toBe('');
});

it('an old same-UID callback is refused after generation changes even before a new render', async () => {
  const { result } = renderHook(() => actions()); const old = result.current.handleCounterPrice;
  session('A', 3); await expect(old('m-A', 35)).rejects.toMatchObject({ code: 'client/stale-operation' }); expect(mockCounter).not.toHaveBeenCalled();
});

it('a double confirm callback does not release the active synchronous lock', async () => {
  let release: () => void = () => undefined; mockAccept.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(undefined); }));
  const { result } = renderHook(() => responses()); await act(async () => { await result.current.handleAccept(); }); const captured = confirm();
  let pending!: Promise<void>; act(() => { pending = captured(); }); await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(1));
  await act(async () => { await captured(); await result.current.handleAccept(); }); expect(mockAccept).toHaveBeenCalledTimes(1);
  expect(alert.mock.calls.filter(call => call[0] === "Accepter l'offre")).toHaveLength(1);
  expect(Haptics.notificationAsync).not.toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  await act(async () => { release(); await pending; }); expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
});

it('cancelled confirmation cannot be executed later', async () => {
  const { result } = renderHook(() => responses()); await act(async () => { await result.current.handleAccept(); }); const captured = confirm();
  const buttons = alert.mock.calls[0][2] as { text: string; onPress: () => void }[];
  act(() => buttons.find(button => button.text === 'Annuler')!.onPress()); await act(async () => { await captured(); }); expect(mockAccept).not.toHaveBeenCalled();
});

it('changed amount invalidates a previously opened confirmation for the same message', async () => {
  const { result, rerender } = renderHook(responses, { initialProps: { amount: 40 } }); await act(async () => { await result.current.handleAccept(); }); const captured = confirm();
  rerender({ amount: 29 }); await act(async () => { await captured(); }); expect(mockAccept).not.toHaveBeenCalled();
});

it('unmounted confirmation cannot dispatch', async () => {
  const { result, unmount } = renderHook(() => responses()); await act(async () => { await result.current.handleAccept(); }); const captured = confirm(); unmount();
  await captured(); expect(mockAccept).not.toHaveBeenCalled();
});

it('two different obligations in the same conversation can be processed independently', async () => {
  const releases: (() => void)[] = []; mockExit.mockImplementation(() => new Promise(resolve => { releases.push(() => resolve(undefined)); }));
  const { result } = renderHook(() => actions());
  const one = result.current.handleCompleteMeetup('old-one'); const two = result.current.handleCancelMeetup('old-two');
  expect(mockExit).toHaveBeenCalledTimes(2); releases.forEach(release => release()); await Promise.all([one, two]);
});

it('serializes two actions on the same existing obligation until its receipt', async () => {
  let release!: () => void;
  mockExit.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const { result } = renderHook(() => actions());
  const first = result.current.handleConfirmMeetup('same-message');
  await expect(result.current.handleCancelMeetup('same-message')).rejects.toThrow('déjà en cours');
  expect(mockExit).toHaveBeenCalledTimes(1);
  await act(async () => { release(); await first; });
  await result.current.handleCancelMeetup('same-message');
  expect(mockExit).toHaveBeenCalledTimes(2);
});

it('a late old-dossier finally cannot release the new obligation lock', async () => {
  const releases: Array<() => void> = [];
  mockExit.mockImplementation(() => new Promise<void>(resolve => { releases.push(resolve); }));
  const { result, rerender } = renderHook(({ chat }: {chat: string}) => actions(chat), {initialProps: {chat: 'original-chat'}});
  const old = result.current.handleConfirmMeetup('same-message').catch(error => error);
  rerender({chat: 'new-chat'});
  const current = result.current.handleConfirmMeetup('same-message');
  await act(async () => { releases[0](); expect(await old).toMatchObject({code: 'client/stale-operation'}); });
  await expect(result.current.handleCancelMeetup('same-message')).rejects.toThrow('déjà en cours');
  expect(mockExit).toHaveBeenCalledTimes(2);
  await act(async () => { releases[1](); await current; });
});

it('missing actor cannot turn any existing exit into a fulfilled no-op', async () => {
  session(null); const { result } = renderHook(() => actions());
  await expect(result.current.handleConfirmMeetup('m')).rejects.toThrow(); await expect(result.current.handleReportNoShow('m')).rejects.toThrow();
  await expect(result.current.handleCompleteMeetup('m')).rejects.toThrow(); await expect(result.current.handleCancelMeetup('m')).rejects.toThrow();
  expect(mockExit).not.toHaveBeenCalled();
});

const close = jest.fn(); const submitting = jest.fn();
function confirmationContext(articleId: string, message = 'Saisie'): MakeOfferContext {
  return { articleId, articleTitle: articleId, currentPrice: 40, onClose: close, state: {
    step: 'confirm', mode: 'meetup', offerAmount: '35', message, selectedNeighborhood: spot.neighborhood,
    selectedSpot: spot, customSpotName: '', isSubmitting: false,
  }, actions: { setStep: jest.fn(), setMode: jest.fn(), setOfferAmount: jest.fn(), setMessage: jest.fn(), setSelectedNeighborhood: jest.fn(), setSelectedSpot: jest.fn(), setCustomSpotName: jest.fn(), setIsSubmitting: submitting } };
}
it('ConfirmStep receipt after dossier replacement cannot close or reset the new modal', async () => {
  let release: () => void = () => undefined; const submit = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
  close.mockClear(); submitting.mockClear(); const screen = render(<ConfirmStep context={confirmationContext('article-A')} onSubmitMeetup={submit} />);
  act(() => { fireEvent.press(screen.getByTestId('offer-confirm-submit')); }); await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  await screen.rerenderAsync(<ConfirmStep context={confirmationContext('article-B', 'New')} onSubmitMeetup={submit} />);
  expect(screen.getByText('article-B')).toBeTruthy();
  expect(screen.getByText(/New/)).toBeTruthy();
  await act(async () => release()); expect(close).not.toHaveBeenCalled(); expect(submitting).not.toHaveBeenCalledWith(false);
  expect(alert.mock.calls.some(call => call[0] === 'Offre envoyée')).toBe(false);
});

it.each(['price', 'location', 'time'] as const)('V2-COUNTER01 edited A B A %s intent cannot be recognized or clear the restored form', async kind => {
 let release!: () => void; mockCounter.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve('old-intent'); }));
 const { result } = renderHook(() => counter()); fill(result); act(() => result.current.setActiveCounterPanel(kind));
 const run = () => kind === 'price' ? result.current.handleCounterPrice() : kind === 'location' ? result.current.handleCounterLocation() : result.current.handleCounterTime();
 let pending!: Promise<void>; act(() => { pending = run(); }); await waitFor(() => expect(mockCounter).toHaveBeenCalledTimes(1));
 act(() => result.current.setCounterMessage('Changed')); act(() => result.current.setCounterMessage('Saisie'));
 await act(async () => { release(); await pending; }); expect(acknowledgeMeetupProposal).not.toHaveBeenCalled();
 expect(result.current.counterMessage).toBe('Saisie'); expect(result.current.activeCounterPanel).toBe(kind); expect(mockTrack.mock.calls.filter(([, data]) => data.success === true)).toEqual([]);
});
it('V2-COUNTER02 a same-value edit invalidates the saved callback while the freshly rendered submit remains usable', async () => {
 const { result } = renderHook(() => counter()); fill(result); const old = result.current.handleCounterPrice;
 act(() => result.current.setCounterPriceAmount('35')); await old(); expect(mockCounter).not.toHaveBeenCalled();
 await act(async () => result.current.handleCounterPrice()); expect(mockCounter).toHaveBeenCalledTimes(1); expect(result.current.counterPriceAmount).toBe('');
});
