import React from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  ViewStyle,
} from 'react-native';
import {
  colors,
  spacing,
} from '@/constants/theme';
import { Pill } from '@/components/atoms/Pill';

export interface CategoryRowProps {
  categories: string[];
  activeIndex: number;
  onSelect: (index: number) => void;
  style?: ViewStyle;
}

export const CategoryRow: React.FC<CategoryRowProps> = ({
  categories,
  activeIndex,
  onSelect,
  style,
}) => {
  const styles = getStyles();

  return (
    <View style={[styles.container, style]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
      >
        {categories.map((category, index) => (
          <Pill
            key={`${category}-${index}`}
            label={category}
            active={activeIndex === index}
            onPress={() => onSelect(index)}
          />
        ))}
      </ScrollView>
    </View>
  );
};

function getStyles() {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.charcoal,
      paddingBottom: spacing['2xl'],
    },
    scrollContent: {
      paddingHorizontal: spacing.xl,
      gap: spacing.lg,
    },
  });
}
