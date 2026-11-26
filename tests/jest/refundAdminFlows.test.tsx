import AsyncStorage from '@react-native-async-storage/async-storage';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getDocs, where } from 'firebase/firestore';
import * as Firestore from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth } from '@/config/firebaseConfig';
import { getAdminCapturePage, getAdminRefundPage, requireAdminClaim, type CaptureAnomaly } from '@/services/adminFinancialService';
import { TransactionService } from '@/services/transactionService';
import { AdminCaptureCard } from '@/features/admin/components/AdminCaptureCard';
import { AdminRefundCard } from '@/features/admin/components/AdminRefundCard';
import { AdminFinancialQueue } from '@/features/admin/components/AdminFinancialQueue';
import type { Transaction } from '@/types/transaction';

const mockUser = {id: 'admin'};
jest.mock('@/hooks/useAuth', () => ({
  useAuthenticatedUid: () => require('@/config/firebaseConfig').auth.currentUser?.uid ?? null,
  useAuthenticatedIdentity: () => { const user = require('@/hooks/useAuth').useUser(); return user?.id === require('@/config/firebaseConfig').auth.currentUser?.uid ? user : null; },
  useAuthenticatedSession: () => ({ uid: require('@/config/firebaseConfig').auth.currentUser?.uid ?? null, identity: require('@/hooks/useAuth').useAuthenticatedIdentity() }),
  useAuthGuardSession: () => ({ normalUser: require('@/hooks/useAuth').useUser(), identity: require('@/hooks/useAuth').useAuthenticatedIdentity(), isAuthLoading: false }),
useUser: () => mockUser}));
jest.mock('@/services/swapService', () => ({resolveSwapDispute: jest.fn()}));
jest.mock('@/features/admin', () => ({
 ...Object.fromEntries(['AdminSectionNav','AdminFinancialQueue','AdminReturnToSenderFinancialEntry','AdminReturnToSenderFinancialReview','AdminExceptionalRestitutionHistory','AdminOrphanCaptureRefundHistory','AdminTransportFinancialEntry','AdminTransportFinancialReview','AdminTransportFinancialHistory','AdminParcelClaimHistoryPanel','AdminProductFinancialEntry','AdminProductFinancialHistory','AdminPurchaseRefundEntry','AdminPurchaseRefundHistory','AdminRefundRepairHistory','AdminBankDisputeCases','AdminSwapDisputeReview'].map(name => [name, () => null])),
 AdminFinancialReauthentication: jest.requireActual('@/features/admin/components/AdminFinancialReauthentication').AdminFinancialReauthentication,
}));
jest.mock('@/components/ui/Skeleton', () => ({Skeleton: () => null, SkeletonText: () => null}));
jest.mock('@shopify/flash-list', () => {
  const React = require('react'); const {View} = require('react-native');
  return {FlashList: (props: {data: unknown[]; renderItem: (arg: {item: unknown}) => React.ReactNode; ListEmptyComponent?: React.ComponentType | React.ReactNode; ListFooterComponent?: React.ReactNode}) => React.createElement(View, {}, props.data.map((item, index) => React.createElement(View, {key: index}, props.renderItem({item}))), !props.data.length ? typeof props.ListEmptyComponent === 'function' ? React.createElement(props.ListEmptyComponent) : props.ListEmptyComponent : null, props.ListFooterComponent)};
});
import AdminDisputesScreen from '@/app/admin/disputes';
const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({id: 'sale', buyerId: 'buyer', sellerId: 'seller', articleId: 'article', amount: 50, totalAmount: 50, shippingCost: 0, deliveryType: 'shipping', status: 'refund_action_required', createdAt: new Date(), ...overrides});
const capture: CaptureAnomaly = {id: 'capture_case', firstEvidence: {observedPaymentIntentId: 'pi_unassigned', originalPaymentIntentId: 'pi_original', candidateReference: 'candidate', collectedAmountCents: null, requestedAmountCents: 5000, currency: 'cad'}, lastEvidence: {collectedAmountCents: null}, currentProviderProof: null, providerLookupState: 'not_checked', status: 'pending', actionRequired: true};
let client: QueryClient;
beforeEach(async () => {
  await AsyncStorage.clear();
  establishIdentityFixture('admin');
  client = new QueryClient({defaultOptions: {queries: {retry: false}}});
  Object.assign(auth, {currentUser: {...auth.currentUser, uid: 'admin', getIdTokenResult: jest.fn().mockResolvedValue({claims: {admin: true, auth_time: Math.floor(Date.now()/1000), firebase: {sign_in_provider: 'password'}}})}});
  (httpsCallable as jest.Mock).mockImplementation((_functions: unknown, name: string) => name === 'readSupportRequests' ? jest.fn(async (payload: {expectedUid: string; scope: string}) => ({data: {protocol:'support_list_v1', actorId:payload.expectedUid, scope:payload.scope, items:[], cursor:null, hasMore:false, completeHistory:true}})) : jest.fn(async () => ({data:{}})));
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {jest.restoreAllMocks(); client.clear(); clearIdentityFixture();});

it('uses only a verified custom claim, denies profile-like data and reads no private files', async () => {
  Object.assign(auth, {currentUser: {...auth.currentUser, uid: 'admin', isAdmin: true, getIdTokenResult: jest.fn().mockResolvedValue({claims: {}})}});
  expect(await requireAdminClaim('admin')).toBe(false);
  await expect(getAdminRefundPage('admin')).rejects.toThrow('administrateur');
  expect(getDocs).not.toHaveBeenCalled();
});
it('discovers a refund without a disputes doc and retains pagination through a filtered empty page', async () => {
  (getDocs as jest.Mock).mockResolvedValueOnce({docs: [{id: 'sale', data: () => ({status: 'refund_in_progress', refundBlocked: true})}]}).mockResolvedValueOnce({docs: Array.from({length: 50}, (_, index) => ({id: `closed-${index}`, data: () => ({status: 'refunded', refund: {intentId: 'i', state: 'succeeded', fundsAppliedAt: new Date(), outstandingCardCents: 0}})}))});
  const first = await getAdminRefundPage('admin');
  expect(first.items.map(item => item.id)).toEqual(['sale']);
  const filtered = await getAdminRefundPage('admin', first.cursor);
  expect(filtered.items).toEqual([]);
  expect(filtered.hasMore).toBe(true);
  expect(filtered.cursor).toBe('closed-49');
});
it('maps current provider proof from payload, keeping unknown sums distinct from planned sums', async () => {
  (getDocs as jest.Mock).mockResolvedValue({docs: [{id: 'capture_case', data: () => ({type: 'payment_capture_reconciliation', status: 'pending', payload: {signedEvidence: capture.firstEvidence, lastSignedEvidence: capture.firstEvidence, providerLookupState: 'verified', currentProviderProof: {paymentIntentId: 'pi_unassigned', collectedAmountCents: 5000, currency: 'cad'}}})}]});
  const page = await getAdminCapturePage('admin');
  expect(page.items[0].firstEvidence.collectedAmountCents).toBeNull();
  expect(page.items[0].currentProviderProof?.collectedAmountCents).toBe(5000);
  expect(page.items[0].providerLookupState).toBe('verified');
  expect(where).toHaveBeenCalledWith('type', '==', 'payment_capture_reconciliation');
});
it.each(['verified', 'invalid', 'unavailable'] as const)('inspection %s always remains open and never enables a refund/close', async state => {
  const callable = jest.fn().mockResolvedValue({data: {operationId: capture.id, status: 'pending', actionRequired: true, automaticRefundAllowed: false, providerLookupState: state}});
  (httpsCallable as jest.Mock).mockReturnValue(callable);
  const refresh = jest.fn();
  render(<AdminCaptureCard anomaly={capture} onRefresh={refresh} />);
  fireEvent.press(screen.getByText('Vérifier le paiement'));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(callable).toHaveBeenCalledWith({operationId: capture.id});
  expect(screen.getByText(/Dossier ouvert/)).toBeTruthy();
  expect(screen.queryByText('Clore')).toBeNull();
  expect(screen.queryByText('Rembourser')).toBeNull();
  expect(screen.getAllByText(/Montant à vérifier/).length).toBeGreaterThan(0);
});
it('offers admissible retry despite refundBlocked and renders a pending result honestly', async () => {
  jest.spyOn(TransactionService, 'retryPurchaseRefund').mockResolvedValue({success: false, status: 'pending', intentId: 'i', refundId: null, actionRequired: false, outstandingCardCents: 4000, bankWaiting: false, localReconciliationRequired: false, message: 'Confirmation attendue.'});
  const refresh = jest.fn();
  render(<AdminRefundCard transaction={transaction({refundBlocked: true, refund: {intentId: 'i', state: 'failed', providerStatus: 'failed', paymentIntentId: 'pi', stripeRefundId: 're', cardAmountCents: 4000, outstandingCardCents: 4000}})} onRefresh={refresh} />);
  fireEvent.press(screen.getByText('Réessayer le remboursement'));
  const confirm = (Alert.alert as jest.Mock).mock.calls[0][2][1];
  await act(async () => {await confirm.onPress();});
  expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[0]).toBe('Remboursement en cours');
  expect(refresh).toHaveBeenCalled();
});
it('closes only the exact cash case after preview, operator note and initially unchecked confirmation, without a financial RPC', async () => {
  (getDocs as jest.Mock).mockResolvedValue({docs: [{id: 'dispute', data: () => ({type: 'meetup_no_show', transactionId: 'sale', status: 'open', articleTitle: 'Veste', createdAt: {toDate: () => new Date()}})}]});
  jest.spyOn(TransactionService, 'getTransaction').mockResolvedValue(transaction({status: 'disputed', deliveryType: 'meetup'}));
  const hash = (value: unknown) => require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex') as string;
  const preview = {protocol: 'cash_case_preview_v1', previewId: 'a'.repeat(64), actorUid: 'admin', transactionId: 'sale', expectedDisputeId: 'dispute', decisionType: 'buyer_upheld',
    sourceHash: 'b'.repeat(64), sourceVersion: 1, buyerId: 'buyer', sellerId: 'seller', cashAgreementId: 'c'.repeat(64), reservationReleaseId: 'd'.repeat(64),
    reservationReleased: true, reservationRestored: false, moneyMovementPlanned: false, outsidePaymentVerified: false, physicalHandoverVerified: false, remainingOpenDisputeIds: []};
  const rpc = jest.fn(async (input: Record<string, unknown>) => {
    if (input.mode === 'preview') return {data: preview};
    const command = {transactionId: input.transactionId, expectedDisputeId: input.expectedDisputeId, adminUid: input.expectedAdminUid, requestId: input.requestId,
      previewId: input.previewId, expectedSourceHash: input.expectedSourceHash, note: input.note, decisionType: input.decisionType};
    return {data: {protocol: 'cash_case_decision_v1', transactionId: input.transactionId, expectedDisputeId: input.expectedDisputeId, actorUid: input.expectedAdminUid,
      requestId: input.requestId, previewId: input.previewId, sourceHash: input.expectedSourceHash, note: input.note, decisionType: input.decisionType,
      decisionId: hash(['cash_no_show', input.transactionId, input.expectedAdminUid, input.requestId]), payloadHash: hash(Object.fromEntries(Object.entries(command).sort(([a],[b]) => a.localeCompare(b)))),
      outcome: 'recorded', buyerId: 'buyer', sellerId: 'seller', committedAt: '2026-11-25T18:00:00.000Z', moneyMoved: false, reservationRestored: false, outsidePaymentVerified: false,
      physicalHandoverVerified: false, retryPermissionGranted: false, decisionCommitted: true, effectsCommitted: true, intentionNeutralized: false, lateRequestBlocked: true,
      cashAgreementId: preview.cashAgreementId, reservationReleaseId: preview.reservationReleaseId, reservationReleased: true, disputesClosed: 1, disputeIds: ['dispute'], remainingOpenDisputeIds: [], notificationCommitted: true, notificationIds: ['notice-buyer','notice-seller'], deviceDeliveryVerified: false, readingVerified: false}};
  });
  const supportIO = (httpsCallable as jest.Mock).getMockImplementation()!;
  (httpsCallable as jest.Mock).mockImplementation((functions: unknown, name: string) => name === 'closeMeetupNoShow' ? rpc : supportIO(functions,name));
  render(<QueryClientProvider client={client}><AdminDisputesScreen /></QueryClientProvider>);
  fireEvent.press(await screen.findByText('Clôturer (acheteur)'));
  const submit = await screen.findByRole('button', {name: 'Enregistrer ce classement'}); expect(submit).toBeDisabled(); expect(rpc).toHaveBeenCalledTimes(1);
  fireEvent.changeText(screen.getByPlaceholderText('Note opérateur obligatoire'), 'Décision documentaire après lecture des deux versions.');
  expect(submit).toBeDisabled(); fireEvent.press(screen.getByText('Je confirme le classement de ce dossier précis avec ces faits examinés et cette note.'));
  await waitFor(() => expect(submit).toBeEnabled()); fireEvent.press(submit);
  await waitFor(() => expect(screen.getByText(/Le dossier ciblé a été classé/)).toBeOnTheScreen());
  expect(rpc).toHaveBeenCalledTimes(2); expect(rpc.mock.calls[1][0]).toMatchObject({mode: 'confirm', accepted: true, expectedAdminUid: 'admin', transactionId: 'sale', expectedDisputeId: 'dispute', previewId: preview.previewId, expectedSourceHash: preview.sourceHash});
  expect((httpsCallable as jest.Mock).mock.calls.every(([,name]) => ['closeMeetupNoShow','readSupportRequests'].includes(name))).toBe(true);
});

