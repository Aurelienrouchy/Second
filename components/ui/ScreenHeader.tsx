/**
 * ScreenHeader — Unified header component
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Handles:
 * - Safe area insets (status bar) with matching background color
 * - Back button (consistent 36px circle with 1px border)
 * - Title (displayMedium 20px charcoal)
 * - Optional right content
 * - Optional center content (e.g. step indicators)
 * - Bottom border
 *
 * Usage:
 *   <ScreenHeader title="Details" onBack={() => router.back()} />
 *   <ScreenHeader title="Messages" showBack={false} rightContent={<.../>} />
 *   <ScreenHeader title="Prix" onBack={handleBack} topContent={<StepBar />} />
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, sizing, spacing, typography } from '@/constants/theme';

export interface ScreenHeaderProps {
  /** Page title displayed in the header */
  title: string;
  /** Called when back button is pressed */
  onBack?: () => void;
  /** Show back button (default: true if onBack provided) */
  showBack?: boolean;
  /** Content rendered to the right of the title */
  rightContent?: React.ReactNode;
  /** Content rendered above the title row (e.g. step indicator) */
  topContent?: React.ReactNode;
  /** Background color for the header AND status bar area (default: colors.cream) */
  backgroundColor?: string;
  /** Whether to show the bottom border (default: true) */
  showBorder?: boolean;
  /** Custom title style override */
  titleStyle?: object;
  /** Title text color (default: colors.charcoal) */
  titleColor?: string;
  /** Back button icon & border color (default: colors.charcoal / colors.borderStrong) */
  backButtonColor?: string;
}

function ScreenHeaderComponent({
  title,
  onBack,
  showBack,
  rightContent,
  topContent,
  backgroundColor = colors.cream,
  showBorder = true,
  titleStyle,
  titleColor,
  backButtonColor,
}: ScreenHeaderProps) {
  const insets = useSafeAreaInsets();
  const shouldShowBack = showBack ?? !!onBack;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor, paddingTop: insets.top },
        showBorder && styles.containerBorder,
      ]}
    >
      {topContent && <View style={styles.topContentWrapper}>{topContent}</View>}

      <View style={styles.row}>
        {/* Left: Back button (no spacer when absent — title starts at the back button position) */}
        {shouldShowBack && (
          <Pressable
            onPress={onBack}
            style={[
              styles.backButton,
              backButtonColor ? { borderColor: backButtonColor } : undefined,
            ]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Retour"
            accessibilityRole="button"
          >
            <Ionicons name="chevron-back" size={20} color={backButtonColor ?? colors.charcoal} />
          </Pressable>
        )}

        {/* Center: Title */}
        <Text style={[styles.title, titleColor ? { color: titleColor } : undefined, titleStyle]} numberOfLines={1}>
          {title}
        </Text>

        {/* Right: Custom content or spacer */}
        {rightContent ? (
          <View style={styles.rightContent}>{rightContent}</View>
        ) : (
          <View style={styles.backSpacer} />
        )}
      </View>
    </View>
  );
}

export const ScreenHeader = React.memo(ScreenHeaderComponent);

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.cream,
  },
  containerBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topContentWrapper: {
    paddingHorizontal: spacing.md + spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md + spacing.xs,
    paddingVertical: spacing.md - spacing.xs / 2,
    gap: spacing.sm + spacing.xs,
  },
  backButton: {
    width: sizing.controlCircle,
    height: sizing.controlCircle,
    borderRadius: sizing.controlCircle / 2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backSpacer: {
    width: sizing.controlCircle,
  },
  title: {
    flex: 1,
    ...typography.titleHeader,
    color: colors.charcoal,
  },
  rightContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});

export default ScreenHeader;
