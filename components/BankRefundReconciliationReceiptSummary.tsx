import {StyleSheet, Text, View} from 'react-native';
import {colors, spacing, typography} from '@/constants/theme';
import type {BankRefundReconciliationReceipt} from '@/types/bankRefundReconciliation';

export function BankRefundReconciliationReceiptSummary({value}: {value: BankRefundReconciliationReceipt}) {
  return <View style={styles.section}>
    <Text selectable style={styles.body}>{value.state === 'received' ? 'Document enregistré nativement.' : value.state === 'not_executed' ? 'Instruction non exécutée, avec reçu natif.' : value.state === 'unknown' ? 'Rapprochement documentaire en attente ; observer la même intention.' : 'Aucun reçu natif enregistré pour cette intention.'}</Text>
    {value.reference ? <Text selectable style={styles.caption}>Référence : {value.reference.id} · {value.reference.contentHash}</Text> : null}
    {value.reason ? <Text selectable style={styles.caption}>Motif natif : {value.reason}</Text> : null}
    {value.recordedAt ? <Text selectable style={styles.caption}>Enregistré le {value.recordedAt}</Text> : null}
    <Text style={styles.caption}>Ce reçu atteste seulement le suivi documentaire. Il n’autorise ni règlement, ni débit, ni crédit, ni financement ou levée de garde, et ne prouve aucune arrivée bancaire.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.xs}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