it.each([true, false])('shows both versions before deciding even when dispute link persisted = %s', async linked => {
  (getDocs as jest.Mock).mockResolvedValue({docs: [{id: 'two-versions', data: () => ({type: 'meetup_no_show', transactionId: 'sale', status: 'open', details: 'Je suis venu au lieu convenu.', reportedBy: 'buyer',
    ...(linked ? {counterReportedBy: 'seller', counterReason: 'other_party_no_show', counterDetails: 'J’étais également présent.'} : {})})}]});
  jest.spyOn(TransactionService, 'getTransaction').mockResolvedValue(transaction({status: 'disputed', deliveryType: 'meetup', counterReport: {reportedBy: 'seller', reason: 'other_party_no_show', details: 'J’étais également présent.', reportedAt: new Date()}}));
  render(<QueryClientProvider client={client}><AdminDisputesScreen /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Je suis venu au lieu convenu.')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('J’étais également présent.')).toBeTruthy());
  expect(screen.getByText(linked ? 'Version de l’autre partie — dossier de litige' : 'Version conservée avec la commande')).toBeTruthy();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('admin purchase refund pending does not announce dispute closure or financial success', async () => {
  (getDocs as jest.Mock).mockResolvedValue({docs: [{id: 'shipping-dispute', data: () => ({type: 'transaction_problem', transactionId: 'sale', status: 'open'})}]});
  jest.spyOn(TransactionService, 'getTransaction').mockResolvedValue(transaction({status: 'delivery_failed'}));
  jest.spyOn(TransactionService, 'adminRefundTransaction').mockResolvedValue({success: false, status: 'pending', intentId: 'i', refundId: 're', outstandingCardCents: 5000, actionRequired: false, localReconciliationRequired: false, bankWaiting: false, message: 'Confirmation attendue.'});
  render(<QueryClientProvider client={client}><AdminDisputesScreen /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Rembourser l’acheteur')).toBeTruthy());
  await waitFor(() => expect(TransactionService.getTransaction).toHaveBeenCalled());
  fireEvent.press(screen.getByText('Rembourser l’acheteur'));
  await act(async () => {await (Alert.alert as jest.Mock).mock.calls[0][2][1].onPress();});
  expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[0]).toBe('Remboursement en cours');
  expect(screen.getByText('Ouvert')).toBeTruthy();
});

it('admin queue continues after an empty filtered page and discovers the next active refund', async () => {
  (getDocs as jest.Mock).mockResolvedValueOnce({docs: Array.from({length: 50}, (_, index) => ({id: `settled-${index}`, data: () => ({status: 'refunded', refund: {intentId: 'i', state: 'succeeded', fundsAppliedAt: new Date(), outstandingCardCents: 0}})}))})
    .mockResolvedValueOnce({docs: [{id: 'refund-without-dispute', data: () => ({status: 'refund_in_progress', refundBlocked: true})}]});
  render(<QueryClientProvider client={client}><AdminFinancialQueue mode="refunds" userId="admin" /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Voir les suivants')).toBeTruthy());
  expect(screen.getByText(/Aucun dossier sur les pages parcourues/)).toBeTruthy();
  fireEvent.press(screen.getByText('Voir les suivants'));
  await waitFor(() => expect(screen.getByText('Commande refund-without-dispute')).toBeTruthy());
  expect(screen.queryByText('Voir les suivants')).toBeNull();
});

it('paginates all disputes by ascending ID, retains missing dates and preserves the open descending query', async () => {
  // These query doubles inspect the real screen wiring, not SDK availability.
  type Constraint = {kind: string; field?: string; direction?: string; value?: unknown};
  const fixtures = Array.from({length: 55}, (_, index) => ({
    id: `d${String(index).padStart(2, '0')}`,
    data: () => ({articleTitle: `Dossier ${index}`, status: index % 2 ? 'resolved' : 'open',
      ...(index === 1 || index === 51 ? {} : {createdAt: {toDate: () => new Date('2026-01-01T00:00:00Z')}})}),
  }));
  (jest.spyOn(Firestore, 'orderBy') as jest.Mock).mockImplementation((field: string, direction: string) => ({kind: 'order', field, direction}));
  (jest.spyOn(Firestore, 'where') as jest.Mock).mockImplementation((field: string, _operator: string, value: unknown) => ({kind: 'where', field, value}));
  (jest.spyOn(Firestore, 'startAfter') as jest.Mock).mockImplementation((value: string) => ({kind: 'cursor', value}));
  (jest.spyOn(Firestore, 'limit') as jest.Mock).mockImplementation((value: number) => ({kind: 'limit', value}));
  (jest.spyOn(Firestore, 'query') as jest.Mock).mockImplementation((_collection: unknown, ...constraints: Constraint[]) => ({constraints}));
  (getDocs as jest.Mock).mockImplementation(async ({constraints}: {constraints: Constraint[]}) => {
    if (constraints.some(c => c.kind === 'where')) return {docs: []};
    const direction = constraints.find(c => c.kind === 'order')?.direction;
    const ordered = direction === 'desc' ? [...fixtures].reverse() : fixtures;
    const cursor = constraints.find(c => c.kind === 'cursor')?.value;
    const start = cursor ? ordered.findIndex(doc => doc.id === cursor) + 1 : 0;
    return {docs: ordered.slice(start, start + 50)};
  });
  render(<QueryClientProvider client={client}><AdminDisputesScreen /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Aucun litige')).toBeTruthy());
  expect(Firestore.orderBy).toHaveBeenLastCalledWith('__name__', 'desc');
  expect(where).toHaveBeenCalledWith('status', '==', 'open');

  fireEvent.press(screen.getByRole('tab', {name: 'Tous'}));
  await waitFor(() => expect(getDocs).toHaveBeenCalledTimes(2));
  expect(Firestore.orderBy).toHaveBeenLastCalledWith('__name__', 'asc');
  await waitFor(() => expect(screen.getByText('Dossier 1')).toBeTruthy());
  expect(screen.getByText('Dossier 49')).toBeTruthy();
  expect(screen.queryByText('Dossier 50')).toBeNull();
  expect((Firestore.query as jest.Mock).mock.calls.at(-1)?.slice(1)).toEqual([
    {kind: 'order', field: '__name__', direction: 'asc'}, {kind: 'limit', value: 50},
  ]);
  fireEvent.press(screen.getByText('Voir les suivants'));
  await waitFor(() => expect(screen.getByText('Dossier 51')).toBeTruthy());
  expect(screen.getByText('Dossier 54')).toBeTruthy();
  expect(screen.getAllByText(/^Dossier \d+$/)).toHaveLength(55);
  expect(Firestore.startAfter).toHaveBeenLastCalledWith('d49');
  expect(Firestore.orderBy).toHaveBeenLastCalledWith('__name__', 'asc');
  expect(screen.queryByText('Voir les suivants')).toBeNull();
});

it('does not query dispute pages from the screen without the verified admin claim', async () => {
  Object.assign(auth, {currentUser: {...auth.currentUser, uid: 'admin', isAdmin: true, getIdTokenResult: jest.fn().mockResolvedValue({claims: {}})}});
  render(<QueryClientProvider client={client}><AdminDisputesScreen /></QueryClientProvider>);
  await waitFor(() => expect(client.getQueriesData({queryKey:['admin-access']})[0]?.[1]).toBe(false));
  expect(getDocs).not.toHaveBeenCalled();
  expect(screen.queryByRole('tab', {name: 'Tous'})).toBeNull();
});
