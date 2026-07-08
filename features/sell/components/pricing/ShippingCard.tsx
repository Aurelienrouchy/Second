import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fonts } from '@/constants/theme';

type PackageSize = 'small' | 'medium' | 'large';

interface PackageSizeOption {
  value: PackageSize;
  label: string;
  weight: string;
  description: string;
}

const PACKAGE_SIZES: PackageSizeOption[] = [
  { value: 'small', label: 'Petit', weight: '<500g', description: 'T-shirt, accessoires' },
  { value: 'medium', label: 'Moyen', weight: '<1kg', description: 'Pull, jean, robe' },
  { value: 'large', label: 'Grand', weight: '<2kg', description: 'Manteau, bottes, lot' },
];

interface ShippingCardProps {
  isActive: boolean;
  onToggle: () => void;
  packageSize: PackageSize | null;
  onPackageSizeSelect: (size: PackageSize) => void;
  aiSuggestedSize?: PackageSize | null;
}

export const ShippingCard = React.memo(function ShippingCard({
  isActive,
  onToggle,
  packageSize,
  onPackageSizeSelect,
  aiSuggestedSize,
}: ShippingCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.deliveryCard,
        isActive && styles.deliveryCardActive,
        pressed && { opacity: 0.7 },
      ]}
      onPress={onToggle}
    >
      <View style={styles.deliveryCardHeader}>
        <View
          style={[
            styles.radioOuter,
            isActive && styles.radioOuterActive,
          ]}
        >
          {isActive && <View style={styles.radioInner} />}
        </View>
        <View style={styles.deliveryCardContent}>
          <Text style={styles.deliveryCardTitle}>Expédition postale</Text>
          <Text style={styles.deliveryCardSubtitle}>
            Envoi par Postes Canada
          </Text>
        </View>
      </View>

      {isActive && (
        <View style={styles.deliveryBody}>
          <Text style={styles.deliveryBodyLabel}>Format du colis</Text>
          <View style={styles.packageSizeCards}>
            {PACKAGE_SIZES.map((size) => {
              const isSelected = packageSize === size.value;
              return (
                <Pressable
                  key={size.value}
                  style={({ pressed }) => [
                    styles.packageCard,
                    isSelected && styles.packageCardSelected,
                    pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => onPackageSizeSelect(size.value)}
                >
                  <Text
                    style={[
                      styles.packageName,
                      isSelected && styles.packageNameSelected,
                    ]}
                  >
                    {size.label}
                  </Text>
                  <Text style={styles.packageWeight}>{size.weight}</Text>
                </Pressable>
              );
            })}
          </View>
          {aiSuggestedSize && (
            <View style={styles.aiSuggestRow}>
              <View style={styles.aiBadge}>
                <Text style={styles.aiBadgeText}>IA</Text>
              </View>
              <Text style={styles.aiSuggestText}>
                Format suggéré selon l&apos;article
              </Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  deliveryCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    marginBottom: 10,
    overflow: 'hidden',
  },
  deliveryCardActive: {
    borderColor: colors.charcoal,
  },
  deliveryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  radioOuterActive: {
    borderColor: colors.charcoal,
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.charcoal,
  },
  deliveryCardContent: {
    flex: 1,
  },
  deliveryCardTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },
  deliveryCardSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  deliveryBody: {
    paddingLeft: 48,
    paddingRight: 16,
    paddingBottom: 14,
  },
  deliveryBodyLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },
  packageSizeCards: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 0,
  },
  packageCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.white,
  },
  packageCardSelected: {
    borderColor: colors.charcoal,
    backgroundColor: 'rgba(26,24,20,0.03)',
  },
  packageName: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.charcoal,
    marginBottom: 2,
  },
  packageNameSelected: {
    color: colors.charcoal,
  },
  packageWeight: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: colors.muted,
    letterSpacing: 0.36,
  },
  aiSuggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  aiBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
  },
  aiBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.sage,
    letterSpacing: 0.72,
  },
  aiSuggestText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
  },
});
