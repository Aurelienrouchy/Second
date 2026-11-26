import React from 'react';
import {createHash} from 'node:crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {Alert, AppState, Linking, type AppStateStatus} from 'react-native';
import {QueryCache, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {doc, getDocFromServer} from 'firebase/firestore';
import {httpsCallable} from 'firebase/functions';
import * as Haptics from 'expo-haptics';
import {supportCommandHash} from '@/services/supportRequestService';
import {RecourseReasonSheet} from '@/components/RecourseReasonSheet';
import {establishIdentityFixture, clearIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import type {IssueRefundResult, ReturnRequestResult, Transaction} from '@/types/transaction';
import ShipmentTracking from '@/features/orders/components/ShipmentTracking';

let mockFocused = true;
const mockRouter = {push: jest.fn(), back: jest.fn(), replace: jest.fn()};
jest.mock('expo-router', () => ({useRouter: () => mockRouter, useNavigation: () => ({isFocused: () => mockFocused}),
  useFocusEffect: (callback: () => void | (() => void)) => {const React = require('react');
    React.useEffect(() => {if (mockFocused) return callback();}, [callback, mockFocused]);}}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
// Native sheet I/O only: the real RecourseReasonSheet retains opening, drafts,
// selections, disabled state and submit guards above this boundary.
jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react'), {View, ScrollView, TextInput} = require('react-native');
  const Sheet = React.forwardRef((props: {children: React.ReactNode; onChange?: (index: number) => void}, ref: React.Ref<unknown>) => {
    React.useImperativeHandle(ref, () => ({close: () => props.onChange?.(-1), snapToIndex: (index: number) => props.onChange?.(index),
      present: () => props.onChange?.(0), dismiss: () => props.onChange?.(-1)})); return React.createElement(View, null, props.children);
  });
  return {__esModule: true, default: Sheet, BottomSheetModal: Sheet, BottomSheetScrollView: ScrollView,
    BottomSheetTextInput: TextInput, BottomSheetBackdrop: View};
});
jest.mock('firebase/firestore', () => ({doc: jest.fn(), collection: jest.fn(), getDoc: jest.fn(), getDocFromServer: jest.fn(),
  getDocs: jest.fn(), getDocsFromServer: jest.fn(), onSnapshot: jest.fn(() => jest.fn()), setDoc: jest.fn(), updateDoc: jest.fn(),
  deleteDoc: jest.fn(), addDoc: jest.fn(), runTransaction: jest.fn(), query: jest.fn(), where: jest.fn(), orderBy: jest.fn(),
  limit: jest.fn(), startAfter: jest.fn(), documentId: jest.fn(() => '__name__'), serverTimestamp: jest.fn(() => new Date()),
  arrayUnion: jest.fn((...values: unknown[]) => values), arrayRemove: jest.fn((...values: unknown[]) => values), increment: jest.fn(),
  Timestamp: class NativeTimestampFixture {seconds: number; nanoseconds: number;
    constructor(mockSeconds: number, mockNanoseconds = 0) {this.seconds = mockSeconds; this.nanoseconds = mockNanoseconds;}
    toDate() {return new Date(this.toMillis());} toMillis() {return this.seconds * 1000 + this.nanoseconds / 1_000_000;}
    static fromDate(date: Date) {return new this(Math.floor(date.getTime() / 1000), date.getTime() % 1000 * 1_000_000);}
    static now() {return this.fromDate(new Date());}},
}));

function deferred<T>() {let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {resolve = done; reject = fail;}); return {promise, resolve, reject};}
const deadline = () => Date.now() + 86400000;
const tx = (overrides: Partial<Transaction> = {}): Transaction => ({id: 'sale', articleId: 'article', chatId: 'chat', buyerId: 'buyer', sellerId: 'seller',
  amount: 50, totalAmount: 50, shippingCost: 0, currency: 'CAD', deliveryType: 'shipping', status: 'lost', createdAt: new Date(), ...overrides});
const refundOrder = (state: IssueRefundResult['status']): Transaction => tx({status: state === 'succeeded' ? 'refunded' : state === 'pending' ? 'refund_in_progress' : 'refund_action_required',
  refund: {intentId: 'intent', state, outstandingCardCents: state === 'succeeded' ? 0 : 5000, ...(state === 'succeeded' ? {fundsAppliedAt: new Date()} : {})}});
const unknownReturn = (id: string, state: Transaction['status'] = 'delivered'): ReturnRequestResult => ({protocol: 'return_request_v1', transactionId: id,
  success: false, replay: true, requestId: null, version: null, requestRecorded: false, fundsFrozen: false, labelCommitted: false,
  shippingPermissionGranted: false, quote: null, status: 'reconciliation_required', actionRequired: true, currentOrderStatus: state,
  returnTrackingNumber: null, returnLabelUrl: null, returnLabelCost: null, reason: 'return_request_outcome_unproven'});
type RpcInput = Record<string, unknown>;
const rpcIO = jest.fn(), reportIO = jest.fn(), returnIO = jest.fn();
const queriesFailed = jest.fn(), orders = new Map<string, Transaction>();
function recordedReturn(input: RpcInput): ReturnRequestResult {
  const id = String(input.transactionId), order = orders.get(id)!;
  const witness = {schemaVersion: 1 as const, requestId: String(input.requestId), version: 1, transactionId: id,
    actorUid: order.buyerId, buyerId: order.buyerId, sellerId: order.sellerId, reason: String(input.reason),
    totalCents: 5000, sellerPayoutCents: 5000, currency: 'CAD', requestedAt: new Date(), fundsReleaseAt: order.fundsReleaseAt,
    state: 'reconciliation_required', sourceHash: ''};
  const native = {...order, status: 'return_requested' as const, disputed: true, returnRequest: witness};
  // This native read fixture binds the stored witness to the exact order fields
  // consumed by the real client verifier. It grants neither a label nor a refund.
  const canonical = (value: unknown): unknown => value instanceof Date ? {timestampMs: value.getTime()} :
    Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ?
      Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  witness.sourceHash = createHash('sha256').update(JSON.stringify(canonical({id, buyerId: order.buyerId, sellerId: order.sellerId,
    articleId: order.articleId, currency: order.currency, amount: order.amount, totalAmount: order.totalAmount,
    sellerPayout: order.sellerPayout, shippingAddress: order.shippingAddress,
    shippingSnapshot: (order as Transaction & {shippingSnapshot?: unknown}).shippingSnapshot,
    deliveredAt: order.deliveredAt, fundsReleaseAt: order.fundsReleaseAt}))).digest('hex');
  orders.set(id, native as Transaction);
  return recordedReturnReceipt(id, false);
}
function recordedReturnReceipt(id: string, replay: boolean): ReturnRequestResult {
  const order = orders.get(id)!, witness = order.returnRequest!;
  return {...unknownReturn(id, order.status), replay, requestId: witness.requestId, version: witness.version,
    requestRecorded: true, fundsFrozen: true, reason: null};
}
let client: QueryClient, activity: AppStateStatus;
const listeners = new Set<(state: AppStateStatus) => void>();
const originalActivity = Object.getOwnPropertyDescriptor(AppState, 'currentState');
function node(order: Transaction, tool?: 'return' | 'report', refresh?: () => void) {
  orders.set(order.id, order);
  return <QueryClientProvider client={client}><ShipmentTracking transaction={order} tool={tool} onStatusUpdate={refresh}/></QueryClientProvider>;
}
function dispatches() {return rpcIO.mock.calls.filter(([name, input]: [string, RpcInput]) => name === 'requestRefund' ||
  name === 'requestReturn' && input.mode === 'prepare' || name === 'reportTransactionProblem' && input.mode === 'execute');}
function pressCallback(label: string): () => void {let instance: ReturnType<typeof screen.getByText> | null = screen.getByText(label);
  while (instance && typeof instance.props.onPress !== 'function') instance = instance.parent; expect(instance).not.toBeNull(); return instance!.props.onPress;}
function sheet(title: string) {const current = screen.UNSAFE_getAllByType(RecourseReasonSheet).find(instance => instance.props.title === title);
  expect(current).toBeDefined(); return current!;}
async function openSheet(title: 'Signaler un problème' | 'Demander un retour') {
  fireEvent.press(await screen.findByText(title === 'Signaler un problème' ? 'Décrire le problème' : 'Choisir le motif du retour'));
  const reason = title === 'Signaler un problème' ? 'Autre' : 'Autre problème avec l’article';
  await waitFor(() => expect(screen.getByRole('radio', {name: reason})).toBeEnabled());
  fireEvent.press(screen.getByRole('radio', {name: reason}));
  if (title === 'Signaler un problème') fireEvent.changeText(screen.getByLabelText('Décrivez le problème'), 'Récit QA original');
  const submit = title === 'Signaler un problème' ? 'Envoyer le signalement' : 'Déposer la demande et voir le devis';
  await waitFor(() => expect(screen.getByRole('button', {name: submit})).toBeEnabled());
  return sheet(title).props.onSubmit as (reason: string, details: string) => Promise<void>;
}
async function dispatchSource(name: string, input: RpcInput) {
  const id = String(input.transactionId), ownerId = String(input.expectedUid);
  const order = orders.get(id); if (!order) throw new Error(`Unexpected order ${id}`);
  if (name === 'checkTrackingStatus' && input.mode === 'policy_observe') {
    if (input.capability === 'shipping_transport_terms_v1') return {protocol: 'shipping_transport_terms_observation_v1', transactionId: id, ownerId,
      qualification: 'historical_terms_not_recorded', terms: null, purchasePolicyHash: null};
    return {transactionId: id, ownerId, purchasePolicy: {schemaVersion: 1, qualification: 'historical_deadline_unknown_acceptance',
      policyVersion: null, policyHash: null, parameters: null, acceptedAtMs: null, nonShipmentStartsAtMs: null, nonShipmentExpiresAtMs: null,
      paymentClockBasis: null, deliveryEventAtMs: null, deliveryRecordedAtMs: null, fundsReleaseAtMs: order.fundsReleaseAt?.getTime() ?? deadline(),
      deliveryProtectionEndsAtMs: null, reviewRequired: false, reviewReason: null, externalRightsPreserved: true}};
  }
  if (name === 'reportTransactionProblem' && input.mode === 'source_observe') return {protocol: 'whole_set_report_source_v1', ownerId,
    transactionId: id, qualification: 'not_a_set', source: null, physicalReceiptVerified: false, faultEstablished: false,
    financialEffect: 'none', recourseScope: 'whole_transaction'};
  if (name === 'reportTransactionProblem') return reportIO(input);
  if (name === 'requestReturn') return returnIO(input);
  if (name === 'getAutomatedDecisionLog') return {ok: true, protocol: 'automated_decision_log_v1', ownerId, transactionId: id, entries: [],
    count: 0, hasMore: false, cursor: null, coverage: 'recorded_entries_only', financialExecutionCoverageVerified: false,
    absenceOfDecisionVerified: false, completeHistory: false};
  if (name === 'checkTrackingStatus' && input.mode === 'label_document_observe') {
    if (input.operation === 'source_check') return {protocol: 'label_document_source_check_v1', ownerId, transactionId: id, direction: 'return',
      labelId: input.expectedLabelId, sourceRevision: '1:0', sourceHash: 'a'.repeat(64), purchaseQualification: 'historical_unknown',
      observation: 'source_matches', documentUrl: null, newPurchaseAuthorized: false};
    return {protocol: 'label_document_observation_v1', ownerId, transactionId: id, direction: 'return', labelId: input.expectedLabelId,
      sourceRevision: '1:0', sourceHash: 'a'.repeat(64), purchaseQualification: 'historical_unknown', observation: 'document_available',
      providerStatus: 'completed', providerVoided: false, providerRevision: null, observedAtMs: Date.now(), providerCreatedAtMs: Date.now() - 1000,
      documentUrl: 'https://example.test/current-private-return.pdf', reason: null, labelUsability: 'not_certified', newPurchaseAuthorized: false};
  }
  throw new Error(`Unexpected RPC ${name}/${String(input.mode)}`);
}
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear(); mockFocused = true; activity = 'active'; listeners.clear(); orders.clear(); establishIdentityFixture('buyer');
  Object.defineProperty(AppState, 'currentState', {configurable: true, get: () => activity});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {const listener = callback as (state: AppStateStatus) => void;
    listeners.add(listener); return {remove: () => {listeners.delete(listener);}};});
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  (doc as jest.Mock).mockImplementation((_db: unknown, collection: string, id: string) => ({path: `${collection}/${id}`, id}));
  (getDocFromServer as jest.Mock).mockImplementation(async (ref: {path: string; id: string}) => {
    if (!ref.path.startsWith('transactions/') || !orders.has(ref.id)) throw new Error(`Unexpected native document ${ref.path}`);
    return {id: ref.id, exists: () => true, data: () => orders.get(ref.id)};
  });
  reportIO.mockReset().mockImplementation(async (input: RpcInput) => ({protocol: 'transaction_problem_report_v1', ownerId: input.expectedUid,
    transactionId: input.transactionId, requestId: input.requestId,
    payloadHash: await supportCommandHash({reason: input.reason, details: input.details ?? null}), state: 'committed', committed: true,
    replay: input.mode === 'observe', disputeId: `problem_${await supportCommandHash([input.expectedUid, input.transactionId, input.requestId])}`,
    reportedAt: '2026-11-25T20:00:00.000Z', freezeCommitted: true, reason: null, admissionVerified: false, financialEffect: 'none', externalRecourseDeadlineExtended: false}));
  returnIO.mockReset().mockImplementation(async (input: RpcInput) => unknownReturn(String(input.transactionId)));
  rpcIO.mockReset().mockImplementation(dispatchSource);
  (httpsCallable as jest.Mock).mockImplementation((_functions: unknown, name: string) => async (input: RpcInput) => ({data: await rpcIO(name, input)}));
  client = new QueryClient({queryCache: new QueryCache({onError: queriesFailed}), defaultOptions: {queries: {retry: false, gcTime: 0}, mutations: {retry: false}}});
});
afterEach(() => {cleanup(); client.clear(); jest.restoreAllMocks(); clearIdentityFixture();
  if (originalActivity) Object.defineProperty(AppState, 'currentState', originalActivity);});

