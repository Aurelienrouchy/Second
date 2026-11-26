import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ui';
import { LabelLifecyclePanel } from '@/components/LabelLifecyclePanel';
import { LabelLifecycleOwnHistory } from '@/components/LabelLifecycleOwnHistory';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { isLabelLifecycleContext } from '@/services/labelLifecycleService';
import { colors, spacing, typography } from '@/constants/theme';
export default function LabelLifecycleScreen() {
  const uid = useAuthenticatedUid(), router = useRouter(), params = useLocalSearchParams<{transactionId?: string; leg?: string; routeEntryId?: string; routeContentHash?: string; routeNotificationId?: string; parcelAmendmentCapability?: string}>();
  const candidate = {transactionId: params.transactionId, leg: params.leg}, context = isLabelLifecycleContext(candidate) ? candidate : null;
  const hasNotice = params.routeEntryId !== undefined || params.routeContentHash !== undefined || params.routeNotificationId !== undefined;
  const routeNotice = typeof params.routeEntryId === 'string' && /^lr_[a-f0-9]{64}$/.test(params.routeEntryId) && typeof params.routeContentHash === 'string' && /^[a-f0-9]{64}$/.test(params.routeContentHash) && typeof params.routeNotificationId === 'string' && /^operational_[a-f0-9]{64}$/.test(params.routeNotificationId) ? {entryId: params.routeEntryId, contentHash: params.routeContentHash, notificationId: params.routeNotificationId} : null;
  const invalidParcelCapability = params.parcelAmendmentCapability !== undefined && params.parcelAmendmentCapability !== 'label_parcel_amendment_v1';
  const parcelAmendment = hasNotice ? params.parcelAmendmentCapability === 'label_parcel_amendment_v1' : true;
  const frame = useLabelLifecycleContext(JSON.stringify(['label-lifecycle-own-route', context, routeNotice, params.parcelAmendmentCapability]), uid);
  return <View style={styles.container}><ScreenHeader title="Suivi de l’étiquette" onBack={() => router.back()} /><ScrollView contentContainerStyle={styles.content}>
    {!uid ? <Text style={styles.body}>Connectez-vous pour consulter le suivi de vos étiquettes.</Text> : !context || hasNotice && !routeNotice || invalidParcelCapability ? <Text accessibilityRole="alert" style={styles.body}>Ce lien est incomplet ou invalide. Ouvrez le suivi de l’étiquette depuis votre commande ou votre notification.</Text> : frame.focused ? <LabelLifecyclePanel key={JSON.stringify([uid, context, routeNotice, parcelAmendment])} uid={uid} context={context} scope="own" routeNotice={routeNotice} parcelAmendment={parcelAmendment} /> : null}
    {uid && frame.focused ? <LabelLifecycleOwnHistory uid={uid} /> : null}
  </ScrollView></View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}});
