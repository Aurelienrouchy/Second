/**
 * Themed Text Component
 * Design System: Luxe Français + Street
 *
 * Variants match typography tokens:
 * - h1, h2, h3 (Cormorant Garamond)
 * - body, bodySmall, label, caption (Satoshi)
 * - price (Satoshi Bold + Bleu Klein)
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
  | 'h1'
  | 'h2'
  | 'h3'
  | 'body'
  | 'bodySmall'
  | 'label'
  | 'button'
  | 'caption'
  | 'price'
  | 'priceSmall';

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
    : variant === 'price' || variant === 'priceSmall'
    ? colors.primary
    : colors.foreground;

  // Get typography style
  const typographyStyle = typography[variant];

  return (
    <RNText
      style={[
        typographyStyle,
        { color: textColor },
        center && styles.center,
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

export const Caption: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="caption" color="muted" {...props} />
);

// Special
export const Price: React.FC<Omit<TextProps, 'variant'>> = (props) => (
  <Text variant="price" {...props} />
);

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  center: {
    textAlign: 'center',
  },
});

export default Text;
