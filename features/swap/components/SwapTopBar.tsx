import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui';
import { colors, fonts, spacing, sizing, radius } from '@/constants/theme';

interface SwapTopBarProps { showNewBadge?: boolean; }
export const SwapTopBar = React.memo(function SwapTopBar(_props: SwapTopBarProps) {
  const insets = useSafeAreaInsets();
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/my-swaps');
  return (
    <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable onPress={goBack} style={styles.back} accessibilityLabel="Retour aux échanges" accessibilityRole="button">
        <Ionicons name="arrow-back" size={22} color={colors.foreground} />
      </Pressable>
      <View style={styles.titleColumn}>
        <Text style={styles.eyebrow}>Espace échanges</Text>
        <Text style={styles.title}>Détail de l’échange</Text>
      </View>
    </View>
  );
});
const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border },
  back: { width: sizing.minTouchTarget, minHeight: sizing.minTouchTarget, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceWarm },
  titleColumn: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 17, color: colors.foregroundSecondary },
  title: { fontFamily: fonts.displayMedium, fontSize: 26, lineHeight: 31, color: colors.foreground },
});
