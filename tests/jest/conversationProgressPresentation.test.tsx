import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import type {Transaction} from '@/types/transaction';
import type {Message} from '@/types/chat';

const mockPush = jest.fn(), mockStart = jest.fn(() => ({}));
const mockReportNoShow = jest.fn(), mockCancelMeetup = jest.fn(), mockSupport = jest.fn();
let mockOptionsCurrent = true;
jest.mock('expo-router', () => ({useRouter: () => ({push: mockPush})}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({start: mockStart, capture: () => ({}), isCurrent: () => mockOptionsCurrent})}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: true, SHIPPING_ENABLED: true}));
jest.mock('@/features/offers/components/offer-bubble/useOfferTransaction', () => ({useOfferTransaction: () => ({transactionId: null, transaction: null})}));
jest.mock('@/features/offers/components/offer-bubble/useMeetupDialogs', () => ({useMeetupDialogs: () => ({isExiting: false,
  guardExit: (fn: () => void) => fn, handleReportNoShow: mockReportNoShow, handleCancelMeetup: mockCancelMeetup,
  openMeetupSupport: mockSupport, reportSheetProps: null,
})}));
jest.mock('@/components/RecourseReasonSheet', () => ({RecourseReasonSheet: () => null}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@shopify/flash-list', () => {
  const {View} = require('react-native');
  return {FlashList: ({data, renderItem}: {data: Transaction[]; renderItem: (row: {item: Transaction}) => React.ReactNode}) =>
    <View>{data.map(item => <View key={item.id}>{renderItem({item})}</View>)}</View>};
});

import {ChatTransactionHistory} from '@/features/orders/components/ChatTransactionHistory';
import {ConversationOrderProgress} from '@/features/chat/components/ConversationOrderProgress';
import {OfferProgressMessage} from '@/features/offers/components/OfferProgressMessage';
import {ChatInputBar} from '@/features/chat/components/ChatInputBar';

const order = (id: string, title: string): Transaction => ({id, chatId: 'conversation', buyerId: 'buyer', sellerId: 'seller',
  articleId: 'article', amount: 32, createdAt: new Date('2026-10-28T12:00:00Z'), deliveryType: 'shipping', status: 'label_created',
  shipEngineLabelId: 'label', labelCreatedAt: new Date('2026-10-28T12:02:00Z'), shipEngineRateId: 'rate', articleSnapshot: {title},
  labelPurchase: {schemaVersion: 1, state: 'committed', transactionId: id, buyerId: 'buyer', sellerId: 'seller', attemptId: 'attempt',
    sourceHash: 'a'.repeat(64), providerLabelId: 'label', committedAt: new Date('2026-10-28T12:02:00Z'), shipmentId: 'shipment', rateId: 'rate',
    qualification: {schemaVersion: 1, currency: 'CAD', requestedRateId: 'rate', rateIdentitySource: 'request_path'}},
  shippingSnapshot: {schemaVersion: 1, provider: 'shipengine', currency: 'CAD', priceAcceptedBy: 'buyer', validatedAt: new Date('2026-10-28T12:00:00Z'),
    acceptanceValidatedAt: new Date('2026-10-28T12:00:00Z'), shipmentId: 'shipment', rate: {rateId: 'rate', shipmentId: 'shipment'}},
} as unknown as Transaction);

it('keeps a single purchase out of the conversation header history', () => {
  const screen = render(<ChatTransactionHistory transactions={[order('PRIVATE_ORDER', 'Sweat Uniqlo')]} selectedId="PRIVATE_ORDER"
    userId="seller" onSelect={jest.fn()} hasMore={false} onLoadMore={jest.fn()} isLoading={false}/>);
  expect(screen.toJSON()).toBeNull();
});

it('selects the exact older purchase using article and date instead of an opaque reference, then closes the selector', () => {
  const onSelect = jest.fn();
  const screen = render(<ChatTransactionHistory transactions={[order('PRIVATE_A', 'Sweat Uniqlo'), order('PRIVATE_B', 'Veste en jean')]}
    selectedId="PRIVATE_A" userId="seller" onSelect={onSelect} hasMore={false} onLoadMore={jest.fn()} isLoading={false}/>);
  expect(screen.queryByText('Veste en jean')).toBeNull();
  fireEvent.press(screen.getByText('Autres achats'));
  expect(screen.queryByText(/PRIVATE_/)).toBeNull();
  fireEvent.press(screen.getByText('Veste en jean'));
  expect(onSelect).toHaveBeenCalledWith('PRIVATE_B');
  expect(screen.queryByText('Veste en jean')).toBeNull();
});

