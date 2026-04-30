import React, { useMemo } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fonts, spacing, radius } from '@/constants/theme';

export interface ValueDifferenceBoxProps {
  difference: number;
  withSupplement: boolean;
  onToggleSupplement: (withSupplement: boolean) => void;
}

const ValueDifferenceBox: React.FC<ValueDifferenceBoxProps> = ({
  difference,
  withSupplement,
  onToggleSupplement,
}) => {
  return (
    <View style={styles.container}>
      {/* Header Row */}
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>Différence de valeur</Text>
        <Text style={styles.headerValue}>${difference}</Text>
      </View>

      {/* Description */}
      <Text style={styles.description}>
        Tu peux ajouter un complément pour équilibrer l'échange, ou proposer sans ajout.
      </Text>

      {/* Buttons */}
      <View style={styles.buttonsContainer}>
        <Pressable
          style={[
            styles.supplementButton,
            withSupplement && styles.supplementButtonActive,
          ]}
          onPress={() => onToggleSupplement(true)}
        >
          <Text style={styles.supplementButtonText}>
            + ${difference} complément
          </Text>
        </Pressable>

        <Pressable
          style={[
            styles.skipButton,
            !withSupplement && styles.skipButtonActive,
          ]}
          onPress={() => onToggleSupplement(false)}
        >
          <Text style={styles.skipButtonText}>
            Sans ajout
          </Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(196, 96, 58, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(196, 96, 58, 0.2)',
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.charcoal,
  },
  headerValue: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.rust,
  },
  description: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    marginBottom: spacing.md,
  },
  buttonsContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  supplementButton: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.rust,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  supplementButtonActive: {
    opacity: 0.9,
  },
  supplementButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.surface,
  },
  skipButton: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  skipButtonActive: {
    opacity: 1,
  },
  skipButtonText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: '400',
    lineHeight: 14,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    color: colors.muted,
  },
});

export default ValueDifferenceBox;
