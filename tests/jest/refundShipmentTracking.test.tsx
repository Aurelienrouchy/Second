import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import * as Haptics from 'expo-haptics';
import type { IssueRefundResult, Transaction } from '@/types/transaction';
import ShipmentTracking from '@/features/orders/components/ShipmentTracking';
let mockSheets: Record<string, {onSubmit: (reason: string, details: string) => Promise<void>; isSubmitting: boolean}> = {};

jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => 0,
selectUser: (state: {user: unknown}) => state.user, useAuthStore: (select: (state: {user: {id: string}}) => unknown) => select({user: {id: 'buyer'}})}));
jest.mock('@/features/orders/hooks/useAutomatedDecision', () => ({useAutomatedDecision: () => ({latestDecision: null, hasAutomatedDecision: false, contest: jest.fn(), isContesting: false})}));
jest.mock('@/components/RecourseReasonSheet', () => {
  const React = require('react');
  return {RecourseReasonSheet: React.forwardRef((props: {title: string; onSubmit: (reason: string, details: string) => Promise<void>; isSubmitting: boolean}, ref: unknown) => {mockSheets[props.title] = props; React.useImperativeHandle(ref, () => ({present: jest.fn(), dismiss: jest.fn()})); return null;})};
});
const tx = (overrides: Partial<Transaction> = {}): Transaction => ({id: 'sale', articleId: 'article', chatId: 'chat', buyerId: 'buyer', sellerId: 'seller', amount: 50, totalAmount: 50, shippingCost: 0, deliveryType: 'shipping', status: 'lost', createdAt: new Date(), ...overrides});
const response = (status: IssueRefundResult['status']): IssueRefundResult => ({success: status === 'succeeded', status, intentId: 'intent', refundId: 're', outstandingCardCents: status === 'succeeded' ? 0 : 5000, localReconciliationRequired: status === 'reconciliation_required', bankWaiting: false, actionRequired: status !== 'pending' && status !== 'succeeded', message: `État serveur ${status}`});
beforeEach(() => {mockSheets = {}; jest.spyOn(Alert, 'alert').mockImplementation(() => {});});
afterEach(() => {jest.restoreAllMocks();});

it.each(['pending', 'requires_action', 'unknown', 'failed', 'canceled', 'reconciliation_required', 'succeeded'] as const)('uses the real %s outcome from requestRefund and refreshes', async state => {
  const callable = jest.fn().mockResolvedValue({data: response(state)});
  (httpsCallable as jest.Mock).mockReturnValue(callable);
  const refresh = jest.fn();
  render(<ShipmentTracking transaction={tx()} onStatusUpdate={refresh} />);
  fireEvent.press(screen.getByText('Demander un remboursement'));
  const confirm = (Alert.alert as jest.Mock).mock.calls[0][2].find((button: {text: string}) => button.text === 'Confirmer la demande');
  await act(async () => {await confirm.onPress();});
  expect(callable).toHaveBeenCalledWith({transactionId: 'sale'});
  expect(refresh).toHaveBeenCalled();
  const last = (Alert.alert as jest.Mock).mock.calls.at(-1);
  expect(last?.[0] === 'Remboursement confirmé').toBe(state === 'succeeded');
  expect((Haptics.notificationAsync as jest.Mock).mock.calls.length > 0).toBe(state === 'succeeded');
});
it('keeps a terminal return PDF accessible after refetch/reopen and late failure', async () => {
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const returned = tx({status: 'return_requested', returnLabelUrl: 'https://example.test/return.pdf', returnTrackingNumber: 'RETURN'});
  const {rerender, unmount} = render(<ShipmentTracking transaction={returned} />);
  expect(screen.getByText('Voir l’étiquette de retour')).toBeTruthy();
  rerender(<ShipmentTracking transaction={{...returned, status: 'refunded', refund: {intentId: 'intent', state: 'succeeded', outstandingCardCents: 0, fundsAppliedAt: new Date()}}} />);
  fireEvent.press(screen.getByText('Voir l’étiquette de retour'));
  expect(Linking.openURL).toHaveBeenCalledWith('https://example.test/return.pdf');
  unmount();
  render(<ShipmentTracking transaction={{...returned, status: 'refund_action_required', refundBlocked: true, refund: {intentId: 'intent', state: 'failed', outstandingCardCents: 5000, fundsAppliedAt: new Date()}}} />);
  expect(screen.getByText('Remboursement à reprendre')).toBeTruthy();
  expect(screen.getByText('Voir l’étiquette de retour')).toBeTruthy();
  expect(screen.queryByText('Demander un remboursement')).toBeNull();
});
it('does not steer a bank precondition into an incompatible new report', async () => {
  (httpsCallable as jest.Mock).mockReturnValue(jest.fn().mockRejectedValue({code: 'functions/failed-precondition', message: 'Dossier bancaire à résoudre.'}));
  render(<ShipmentTracking transaction={tx()} />);
  fireEvent.press(screen.getByText('Demander un remboursement'));
  const confirm = (Alert.alert as jest.Mock).mock.calls[0][2].find((button: {text: string}) => button.text === 'Confirmer la demande');
  await act(async () => {await confirm.onPress();});
  expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[1]).toBe('Dossier bancaire à résoudre.');
  expect(JSON.stringify((Alert.alert as jest.Mock).mock.calls.at(-1))).not.toContain('Signaler un problème');
});
it('shipped/lost keep support without a report callable unsupported by the backend', () => {
  const {rerender} = render(<ShipmentTracking transaction={tx({status: 'shipped'})} />);
  expect(screen.queryByText('Signaler un problème')).toBeNull();
  expect(screen.getByText('Contacter l’équipe')).toBeTruthy();
  rerender(<ShipmentTracking transaction={tx({status: 'delivered', fundsReleaseAt: new Date(Date.now() + 86400000)})} />);
  expect(screen.getByText('Signaler un problème')).toBeTruthy();
});
it('does not treat a null card debt as a settled amount', () => {
  render(<ShipmentTracking transaction={tx({status: 'refund_action_required', refundBlocked: true, refund: {intentId: 'intent', state: 'unknown', outstandingCardCents: null}})} />);
  expect(screen.getByText('Montant sur le moyen de paiement à vérifier.')).toBeTruthy();
  expect(screen.queryByText('Remboursement confirmé')).toBeNull();
});
it('does not promise parcel preparation on a historical cancelled agreement without a scan', () => {
  render(<ShipmentTracking transaction={tx({status: 'cancelled'})} />);
  expect(screen.getByText('Suivi du transport indisponible')).toBeTruthy();
  expect(screen.queryByText('Le vendeur prépare votre colis')).toBeNull();
  expect(screen.getByText('Contacter l’équipe')).toBeTruthy();
});
it('does not announce a delayed refund result against another selected agreement', async () => {
  let resolve!: (value: unknown) => void;
  (httpsCallable as jest.Mock).mockReturnValue(jest.fn(() => new Promise(res => {resolve = res;})));
  const {rerender} = render(<ShipmentTracking transaction={tx()} />);
  fireEvent.press(screen.getByText('Demander un remboursement'));
  const confirm = (Alert.alert as jest.Mock).mock.calls[0][2].find((button: {text: string}) => button.text === 'Confirmer la demande');
  let work!: Promise<void>;
  act(() => {work = confirm.onPress();});
  rerender(<ShipmentTracking transaction={tx({id: 'another-sale', status: 'paid'})} />);
  await act(async () => {resolve({data: response('succeeded')}); await work;});
  expect((Alert.alert as jest.Mock).mock.calls).toHaveLength(1);
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

it('keeps active refund errors actionable, but their deferred buttons become inert on a new agreement', async () => {
  (httpsCallable as jest.Mock).mockReturnValue(jest.fn().mockRejectedValue({code: 'functions/failed-precondition', message: 'Dossier bancaire à résoudre.'}));
  const refresh = jest.fn();
  const view = render(<ShipmentTracking transaction={tx()} onStatusUpdate={refresh} />);
  fireEvent.press(screen.getByText('Demander un remboursement'));
  const confirm = (Alert.alert as jest.Mock).mock.calls[0][2][1];
  await act(async () => {await confirm.onPress();});
  expect(refresh).toHaveBeenCalled();
  expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[1]).toBe('Dossier bancaire à résoudre.');
  const retryRefresh = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2][0];
  view.rerender(<ShipmentTracking transaction={tx({id: 'new-sale'})} />);
  refresh.mockClear();
  act(() => retryRefresh.onPress());
  expect(refresh).not.toHaveBeenCalled();
});

