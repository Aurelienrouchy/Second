import { useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { OrphanCaptureRefundJournal as Journal } from '@/services/orphanCaptureRefundJournal';
import type { OrphanCaptureRefundReference as Reference } from '@/types/orphanCaptureRefund';
import { AdminOrphanCaptureRefundPanel } from './AdminOrphanCaptureRefundPanel';
import { AdminOrphanCaptureRefundSummary } from './AdminOrphanCaptureRefundSummary';

/** Own opaque receipts remain readable when the current financial role is lost. */
export function AdminOrphanCaptureRefundHistory({uid, onRecorded}: {uid: string; onRecorded?: () => void}) {
  const context = useLabelLifecycleContext('orphan-capture-own-history', uid), native = useShippingPurchaseContext('orphan-capture-history-selection', uid), client = useQueryClient();
  const renderOwner = auth.currentUser;
  const query = useQuery({queryKey: ['orphan-capture-history', uid, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = context.capture(), owner = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== owner) throw new Error('La connexion a changé.');};
      const entries = await Journal.read(uid, guard); guard(); return {entries, owner};}});
  const [selection, setSelection] = useState<{reference: Reference; owner: typeof auth.currentUser; frame: symbol; focusRevision: number} | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<string | null>(null), lock = useRef<symbol | null>(null);
  const identity = useRef({uid, owner: renderOwner});
  useLayoutEffect(() => {if (identity.current.uid !== uid || identity.current.owner !== renderOwner) {identity.current = {uid, owner: renderOwner}; lock.current = null; setBusy(false); setNotice(null); setSelection(null);}}, [uid, renderOwner]);
  const entries = context.focused && query.isSuccess && !query.isFetching && query.data.owner === auth.currentUser ? query.data.entries : [];
  const selected = selection?.frame === native.frame && selection.focusRevision === native.focusRevision && selection.owner === auth.currentUser ? selection.reference : null;
  const refresh = () => {try {if (auth.currentUser !== renderOwner) return; context.capture();} catch {return;}
    void client.invalidateQueries({queryKey: ['orphan-capture-history', uid]}); void client.invalidateQueries({queryKey: ['orphan-capture-pending', uid]}); onRecorded?.();};
  const service = async (reference: Reference, mode: 'observe' | 'neutralize' | 'acknowledge') => {
    if (auth.currentUser !== renderOwner || lock.current) return; let op; try {op = context.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(true); setNotice(null); const owner = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== owner) throw new Error('La connexion a changé.');};
    try {if (mode === 'acknowledge') await Journal.acknowledge(reference, guard); else await Journal.service(reference, mode, guard); guard();}
    catch {if (context.isCurrent(op)) setNotice('La même référence reste conservée. Relisez son résultat ; aucune absence d’effet n’est supposée.');}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(false);} if (context.isCurrent(op) && auth.currentUser === renderOwner) refresh();}
  };
  if (!native.focused) return null;
  return <View style={styles.section}>
    {context.focused ? <><Text accessibilityRole="header" style={styles.title}>Mon suivi des remboursements de captures</Text>
      <Text style={styles.caption}>Ces références personnelles permettent de relire l’issue exacte sans renvoyer le corps d’une ancienne commande. Elles restent accessibles après perte du rôle financier.</Text>
      <Button variant="secondary" disabled={busy} onPress={() => {try {context.capture(); refresh();} catch { /* Own GET only. */ }}}>Relire mes reçus de captures</Button>
      {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le suivi reste à vérifier. Aucune référence n’est effacée.</Text> : null}
      {entries.map(({reference, receipt}) => <View key={reference.requestId} style={styles.section}>
        <AdminOrphanCaptureRefundSummary value={receipt} />
        <Button variant="secondary" disabled={busy} onPress={() => {void service(reference, 'observe');}}>Relire cette même demande de capture</Button>
        {receipt.state === 'unrecorded' ? <Button variant="secondary" disabled={busy} onPress={() => {void service(reference, 'neutralize');}}>Neutraliser seulement si aucune réservation n’existe</Button> : null}
        {['reserved', 'outcome_unknown'].includes(receipt.state) ? <Button variant="secondary" disabled={busy} onPress={() => {try {if (auth.currentUser !== renderOwner) return; context.capture(); native.capture(); setSelection({reference, owner: auth.currentUser, frame: native.frame, focusRevision: native.focusRevision});} catch { /* Own native reference only. */ }}}>Examiner cette réservation de capture</Button> : null}
        {['not_executed', 'succeeded', 'failed', 'canceled'].includes(receipt.state) ? <Button variant="secondary" disabled={busy} onPress={() => {void service(reference, 'acknowledge');}}>Acquitter ce reçu terminal de capture</Button> : null}
      </View>)}
      {notice ? <Text accessibilityRole="alert" style={styles.caption}>{notice}</Text> : null}
    </> : null}
    {selected ? <AdminOrphanCaptureRefundPanel uid={uid} operationId={selected.operationId} continuation={selected} onRecorded={refresh} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
