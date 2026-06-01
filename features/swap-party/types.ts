/**
 * Swap Party Feature Types
 *
 * The Swap Zone is a single, always-active generalist zone open to everyone
 * (no join/leave, no status, no countdown).
 */

import { SwapParty, SwapPartyItemExtended } from '@/types';

export interface PartyHeaderProps {
  party: SwapParty;
  onBack: () => void;
}

export interface MyArticlesSectionProps {
  userItems: SwapPartyItemExtended[];
  onAddPress: () => void;
  onRemoveItem: (articleId: string) => void;
  /** Number of articles currently being added (deposit in flight). Renders that
   *  many skeleton rows at the head of the list until the refetch resolves. */
  pendingCount?: number;
}

export interface PartyItemCardProps {
  item: SwapPartyItemExtended;
  isSelected: boolean;
  isMultiSelectMode: boolean;
  /** Disabled when another seller has already been picked in multi-select. */
  disabled?: boolean;
  tone?: 'light' | 'dark';
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
