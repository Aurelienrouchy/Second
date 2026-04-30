/**
 * Design System Theme — Seconde UI Kit
 * Vibe: Editorial Luxe — Curated Secondhand Marketplace
 *
 * Signature:
 * - Cream backgrounds with deep charcoal text
 * - Rust (terracotta) as distinctive accent, Sage as secondary
 * - Cormorant Garamond for elegant display headlines
 * - DM Sans for refined body text
 * - Flat design, sharp card corners, generous whitespace
 */

// =============================================================================
// COLORS — Seconde Palette
// =============================================================================

export const colors = {
  // Primary — Rust (terracotta warmth)
  primary: '#C4603A',        // Rust - warm, distinctive accent
  primaryLight: 'rgba(196, 96, 58, 0.10)',
  primaryDark: '#A34D2E',

  // Secondary — Sage (natural green)
  secondary: '#7A8C6E',       // Sage green
  secondaryLight: 'rgba(122, 140, 110, 0.12)',

  // Background & Surface — Warm neutrals
  background: '#FAF8F4',      // Warm white
  surface: '#FFFFFF',          // Pure white for cards
  surfaceElevated: '#FFFFFF',
  surfaceWarm: '#F5F0E8',     // Cream (Seconde signature)

  // Dark surfaces (hero sections, dark mode elements)
  dark: '#1A1814',             // Charcoal
  deep: '#0F0E0C',            // Deepest dark

  // Text — Rich charcoal hierarchy
  foreground: '#1A1814',       // Deep charcoal
  foregroundSecondary: '#4A4A4A',
  muted: '#8C8880',            // Warm muted

  // Borders & Dividers
  border: 'rgba(26, 24, 20, 0.10)',       // Subtle
  borderStrong: 'rgba(26, 24, 20, 0.20)', // Stronger
  borderLight: '#F2EFE9',

  // Semantic
  danger: '#D64545',
  dangerLight: 'rgba(214, 69, 69, 0.1)',
  success: '#3D9970',
  successLight: 'rgba(61, 153, 112, 0.1)',
  warning: '#E09F3E',
  warningLight: 'rgba(224, 159, 62, 0.1)',

  // Accent colors
  sage: '#7A8C6E',             // Sage green (= secondary)
  sageLight: 'rgba(122, 140, 110, 0.12)',
  sand: '#D4C4A0',             // Warm sand
  clay: '#B8847C',             // Muted clay
  rust: '#C4603A',             // Alias for primary

  // Utility
  white: '#FFFFFF',
  black: '#000000',
  cream: '#F5F0E8',            // Alias for surfaceWarm
  charcoal: '#1A1814',         // Alias for dark
  transparent: 'transparent',

  // Overlay
  overlay: 'rgba(26, 24, 20, 0.5)',
  overlayLight: 'rgba(26, 24, 20, 0.25)',

  // Legacy aliases for backwards compatibility
  backgroundSecondary: '#F5F0E8',  // alias for surfaceWarm / cream
} as const;

// =============================================================================
// TYPOGRAPHY — Cormorant Garamond + DM Sans
// =============================================================================

export const fonts = {
  // Display/Headlines — Cormorant Garamond (elegant serif)
  display: 'Cormorant-Garamond',
  displayMedium: 'Cormorant-Garamond-Medium',
  displaySemiBold: 'Cormorant-Garamond-SemiBold',
  displayBold: 'Cormorant-Garamond-Bold',

  // Body — Satoshi (clean geometric sans, standing in for DM Sans)
  // To switch to DM Sans: add font files to assets/fonts/ and update names
  sans: 'Satoshi-Regular',
  sansMedium: 'Satoshi-Medium',
  sansBold: 'Satoshi-Bold',

  // Serif aliases (point to Cormorant Garamond for backwards compat)
  serif: 'Cormorant-Garamond',
  serifItalic: 'Cormorant-Garamond',  // No italic variant loaded
  serifBold: 'Cormorant-Garamond-Bold',
  serifMedium: 'Cormorant-Garamond-Medium',
  serifSemiBold: 'Cormorant-Garamond-SemiBold',

  // Sans aliases
  sansRegular: 'Satoshi-Regular',

  // Fallbacks
  serifFallback: 'Georgia',
  sansFallback: 'System',
} as const;

