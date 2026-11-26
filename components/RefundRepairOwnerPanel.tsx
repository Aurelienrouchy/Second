import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { RefundRepairSummary } from '@/components/RefundRepairSummary';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { RefundRepairService, RefundRepairManualService } from '@/services/refundRepairService';
/** Native party observations only; this reader cannot reserve or repair money. */
export function RefundRepairOwnerPanel({uid, transactionId}: {uid: string; transactionId: string}) {
  const context = useLabelLifecycleContext(`own-refund-repair:${transactionId}`, uid);
  const key = JSON.stringify([uid, transactionId, getAuthSessionGeneration(), context.focusRevision]);
  const [selection, setSelection] = useState<{key: string; refundIntentId?: string; cursor?: {lastId: string} | null; instructionCursor?: {lastId: string} | null} | null>(null);
  const options: NonNullable<typeof selection> = selection?.key === key ? selection : {key};
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null), interactions = useRef(0);
  const query = useQuery({queryKey: ['refund-repair-party', key, options], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(), interaction = interactions.current; const current = () => {context.assertCurrent(op); if (interactions.current !== interaction) throw new Error('La sélection a changé.');};
      return RefundRepairService.source(uid, transactionId, 'own', current, {refundIntentId: options.refundIntentId, cursor: options.cursor ?? null, instructionCursor: options.instructionCursor ?? null});}});
  const source = context.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  const manual = useQuery({queryKey: ['manual-refund-party', key, options.refundIntentId], enabled: context.focused && !!options.refundIntentId,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = context.capture(); if (!options.refundIntentId) throw new Error('Allocation native requise.');
      return RefundRepairManualService.source(uid, transactionId, options.refundIntentId, 'own', () => context.assertCurrent(op));}});
  const manualSource = context.focused && manual.isSuccess && !manual.isFetching && !manual.isError ? manual.data.selected : null;
  const choose = (patch: Partial<Omit<NonNullable<typeof selection>, 'key'>>) => {try {context.capture(); interactions.current++; setSelection({...options, ...patch, key}); setNotice(null);} catch { /* No old private observation is kept on screen. */ }};
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Suivi de la restitution restante</Text>
    <Text style={styles.caption}>Les instructions et allocations ci-dessous sont des lectures natives de cette commande. Une instruction enregistrée ne confirme aucun argent reçu ni une arrivée bancaire.</Text>
    <Text style={styles.caption}>Lorsqu’un virement manuel est nécessaire, l’équipe Seconde vérifie les justificatifs privés et consigne une attestation distincte. Aucune coordonnée bancaire n’est recueillie sur cet écran.</Text>
    <Button variant="secondary" disabled={!context.focused || query.isFetching} onPress={() => {try {context.capture(); interactions.current++; setNotice(null); void query.refetch().catch(() => setNotice({key, text: 'La lecture doit être reprise.'}));} catch { /* No mutation or automatic retry. */ }}}>Relire le suivi de cette commande</Button>
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le suivi natif n’est pas disponible dans cette lecture. Aucun règlement ni absence d’obligation ne peut en être déduit.</Text> : null}
    {source ? <>
      {source.candidates.length === 0 ? <Text style={styles.caption}>Aucune allocation dans cette page. Les autres obligations restent distinctes.</Text> : null}
      {source.candidates.map(c => <Button key={c.refundIntentId} variant="secondary" disabled={c.qualification !== 'native_allocation_reference'} onPress={() => choose({refundIntentId: c.refundIntentId})}>{c.historical ? 'Consulter l’allocation historique' : 'Consulter l’allocation courante'} · {c.refundIntentId}</Button>)}
      {source.cursor ? <Button variant="secondary" onPress={() => choose({cursor: source.cursor, refundIntentId: undefined})}>Allocations suivantes</Button> : null}
      {options.cursor ? <Button variant="ghost" onPress={() => choose({cursor: null, refundIntentId: undefined})}>Première page des allocations</Button> : null}
      {manualSource ? <RefundRepairSummary manual={manualSource} /> : null}
      {manual.isError ? <Text style={styles.caption}>Le suivi manuel ne peut pas être qualifié dans cette lecture ; aucun règlement n’est déduit.</Text> : null}
      {source.selected ? <RefundRepairSummary source={source.selected} /> : source.reason ? <Text style={styles.caption}>Les références de cette allocation ne sont pas qualifiées. Aucun montant inconnu n’est traité comme zéro.</Text> : null}
      {source.instructions.entries.map(i => <View key={i.instructionId} style={styles.section}><Text selectable style={styles.caption}>Instruction {i.instructionId} · allocation {i.refundIntentId} · {new Date(i.recordedAt).toLocaleString(APP_LOCALE)}.</Text><Text style={styles.body}>{i.partyMessage}</Text><Text style={styles.caption}>{i.action === 'record_external_instruction' ? 'Instruction documentaire : aucun paiement externe ni fonds reçus attesté.' : 'Instruction de réparation : son enregistrement ne prouve pas son résultat financier.'}</Text></View>)}
      {source.instructions.cursor ? <Button variant="secondary" onPress={() => choose({instructionCursor: source.instructions.cursor})}>Instructions suivantes</Button> : null}
      {options.instructionCursor ? <Button variant="ghost" onPress={() => choose({instructionCursor: null})}>Première page des instructions</Button> : null}
    </> : null}
    {notice?.key === key && context.focused ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
