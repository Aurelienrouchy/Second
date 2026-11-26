import React from 'react';
import {Alert} from 'react-native';
import {act, fireEvent, render, renderHook, waitFor} from '@testing-library/react-native';
import AsyncStorage from '@/utils/environmentStorage';
import {auth} from '@/config/firebaseConfig';
import * as FeatureFlags from '@/config/featureFlags';

const mockDispatch = jest.fn();
const mockAdmission = jest.fn(), mockAccepted = jest.fn();
let mockMeetup = false;
jest.mock('@expo/vector-icons', () => ({Ionicons: () => null}));
jest.mock('expo-router', () => ({useRouter: () => ({push: jest.fn()}),
  useFocusEffect: (callback: () => () => void) => {const React = require('react'); React.useEffect(callback, [callback]);}}));
jest.mock('@/store/authStore', () => {
  const {create} = jest.requireActual<typeof import('zustand')>('zustand');
  return {getAuthSessionGeneration: () => 1, useAuthStore: create(() => ({authenticatedUid: 'seller', user: {id: 'seller'}}))};
});
jest.mock('@/services/newSaleAdmission', () => ({assertNewSaleAdmission: (...args: unknown[]) => mockAdmission(...args)}));
jest.mock('@/services/eligibilityService', () => ({EligibilityService: {getMine: jest.fn()}}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('firebase/firestore', () => ({collection: jest.fn(), doc: () => ({id: 'message'}),
  getDocFromServer: async () => ({data: () => ({chatId: 'chat', senderId: 'buyer', receiverId: 'seller', type: 'offer',
    offer: mockMeetup ? {amount: 32, status: 'pending', meetup: {location: {name: 'Lieu'}}} : {amount: 32, status: 'pending', deliveryType: 'shipping'}})}),
}));
jest.mock('firebase/functions', () => ({httpsCallable: (_functions: unknown, name: string) => (input: unknown) => mockDispatch(name, input)}));
import {acceptOffer, rejectOffer, sendOffer, hasMeetupAcceptanceAttempt} from '@/services/chat/offers';
import {useMeetupProposalRecovery} from '@/hooks/useMeetupProposalRecovery';
import {useOfferResponseDialogs} from '@/features/offers/components/offer-bubble/useOfferResponseDialogs';
import {OfferActions} from '@/features/offers/components/offer-bubble/OfferActions';
import {CounterPriceInput} from '@/features/offers/components/offer-bubble/CounterPriceInput';
import {useCounterOfferDialogs} from '@/features/offers/components/offer-bubble/useCounterOfferDialogs';

function Offer() {
  const actions = useOfferResponseDialogs({chatId: 'chat', messageId: 'message', articleId: 'article', amount: 32,
    isMeetupOffer: mockMeetup, isSeller: true,
    onAcceptOffer: (messageId, offerId) => acceptOffer('chat', messageId, offerId, 'seller'),
    onRejectOffer: (messageId, offerId) => rejectOffer('chat', messageId, offerId, 'seller'),
    onAccepted: mockAccepted,
  });
  return <OfferActions isAccepting={actions.isAccepting} isRejecting={actions.isRejecting}
    showCounterOfferButton={false} isMeetupOffer={mockMeetup} onAccept={actions.handleAccept}
    onReject={actions.handleReject} onOpenCounterPrice={() => undefined}/>;
}
let alert: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.getAllKeys().then(keys => Promise.all(keys.map(key => AsyncStorage.removeItem(key))));
  mockMeetup = false;
  mockAdmission.mockImplementation(async (_uid: string, _scope: string, guard: () => void) => {guard();});
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'seller'};
  mockDispatch.mockImplementation(async (name: string, input: {action?: string}) => ({data: name === 'respondShippingOffer'
    ? {success: true, accepted: input.action === 'accept', messageId: 'message', chatId: 'chat'} : {success: true, messageId: 'message', transactionId: 'meetup-order'}}));
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {alert.mockRestore(); jest.restoreAllMocks();});
function button(text: string, title = "Accepter l'offre") {
  const dialog = [...alert.mock.calls].reverse().find(call => call[0] === title);
  const buttons = dialog?.[2] as {text: string; onPress?: () => Promise<void>}[];
  return buttons?.find(value => value.text === text);
}

it.each([false, true])('a real native press starts a first acceptance instead of recovery (meetup=%s)', async meetup => {
  mockMeetup = meetup;
  const view = render(<Offer/>);
  fireEvent.press(view.getByText('Accepter'), {nativeEvent: {pageX: 120, pageY: 240}});
  await waitFor(() => expect(button('Accepter')).toBeDefined());
  expect(button('Vérifier la tentative précédente')).toBeUndefined();
  await act(async () => {await button('Accepter')!.onPress!();});
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  expect(mockDispatch).toHaveBeenCalledWith(meetup ? 'acceptMeetupOffer' : 'respondShippingOffer',
    {chatId: 'chat', messageId: 'message', ...(meetup ? {} : {action: 'accept'})});
  expect(await hasMeetupAcceptanceAttempt('seller', 'chat', 'message', () => undefined)).toBe(false);
  expect(mockAdmission).toHaveBeenCalledTimes(meetup ? 1 : 0);
  expect(mockAccepted).toHaveBeenCalledTimes(meetup ? 0 : 1);
});

