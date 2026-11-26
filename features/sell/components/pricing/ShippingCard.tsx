import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, components, radius, sizing, spacing, typography } from '@/constants/theme';
import type { automaticShippingEstimate } from '@/functions/src/shared/automaticShippingEstimate';

interface ShippingCardProps {
  isActive: boolean;
  onToggle: () => void;
  estimate: ReturnType<typeof automaticShippingEstimate>;
}

export const ShippingCard = React.memo(function ShippingCard({
  isActive,
  onToggle,
  estimate,
}: ShippingCardProps) {
  return (
    <View
      style={[
        styles.deliveryCard,
        isActive && styles.deliveryCardActive,
      ]}
    >
      <Pressable
        style={({ pressed }) => [
          styles.deliveryCardHeader,
          pressed && styles.pressed,
        ]}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityLabel="Expédition postale"
        accessibilityState={{ checked: isActive }}
      >
        <Ionicons
          name={isActive ? 'checkbox' : 'square-outline'}
          size={sizing.iconMD}
          color={isActive ? colors.charcoal : colors.borderStrong}
          style={styles.checkbox}
        />
        <View style={styles.deliveryCardContent}>
          <Text style={styles.deliveryCardTitle}>Expédition postale</Text>
          <Text style={styles.deliveryCardSubtitle}>
            Livraison à l’adresse de l’acheteur
          </Text>
        </View>
      </Pressable>

      {isActive && (
        <View style={styles.deliveryBody}>
          <Text style={styles.deliveryBodyLabel}>Colis estimé</Text>
          <Text testID="sell-parcel-estimate" style={styles.estimate}>{estimate.label}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  deliveryCard: {
    backgroundColor: colors.surface,
    borderWidth: components.button.borderWidth,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  deliveryCardActive: {
    borderColor: colors.charcoal,
  },
  deliveryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  checkbox: {
    flexShrink: 0,
  },
  deliveryCardContent: {
    flex: 1,
  },
  deliveryCardTitle: {
    ...typography.label,
    color: colors.charcoal,
  },
  deliveryCardSubtitle: {
    ...typography.caption,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  deliveryBody: {
    paddingLeft: spacing.md + sizing.iconMD + spacing.sm + spacing.xs,
    paddingRight: spacing.md,
    paddingBottom: spacing.md,
  },
  deliveryBodyLabel: {
    ...typography.labelUppercase,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  estimate: {...typography.bodySmall, color: colors.foreground},
  pressed: {backgroundColor: colors.surfaceWarm},
});
