import React from 'react';
import {Alert, Pressable, Text} from 'react-native';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import {auth} from '@/config/firebaseConfig';
import {Timestamp} from 'firebase/firestore';

const mockDispatch = jest.fn();
let mockOrder: Record<string, unknown>;
const spot = {name: 'Métro', category: 'metro', neighborhood: {id: 'q', name: 'Quartier', borough: 'Montréal'}};
jest.mock('@expo/vector-icons', () => ({Ionicons: () => null}));
jest.mock('expo-router', () => ({useRouter: () => ({push: jest.fn()}),
  useFocusEffect: (callback: () => () => void) => {const React = require('react'); React.useEffect(callback, [callback]);}}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({authenticatedUid: 'seller', user: {id: 'seller'}}))};
});
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@/services/chat/primitives', () => ({sendSystemMessage: jest.fn()}));
jest.mock('firebase/firestore', () => ({
  Timestamp: class Timestamp {
    static now() {return new Timestamp();}
    toMillis() {return Date.now();}
  },
  doc: (_database: unknown, collection: string, id: string) => ({collection, id}),
  getDoc: async () => ({exists: () => true, data: () => ({offer: {meetup: {location: spot}}})}),
  getDocFromServer: async (ref: {collection: string}) => ({data: () => ref.collection === 'messages'
    ? {chatId: 'chat', type: 'offer', offer: {status: 'accepted', transactionId: 'order', amount: 32, meetup: {location: spot}}}
    : ref.collection === 'chats' ? {participants: ['seller', 'buyer'], articleId: 'article'} : mockOrder}),
}));
jest.mock('firebase/functions', () => ({httpsCallable: (_functions: unknown, name: string) => (input: unknown) => mockDispatch(name, input)}));
import {confirmMeetup, completeMeetup, cancelMeetup} from '@/services/chat/meetup';
import {sendSystemMessage} from '@/services/chat/primitives';
import {useMeetupDialogs} from '@/features/offers/components/offer-bubble/useMeetupDialogs';
import {MeetupActions} from '@/features/offers/components/offer-bubble/MeetupActions';

function Action({complete, cancel}: {complete: boolean; cancel?: boolean}) {
  const actions = useMeetupDialogs({chatId: 'chat', messageId: 'message', articleId: 'article', amount: 32, isSeller: true,
    onConfirmMeetup: id => confirmMeetup('chat', id, 'seller'),
    onCompleteMeetup: id => completeMeetup('chat', id, 'seller'),
    onCancelMeetup: id => cancelMeetup('chat', id, 'seller'),
  });
  if (cancel) return <Pressable onPress={() => {void actions.handleCancelMeetup();}}><Text>Annuler la rencontre</Text></Pressable>;
  return <MeetupActions confirmLabel={complete ? 'Rencontre effectuée' : 'Confirmer le rendez-vous'}
    onConfirm={complete ? actions.handleCompleteMeetup : actions.handleConfirmMeetup}/>;
}
let alerts: jest.SpyInstance;
beforeEach(() => {
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'seller'};
  mockOrder = {chatId: 'chat', offerMessageId: 'message', articleId: 'article', buyerId: 'buyer', sellerId: 'seller',
    amount: 32, meetupSpot: spot, deliveryType: 'meetup', status: 'meetup_pending'};
  mockDispatch.mockResolvedValue({data: {success: true, chatId: 'chat', notificationCommitted: true, deviceDeliveryVerified: false, readingVerified: false}});
  (sendSystemMessage as jest.Mock).mockResolvedValue(undefined);
  alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {alerts.mockRestore();});
async function pressAndConfirm(complete: boolean, cancel = false) {
  const label = cancel ? 'Annuler la rencontre' : complete ? 'Rencontre effectuée' : 'Confirmer le rendez-vous';
  const view = render(<Action complete={complete} cancel={cancel}/>);
  fireEvent.press(view.getByText(label), {nativeEvent: {pageX: 1}});
  await waitFor(() => expect(alerts).toHaveBeenCalled());
  const buttons = alerts.mock.calls[0][2] as {text: string; onPress: () => Promise<void>}[];
  await act(async () => {await buttons.find(item => item.text === (cancel ? 'Annuler la rencontre' : complete ? 'Terminer' : 'Confirmer le rendez-vous'))!.onPress();});
}
it.each([false, true])('routes the native button to the exact meetup phase and receipt (completed=%s)', async complete => {
  if (complete) mockOrder.status = 'meetup_confirmed';
  await pressAndConfirm(complete);
  expect(mockDispatch).toHaveBeenCalledWith(complete ? 'completeMeetupTransaction' : 'confirmMeetupTransaction',
    {transactionId: 'order', messageId: 'message', expectedUid: 'seller'});
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
});
it.each([false, true])('does not report success for a missing or malformed meetup receipt (completed=%s)', async complete => {
  if (complete) mockOrder.status = 'meetup_confirmed';
  mockDispatch.mockResolvedValue({data: {success: false}});
  await pressAndConfirm(complete);
  expect(Haptics.notificationAsync).not.toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  expect(alerts.mock.calls[1][0]).toBe(complete ? 'Transaction non finalisée' : 'Rendez-vous non confirmé');
});
it.each([false, true])('observes an already committed phase after its response is lost, without another mutation (completed=%s)', async complete => {
  if (complete) mockOrder.status = 'meetup_confirmed';
  mockDispatch.mockImplementationOnce(async () => {
    mockOrder.status = complete ? 'meetup_completed' : 'meetup_confirmed';
    mockOrder[complete ? 'meetupCompletedAt' : 'meetupConfirmedAt'] = Timestamp.now();
    throw Object.assign(new Error('Response lost'), {code: 'functions/unavailable'});
  });
  await pressAndConfirm(complete);
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
});
it('does not turn a confirmed cancellation into a failure when its conversation notice is unavailable', async () => {
  mockDispatch.mockResolvedValue({data: {success: true, currentStatus: 'cancelled', cancellationCommitted: true, walletRefundCommitted: true}});
  (sendSystemMessage as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('Missing callable'), {code: 'functions/not-found'}));
  await pressAndConfirm(false, true);
  expect(mockDispatch).toHaveBeenCalledWith('cancelPendingTransaction', {transactionId: 'order', expectedUid: 'seller'});
  expect(sendSystemMessage).toHaveBeenCalledWith('chat', 'meetup_cancelled');
  expect(alerts).toHaveBeenCalledTimes(1);
});
it('does not announce cancellation when neither its receipt nor the native agreement confirms it', async () => {
  mockDispatch.mockResolvedValue({data: {success: false}});
  await pressAndConfirm(false, true);
  expect(sendSystemMessage).not.toHaveBeenCalled();
  expect(alerts.mock.calls[1][0]).toBe('Rencontre non annulée');
});
