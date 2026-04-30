import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ViewStyle,
} from 'react-native';
import { colors, radius, spacing } from '@/constants/theme';

export interface TextareaFieldProps {
  label: string;
  content: string;
  showAIBadge?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

export const TextareaField: React.FC<TextareaFieldProps> = ({
  label,
  content,
  showAIBadge = false,
  onPress,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {showAIBadge && (
          <View style={styles.aiBadge}>
            <Text style={styles.aiBadgeText}>AI</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.contentArea}
        scrollEnabled={false}
        onTouchStart={onPress}
      >
        <Text style={styles.content}>{content}</Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.cream,
    minHeight: 150,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    paddingBottom: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  aiBadge: {
    backgroundColor: colors.sage,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 3,
  },
  aiBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.cream,
    textTransform: 'uppercase',
  },
  contentArea: {
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    paddingBottom: 14,
  },
  content: {
    fontSize: 13,
    color: colors.charcoal,
    lineHeight: 20,
    fontWeight: '300',
  },
});
