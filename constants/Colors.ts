/**
 * Colors - Legacy Support + New Design System
 *
 * This file maintains backwards compatibility while integrating
 * the new Luxe Français + Street design system.
 *
 * For new code, prefer importing from '@/constants/theme':
 * import { colors } from '@/constants/theme';
 */

import { colors as themeColors } from './theme';

// Legacy format for backwards compatibility
const tintColorLight = themeColors.primary; // Bleu Klein

export const Colors = {
  light: {
    text: themeColors.foreground,
    background: themeColors.background,
    tint: tintColorLight,
    icon: themeColors.muted,
    tabIconDefault: themeColors.muted,
    tabIconSelected: tintColorLight,

    // New design system colors (accessible via Colors.light.xxx)
    primary: themeColors.primary,
    primaryLight: themeColors.primaryLight,
    surface: themeColors.surface,
    border: themeColors.border,
    danger: themeColors.danger,
    success: themeColors.success,
    warning: themeColors.warning,
    muted: themeColors.muted,
  },
  // Dark mode disabled as per design system requirements
  dark: {
    text: themeColors.foreground,
    background: themeColors.background,
    tint: tintColorLight,
    icon: themeColors.muted,
    tabIconDefault: themeColors.muted,
    tabIconSelected: tintColorLight,
    primary: themeColors.primary,
    primaryLight: themeColors.primaryLight,
    surface: themeColors.surface,
    border: themeColors.border,
    danger: themeColors.danger,
    success: themeColors.success,
    warning: themeColors.warning,
    muted: themeColors.muted,
  },
};

// Re-export theme colors for convenience
export { themeColors as colors };
