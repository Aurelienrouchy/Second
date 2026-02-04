/**
 * Design System Theme
 * Vibe: Luxe Français + Street Energy + Revolut Polish
 *
 * Signature:
 * - Bleu Klein comme accent distinctif
 * - Cormorant Garamond pour l'élégance éditoriale
 * - Satoshi pour la lisibilité moderne
 */

// =============================================================================
// COLORS
// =============================================================================

export const colors = {
  // Primary
  primary: '#002FA7',        // Bleu Klein - accent principal
  primaryLight: 'rgba(0, 47, 167, 0.1)',
  primaryDark: '#001F6E',

  // Background & Surface
  background: '#FFFFFF',     // Blanc pur
  surface: '#FFFFFF',        // Blanc pur (cards, inputs)
  surfaceElevated: '#FFFFFF',

  // Text
  foreground: '#1A1A1A',     // Noir doux
  foregroundSecondary: '#666666',
  muted: '#999999',

  // Borders & Dividers
  border: '#E5E5E5',
  borderLight: '#F0F0F0',

  // Semantic
  danger: '#C41E3A',
  dangerLight: 'rgba(196, 30, 58, 0.1)',
  success: '#2E7D32',
  successLight: 'rgba(46, 125, 50, 0.1)',
  warning: '#F57C00',
  warningLight: 'rgba(245, 124, 0, 0.1)',

  // Utility
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',

  // Overlay
  overlay: 'rgba(0, 0, 0, 0.4)',
  overlayLight: 'rgba(0, 0, 0, 0.2)',
} as const;

// =============================================================================
// TYPOGRAPHY
// =============================================================================

export const fonts = {
  // Font Families
  serif: 'Cormorant-Garamond',
  serifMedium: 'Cormorant-Garamond-Medium',
  serifSemiBold: 'Cormorant-Garamond-SemiBold',
  serifBold: 'Cormorant-Garamond-Bold',

  sans: 'Satoshi-Regular',
  sansMedium: 'Satoshi-Medium',
  sansBold: 'Satoshi-Bold',

  // Fallbacks (system fonts until custom fonts load)
  serifFallback: 'Georgia',
  sansFallback: 'System',
} as const;

export const typography = {
  // Headlines (Cormorant Garamond)
  h1: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  h2: {
    fontFamily: fonts.serifSemiBold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  h3: {
    fontFamily: fonts.serifMedium,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
  },

  // Body (Satoshi)
  body: {
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0,
  },
  bodySmall: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0,
  },

  // UI Elements (Satoshi)
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.1,
  },
  button: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    lineHeight: 24,
    letterSpacing: 0.2,
  },
  caption: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.1,
  },

  // Special
  price: {
    fontFamily: fonts.sansBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: 0,
  },
  priceSmall: {
    fontFamily: fonts.sansBold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0,
  },
} as const;

// =============================================================================
// SPACING
// =============================================================================

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
} as const;

// =============================================================================
// BORDER RADIUS
// =============================================================================

export const radius = {
  xs: 4,
  sm: 8,      // Buttons, inputs
  md: 16,     // Cards
  lg: 24,     // Modals, bottom sheets
  full: 9999, // Pills, avatars
} as const;

// =============================================================================
// SHADOWS
// =============================================================================

export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
  cardPressed: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  button: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  elevated: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 32,
    elevation: 8,
  },
  top: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
} as const;

// =============================================================================
// SIZING
// =============================================================================

export const sizing = {
  // Fixed heights
  headerHeight: 56,
  tabBarHeight: 64, // + safe area
  buttonHeight: 48,
  buttonHeightSmall: 40,
  inputHeight: 48,

  // Avatar sizes
  avatarXS: 24,
  avatarSM: 32,
  avatarMD: 40,
  avatarLG: 56,
  avatarXL: 80,
  avatarXXL: 120,

  // Icon sizes
  iconSM: 16,
  iconMD: 24,
  iconLG: 32,

  // Touch targets
  minTouchTarget: 44,
} as const;

// =============================================================================
// ANIMATIONS
// =============================================================================

export const animations = {
  // Durations
  duration: {
    instant: 100,
    fast: 150,
    normal: 250,
    slow: 350,
    verySlow: 500,
  },

  // Spring configs for react-native-reanimated
  spring: {
    gentle: {
      damping: 20,
      stiffness: 200,
    },
    bouncy: {
      damping: 12,
      stiffness: 180,
    },
    snappy: {
      damping: 15,
      stiffness: 300,
    },
    smooth: {
      damping: 20,
      stiffness: 250,
    },
  },

  // Scale values
  scale: {
    pressed: 0.97,
    pressedCard: 0.98,
    bounce: 1.2,
  },
} as const;

// =============================================================================
// HAPTICS (expo-haptics types)
// =============================================================================

export const haptics = {
  light: 'light' as const,
  medium: 'medium' as const,
  heavy: 'heavy' as const,
  success: 'success' as const,
  warning: 'warning' as const,
  error: 'error' as const,
} as const;

// =============================================================================
// COMPONENT SPECIFIC TOKENS
// =============================================================================

export const components = {
  // Button
  button: {
    height: sizing.buttonHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1.5,
  },

  // Input
  input: {
    height: sizing.inputHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1.5,
  },

  // Card
  card: {
    borderRadius: radius.md,
    padding: spacing.md,
    imageRatio: 4 / 5, // Portrait mode
  },

  // Bottom Sheet
  bottomSheet: {
    borderRadius: radius.lg,
    handleWidth: 36,
    handleHeight: 4,
    padding: spacing.lg,
  },

  // Tag
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },

  // Badge
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
    minSize: 18,
  },
} as const;

// =============================================================================
// THEME OBJECT (Combined export)
// =============================================================================

export const theme = {
  colors,
  fonts,
  typography,
  spacing,
  radius,
  shadows,
  sizing,
  animations,
  haptics,
  components,
} as const;

export type Theme = typeof theme;
export type Colors = typeof colors;
export type Spacing = typeof spacing;

export default theme;
