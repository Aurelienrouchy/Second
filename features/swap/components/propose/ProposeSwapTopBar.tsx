import React from 'react';
import {StyleSheet, View} from 'react-native';
import {router} from 'expo-router';
import {ScreenHeader, Text} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
interface ProposeSwapTopBarProps {onBack?: () => void; disabled?: boolean; memberName?: string}
export const ProposeSwapTopBar = React.memo(function ProposeSwapTopBar({onBack, disabled = false, memberName}: ProposeSwapTopBarProps) {
 return <View><ScreenHeader title="Ma proposition" onBack={() => {if (!disabled) (onBack ?? (() => router.back()))();}}/>
  {memberName ? <Text style={styles.subtitle}>Avec {memberName}</Text> : null}</View>;
});
const styles = StyleSheet.create({subtitle: {...typography.caption, color: colors.foregroundSecondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.background}});