it('preserves history pagination and prevents repeated loading clicks', () => {
  const onLoadMore = jest.fn();
  const screen = render(<ChatTransactionHistory transactions={[order('PRIVATE_A', 'Sweat Uniqlo')]} selectedId="PRIVATE_A"
    userId="seller" onSelect={jest.fn()} hasMore onLoadMore={onLoadMore} isLoading={false}/>);
  fireEvent.press(screen.getByText('Autres achats'));
  fireEvent.press(screen.getByText('Voir les suivants'));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
});

it('opens the exact selected order through one compact action without repeating its milestone', () => {
  const screen = render(<ConversationOrderProgress order={order('PRIVATE_ORDER', 'Sweat Uniqlo')} uid="seller" chatId="conversation"/>);
  expect(screen.queryByText(/PRIVATE_ORDER/)).toBeNull();
  expect(screen.queryByText('Étiquette prête')).toBeNull();
  fireEvent.press(screen.getByText('Voir l’envoi'));
  expect(mockPush).toHaveBeenCalledWith({pathname: '/orders/[id]', params: {id: 'PRIVATE_ORDER'}});
});

const meetupMessage = {id: 'offer', chatId: 'conversation', senderId: 'buyer', receiverId: 'seller', type: 'offer',
  content: 'Proposition', timestamp: new Date('2026-10-28T12:00:00Z'), status: 'sent', isRead: true,
  offer: {amount: 32, status: 'accepted', meetup: {location: {name: 'Café', category: 'cafe', neighborhood: {id: 'mile-end', name: 'Mile End', borough: 'Plateau'}}, proposedBy: 'buyer'}},
} as Message;

it('keeps secondary meetup actions behind options and dispatches their original handler', () => {
  const screen = render(<OfferProgressMessage message={meetupMessage} isOwnMessage={false} chatId="conversation" currentUserId="seller"
    sellerId="seller" onReportNoShow={jest.fn()} onCancelMeetup={jest.fn()}/>);
  expect(screen.queryByText('Signaler une absence')).toBeNull();
  fireEvent.press(screen.getByText('Options de la rencontre'));
  fireEvent.press(screen.getByText('Signaler une absence'));
  expect(mockReportNoShow).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Signaler une absence')).toBeNull();
  fireEvent.press(screen.getByText('Options de la rencontre'));
  fireEvent.press(screen.getByText('Désaccord sur la remise'));
  expect(mockSupport).toHaveBeenCalledWith('disagreement_after_declaration');
});

it('closes options when the conversation context is no longer current', () => {
  const props = {message: meetupMessage, isOwnMessage: false, chatId: 'conversation', currentUserId: 'seller', sellerId: 'seller',
    onReportNoShow: jest.fn(), onCancelMeetup: jest.fn()};
  const screen = render(<OfferProgressMessage {...props}/>);
  fireEvent.press(screen.getByText('Options de la rencontre'));
  expect(screen.getByText('Signaler une absence')).toBeTruthy();
  mockOptionsCurrent = false;
  screen.rerender(<OfferProgressMessage {...props}/>);
  expect(screen.queryByText('Signaler une absence')).toBeNull();
  mockOptionsCurrent = true;
});

it('removes the offer action while preserving ordinary messaging when the parent no longer has an available article', () => {
  const onSend = jest.fn(), onOffer = jest.fn();
  const props = {messageText: 'Bonjour', onChangeText: jest.fn(), onSend, onPickImage: jest.fn(), onMakeOffer: onOffer,
    isSendingImage: false, hasArticle: true};
  const screen = render(<ChatInputBar {...props}/>);
  expect(screen.getByLabelText('Faire une offre')).toBeTruthy();
  screen.rerender(<ChatInputBar {...props} hasArticle={false}/>);
  expect(screen.queryByTestId('chat-offer-button')).toBeNull();
  fireEvent.press(screen.getByTestId('chat-send-button'));
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onOffer).not.toHaveBeenCalled();
});

it('opens native tracking from the conversation for the exact shipped order', () => {
  const shipped = {...order('SHIPPED_ORDER', 'Sweat'), status: 'shipped'} as Transaction;
  const screen = render(<ConversationOrderProgress order={shipped} uid="seller" chatId="conversation"/>);
  fireEvent.press(screen.getByText('Suivre le colis'));
  expect(mockPush).toHaveBeenCalledWith({pathname: '/orders/tracking/[id]', params: {id: 'SHIPPED_ORDER'}});
});
