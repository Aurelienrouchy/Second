/**
 * UI Components Index
 * Design System: Luxe Français + Street
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

export { Text, H1, H2, H3, Body, BodySmall, Label, Caption, Price } from './Text';
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
export { SectionHeader } from './SectionHeader';
export { PersonalizedHeader } from './PersonalizedHeader';

// =============================================================================
// OVERLAY COMPONENTS
// =============================================================================

export {
  ThemedBottomSheet,
  ThemedBottomSheetModal,
  BottomSheetModalProvider,
} from './ThemedBottomSheet';
export type { ThemedBottomSheetRef } from './ThemedBottomSheet';

// =============================================================================
// EXISTING COMPONENTS (Re-export)
// =============================================================================

export { IconSymbol } from './IconSymbol';
export { TabBarBackground } from './TabBarBackground';
