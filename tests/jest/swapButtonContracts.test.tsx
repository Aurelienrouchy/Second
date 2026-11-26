import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {auth} from '@/config/firebaseConfig';
const mockDispatch = jest.fn();
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: true}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1, useAuthStore: {getState: () => ({authenticatedUid: 'owner'})}}));
jest.mock('firebase/functions', () => ({httpsCallable: (_functions: unknown, name: string) => (input: unknown) => mockDispatch(name, input)}));
jest.mock('@/components/ui', () => ({Text: require('react-native').Text}));
import {ValueComparisonBox} from '@/features/swap/components/propose/ValueComparisonBox';
import {confirmShipping, removeItemFromParty, proposeSwap} from '@/services/swapService';
beforeEach(() => {
  (auth as unknown as {currentUser: {uid: string}}).currentUser = {uid: 'owner'};
  mockDispatch.mockResolvedValue({data: {success: true}});
});
it('preserves the decimal comma rather than turning 12,50 into 1250 dollars', () => {
  const change = jest.fn();
  const view = render(<ValueComparisonBox initiatorTotal={20} receiverTotal={32.5} complementAmount=""
    complementPayer="initiator" receiverName="Membre" onComplementAmountChange={change} onComplementPayerChange={() => undefined}/>);
  fireEvent.changeText(view.getByLabelText('Montant du complément en dollars'), '12,50');
  expect(change).toHaveBeenCalledWith('12,50');
});
it('rejects a false shipping receipt instead of presenting the declaration as recorded', async () => {
  mockDispatch.mockResolvedValue({data: {success: false}});
  await expect(confirmShipping('swap', 'owner')).rejects.toThrow('confirmer le résultat');
  expect(mockDispatch).toHaveBeenCalledWith('confirmSwapShipping', {swapId: 'swap', expectedUid: 'owner'});
});
it('binds a deposit removal to the captured owner and validates its native reply', async () => {
  await removeItemFromParty('generalist', 'article', 'owner');
  expect(mockDispatch).toHaveBeenCalledWith('removeItemFromPartySecure', {partyId: 'generalist', articleId: 'article', expectedUid: 'owner'});
  mockDispatch.mockResolvedValue({data: {success: false}});
  await expect(removeItemFromParty('generalist', 'article', 'owner')).rejects.toThrow('retrait');
});
it('does not dispatch a deposit removal from an obsolete confirmation', async () => {
  await expect(removeItemFromParty('generalist', 'article', 'owner', () => {throw new Error('Changed dossier');})).rejects.toThrow('Changed dossier');
  expect(mockDispatch).not.toHaveBeenCalled();
});
it('never treats a malformed proposal reply as a newly created swap', async () => {
  mockDispatch.mockResolvedValue({data: {success: true}});
  await expect(proposeSwap({initiatorId: 'owner', initiatorName: 'Membre', initiatorItems: [{articleId: 'a', title: 'A', price: 20}],
    receiverId: 'other', receiverName: 'Autre', receiverItems: [{articleId: 'b', title: 'B', price: 20}], expectedUid: 'owner',
    exchangeMode: 'hand_delivery', arrangements: 'Métro', agreementProtocol: 'swap_exchange_agreement_v1', expectedSourceHash: 'a'.repeat(64)})).rejects.toThrow('envoi');
});
