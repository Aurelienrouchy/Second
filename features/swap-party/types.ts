/**
 * Swap Party Feature Types
 */

import { SwapParty, SwapPartyItemExtended, Article } from '@/types';

export interface PartyHeaderProps {
  party: SwapParty;
  /** @deprecated Swap Zone is always active — countdown removed. Kept optional for reversibility. */
  countdownDays?: number | null;
  onBack: () => void;
}

export interface MyArticlesSectionProps {
  userItems: SwapPartyItemExtended[];
  /** @deprecated Swap Zone is always active — status no longer gates add/remove. */
  partyStatus?: SwapParty['status'];
  onAddPress: () => void;
  onRemoveItem: (articleId: string) => void;
}

export interface PartyActionsProps {
  isJoined: boolean;
  /** @deprecated Swap Zone is always active — status no longer gates actions. */
  partyStatus?: SwapParty['status'];
  isJoining: boolean;
  onJoin: () => void;
  onLeave: () => void;
}

export interface PartyItemCardProps {
  item: SwapPartyItemExtended;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export interface AddItemModalProps {
  visible: boolean;
  articles: Article[];
  userItems: SwapPartyItemExtended[];
  onAddItem: (article: Article) => void;
  onClose: () => void;
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
