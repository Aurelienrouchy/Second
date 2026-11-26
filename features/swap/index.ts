/**
 * Swap — barrel de la feature.
 *
 * Couvre le domaine métier « Swap & SwapZone » (docs/metier/13) dans ses trois
 * moments, auparavant éclatés en trois features distinctes :
 *   - `propose/` : proposer un échange à un vendeur (ex-feature propose-swap)
 *   - `party/`   : la SwapZone généraliste — dépôt/retrait d'articles
 *                  (ex-feature swap-party)
 *   - `detail/`  : le cycle d'un échange accepté — statuts, actions, contact
 *
 * L'éclatement forçait des composants de pont dans components/swap/ pour
 * contourner l'interdiction d'import entre features.
 */

// — proposer un échange —
export { ArticleSelectionSection } from './components/propose/ArticleSelectionSection';
export { ProposeSwapSkeleton } from './components/propose/ProposeSwapSkeleton';
export { ProposeSwapTopBar } from './components/propose/ProposeSwapTopBar';
export { SubmitFooter } from './components/propose/SubmitFooter';
export { SwapMessageInput } from './components/propose/SwapMessageInput';
export { ValueComparisonBox } from './components/propose/ValueComparisonBox';

// — SwapZone —
export { default as AddItemSheet } from './components/party/AddItemSheet';
export type {
  AddItemSheetProps,
  AddItemSheetRef,
} from './components/party/AddItemSheet';
export { MultiSelectBar } from './components/party/MultiSelectBar';
export { MyArticlesSection } from './components/party/MyArticlesSection';
export { PartyEmptyGrid } from './components/party/PartyEmptyGrid';
export { PartyHeader } from './components/party/PartyHeader';
export { PartyItemCard } from './components/party/PartyItemCard';
export { SwapPartyDetailSkeleton } from './components/party/SwapPartyDetailSkeleton';

// — cycle d'un échange —
export { SwapActions } from './components/detail/SwapActions';
export { SwapContactButton } from './components/detail/SwapContactButton';
export { SwapDetailSkeleton } from './components/detail/SwapDetailSkeleton';
export { SwapProposalView } from './components/detail/SwapProposalView';
export { SwapStatusView } from './components/detail/SwapStatusView';
export { SwapHoldReviewNotice } from './components/detail/SwapHoldReviewNotice';
export { SwapStickyActions } from './components/detail/SwapStickyActions';
export { SwapTopBar } from './components/detail/SwapTopBar';

// — briques partagées entre les trois moments (ex-components/swap/) —
export { default as SwapItemCard } from './components/shared/SwapItemCard';
export { default as SwapItemSelector } from './components/shared/SwapItemSelector';
export { default as SwapSeparator } from './components/shared/SwapSeparator';
export { default as SwapSummaryBox } from './components/shared/SwapSummaryBox';

export type {
  SwapParticipantContext,
  SwapActionHandlers,
  Swap,
  SwapStatus,
  SwapExchangeMode,
  SwapItemInfo,
  PartyHeaderProps,
  MyArticlesSectionProps,
  PartyItemCardProps,
  MultiSelectBarProps,
  PartyEmptyGridProps,
} from './types';
export { getSwapStatusLabel, getSwapNextStep, getSwapPhotoCount, hasSwapAgreementConfirmations } from './presentation';

export { TrocFilterRow } from './components/party/TrocFilterRow';
export { SwapComparisonLayout } from './components/shared/SwapComparisonLayout';
export { SwapAgreementReview } from './components/shared/SwapAgreementReview';
export { SwapArrangementFields } from './components/shared/SwapArrangementFields';
export { SwapListCard } from './components/list/SwapListCard';

export { SwapActionSheet } from './components/shared/SwapActionSheet';
export { SwapProofPhotos } from './components/detail/SwapProofPhotos';
export { SwapLaunchAdmissionSheet } from './components/shared/SwapLaunchAdmissionSheet';
