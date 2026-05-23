import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts } from '@/constants/theme';

export const AiBadge = React.memo(function AiBadge() {
  return (
    <View style={styles.aiBadge}>
      <Text style={styles.aiBadgeText}>IA</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  aiBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
    marginLeft: 8,
  },
  aiBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.sage,
    letterSpacing: 0.72,
  },
});
