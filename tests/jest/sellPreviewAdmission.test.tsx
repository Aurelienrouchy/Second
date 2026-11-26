import { renderWithQuery as render } from '@/tests/jest/helpers/queryRender';
import React from 'react';
import {act, fireEvent, waitFor} from '@testing-library/react-native';
import {Alert} from 'react-native';
import type {ArticleDraft} from '@/features/sell/services/draftService';
import type {TradeAdmissionErrorOptions} from '@/hooks/useTradeAdmissionError';

const mockShowAdmission = jest.fn((_error: unknown, _options: TradeAdmissionErrorOptions) => true), mockCreate = jest.fn(), mockDelete = jest.fn();
let mockCurrent = true;
const mockScope = {frame: Symbol('preview'), focusRevision: 'focused', focused: true, capture: () => ({}),
  assertCurrent: () => {if (!mockCurrent) throw new Error('Stale context');}, isCurrent: () => mockCurrent};
const mockDraft: ArticleDraft = {id: 'draft', ownerUid: 'A', createdAt: '', updatedAt: '', currentStep: 4,
  photos: ['file:///photo.jpg'], originalPhotoUris: [], storageUrls: [], aiResult: null,
  fields: {title: 'Article test', description: 'Description', categoryIds: ['women', 'women_clothing', 'women_clothing_tops', 'women_clothing_tops_tshirts'], categoryDisplay: {icon: '', name: 'Haut', context: ''},
    condition: 'bon état', conditionConfirmed: true, colors: [], materials: [], brands: [], size: 'M', brand: null},
  pricing: {price: 20, isHandDelivery: true, isShipping: false, neighborhoods: [], neighborhood: null, packageSize: null}};
jest.mock('@/hooks/useTradeAdmissionError', () => ({useTradeAdmissionError: () => mockShowAdmission}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => mockScope}));
jest.mock('@/config/firebaseConfig', () => ({auth: {currentUser: {uid: 'A'}}}));
jest.mock('@/features/sell/services/draftService', () => ({__esModule: true, default: {
  captureSession: () => ({uid: 'A'}), assertCurrentSession: () => undefined,
  loadDraft: async () => mockDraft, deletePublishedDraft: (...args: unknown[]) => mockDelete(...args),
}}));
jest.mock('@/services/articlesService', () => ({ArticlesService: {createArticle: (...args: unknown[]) => mockCreate(...args), getPendingPublicationInput: async () => null}}));
jest.mock('@/services/productReviewService', () => ({ProductReviewService: {}, productReviewHash: jest.fn()}));
jest.mock('@/services/childSafetyReviewService', () => ({ChildSafetyReviewService: {}}));
jest.mock('@/features/sell/components/shared/PhotoCarousel', () => ({__esModule: true, default: () => null}));
jest.mock('@/features/sell/components/shared/SuccessModal', () => ({__esModule: true, default: () => null}));
jest.mock('@/components/ArticleChildSafetyFields', () => ({ArticleChildSafetyFields: () => null}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, [effect]),
useRouter: () => ({back: jest.fn(), push: jest.fn()}), useLocalSearchParams: () => ({resumeDraft: 'true'}), useNavigation: () => ({addListener: () => jest.fn()})}));
import Preview from '@/app/sell/preview';

it('keeps a refused publication draft, handles it without an error log, and binds subsequent help to the original operation', async () => {
  const refusal = Object.assign(new Error('admission_refused'), {code: 'functions/permission-denied'});
  mockCreate.mockRejectedValue(refusal);
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    const view = render(<Preview />);
    await waitFor(() => expect(view.getByTestId('sell-publish-button')).not.toBeDisabled());
    await act(async () => {fireEvent.press(view.getByTestId('sell-publish-button'));});
    expect(mockCreate).toHaveBeenCalledTimes(1); expect(mockDelete).not.toHaveBeenCalled();
    expect(mockShowAdmission).toHaveBeenCalledWith(refusal, expect.objectContaining({publication: {uid: 'A', requestId: 'draft'}}));
    expect(errorLog).not.toHaveBeenCalled(); expect(alert).not.toHaveBeenCalled();
    const options = mockShowAdmission.mock.calls[0][1];
    expect(options.isCurrent()).toBe(true); mockCurrent = false;
    expect(options.isCurrent()).toBe(false);
  } finally {errorLog.mockRestore(); alert.mockRestore();}
});
