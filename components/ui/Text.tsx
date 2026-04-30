/**
 * Themed Text Component — Seconde UI Kit
 * Design: Editorial Luxe
 *
 * Variants match typography tokens:
 * - hero (Cormorant Garamond Bold — splash/feature headlines)
 * - h1, h2, h3 (Cormorant Garamond — section headlines)
 * - body, bodySmall (Satoshi — readable body text)
 * - label, labelUppercase (Satoshi Medium — UI labels)
 * - caption (Satoshi — small auxiliary text)
 * - price, priceSmall, priceLarge (Cormorant — editorial prices)
 * - button (Satoshi Medium — uppercase CTA labels)
 */

import React from 'react';
import {
  Text as RNText,
  TextProps as RNTextProps,
  StyleSheet,
} from 'react-native';

import { colors, typography } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

export type TextVariant =
  | 'hero'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodySmall'
  | 'label'
  | 'labelUppercase'
  | 'button'
  | 'caption'
  | 'price'
  | 'priceSmall'
  | 'priceLarge';

interface TextProps extends RNTextProps {
  variant?: TextVariant;
  color?: keyof typeof colors | string;
  center?: boolean;
  children: React.ReactNode;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const Text: React.FC<TextProps> = ({
  variant = 'body',
  color,
  center = false,
  style,
  children,
  ...props
}) => {
  // Get color value
  const textColor = color
    ? (colors as any)[color] || color
    : variant === 'price' || variant === 'priceSmall' || variant === 'priceLarge'
    ? colors.primary
    : variant === 'labelUppercase'
    ? colors.muted
    : colors.foreground;

  // Get typography style
  const typographyStyle = typography[variant];

  return (
    <RNText
      style={[
        typographyStyle,
        { color: textColor },
        center && styles.center,
        variant === 'labelUppercase' && styles.uppercase,
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
};

// =============================================================================
// CONVENIENCE COMPONENTS
// =============================================================================

// Hero
export const Hero: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="hero" {...props} />
);

// Headlines
export const H1: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="h1" {...props} />
);

export const H2: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="h2" {...props} />
);

export const H3: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="h3" {...props} />
);

// Body
export const Body: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="body" {...props} />
);

export const BodySmall: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="bodySmall" {...props} />
);

// UI
export const Label: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="label" {...props} />
);

export const LabelUppercase: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="labelUppercase" {...props} />
);

export const Caption: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="caption" color="muted" {...props} />
);

// Special — Prices
export const Price: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="price" {...props} />
);

export const PriceLarge: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="priceLarge" {...props} />
);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  center: {
    textAlign: 'center',
  },
  uppercase: {
    textTransform: 'uppercase',
  },
});

export default Text;
