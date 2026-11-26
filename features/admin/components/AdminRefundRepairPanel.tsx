import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { Button, Checkbox } from '@/components/ui';
import { RefundRepairSummary } from '@/components/RefundRepairSummary';
import { colors, spacing, typography } from '@/constants/theme';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { auth } from '@/config/firebaseConfig';
import { getAuthSessionGeneration } from '@/store/authStore';
import { RefundRepairService } from '@/services/refundRepairService';
import { RefundRepairJournal } from '@/services/refundRepairJournal';
import type { RefundRepairAction, RefundRepairAttempt, RefundRepairPreview } from '@/types/refundRepair';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
import { AdminRefundRepairManualPanel } from './AdminRefundRepairManualPanel';
import { AdminRefundRepairHistory } from './AdminRefundRepairHistory';
import { AdminExceptionalRestitutionRefundEntry } from './AdminExceptionalRestitutionRefundEntry';
type Draft = {key: string; preview: RefundRepairPreview; requestId: string; note: string; partyMessage: string; examined: boolean; accepted: boolean};
const sourceAllowed = (p: RefundRepairPreview) => p.action === 'repair_original_method' ? p.source.canRepairOriginalMethodNow && p.source.localMovementsVerified && !p.source.bankReviewRequired && !p.source.riskReviewRequired && p.source.historyComplete && p.source.remainingCardCents !== null && p.source.remainingCardCents > 0 : p.source.canRecordExternalInstructionNow && p.source.historyComplete;
const tuple = (p: RefundRepairPreview) => {
  const s = p.source, monetary = p.action === 'repair_original_method';
  return {transactionId: s.transactionId, refundIntentId: s.refundIntentId, action: p.action, previewId: p.previewId, sourceHash: s.sourceHash, sourceRevision: s.sourceRevision,
    terminalRefundId: monetary ? s.terminalRefundId : s.originalRefundId, terminalAttemptId: monetary ? s.terminalAttemptId : s.refundAttemptId,
    amountCents: monetary ? s.remainingCardCents : s.obligationCardCents, currency: 'CAD' as const};
};
/** One obligation, one durable command; historical observations never grant NEW. */
export function AdminRefundRepairPanel({uid, transactionId, onRecorded}: {uid: string; transactionId: string; onRecorded: () => void}) {
  const frame = useLabelLifecycleContext(`admin-refund-repair:${transactionId}`, uid), client = useQueryClient();
  const native = useShippingPurchaseContext(`admin-refund-repair-native:${transactionId}`, uid);
  const nativeKey = JSON.stringify([uid, transactionId, getAuthSessionGeneration(), native.focusRevision]);
  const [manualAnchor, setManualAnchor] = useState<{key: string; intentId: string; owner: typeof auth.currentUser} | null>(null);
  const key = JSON.stringify([uid, transactionId, getAuthSessionGeneration(), frame.focusRevision]);
  const [choice, setChoice] = useState<{key: string; owner: typeof auth.currentUser; intentId: string | null; action: RefundRepairAction | null; cursor: {lastId: string} | null} | null>(null);
  const selected = choice?.key === nativeKey && choice.owner === auth.currentUser ? choice : {key: nativeKey, owner: auth.currentUser, intentId: null, action: null, cursor: null};
  const selectionKey = JSON.stringify([nativeKey, selected.intentId, selected.action]);
  const readKey = JSON.stringify([key, selected.intentId, selected.cursor]);
  const [verified, setVerified] = useState<{selectionKey: string; sourceHash: string; sourceRevision: string | null; activityRevision: string; owner: typeof auth.currentUser} | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const interaction = useRef(0), lock = useRef<symbol | null>(null);
  const query = useQuery({queryKey: ['admin-refund-repair-source', readKey], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = frame.capture(), nativeOp = native.capture(), owner = auth.currentUser;
      const current = () => {frame.assertCurrent(op); native.assertCurrent(nativeOp); if (auth.currentUser !== owner) throw new Error('La connexion Firebase a changé.');};
      const value = await RefundRepairService.source(uid, transactionId, 'admin', current, {...(selected.intentId ? {refundIntentId: selected.intentId} : {}), cursor: selected.cursor}); current();
      if (value.selected) {const intentId = value.selected.refundIntentId; setManualAnchor(old => old?.key === nativeKey && old.owner === owner && old.intentId === intentId ? old : {key: nativeKey, owner, intentId});}
      return value;}});
  const observation = frame.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data : null, source = observation?.selected ?? null;
  const sourceKey = JSON.stringify([readKey, observation?.sourceRevision, source?.sourceHash, query.dataUpdatedAt]);
  const choiceKey = JSON.stringify([sourceKey, selected.action]);
  const journal = useQuery({queryKey: ['admin-refund-repair-pending', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return RefundRepairJournal.pending(uid, () => frame.assertCurrent(op));}});
  const journalReady = frame.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const blocked = !journalReady || journal.data.some(a => a.command.transactionId === transactionId && a.command.refundIntentId === selected.intentId);
  const current = frame.focused && source && !blocked && draft?.key === choiceKey ? draft : null;
  const live = useRef({key: choiceKey, selectionKey, nativeKey, frame}); useLayoutEffect(() => {live.current = {key: choiceKey, selectionKey, nativeKey, frame};}, [choiceKey, selectionKey, nativeKey, frame]);
  const verificationCurrent = !!source && verified?.selectionKey === selectionKey && verified.owner === auth.currentUser && verified.sourceHash === source.sourceHash && verified.sourceRevision === source.sourceRevision && verified.activityRevision === frame.focusRevision;
  const change = (patch: Partial<Omit<NonNullable<typeof choice>, 'key'>>) => {try {frame.capture(); interaction.current++; if (patch.intentId !== undefined && (patch.intentId === null || patch.intentId !== selected.intentId)) setManualAnchor(null); setChoice({...selected, ...patch, key: nativeKey, owner: auth.currentUser}); setVerified(null); setDraft(null); setNotice(null);} catch { /* Current activity and native selection are required. */ }};
  const edit = (patch: Partial<Pick<Draft, 'note' | 'partyMessage' | 'examined' | 'accepted'>>) => {if (!current) return; try {frame.capture(); interaction.current++; setDraft(old => old?.key === choiceKey && old.requestId === current.requestId ? {...old, ...patch} : old);} catch { /* Old callbacks cannot replace a new choice. */ }};
  const prepare = async () => {
    if (!source || !selected.action || !verificationCurrent || blocked || lock.current || !source.sourceRevision || !source.historyComplete) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(key); setNotice(null); const epoch = ++interaction.current;
    const assertCurrent = () => {frame.assertCurrent(op); if (auth.currentUser !== verified?.owner || live.current.key !== choiceKey || interaction.current !== epoch) throw new Error('La sélection ou votre confirmation a changé.');};
    try {
      const preview = await RefundRepairService.preview(uid, transactionId, source.refundIntentId, selected.action, assertCurrent); assertCurrent();
      if (preview.source.sourceHash !== source.sourceHash || preview.source.sourceRevision !== source.sourceRevision) throw new Error('Les sources ont changé pendant la qualification. Relisez explicitement cette obligation.');
      if (!sourceAllowed(preview)) throw new Error('La faisabilité actuelle de ce choix n’est pas qualifiée. Aucun autre moyen ni montant n’est déduit.');
      setDraft({key: choiceKey, preview, requestId: randomUUID(), note: '', partyMessage: '', examined: false, accepted: false});
    } catch (error) {if (frame.isCurrent(op) && interaction.current === epoch && live.current.key === choiceKey) {setNotice({key, text: error instanceof Error ? error.message : 'L’aperçu doit être repris.'}); setDraft(null);}}
    finally {frame.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  const submit = async () => {
    if (!current || !current.examined || !current.accepted || !verificationCurrent || blocked || !sourceAllowed(current.preview) || !current.note.trim() || !current.partyMessage.trim() || lock.current) return;
    let op; try {op = frame.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(key); setNotice(null); const epoch = ++interaction.current;
    const assertCurrent = () => {frame.assertCurrent(op); if (auth.currentUser !== verified?.owner || live.current.key !== choiceKey || interaction.current !== epoch) throw new Error('Le choix visible, ses textes ou sa confirmation ont changé.');};
    try {
      const preview = await RefundRepairService.preview(uid, transactionId, current.preview.source.refundIntentId, current.preview.action, assertCurrent); assertCurrent();
      const original = tuple(current.preview), latest = tuple(preview);
      if (!sourceAllowed(preview) || JSON.stringify(original) !== JSON.stringify(latest) || !original.sourceRevision || !original.terminalRefundId || original.amountCents === null) throw new Error('L’obligation, sa faisabilité ou son aperçu a changé. Relisez cette source avant toute nouvelle instruction.');
      const attempt: RefundRepairAttempt = {version: 1, uid, requestId: current.requestId, command: {...original, sourceRevision: original.sourceRevision, terminalRefundId: original.terminalRefundId, amountCents: original.amountCents, note: current.note.trim(), partyMessage: current.partyMessage.trim(), acknowledged: true}};
      assertCurrent(); await RefundRepairJournal.execute(attempt, assertCurrent); assertCurrent();
      setDraft(old => old?.key === choiceKey && old.requestId === current.requestId ? null : old); setVerified(null);
      setNotice({key, text: 'L’intention exacte est conservée. Consultez son reçu natif et son résultat financier dans le suivi personnel ; l’enregistrement seul ne confirme aucun argent reçu.'});
      void client.invalidateQueries({queryKey: ['refund-repair-own', uid]}); void journal.refetch(); void query.refetch(); onRecorded();
    } catch (error) {if (frame.isCurrent(op) && interaction.current === epoch && live.current.key === choiceKey) {setDraft(old => old?.requestId === current.requestId ? {...old, examined: false, accepted: false} : old); setNotice({key, text: error instanceof Error ? `${error.message} Si l’envoi a été engagé, le même tuple reste dans votre suivi ; ne créez aucune nouvelle référence.` : 'Le résultat est inconnu. Relisez le même tuple dans votre suivi personnel.'}); void client.invalidateQueries({queryKey: ['refund-repair-own', uid]}); void journal.refetch();}}
    finally {frame.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  type NativeVerification = {selectionKey: string; nativeKey: string; intentId: string; action: RefundRepairAction; sourceHash: string; sourceRevision: string | null; owner: typeof auth.currentUser; epoch: number; operation: ReturnType<typeof native.capture>; verified: boolean};
  const verification = useRef<NativeVerification | null>(null);
  const startVerification = () => {
    if (!source || !selected.intentId || !selected.action || verification.current) return;
    const operation = native.capture(); verification.current = {selectionKey, nativeKey, intentId: selected.intentId, action: selected.action, sourceHash: source.sourceHash,
      sourceRevision: source.sourceRevision, owner: auth.currentUser, epoch: interaction.current, operation, verified: false}; setVerified(null); setDraft(null);
  };
  const assertVerification = (lease: NativeVerification) => {native.assertCurrent(lease.operation);
    if (verification.current !== lease || live.current.nativeKey !== lease.nativeKey || live.current.selectionKey !== lease.selectionKey || auth.currentUser !== lease.owner || interaction.current !== lease.epoch) throw new Error('La connexion ou le choix a changé.');
  };
  const finishVerification = () => {const lease = verification.current; if (!lease) return; lease.verified = true;
    void (async () => {try {
      await new Promise<void>((resolve, reject) => {const check = () => {try {assertVerification(lease); if (AppState.currentState === 'active' && live.current.frame.focused) resolve(); else setTimeout(check, 50);} catch (error) {reject(error);}}; check();});
      const active = live.current.frame, op = active.capture(), current = () => {assertVerification(lease); active.assertCurrent(op);}; current();
      const preview = await RefundRepairService.preview(uid, transactionId, lease.intentId, lease.action, current); current();
      if (preview.source.sourceHash !== lease.sourceHash || preview.source.sourceRevision !== lease.sourceRevision) throw new Error('Les sources ont changé pendant la confirmation.');
      await query.refetch(); current(); setVerified({selectionKey: lease.selectionKey, sourceHash: preview.source.sourceHash, sourceRevision: preview.source.sourceRevision, activityRevision: active.focusRevision, owner: lease.owner});
    } catch {try {assertVerification(lease); setVerified(null); setNotice({key: JSON.stringify([uid, transactionId, getAuthSessionGeneration(), live.current.frame.focusRevision]), text: 'Relisez les sources actuelles avant une nouvelle confirmation. Aucune réparation n’a été envoyée.'});} catch { /* Old provider callbacks remain inert. */ }}
    finally {if (verification.current === lease) verification.current = null;}})();
  };
  const endVerification = () => {const lease = verification.current; if (lease && !lease.verified) verification.current = null;};
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Examiner la restitution restante</Text>
    <Text style={styles.caption}>Choisissez une allocation native puis une seule issue. Les crédits de solde, débits vendeur et réservations déjà enregistrés ne seront pas répétés. Les autres obligations restent distinctes.</Text>
    <Text style={styles.caption}>Les anciennes instructions externes restent documentaires. Le virement bancaire manuel possède ci-dessous son propre parcours de preuves et d’attestation ; aucun paiement n’est exécuté dans l’application.</Text>
    <Button variant="secondary" disabled={!frame.focused || busy === key || query.isFetching} onPress={() => {try {frame.capture(); interaction.current++; setDraft(null); setVerified(null); setNotice(null); void query.refetch(); void journal.refetch();} catch { /* Fresh activity only. */ }}}>Relire les références natives de cette commande</Button>
    {query.isError ? <Text accessibilityRole="alert" style={styles.caption}>La source opérateur n’est pas qualifiée. Aucune réparation nouvelle n’est admise ; vos intentions propres restent consultables ci-dessous.</Text> : null}
    {observation ? <>
      {observation.candidates.map(c => <Button key={c.refundIntentId} variant="secondary" disabled={busy === key || c.qualification !== 'native_allocation_reference'} onPress={() => change({intentId: c.refundIntentId, action: null})}>{c.historical ? 'Allocation historique' : 'Allocation courante'} · {c.refundIntentId}</Button>)}
      {observation.cursor ? <Button variant="secondary" disabled={busy === key} onPress={() => change({cursor: observation.cursor, intentId: null, action: null})}>Allocations suivantes</Button> : null}
      {selected.cursor ? <Button variant="ghost" disabled={busy === key} onPress={() => change({cursor: null, intentId: null, action: null})}>Première page des allocations</Button> : null}
      {source ? <><RefundRepairSummary source={source} />
        {blocked ? <Text style={styles.caption}>Un suivi propre doit être qualifié ou terminé avant une nouvelle instruction sur cette obligation. Consultez le journal ci-dessous.</Text> : null}
        <Button variant="secondary" disabled={busy === key || blocked} onPress={() => change({action: 'repair_original_method'})}>Examiner la réparation sur le moyen initial uniquement</Button>
        <Button variant="secondary" disabled={busy === key || blocked} onPress={() => change({action: 'record_external_instruction'})}>Documenter une instruction externe sans paiement</Button>
        {selected.action ? <><Text style={styles.body}>Choix : {selected.action === 'repair_original_method' ? 'moyen initial, si le serveur qualifie sa faisabilité actuelle' : 'instruction documentaire, sans attestation de paiement'}.</Text>
          <Button disabled={busy === key || blocked || !verificationCurrent} onPress={() => {void prepare();}}>Qualifier un aperçu actuel de ce seul choix</Button></> : null}
      </> : observation.reason ? <Text style={styles.caption}>L’allocation sélectionnée ne peut pas être qualifiée ; aucune hypothèse de montant ou de reprise n’est admise.</Text> : null}
    </> : null}
    {native.focused && selected.intentId && selected.action ? <AdminFinancialReauthentication uid={uid} sourceKey={selectionKey} purpose="account_review" disabled={busy === key || blocked}
      onChallengeStart={startVerification} onChallengeEnd={endVerification} onVerified={finishVerification} /> : null}
    {current ? <><RefundRepairSummary source={current.preview.source} />
      <Text style={styles.caption}>{current.preview.action === 'record_external_instruction' ? 'Le montant réservé d’origine sert uniquement à identifier l’obligation documentaire ; ce n’est pas un montant net certifié à payer.' : 'Le montant de cette seule portion carte et le moyen initial sont fixes. Aucune nouvelle clé aveugle ni autre rail n’est admis.'}</Text>
      <TextInput accessibilityLabel="Motivation privée de cette instruction" value={current.note} editable={busy !== key} multiline maxLength={2000} placeholder="Motivation privée obligatoire" placeholderTextColor={colors.muted} style={styles.input} onChangeText={note => edit({note, examined: false, accepted: false})} />
      <TextInput accessibilityLabel="Message communicable aux parties" value={current.partyMessage} editable={busy !== key} multiline maxLength={2000} placeholder="Message communicable obligatoire, sans coordonnées bancaires" placeholderTextColor={colors.muted} style={styles.input} onChangeText={partyMessage => edit({partyMessage, examined: false, accepted: false})} />
      <Checkbox checked={current.examined} disabled={busy === key || !current.note.trim() || !current.partyMessage.trim()} onToggle={() => edit({examined: !current.examined, accepted: false})}><Text style={styles.caption}>J’ai examiné l’allocation, l’obligation, les mouvements locaux et la faisabilité actuelle de ce seul choix. Les autres obligations et l’arrivée bancaire restent distinctes.</Text></Checkbox>
      <Checkbox checked={current.accepted} disabled={busy === key || !current.examined || !verificationCurrent} onToggle={() => edit({accepted: !current.accepted})}><Text style={styles.caption}>{current.preview.action === 'repair_original_method' ? 'Je confirme cette unique instruction de réparation sur le moyen initial, sans répéter les mouvements locaux.' : 'Je confirme uniquement une instruction documentaire. Le canal externe n’est pas défini ; aucun paiement ni fonds reçus n’est attesté.'}</Text></Checkbox>
      <Button disabled={busy === key || !current.accepted || !current.examined || !verificationCurrent} onPress={() => {void submit();}}>{current.preview.action === 'repair_original_method' ? 'Enregistrer cette réparation sur le moyen initial' : 'Enregistrer cette seule instruction documentaire'}</Button>
      <Button variant="ghost" disabled={busy === key} onPress={() => {try {frame.capture(); interaction.current++; setDraft(old => old?.requestId === current.requestId ? null : old);} catch { /* Keep an engaged journal even when the form is closed. */ }}}>Fermer cet aperçu</Button>
    </> : null}
    {notice?.key === key && frame.focused ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    {native.focused && manualAnchor?.key === nativeKey && manualAnchor.owner === auth.currentUser ? <AdminRefundRepairManualPanel key={JSON.stringify([uid, transactionId, manualAnchor.intentId])} uid={uid} transactionId={transactionId} refundIntentId={manualAnchor.intentId} onRecorded={onRecorded} /> : null}
    {native.focused && manualAnchor?.key === nativeKey && manualAnchor.owner === auth.currentUser ? <AdminExceptionalRestitutionRefundEntry
      uid={uid} transactionId={transactionId} refundIntentId={manualAnchor.intentId} onRecorded={onRecorded}
      onOriginalRefundAllocation={reference => {
        try {native.capture(); frame.capture(); if (reference.transactionId !== transactionId || reference.refundIntentId !== manualAnchor.intentId) return;
          change({intentId: reference.refundIntentId, action: 'repair_original_method'});
        } catch { /* A historical corrective request cannot select a new refund. */ }
      }} /> : null}
    <AdminRefundRepairHistory uid={uid} />
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