export const typography = {
  // Display Headlines (Cormorant Garamond — elegant, editorial)
  hero: {
    fontFamily: fonts.displayBold,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1,
  },
  h1: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  h2: {
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  h3: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
  },

  // Body (DM Sans — refined readability)
  body: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  bodySmall: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0.1,
  },

  // UI Elements (DM Sans)
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.3,
  },
  labelUppercase: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.8,
  },
  button: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1.5,
  },
  caption: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    letterSpacing: 0.2,
  },

  // Special — Prices (Cormorant for editorial elegance)
  price: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.3,
  },
  priceSmall: {
    fontFamily: fonts.displayMedium,
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: -0.2,
  },
  priceLarge: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
} as const;

// =============================================================================
// SPACING — Generous, editorial rhythm
// =============================================================================

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
  '3xl': 64,
  '4xl': 80,
} as const;

// =============================================================================
// BORDER RADIUS — Flat, editorial (sharp cards)
// =============================================================================

export const radius = {
  none: 0,
  xs: 2,          // Tiny accent rounding
  sm: 4,          // Tags, badges, small elements
  md: 8,          // Buttons, inputs
  lg: 12,         // Bottom sheets, modals
  xl: 16,         // Large modals
  '2xl': 24,      // Feature cards (rare)
  full: 9999,     // Pills, avatars
} as const;

// =============================================================================
// SHADOWS — Minimal, flat design
// =============================================================================

export const shadows = {
  // Subtle lift for cards
  card: {
    shadowColor: '#1A1814',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  // Slightly reduced on press
  cardPressed: {
    shadowColor: '#1A1814',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
    elevation: 0,
  },
  // Flat buttons (no glow)
  button: {
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  // Modals/sheets — subtle
  elevated: {
    shadowColor: '#1A1814',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
  },
  // Medium elevation
  medium: {
    shadowColor: '#1A1814',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 3,
  },
  // Top shadow for sticky headers
  top: {
    shadowColor: '#1A1814',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  // Inset-style for inputs
  inset: {
    shadowColor: '#1A1814',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 2,
    elevation: 0,
  },
} as const;

// =============================================================================
// SIZING
// =============================================================================

export const sizing = {
  // Fixed heights
  headerHeight: 54,
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

  // Transition — cubic bezier equivalent
  transition: {
    duration: 250,
    easing: 'ease-in-out',
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
// COMPONENT SPECIFIC TOKENS — Seconde editorial style
// =============================================================================

export const components = {
  // Button — uppercase labels, flat
  button: {
    height: sizing.buttonHeight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,     // 8px
    borderWidth: 1,
  },

  // Input — clean, minimal
  input: {
    height: sizing.inputHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,     // 4px
    borderWidth: 1,
  },

  // Card — flat, no rounded corners
  card: {
    borderRadius: radius.none,   // Sharp corners (Seconde style)
    padding: spacing.md,
    imageRatio: 4 / 5,           // Portrait mode
  },

  // Bottom Sheet
  bottomSheet: {
    borderRadius: radius.lg,     // 12px top corners
    handleWidth: 36,
    handleHeight: 4,
    padding: spacing.lg,
  },

  // Tag
  tag: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.xs,     // 2px (sharp)
  },

  // Badge
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,     // 2px
    minSize: 18,
  },

  // Category pill
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,   // Fully rounded
  },
} as const;

// =============================================================================
// IMAGE GRADIENTS — Placeholder colors for product images
// =============================================================================

export const imageGradients = {
  camel: ['#C4A070', '#8B6940'],
  sage: ['#7A8C6E', '#4A5C40'],
  rust: ['#C4603A', '#8B3A1A'],
  cream: ['#E8D8B0', '#C0A878'],
  dark: ['#3A3530', '#1A1510'],
  blush: ['#D4A090', '#B07060'],
  navy: ['#2A3550', '#0A1530'],
  olive: ['#6A7050', '#3A4030'],
  stone: ['#A09888', '#706858'],
  ecru: ['#D8CDB8', '#B0A088'],
  taupe: ['#B8A898', '#887868'],
  terracotta: ['#C47060', '#944040'],
} as const;

export type ImageGradient = keyof typeof imageGradients;

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
  imageGradients,
} as const;

export type Theme = typeof theme;
export type Colors = typeof colors;
export type Spacing = typeof spacing;

export default theme;
