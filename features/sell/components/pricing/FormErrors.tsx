import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '@/constants/theme';

interface FormErrorsProps {
  errors: string[];
}

export const FormErrors = React.memo(function FormErrors({
  errors,
}: FormErrorsProps) {
  if (errors.length === 0) return null;

  return (
    <View style={styles.errorsContainer}>
      {errors.map((error, index) => (
        <View key={index} style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  errorsContainer: {
    backgroundColor: colors.dangerLight,
    borderRadius: 4,
    padding: 14,
    gap: 8,
    marginTop: 16,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.danger,
    flex: 1,
  },
});
