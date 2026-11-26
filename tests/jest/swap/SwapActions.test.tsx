/** Main and options actions follow the current agreement, participant and receipt state. */
import React from 'react';
import * as RN from 'react-native';
import {fireEvent, render, screen} from '@testing-library/react-native';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import type {SwapActionHandlers, SwapParticipantContext} from '@/features/swap/types';
import type {SwapStatus} from '@/types';
jest.mock('@/components/ui', () => ({Text: jest.requireActual('@/components/ui/Text').Text,
  Caption: jest.requireActual('@/components/ui/Text').Caption, Button: jest.requireActual('@/components/ui/Button').Button}));
jest.mock('expo-router', () => ({useLocalSearchParams: () => ({id: 'swap-1'}),
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect])}));
jest.mock('@/services/swapService', () => ({openSwapDispute: jest.fn(async () => undefined)}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: false}));
import {SwapActions} from '@/features/swap/components/detail/SwapActions';
const flags = jest.requireMock('@/config/featureFlags') as {PAYMENTS_ENABLED: boolean};
const participant = (over: Partial<SwapParticipantContext> = {}): SwapParticipantContext => ({isInitiator: false, isReceiver: false,
 senderName: 'Alice', senderImage: undefined, senderItems: [], myItems: [], hasUploadedPhotos: false, hasConfirmedShipping: false,
 hasConfirmedReception: false, hasRated: false, isTopUpPayer: false, topUpPayerName: 'Alice', ...over});
const handlers = (): SwapActionHandlers => ({onAccept: jest.fn(), onDecline: jest.fn(), onCancel: jest.fn(), onPayTopUp: jest.fn(),
 onSetExchangeMode: jest.fn(), onUploadPhotos: jest.fn(), onConfirmShipping: jest.fn(), onConfirmReception: jest.fn(), onRate: jest.fn()});
