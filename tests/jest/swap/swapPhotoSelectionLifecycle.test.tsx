import React from 'react';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react-native';
import {AppState, type AppStateStatus} from 'react-native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import {auth, storage} from '@/config/firebaseConfig';
import {useAuthStore} from '@/store/authStore';
import {AuthService} from '@/services/authService';
import {prepareImageForUpload} from '@/utils/imageUtils';
import {uploadPreparedJpeg} from '@/services/nativeStorageUpload';
import {subscribeToSwap, uploadSwapPhotos} from '@/services/swapService';
import {clearIdentityFixture, establishIdentityFixture} from '@/tests/jest/helpers/identityFixture';
import type {Swap} from '@/types';

let mockId = 'swap-1', mockFocused = true;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({id: mockId}), useRouter: () => require('expo-router').router,
  router: {push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true},
  useNavigation: () => ({isFocused: () => mockFocused}),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react'); React.useEffect(() => {if (mockFocused) return callback();}, [callback, mockFocused]);
  }, Stack: {Screen: () => null},
}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: require('react-native').View, useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('@/lib/analytics', () => ({track: jest.fn(), suspendAnalytics: jest.fn(), identifyUser: jest.fn(), resetAnalytics: jest.fn(), setAnalyticsUserConsent: jest.fn().mockResolvedValue(undefined)}));
jest.mock('@/utils/imageUtils', () => ({prepareImageForUpload: jest.fn()}));
jest.mock('expo-image-picker', () => ({launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: {Compatible: 'compatible'}}));
jest.mock('@/services/nativeStorageUpload', () => ({uploadPreparedJpeg: jest.fn()}));
jest.mock('@/services/swapService', () => ({...jest.requireActual('@/services/swapService'), subscribeToSwap: jest.fn(), uploadSwapPhotos: jest.fn()}));
// Real route, action component, agreement decoder and all session/focus/SDK
// guards remain composed. Only unrelated visual leaves and I/O are replaced.
jest.mock('@/features/swap', () => ({
  ...jest.requireActual('@/features/swap/presentation'),
  SwapActions: jest.requireActual('@/features/swap/components/detail/SwapActions').SwapActions,
  SwapTopBar: () => null, SwapDetailSkeleton: () => require('react').createElement(require('react-native').Text, null, 'Chargement'),
  SwapProposalView: () => null, SwapStatusView: () => null, SwapContactButton: () => null, SwapStickyActions: () => null,
  SwapActionSheet: () => null, SwapLaunchAdmissionSheet: () => null, SwapArrangementFields: () => null,
  SwapAgreementReview: () => null, SwapProofPhotos: () => null, SwapHoldReviewNotice: () => null,
}));
import SwapDetailScreen from '@/app/swap/[id]';