it.each([
  ['pending', 'Remboursement en cours'], ['requires_action', 'Remboursement à compléter'], ['unknown', 'Remboursement à vérifier'],
  ['failed', 'Remboursement non confirmé'], ['canceled', 'Remboursement non confirmé'], ['reconciliation_required', 'Remboursement à vérifier'],
  ['succeeded', 'Remboursement confirmé'],
] as const)('observes the current %s refund outcome without issuing a new refund or treating an incomplete result as final', async (state, title) => {
  const order = refundOrder(state); render(node(order)); await screen.findByText(title);
  expect(screen.queryByText('Remboursement confirmé') !== null).toBe(state === 'succeeded');
  expect(screen.queryByText('Demander un remboursement')).toBeNull(); expect(dispatches()).toEqual([]);
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  if (state === 'succeeded') expect(order.refund?.fundsAppliedAt).toBeInstanceOf(Date);
});

it('keeps a historical return PDF accessible after reopen and late failure, only after current private document qualification', async () => {
  const returned = tx({status: 'return_requested', returnLabelId: 'se-return', returnLabelUrl: 'https://example.test/old-private.pdf', returnTrackingNumber: 'RETURN'});
  const view = render(node(returned, 'return')); await screen.findByText('Ouvrir l’ancienne étiquette');
  const refunded = {...returned, status: 'refunded' as const, refund: {intentId: 'intent', state: 'succeeded' as const, outstandingCardCents: 0, fundsAppliedAt: new Date()}};
  view.rerender(node(refunded, 'return')); fireEvent.press(await screen.findByText('Ouvrir l’ancienne étiquette'));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://example.test/current-private-return.pdf'));
  expect(Linking.openURL).not.toHaveBeenCalledWith('https://example.test/old-private.pdf'); view.unmount();
  const late = {...returned, status: 'refund_action_required' as const, refundBlocked: true,
    refund: {intentId: 'intent', state: 'failed' as const, outstandingCardCents: 5000, fundsAppliedAt: new Date()}};
  render(node(late, 'return')); await screen.findByText('Ouvrir l’ancienne étiquette');
  expect(screen.queryByText('Demander un remboursement')).toBeNull(); expect(dispatches()).toEqual([]);
});

