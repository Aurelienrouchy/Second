import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import { colors, fonts, spacing } from '@/constants/theme';

export interface SectionHeaderProps {
  title: string;
  linkText?: string;
  onLinkPress?: () => void;
  style?: ViewStyle;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  linkText = 'Voir tout →',
  onLinkPress,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.title}>{title}</Text>
      <Pressable onPress={onLinkPress}>
        <Text style={styles.link}>{linkText}</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: 28,
    paddingBottom: 16,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 22,
    fontWeight: '300',
    color: colors.charcoal,
  },
  link: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.rust,
    textTransform: 'uppercase',
    letterSpacing: 0.1,
  },
});
