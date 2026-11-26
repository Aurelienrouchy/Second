import {getEnvironmentStorageKey} from '@/config/firebaseEnvironment';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { AppState } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccountRelationshipPurchaseJournal } from '@/components/AccountRelationshipPurchaseJournal';
import { auth } from '@/config/firebaseConfig';
import { httpsCallable } from 'firebase/functions';
import { productReviewHash } from '@/services/productReviewService';
import { AccountRelationshipReviewService as Service } from '@/services/accountRelationshipReviewService';
import { AccountRelationshipPurchaseJournal as Journal } from '@/services/accountRelationshipPurchaseJournal';
import type { RelationshipInventoryV2Cursor, RelationshipPurchaseAttempt, RelationshipPurchaseReceipt } from '@/types/accountRelationshipReview';

jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1, useAuthStore: Object.assign(
  (selector: (state: {authenticatedUid: string; user: null}) => unknown) => selector({authenticatedUid: 'admin', user: null}),
  {getState: () => ({authenticatedUid: 'admin', user: null})})}));
jest.mock('expo-router', () => {const runtime: typeof import('react') = jest.requireActual('react');
  return {
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useRouter: () => require('expo-router').router,
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ isFocused: () => true, canGoBack: () => true }),
useFocusEffect: (effect: () => void | (() => void)) => runtime.useEffect(effect, [effect])};});
jest.mock('@/components/ui', () => {const runtime: typeof import('react') = jest.requireActual('react'), native: typeof import('react-native') = jest.requireActual('react-native');
  return {Button: ({children, onPress, disabled}: {children: import('react').ReactNode; onPress: () => void; disabled?: boolean}) =>
    runtime.createElement(native.Pressable, {onPress, disabled, accessibilityRole: 'button'}, runtime.createElement(native.Text, null, children))};});
jest.mock('@/services/supportRequestService', () => ({isSupportAccountSource: () => false}));
jest.mock('@/services/productReviewService', () => {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  const serialize = (value: unknown) => JSON.stringify(canonical(value));
  return {productReviewEqual: (a: unknown, b: unknown) => serialize(a) === serialize(b),
    productReviewHash: async (value: unknown) => jest.requireActual('node:crypto').createHash('sha256').update(serialize(value)).digest('hex')};
});
const io = jest.fn<Promise<{data: unknown}>, [string, Record<string, unknown>]>();
const reference = {pairId: `arp_${'a'.repeat(64)}`, id: `ar_${'b'.repeat(64)}`, contentHash: 'c'.repeat(64), version: 1};
const attempt: RelationshipPurchaseAttempt = {version: 1, uid: 'admin', requestId: 'relationship-purchase-0001', capability: 'relationship_purchase_retirement_v1',
  command: {transactionId: 'purchase', scope: 'admin', sourceHash: 'd'.repeat(64), paymentIntentId: 'pi_native', totalCents: 5000, walletCents: 1000, relationshipReference: reference, acknowledged: true}};
const current = () => {};
async function receipt(state: RelationshipPurchaseReceipt['state']): Promise<RelationshipPurchaseReceipt> {
  return {protocol: 'relationship_purchase_retirement_command_v1', preAuthorizationFenceSupported: true, actorId: 'admin', requestId: attempt.requestId, command: attempt.command,
    payloadHash: await productReviewHash(attempt.command), state, reason: state === 'not_executed' ? 'requester_neutralized_before_authorization' : null, recordedAt: state === 'unrecorded' ? null : '2026-10-17T12:00:00.000Z', paymentPermissionGranted: false,
    result: state === 'received' ? {transactionId: 'purchase', providerStatus: 'canceled', cardCapabilityNeutralized: true, walletObligationOpen: true, walletCents: 1000, totalCents: 5000,
      paymentPermissionGranted: false, orderChanged: false, stockChanged: false, fundsMoved: false, providerObservedAt: '2026-10-17T12:00:00.000Z'} : null};
}
beforeEach(async () => {
  jest.clearAllMocks(); await AsyncStorage.clear();
  Object.defineProperty(AppState, 'currentState', {configurable: true, value: 'active'});
  Object.defineProperty(auth, 'currentUser', {configurable: true, value: {uid: 'admin', getIdToken: async () => 'token',
    getIdTokenResult: async () => ({claims: {admin: true, auth_time: Math.floor(Date.now() / 1000)}})}});
  jest.mocked(httpsCallable).mockImplementation(((_functions: unknown, name: string) => (payload: Record<string, unknown>) => io(name, payload)) as unknown as typeof httpsCallable);
});

it('uses the read-only preview getter and refuses an old unexpected DTO without a mutating fallback', async () => {
  io.mockResolvedValue({data: {items: []}});
  await expect(Service.purchasePreview('admin', 'purchase', reference, current)).rejects.toThrow();
  expect(io.mock.calls).toEqual([['readSupportRequests', {capability: 'account_relationship_review_v1', expectedUid: 'admin', operation: 'purchase_legacy_preview', transactionId: 'purchase', relationshipReference: reference}]]);
  io.mockResolvedValue({data: {...await receipt('unrecorded'), preAuthorizationFenceSupported: undefined}});
  await expect(Service.purchaseObserve(attempt, current)).rejects.toThrow();
  expect(io.mock.calls.every(([name]) => name === 'readSupportRequests')).toBe(true);
});