it('keeps bank obligations on support instead of steering them into a new incompatible report or refund', async () => {
  render(node(tx({bankDispute: {id: 'bank', state: 'open'}}))); await screen.findAllByText('Contacter l’équipe');
  expect(screen.queryByText('Signaler un problème')).toBeNull(); expect(screen.queryByText('Demander un remboursement')).toBeNull();
  expect(dispatches()).toEqual([]);
});

it('keeps shipped/lost on support and exposes a report only after the current delivered order and native deadline are read', async () => {
  const view = render(node(tx({status: 'shipped'}))); await screen.findAllByText('Contacter l’équipe');
  expect(screen.queryByText('Signaler un problème')).toBeNull();
  const delivered = tx({status: 'delivered', fundsReleaseAt: new Date(deadline())}); view.rerender(node(delivered));
  // A prop alone is not a fresh native return/policy source. The actual read
  // must requalify this deadline before the delivered action can be offered.
  expect(screen.queryByText('Signaler un problème')).toBeNull();
  await act(async () => {await Promise.all([client.invalidateQueries({queryKey: ['return-request']}),
    client.invalidateQueries({queryKey: ['shipping-purchase-policy']})]);});
  await screen.findByText('Signaler un problème'); expect(dispatches()).toEqual([]);
});

it('does not treat a null card debt as a settled amount', async () => {
  render(node(tx({status: 'refund_action_required', refundBlocked: true, refund: {intentId: 'intent', state: 'unknown', outstandingCardCents: null}})));
  await screen.findByText('Montant sur le moyen de paiement à vérifier.'); expect(screen.queryByText('Remboursement confirmé')).toBeNull();
});

