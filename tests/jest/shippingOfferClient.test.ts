import AsyncStorage from '@/utils/environmentStorage';
import { auth } from '@/config/firebaseConfig';
import * as FeatureFlags from '@/config/featureFlags';

// Explicit phase2 protocol fixture. Closed V1 rails stay covered below and in chatService.send.
jest.mock('@/config/featureFlags', () => ({__esModule: true, ...jest.requireActual('@/config/featureFlags'), PAYMENTS_ENABLED: true, SHIPPING_ENABLED: true}));

let mockUid = 'buyer';
let mockGeneration = 1;
let mockOffer: Record<string, unknown>;
const mockDispatch = jest.fn();
const mockReadMessage = jest.fn();
let mockMessageCounter = 0;
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => mockGeneration,
  useAuthStore: {getState: () => ({authenticatedUid: mockUid})},
}));
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  doc: () => ({id: `message_${++mockMessageCounter}`}),
  getDocFromServer: (...args: unknown[]) => mockReadMessage(...args),
}));
jest.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => (input: Record<string, unknown>) => mockDispatch(name, input),
}));
import { acceptOffer, acknowledgeMeetupProposal, counterOfferPrice, rejectOffer, sendOffer } from '@/services/chat/offers';

beforeEach(async () => {
  await AsyncStorage.getAllKeys().then(keys => Promise.all(keys.map(key => AsyncStorage.removeItem(key))));
  mockUid = 'buyer'; mockGeneration++;
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'buyer'};
  mockOffer = {chatId: 'chat', type: 'offer', senderId: 'buyer', receiverId: 'seller',
    offer: {deliveryType: 'shipping', amount: 12, status: 'pending'}};
  mockReadMessage.mockImplementation(async () => ({data: () => mockOffer}));
  mockDispatch.mockImplementation(async () => ({data: {success: true, messageId: `received_${mockMessageCounter}`}}));
});
afterEach(() => jest.restoreAllMocks());

it.each([[false, false], [false, true], [true, false]])('refuses a new postal intent before minting a request or journal when rails are payments=%s shipping=%s', async (payments, shipping) => {
  jest.replaceProperty(FeatureFlags, 'PAYMENTS_ENABLED', payments);
  jest.replaceProperty(FeatureFlags, 'SHIPPING_ENABLED', shipping);
  const before = mockMessageCounter;
  await expect(sendOffer('chat', 'buyer', 'seller', 12)).rejects.toThrow('ne sont pas disponibles');
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockMessageCounter).toBe(before);
  await expect(AsyncStorage.getAllKeys()).resolves.toEqual([]);
});

it('sends postal offers through their own callable and journals the stable native requestId', async () => {
  const result = await sendOffer('chat', 'buyer', 'seller', 12, 'Bonjour', undefined, undefined, () => undefined, {deferAdoption: true});
  expect(mockDispatch).toHaveBeenCalledWith('sendShippingOffer', {chatId: 'chat', amount: 12, message: 'Bonjour', requestId: expect.any(String)});
  expect(mockDispatch.mock.calls[0][1]).not.toHaveProperty('deliveryType');
  acknowledgeMeetupProposal(result, () => undefined);
});

it('replays the same postal request after a lost response without allocating another requestId', async () => {
  mockDispatch.mockRejectedValueOnce(Object.assign(new Error('Response lost'), {code: 'functions/unavailable'}));
  await expect(sendOffer('chat', 'buyer', 'seller', 11)).resolves.toEqual(expect.any(String));
  const first = mockDispatch.mock.calls[0][1];
  expect(mockDispatch).toHaveBeenCalledTimes(2);
  expect(mockDispatch.mock.calls[1]).toEqual(['sendShippingOffer', first]);
});

it('accepts and rejects only through the postal response protocol, without requesting a meetup transaction', async () => {
  mockDispatch.mockImplementation(async (_name, input) => ({data: {success: true, accepted: input.action === 'accept', messageId: 'offer', chatId: 'chat'}}));
  await acceptOffer('chat', 'offer', 'offer', 'buyer');
  expect(mockDispatch).toHaveBeenCalledWith('respondShippingOffer', {chatId: 'chat', messageId: 'offer', action: 'accept'});
  await rejectOffer('chat', 'offer', 'offer', 'buyer');
  expect(mockDispatch).toHaveBeenCalledWith('respondShippingOffer', {chatId: 'chat', messageId: 'offer', action: 'reject'});
  expect(mockDispatch.mock.calls.some(([name]) => name === 'acceptMeetupOffer')).toBe(false);
});

it('routes a price counter to the same postal rail with its exact original message', async () => {
  await counterOfferPrice('chat', 'original', 'buyer', 'seller', 10, 'Autre prix');
  expect(mockDispatch).toHaveBeenCalledWith('sendShippingOffer', {chatId: 'chat', originalMessageId: 'original',
    amount: 10, message: 'Autre prix', requestId: expect.any(String)});
});

it('does not reject an offer if navigation changed while its protocol was being read', async () => {
  let finish!: (value: {data: () => typeof mockOffer}) => void;
  let active = true;
  mockReadMessage.mockImplementationOnce(() => new Promise(resolve => {finish = resolve;}));
  const pending = rejectOffer('chat', 'offer', 'offer', 'buyer', () => {
    if (!active) throw Object.assign(new Error('Old conversation'), {code: 'client/stale-operation'});
  });
  active = false; finish({data: () => mockOffer});
  await expect(pending).rejects.toMatchObject({code: 'client/stale-operation'});
  expect(mockDispatch).not.toHaveBeenCalled();
});
