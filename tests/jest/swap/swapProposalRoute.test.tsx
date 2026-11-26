import React from 'react';
import {render, screen} from '@testing-library/react-native';
import {useLocalSearchParams} from 'expo-router';
import ProposeSwapScreen from '@/app/propose-swap';
import type {SwapPartyItemExtended} from '@/types';

jest.mock('@/hooks/useAuth', () => ({useUser: () => ({id: 'owner', displayName: 'Moi'}), useAuthenticatedUid: () => 'owner'}));
jest.mock('@/store/authStore', () => ({getAuthSessionGeneration: () => 1}));
jest.mock('@/hooks/useEligibility', () => ({useEligibility: () => ({data: {swapLaunch: {policyVersion: '2026-10-17.v1', allowed: true}}, refetch: jest.fn()})}));
jest.mock('@/hooks/useTradeAdmissionError', () => ({useTradeAdmissionError: () => jest.fn()}));
jest.mock('@/hooks/useLabelLifecycleContext', () => ({useLabelLifecycleContext: () => ({focused: true, focusRevision: 1})}));
jest.mock('@/hooks/usePrivateArticleImage', () => ({usePrivateArticleImage: () => ({image: null})}));
jest.mock('@/features/swap/hooks/useSwapProposalImage', () => ({useSwapProposalImage: () => null}));
jest.mock('@/features/swap/hooks/useSwapAgreement', () => ({useSwapAgreement: () => ({context: {}, preview: null, reading: false, accepted: false})}));
jest.mock('@/services/tradeOperation', () => ({isDefinitiveTradeRefusal: jest.fn()}));
jest.mock('@/services/articlesService', () => ({ArticlesService: {getArticleById: jest.fn(), getUserArticles: jest.fn()}}));
jest.mock('@/services/swapService', () => ({GENERALIST_ZONE_ID: 'generalist', getPendingSwapProposal: jest.fn(), getPartyItemsExtended: jest.fn(), proposeSwap: jest.fn()}));
jest.mock('@/services/moderationService', () => ({ModerationService: {}}));
jest.mock('@/store/authSheetStore', () => ({useAuthSheetStore: {getState: jest.fn()}}));
jest.mock('@/config/featureFlags', () => ({PAYMENTS_ENABLED: false}));
jest.mock('@/lib/analytics', () => ({track: jest.fn()}));
jest.mock('@/components/ui', () => {
  const RN = require('react-native');
  return {Text: RN.Text, Button: RN.Text};
});
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: require('react-native').View}));
jest.mock('expo-router', () => {
  const RN = require('react-native');
  return {Stack: Object.assign(RN.View, {Screen: () => null}), router: {push: jest.fn(), replace: jest.fn(), back: jest.fn()}, useLocalSearchParams: jest.fn()};
});
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({invalidateQueries: jest.fn()}),
  useQuery: (options: {queryKey: readonly unknown[]}) => options.queryKey[0] === 'swap-parties'
    ? {data: mockZoneItems, isLoading: mockZoneLoading, isError: false, refetch: jest.fn()}
    : {data: undefined, isLoading: false, isError: false, refetch: jest.fn()},
}));
jest.mock('@/features/swap', () => {
  const React = require('react');
  const RN = require('react-native');
  return {
    ArticleSelectionSection: jest.requireActual('@/features/swap/components/propose/ArticleSelectionSection').ArticleSelectionSection,
    ProposeSwapTopBar: () => null,
    ProposeSwapSkeleton: () => React.createElement(RN.Text, null, 'Chargement des articles'),
    SwapComparisonLayout: ({received, proposed}: {received: React.ReactNode; proposed: React.ReactNode}) => React.createElement(RN.View, null, received, proposed),
    SwapActionSheet: () => null,
    SwapLaunchAdmissionSheet: () => null,
    SwapAgreementReview: () => null,
    SwapArrangementFields: () => null,
    SwapItemSelector: () => null,
    SwapMessageInput: () => null,
    ValueComparisonBox: () => null,
    SubmitFooter: () => null,
  };
});

let mockZoneItems: SwapPartyItemExtended[];
let mockZoneLoading = false;
// Deliberately contains an encoded Storage object path: decoding a JSON route
// snapshot once more used to corrupt it and cause HTTP 400 on a real iPhone.
const source = 'https://storage.example.test/o/articles%2Ffixture%2Fphoto.jpg?alt=media';
const item = {id: 'deposit', articleId: 'candidate', sellerId: 'other', title: 'Veste', price: 30, imageUrl: source} as SwapPartyItemExtended;
beforeEach(() => {
  mockZoneItems = [item];
  mockZoneLoading = false;
  jest.mocked(useLocalSearchParams).mockReturnValue({receiverId: 'other', partyId: 'generalist', receiverArticleIds: JSON.stringify(['candidate'])});
});

it('resolves selected IDs from the catalogue and preserves the exact encoded image source', () => {
  render(<ProposeSwapScreen />);
  expect(screen.getByLabelText('Veste')).toHaveProp('source', {uri: source});
  expect(screen.queryByText('Échange indisponible')).toBeNull();
});

it('waits for the catalogue instead of showing a false unavailable selection', () => {
  mockZoneItems = [];
  mockZoneLoading = true;
  render(<ProposeSwapScreen />);
  expect(screen.getByText('Chargement des articles')).toBeOnTheScreen();
  expect(screen.queryByText('Échange indisponible')).toBeNull();
});

it('does not silently select a partial or different-owner set when an ID is unavailable', () => {
  mockZoneItems = [item, {...item, articleId: 'wrong-owner', sellerId: 'someone-else'}];
  jest.mocked(useLocalSearchParams).mockReturnValue({receiverId: 'other', receiverArticleIds: JSON.stringify(['candidate', 'wrong-owner'])});
  render(<ProposeSwapScreen />);
  expect(screen.getByText('Échange indisponible')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Veste')).toBeNull();
});
