import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { colors } from '@/constants/theme';
import { track } from '@/lib/analytics';
import type { AIAnalysisResult } from '@/types/ai';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/components/PrivateStorageImage', () => ({ PrivateStorageImage: () => null }));
jest.mock('react-native-reanimated', () => ({ ...require('react-native-reanimated/mock'), useReducedMotion: () => false }));
let mockAuthGeneration = 1;
let mockFocusRevision = '1';
jest.mock('@/store/authStore', () => ({
  getAuthSessionGeneration: () => mockAuthGeneration,
  useAuthStore: (selector: () => unknown) => selector(),
}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({ useLabelLifecycleContext: (dossier: string) => {
  const { useMemo, useRef, useLayoutEffect } = require('react') as typeof React;
  const { AppState } = require('react-native') as typeof import('react-native');
  const frame = useMemo(() => Symbol('photos-review-context'), [dossier, mockAuthGeneration]);
  const revision = mockFocusRevision;
  const current = useRef({ frame, revision });
  useLayoutEffect(() => { current.current = { frame, revision }; }, [frame, revision]);
  const assertCurrent = (operation: { frame: symbol; revision: string }) => {
    if (AppState.currentState !== 'active' || current.current.frame !== operation.frame || current.current.revision !== operation.revision)
      throw new Error('Stale photo context');
  };
  const capture = () => { const operation = { frame, revision }; assertCurrent(operation); return operation; };
  return { frame, focused: AppState.currentState === 'active', focusRevision: revision, capture, start: capture, assertCurrent,
    isCurrent: (operation: { frame: symbol; revision: string }) => {
      try { assertCurrent(operation); return true; } catch { return false; }
    }, finish: jest.fn() };
} }));
const mockPhotos = ['file:///documents/a.jpg', 'file:///documents/b.jpg', 'file:///documents/c.jpg'];
const mockUrls = ['https://storage/a', 'https://storage/b', 'https://storage/c'];
const mockDraft = { id: 'draft-test', photos: mockPhotos, originalPhotoUris: mockPhotos, storageUrls: mockUrls, aiResult: { title: 'Article test' } as { title: string } | null };
const mockLoadDraft = jest.fn((..._args: unknown[]) => Promise.resolve(mockDraft));
const mockUpdatePhotos = jest.fn((..._args: unknown[]) => Promise.resolve(mockDraft));
const mockUpdateAIResult = jest.fn((..._args: unknown[]) => Promise.resolve(mockDraft));
const mockAnalyzeProductImage = jest.fn();
jest.mock('@/features/sell/services/draftService', () => ({
  __esModule: true,
  default: { assertCurrentOwner: jest.fn(), loadDraft: (...args: unknown[]) => mockLoadDraft(...args), updateDraftPhotos: (...args: unknown[]) => mockUpdatePhotos(...args),
    updateDraftAIResult: (...args: unknown[]) => mockUpdateAIResult(...args), updateDraftStorageUrls: jest.fn() },
  createEmptyDraft: () => mockDraft,
  analysisMatchesPhotos: jest.fn(() => true),
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ photos: JSON.stringify(mockPhotos) }),
  useRouter: () => require('expo-router').router,
  useFocusEffect: jest.fn(),
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
  router: { push: jest.fn(), back: jest.fn() },
}));
jest.mock('@/components/ui', () => ({
  Button: jest.requireActual('@/components/ui/Button').Button,

  ScreenHeader: ({ onBack }: { onBack: () => void }) => {
    const { Pressable } = require('react-native');
    return <Pressable testID="test-back" onPress={onBack} />;
  },
}));
jest.mock('@/features/sell', () => ({
  DraggablePhotoGrid: require('@/features/sell/components/photos-review/DraggablePhotoGrid').DraggablePhotoGrid,
  AnalysisCard: require('@/features/sell/components/analysis/AnalysisCard').AnalysisCard,
  ProgressStepsList: () => null,
  AnalysisFooter: require('@/features/sell/components/analysis/AnalysisFooter').AnalysisFooter,
}));
jest.mock('@/features/sell/services/aiService', () => ({ analyzeProductImage: (...args: unknown[]) => mockAnalyzeProductImage(...args), createMockAIResult: () => ({}) }));
import PhotosReviewScreen from '@/app/sell/photos-review';