it('does not promise parcel preparation on a historical cancelled agreement without a scan', async () => {
  render(node(tx({status: 'cancelled'}))); await screen.findByText('Suivi du transport indisponible');
  expect(screen.queryByText('Le vendeur prépare votre colis')).toBeNull(); await screen.findAllByText('Contacter l’équipe'); expect(dispatches()).toEqual([]);
});

it('does not adopt a delayed previous order read or announce its financial result after a new selection', async () => {
  const oldRead = deferred<{id: string; exists: () => boolean; data: () => Transaction}>();
  (getDocFromServer as jest.Mock).mockImplementationOnce(() => oldRead.promise);
  const previous = tx({status: 'delivered', fundsReleaseAt: new Date(deadline())}); const view = render(node(previous, 'return'));
  await waitFor(() => expect(getDocFromServer).toHaveBeenCalled());
  const next = tx({id: 'new-sale', status: 'delivered', fundsReleaseAt: new Date(deadline())}); view.rerender(node(next, 'return'));
  await screen.findByText('Choisir le motif du retour');
  await act(async () => {oldRead.resolve({id: previous.id, exists: () => true, data: () => refundOrder('succeeded')});});
  expect(screen.queryByText('Remboursement confirmé')).toBeNull(); expect(Alert.alert).not.toHaveBeenCalled(); expect(Haptics.notificationAsync).not.toHaveBeenCalled();
});

