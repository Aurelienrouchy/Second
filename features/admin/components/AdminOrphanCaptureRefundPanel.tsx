import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { auth } from '@/config/firebaseConfig';
import { colors, spacing, typography } from '@/constants/theme';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { OrphanCaptureRefundService as Service } from '@/services/orphanCaptureRefundService';
import { OrphanCaptureRefundJournal as Journal } from '@/services/orphanCaptureRefundJournal';
import { ORPHAN_CAPTURE_REFUND_CAPABILITY, type OrphanCaptureRefundPreview as Preview,
  type OrphanCaptureRefundReference as Reference, type OrphanCaptureRefundCommand as Command } from '@/types/orphanCaptureRefund';
import { AdminFinancialReauthentication } from './AdminFinancialReauthentication';
import { AdminOrphanCaptureRefundSummary } from './AdminOrphanCaptureRefundSummary';

type Selection = {key: string; nonce: string; owner: typeof auth.currentUser; reference: Reference | null};
type Draft = {selection: Selection; activityRevision: string; preview: Preview; requestId: string; note: string; accepted: boolean};
/** The selected operation comes from a native capture or the caller's own opaque journal. */
export function AdminOrphanCaptureRefundPanel({uid, operationId, continuation, onRecorded}: {
  uid: string; operationId: string; continuation?: Reference; onRecorded: () => void;
}) {
  const native = useShippingPurchaseContext(`orphan-capture-native:${operationId}`, uid), context = useLabelLifecycleContext(`orphan-capture:${operationId}`, uid);
  const renderOwner = auth.currentUser;
  const client = useQueryClient(), generation = getAuthSessionGeneration(), key = JSON.stringify([uid, operationId, generation, native.focusRevision]);
  const queryKey = ['orphan-capture-source', key, context.focusRevision];
  const sourceQuery = useQuery({queryKey, enabled: context.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = context.capture(), owner = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== owner) throw new Error('La connexion a changé.');};
      const source = await Service.source(uid, operationId, guard); guard(); return {source, owner};}});
  const journalQuery = useQuery({queryKey: ['orphan-capture-pending', uid, key, context.focusRevision], enabled: context.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: async () => {const op = context.capture(), owner = auth.currentUser, guard = () => {context.assertCurrent(op); if (auth.currentUser !== owner) throw new Error('La connexion a changé.');};
      const refs = await Journal.pending(uid, guard); guard(); return {refs, owner};}});
  const source = context.focused && sourceQuery.isSuccess && !sourceQuery.isFetching && sourceQuery.data.owner === auth.currentUser ? sourceQuery.data.source : null;
  const journalReady = context.focused && journalQuery.isSuccess && !journalQuery.isFetching && journalQuery.data.owner === auth.currentUser;
  const saved = journalReady ? journalQuery.data.refs.find(r => r.operationId === operationId) : undefined;
  const [selection, setSelection] = useState<Selection | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const lock = useRef<symbol | null>(null), revision = useRef(0);
  type Lease = {selection: Selection; operation: ReturnType<typeof native.capture>; owner: typeof auth.currentUser; verified: boolean};
  const lease = useRef<Lease | null>(null), live = useRef({key, context, selection, source}), identity = useRef({key, owner: renderOwner});
  useLayoutEffect(() => {
    if (identity.current.key !== key || identity.current.owner !== renderOwner) {
      identity.current = {key, owner: renderOwner}; revision.current++; lease.current = null; lock.current = null;
      setSelection(null); setDraft(null); setBusy(false); setNotice(null);
    }
    live.current = {key, context, selection, source};
  }, [key, context, selection, source, renderOwner]);
  const chosen = selection?.key === key && selection.owner === auth.currentUser ? selection : null;
  const current = context.focused && chosen && draft?.selection === chosen && draft.activityRevision === context.focusRevision &&
    source && source.sourceHash === draft.preview.source.sourceHash && source.sourceRevision === draft.preview.source.sourceRevision ? draft : null;
  const refresh = () => {try {if (auth.currentUser !== renderOwner) return; context.capture();} catch {return;}
    void client.invalidateQueries({queryKey: ['orphan-capture-source']}); void client.invalidateQueries({queryKey: ['orphan-capture-pending', uid]}); void client.invalidateQueries({queryKey: ['orphan-capture-history', uid]});};
  const choose = (reference: Reference | null) => {try {if (auth.currentUser !== renderOwner) return; context.capture(); native.capture(); if (lock.current || lease.current || !journalReady || !reference && saved) return;
    if (reference && (!saved || JSON.stringify(saved) !== JSON.stringify(reference))) return;
    revision.current++; setSelection({key, nonce: randomUUID(), owner: auth.currentUser, reference}); setDraft(null); setNotice(null);
  } catch { /* A documentary selection grants no refund permission. */ }};
  const assertLease = (value: Lease) => {native.assertCurrent(value.operation); if (lease.current !== value || live.current.key !== key || live.current.selection !== value.selection || auth.currentUser !== value.owner) throw new Error('La sélection ou la connexion a changé.');};
  const challengeStart = () => {if (!chosen || chosen.owner !== auth.currentUser || renderOwner !== auth.currentUser || lock.current || lease.current) throw new Error('Sélection actuelle requise.'); context.capture();
    lease.current = {selection: chosen, operation: native.capture(), owner: auth.currentUser, verified: false}; setDraft(null);};
  const challengeVerified = () => {const value = lease.current; if (!value) return; value.verified = true;
    void (async () => {const token = Symbol(); lock.current = token; setBusy(true); try {
      await new Promise<void>((resolve, reject) => {const check = () => {try {assertLease(value); if (AppState.currentState === 'active' && live.current.context.focused) resolve(); else setTimeout(check, 50);} catch (error) {reject(error);}}; check();});
      const active = live.current.context, op = active.capture(), guard = () => {assertLease(value); active.assertCurrent(op);};
      const source = await Service.source(uid, operationId, guard); guard();
      const preview = await Service.preview(uid, operationId, guard, value.selection.reference ?? undefined); guard();
      if (source.sourceHash !== preview.source.sourceHash || source.sourceRevision !== preview.source.sourceRevision ||
        !(value.selection.reference ? preview.source.canResume : preview.source.canRefund)) throw new Error('La capture ou la reprise ne sont pas actuellement qualifiées.');
      client.setQueryData(['orphan-capture-source', key, active.focusRevision], {source, owner: value.owner}); guard();
      setDraft({selection: value.selection, activityRevision: active.focusRevision, preview, requestId: value.selection.reference?.requestId ?? randomUUID(), note: '', accepted: false});
    } catch {try {assertLease(value); setNotice({key, text: 'Aucune demande n’a été envoyée. Relisez le même suivi ; après une tentative déjà engagée, seule son observation est admise.'});} catch { /* Former challenge results remain inert. */ }}
    finally {if (lease.current === value) lease.current = null; if (lock.current === token) {lock.current = null; setBusy(false);}}})();
  };
  const challengeEnd = () => {if (lease.current && !lease.current.verified) lease.current = null;};
  const edit = (patch: Partial<Pick<Draft, 'note' | 'accepted'>>) => {if (!current || current.selection.owner !== auth.currentUser || renderOwner !== auth.currentUser || lock.current) return; try {context.capture(); revision.current++; setDraft(old => old === current ? {...old, ...patch, accepted: 'accepted' in patch ? patch.accepted! : false} : old);} catch { /* Current active form only. */ }};
  const submit = async () => {
    if (!current || current.selection.owner !== auth.currentUser || renderOwner !== auth.currentUser || !current.accepted || lock.current || !current.selection.reference && !current.note.trim()) return;
    let op; try {op = context.start();} catch {return;} if (!op) return;
    const selected = current, sdk = auth.currentUser, epoch = revision.current, token = Symbol(); lock.current = token; setBusy(true); setNotice(null);
    const guard = () => {context.assertCurrent(op); if (auth.currentUser !== sdk || selected.selection.owner !== sdk || renderOwner !== sdk || live.current.key !== key || live.current.selection !== selected.selection || revision.current !== epoch) throw new Error('Le contexte a changé.');};
    try {
      const preview = await Service.preview(uid, operationId, guard, selected.selection.reference ?? undefined); guard();
      if (preview.previewId !== selected.preview.previewId || preview.source.sourceHash !== selected.preview.source.sourceHash || preview.source.sourceRevision !== selected.preview.source.sourceRevision) throw new Error('Relisez et confirmez les nouvelles sources.');
      if (selected.selection.reference) {if (!preview.source.canResume) throw new Error('Observation seule requise.'); await Journal.resume(selected.selection.reference, preview, guard);}
      else {
        const s = preview.source; if (!s.canRefund || !s.paymentIntentId || !s.chargeId || s.refundableCents === null || s.refundableCents < 1) throw new Error('Aucun remboursement qualifié.');
        const command: Command = {operationId, previewId: preview.previewId, sourceHash: s.sourceHash, sourceRevision: s.sourceRevision, paymentIntentId: s.paymentIntentId, chargeId: s.chargeId,
          amountCents: s.refundableCents, currency: 'CAD', statementVersion: ORPHAN_CAPTURE_REFUND_CAPABILITY, acknowledged: true, note: selected.note.trim()};
        const reference = await Service.reference(uid, selected.requestId, command, guard); guard(); await Journal.execute(reference, command, guard);
      }
      guard(); setDraft(null); setSelection(null); setNotice({key, text: 'Le reçu de cette même demande est conservé dans votre suivi. Son état réel reste à consulter.'}); onRecorded();
    } catch {if (context.isCurrent(op) && auth.currentUser === sdk) {setDraft(null); setNotice({key, text: 'Relisez la référence conservée dans votre suivi. Un délai ou une erreur ne confirme aucune absence d’effet et ne déclenche pas de nouvel envoi.'});}}
    finally {context.finish(op); if (lock.current === token) {lock.current = null; setBusy(false);} if (context.isCurrent(op) && auth.currentUser === selected.selection.owner) refresh();}
  };
  if (!native.focused) return null;
  return <View style={styles.section}>
    {context.focused ? <><Text accessibilityRole="header" style={styles.title}>Rembourser une capture sans commande attribuée</Text>
      <Text style={styles.caption}>Le serveur relit l’encaissement plateforme, son attribution et tous les remboursements déjà engagés. Il impose le montant restant et le débit carte d’origine. Aucune banque, personne ou somme libre ne peut être choisie.</Text>
      {source ? <AdminOrphanCaptureRefundSummary value={source} /> : <Text style={styles.caption}>Les sources doivent être relues avec une connexion récente. La sélection du dossier ne donne aucune permission de paiement.</Text>}
      {sourceQuery.isError || journalQuery.isError ? <Text accessibilityRole="alert" style={styles.caption}>La lecture n’est pas qualifiée ; aucune permission n’est déduite de cette erreur.</Text> : null}
      <Button variant="secondary" disabled={busy || !journalReady || !!saved} onPress={() => choose(null)}>Examiner le remboursement au moyen d’origine</Button>
      {saved ? <Button variant="secondary" disabled={busy || !journalReady || !!continuation && JSON.stringify(continuation) !== JSON.stringify(saved)} onPress={() => choose(saved)}>Examiner la reprise de la réservation conservée</Button> : null}
      <Button variant="secondary" disabled={busy} onPress={() => {try {context.capture(); refresh();} catch { /* Read only. */ }}}>Relire cette capture et son suivi</Button>
    </> : null}
    {chosen ? <AdminFinancialReauthentication uid={uid} sourceKey={JSON.stringify([key, chosen.nonce])} purpose="orphan_capture" disabled={busy} onChallengeStart={challengeStart} onChallengeEnd={challengeEnd} onVerified={challengeVerified} /> : null}
    {current ? <><AdminOrphanCaptureRefundSummary value={current.preview.source} />
      {current.selection.reference ? <Text style={styles.caption}>Cette reprise conserve exactement le même opérateur, la même demande et son empreinte. Elle n’est possible qu’avant tout témoin de tentative ; sinon le serveur reste en observation seule.</Text> :
        <TextInput accessibilityLabel="Motivation privée du remboursement de capture" value={current.note} editable={!busy} multiline maxLength={2000} style={styles.input} placeholder="Motivation, sans coordonnées bancaires" onChangeText={note => edit({note})} />}
      <Checkbox checked={current.accepted} disabled={busy || !current.selection.reference && !current.note.trim()} onToggle={() => edit({accepted: !current.accepted})}>
        <Text style={styles.caption}>Je confirme le remboursement du seul montant natif affiché vers le moyen de paiement d’origine, sans création de commande, mouvement de portefeuille ou modification du stock.</Text>
      </Checkbox>
      <Button disabled={busy || !current.accepted || !(current.selection.reference ? current.preview.source.canResume : current.preview.source.canRefund)} onPress={() => {void submit();}}>{current.selection.reference ? 'Reprendre cette seule réservation avant tentative' : 'Demander ce remboursement d’origine exact'}</Button>
    </> : null}
    {notice?.key === key && context.focused ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
