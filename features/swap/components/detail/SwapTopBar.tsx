import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {router} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import {ScreenHeader, Text} from '@/components/ui';
import {formatDisplayName} from '@/utils/formatName';
import {colors, spacing, sizing, typography} from '@/constants/theme';
interface SwapTopBarProps {showNewBadge?: boolean; isProposal?: boolean; memberName?: string; onOptions?: () => void}
export const SwapTopBar = React.memo(function SwapTopBar({memberName, onOptions}: SwapTopBarProps) {
 return <View><ScreenHeader title="Mon échange" onBack={() => router.canGoBack() ? router.back() : router.replace('/my-swaps')}
  rightContent={onOptions ? <Pressable onPress={onOptions} style={styles.options} accessibilityRole="button" accessibilityLabel="Options de l’échange"><Ionicons name="ellipsis-horizontal" size={sizing.iconMD} color={colors.foreground}/></Pressable> : undefined}/>
  {memberName ? <Text style={styles.subtitle}>Avec {formatDisplayName(memberName)}</Text> : null}</View>;
});
const styles = StyleSheet.create({options: {width: sizing.minTouchTarget, minHeight: sizing.minTouchTarget, alignItems: 'center', justifyContent: 'center'}, subtitle: {...typography.caption, color: colors.foregroundSecondary, backgroundColor: colors.background, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm}});
