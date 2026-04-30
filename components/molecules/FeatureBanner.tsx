import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ViewStyle,
  Animated,
} from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

export interface FeatureBannerProps {
  tag: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
  style?: ViewStyle;
}

export const FeatureBanner: React.FC<FeatureBannerProps> = ({
  tag,
  title,
  subtitle,
  onPress,
  style,
}) => {
  return (
    <Pressable
      style={[styles.container, style]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.decorativeCircle} />

      <View style={styles.content}>
        <View style={styles.tagPill}>
          <Text style={styles.tagText}>{tag}</Text>
          <View style={styles.tagDot} />
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <Pressable style={styles.arrowButton} onPress={onPress}>
        <Text style={styles.arrowIcon}>→</Text>
      </Pressable>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.charcoal,
    borderRadius: radius.none,
    padding: spacing.lg,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 200,
    justifyContent: 'space-between',
  },
  decorativeCircle: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(204,102,76,0.15)',
  },
  content: {
    zIndex: 1,
    flex: 1,
  },
  tagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.rust,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.full,
    marginBottom: spacing.sm,
    gap: 6,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.cream,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  tagDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cream,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 22,
    fontWeight: '300',
    color: colors.cream,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.45)',
    lineHeight: 18,
  },
  arrowButton: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(245,240,232,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowIcon: {
    fontSize: 20,
    color: colors.cream,
    fontWeight: '300',
  },
});
