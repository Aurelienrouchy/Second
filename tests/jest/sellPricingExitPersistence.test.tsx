/** Pricing route, local draft service and React Navigation removal contract.
 * Only SDK/native presentation and filesystem transports are substituted. */
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deferred, establishSession, providerIdentity, resetEnvironment } from './auth-onboarding/eligibilityTestHarness';
import { auth } from '@/config/firebaseConfig';
import { useAuthStore } from '@/store/authStore';
import type { ArticleDraft } from '@/features/sell/services/draftService';
import { createSellNavigationFixture } from './helpers/sellNavigationFixture';

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', getInfoAsync: jest.fn(async () => ({ exists: true })),
  makeDirectoryAsync: jest.fn(async () => undefined), copyAsync: jest.fn(async () => undefined),
  readDirectoryAsync: jest.fn(async () => []), deleteAsync: jest.fn(async () => undefined),
}));
jest.mock('@/features/sell/services/aiService', () => ({ deleteDraftImagesFromStorage: jest.fn() }));
jest.mock('@/features/sell/components/pricing/NeighborhoodBottomSheet', () => () => null);
jest.mock('@/features/sell', () => ({
  PriceCard: jest.requireActual('@/features/sell/components/pricing/PriceCard').PriceCard,
  HandDeliveryCard: jest.requireActual('@/features/sell/components/pricing/HandDeliveryCard').HandDeliveryCard,
  ShippingCard: jest.requireActual('@/features/sell/components/pricing/ShippingCard').ShippingCard,
  FormErrors: jest.requireActual('@/features/sell/components/pricing/FormErrors').FormErrors,
  SellFooter: jest.requireActual('@/features/sell/components/shared/SellFooter').SellFooter,
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.requireActual('expo-router/build/react-navigation/core/usePreventRemove').usePreventRemove,
  useIsFocused: jest.requireActual('expo-router/build/react-navigation/core/useIsFocused').useIsFocused,
}));

// The fixture retains actual installed StackRouter, usePreventRemove and native
// removal traversal. It queues router calls and preserves SDK visited symbols.
let mockFocused = true;
const native = createSellNavigationFixture(() => mockFocused, 'pricing');
const routerIO = jest.requireMock('expo-router') as Record<string, unknown>;
routerIO.useNavigation = () => native.navigation;
routerIO.useRoute = () => native.route;
routerIO.useNavigationContainerRef = () => native.rootRef;
routerIO.useLocalSearchParams = () => ({ resumeDraft: 'true' });
routerIO.useFocusEffect = jest.requireActual('expo-router/build/react-navigation/core/useFocusEffect').useFocusEffect;
const routerActions = routerIO.router as { back: jest.Mock; push: jest.Mock };
const PricingScreen = (require('@/app/sell/pricing') as typeof import('@/app/sell/pricing')).default;
const draftService = (require('@/features/sell/services/draftService') as typeof import('@/features/sell/services/draftService')).default;
const { getNeighborhoodById } = require('@/data/neighborhoods') as typeof import('@/data/neighborhoods');
let initialDraft: ArticleDraft;
let storageSet: typeof AsyncStorage.setItem;

function Pricing() {
  const removed = React.useSyncExternalStore(native.subscribe, native.removed, native.removed);
  return removed ? null : <native.Provider><PricingScreen /></native.Provider>;
}
async function showPricing() {
  const view = render(<Pricing />);
  await waitFor(() => expect(view.getByTestId('sell-price-input').props.value).toBe('20'));
  fireEvent.changeText(view.getByTestId('sell-price-input'), '34,50');
  fireEvent.press(view.getByText('Mile End'));
  return view;
}
function goBack() { native.queueBack(); native.flush(); }
async function flushHeaderQueue() {
  await waitFor(() => expect(native.queued()).toBeGreaterThan(0));
  await act(async () => { native.flush(); });
}
beforeEach(async () => {
  await resetEnvironment(); await establishSession('A'); native.reset();
  mockFocused = true;
  routerActions.back.mockImplementation(native.queueBack);
  storageSet = jest.mocked(AsyncStorage.setItem).getMockImplementation()!;
  initialDraft = await draftService.startNewDraft();
  initialDraft = await draftService.updateDraftPricing(initialDraft, {
    price: 20, isHandDelivery: true, isShipping: false,
    neighborhood: getNeighborhoodById('plateau')!, neighborhoods: [getNeighborhoodById('plateau')!], packageSize: null,
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => { cleanup(); jest.mocked(AsyncStorage.setItem).mockImplementation(storageSet); await AsyncStorage.clear(); jest.restoreAllMocks(); });

it('persists price and neighborhoods through the real service before a native back, without an exit confirmation', async () => {
  await showPricing();
  act(goBack);
  await waitFor(() => expect(native.removed()).toBe(true));
  const saved = await draftService.loadDraft();
  expect(saved?.id).toBe(initialDraft.id); expect(saved?.pricing?.price).toBe(34.5);
  expect(saved?.pricing?.neighborhoods.map(value => value.id)).toEqual(['plateau', 'mile-end']);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('retains the typed values and blocks header back when the actual storage write fails', async () => {
  const view = await showPricing();
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key.includes('@article_draft:user:A')) throw new Error('Synthetic storage unavailable');
    return storageSet(key, value);
  });
  fireEvent.press(view.getByRole('button', { name: 'Retour' }));
  await flushHeaderQueue();
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Brouillon non sauvegardé', expect.any(String)));
  expect(native.removed()).toBe(false);
  expect(view.getByTestId('sell-price-input').props.value).toBe('34.50');
  expect(native.dispatch).toHaveBeenCalledTimes(1);
  jest.mocked(AsyncStorage.setItem).mockImplementation(storageSet);
  fireEvent.press(view.getByRole('button', { name: 'Retour' }));
  await flushHeaderQueue();
  await waitFor(() => expect(native.removed()).toBe(true));
  expect((await draftService.loadDraft())?.pricing?.price).toBe(34.5);
});

it('recovers from a failed initial step marker when a later owned save can succeed', async () => {
  await draftService.saveDraft({ ...initialDraft, currentStep: 2 });
  let failedMarker = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key.includes('@article_draft:user:A') && !failedMarker) {
      failedMarker = true; throw new Error('Synthetic initial step write failure');
    }
    return storageSet(key, value);
  });
  await showPricing();
  expect(failedMarker).toBe(true);
  act(goBack);
  await waitFor(() => expect(native.removed()).toBe(true));
  const saved = await draftService.loadDraft();
  expect(saved?.id).toBe(initialDraft.id); expect(saved?.pricing?.price).toBe(34.5);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('waits for the save then replays the exact parent action once, retaining its SDK symbol and absent source', async () => {
  await showPricing(); const pending = deferred<void>(); let writing = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key.includes('@article_draft:user:A')) { writing = true; await pending.promise; }
    return storageSet(key, value);
  });
  const marker = Symbol('native action identity');
  const action = { type: 'REPLACE', target: 'root-stack', payload: { name: '(tabs)' }, [marker]: 'preserve' };
  act(() => native.dispatch(action));
  await waitFor(() => expect(writing).toBe(true));
  expect(native.removed()).toBe(false); expect(native.dispatch).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(); });
  await waitFor(() => expect(native.getRootState().routes[native.getRootState().index].name).toBe('(tabs)'));
  expect(native.dispatch).toHaveBeenCalledTimes(2);
  const replay = native.dispatch.mock.calls[1][0];
  expect(replay).toBe(native.prevented[0]);
  expect(Reflect.get(replay, marker)).toBe('preserve'); expect(replay.target).toBe('root-stack');
  expect(Object.hasOwn(replay, 'source')).toBe(false);
  expect(native.navigation.dispatch).not.toHaveBeenCalled();
});

