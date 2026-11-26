import React from 'react';
import {StyleSheet, View} from 'react-native';
import {Button} from '@/components/ui';
import {colors, spacing} from '@/constants/theme';
interface SwapStickyActionsProps {onAccept: () => void; onDecline: () => void; isProcessing: boolean; acceptDisabled?: boolean}
export const SwapStickyActions = React.memo(function SwapStickyActions({onAccept, isProcessing, acceptDisabled = false}: SwapStickyActionsProps) {
 return <View style={styles.bar}><Button accessibilityLabel="Accepter la proposition" disabled={acceptDisabled} loading={isProcessing} onPress={onAccept}>Accepter la proposition</Button></View>;
});
const styles = StyleSheet.create({bar: {padding: spacing.md, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border}});