describe('photos review navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthGeneration = 1;
    mockFocusRevision = '1';
    mockLoadDraft.mockReset().mockResolvedValue(mockDraft);
    mockUpdatePhotos.mockReset().mockResolvedValue(mockDraft);
    mockUpdateAIResult.mockReset().mockResolvedValue(mockDraft);
    mockAnalyzeProductImage.mockReset();
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  });

  it('persists accessible photo order with matching URLs, invalidates old suggestions and awaits manual handoff only once', async () => {
    const screen = render(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await waitFor(() => expect(screen.getByTestId('sell-photos-review-continue')).toBeTruthy());
    expect(router.push).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId('sell-photo-accessibility-2'), 'accessibilityAction', { nativeEvent: { actionName: 'moveBefore' } });
    await waitFor(() => expect(mockUpdatePhotos).toHaveBeenCalledWith(mockDraft, [mockPhotos[0], mockPhotos[2], mockPhotos[1]], [mockUrls[0], mockUrls[2], mockUrls[1]], { invalidateAnalysis: true }));
    expect(screen.queryByTestId('sell-photos-review-continue')).toBeNull();
    let finishSave: () => void = () => undefined;
    mockUpdatePhotos.mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve(mockDraft); }));
    fireEvent.press(screen.getByTestId('sell-manual-entry-button'));
    fireEvent.press(screen.getByTestId('sell-manual-entry-button'));
    await act(async () => { await Promise.resolve(); });
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => finishSave());
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    const params = (router.push as jest.Mock).mock.calls[0][0].params;
    expect(JSON.parse(decodeURIComponent(params.photos))).toEqual([mockPhotos[0], mockPhotos[2], mockPhotos[1]]);
    expect(JSON.parse(decodeURIComponent(params.storageUrls))).toEqual([mockUrls[0], mockUrls[2], mockUrls[1]]);
  });

  it('keeps preparation enabled during photo-edit saves, invalidates suggestions and disables it after the last removal', async () => {
    const draftWithoutAnalysis = { ...mockDraft, aiResult: null };
    mockLoadDraft.mockResolvedValue(draftWithoutAnalysis);
    const screen = render(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await waitFor(() => expect(screen.getByTestId('sell-analyze-button')).toBeEnabled());

    let finishRead: () => void = () => undefined;
    mockLoadDraft.mockImplementationOnce(() => new Promise(resolve => { finishRead = () => resolve(mockDraft); }));
    fireEvent.press(screen.getByTestId('sell-thumbnail-remove-2'));
    expect(screen.getByTestId('sell-analyze-button')).toBeEnabled();
    expect(screen.getByTestId('sell-analyze-button')).toHaveStyle({ backgroundColor: colors.primaryLight });
    await act(async () => { await Promise.resolve(); });
    await act(async () => finishRead());
    await waitFor(() => expect(mockUpdatePhotos).toHaveBeenLastCalledWith(mockDraft, mockPhotos.slice(0, 2), [], { invalidateAnalysis: true }));

    mockLoadDraft.mockImplementationOnce(() => new Promise(resolve => { finishRead = () => resolve(mockDraft); }));
    fireEvent(screen.getByTestId('sell-photo-accessibility-1'), 'accessibilityAction', { nativeEvent: { actionName: 'makePrimary' } });
    expect(screen.getByTestId('sell-analyze-button')).toBeEnabled();
    expect(screen.getByTestId('sell-analyze-button')).toHaveStyle({ backgroundColor: colors.primaryLight });
    await act(async () => { await Promise.resolve(); });
    await act(async () => finishRead());
    await waitFor(() => expect(mockUpdatePhotos).toHaveBeenLastCalledWith(mockDraft, [mockPhotos[1], mockPhotos[0]], [], { invalidateAnalysis: true }));
    expect(screen.queryByTestId('sell-photos-review-continue')).toBeNull();

    fireEvent.press(screen.getByTestId('sell-thumbnail-remove-1'));
    await waitFor(() => expect(mockUpdatePhotos).toHaveBeenLastCalledWith(draftWithoutAnalysis, [mockPhotos[1]], [], { invalidateAnalysis: true }));
    fireEvent.press(screen.getByTestId('sell-thumbnail-remove-0'));
    expect(screen.getByTestId('sell-analyze-button')).toBeDisabled();
    await waitFor(() => expect(mockUpdatePhotos).toHaveBeenLastCalledWith(draftWithoutAnalysis, [], [], { invalidateAnalysis: true }));
  });

  it('waits for restoration on entry and a new focus/session, and ignores an older completed read', async () => {
    const reads: Array<() => void> = [];
    mockLoadDraft.mockImplementation(() => new Promise(resolve => { reads.push(() => resolve({ ...mockDraft, aiResult: null })); }));
    const screen = render(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    expect(screen.getByTestId('sell-analyze-button')).toBeDisabled();
    await waitFor(() => expect(reads).toHaveLength(1));
    mockFocusRevision = '2';
    screen.rerender(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await waitFor(() => expect(reads).toHaveLength(2));
    await act(async () => reads[0]());
    expect(screen.getByTestId('sell-analyze-button')).toBeDisabled();
    await act(async () => reads[1]());
    expect(screen.getByTestId('sell-analyze-button')).toBeEnabled();

    mockAuthGeneration += 1;
    screen.rerender(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    expect(screen.getByTestId('sell-analyze-button')).toBeDisabled();
    await waitFor(() => expect(reads).toHaveLength(3));
    await act(async () => reads[2]());
    expect(screen.getByTestId('sell-analyze-button')).toBeEnabled();
  });

  it('opens details exactly once after a requested analysis and both qualified draft writes', async () => {
    mockLoadDraft.mockResolvedValue({ ...mockDraft, aiResult: null });
    const result = { title: 'Robe préparée' } as AIAnalysisResult;
    mockAnalyzeProductImage.mockResolvedValue({ success: true, result, storageUrls: mockUrls });
    const savedPhotos = { ...mockDraft, id: 'saved-photo-snapshot' };
    mockUpdatePhotos.mockResolvedValue(savedPhotos);
    let finishSave: () => void = () => undefined;
    mockUpdateAIResult.mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve(savedPhotos); }));
    const screen = render(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await waitFor(() => expect(screen.getByTestId('sell-analyze-button')).toBeEnabled());
    const prepare = screen.getByTestId('sell-analyze-button');
    fireEvent.press(prepare);
    fireEvent.press(prepare);
    await waitFor(() => expect(mockUpdateAIResult).toHaveBeenCalledWith(savedPhotos, result, mockUrls));
    expect(mockAnalyzeProductImage).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByText('Détails préparés')).toBeTruthy();
    expect(screen.queryByText('Préparation des détails')).toBeNull();
    expect(screen.getByTestId('sell-thumbnail-remove-0')).toBeDisabled();
    expect(screen.queryByTestId('sell-photos-review-continue')).toBeNull();
    await act(async () => finishSave());
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    const params = (router.push as jest.Mock).mock.calls[0][0].params;
    expect(JSON.parse(decodeURIComponent(params.photos))).toEqual(mockPhotos);
    expect(JSON.parse(decodeURIComponent(params.storageUrls))).toEqual(mockUrls);
    expect(JSON.parse(decodeURIComponent(params.aiResult))).toEqual(result);
  });

  it('retries only the local handoff after its write fails, preserving the completed model result', async () => {
    mockLoadDraft.mockResolvedValue({ ...mockDraft, aiResult: null });
    const result = { title: 'Robe préparée' } as AIAnalysisResult;
    mockAnalyzeProductImage.mockResolvedValue({ success: true, result, storageUrls: mockUrls });
    mockUpdateAIResult.mockRejectedValueOnce(new Error('local write failed'));
    const screen = render(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await waitFor(() => expect(screen.getByTestId('sell-analyze-button')).toBeEnabled());
    fireEvent.press(screen.getByTestId('sell-analyze-button'));
    await waitFor(() => expect(screen.getByText('Les détails sont prêts. Réessayez pour les ouvrir.')).toBeTruthy());
    expect(router.push).not.toHaveBeenCalled();
    let finishSave: () => void = () => undefined;
    mockUpdateAIResult.mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve(mockDraft); }));
    const retry = screen.getByTestId('sell-photos-review-continue');
    fireEvent.press(retry);
    fireEvent.press(retry);
    await waitFor(() => expect(mockUpdateAIResult).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Détails préparés')).toBeTruthy();
    expect(screen.queryByText('Préparation des détails')).toBeNull();
    expect(screen.queryByTestId('sell-photos-review-continue')).toBeNull();
    expect(screen.queryByTestId('sell-analysis-relaunch')).toBeNull();
    expect(mockAnalyzeProductImage).toHaveBeenCalledTimes(1);
    await act(async () => finishSave());
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(mockAnalyzeProductImage).toHaveBeenCalledTimes(1);
    expect(mockUpdateAIResult).toHaveBeenCalledTimes(2);
    expect(mockUpdateAIResult).toHaveBeenLastCalledWith(mockDraft, result, mockUrls);
    expect(jest.mocked(track).mock.calls.filter(([event]) => event === 'ai_analysis_failed')).toHaveLength(0);
  });

  it('does not navigate when the app backgrounds during the qualified local opening writes', async () => {
    mockLoadDraft.mockResolvedValue({ ...mockDraft, aiResult: null });
    mockAnalyzeProductImage.mockResolvedValue({ success: true, result: { title: 'Résultat préparé' }, storageUrls: mockUrls });
    let finishSave: () => void = () => undefined;
    mockUpdateAIResult.mockImplementationOnce(() => new Promise(resolve => { finishSave = () => resolve(mockDraft); }));
    const screen = render(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await waitFor(() => expect(screen.getByTestId('sell-analyze-button')).toBeEnabled());
    fireEvent.press(screen.getByTestId('sell-analyze-button'));
    await waitFor(() => expect(mockUpdateAIResult).toHaveBeenCalledTimes(1));
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
    screen.rerender(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await act(async () => finishSave());
    expect(router.push).not.toHaveBeenCalled();
    expect(mockAnalyzeProductImage).toHaveBeenCalledTimes(1);
  });

  it('keeps the fresh result displayed and retries it after refocus instead of adopting an older saved analysis', async () => {
    const oldDraft = { ...mockDraft, aiResult: { title: 'Ancien résultat', brand: { detected: 'Ancienne marque' } } };
    const result = { title: 'Résultat frais', brand: { detected: 'Marque fraîche' } } as AIAnalysisResult;
    mockLoadDraft.mockResolvedValue(oldDraft);
    mockAnalyzeProductImage.mockResolvedValue({ success: true, result, storageUrls: mockUrls });
    mockUpdateAIResult.mockRejectedValueOnce(new Error('local write failed'));
    const screen = render(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await waitFor(() => expect(screen.getByText('Ancienne marque')).toBeTruthy());
    fireEvent.press(screen.getByTestId('sell-analysis-relaunch'));
    await waitFor(() => expect(screen.getByText('Les détails sont prêts. Réessayez pour les ouvrir.')).toBeTruthy());
    expect(screen.getByText('Marque fraîche')).toBeTruthy();
    mockFocusRevision = '2';
    screen.rerender(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await waitFor(() => expect(screen.getByTestId('sell-photos-review-continue')).toBeEnabled());
    expect(screen.getByText('Marque fraîche')).toBeTruthy();
    expect(screen.queryByText('Ancienne marque')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('sell-photos-review-continue'));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(mockAnalyzeProductImage).toHaveBeenCalledTimes(1);
    expect(mockUpdateAIResult).toHaveBeenLastCalledWith(mockDraft, result, mockUrls);
    const params = (router.push as jest.Mock).mock.calls[0][0].params;
    expect(JSON.parse(decodeURIComponent(params.aiResult))).toEqual(result);
  });

  it.each(['session', 'background'] as const)('does not open details for a successful response after the %s context is lost', async kind => {
    mockLoadDraft.mockResolvedValue({ ...mockDraft, aiResult: null });
    let finishAnalysis: () => void = () => undefined;
    mockAnalyzeProductImage.mockImplementationOnce(() => new Promise(resolve => {
      finishAnalysis = () => resolve({ success: true, result: { title: 'Ancien résultat' }, storageUrls: mockUrls });
    }));
    const screen = render(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await waitFor(() => expect(screen.getByTestId('sell-analyze-button')).toBeEnabled());
    fireEvent.press(screen.getByTestId('sell-analyze-button'));
    await waitFor(() => expect(mockAnalyzeProductImage).toHaveBeenCalledTimes(1));
    if (kind === 'session') mockAuthGeneration += 1;
    else Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
    screen.rerender(<GestureHandlerRootView><PhotosReviewScreen /></GestureHandlerRootView>);
    await act(async () => finishAnalysis());
    expect(router.push).not.toHaveBeenCalled();
    expect(mockUpdateAIResult).not.toHaveBeenCalled();
  });
});