it.each(['Signaler un problème', 'Demander un retour'])('an old %s sheet cannot submit against a new agreement', async title => {
  const callable = jest.fn(); (httpsCallable as jest.Mock).mockReturnValue(callable);
  const view = render(<ShipmentTracking transaction={tx({status: 'delivered'})} />);
  const oldSubmit = mockSheets[title].onSubmit;
  view.rerender(<ShipmentTracking transaction={tx({id: 'new-sale', status: 'delivered'})} />);
  await act(async () => {await oldSubmit('other', 'Ancienne saisie');});
  expect(callable).not.toHaveBeenCalled();
});

it.each(['Signaler un problème', 'Demander un retour'])('an in-flight %s error does not refresh or alert the new agreement', async title => {
  let reject!: (error: unknown) => void;
  const callable = jest.fn(() => new Promise((_resolve, no) => {reject = no;}));
  (httpsCallable as jest.Mock).mockReturnValue(callable);
  const refresh = jest.fn();
  const view = render(<ShipmentTracking transaction={tx({status: 'delivered'})} onStatusUpdate={refresh} />);
  let work!: Promise<void>;
  act(() => {work = mockSheets[title].onSubmit('other', 'Ancienne saisie');});
  view.rerender(<ShipmentTracking transaction={tx({id: 'new-sale', status: 'delivered'})} />);
  await act(async () => {reject(new Error('Old failure')); await work;});
  expect(refresh).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('an old return finally does not release the new return busy state', async () => {
  let resolveOld!: (value: unknown) => void; let resolveNew!: (value: unknown) => void;
  (httpsCallable as jest.Mock).mockReturnValue(jest.fn()
    .mockImplementationOnce(() => new Promise(resolve => {resolveOld = resolve;}))
    .mockImplementationOnce(() => new Promise(resolve => {resolveNew = resolve;})));
  const view = render(<ShipmentTracking transaction={tx({status: 'delivered'})} />);
  let oldWork!: Promise<void>; act(() => {oldWork = mockSheets['Demander un retour'].onSubmit('other', '');});
  view.rerender(<ShipmentTracking transaction={tx({id: 'new-sale', status: 'delivered'})} />);
  let newWork!: Promise<void>; act(() => {newWork = mockSheets['Demander un retour'].onSubmit('other', '');});
  await act(async () => {resolveOld({data: {success: true}}); await oldWork;});
  expect(mockSheets['Demander un retour'].isSubmitting).toBe(true);
  expect(Alert.alert).not.toHaveBeenCalled();
  await act(async () => {resolveNew({data: {success: true}}); await newWork;});
  expect(mockSheets['Demander un retour'].isSubmitting).toBe(false);
  expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[0]).toBe('Demande de retour envoyée');
});
