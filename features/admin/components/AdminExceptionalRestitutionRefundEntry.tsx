import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import type { ExceptionalRestitutionContext } from '@/types/exceptionalRestitution';
import { AdminExceptionalRestitutionPanel } from './AdminExceptionalRestitutionPanel';
type Harm = Extract<ExceptionalRestitutionContext, {kind: 'refund_error'}>['harm'];
const choices: {harm: Harm; label: string}[] = [{harm: 'buyer_shortfall', label: 'Sous-remboursement de l’acheteur'}, {harm: 'buyer_wrong_attribution', label: 'Remboursement attribué au mauvais bénéficiaire'}, {harm: 'seller_undue_debit', label: 'Débit indu du vendeur'}, {harm: 'seller_debt_compensation', label: 'Crédit compensatoire de la dette vendeur'}];
export function AdminExceptionalRestitutionRefundEntry({uid, transactionId, refundIntentId, onRecorded, onOriginalRefundAllocation}: {
  uid: string; transactionId: string; refundIntentId: string; onRecorded: () => void; onOriginalRefundAllocation?: (context: {transactionId: string; refundIntentId: string}) => void;
}) {
  const dossier = JSON.stringify([transactionId, refundIntentId]), sdk = useShippingPurchaseContext(`exceptional-refund-entry:${dossier}`, uid), active = useLabelLifecycleContext(`exceptional-refund-choice:${dossier}`, uid);
  const key = JSON.stringify([uid, dossier, getAuthSessionGeneration(), sdk.focusRevision]);
  const [selection, setSelection] = useState<{key: string; harm: Harm} | null>(null), harm = selection?.key === key ? selection.harm : null;
  return <View style={styles.section}>
    <Text style={styles.caption}>Choisissez le préjudice à examiner sur cette commande et cette allocation natives. Ce choix ne constate aucune faute et n’autorise aucun paiement.</Text>
    {choices.map(c => <Button key={c.harm} variant="secondary" disabled={!active.focused} onPress={() => {try {active.capture(); setSelection({key, harm: c.harm});} catch { /* Current source selection only. */ }}}>{c.label}</Button>)}
    {harm ? <AdminExceptionalRestitutionPanel uid={uid} context={{kind: 'refund_error', transactionId, refundIntentId, harm}} onRecorded={onRecorded} onOriginalRefundAllocation={onOriginalRefundAllocation} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}});