function surface(status: SwapStatus, over: Partial<SwapParticipantContext> = {}, extra: {optionsOnly?: boolean; isProcessing?: boolean; exchangeMode?: string; agreementReady?: boolean} = {}) {
 const h = handlers(); render(<SwapActions status={status} participant={participant(over)} handlers={h} isProcessing={false} exchangeMode="shipping" {...extra}/>); return h;
}
beforeEach(() => {establishIdentityFixture('me'); flags.PAYMENTS_ENABLED = false;});
afterEach(() => {clearIdentityFixture(); jest.restoreAllMocks();});
it('accepts a receiver proposal through the main action', () => {
 const h = surface('proposed', {isReceiver: true}); fireEvent.press(screen.getByText('Accepter la proposition'));
 expect(h.onAccept).toHaveBeenCalledTimes(1); expect(screen.queryByText('Refuser la proposition')).toBeNull();
});
it('keeps refusal in receiver options and does not show initiator cancellation', () => {
 const h = surface('proposed', {isReceiver: true}, {optionsOnly: true}); fireEvent.press(screen.getByText('Refuser la proposition'));
 expect(h.onDecline).toHaveBeenCalledTimes(1); expect(screen.queryByText('Annuler la proposition')).toBeNull();
});
it('keeps cancellation in initiator options', () => {
 const h = surface('proposed', {isInitiator: true}, {optionsOnly: true}); fireEvent.press(screen.getByText('Annuler la proposition'));
 expect(h.onCancel).toHaveBeenCalledTimes(1); expect(screen.queryByText('Accepter la proposition')).toBeNull();
});
it('disables acceptance and refusal while processing', () => {
 const h = handlers(); render(<><SwapActions status="proposed" participant={participant({isReceiver: true})} handlers={h} isProcessing exchangeMode="shipping"/>
 <SwapActions optionsOnly status="proposed" participant={participant({isReceiver: true})} handlers={h} isProcessing exchangeMode="shipping"/></>);
 expect(screen.getByRole('button', {name: 'Refuser la proposition'})).toBeDisabled(); expect(h.onDecline).not.toHaveBeenCalled(); expect(h.onAccept).not.toHaveBeenCalled();
});
it.each([true, false])('keeps production payment actions closed for payer=%s', isTopUpPayer => {
 const h = surface('payment_pending', {isTopUpPayer}); expect(screen.queryByText('Régler le complément')).toBeNull(); expect(h.onPayTopUp).not.toHaveBeenCalled();
});
it('preserves the explicitly enabled legacy payer callback', () => {
 flags.PAYMENTS_ENABLED = true; const h = surface('payment_pending', {isTopUpPayer: true}); fireEvent.press(screen.getByText('Régler le complément')); expect(h.onPayTopUp).toHaveBeenCalledTimes(1);
});
it('does not offer a mode change after agreement acceptance', () => {
 const h = surface('accepted', {}, {exchangeMode: undefined}); expect(screen.queryByText('En main propre')).toBeNull(); expect(screen.queryByText('Envoi postal')).toBeNull(); expect(h.onSetExchangeMode).not.toHaveBeenCalled();
});
it.each(['accepted', 'photos_pending', 'shipping'] as const)('allows dispute in the options of %s with a current agreement', status => {
 surface(status, {}, {optionsOnly: true}); expect(screen.getByRole('button', {name: 'Ouvrir un litige'})).toBeEnabled();
});
it('requires a qualified agreement before active transport actions', () => {
 const h = surface('shipping', {counterpartHasShipped: true}, {agreementReady: false});
 expect(screen.queryByText('J’ai reçu les articles')).toBeNull(); expect(screen.queryByText('J’ai envoyé mes articles')).toBeNull(); expect(h.onConfirmReception).not.toHaveBeenCalled();
});
it('offers missing postal photos through the upload callback', () => {
 const h = surface('photos_pending'); fireEvent.press(screen.getByText('Ajouter des photos')); expect(h.onUploadPhotos).toHaveBeenCalledTimes(1);
});
it('does not offer photos again when they are already uploaded', () => {surface('photos_pending', {hasUploadedPhotos: true}); expect(screen.queryByText('Ajouter des photos')).toBeNull();});
it('does not require postal photos for a hand delivery', () => {surface('photos_pending', {}, {exchangeMode: 'hand_delivery'}); expect(screen.queryByText('Ajouter des photos')).toBeNull();});
it('offers sending while no counterpart dispatch has been observed', () => {
 const h = surface('shipping'); fireEvent.press(screen.getByText('J’ai envoyé mes articles')); expect(h.onConfirmShipping).toHaveBeenCalledTimes(1); expect(screen.queryByText('J’ai reçu les articles')).toBeNull();
});
it('never infers counterpart dispatch from the member’s own sending confirmation', () => {
 const h = surface('shipping', {hasConfirmedShipping: true}); expect(screen.queryByText('J’ai reçu les articles')).toBeNull(); expect(h.onConfirmReception).not.toHaveBeenCalled();
});
it('offers reception after explicit counterpart dispatch', () => {
 const h = surface('shipping', {hasConfirmedShipping: true, counterpartHasShipped: true}); fireEvent.press(screen.getByText('J’ai reçu les articles')); expect(h.onConfirmReception).toHaveBeenCalledTimes(1);
});
it('retains sending in options when reception has priority', () => {
 const h = surface('shipping', {counterpartHasShipped: true}, {optionsOnly: true}); fireEvent.press(screen.getByText('J’ai envoyé mes articles')); expect(h.onConfirmShipping).toHaveBeenCalledTimes(1);
});
it('confirms receiving in a hand delivery without inventing a postal dispatch', () => {
 const h = surface('accepted', {}, {exchangeMode: 'hand_delivery'}); fireEvent.press(screen.getByText('J’ai reçu les articles')); expect(h.onConfirmReception).toHaveBeenCalledTimes(1); expect(h.onConfirmShipping).not.toHaveBeenCalled();
});
it('does not repeat a confirmed reception', () => {surface('shipping', {hasConfirmedShipping: true, hasConfirmedReception: true, counterpartHasShipped: true}); expect(screen.queryByText('J’ai reçu les articles')).toBeNull();});
it('rates a completed swap through its rating callback', () => {const h = surface('completed'); fireEvent.press(screen.getByRole('button', {name: 'Évaluer l’échange : 5 sur 5'})); expect(h.onRate).toHaveBeenCalledWith(5);});
it('keeps dispute options after completion without repeating a submitted rating', () => {surface('completed', {hasRated: true}, {optionsOnly: true}); expect(screen.getByText('Ouvrir un litige')).toBeOnTheScreen(); expect(screen.queryByText("Comment s'est passé l'échange ?")).toBeNull();});
it('keeps the dispute dialog lock across a font-size change and releases only on cancellation', () => {
 const dimensions = jest.spyOn(RN, 'useWindowDimensions'); dimensions.mockReturnValue({width: 390, height: 844, scale: 3, fontScale: 1});
 const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => undefined); const p = participant(), h = handlers();
 const tree = () => <SwapActions optionsOnly status="shipping" participant={p} handlers={h} isProcessing={false} exchangeMode="hand_delivery"/>;
 const view = render(tree()); fireEvent.press(screen.getByRole('button', {name: 'Ouvrir un litige'})); expect(alert).toHaveBeenCalledTimes(1);
 dimensions.mockReturnValue({width: 390, height: 844, scale: 3, fontScale: 2}); view.rerender(tree());
 fireEvent.press(screen.getByRole('button', {name: 'Ouvrir un litige'})); expect(alert).toHaveBeenCalledTimes(1);
 alert.mock.calls[0][2]?.find(button => button.text === 'Annuler')?.onPress?.();
 fireEvent.press(screen.getByRole('button', {name: 'Ouvrir un litige'})); expect(alert).toHaveBeenCalledTimes(2);
});
