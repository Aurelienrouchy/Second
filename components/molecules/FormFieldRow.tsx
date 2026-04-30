import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

export interface FormFieldRowProps {
  label: string;
  value: string;
  placeholder?: string;
  showAIBadge?: boolean;
  showEditIcon?: boolean;
  onEditPress?: () => void;
  style?: ViewStyle;
}

export const FormFieldRow: React.FC<FormFieldRowProps> = ({
  label,
  value,
  placeholder,
  showAIBadge = false,
  showEditIcon = false,
  onEditPress,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.valueSection}>
        <Text style={[styles.value, !value && styles.placeholder]}>
          {value || placeholder}
        </Text>

        <View style={styles.actions}>
          {showAIBadge && (
            <View style={styles.aiBadge}>
              <Text style={styles.aiBadgeText}>AI</Text>
            </View>
          )}

          {showEditIcon && (
            <Pressable onPress={onEditPress}>
              <Text style={styles.editIcon}>✏️</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: 0,
  },
  label: {
    width: 80,
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(245,240,232,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  valueSection: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  value: {
    fontSize: 14,
    color: colors.charcoal,
    fontWeight: '300',
    flex: 1,
  },
  placeholder: {
    color: 'rgba(245,240,232,0.3)',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  editIcon: {
    fontSize: 16,
  },
});