it.each(['same-uid-new-sdk', 'batched-A-B-A', 'blur', 'unmount'] as const)('does not replay or alert from an old save after %s', async change => {
  const view = await showPricing(); const pending = deferred<void>(); let writing = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key.includes('@article_draft:user:A')) { writing = true; await pending.promise; }
    return storageSet(key, value);
  });
  act(goBack); await waitFor(() => expect(writing).toBe(true));
  if (change === 'same-uid-new-sdk') { providerIdentity('A'); view.rerender(<Pricing />); }
  else if (change === 'batched-A-B-A') {
    const original = auth.currentUser;
    await act(async () => {
      providerIdentity('B'); const other = useAuthStore.getState().hydrateFromFirebase(auth.currentUser);
      Object.assign(auth, { currentUser: original }); const restored = useAuthStore.getState().hydrateFromFirebase(original);
      await Promise.all([other, restored]);
    });
  } else if (change === 'blur') { mockFocused = false; view.rerender(<Pricing />); }
  else view.unmount();
  await act(async () => { pending.resolve(); });
  expect(native.dispatch).toHaveBeenCalledTimes(1); expect(Alert.alert).not.toHaveBeenCalled();
});

it('does not complete an old departure after the user edits its price while saving', async () => {
  const view = await showPricing(); const pending = deferred<void>(); let writing = false;
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    if (key.includes('@article_draft:user:A')) { writing = true; await pending.promise; }
    return storageSet(key, value);
  });
  act(goBack); await waitFor(() => expect(writing).toBe(true));
  fireEvent.changeText(view.getByTestId('sell-price-input'), '52.25');
  await act(async () => { pending.resolve(); });
  expect(native.removed()).toBe(false);
  expect(native.dispatch).toHaveBeenCalledTimes(1); expect(Alert.alert).not.toHaveBeenCalled();
  expect(view.getByTestId('sell-price-input').props.value).toBe('52.25');
  jest.mocked(AsyncStorage.setItem).mockImplementation(storageSet);
  act(goBack); await waitFor(() => expect(native.removed()).toBe(true));
  expect((await draftService.loadDraft())?.pricing?.price).toBe(52.25);
});

it('does not overwrite a newly replaced draft with the former screen values', async () => {
  const view = await showPricing();
  const replacement = await draftService.startNewDraft();
  expect(replacement.id).not.toBe(initialDraft.id);
  act(goBack);
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Brouillon non sauvegardé', expect.any(String)));
  expect(native.removed()).toBe(false);
  expect(view.getByTestId('sell-price-input').props.value).toBe('34.50');
  const saved = await draftService.loadDraft();
  expect(saved?.id).toBe(replacement.id); expect(saved?.pricing).toBeNull();
});

it('persists before the normal preview transition and retains saved draft context', async () => {
  const view = await showPricing();
  fireEvent.press(view.getByTestId('sell-pricing-footer-cta'));
  await waitFor(() => expect(routerActions.push).toHaveBeenCalledTimes(1));
  const saved = await draftService.loadDraft();
  expect(saved?.id).toBe(initialDraft.id); expect(saved?.pricing?.price).toBe(34.5);
  const request = routerActions.push.mock.calls[0][0];
  expect(request.pathname).toBe('/sell/preview'); expect(request.params.resumeDraft).toBe('true');
  expect(JSON.parse(decodeURIComponent(request.params.pricing)).neighborhoods.map((value: { id: string }) => value.id)).toEqual(['plateau', 'mile-end']);
});
