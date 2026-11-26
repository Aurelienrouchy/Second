import {CancelledError, useQuery} from '@tanstack/react-query';
import {StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {getAuthSessionGeneration} from '@/store/authStore';
import {ShippingPurchaseService} from '@/services/shippingPurchaseService';
import {colors, spacing, typography} from '@/constants/theme';
import {APP_LOCALE} from '@/constants/locale';
import type {Transaction} from '@/types';

/** One policy read, only when the member explicitly opens deadlines. */
export function OrderPolicyDates({order, onSupport}: {order: Transaction; onSupport: () => void}) {
  const uid = useAuthenticatedUid();
  const dossier = JSON.stringify(['order-dates', order.id, order.status, order.deliveryCorrection, order.fundsReleaseAt]);
  const context = useLabelLifecycleContext(dossier, uid);
  const query = useQuery({queryKey: ['order-policy-dates', uid, getAuthSessionGeneration(), dossier, context.focusRevision],
    enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async ({signal}) => {
      let operation: ReturnType<typeof context.capture> | null = null;
      try {operation = context.capture(); const current = () => {if (signal.aborted) throw new CancelledError({silent: true}); context.assertCurrent(operation!);};
        const result = await ShippingPurchaseService.readPolicyTimeline(operation.base.session.uid, order.id, current); current(); return result;
      } catch (error) {
        if (signal.aborted || operation && !context.isCurrent(operation)) throw new CancelledError({silent: true});
        if (!operation) {try {context.capture();} catch {throw new CancelledError({silent: true});}}
        throw error;
      }
    }});
  const policy = context.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data.purchasePolicy : null;
  const qualified = policy?.qualification === 'accepted_snapshot' && !policy.reviewRequired && !order.deliveryCorrection;
  const deliveryMatches = order.deliveredAt instanceof Date && policy?.deliveryEventAtMs === order.deliveredAt.getTime();
  const releaseMatches = order.fundsReleaseAt instanceof Date && policy?.fundsReleaseAtMs === order.fundsReleaseAt.getTime();
  const rows = qualified ? [
    policy.paymentClockBasis === 'qualified_payment_recorded_at' && !order.shippedAt && policy.nonShipmentExpiresAtMs ? {label: 'Échéance d’expédition initiale', at: policy.nonShipmentExpiresAtMs} : null,
    deliveryMatches && policy.deliveryProtectionEndsAtMs ? {label: 'Protection jusqu’au', at: policy.deliveryProtectionEndsAtMs} : null,
    uid === order.sellerId && deliveryMatches && releaseMatches && policy.fundsReleaseAtMs ? {label: 'Fin prévue de la retenue', at: policy.fundsReleaseAtMs} : null,
  ].filter((row): row is {label: string; at: number} => row !== null) : [];
  return <View style={styles.section}>
    {query.isFetching ? <Text style={styles.body}>Chargement des délais…</Text> : rows.length ? rows.map(row => <View key={row.label} style={styles.row}>
      <Text style={styles.label}>{row.label}</Text><Text style={styles.body}>{new Date(row.at).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'})}</Text>
    </View>) : <Text style={styles.body}>Contactez Seconde pour connaître les délais de cette commande.</Text>}
    <Button variant="ghost" loading={query.isFetching} onPress={() => {try {context.capture(); void query.refetch();} catch {/* Changed owner. */}}}>Actualiser</Button>
    <Button variant="ghost" onPress={onSupport}>Contacter Seconde</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.lg}, row: {gap: spacing.xs}, label: {...typography.label, color: colors.foreground}, body: {...typography.body, color: colors.foreground}});
