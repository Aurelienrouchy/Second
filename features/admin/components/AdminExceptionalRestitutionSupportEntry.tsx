import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import type { SupportRequest } from '@/types/supportRequest';
import type { ExceptionalRestitutionContext } from '@/types/exceptionalRestitution';
import { AdminExceptionalRestitutionPanel } from './AdminExceptionalRestitutionPanel';
/** Entries derive all identifiers from the selected native support request. */
export function AdminExceptionalRestitutionSupportEntry({uid, request, onRecorded}: {uid: string; request: SupportRequest; onRecorded: () => void}) {
  const sdk = useShippingPurchaseContext(`exceptional-support-entry:${request.id}`, uid), active = useLabelLifecycleContext(`exceptional-support-choice:${request.id}`, uid);
  const key = JSON.stringify([uid, request.id, request.version, getAuthSessionGeneration(), sdk.focusRevision]);
  const [selection, setSelection] = useState<{key: string; context: ExceptionalRestitutionContext} | null>(null);
  const review = request.accountReview;
  const representedOwner = review && review.protocol === 'support_account_review_v2' && 'representationAuthorityVerified' in review && review.representationAuthorityVerified === true &&
    review.finding === 'representation_authority_confirmed' && review.authorityScope === 'selected_existing_obligations_only' && review.representativeUid === request.ownerId &&
    review.obligations.some(o => o.kind === 'wallet' && o.id === review.subjectUid) ? review.subjectUid : null;
  const choose = (context: ExceptionalRestitutionContext) => {try {active.capture(); setSelection({key, context});} catch { /* No declared beneficiary is adopted. */ }};
  const selected = selection?.key === key ? selection.context : null;
  return <View style={styles.section}>
    <Text style={styles.caption}>Examen exceptionnel lié à cette demande native. Seules les sources serveur qualifieront le bénéficiaire, le plafond et les pouvoirs sur l’obligation.</Text>
    {request.withdrawalRequestId && request.withdrawalTimingContext?.withdrawalRequestId === request.withdrawalRequestId ? <Button variant="secondary" disabled={!active.focused} onPress={() => choose({kind: 'withdrawal_misdirection', withdrawalRequestId: request.withdrawalRequestId!})}>Examiner une erreur de destination de ce retrait</Button> : null}
    {['access_interruption', 'payment_account_review', 'account_reconciliation'].includes(request.kind) ? <Button variant="secondary" disabled={!active.focused} onPress={() => choose({kind: 'wallet_restitution', ownerId: request.ownerId, supportRequestId: request.id})}>Examiner le solde du propriétaire de cette demande</Button> : null}
    {representedOwner ? <Button variant="secondary" disabled={!active.focused} onPress={() => choose({kind: 'wallet_restitution', ownerId: representedOwner, supportRequestId: request.id})}>Examiner le seul solde couvert par le pouvoir confirmé</Button> : null}
    {selected ? <AdminExceptionalRestitutionPanel uid={uid} context={selected} onRecorded={onRecorded} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}});
