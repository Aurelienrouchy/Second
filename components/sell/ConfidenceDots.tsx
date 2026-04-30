import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '@/constants/theme';

type ConfidenceLevel = 'high' | 'medium' | 'low';

interface ConfidenceDotsProps {
  level: ConfidenceLevel;
}

const LEVEL_MAP: Record<ConfidenceLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export default function ConfidenceDots({ level }: ConfidenceDotsProps) {
  const filled = LEVEL_MAP[level] ?? 0;

  return (
    <View style={styles.container}>
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={[styles.dot, i < filled && styles.dotFilled]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 6,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(122, 140, 110, 0.3)',
  },
  dotFilled: {
    backgroundColor: colors.sage,
  },
});
