import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {APP_LOCALE} from '@/constants/locale';
import {colors, fonts, spacing, typography} from '@/constants/theme';

interface Props {title: string; at?: Date | null; children?: React.ReactNode}
export function ConversationProgressNotice({title, at, children}: Props) {
  return <View style={styles.container}>
    <View style={styles.heading}>
      <Ionicons name="ellipse" size={spacing.xs} color={colors.primary}/><Text style={styles.title}>{title}</Text>
      {at ? <Text style={styles.date}>{at.toLocaleString(APP_LOCALE, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})}</Text> : null}
    </View>
    {children ? <View style={styles.actions}>{children}</View> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: {alignSelf: 'stretch', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.xs},
  heading: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm},
  title: {...typography.bodySmall, color: colors.foregroundSecondary, fontFamily: fonts.sansMedium, textAlign: 'center', flexShrink: 1},
  date: {...typography.caption, color: colors.muted, textAlign: 'center'},
  actions: {alignSelf: 'stretch', gap: spacing.sm, paddingHorizontal: spacing.lg},
});
