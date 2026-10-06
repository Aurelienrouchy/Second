import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
const mockPhotos = ['file:///documents/a.jpg', 'file:///documents/b.jpg', 'file:///documents/c.jpg'];
const mockUrls = ['https://storage/a', 'https://storage/b', 'https://storage/c'];
const mockDraft = { id: 'draft-test', photos: mockPhotos, originalPhotoUris: mockPhotos, storageUrls: mockUrls, aiResult: { title: 'Article test' } };
const mockLoadDraft = jest.fn((..._args: unknown[]) => Promise.resolve(mockDraft));
const mockUpdatePhotos = jest.fn((..._args: unknown[]) => Promise.resolve(mockDraft));
jest.mock('@/services/draftService', () => ({
  __esModule: true,
  default: { loadDraft: (...args: unknown[]) => mockLoadDraft(...args), updateDraftPhotos: (...args: unknown[]) => mockUpdatePhotos(...args) },
  createEmptyDraft: () => mockDraft,
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ photos: JSON.stringify(mockPhotos) }),
  useRouter: () => require('expo-router').router,
  useFocusEffect: jest.fn(),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('@/components/ui', () => ({
  ScreenHeader: ({ onBack }: { onBack: () => void }) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="test-back" onPress={onBack} />;
  },
}));
jest.mock('@/features/sell', () => ({
  PhotoOrderControls: require('@/features/sell/components/shared/PhotoOrderControls').PhotoOrderControls,
  AnalysisCard: () => null,
  ProgressStepsList: () => null,
  AnalysisFooter: () => null,
}));
jest.mock('@/services/aiService', () => ({ analyzeProductImage: jest.fn(), createMockAIResult: () => ({}) }));
import PhotosReviewScreen from '@/app/sell/photos-review';

describe('photos review navigation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists arbitrary photo order and matching URLs before continuing, including fast taps', async () => {
    const screen = render(<PhotosReviewScreen />);
    await waitFor(() => expect(screen.getByTestId('sell-photos-review-continue')).toBeTruthy());
    fireEvent.press(screen.getByTestId('sell-photo-move-up-2'));
    await waitFor(() => expect(mockUpdatePhotos).toHaveBeenCalledWith(mockDraft, [mockPhotos[0], mockPhotos[2], mockPhotos[1]], [mockUrls[0], mockUrls[2], mockUrls[1]]));
    let finishSave: () => void = () => undefined;
    mockUpdatePhotos.mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve(mockDraft); }));
    fireEvent.press(screen.getByTestId('sell-photos-review-continue'));
    fireEvent.press(screen.getByTestId('sell-photos-review-continue'));
    await act(async () => { await Promise.resolve(); });
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => finishSave());
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    const params = (router.push as jest.Mock).mock.calls[0][0].params;
    expect(JSON.parse(params.photos)).toEqual([mockPhotos[0], mockPhotos[2], mockPhotos[1]]);
    expect(JSON.parse(params.storageUrls)).toEqual([mockUrls[0], mockUrls[2], mockUrls[1]]);
  });
});
