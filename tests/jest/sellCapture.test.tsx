import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-camera', () => ({
  CameraView: require('react-native').View,
  useCameraPermissions: () => [{ granted: false, status: 'denied', canAskAgain: false }, jest.fn()],
}));
const mockDraft = { id: 'test', photos: [], storageUrls: [] };
const mockSavePhotos = jest.fn((..._args: unknown[]) => Promise.resolve(mockDraft));
jest.mock('@/services/draftService', () => ({
  __esModule: true,
  default: { assertCurrentOwner: jest.fn(), loadDraft: () => Promise.resolve(mockDraft), saveDraft: jest.fn(), updateDraftPhotos: (...args: unknown[]) => mockSavePhotos(...args) },
  createEmptyDraft: () => mockDraft,
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: () => Promise.resolve({ canceled: false, assets: [{ uri: 'file:///gallery/selected.jpg' }] }),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
import { SellOverlayCapture } from '@/features/sell/components/capture/SellOverlayCapture';

describe('gallery capture with camera denied', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lets gallery photos continue after persistence, without waiting for the debounce', async () => {
    const onContinue = jest.fn();
    const screen = render(<SellOverlayCapture onClose={jest.fn()} onContinue={onContinue} />);
    fireEvent.press(screen.getByTestId('sell-gallery-button'));
    await waitFor(() => expect(screen.getByTestId('sell-capture-continue')).toBeTruthy());
    let finishSave: () => void = () => undefined;
    mockSavePhotos.mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve(mockDraft); }));
    fireEvent.press(screen.getByTestId('sell-capture-continue'));
    await waitFor(() => expect(mockSavePhotos).toHaveBeenCalledWith(mockDraft, ['file:///gallery/selected.jpg']));
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => finishSave());
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(['file:///gallery/selected.jpg']));
  });
});
