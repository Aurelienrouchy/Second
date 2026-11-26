import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { APP_LOCALE } from '@/constants/locale';
import { formatCents } from '@/utils/formatPrice';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { RefundStatusNotice } from '@/components/RefundStatusNotice';
import { TransactionService } from '@/services/transactionService';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { auth } from '@/config/firebaseConfig';
import { AdminRefundRepairPanel } from './AdminRefundRepairPanel';
import type { Transaction } from '@/types/transaction';
import { canRetryRefund, getFinancialErrorMessage, hasPurchaseRefundContext, refundResultPresentation } from '@/utils/refundPresentation';

export function AdminRefundCard({transaction, onRefresh}: {transaction: Transaction; onRefresh: () => void}) {
  const uid = useAuthenticatedUid(), repairContext = hasPurchaseRefundContext(transaction);
  // The whole refund object retains native attempt/version fields even on legacy
  // documents. A reread changing them invalidates an already displayed alert.
  const source = JSON.stringify([transaction.id, transaction.status, transaction.refund, transaction.bankDispute,
    transaction.refundBlocked, transaction.refundLegacyReconciliationRequired, transaction.disputeId, transaction.disputeOutcome,
    transaction.disputeClosedAt, transaction.disputeFreezeCents, repairContext]);
  const context = useLabelLifecycleContext(`admin-refund:${source}`, uid);
  const native = useShippingPurchaseContext(`admin-refund-native:${transaction.id}`, uid);
  type Scope = {frame: symbol; focusRevision: string};
  const [busyScope, setBusyScope] = useState<Scope | null>(null);
  const [repairScope, setRepairScope] = useState<{frame: symbol; focusRevision: number; owner: typeof auth.currentUser} | null>(null);
  const confirmation = useRef<ReturnType<typeof context.capture> | null>(null);
  const busy = busyScope?.frame === context.frame && busyScope.focusRevision === context.focusRevision;
  const repairOpen = repairScope?.frame === native.frame && repairScope.focusRevision === native.focusRevision && repairScope.owner === auth.currentUser;
  const intentId = transaction.refund?.intentId;
  const retryAllowed = !!uid && context.focused && canRetryRefund(transaction) && typeof intentId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(intentId);
  const retry = () => {
    if (!retryAllowed || busy || !uid || !intentId) return;
    let request: ReturnType<typeof context.capture>;
    try {request = context.capture();} catch {return;}
    confirmation.current = request;
    Alert.alert('Réessayer le remboursement', 'Une nouvelle tentative sera enregistrée pour le même remboursement. Les mouvements de solde déjà effectués ne seront pas répétés.', [
      {text: 'Retour', style: 'cancel', onPress: () => {if (confirmation.current === request) confirmation.current = null;}},
      {text: 'Confirmer la demande', onPress: async () => {
        if (confirmation.current !== request) return;
        let operation: ReturnType<typeof context.capture>;
        try {
          context.assertCurrent(request);
          const started = context.start(); if (!started) return;
          operation = started;
        } catch {return;}
        confirmation.current = null;
        setBusyScope({frame: operation.base.frame, focusRevision: JSON.stringify([operation.base.focusEpoch, operation.activityRevision])});
        try {
          context.assertCurrent(operation);
          const result = await TransactionService.retryPurchaseRefund(transaction.id, uid, intentId, () => context.assertCurrent(operation));
          context.assertCurrent(operation);
          const presentation = refundResultPresentation(result);
          Alert.alert(presentation.title, presentation.message);
        } catch (error) {
          if (context.isCurrent(operation)) Alert.alert('Dossier ouvert', getFinancialErrorMessage(error));
        } finally {
          context.finish(operation);
          if (context.isCurrent(operation)) {setBusyScope(null); onRefresh();}
        }
      }},
    ]);
  };
  const toggleRepair = () => {
    try {context.capture(); native.capture(); setRepairScope(repairOpen ? null : {frame: native.frame, focusRevision: native.focusRevision, owner: auth.currentUser});} catch {return;}
  };
  if (!uid || !native.focused) return null;
  return <View style={styles.card}>
    {context.focused ? <>
    <Text style={styles.title}>Commande {transaction.id}</Text>
    <Text style={styles.body}>{transaction.createdAtKnown === false ? 'Date indisponible' : transaction.createdAt.toLocaleString(APP_LOCALE)}</Text>
    <Text style={styles.body}>Origine : {transaction.refund?.source ?? transaction.refundReason ?? 'Historique à vérifier'}</Text>
    <RefundStatusNotice transaction={transaction} perspective="admin" />
    {!!transaction.refund?.intentId && <Text style={styles.body}>Intention : {transaction.refund.intentId}</Text>}
    {!!transaction.refund?.stripeRefundId && <Text style={styles.body}>Remboursement prestataire : {transaction.refund.stripeRefundId}</Text>}
    {!!transaction.bankDispute?.id && <Text style={styles.body}>Dossier bancaire : {transaction.bankDispute.id} · {transaction.bankDispute.state ?? 'État à vérifier'} · {transaction.bankDispute.outcome ?? 'Décision attendue'}</Text>}
    {Number.isSafeInteger(transaction.refund?.freezeCents) && <Text style={styles.body}>Réserve locale de cette vente : {formatCents(transaction.refund!.freezeCents!)}</Text>}
    {(transaction.refund?.duplicateCardSettlementCents ?? 0) > 0 && <Text style={styles.body}>Double règlement externe à rapprocher : {formatCents(transaction.refund!.duplicateCardSettlementCents!)}</Text>}
    {!!transaction.refund?.fundsAppliedAt && <Text style={styles.body}>Mouvements locaux enregistrés ; cette preuve ne confirme pas le moyen de paiement actuel.</Text>}
    {repairContext ? <Pressable accessibilityRole="button" accessibilityState={{expanded: repairOpen}} style={styles.button} onPress={toggleRepair}><Text style={styles.buttonText}>{repairOpen ? 'Fermer l’examen de restitution' : 'Examiner la restitution restante'}</Text></Pressable> : retryAllowed ? <Pressable accessibilityRole="button" accessibilityState={{disabled: busy, busy}} disabled={busy} style={styles.button} onPress={retry}>
      <Text style={styles.buttonText}>Réessayer le remboursement</Text>
    </Pressable> : <Text style={styles.body}>Aucune reprise financière automatique admissible. Le traitement opérateur reste à poursuivre.</Text>}
    </> : null}
    {repairOpen ? <AdminRefundRepairPanel uid={uid} transactionId={transaction.id} onRecorded={onRefresh} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: {padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceWarm, gap: spacing.sm},
  title: {fontFamily: fonts.sansMedium, color: colors.foreground}, body: {fontFamily: fonts.sans, color: colors.foreground},
  button: {padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary}, buttonText: {fontFamily: fonts.sansMedium, color: colors.cream},
});
