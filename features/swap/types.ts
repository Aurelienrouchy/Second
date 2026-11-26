/**
 * Swap feature — shared types for sub-components.
 */

import { Swap, SwapExchangeMode, SwapItemInfo, SwapStatus , SwapParty, SwapPartyItemExtended } from '@/types';

// =============================================================================
// SWAPZONE — props des composants de la zone (ex-feature swap-party)
// =============================================================================


/** Derived fields computed once in the screen and passed down. */
export interface SwapParticipantContext {
  isInitiator: boolean;
  isReceiver: boolean;
  senderName: string;
  senderImage: string | undefined;
  senderItems: SwapItemInfo[];
  myItems: SwapItemInfo[];
  hasUploadedPhotos: boolean;
  /** Local files awaiting an explicit send; never evidence of upload. */
  hasSelectedPhotos?: boolean;
  hasConfirmedShipping: boolean;
  counterpartHasShipped?: boolean;
  hasConfirmedReception: boolean;
  hasRated: boolean;
  /** True when the current user is the cash top-up payer (cashTopUp.payerId). */
  isTopUpPayer: boolean;
  /** Display name of the party expected to pay the cash top-up. */
  topUpPayerName: string;
}

/** Action callbacks passed from the screen to action components. */
export interface SwapActionHandlers {
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onPayTopUp: () => void;
  onSetExchangeMode: (mode: SwapExchangeMode) => void;
  onUploadPhotos: () => void;
  onConfirmShipping: () => void;
  onConfirmReception: () => void;
  onRate: (score: number) => void;
}

export { type Swap, type SwapStatus, type SwapExchangeMode, type SwapItemInfo };

export interface PartyHeaderProps {
  party?: SwapParty;
  onBack: () => void;
  onMySwaps?: () => void;
}

export interface MyArticlesSectionProps {
  userItems: SwapPartyItemExtended[];
  onAddPress: () => void;
  onRemoveItem: (articleId: string) => void;
  /** Number of articles currently being added (deposit in flight). Renders that
   *  many skeleton rows at the head of the list until the refetch resolves. */
  pendingCount?: number;
  removingArticleIds?: ReadonlySet<string>;
  isGuest?: boolean;
  compact?: boolean;
}

export interface PartyItemCardProps {
  item: SwapPartyItemExtended;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  /** Disabled when another seller has already been picked in multi-select. */
  disabled?: boolean;
  tone?: 'light' | 'dark';
  featured?: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export interface MultiSelectBarProps {
  selectedCount: number;
  canPropose: boolean;
  onCancel: () => void;
  onPropose: () => void;
}

export interface PartyEmptyGridProps {
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}