it('keeps an active return read failure actionable while its retained retry stays inert on the next agreement', async () => {
  (getDocFromServer as jest.Mock).mockRejectedValueOnce(new Error('Lecture actuelle refusée'));
  const order = tx({status: 'delivered', fundsReleaseAt: new Date(deadline())}); const view = render(node(order, 'return'));
  await screen.findByText('Impossible d’actualiser ce retour pour le moment. Réessayez.');
  const retry = pressCallback('Actualiser le retour');
  view.rerender(node({...order, id: 'new-sale'}, 'return')); await screen.findByText('Choisir le motif du retour');
  (getDocFromServer as jest.Mock).mockClear(); act(() => retry()); expect(getDocFromServer).not.toHaveBeenCalled();
});

it.each(['Signaler un problème', 'Demander un retour'] as const)('never submits the old %s form after another order is selected', async title => {
  const tool = title === 'Signaler un problème' ? 'report' : 'return';
  const order = tx({status: 'delivered', fundsReleaseAt: new Date(deadline())}); const view = render(node(order, tool));
  const oldSubmit = await openSheet(title); view.rerender(node({...order, id: 'new-sale'}, tool));
  await act(async () => {await oldSubmit('other', 'Ancienne saisie');}); expect(dispatches()).toEqual([]);
});

