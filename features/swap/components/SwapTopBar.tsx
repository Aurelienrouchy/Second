/**
 * SwapTopBar
 * Sticky header with back button, title and optional "Nouveau" badge.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui';
import { colors, fonts, spacing } from '@/constants/theme';

interface SwapTopBarProps {
  showNewBadge: boolean;
}

export const SwapTopBar = React.memo(function SwapTopBar({
  showNewBadge,
}: SwapTopBarProps) {
  return (
    <View style={styles.topBar}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name="chevron-back" size={20} color={colors.charcoal} />
      </Pressable>
      <Text style={styles.topBarTitle}>Swap reçu</Text>
      {showNewBadge && (
        <View style={styles.badgeNew}>
          <Text style={styles.badgeNewText}>Nouveau</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
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
  topBarTitle: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 20,
    fontWeight: '400',
    color: colors.charcoal,
    textAlign: 'center',
  },
  badgeNew: {
    backgroundColor: colors.rust,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeNewText: {
    fontFamily: fonts.sansMedium,
    fontSize: 10,
    fontWeight: '500',
    color: colors.surface,
  },
});