const recordedAt = new Date('2026-11-25T19:00:00.000Z');
function postalSwap(id = 'swap-1'): Swap {
  const sourceHash = 'a'.repeat(64);
  return {id, initiatorId: 'A', receiverId: 'B', initiatorName: 'Alice', receiverName: 'Bob',
    initiatorItems: [{articleId: 'coat', title: 'Manteau', price: 20}], receiverItems: [{articleId: 'dress', title: 'Robe', price: 20}],
    initiatorTotalValue: 20, receiverTotalValue: 20, status: 'photos_pending', exchangeMode: 'shipping',
    createdAt: recordedAt, updatedAt: recordedAt, acceptedAt: recordedAt,
    exchangeAgreement: {protocol: 'swap_exchange_agreement_v1', scope: 'new_proposal', sourceHash,
      termsVersion: '2026-10-17.v1', termsText: 'Envoi manuel entre membres au Québec.', exchangeMode: 'shipping', arrangements: 'Frais et envoi convenus entre membres.',
      initiatorAcknowledgement: {actorUid: 'A', sourceHash, recordedAt}, receiverAcknowledgement: {actorUid: 'B', sourceHash, recordedAt}}};
}
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}
const selectedResult = {canceled: false, assets: [{uri: 'file:///private/qa.jpg', width: 1200, height: 900, assetId: null, fileName: 'qa.jpg', type: 'image' as const}]} satisfies ImagePicker.ImagePickerResult;
type Delivery = {id: string; callback: (value: Swap | null) => void; options: {onChecking?: () => void}};
let client: QueryClient, activity: AppStateStatus, immediateDelivery: boolean;
const deliveries: Delivery[] = [], listeners = new Set<(state: AppStateStatus) => void>();
const originalActivity = Object.getOwnPropertyDescriptor(AppState, 'currentState');
function setActivity(next: AppStateStatus) {activity = next; for (const listener of listeners) listener(next);}
function route() {return <QueryClientProvider client={client}><SwapDetailScreen/></QueryClientProvider>;}
function latestDelivery() {return deliveries[deliveries.length - 1];}
function expectNoUpload() {expect(prepareImageForUpload).not.toHaveBeenCalled(); expect(uploadPreparedJpeg).not.toHaveBeenCalled(); expect(uploadSwapPhotos).not.toHaveBeenCalled();}
function retainedPress(text: string): () => Promise<void> {
  let node: ReturnType<typeof screen.getByText> | null = screen.getByText(text);
  while (node && typeof node.props.onPress !== 'function') node = node.parent;
  expect(node).not.toBeNull(); return node!.props.onPress as () => Promise<void>;
}
async function choosePhotos() {
  fireEvent.press(await screen.findByText('Ajouter des photos'));
  await screen.findByText('Envoyer les photos'); expectNoUpload();
}
async function roundTripOwner() {
  const owner = auth.currentUser, profile = useAuthStore.getState().user!;
  jest.spyOn(AuthService, 'getCurrentUser').mockImplementation(async uid => ({...profile, id: uid!, email: `${uid}@example.test`}));
  await act(async () => {
    establishIdentityFixture('B'); await useAuthStore.getState().hydrateFromFirebase(auth.currentUser);
    Object.assign(auth, {currentUser: owner}); await useAuthStore.getState().hydrateFromFirebase(owner);
  });
}
beforeEach(() => {
  jest.clearAllMocks(); mockId = 'swap-1'; mockFocused = true; immediateDelivery = true; deliveries.length = 0;
  activity = 'active'; listeners.clear(); establishIdentityFixture('A');
  Object.assign(storage, {app: {options: {storageBucket: 'demo-second.firebasestorage.app'}}});
  Object.defineProperty(AppState, 'currentState', {configurable: true, get: () => activity});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    const listener = callback as (state: AppStateStatus) => void; listeners.add(listener); return {remove: () => {listeners.delete(listener);}};
  });
  (subscribeToSwap as jest.Mock).mockImplementation((id: string, callback: Delivery['callback'], options: Delivery['options']) => {
    deliveries.push({id, callback, options}); if (immediateDelivery) callback(postalSwap(id)); return jest.fn();
  });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockReset().mockResolvedValue(selectedResult);
  (prepareImageForUpload as jest.Mock).mockReset().mockResolvedValue('file:///private/prepared.jpg');
  (uploadPreparedJpeg as jest.Mock).mockReset().mockImplementation(async ({assertContext}: {assertContext: () => void}) => {assertContext();});
  (uploadSwapPhotos as jest.Mock).mockReset().mockImplementation(async (_id: string, _uid: string, _urls: string[], assertContext: () => void) => {assertContext();});
  client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}, mutations: {retry: false}}});
});
afterEach(() => {cleanup(); client.clear(); jest.restoreAllMocks(); clearIdentityFixture(); if (originalActivity) Object.defineProperty(AppState, 'currentState', originalActivity);});

it('returns only local files from the backgrounded native picker and sends only after an explicit current tap and fresh same-source delivery', async () => {
  const picker = deferred<ImagePicker.ImagePickerResult>(); (ImagePicker.launchImageLibraryAsync as jest.Mock).mockReturnValueOnce(picker.promise);
  render(route()); await screen.findByText('Ajouter des photos'); const oldTap = retainedPress('Ajouter des photos');
  fireEvent.press(screen.getByText('Ajouter des photos')); expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);
  immediateDelivery = false; act(() => setActivity('background')); act(() => setActivity('active'));
  await act(async () => {picker.resolve(selectedResult);}); expectNoUpload();
  expect(screen.queryByText('Envoyer les photos')).toBeNull(); expect(screen.getByText('Chargement')).toBeOnTheScreen();
  await act(async () => {await oldTap();}); expectNoUpload();
  act(() => latestDelivery().callback(postalSwap())); await screen.findByText('Envoyer les photos'); expectNoUpload();
  fireEvent.press(screen.getByText('Envoyer les photos'));
  await waitFor(() => expect(uploadSwapPhotos).toHaveBeenCalledTimes(1));
  expect(prepareImageForUpload).toHaveBeenCalledWith('file:///private/qa.jpg');
  expect(uploadPreparedJpeg).toHaveBeenCalledWith(expect.objectContaining({ownerUid: 'A', path: expect.stringMatching(/^swaps\/swap-1\/photos\/A\/0_[a-f0-9-]+\.jpg$/), localUri: 'file:///private/prepared.jpg'}));
  expect(uploadSwapPhotos).toHaveBeenCalledWith('swap-1', 'A', [expect.stringMatching(/swaps%2Fswap-1%2Fphotos%2FA%2F0_.*\?alt=media$/)], expect.any(Function));
  expect(JSON.stringify((uploadSwapPhotos as jest.Mock).mock.calls)).not.toContain('token=');
});

