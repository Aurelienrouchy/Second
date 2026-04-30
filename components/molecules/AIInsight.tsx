import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

export interface AIInsightProps {
  text: string | React.ReactNode;
  style?: ViewStyle;
}

export const AIInsight: React.FC<AIInsightProps> = ({ text, style }) => {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconBox}>
        <Text style={styles.iconText}>✦</Text>
      </View>

      <View style={styles.textArea}>
        <Text style={styles.text}>
          {typeof text === 'string' ? (
            <Text>
              {text.split(/(\*\*.*?\*\*)/g).map((part, index) =>
                part.startsWith('**') ? (
                  <Text key={index} style={styles.bold}>
                    {part.replace(/\*\*/g, '')}
                  </Text>
                ) : (
                  part
                ),
              )}
            </Text>
          ) : (
            text
          )}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.charcoal,
    borderRadius: radius.sm,
    padding: spacing.md,
    flexDirection: 'row',
    gap: 12,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  iconText: {
    fontSize: 16,
    color: colors.cream,
    fontWeight: '700',
  },
  textArea: {
    flex: 1,
    justifyContent: 'center',
  },
  text: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.7)',
    lineHeight: 18,
    fontWeight: '400',
  },
  bold: {
    color: colors.cream,
    fontWeight: '600',
  },
});
