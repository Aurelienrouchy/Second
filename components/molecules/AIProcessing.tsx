import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
  Animated,
  FlatList,
} from 'react-native';
import { colors, fonts, radius, spacing } from '@/constants/theme';

export interface AIProcessingProps {
  title: string;
  subtitle: string;
  tags: string[];
  style?: ViewStyle;
}

export const AIProcessing: React.FC<AIProcessingProps> = ({
  title,
  subtitle,
  tags,
  style,
}) => {
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      }),
    ).start();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={[styles.container, style]}>
      <Animated.View
        style={[
          styles.spinner,
          {
            transform: [{ rotate: spin }],
          },
        ]}
      />

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.tagsRow}>
        {tags.map((tag, index) => (
          <View key={index} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
            <View style={styles.tagDot} />
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.charcoal,
    borderRadius: radius.sm,
    paddingVertical: 40,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
  },
  spinner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.sage,
    borderTopColor: colors.rust,
    marginBottom: 24,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 20,
    fontWeight: '300',
    color: colors.cream,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 12,
    color: 'rgba(245,240,232,0.4)',
    marginBottom: 16,
    textAlign: 'center',
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.sage,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    gap: 4,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.cream,
    textTransform: 'uppercase',
    letterSpacing: 0.05,
  },
  tagDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.cream,
  },
});
