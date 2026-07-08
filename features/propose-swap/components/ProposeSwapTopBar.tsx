/**
 * ProposeSwapTopBar — Sticky header with back button and title.
 */

import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';

interface ProposeSwapTopBarProps {
  onBack?: () => void;
}

export const ProposeSwapTopBar = React.memo(function ProposeSwapTopBar({
  onBack,
}: ProposeSwapTopBarProps) {
  return (
    <View style={styles.topBar}>
      <Pressable
        style={styles.backButton}
        onPress={onBack ?? (() => router.back())}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={20} color={colors.charcoal} />
      </Pressable>
      <Text style={styles.title}>Proposer un swap</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: 'rgba(245, 240, 232, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 24,
    color: colors.charcoal,
    flex: 1,
  },
});