it('surfaces a postal server refusal and does not continue to checkout or seller preparation', async () => {
  const refusal = Object.assign(new Error('Cette offre n’est plus disponible.'), {code: 'functions/failed-precondition'});
  mockDispatch.mockRejectedValueOnce(refusal);
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const view = render(<Offer/>);
  fireEvent.press(view.getByText('Accepter'));
  await waitFor(() => expect(button('Accepter')).toBeDefined());
  await act(async () => {await button('Accepter')!.onPress!();});
  expect(mockDispatch).toHaveBeenCalledTimes(1); expect(mockAdmission).not.toHaveBeenCalled();
  expect(mockAccepted).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Erreur', 'Cette offre n’est plus disponible.');
  errorLog.mockRestore();
});

it('automatically confirms a response-lost postal acceptance using the exact same endpoint and tuple', async () => {
  mockDispatch.mockRejectedValueOnce(Object.assign(new Error('Response lost'), {code: 'functions/unavailable'}));
  const view = render(<Offer/>);
  fireEvent.press(view.getByText('Accepter'), {nativeEvent: {pageX: 1}});
  await waitFor(() => expect(button('Accepter')).toBeDefined());
  await act(async () => {await button('Accepter')!.onPress!();});
  expect(mockDispatch).toHaveBeenCalledTimes(2);
  expect(mockDispatch.mock.calls[1]).toEqual(mockDispatch.mock.calls[0]);
  expect(await hasMeetupAcceptanceAttempt('seller', 'chat', 'message', () => undefined)).toBe(false);
  expect(alert.mock.calls.map(call => call[0])).toEqual(["Accepter l'offre"]);
});

it('keeps an unresolved acceptance and refreshes it without another confirmation or recovery jargon', async () => {
  const lost = Object.assign(new Error('Response lost'), {code: 'functions/unavailable'});
  mockDispatch.mockRejectedValueOnce(lost).mockRejectedValueOnce(lost);
  const view = render(<Offer/>);
  fireEvent.press(view.getByText('Accepter'), {nativeEvent: {pageX: 1}});
  await waitFor(() => expect(button('Accepter')).toBeDefined());
  await act(async () => {await button('Accepter')!.onPress!();});
  expect(await hasMeetupAcceptanceAttempt('seller', 'chat', 'message', () => undefined)).toBe(true);
  expect(mockDispatch).toHaveBeenCalledTimes(2);
  expect(button('Actualiser', 'Connexion interrompue')).toBeDefined();
  await act(async () => {await button('Actualiser', 'Connexion interrompue')!.onPress!();});
  await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(3));
  expect(mockDispatch.mock.calls[2]).toEqual(mockDispatch.mock.calls[0]);
  expect(alert.mock.calls.filter(call => call[0] === "Accepter l'offre")).toHaveLength(1);
  expect(JSON.stringify(alert.mock.calls)).not.toMatch(/tentative précédente/i);
});

it.each([false, true])('dispatches a real reject press on the proper rail (meetup=%s)', async meetup => {
  mockMeetup = meetup;
  const view = render(<Offer/>);
  fireEvent.press(view.getByText('Refuser'), {nativeEvent: {pageX: 1}});
  await act(async () => {await button('Refuser', "Refuser l'offre")!.onPress!();});
  expect(mockDispatch).toHaveBeenCalledWith(meetup ? 'rejectMeetupProposal' : 'respondShippingOffer',
    {chatId: 'chat', messageId: 'message', ...(meetup ? {} : {action: 'reject'})});
});

it('automatically resumes the immutable proposal on re-entry without asking to verify a previous attempt', async () => {
  // This case creates a phase2 shipping intent; default V1 rails stay closed for the rest.
  jest.replaceProperty(FeatureFlags, 'PAYMENTS_ENABLED', true);
  jest.replaceProperty(FeatureFlags, 'SHIPPING_ENABLED', true);
  const lost = Object.assign(new Error('Response lost'), {code: 'functions/unavailable'});
  mockDispatch.mockRejectedValueOnce(lost).mockRejectedValueOnce(lost);
  await expect(sendOffer('chat', 'seller', 'buyer', 32)).rejects.toMatchObject({tradeRecovery: true});
  const original = mockDispatch.mock.calls[0];
  const hook = renderHook(() => useMeetupProposalRecovery());
  await act(async () => {expect(await hook.result.current('seller', 'chat', () => undefined)).toBe(true);});
  expect(mockDispatch).toHaveBeenCalledTimes(3);
  expect(mockDispatch.mock.calls[2]).toEqual(original);
  expect(alert).not.toHaveBeenCalled();
});

const counter = jest.fn();
function Counter() {
  const state = useCounterOfferDialogs({chatId: 'chat', messageId: 'message', amount: 30, listedPrice: 40, onCounterPrice: counter});
  return <CounterPriceInput amount={state.counterPriceAmount} message={state.counterMessage} isSubmitting={state.isCountering}
    onChangeAmount={state.setCounterPriceAmount} onChangeMessage={state.setCounterMessage}
    onCancel={() => undefined} onSubmit={state.handleCounterPrice}/>;
}
it('sends the exact decimal comma amount from the counter-offer button', async () => {
  counter.mockResolvedValue(undefined);
  const view = render(<Counter/>);
  fireEvent.changeText(view.getByPlaceholderText('Montant en $'), '32,50');
  fireEvent.press(view.getByText('Envoyer'), {nativeEvent: {pageX: 1}});
  await waitFor(() => expect(counter).toHaveBeenCalledWith('message', 32.5, undefined, expect.any(Function)));
});
it.each(['32oops', '40,01'])('does not dispatch a malformed or above-list counter-price: %s', async amount => {
  const view = render(<Counter/>);
  fireEvent.changeText(view.getByPlaceholderText('Montant en $'), amount);
  fireEvent.press(view.getByText('Envoyer'), {nativeEvent: {pageX: 1}});
  expect(counter).not.toHaveBeenCalled();
});
