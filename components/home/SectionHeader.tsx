/**
 * SectionHeader Component
 * Reusable header for home feed sections with optional action
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, spacing, typography, fonts } from '@/constants/theme';

// =============================================================================
// TYPES
// =============================================================================

interface SectionHeaderProps {
  title: string;
  titleComponent?: React.ReactNode; // For custom title like "Swap Zone" with styled parts
  subtitle?: string; // kept for backwards compat but no longer rendered
  action?: string;
  onActionPress?: () => void;
  testID?: string;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  titleComponent,
  action,
  onActionPress,
  testID,
}) => {
  const handleActionPress = () => {
    if (onActionPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onActionPress();
    }
  };

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.headerContent}>
        <View style={styles.titleSection}>
          {titleComponent ? (
            titleComponent
          ) : (
            <Text style={styles.title}>{title}</Text>
          )}
        </View>

        {action && onActionPress && (
          <Pressable
            style={({ pressed }) => [
              styles.actionButton,
              pressed && styles.actionButtonPressed,
            ]}
            onPress={handleActionPress}
            hitSlop={spacing.sm}
          >
            <Text style={styles.actionText}>{action}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
};

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg, // 24px — matches maquette
    paddingTop: 28,
    paddingBottom: spacing.md,
  },
  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end', // baseline alignment — title + action on same line
  },
  titleSection: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '300',
    lineHeight: 26,
    letterSpacing: -0.3,
    color: colors.foreground,
  },
  actionButton: {
    paddingVertical: 0,
    paddingLeft: spacing.sm,
    marginBottom: 2, // baseline alignment tweak
  },
  actionButtonPressed: {
    opacity: 0.6,
  },
  actionText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.primary, // rust — #C4603A (orange)
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

export default SectionHeader;
