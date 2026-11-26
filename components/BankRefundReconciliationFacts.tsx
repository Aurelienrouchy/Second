import {useCallback} from 'react';
import {StyleSheet, Text, View, type ViewToken} from 'react-native';
import {FlashList} from '@shopify/flash-list';
import {colors, spacing, typography} from '@/constants/theme';
import type {BankRefundReconciliationPreview} from '@/types/bankRefundReconciliation';

export interface BankRefundReconciliationFact {id: string; label: string; value: string}
/** Every scalar of the selected native corpus is displayed, including nulls and coverage.
 * Short rows allow actual viewport consultation; receiving a hash is not a read mark. */
export function bankRefundReconciliationFacts(source: BankRefundReconciliationPreview): BankRefundReconciliationFact[] {
  const facts: BankRefundReconciliationFact[] = [];
  const add = (path: string, value: unknown) => {
    const text = value === null ? 'Inconnu / non qualifié (null)' : typeof value === 'boolean' ? value ? 'Oui (true)' : 'Non (false)' : String(value);
    const detail = path.endsWith('Seconds') && typeof value === 'number' ? `${text} · ${new Date(value * 1000).toISOString()}` : text;
    for (let offset = 0; offset < detail.length; offset += 180) facts.push({id: `${path}:${offset}`, label: path, value: detail.slice(offset, offset + 180)});
    if (!detail.length) facts.push({id: `${path}:empty`, label: path, value: 'Texte vide'});
  };
  const walk = (path: string, value: unknown): void => {
    if (Array.isArray(value)) {if (!value.length) add(path, 'Aucune ligne dans cette portion ; voir les limites de couverture.'); else value.forEach((item, index) => walk(`${path}[${index}]`, item));}
    else if (value !== null && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(`${path}.${key}`, item));
    else add(path, value);
  };
  walk('Lecture actuelle', {readAt: source.readAt, source: source.source, localEvidence: source.localEvidence});
  if (source.selectedEntry) walk('Document sélectionné', source.selectedEntry);
  return facts;
}
const keyExtractor = (fact: BankRefundReconciliationFact) => fact.id;
const renderItem = ({item}: {item: BankRefundReconciliationFact}) => <View style={styles.row}><Text selectable style={styles.caption}>{item.label}</Text><Text selectable style={styles.body}>{item.value}</Text></View>;
const viewabilityConfig = {itemVisiblePercentThreshold: 95, minimumViewTime: 300};
export function BankRefundReconciliationFacts({facts, onSeen}: {facts: BankRefundReconciliationFact[]; onSeen: (ids: string[]) => void}) {
  const onViewableItemsChanged = useCallback(({viewableItems}: {viewableItems: ViewToken<BankRefundReconciliationFact>[]}) => {onSeen(viewableItems.filter(v => v.isViewable).map(v => v.item.id));}, [onSeen]);
  return <View style={styles.viewport}><FlashList data={facts} keyExtractor={keyExtractor} renderItem={renderItem} onViewableItemsChanged={onViewableItemsChanged} viewabilityConfig={viewabilityConfig} nestedScrollEnabled/></View>;
}
const styles = StyleSheet.create({viewport: {height: spacing['4xl'] * 6}, row: {gap: spacing.xs, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