it.each(['Signaler un problème', 'Demander un retour'] as const)('never refreshes or alerts the next order from an in-flight %s failure', async title => {
  const pending = deferred<unknown>(), target = title === 'Signaler un problème' ? reportIO : returnIO;
  target.mockReturnValueOnce(pending.promise); const tool = title === 'Signaler un problème' ? 'report' : 'return';
  const refresh = jest.fn(), order = tx({status: 'delivered', fundsReleaseAt: new Date(deadline())}); const view = render(node(order, tool, refresh));
  const submit = await openSheet(title); let work!: Promise<void>; act(() => {work = submit('other', 'Ancienne saisie');});
  await waitFor(() => expect(dispatches()).toHaveLength(1)); view.rerender(node({...order, id: 'new-sale'}, tool, refresh));
  await act(async () => {pending.reject(new Error('Old failure')); await work;});
  expect(refresh).not.toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled();
});

it('does not let an old return finally release the new return busy state and confirms only the current recorded hold', async () => {
  const first = deferred<ReturnRequestResult>(), second = deferred<ReturnRequestResult>();
  let nextInput!: RpcInput;
  returnIO.mockImplementation((input: RpcInput) => {
    if (input.mode === 'prepare') {if (input.transactionId === 'sale') return first.promise; nextInput = input; return second.promise;}
    const order = orders.get(String(input.transactionId))!;
    if (order.returnRequest) {
      return recordedReturnReceipt(order.id, true);
    }
    return unknownReturn(String(input.transactionId));
  });
  const original = tx({status: 'delivered', fundsReleaseAt: new Date(deadline())}); const view = render(node(original, 'return'));
  const oldSubmit = await openSheet('Demander un retour'); let oldWork!: Promise<void>; act(() => {oldWork = oldSubmit('other', '');});
  await waitFor(() => expect(dispatches()).toHaveLength(1)); view.rerender(node({...original, id: 'new-sale'}, 'return'));
  const newSubmit = await openSheet('Demander un retour'); let newWork!: Promise<void>; act(() => {newWork = newSubmit('other', '');});
  await waitFor(() => expect(dispatches()).toHaveLength(2));
  await act(async () => {first.resolve(unknownReturn('sale')); await oldWork;});
  expect(sheet('Demander un retour').props.isSubmitting).toBe(true); expect(Alert.alert).not.toHaveBeenCalled();
  await act(async () => {second.resolve(recordedReturn(nextInput)); await newWork;});
  expect(sheet('Demander un retour').props.isSubmitting).toBe(false);
  await screen.findByText('Le dépôt de votre demande et le gel ont été confirmés. Consultez leur état dans ce même retour ; ne déposez pas de nouvelle demande.');
  expect(screen.queryByText('Étiquette de retour enregistrée')).toBeNull(); expect(screen.queryByText('Remboursement confirmé')).toBeNull();
  expect(orders.get('new-sale')?.returnRequest?.requestId).toBe(nextInput.requestId);
});
