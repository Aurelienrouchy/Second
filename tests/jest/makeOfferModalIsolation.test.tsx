jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useFocusEffect: (callback: () => void | (() => void)) => { const React = require('react'); React.useEffect(callback, [callback]); } }));
import React, { createRef } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { auth } from '@/config/firebaseConfig';
import type { MeetupSpot } from '@/types';
import type { MakeOfferContext } from '@/features/offers/components/MakeOfferModal/types';
let mockUid = 'A'; let mockGeneration = 1;
const mockClose = jest.fn(); const mockTrack = jest.fn();
jest.mock('@/store/authStore', () => ({ getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: Object.assign((selector: (state: { user: { id: string }; authenticatedUid: string }) => unknown) => selector({ user: { id: mockUid }, authenticatedUid: mockUid }), {
    getState: () => ({ user: { id: mockUid }, authenticatedUid: mockUid }),
  }),
}));
jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react'); const { View, ScrollView, TextInput } = require('react-native');
  const Sheet = React.forwardRef(({ children, onChange, accessible }: { children: React.ReactNode; accessible?: boolean; onChange: (index: number) => void }, ref: React.Ref<{ close: () => void; expand: () => void }>) => {
    React.useImperativeHandle(ref, () => ({ close: () => { mockClose(); onChange(-1); }, expand: () => undefined }));
    return React.createElement(View, {testID: 'offer-native-sheet', accessible: accessible ?? true}, children);
  });
  return { __esModule: true, default: Sheet, BottomSheetBackdrop: View, BottomSheetScrollView: ScrollView, BottomSheetTextInput: TextInput };
});
import MakeOfferModal, { type MakeOfferModalRef } from '@/features/offers/components/MakeOfferModal';
import OfferStep from '@/features/offers/components/MakeOfferModal/OfferStep';
import ConfirmStep from '@/features/offers/components/MakeOfferModal/ConfirmStep';
const spot: MeetupSpot = { name: 'Lieu', category: 'metro', neighborhood: { id: 'q', name: 'Quartier', borough: 'Montréal' } };
function session(uid: string, generation = mockGeneration + 1) { mockUid = uid; mockGeneration = generation; (auth as unknown as { currentUser: { uid: string } }).currentUser = { uid }; }
beforeEach(() => { jest.clearAllMocks(); session('A', 1); jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); });
afterEach(() => jest.restoreAllMocks());
function ready(screen: ReturnType<typeof render>, ref: React.RefObject<MakeOfferModalRef | null>, message = 'Saisie') {
  act(() => ref.current!.present());
  expect(screen.getByTestId('offer-native-sheet').props.accessible).toBe(false);
  const context = screen.UNSAFE_getByType(OfferStep).props.context as MakeOfferContext;
  act(() => { context.actions.setOfferAmount('35'); context.actions.setMessage(message); context.actions.setSelectedSpot(spot); context.actions.setStep('confirm'); });
  expect(screen.getByText('Saisie', { exact: false })).toBeTruthy();
}
it('whole modal wrapper refuses a previous presentation receipt after close and reopening the same article', async () => {
  let release: () => void = () => undefined; const submit = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const ref = createRef<MakeOfferModalRef>(); const screen = render(<MakeOfferModal ref={ref} articleId="article-A" articleTitle="Article A" currentPrice={40} onMeetupOfferSubmit={submit} />);
  ready(screen, ref); act(() => { fireEvent.press(screen.getByTestId('offer-confirm-submit')); }); await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  act(() => ref.current!.dismiss()); ready(screen, ref); expect(screen.getByTestId('offer-confirm-submit')).toBeTruthy(); const closes = mockClose.mock.calls.length;
  await act(async () => release()); expect(mockClose).toHaveBeenCalledTimes(closes);
  const context = screen.UNSAFE_getByType(ConfirmStep).props.context as MakeOfferContext;
  expect(context.state.message).toBe('Saisie'); expect(context.state.isSubmitting).toBe(false);
  expect((Alert.alert as jest.Mock).mock.calls.some(call => call[0] === 'Offre envoyée')).toBe(false);
});
it('whole modal closes account-owned input on a session change and old response cannot mark a new account submitted', async () => {
  let release: () => void = () => undefined; const submit = jest.fn(() => new Promise<void>(resolve => { release = resolve; }));
  const ref = createRef<MakeOfferModalRef>(); const screen = render(<MakeOfferModal ref={ref} articleId="article-A" articleTitle="Article A" currentPrice={40} onMeetupOfferSubmit={submit} />);
  ready(screen, ref); act(() => { fireEvent.press(screen.getByTestId('offer-confirm-submit')); }); await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  session('B'); await screen.rerenderAsync(<MakeOfferModal ref={ref} articleId="article-B" articleTitle="Article B" currentPrice={40} onMeetupOfferSubmit={submit} />);
  expect(screen.queryByText('RÉCAPITULATIF')).toBeNull(); act(() => ref.current!.present()); expect(screen.getByText('Article B')).toBeTruthy();
  await act(async () => release()); expect(mockClose).not.toHaveBeenCalled(); expect((Alert.alert as jest.Mock).mock.calls.some(call => call[0] === 'Offre envoyée')).toBe(false);
});
it('whole modal known receipt in its unchanged presentation closes once', async () => {
  const submit = jest.fn(async () => undefined); const ref = createRef<MakeOfferModalRef>();
  const screen = render(<MakeOfferModal ref={ref} articleId="article-A" articleTitle="Article A" currentPrice={40} onMeetupOfferSubmit={submit} />);
  ready(screen, ref); await act(async () => { fireEvent.press(screen.getByTestId('offer-confirm-submit')); });
  expect(submit).toHaveBeenCalledTimes(1); expect(mockClose).toHaveBeenCalledTimes(1); expect(screen.queryByText('RÉCAPITULATIF')).toBeNull();
});

