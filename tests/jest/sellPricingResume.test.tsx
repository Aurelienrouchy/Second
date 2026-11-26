import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { establishSession, resetEnvironment } from './auth-onboarding/eligibilityTestHarness';
import { createSellNavigationFixture } from './helpers/sellNavigationFixture';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
const mockDraft = {
  id: 'draft-test', currentStep: 3,
  photos: ['file:///documents/reordered.jpg'], storageUrls: ['https://storage/reordered'],
  fields: { title: 'Titre conservé', description: 'Description', categoryIds: ['women'], colors: [], materials: [], brands: [], size: null, brand: '' },
  aiResult: { title: 'Titre IA' },
  pricing: { price: 20, isHandDelivery: true, isShipping: false, neighborhoods: [{ id: 'n1', name: 'Quartier', borough: 'Borough' }], packageSize: null },
};
jest.mock('@/features/sell/services/draftService', () => ({
  __esModule: true,
  default: {
    assertCurrentOwner: jest.fn(),
    loadDraft: () => Promise.resolve(mockDraft),
    updateDraftPricing: () => Promise.resolve(mockDraft),
  },
}));
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.requireActual('expo-router/build/react-navigation/core/usePreventRemove').usePreventRemove,
  useIsFocused: jest.requireActual('expo-router/build/react-navigation/core/useIsFocused').useIsFocused,
}));
jest.mock('@/features/sell', () => ({
  PriceCard: () => null, HandDeliveryCard: () => null, ShippingCard: () => null, FormErrors: () => null,
  SellFooter: ({ onPress }: { onPress: () => void }) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="next" onPress={onPress} />;
  },
}));
jest.mock('@/features/sell/components/pricing/NeighborhoodBottomSheet', () => () => null);
jest.mock('@/features/sell/components/shared/FormSectionTitle', () => () => null);
jest.mock('@/components/ui', () => ({
  Button: jest.requireActual('@/components/ui/Button').Button,
 ScreenHeader: () => null }));
import PricingScreen from '@/app/sell/pricing';
const native = createSellNavigationFixture(() => true, 'pricing');
const routerIO = jest.requireMock('expo-router') as Record<string, unknown>;
routerIO.useLocalSearchParams = () => ({ resumeDraft: 'true' });
routerIO.useNavigation = () => native.navigation;
routerIO.useNavigationContainerRef = () => native.rootRef;
routerIO.useRoute = () => native.route;
routerIO.useFocusEffect = jest.requireActual('expo-router/build/react-navigation/core/useFocusEffect').useFocusEffect;

describe('resume sell pricing', () => {
  beforeEach(async () => { await resetEnvironment(); await establishSession('A'); native.reset(); });
  it('passes saved photos, uploaded order, details and AI context through to preview', async () => {
    const screen = render(<native.Provider><PricingScreen /></native.Provider>);
    await waitFor(() => expect(screen.getByTestId('next')).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(screen.getByTestId('next'));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    const { params } = (router.push as jest.Mock).mock.calls[0][0];
    expect(JSON.parse(decodeURIComponent(params.photos))).toEqual(mockDraft.photos);
    expect(JSON.parse(decodeURIComponent(params.storageUrls))).toEqual(mockDraft.storageUrls);
    expect(JSON.parse(decodeURIComponent(params.fields))).toEqual(mockDraft.fields);
    expect(JSON.parse(decodeURIComponent(params.aiResult))).toEqual(mockDraft.aiResult);
  });
});
