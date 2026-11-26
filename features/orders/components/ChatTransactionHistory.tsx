import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import type { Transaction } from '@/types/transaction';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';
import { getTransactionFinancialLabel } from '@/utils/transactionFinancialLabel';
import { formatPrice } from '@/utils/formatPrice';
import { getStatusLabel } from '../lib/transactionStatusMeta';

const key = (tx: Transaction) => tx.id;
export function ChatTransactionHistory({transactions, selectedId, userId, onSelect, hasMore, onLoadMore, isLoading}: {
  transactions: Transaction[]; selectedId?: string; userId: string;
  onSelect: (id: string) => void; hasMore: boolean; onLoadMore: () => void; isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const renderItem = useCallback(({item}: {item: Transaction}) => {
    const perspective = userId === item.buyerId ? 'buyer' : 'seller';
    return <Pressable accessibilityRole="button" accessibilityState={{selected: item.id === selectedId}}
      style={[styles.button, styles.order]} onPress={() => {onSelect(item.id); setOpen(false);}}>
      <View style={styles.orderDetails}>
        <Text style={styles.body} numberOfLines={1}>{item.articleSnapshot?.title || 'Article'}</Text>
        <Text style={styles.caption}>{item.createdAtKnown === false ? 'Date indisponible' : item.createdAt.toLocaleString(APP_LOCALE,
          {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})} · {getTransactionFinancialLabel(item, perspective) ?? getStatusLabel(item.status, perspective)}</Text>
      </View>
      {Number.isFinite(item.amount) ? <Text style={styles.price}>{formatPrice(item.amount)}</Text> : null}
      {item.id === selectedId ? <Ionicons name="checkmark" size={spacing.md} color={colors.primary}/> : null}
    </Pressable>;
  }, [userId, selectedId, onSelect]);
  if (transactions.length < 2 && !hasMore) return null;
  return <View style={styles.container}>
    <Pressable accessibilityRole="button" accessibilityState={{expanded: open}} style={[styles.button, styles.toggle]} onPress={() => setOpen(!open)}>
      <Text style={styles.link}>Autres achats</Text>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={spacing.md} color={colors.muted}/>
    </Pressable>
    {open && <View style={styles.list}>
      <FlashList data={transactions} keyExtractor={key} renderItem={renderItem} />
    </View>}
    {open && hasMore && <Pressable accessibilityRole="button" accessibilityState={{disabled: isLoading, busy: isLoading}} disabled={isLoading} style={styles.button} onPress={onLoadMore}>
      <Text style={styles.link}>Voir les suivants</Text>
    </Pressable>}
  </View>;
}
const styles = StyleSheet.create({
  container: {paddingHorizontal: spacing.md},
  body: {...typography.bodySmall, fontFamily: fonts.sansMedium, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted},
  price: {...typography.bodySmall, fontFamily: fonts.sansMedium, color: colors.foreground},
  order: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
  orderDetails: {flex: 1, gap: spacing.xs},
  toggle: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm},
  button: {paddingVertical: spacing.sm, gap: spacing.xs},
  link: {...typography.caption, fontFamily: fonts.sansMedium, color: colors.foregroundSecondary},
  list: {height: spacing['4xl'] * 3, paddingHorizontal: spacing.sm, backgroundColor: colors.surfaceWarm, borderRadius: radius.md},
});
