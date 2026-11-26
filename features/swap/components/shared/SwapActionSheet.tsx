import type {ReactNode} from 'react';
import {Modal, ScrollView, StyleSheet, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Button, Text} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
export function SwapActionSheet({visible, title, onClose, children, footer}: {visible: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode}) {
  return <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}><Text style={styles.title}>{title}</Text><Button size="small" variant="ghost" onPress={onClose}>Fermer</Button></View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, header: {padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border}, title: {...typography.h3, color: colors.foreground, flex: 1}, content: {padding: spacing.md, gap: spacing.md}, footer: {padding: spacing.md, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.sm}});