it('retains local files across normal same-owner hydration but refuses the old send closure and acquires a new generation only on the next tap', async () => {
  render(route()); await choosePhotos(); const oldSend = retainedPress('Envoyer les photos');
  const owner = auth.currentUser, profile = useAuthStore.getState().user!;
  jest.spyOn(AuthService, 'getCurrentUser').mockResolvedValue(profile);
  await act(async () => {await useAuthStore.getState().hydrateFromFirebase(owner);});
  expect(auth.currentUser).toBe(owner); await screen.findByText('Envoyer les photos');
  await act(async () => {await oldSend();}); expectNoUpload();
  fireEvent.press(screen.getByText('Envoyer les photos')); await waitFor(() => expect(uploadSwapPhotos).toHaveBeenCalledTimes(1));
});

it.each(['owner-roundtrip', 'route', 'source', 'blur', 'expiry'] as const)('never uploads a retained local selection after %s invalidation', async change => {
  const view = render(route()); await choosePhotos(); const oldSend = retainedPress('Envoyer les photos');
  if (change === 'owner-roundtrip') await roundTripOwner();
  if (change === 'route') {mockId = 'swap-2'; view.rerender(route());}
  if (change === 'source') act(() => latestDelivery().callback({...postalSwap(), updatedAt: new Date(recordedAt.getTime() + 1)}));
  if (change === 'blur') {mockFocused = false; view.rerender(route()); mockFocused = true; view.rerender(route());}
  if (change === 'expiry') {const now = Date.now(); jest.spyOn(Date, 'now').mockReturnValue(now + 120_001);}
  await act(async () => {await oldSend();}); expectNoUpload();
  if (change !== 'expiry') {expect(screen.queryByText('Envoyer les photos')).toBeNull(); await screen.findByText('Ajouter des photos');}
});

it.each(['cancel', 'owner-roundtrip', 'route', 'blur'] as const)('does not adopt picker files after %s, even when the same owner returns before resolution', async change => {
  const picker = deferred<ImagePicker.ImagePickerResult>(); (ImagePicker.launchImageLibraryAsync as jest.Mock).mockReturnValueOnce(picker.promise);
  const view = render(route()); fireEvent.press(await screen.findByText('Ajouter des photos'));
  if (change === 'owner-roundtrip') await roundTripOwner();
  if (change === 'route') {mockId = 'swap-2'; view.rerender(route());}
  if (change === 'blur') {mockFocused = false; view.rerender(route()); mockFocused = true; view.rerender(route());}
  await act(async () => {picker.resolve(change === 'cancel' ? {canceled: true, assets: null} : selectedResult);});
  expect(screen.queryByText('Envoyer les photos')).toBeNull(); expectNoUpload();
});

it('stops between preparation and native upload if the source changes while the image is preparing', async () => {
  const preparation = deferred<string>(); (prepareImageForUpload as jest.Mock).mockReturnValueOnce(preparation.promise);
  render(route()); await choosePhotos(); fireEvent.press(screen.getByText('Envoyer les photos'));
  await waitFor(() => expect(prepareImageForUpload).toHaveBeenCalledTimes(1));
  act(() => latestDelivery().callback({...postalSwap(), updatedAt: new Date(recordedAt.getTime() + 1)}));
  await act(async () => {preparation.resolve('file:///private/prepared.jpg');});
  expect(uploadPreparedJpeg).not.toHaveBeenCalled(); expect(uploadSwapPhotos).not.toHaveBeenCalled();
});

it('refuses a changed SDK owner before any preparation even if the store and route have not rendered again', async () => {
  render(route()); await choosePhotos(); const send = retainedPress('Envoyer les photos');
  Object.assign(auth, {currentUser: {...auth.currentUser, uid: 'B'}});
  await act(async () => {await send();}); expectNoUpload();
});

it('does not register private photo references if the session changes while native upload is still in flight', async () => {
  const transfer = deferred<void>(); (uploadPreparedJpeg as jest.Mock).mockReturnValueOnce(transfer.promise);
  render(route()); await choosePhotos(); fireEvent.press(screen.getByText('Envoyer les photos'));
  await waitFor(() => expect(uploadPreparedJpeg).toHaveBeenCalledTimes(1));
  act(() => establishIdentityFixture('B'));
  await act(async () => {transfer.resolve();}); expect(uploadSwapPhotos).not.toHaveBeenCalled();
});