it('an old sheet dismissal callback cannot close a newer presentation of the same article', async () => {
  const submit = jest.fn(async () => undefined); const ref = createRef<MakeOfferModalRef>();
  const screen = render(<MakeOfferModal ref={ref} articleId="article-A" articleTitle="Article A" currentPrice={40} onMeetupOfferSubmit={submit} />);
  ready(screen, ref);
  const Sheet = (require('@gorhom/bottom-sheet') as { default: React.ComponentType }).default;
  const oldDismiss = screen.UNSAFE_getByType(Sheet).props.onChange as (index: number) => void;
  act(() => ref.current!.dismiss()); ready(screen, ref);
  act(() => oldDismiss(-1)); expect(screen.getByTestId('offer-confirm-submit')).toBeTruthy();
});

it('criteria return resumes the exact proposal and requires a new confirmation while its old submit stays invalid', async () => {
  const submit = jest.fn(async () => undefined); const ref = createRef<MakeOfferModalRef>();
  const screen = render(<MakeOfferModal ref={ref} articleId="article-A" articleTitle="Article A" currentPrice={40} onMeetupOfferSubmit={submit} />);
  ready(screen, ref);
  const previous = screen.UNSAFE_getByType(ConfirmStep).props;
  act(() => previous.context.onPauseForCriteria());
  expect(screen.queryByTestId('offer-confirm-submit')).toBeNull();
  act(() => ref.current!.resume());
  const resumed = screen.UNSAFE_getByType(ConfirmStep).props.context as MakeOfferContext;
  expect(resumed.state.offerAmount).toBe('35'); expect(resumed.state.message).toBe('Saisie'); expect(resumed.state.selectedSpot).toEqual(spot);
  expect(submit).not.toHaveBeenCalled();
  await expect(previous.onSubmitMeetup(35, 'Saisie', spot)).rejects.toMatchObject({ code: 'client/stale-operation' });
  await act(async () => { fireEvent.press(screen.getByTestId('offer-confirm-submit')); });
  expect(submit).toHaveBeenCalledTimes(1);
});
