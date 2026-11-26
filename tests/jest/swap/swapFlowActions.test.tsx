import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {SwapActions} from '@/features/swap/components/detail/SwapActions';
import {getSwapNextStep, getSwapStatusLabel} from '@/features/swap/presentation';
import type {SwapParticipantContext, SwapActionHandlers} from '@/features/swap/types';
import type {Swap, SwapStatus} from '@/types';
jest.mock('@/components/ui', () => ({Text: require('react-native').Text, Caption: require('react-native').Text, Button: jest.requireActual('@/components/ui/Button').Button}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: true}));
jest.mock('@/hooks/useAuth', () => ({useAuthenticatedUid: () => 'owner'}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({capture: () => ({base: {session: {uid: 'owner'}}}), isCurrent: () => true, assertCurrent: () => {}})}));
jest.mock('@/services/swapService', () => ({openSwapDispute: jest.fn()}));
jest.mock('expo-router', () => ({useLocalSearchParams: () => ({id: 'swap'})}));
const participant = (over: Partial<SwapParticipantContext> = {}): SwapParticipantContext => ({isInitiator: true, isReceiver: false, senderName: 'Camille', senderImage: undefined, senderItems: [], myItems: [], hasUploadedPhotos: false, hasConfirmedShipping: false, hasConfirmedReception: false, hasRated: false, isTopUpPayer: false, topUpPayerName: 'Camille', ...over});
const handlers = (): SwapActionHandlers => ({onAccept: jest.fn(), onDecline: jest.fn(), onCancel: jest.fn(), onPayTopUp: jest.fn(), onSetExchangeMode: jest.fn(), onUploadPhotos: jest.fn(), onConfirmShipping: jest.fn(), onConfirmReception: jest.fn(), onRate: jest.fn()});
function setup(status: SwapStatus, role: Partial<SwapParticipantContext> = {}, mode = 'shipping', optionsOnly = false, busy = false) {
  const h = handlers(); const view = render(<SwapActions status={status} participant={participant(role)} handlers={h} isProcessing={busy} exchangeMode={mode} optionsOnly={optionsOnly}/>); return {...view, h};
}
it('offers only acceptance in the primary proposal action; refusal stays in options', () => {
 const v = setup('proposed', {isInitiator: false, isReceiver: true}); fireEvent.press(v.getByText('Accepter la proposition')); expect(v.h.onAccept).toHaveBeenCalledTimes(1); expect(v.queryByText('Refuser la proposition')).toBeNull();
});
it.each(['proposed', 'payment_pending'] as const)('lets the initiator cancel %s from options', status => {
 const v = setup(status, {}, 'shipping', true); fireEvent.press(v.getByText('Annuler la proposition')); expect(v.h.onCancel).toHaveBeenCalledTimes(1);
});
it('does not offer cancellation of an accepted exchange', () => {const v = setup('accepted', {}, 'shipping', true); expect(v.queryByText('Annuler la proposition')).toBeNull();});
it('lets the recipient refuse only their proposed exchange', () => {const v = setup('proposed', {isInitiator: false, isReceiver: true}, 'shipping', true); fireEvent.press(v.getByText('Refuser la proposition')); expect(v.h.onDecline).toHaveBeenCalledTimes(1);});
it.each(['accepted', 'photos_pending', 'shipping'] as const)('confirms real receipt directly for a meetup in %s, without a fake shipment', status => {
 const v = setup(status, {}, 'hand_delivery'); fireEvent.press(v.getByText('J’ai reçu les articles')); expect(v.h.onConfirmReception).toHaveBeenCalledTimes(1); expect(v.queryByText('J’ai envoyé mes articles')).toBeNull(); expect(v.queryByText('Ajouter des photos')).toBeNull();
});
it('allows postal receipt after the other member sent, regardless of own shipment', () => {
 const v = setup('shipping', {counterpartHasShipped: true, hasConfirmedShipping: false}); fireEvent.press(v.getByText('J’ai reçu les articles')); expect(v.h.onConfirmReception).toHaveBeenCalledTimes(1); expect(v.h.onConfirmShipping).not.toHaveBeenCalled();
});
it('keeps the own outstanding postal shipment available in options after the other shipment', () => {const v = setup('shipping', {counterpartHasShipped: true}, 'shipping', true); fireEvent.press(v.getByText('J’ai envoyé mes articles')); expect(v.h.onConfirmShipping).toHaveBeenCalledTimes(1);});
it('never infers receipt from own shipping only', () => {const v = setup('shipping', {hasConfirmedShipping: true, counterpartHasShipped: false}); expect(v.queryByText('J’ai reçu les articles')).toBeNull();});
it('cannot invoke a processing action twice', () => {const v = setup('shipping', {}, 'shipping', false, true); fireEvent.press(v.getByLabelText('J’ai envoyé mes articles')); expect(v.h.onConfirmShipping).not.toHaveBeenCalled();});
it('shows the complement CTA only to the payer', () => {const v = setup('payment_pending', {isTopUpPayer: true}); fireEvent.press(v.getByText('Régler le complément')); expect(v.h.onPayTopUp).toHaveBeenCalledTimes(1);});
it('describes current Dev complements without calling them historical or disabled', () => {
 const s = {status: 'payment_pending', initiatorId: 'owner', receiverId: 'other', cashTopUp: {payerId: 'owner', amount: 500}} as Swap;
 expect(getSwapStatusLabel(s.status)).toBe('Complément à régler'); expect(getSwapNextStep(s, 'owner')).toContain('Réglez'); expect(getSwapNextStep(s, 'other')).toContain('attendez');
});

it('does not present fulfilment actions while exact agreement confirmations are missing', () => {
 const h = handlers(); const v = render(<SwapActions status="accepted" participant={participant()} handlers={h} isProcessing={false} exchangeMode="hand_delivery" agreementReady={false}/>);
 expect(v.queryByText('J’ai reçu les articles')).toBeNull(); expect(h.onConfirmReception).not.toHaveBeenCalled();
});
