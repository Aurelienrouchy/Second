import {useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {useLocalSearchParams, useRouter} from 'expo-router';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {auth} from '@/config/firebaseConfig';
import {Button, ScreenHeader} from '@/components/ui';
import {BankDisputeCasePanel} from '@/components/BankDisputeCasePanel';
import {AdminFinancialReauthentication} from '@/features/admin';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {useShippingPurchaseContext} from '@/hooks/useShippingPurchaseContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {SupportRequestService, parseSupportBankDeadlineTarget} from '@/services/supportRequestService';
import {BankDisputeCaseReadService} from '@/services/bankDisputeCaseReadService';
import {APP_LOCALE} from '@/constants/locale';
import {colors, spacing, typography} from '@/constants/theme';
export default function BankDeadlineScreen() {
  const uid = useAuthenticatedUid(), params = useLocalSearchParams<{target?: string}>(), router = useRouter(), client = useQueryClient();
  let target = null; try {const value: unknown = typeof params.target === 'string' && params.target.length <= 24000 ? JSON.parse(params.target) : null; target = uid ? parseSupportBankDeadlineTarget(value, uid) : null;} catch {/* Route content never supplies authority. */}
  const identity = JSON.stringify([uid, getAuthSessionGeneration(), params.target]), native = useShippingPurchaseContext(`bank-deadline-native:${identity}`, uid), frame = useLabelLifecycleContext(`bank-deadline-private:${identity}`, uid);
  const nativeKey = JSON.stringify([identity, native.focusRevision]), [authenticated, setAuthenticated] = useState<string | null>(null), [revision, setRevision] = useState(0);
  const queryKey = ['bank-deadline-native-target', nativeKey, frame.focusRevision, revision] as const;
  const query = useQuery({queryKey, enabled: !!uid && !!target && frame.focused && authenticated === nativeKey, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const operation = frame.capture(), owner = auth.currentUser; const guard = () => {frame.assertCurrent(operation); if (!owner || auth.currentUser !== owner) throw new Error('Relisez le dossier avec votre connexion actuelle.');};
      const qualified = await SupportRequestService.deadlineBankTarget(uid!, target!.item, target!.cursor, guard); guard();
      const bank = await BankDisputeCaseReadService.read(uid!, qualified.item.transactionId!, qualified.item.id, 'admin', 'preview', null, guard); guard();
      if (bank.case.transactionId !== qualified.item.transactionId || bank.case.disputeId !== qualified.item.id || bank.case.version !== qualified.item.version || bank.case.providerObservedAt !== qualified.item.providerObservedAt) throw new Error('La source bancaire a changé. Revenez à la file actuelle.');
      return {owner, qualified};
    }});
  const current = frame.focused && query.isSuccess && !query.isFetching && !query.isError && query.data.owner === auth.currentUser ? query.data : null;
  const [anchor, setAnchor] = useState<{key: string; transactionId: string; disputeId: string} | null>(null);
  if (anchor && anchor.key !== nativeKey) setAnchor(null);
  else if (current && (anchor?.transactionId !== current.qualified.item.transactionId || anchor?.disputeId !== current.qualified.item.id)) setAnchor({key: nativeKey, transactionId: current.qualified.item.transactionId!, disputeId: current.qualified.item.id});
  const assertSource = () => {const op = frame.capture(); frame.assertCurrent(op); const state = client.getQueryState(queryKey); if (!current || current.owner !== auth.currentUser || state?.status !== 'success' || state.fetchStatus !== 'idle' || state.isInvalidated || client.getQueryData(queryKey) !== current) throw new Error('Relisez l’échéance et le dossier bancaire exacts.');};
  return <View style={styles.container}><ScreenHeader title="Échéance bancaire — dossier exact" onBack={() => router.back()}/><ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.caption}>La référence reçue sert uniquement à retrouver une source. Le serveur requalifie le rôle, la version, la dernière observation native et le dossier avant toute lecture privée. Cette source enregistrée ne prouve pas l’état actuel du prestataire.</Text>
    {uid ? <AdminFinancialReauthentication uid={uid} sourceKey={`bank-deadline:${nativeKey}`} purpose="bank_review" disabled={!target || query.isFetching} onVerified={() => setAuthenticated(nativeKey)}/> : null}
    {current ? <><Text selectable style={styles.body}>Dossier {current.qualified.item.id} · commande {current.qualified.item.transactionId} · version {current.qualified.item.version}</Text><Text style={styles.caption}>{current.qualified.item.clock.providerDueAt ? `Échéance enregistrée : ${new Date(current.qualified.item.clock.providerDueAt).toLocaleString(APP_LOCALE, {timeZone: 'America/Toronto'})} (Québec) · ${current.qualified.item.clock.providerDueAt}` : 'Aucune date de réponse prestataire qualifiée.'}</Text><Text style={styles.caption}>La relecture d’une alerte ne prolonge pas l’échéance et n’atteste aucun examen humain.</Text></> : null}
    {uid && anchor?.key === nativeKey ? <BankDisputeCasePanel uid={uid} transactionId={anchor.transactionId} disputeId={anchor.disputeId} scope="admin" sourceKey={nativeKey} assertSelection={assertSource} ReauthenticationComponent={AdminFinancialReauthentication}/> : null}
    {!target || query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Cette référence ou sa source n’est pas actuellement qualifiée. Revenez à la file bancaire et sélectionnez sa page actuelle.</Text> : null}
    <Button variant="secondary" disabled={!frame.focused || query.isFetching} onPress={() => {try {frame.capture(); setRevision(v => v + 1);} catch {/* Current SDK/focus only. */}}}>Relire l’échéance et sa source bancaire</Button>
  </ScrollView></View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.lg, gap: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
