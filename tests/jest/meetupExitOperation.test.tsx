import {meetupFirestoreFixture} from '@/tests/jest/helpers/meetupFirestoreFixture';
const mockNativeRead = jest.fn();
jest.mock('firebase/firestore', () => ({
 Timestamp: class TimestampFixture {time: number; constructor(mockTime: number) {this.time = mockTime;} static fromDate(value: Date) {return new this(value.getTime());} toDate() {return new Date(this.time);} toMillis() {return this.time;}},
 doc: (_db: unknown, col: string, id: string) => ({col, id}), collection: (_db: unknown, name: string) => ({name}),
 getDoc: (...args: unknown[]) => mockNativeRead(...args), getDocFromServer: (...args: unknown[]) => mockNativeRead(...args),
 getDocsFromServer: jest.fn(async () => ({docs: [], size: 0})), getDocs: jest.fn(async () => ({docs: [], size: 0})),
}));
// The provider IO supplies current positive foundations; session/admission guards stay real.
jest.mock('@/services/eligibilityService', () => ({ EligibilityService: { getMine: jest.fn(async () => ({ decisions: Object.fromEntries(['buy', 'sell', 'new_paid_shipping'].map(scope => [scope, { scope, allowed: true, status: 'allowed', reasons: [], messages: [], policyVersion: 'fixture-policy', evaluationStage: 'foundations' }])) })) } }));
jest.mock('@/services/chat/offers', () => ({ hasMeetupAcceptanceAttempt: jest.fn(async () => false), acknowledgeMeetupProposal: jest.fn(), readMeetupProposalRecovery: jest.fn(async () => null) }));
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import { auth } from '@/config/firebaseConfig';
let mockUid = 'reviewer'; let mockGeneration = 8; let mockFocused = true;
const mockCounter = jest.fn(); const mockExit = jest.fn(); const mockAccept = jest.fn(); const mockTrack = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
 useRouter: () => ({ push: jest.fn() }), useFocusEffect: (callback: () => () => void) => {
 const React = require('react'); React.useEffect(() => { if (mockFocused) return callback(); }, [callback, mockFocused]);
} }));
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (state: {authenticatedUid: string; user: {id: string}; identityUser?: {id:string}|null; identityError?:boolean; isLoading?:boolean}) => unknown) =>
    selector({identityUser: {id: mockUid}, identityError: false, isLoading: false, authenticatedUid: mockUid, user: {id: mockUid}}), {
      getState: () => ({identityUser: {id: mockUid}, identityError: false, isLoading: false, authenticatedUid: mockUid, user: {id: mockUid}}),
    }),
}));
jest.mock('@/services/chatService', () => ({ ChatService: {
 counterOfferPrice: (...args: unknown[]) => mockCounter(...args), confirmMeetup: (...args: unknown[]) => mockExit(...args),
 reportNoShow: (...args: unknown[]) => mockExit(...args), completeMeetup: (...args: unknown[]) => mockExit(...args), cancelMeetup: (...args: unknown[]) => mockExit(...args),
} }));
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
import { useTradeOperation } from '@/hooks/useTradeOperation';
import { useChatOfferActions } from '@/features/chat/hooks/useChatOfferActions';
import { useMeetupDialogs } from '@/features/offers/components/offer-bubble/useMeetupDialogs';
import { useOfferResponseDialogs } from '@/features/offers/components/offer-bubble/useOfferResponseDialogs';
function actions(chatId = 'chat-original') { return useChatOfferActions({ chatId, userId: mockUid, otherParticipantId: 'peer', sellerId: 'peer', acceptOffer: mockAccept, rejectOffer: mockAccept }); }
function exits({ chat = 'chat-original', message = 'message-original' }: { chat?: string; message?: string } = {}) {
 const a = actions(chat); return useMeetupDialogs({ chatId: chat, articleId: 'parent-article-'+chat, messageId: message, amount: 17, isSeller: true,
 onConfirmMeetup: a.handleConfirmMeetup, onCancelMeetup: a.handleCancelMeetup, onReportNoShow: a.handleReportNoShow, onCompleteMeetup: a.handleCompleteMeetup });
}
function responses({ id = 'message-original' }: { id?: string } = {}) {
 const a = actions(); return useOfferResponseDialogs({ chatId: 'chat-original', articleId: 'parent-article', messageId: id, amount: 17, isSeller: true, isMeetupOffer: true, onAcceptOffer: a.handleAcceptOffer, onRejectOffer: a.handleRejectOffer });
}
let native: ReturnType<typeof meetupFirestoreFixture>;
let alerts: jest.SpyInstance;
beforeEach(() => {
 jest.clearAllMocks(); [mockCounter, mockExit, mockAccept].forEach(mock => mock.mockReset()); native=meetupFirestoreFixture({uid:'reviewer',chatId:'chat-original',messageId:'message-original',articleId:'parent-article-chat-original',amount:17});mockNativeRead.mockReset().mockImplementation(native.read); mockUid = 'reviewer'; mockGeneration = 8; mockFocused = true;
 (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid: 'reviewer' };
 mockCounter.mockResolvedValue('receipt'); mockExit.mockResolvedValue(undefined); mockAccept.mockResolvedValue(undefined);
 alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
it('R-F01 an initially unfocused route cannot capture any trade operation before focus entry', () => {
 mockFocused = false; const { result } = renderHook(() => useTradeOperation('review-dossier', 'reviewer'));
 let rejected = false; try { result.current.capture(); } catch { rejected = true; }
 console.info('R-F01 reached', { focused: mockFocused, rejected, focusRevision: result.current.focusRevision });
 expect(rejected).toBe(true);
});
it('R-F02 initially unfocused chat action must reject before any leaf send', async () => {
 mockFocused = false; const { result } = renderHook(() => actions());
 let rejected = false; try { await result.current.handleCounterPrice('message-original', 13); } catch { rejected = true; }
 console.info('R-F02 reached', { focused: mockFocused, rejected, sends: mockCounter.mock.calls.length });
 expect({ rejected, sends: mockCounter.mock.calls.length }).toEqual({ rejected: true, sends: 0 });
});
it('R-F03 blur-refocus same mounted dossier invalidates pending operations without unlocking the newer frame lock', () => {
 const { result, rerender } = renderHook(() => useTradeOperation('review-dossier', 'reviewer')); const first = result.current.start()!;
 mockFocused = false; rerender({}); expect(result.current.isCurrent(first)).toBe(false); expect(() => result.current.capture()).toThrow();
 mockFocused = true; rerender({}); const second = result.current.start()!; result.current.finish(first);
 expect(result.current.isCurrent(first)).toBe(false); expect(result.current.ownsLock(second)).toBe(true); expect(result.current.start()).toBeNull();
});
it('R-F04 A B A dossiers with identical content invalidate the first operation permanently', () => {
 const { result, rerender } = renderHook(({ id }: { id: string }) => useTradeOperation(id, 'reviewer'), { initialProps: { id: 'article-original' } });
 const original = result.current.capture(); rerender({ id: 'article-replacement' }); rerender({ id: 'article-original' });
 expect(result.current.isCurrent(original)).toBe(false); expect(result.current.capture().frame).not.toBe(original.frame);
});
it('R-F05 response confirmation captured before blur cannot dispatch after refocusing', async () => {
 const { result, rerender } = renderHook(() => responses()); await act(async () => { await result.current.handleAccept(); });
 const confirm = alerts.mock.calls[0][2][1].onPress as () => Promise<void>;
 mockFocused = false; rerender({}); mockFocused = true; rerender({}); await act(async () => confirm());
 expect(mockAccept).not.toHaveBeenCalled(); expect(alerts).toHaveBeenCalledTimes(1);
});
it('R-F06 cancelled response confirmation cannot release a newer confirmation lock or dispatch later', async () => {
 const { result } = renderHook(() => responses()); await act(async () => { await result.current.handleAccept(); });
 const old = alerts.mock.calls[0][2] as { onPress: () => Promise<void> | void }[]; act(() => { void old[0].onPress(); }); await act(async () => { await result.current.handleAccept(); });
 expect(result.current.isAccepting).toBe(true); await act(async () => { await old[1].onPress(); });
 expect(result.current.isAccepting).toBe(true); expect(mockAccept).not.toHaveBeenCalled();
});
const dialogExitCases = [
 { action: 'confirm', method: 'handleConfirmMeetup', title: 'Confirmer le rendez-vous', button: 'Confirmer le rendez-vous' },
 { action: 'complete', method: 'handleCompleteMeetup', title: 'Terminer la transaction', button: 'Terminer' },
 { action: 'cancel', method: 'handleCancelMeetup', title: 'Annuler la rencontre', button: 'Annuler la rencontre' },
] as const;
it.each(dialogExitCases)('R-E01 real $action consumer suppresses an old rejection after the visible dossier changes', async item => {
 let release!: () => void; mockExit.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
 const { result, rerender } = renderHook(exits, { initialProps: { chat: 'chat-original', message: 'message-original' } });
 let dialog!: Promise<void>; act(() => { dialog = result.current[item.method](); });
 const buttons = alerts.mock.calls.find(c => c[0] === item.title)![2] as { text: string; onPress: () => Promise<void> }[];
 let pending!: Promise<void>; act(() => { pending = buttons.find(b => b.text === item.button)!.onPress(); });
 await waitFor(() => expect(mockExit).toHaveBeenCalledTimes(1)); expect(mockExit.mock.calls[0].slice(0, 2)).toEqual(['chat-original', 'message-original']);
 rerender({ chat: 'chat-replacement', message: 'message-replacement' });
 expect(result.current.isExiting).toBe(false); const before = alerts.mock.calls.length; await act(async () => { release(); await pending; await dialog; });
 console.info('R-E01 reached', { action: item.action, after: alerts.mock.calls.slice(before).map(c => ({ title: c[0], message: c[1] })) });
 expect(alerts.mock.calls.slice(before)).toEqual([]); expect(mockTrack.mock.calls.filter(([, v]) => v?.result === 'error' || v?.result === 'success')).toEqual([]);
});
it('R-E02 real complete consumer cancelled confirmation cannot be later dispatched', async () => {
 const { result } = renderHook(() => exits()); let dialog!: Promise<void>; act(() => { dialog = result.current.handleCompleteMeetup(); });
 const buttons = alerts.mock.calls[0][2] as { onPress: () => Promise<void> | void }[];
 act(() => { void buttons[0].onPress(); }); await dialog; await act(async () => { await buttons[1].onPress(); });
 console.info('R-E02 reached', { calls: mockExit.mock.calls }); expect(mockExit).not.toHaveBeenCalled();
});
it('R-E03 real confirm consumer cannot signal success before the server promise is received', async () => {
 let release!: () => void; mockExit.mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
 const { result } = renderHook(() => exits()); let dialog!: Promise<void>; act(() => { dialog = result.current.handleConfirmMeetup(); });
 let pending!: Promise<void>; act(() => { pending = alerts.mock.calls[0][2][1].onPress(); }); await waitFor(() => expect(mockExit).toHaveBeenCalledTimes(1));
 const successBeforeReceipt = (Haptics.notificationAsync as jest.Mock).mock.calls.some(c => c[0] === Haptics.NotificationFeedbackType.Success);
 await act(async () => { release(); await pending; await dialog; }); expect(successBeforeReceipt).toBe(false);
});

it.each(dialogExitCases)('V2-E01 existing $action nominal remains available, no success before receipt, one IO despite duplicate callback', async item => {
 let release!: () => void; mockExit.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
 const { result } = renderHook(() => exits()); let dialog!: Promise<void>; act(() => { dialog = result.current[item.method](); });
 const buttons = alerts.mock.calls[0][2] as { text: string; onPress: () => Promise<void> }[];
 const confirm = buttons.find(button => button.text === item.button)!.onPress;
 let pending!: Promise<void>; act(() => { pending = confirm(); }); await waitFor(() => expect(mockExit).toHaveBeenCalledTimes(1));
 await act(async () => { await confirm(); }); expect(result.current.isExiting).toBe(true);
 expect((Haptics.notificationAsync as jest.Mock).mock.calls).toEqual([]);
 expect(mockTrack.mock.calls.filter(([, event]) => event.result === 'success')).toEqual([]);
 await act(async () => { release(); await pending; await dialog; }); expect(result.current.isExiting).toBe(false);
 expect(mockExit.mock.calls[0].slice(0, 2)).toEqual(['chat-original', 'message-original']);
 if (item.action === 'confirm' || item.action === 'complete') expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
});
it.each(dialogExitCases)('V2-E02 existing $action dismissed callback cannot dispatch or release the next dialog', async item => {
 const { result } = renderHook(() => exits()); let first!: Promise<void>; act(() => { first = result.current[item.method](); });
 const old = alerts.mock.calls[0][2] as { text: string; onPress: () => Promise<void> }[];
 const options = alerts.mock.calls[0][3] as { onDismiss: () => void }; act(() => options.onDismiss()); await first;
 let second!: Promise<void>; act(() => { second = result.current[item.method](); });
 await act(async () => old.find(button => button.text === item.button)!.onPress()); expect(result.current.isExiting).toBe(true); expect(mockExit).not.toHaveBeenCalled();
 const current = alerts.mock.calls[1][2] as { onPress: () => void }[]; act(() => current[0].onPress()); await second; expect(result.current.isExiting).toBe(false);
});
it.each(dialogExitCases)('V2-E03 existing $action rejects stale opener before alert and preserves current dialogue', async item => {
 const { result, rerender } = renderHook(exits, { initialProps: { chat: 'chat-original', message: 'message-original' } }); const old = result.current[item.method];
 rerender({ chat: 'chat-replacement', message: 'message-replacement' }); await old(); expect(alerts).not.toHaveBeenCalled(); expect(mockExit).not.toHaveBeenCalled();
});
it.each(dialogExitCases)('V2-E04 existing $action keeps a current server error visible with no success effect', async item => {
 mockExit.mockRejectedValueOnce(new Error('current server refused'));
 const { result } = renderHook(() => exits()); let dialog!: Promise<void>; act(() => { dialog = result.current[item.method](); });
 const confirm = (alerts.mock.calls[0][2] as { text: string; onPress: () => Promise<void> }[]).find(button => button.text === item.button)!.onPress;
 await act(async () => { await confirm(); await dialog; }); expect(alerts.mock.calls.at(-1)![1]).toBe('current server refused');
 expect(Haptics.notificationAsync).not.toHaveBeenCalled(); expect(result.current.isExiting).toBe(false);
});
it('V2-E05 nominal current counter is available after an initially unfocused route enters focus', async () => {
 mockFocused = false; const { result, rerender } = renderHook(() => actions()); await expect(result.current.handleCounterPrice('message-original', 13)).rejects.toThrow();
 mockFocused = true; rerender({}); await result.current.handleCounterPrice('message-original', 13); expect(mockCounter).toHaveBeenCalledTimes(1);
});
it.each(['accept', 'reject'] as const)('V2-RESPONSE01 dismissed %s confirmation cannot dispatch or release a new dialog', async action => {
 const { result } = renderHook(() => responses()); const open = () => action === 'accept' ? result.current.handleAccept() : result.current.handleReject();
 await act(async () => { await open(); }); const old = alerts.mock.calls[0][2] as { onPress: () => Promise<void> }[];
 const options = alerts.mock.calls[0][3] as { onDismiss: () => void }; act(() => options.onDismiss());
 await act(async () => { await open(); }); expect(alerts).toHaveBeenCalledTimes(2);
 await act(async () => old[1].onPress()); expect(mockAccept).not.toHaveBeenCalled(); expect(action === 'accept' ? result.current.isAccepting : result.current.isRejecting).toBe(true);
});


const nativeReportCases = [{action: 'noShow', method: 'handleReportNoShow'}, {action: 'contest', method: 'handleContestNoShow'}] as const;
it.each(nativeReportCases)('wrapped $action report drops an old outcome after the visible dossier changes', async item => {
 if (item.action === 'contest') native.initialByPeer();
 let release!: () => void; mockExit.mockImplementationOnce(() => new Promise<void>(resolve => {release = resolve;}));
 const {result, rerender} = renderHook(exits, {initialProps: {chat: 'chat-original', message: 'message-original'}});
 await act(async () => {await result.current[item.method]();}); const form = result.current.reportSheetProps!; expect(form).not.toBeNull();
 let pending!: Promise<void>; act(() => {pending = form.onSubmit('other_party_no_show', 'Récit du dossier original.');});
 await waitFor(() => expect(mockExit).toHaveBeenCalledTimes(1));
 rerender({chat: 'chat-replacement', message: 'message-replacement'}); expect(result.current.reportSheetProps).toBeNull();
 const before = alerts.mock.calls.length; await act(async () => {release(); await pending;}); expect(alerts.mock.calls.slice(before)).toEqual([]); expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});
it.each(nativeReportCases)('wrapped $action old opener remains inert after dossier replacement', async item => {
 const {result, rerender} = renderHook(exits, {initialProps: {chat: 'chat-original', message: 'message-original'}}); const old = result.current[item.method];
 rerender({chat: 'chat-replacement', message: 'message-replacement'}); await act(async () => {await old();});
 expect(mockExit).not.toHaveBeenCalled(); expect(result.current.reportSheetProps).toBeNull(); expect(alerts).not.toHaveBeenCalled();
});

it.each(nativeReportCases)('wrapped $action closed form cannot send after a new opening of the same dossier', async item => {
 if (item.action === 'contest') native.initialByPeer();
 mockExit.mockImplementation(async (_chat, _message, _uid, reason, details) => {native.commitStory(reason, details);});
 const {result} = renderHook(() => exits()); await act(async () => {await result.current[item.method]();}); const old = result.current.reportSheetProps!;
 act(() => old.onClose()); await act(async () => {await result.current[item.method]();}); const current = result.current.reportSheetProps!;
 await act(async () => {await old.onSubmit('other_party_no_show', 'Ancienne saisie annulée.');}); expect(mockExit).not.toHaveBeenCalled();
 act(() => old.onClose()); expect(result.current.reportSheetProps).not.toBeNull();
 await act(async () => {await current.onSubmit('other_party_no_show', 'Récit de la nouvelle ouverture.');}); expect(mockExit).toHaveBeenCalledTimes(1);
 expect(alerts.mock.calls.at(-1)?.[0]).toBe('Récit enregistré');
});
it.each(nativeReportCases)('wrapped $action retains a current error and retries the same explicit factual story', async item => {
 if (item.action === 'contest') native.initialByPeer();
 mockExit.mockImplementation(async (_chat, _message, _uid, reason, details) => {native.commitStory(reason, details);}); mockExit.mockRejectedValueOnce(new Error('current server refused'));
 const {result} = renderHook(() => exits()); await act(async () => {await result.current[item.method]();});
 await act(async () => {await result.current.reportSheetProps!.onSubmit('other_party_no_show', 'Les faits conservés.');});
 expect(alerts.mock.calls.at(-1)?.[1]).toBe('current server refused'); expect(result.current.reportSheetProps?.isSubmitting).toBe(false);
 await act(async () => {await result.current.reportSheetProps!.onSubmit('other_party_no_show', 'Les faits conservés.');});
 expect(mockExit).toHaveBeenCalledTimes(2); expect(mockExit.mock.calls[1].slice(0,5)).toEqual(mockExit.mock.calls[0].slice(0,5)); expect(alerts.mock.calls.at(-1)?.[0]).toBe('Récit enregistré');
});
it.each(nativeReportCases)('wrapped $action keeps one IO and no success while its factual story awaits a native receipt', async item => {
 if (item.action === 'contest') native.initialByPeer();
 let release!: () => void; mockExit.mockImplementationOnce((_chat, _message, _uid, reason, details) => new Promise<void>(resolve => {release = () => {native.commitStory(reason, details); resolve();};}));
 const {result} = renderHook(() => exits()); await act(async () => {await result.current[item.method]();}); const form = result.current.reportSheetProps!;
 let pending!: Promise<void>; act(() => {pending = form.onSubmit('other_party_no_show', 'Récit en attente.');}); await waitFor(() => expect(mockExit).toHaveBeenCalledTimes(1));
 await act(async () => {await form.onSubmit('other_party_no_show', 'Doublon refusé.');}); expect(mockExit).toHaveBeenCalledTimes(1); expect(alerts).not.toHaveBeenCalled();
 expect(result.current.reportSheetProps?.isSubmitting).toBe(true); await act(async () => {release(); await pending;}); expect(result.current.reportSheetProps).toBeNull();
});
