import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radius } from '@/constants/theme';

interface FormFieldGroupProps {
  children: React.ReactNode;
}

/**
 * Card-like container for grouped form fields.
 * Border 1px borderStrong, radius 4px, white background, overflow hidden.
 * Child fields separated by bottom border (handled by children).
 */
export default function FormFieldGroup({ children }: FormFieldGroupProps) {
  const childArray = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={styles.container}>
      {childArray.map((child, index) => (
        <View
          key={index}
          style={[
            styles.fieldWrapper,
            index < childArray.length - 1 && styles.fieldBorder,
          ]}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    overflow: 'hidden',
  },
  fieldWrapper: {},
  fieldBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
});
