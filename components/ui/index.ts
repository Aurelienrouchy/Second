/**
 * UI Components Index — Seconde UI Kit
 * Design: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Exports all design system components for easy importing:
 * import { Button, Input, Avatar, Tag } from '@/components/ui';
 */

// =============================================================================
// CORE COMPONENTS
// =============================================================================

export { Button } from './Button';
export type { ButtonVariant, ButtonSize } from './Button';

export { Input } from './Input';
export type { InputVariant } from './Input';

export { Avatar } from './Avatar';
export type { AvatarSize } from './Avatar';

export { Tag, Badge, NotificationBadge, StatusIndicator } from './Tag';
export type { BadgeVariant, StatusType } from './Tag';

export { Text, Hero, H1, H2, H3, Body, BodySmall, Label, LabelUppercase, Caption, Price, PriceLarge } from './Text';
export type { TextVariant } from './Text';

// =============================================================================
// LOADING COMPONENTS
// =============================================================================

export { Skeleton, SkeletonText, SkeletonAvatar, SkeletonImage } from './Skeleton';

// =============================================================================
// NAVIGATION COMPONENTS
// =============================================================================

export { TabBar } from './TabBar';
export { SearchBar } from './SearchBar';
export { CategoryChip } from './CategoryChip';
// SectionHeader removed — duplicate of components/home/SectionHeader, no consumers.
// PersonalizedHeader removed — 238 lines, zero consumers (dead code cleanup).
export { ScreenHeader } from './ScreenHeader';
export type { ScreenHeaderProps } from './ScreenHeader';

// =============================================================================
// FEEDBACK COMPONENTS
// =============================================================================

export { OfflineBanner } from './OfflineBanner';

// =============================================================================
// OVERLAY COMPONENTS
// =============================================================================

export {
  ThemedBottomSheet,
  ThemedBottomSheetModal,
} from './ThemedBottomSheet';
export type { ThemedBottomSheetRef } from './ThemedBottomSheet';

export { ImmersiveOverlay } from './ImmersiveOverlay';
export { useImmersiveOverlay } from './ImmersiveOverlay';

export { SheetFooter, SHEET_FOOTER_HEIGHT } from './SheetFooter';

// =============================================================================
// EXISTING COMPONENTS (Re-export)
// =============================================================================

export { IconSymbol } from './IconSymbol';
export { default as TabBarBackground } from './TabBarBackground';