it('can stop a refused pre-authorization tuple explicitly and acknowledge its fresh native fence', async () => {
  let state: RelationshipPurchaseReceipt['state'] = 'unrecorded';
  io.mockImplementation(async (name, payload) => {
    if (name === 'retireLegacyStripeCheckout' && payload.mode === 'execute') throw Object.assign(new Error('Source changed'), {code: 'functions/failed-precondition'});
    if (name === 'retireLegacyStripeCheckout' && payload.mode === 'neutralize') state = 'not_executed';
    return {data: await receipt(state)};
  });
  await expect(Journal.submit(attempt, current, async () => {})).rejects.toThrow('Source changed');
  await expect(Journal.neutralize(attempt, current)).resolves.toMatchObject({state: 'not_executed', reason: 'requester_neutralized_before_authorization'});
  expect(io.mock.calls.filter(([name]) => name === 'retireLegacyStripeCheckout').map(([, payload]) => payload.mode)).toEqual(['execute', 'neutralize']);
  await Journal.acknowledge(attempt, current); expect(await Journal.read('admin', current)).toBeNull();
});

it('mounts and reads only the original own receipt without an admin role or profile', async () => {
  Object.defineProperty(auth, 'currentUser', {configurable: true, value: {uid: 'admin', getIdToken: async () => 'token',
    getIdTokenResult: async () => ({claims: {admin: false, auth_time: 0}})}});
  await AsyncStorage.setItem(getEnvironmentStorageKey('second:relationship-purchase-retirement:v1:admin'), JSON.stringify(attempt));
  io.mockResolvedValue({data: await receipt('received')});
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: 0}}});
  const view = render(React.createElement(QueryClientProvider, {client}, React.createElement(AccountRelationshipPurchaseJournal, {uid: 'admin'})));
  await waitFor(() => expect(screen.getByText('Mon journal d’achat historique')).toBeOnTheScreen());
  fireEvent.press(screen.getByRole('button', {name: 'Observer le reçu exact, sans nouvel envoi'}));
  await waitFor(() => expect(screen.getByText('Neutralisation de la seule capacité carte observée dans le reçu natif.')).toBeOnTheScreen());
  expect(io.mock.calls.every(([name, payload]) => name === 'readSupportRequests' && payload.operation === 'purchase_legacy_observe')).toBe(true);
  view.unmount(); client.clear();
});

it('keeps a lost-response command durable and recovers only with GET, including before fresh acknowledgement', async () => {
  let state: RelationshipPurchaseReceipt['state'] = 'unrecorded';
  io.mockImplementation(async name => {
    if (name === 'retireLegacyStripeCheckout') throw Object.assign(new Error('Response lost'), {code: 'functions/unavailable'});
    return {data: await receipt(state)};
  });
  await expect(Journal.submit(attempt, current, async () => {})).rejects.toThrow('Response lost');
  expect(await Journal.read('admin', current)).toEqual(attempt);
  const post = io.mock.calls.find(([name]) => name === 'retireLegacyStripeCheckout')![1];
  expect(post).toEqual({capability: attempt.capability, mode: 'execute', expectedUid: 'admin', requestId: attempt.requestId, command: attempt.command});
  expect(post).not.toHaveProperty('transactionId');
  state = 'authorized'; await Journal.observe(attempt, current);
  await expect(Journal.acknowledge(attempt, current)).rejects.toThrow('rapprocher');
  await expect(Journal.submit(attempt, current, async () => {})).rejects.toThrow();
  expect(io.mock.calls.filter(([name]) => name === 'retireLegacyStripeCheckout')).toHaveLength(1);
  state = 'received'; await Journal.observe(attempt, current);
  const beforeAck = io.mock.calls.length; await Journal.acknowledge(attempt, current);
  expect(io.mock.calls.slice(beforeAck).map(([name]) => name)).toEqual(['readSupportRequests']);
  expect(await Journal.read('admin', current)).toBeNull();
});

it('preserves all four inventory segments and empty filtered pages without claiming exhaustive coverage', async () => {
  const source = {sourceHash: 'e'.repeat(64), pairRevision: '1:0', pairVersion: 1, qualification: 'native_pair_current'};
  const segments = [['purchase', 'first_to_second'], ['purchase', 'second_to_first'], ['swap', 'first_to_second'], ['swap', 'second_to_first']] as const;
  let cursor: RelationshipInventoryV2Cursor | null = null;
  for (let index = 0; index < segments.length; index++) {
    const [kind, direction] = segments[index], nextSegment = segments[index + 1];
    const next: RelationshipInventoryV2Cursor | null = nextSegment ? {kind: nextSegment[0], direction: nextSegment[1], lastId: null, sourceHash: source.sourceHash} : null;
    io.mockResolvedValueOnce({data: {protocol: 'account_relationship_legacy_inventory_v2', actorId: 'admin', scope: 'admin', decisionReference: reference, source,
      readAt: '2026-10-17T12:00:00.000Z', rows: [], nextCursor: next, coverage: {kind, direction, inspected: 1, limit: 20, hasMoreInDirection: false, directionTailReached: true,
        resumedAfterId: null, snapshotConsistencyVerified: false, exhaustivePairSwapHistoryVerified: false, exhaustivePairPurchaseHistoryVerified: false,
        missingHistoricalPartyFields: 'unknown', orphanProviderIntents: 'unknown', providerQueriesPerformed: false}, selectedDecisionChangesRequiredForOtherOrders: true,
      currentPermissionsGranted: false, commonIdentityVerified: false, fraudEstablished: false, refundAuthorized: false, globalBanAuthorized: false, inventoryPermissionGranted: false, fundsRecovered: false}});
    const page = await Service.inventoryV2('admin', reference, cursor ? {sourceHash: source.sourceHash} : null, cursor, current);
    expect(page.nextCursor).toEqual(next); cursor = page.nextCursor;
  }
  expect(io.mock.calls.every(([name, payload]) => name === 'readSupportRequests' && payload.inventoryCapability === 'account_relationship_legacy_inventory_v2')).toBe(true);
});
