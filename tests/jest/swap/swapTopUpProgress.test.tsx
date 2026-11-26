import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {SwapTopUpCheckoutPanel} from '@/components/SwapTopUpCheckoutPanel';
const mockJournal = {read: jest.fn(), prepare: jest.fn(), executeNew: jest.fn(), observe: jest.fn(), acknowledge: jest.fn()};
let mockPending: unknown = null;
let mockSource: Record<string, unknown>;
const mockPreview = jest.fn();
jest.mock('@/components/ui', () => ({Button: jest.requireActual('@/components/ui/Button').Button, Checkbox: jest.requireActual('@/components/ui/Checkbox').Checkbox}));
jest.mock('@/components/AccountRelationshipReauthentication', () => ({AccountRelationshipReauthentication: () => null}));
jest.mock('@/components/SwapTopUpCheckoutResult', () => ({SwapTopUpCheckoutResult: () => null}));
jest.mock('@/hooks/useAuth', () => ({useUser: () => ({id: 'owner'})}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({focused: true, focusRevision: 'scope', capture: () => ({}), start: () => ({base: {session: {uid: 'owner'}}}), assertCurrent: () => {}, isCurrent: () => true, finish: () => {}})}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1}));
jest.mock('@/services/tradeOperation', () => ({isTradeProfileCurrent: () => true}));
jest.mock('@/services/swapTopUpCheckoutService', () => ({SwapTopUpCheckoutService: {preview: (...args: unknown[]) => mockPreview(...args)}, swapTopUpFailure: () => new Error('payment error')}));
jest.mock('@/services/swapTopUpCheckoutJournal', () => ({SwapTopUpCheckoutJournal: {read: (...args: unknown[]) => mockJournal.read(...args), prepare: (...args: unknown[]) => mockJournal.prepare(...args), executeNew: (...args: unknown[]) => mockJournal.executeNew(...args), observe: (...args: unknown[]) => mockJournal.observe(...args), acknowledge: (...args: unknown[]) => mockJournal.acknowledge(...args)}}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: true, SWAP_TOPUP_MANUAL_ENABLED: true}));
jest.mock('@/config/stripeConfig', () => ({CHECKOUT_RETURN_URL: 'seconde-dev:///payment-return'}));
jest.mock('@/lib/stripe', () => ({useStripe: () => ({createPaymentMethod: jest.fn(), handleNextAction: jest.fn()}), CardField: () => require('react').createElement(require('react-native').Text, {}, 'Votre carte')}));
jest.mock('expo-crypto', () => ({randomUUID: () => 'request'}));
const clients: QueryClient[] = [];
const mount = () => {const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}}); clients.push(client); return render(<QueryClientProvider client={client}><SwapTopUpCheckoutPanel uid="owner" swapId="swap" scope="own"/></QueryClientProvider>);};
beforeEach(() => {
 jest.clearAllMocks(); mockPending = null;
 mockSource = {sourceHash: 'source', manualEnabled: true, amounts: {baseCents: 500, serviceFeeCents: 175, taxCents: 0, totalCents: 675}, preparation: {qualification: 'native_unstarted', canPrepareNow: true}, payment: null};
 mockPreview.mockImplementation(async () => mockSource);
 mockJournal.read.mockImplementation(async () => mockPending);
 mockJournal.prepare.mockImplementation(async attempt => {mockPending = attempt;});
 mockJournal.executeNew.mockImplementation(async () => {mockSource = {...mockSource, preparation: {qualification: 'native_manual_intention', canPrepareNow: false}, payment: {paymentIntentId: 'pi_test', intentId: 'native', intentVersion: 1, providerStatus: 'requires_payment_method', confirmationMethod: 'manual', action: 'confirmOnServer'}};});
 mockJournal.observe.mockResolvedValue({state: 'received', recordedAt: '2026-10-29T12:00:00.000Z'});
 mockJournal.acknowledge.mockImplementation(async () => {mockPending = null;});
});
afterEach(() => {clients.forEach(client => client.clear()); clients.length = 0;});
it('continues to the card after the exact prepare receipt without a technical journal detour or automatic confirmation', async () => {
 const v = mount(); await waitFor(() => expect(v.getByText('Continuer vers le paiement')).toBeTruthy());
 fireEvent.press(v.getByRole('checkbox')); fireEvent.press(v.getByText('Continuer vers le paiement'));
 await waitFor(() => expect(v.getByText('Votre carte')).toBeTruthy());
 expect(mockJournal.executeNew).toHaveBeenCalledTimes(1); expect(mockJournal.observe).toHaveBeenCalledTimes(1); expect(mockJournal.acknowledge).toHaveBeenCalledTimes(1);
 expect(mockJournal.executeNew.mock.calls[0][0].command.action).toBe('prepare'); expect(v.getByText('Payer le complément')).toBeDisabled();
});
it('keeps an unknown payment and resumes only its observation, without a second execute or clearance', async () => {
 mockJournal.executeNew.mockRejectedValue(new Error('lost response')); mockJournal.observe.mockResolvedValue({state: 'unknown', recordedAt: null});
 const v = mount(); await waitFor(() => expect(v.getByText('Continuer vers le paiement')).toBeTruthy());
 fireEvent.press(v.getByRole('checkbox')); fireEvent.press(v.getByText('Continuer vers le paiement'));
 await waitFor(() => expect(v.getByText('Reprendre le paiement')).toBeTruthy());
 fireEvent.press(v.getByText('Reprendre le paiement'));
 await waitFor(() => expect(mockJournal.observe).toHaveBeenCalledTimes(1));
 expect(mockJournal.executeNew).toHaveBeenCalledTimes(1); expect(mockJournal.acknowledge).not.toHaveBeenCalled(); expect(mockPending).not.toBeNull();
});

it('finishes a known pending receipt without turning its successful refresh into an error', async () => {
 mockPending = {uid: 'owner', swapId: 'swap', requestId: 'previous', command: {scope: 'own', action: 'prepare'}};
 const v = mount(); await waitFor(() => expect(v.getByText('Reprendre le paiement')).toBeTruthy()); fireEvent.press(v.getByText('Reprendre le paiement'));
 await waitFor(() => expect(v.getByText('Votre paiement est à jour. Vous pouvez poursuivre.')).toBeTruthy());
 expect(v.queryByText('Le suivi n’a pas pu être chargé. Votre paiement est conservé.')).toBeNull(); expect(mockJournal.acknowledge).toHaveBeenCalledTimes(1); expect(mockJournal.executeNew).not.toHaveBeenCalled();
});
