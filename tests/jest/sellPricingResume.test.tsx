import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
const mockDraft = {
  id: 'draft-test', currentStep: 3,
  photos: ['file:///documents/reordered.jpg'], storageUrls: ['https://storage/reordered'],
  fields: { title: 'Titre conservé', description: 'Description', categoryIds: ['women'], colors: [], materials: [], brands: [], size: null, brand: '' },
  aiResult: { title: 'Titre IA' },
  pricing: { price: 20, isHandDelivery: true, isShipping: false, neighborhoods: [{ id: 'n1', name: 'Quartier', borough: 'Borough' }], packageSize: null },
};
jest.mock('@/services/draftService', () => ({
  __esModule: true,
  default: {
    loadDraft: () => Promise.resolve(mockDraft),
    updateDraftPricing: () => Promise.resolve(mockDraft),
  },
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ resumeDraft: 'true' }),
  useRouter: () => require('expo-router').router,
  useFocusEffect: jest.fn(),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()) }),
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('@/features/sell', () => ({
  PriceCard: () => null, HandDeliveryCard: () => null, ShippingCard: () => null, FormErrors: () => null,
  SellFooter: ({ onPress }: { onPress: () => void }) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="next" onPress={onPress} />;
  },
}));
jest.mock('@/components/NeighborhoodBottomSheet', () => () => null);
jest.mock('@/components/sell/FormSectionTitle', () => () => null);
jest.mock('@/components/ui', () => ({ ScreenHeader: () => null }));
import PricingScreen from '@/app/sell/pricing';

describe('resume sell pricing', () => {
  it('passes saved photos, uploaded order, details and AI context through to preview', async () => {
    const screen = render(<PricingScreen />);
    await waitFor(() => expect(screen.getByTestId('next')).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(screen.getByTestId('next'));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    const { params } = (router.push as jest.Mock).mock.calls[0][0];
    expect(JSON.parse(params.photos)).toEqual(mockDraft.photos);
    expect(JSON.parse(params.storageUrls)).toEqual(mockDraft.storageUrls);
    expect(JSON.parse(params.fields)).toEqual(mockDraft.fields);
    expect(JSON.parse(params.aiResult)).toEqual(mockDraft.aiResult);
  });
});
