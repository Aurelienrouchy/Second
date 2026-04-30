import React from 'react';
import {
  StyleSheet,
  View,
  Pressable,
  Text,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import {
  colors,
  spacing,
} from '@/constants/theme';

export interface DetailActionsProps {
  price: number;
  onOffer: (event: GestureResponderEvent) => void;
  onBuy: (event: GestureResponderEvent) => void;
  style?: ViewStyle;
}

export const DetailActions: React.FC<DetailActionsProps> = ({
  price,
  onOffer,
  onBuy,
  style,
}) => {
  const styles = getStyles();

  const formatPrice = (p: number): string => {
    return p.toLocaleString('fr-FR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  return (
    <View style={[styles.container, style]}>
      <Pressable
        onPress={onOffer}
        style={({ pressed }) => [
          styles.offerButton,
          {
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text style={styles.offerButtonText}>Offre</Text>
      </Pressable>

      <Pressable
        onPress={onBuy}
        style={({ pressed }) => [
          styles.buyButton,
          {
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text style={styles.buyButtonIcon}>🛍</Text>
        <Text style={styles.buyButtonText}>
          Acheter · ${formatPrice(price)}
        </Text>
      </Pressable>
    </View>
  );
};

function getStyles() {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      gap: spacing['2xl'],
      paddingHorizontal: spacing.xl,
      paddingTop: spacing['2xl'],
      paddingBottom: spacing.xl,
      backgroundColor: colors.cream,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    offerButton: {
      flex: 1,
      paddingVertical: 15,
      paddingHorizontal: spacing.lg,
      borderRadius: 12,
      backgroundColor: colors.white,
      borderWidth: 1.5,
      borderColor: colors.charcoal,
      justifyContent: 'center',
      alignItems: 'center',
    },
    offerButtonText: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: colors.charcoal,
    },
    buyButton: {
      flex: 2,
      paddingVertical: 15,
      paddingHorizontal: spacing.lg,
      borderRadius: 12,
      backgroundColor: colors.charcoal,
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
    },
    buyButtonIcon: {
      fontSize: 16,
    },
    buyButtonText: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 2,
      textTransform: 'uppercase',
      color: colors.cream,
    },
  });
}
