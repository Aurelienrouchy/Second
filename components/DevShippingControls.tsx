import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { DEV_COMMERCE_TESTING_ENABLED } from '@/config/featureFlags';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { advanceDevShipping, type DevShippingAction, type DevShippingLeg } from '@/services/devCommerceService';
import { TransactionService } from '@/services/transactionService';
import { queryKeys } from '@/lib/queryKeys';
import type { Transaction } from '@/types';

interface Props { transaction: Transaction; onStatusUpdate?: () => void }
const labels: Record<DevShippingAction, string> = {
  in_transit: 'Simuler le dépôt du colis', delivered: 'Simuler la livraison', release_funds: 'Simuler la fin du délai de retenue',
};
export function DevShippingControls({ transaction, onStatusUpdate }: Props) {
  const uid = useAuthenticatedUid();
  const client = useQueryClient();
  const context = useLabelLifecycleContext(JSON.stringify(['dev-shipping', transaction.id, transaction.status, transaction.carrierCode,
    transaction.shipEngineLabelId, transaction.refund?.state, transaction.returnRequest, transaction.returnLabelId,
    transaction.returnCarrierCode, transaction.returnTrackingStatus, transaction.returnDeliveredAt]), uid);
  const [working, setWorking] = useState(false), [notice, setNotice] = useState('');
  const [frame, setFrame] = useState(context.frame);
  if (frame !== context.frame) { setFrame(context.frame); setWorking(false); setNotice(''); }
  const visible = DEV_COMMERCE_TESTING_ENABLED && transaction.deliveryType === 'shipping' && transaction.carrierCode === 'seconde_dev' &&
    !!uid && (uid === transaction.buyerId || uid === transaction.sellerId);
  const hasReturn = transaction.returnRequest != null || transaction.returnLabelId != null || transaction.status === 'return_requested';
  const returnReady = transaction.returnCarrierCode === 'seconde_dev' && typeof transaction.returnLabelId === 'string' &&
    /^se-devsim-[a-f0-9]{32}$/.test(transaction.returnLabelId) && ['return_requested', 'refunded'].includes(transaction.status);
  const returnDelivered = transaction.returnTrackingStatus === 'DELIVERED' || transaction.returnDeliveredAt != null;
  const returnInTransit = transaction.returnTrackingStatus === 'IN_TRANSIT';
  const actionLabel = (action: DevShippingAction, leg: DevShippingLeg) => leg === 'return'
    ? action === 'in_transit' ? 'Simuler le dépôt du retour' : 'Simuler la réception du retour' : labels[action];
  const execute = async (action: DevShippingAction, leg: DevShippingLeg) => {
    if (!visible || !uid || working) return;
    let operation;
    try { operation = context.start(); } catch { return; }
    if (!operation) return;
    const current = () => context.assertCurrent(operation);
    setWorking(true); setNotice('');
    try {
      const order = await TransactionService.getTransaction(transaction.id); current();
      if (!order || order.id !== transaction.id || order.deliveryType !== 'shipping' || order.carrierCode !== 'seconde_dev' ||
          order.status !== transaction.status || order.shipEngineLabelId !== transaction.shipEngineLabelId ||
          order.returnLabelId !== transaction.returnLabelId || order.returnCarrierCode !== transaction.returnCarrierCode ||
          order.returnTrackingStatus !== transaction.returnTrackingStatus ||
          (order.buyerId !== uid && order.sellerId !== uid)) throw new Error('La commande a changé. Actualisez son suivi avant le test.');
      if (leg === 'return' && (!returnReady || action === 'release_funds') || leg === 'forward' && hasReturn) throw new Error('Actualisez le parcours de retour de cette commande.');
      const result = await advanceDevShipping(uid, order.id, action, current, leg); current();
      setNotice(action === 'release_funds' ? result.fundsReleased ? 'Les fonds de test ont été libérés dans le porte-monnaie vendeur.'
        : 'Le résultat de la retenue reste à vérifier dans le porte-monnaie.' : leg === 'return' && action === 'delivered'
          ? 'Le retour de test a été reçu. L’examen de l’article et le remboursement restent distincts.'
          : result.changed ? 'Le suivi de test a été mis à jour.' : 'Cette étape du test est déjà enregistrée.');
      void client.invalidateQueries({ queryKey: queryKeys.wallet.all });
      onStatusUpdate?.();
    } catch (error) {
      if (context.isCurrent(operation)) setNotice(error instanceof Error ? error.message : 'Actualisez la commande pour vérifier le résultat du test.');
    } finally { if (context.isCurrent(operation)) setWorking(false); context.finish(operation); }
  };
  const confirm = (action: DevShippingAction, leg: DevShippingLeg = 'forward') => {
    let operation;
    try { operation = context.capture(); } catch { return; }
    Alert.alert(actionLabel(action, leg), action === 'release_funds'
      ? 'Le temps sera simulé pour cette commande Dev uniquement. Les mêmes contrôles de litige, retour et solde seront appliqués.'
      : 'Cette action ajoute un événement de transport simulé. Aucun colis réel n’est envoyé.', [
      { text: 'Annuler', style: 'cancel' }, { text: 'Simuler', onPress: () => { if (context.isCurrent(operation)) void execute(action, leg); } },
    ]);
  };
  if (!visible) return null;
  return <View style={styles.container}>
    <Text style={styles.title}>Seconde Dev · Livraison simulée</Text>
    <Text style={styles.body}>Étiquette non expédiable. Faites avancer cette commande pour tester le suivi et le porte-monnaie.</Text>
    {!hasReturn && transaction.status === 'label_created' ? <Button variant="secondary" disabled={working} loading={working} onPress={() => confirm('in_transit')}>{labels.in_transit}</Button> : null}
    {!hasReturn && transaction.status === 'shipped' ? <Button variant="secondary" disabled={working} loading={working} onPress={() => confirm('delivered')}>{labels.delivered}</Button> : null}
    {!hasReturn && transaction.status === 'delivered' ? <Button variant="secondary" disabled={working} loading={working} onPress={() => confirm('release_funds')}>{labels.release_funds}</Button> : null}
    {returnReady && !returnDelivered && !returnInTransit ? <Button variant="secondary" disabled={working} loading={working} onPress={() => confirm('in_transit', 'return')}>Simuler le dépôt du retour</Button> : null}
    {returnReady && !returnDelivered && returnInTransit ? <Button variant="secondary" disabled={working} loading={working} onPress={() => confirm('delivered', 'return')}>Simuler la réception du retour</Button> : null}
    {returnReady && returnDelivered ? <Text style={styles.body}>Retour de test reçu. Le remboursement suit le traitement du dossier.</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.body}>{notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary,
    backgroundColor: colors.primaryLight, borderRadius: radius.md },
  title: { ...typography.h3, color: colors.foreground }, body: { ...typography.bodySmall, color: colors.foregroundSecondary },
});
