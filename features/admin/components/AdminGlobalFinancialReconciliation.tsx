import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Button, Input} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {newSupportRequestId} from '@/services/supportRequestService';
import {GlobalFinancialReconciliationJournal as Journal} from '@/services/globalFinancialReconciliationJournal';
import {GlobalFinancialReconciliationService as Service, isGlobalFinancialPageReference, isGlobalFinancialRunReference} from '@/services/globalFinancialReconciliationService';
import type {GlobalFinancialAction, GlobalFinancialPage, GlobalFinancialPageReference, GlobalFinancialResponse, GlobalFinancialScope} from '@/types/globalFinancialReconciliation';
import {colors, spacing, typography} from '@/constants/theme';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
import {AdminGlobalFinancialScopeForm} from './AdminGlobalFinancialScopeForm';
import {AdminGlobalFinancialReportView} from './AdminGlobalFinancialReportView';

export function AdminGlobalFinancialReconciliation({uid}: {uid: string}) {
  const client = useQueryClient(), frame = useLabelLifecycleContext('global-financial-reconciliation', uid), lock = useRef(false), access = useRef(0);
  const [revision, setRevision] = useState(0), [authenticated, setAuthenticated] = useState<string | null>(null);
  const frameKey = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision]), binding = JSON.stringify([frameKey, revision]);
  const allowed = frame.focused && authenticated === binding;
  const ownKey = ['global-financial-journal', uid, frameKey] as const;
  const own = useQuery({queryKey: ownKey, enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, () => frame.assertCurrent(op));}});
  const stored = frame.focused && own.isSuccess && !own.isFetching && !own.isError ? own.data : null;
  const sourceKey = JSON.stringify([binding, stored]);
  const reportKey = ['global-financial-report', sourceKey] as const;
  const reportQuery = useQuery({queryKey: reportKey, enabled: allowed && !!stored, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {if (!stored) throw new Error('Relisez votre référence conservée.'); const op = frame.capture(), selectedAccess = access.current;
      return Service.observe(uid, stored.runReference, () => {frame.assertCurrent(op); if (selectedAccess !== access.current) throw new Error('L’accès privé a changé.');}, stored);}});
  const [working, setWorking] = useState<string | null>(null), busy = working === binding;
  const [feedback, setFeedback] = useState<{key: string; text: string} | null>(null), [receiptState, setReceipt] = useState<{key: string; value: GlobalFinancialResponse} | null>(null);
  const [pageState, setPage] = useState<{key: string; value: GlobalFinancialPage} | null>(null);
  const [runId, setRunId] = useState(''), [scopeHash, setScopeHash] = useState(''), [pageId, setPageId] = useState(''), [pageHash, setPageHash] = useState('');
  const fresh = allowed && !busy && reportQuery.isSuccess && !reportQuery.isFetching && !reportQuery.isError ? reportQuery.data : null;
  const body = fresh?.reportView?.opaque === false ? fresh.reportView : null;
  const receipt = stored?.pending ? (receiptState?.key === sourceKey ? receiptState.value : fresh)?.commandReceipt ?? null : null;
  const terminal = receipt?.status === 'completed' || receipt?.status === 'not_executed';
  const pageKey = JSON.stringify([sourceKey, body?.version]), page = pageState?.key === pageKey ? pageState.value : null;
  const currentFrame = () => {const op = frame.capture(), selectedAccess = access.current; return () => {frame.assertCurrent(op); if (selectedAccess !== access.current) throw new Error('L’accès privé a changé.');};};
  const currentSource = (privateReport = false, extra: () => void = () => {}) => {
    const current = currentFrame(), ownData = own.data, reportData = reportQuery.data;
    return () => {current(); extra(); const q = client.getQueryState(ownKey);
      if (!q || q.status !== 'success' || q.fetchStatus !== 'idle' || q.isInvalidated || client.getQueryData(ownKey) !== ownData) throw new Error('Relisez le suivi propriétaire.');
      if (privateReport) {const r = client.getQueryState(reportKey); if (!allowed || !body || !r || r.status !== 'success' || r.fetchStatus !== 'idle' || r.isInvalidated || client.getQueryData(reportKey) !== reportData) throw new Error('Relisez la version privée actuelle.');}
    };
  };
  const refresh = () => {
    try {frame.capture(); if (lock.current) return; access.current++; setRevision(access.current); setAuthenticated(null); setPage(null); setReceipt(null); setFeedback(null);
      void client.invalidateQueries({queryKey: ['global-financial-journal', uid]});
    } catch {/* A replaced owner cannot refresh this private frame. */}
  };
  const capturePoint = async (draftGuard: () => void, precision?: 'minute') => {
    if (lock.current || !allowed || stored?.pending) throw new Error('Relisez l’accès privé avant de choisir un point natif.');
    const guard = currentSource(false, draftGuard); guard();
    const op = frame.start(); if (!op) throw new Error('Une lecture est déjà en cours.');
    const selectedAccess = access.current, current = () => {frame.assertCurrent(op); if (selectedAccess !== access.current) throw new Error('L’accès privé a changé.'); guard();};
    lock.current = true; setWorking(binding); setFeedback(null);
    try {const value = await Service.capturePoint(uid, current, precision); current(); return {point: value.nativeCapture, assertCurrent: current, ...(value.precision ? {precision: value.precision} : {})};}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op) && selectedAccess === access.current) setWorking(null);}
  };
  const perform = async (mode: 'observe' | 'resume' | 'acknowledge' | GlobalFinancialAction, scope: GlobalFinancialScope | null = null, draftGuard: () => void = () => {}) => {
    if (lock.current) return; let op, guard: () => void;
    try {guard = currentSource(mode === 'advance' || mode === 'seal', draftGuard); guard(); op = frame.start();} catch {return;} if (!op) return;
    const selectedAccess = access.current, current = () => {frame.assertCurrent(op); if (selectedAccess !== access.current) throw new Error('L’accès privé a changé.');};
    lock.current = true; setWorking(binding); setPage(null); setReceipt(null); setFeedback(null);
    try {
      let result: GlobalFinancialResponse;
      if (mode === 'observe' || mode === 'resume' || mode === 'acknowledge') {
        if (!stored?.pending) throw new Error('Aucune commande conservée à rapprocher.');
        if (mode === 'resume' && !allowed) throw new Error('Confirmez votre identité avant de reprendre cette commande.');
        result = mode === 'observe' ? await Journal.observe(stored, current) : mode === 'acknowledge' ? await Journal.acknowledge(stored, current) : await Journal.resume(stored, scope, current, guard);
      } else {
        if (!allowed || stored?.pending || own.data === undefined || mode !== 'prepare' && !body) throw new Error('Relisez l’accès privé et acquittez le reçu conservé.');
        const state = await Service.attempt(uid, newSupportRequestId(), mode, mode === 'prepare' ? null : stored!.runReference, mode === 'prepare' ? 0 : body!.version, scope, guard); current(); guard();
        result = await Journal.submit(state, scope, current, guard);
      }
      current(); setReceipt({key: sourceKey, value: result});
      setFeedback({key: binding, text: result.commandReceipt && ['completed', 'not_executed'].includes(result.commandReceipt.status) ? 'Reçu documentaire terminal observé. Relisez-le et acquittez le suivi avant une autre commande.' : 'Issue inconnue ou commande en cours. Conservez cette référence et reprenez la même commande ; aucune page suivante n’est lancée automatiquement.'});
      await client.invalidateQueries({queryKey: ['global-financial-journal', uid]}); current();
      await client.invalidateQueries({queryKey: ['global-financial-report']}); current();
    } catch (error) {
      try {current(); setAuthenticated(null); setPage(null); setReceipt(null); setFeedback({key: binding, text: error instanceof Error ? error.message : 'Issue à rapprocher : la référence et la commande sont conservées.'});
        await client.invalidateQueries({queryKey: ['global-financial-journal', uid]});
      } catch {/* A replacement session receives no previous private projection. */}
    } finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op) && selectedAccess === access.current) setWorking(null);}
  };
  const select = async () => {
    if (lock.current || !allowed || stored?.pending) return;
    const ref = {runId: runId.trim(), scopeHash: scopeHash.trim()}; if (!isGlobalFinancialRunReference(ref)) {setFeedback({key: binding, text: 'Fournissez la référence gfr_… et son empreinte de portée exactes.'}); return;}
    let op; try {op = frame.start();} catch {return;} if (!op) return;
    const selectedAccess = access.current, current = () => {frame.assertCurrent(op); if (selectedAccess !== access.current) throw new Error('L’accès privé a changé.');};
    lock.current = true; setWorking(binding); setPage(null); setReceipt(null);
    try {await Journal.select({version: 1, uid, runReference: ref, pending: null}, current); current(); await client.invalidateQueries({queryKey: ['global-financial-journal', uid]}); current();}
    catch (error) {try {current(); setAuthenticated(null); setFeedback({key: binding, text: error instanceof Error ? error.message : 'Référence non qualifiée.'});} catch {/* No stale projection. */}}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op) && selectedAccess === access.current) setWorking(null);}
  };
  const readPage = async (reference: GlobalFinancialPageReference) => {
    if (!stored || !body || lock.current) return; let current: () => void, frameCurrent: () => void;
    try {current = currentSource(true); frameCurrent = currentFrame(); current();} catch {return;}
    lock.current = true; setWorking(binding); setPage(null);
    try {const value = await Service.page(uid, stored.runReference, reference, current); current();
      if (value.reportView?.opaque === false && value.pageView) {client.setQueryData(reportKey, value); setPage({key: JSON.stringify([sourceKey, value.reportView.version]), value: value.pageView});}
      else {setAuthenticated(null); setFeedback({key: binding, text: 'Seul l’en-tête opaque reste accessible ; aucune page privée n’est affichée.'});}
    } catch (error) {try {current(); setAuthenticated(null); setFeedback({key: binding, text: error instanceof Error ? error.message : 'Page non qualifiée.'});} catch {/* No previous private page after focus loss. */}}
    finally {lock.current = false; try {frameCurrent(); setWorking(null);} catch {/* Another SDK frame owns its own busy state. */}}
  };
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Rapprochement global — rapport documentaire</Text>
    <Text style={styles.caption}>Sources natives et mouvements prestataire observés séparément, une page bornée par action. Aucun crédit, remboursement, transfert, levée de retenue ou réouverture financière n’est proposé.</Text>
    <AdminFinancialReauthentication uid={uid} sourceKey={`global-financial:${binding}`} purpose="commercial" parcel disabled={busy || !frame.focused} onVerified={() => {
      try {frame.capture(); access.current++; setRevision(access.current); setAuthenticated(JSON.stringify([frameKey, access.current])); setPage(null); setReceipt(null); setFeedback(null);} catch {/* Fresh SDK owner only. */}
    }}/>
    <Button variant="secondary" disabled={busy || !frame.focused} onPress={refresh}>Masquer les projections et relire mon suivi</Button>
    {own.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le suivi local ne peut pas être qualifié. Aucune nouvelle commande n’est proposée.</Text> : null}
    {stored ? <>
      <Text selectable style={styles.caption}>Référence conservée : {stored.runReference.runId}{'\n'}{stored.runReference.scopeHash}</Text>
      {stored.pending ? <View style={styles.section}>
        <Text selectable style={styles.body}>Commande {stored.pending.action} · {stored.pending.requestId} · version source {stored.pending.expectedVersion}</Text>
        <Text style={styles.caption}>Le suivi ne contient ni rapport privé ni coordonnées bancaires. Sa lecture reste accessible avec le même compte SDK après perte du rôle opérateur.</Text>
        <Button variant="secondary" disabled={busy || !frame.focused} onPress={() => {void perform('observe');}}>Observer le reçu exact conservé</Button>
        {receipt ? <Text style={styles.caption}>Reçu : {receipt.status === 'completed' ? 'terminal documentaire' : receipt.status === 'not_executed' ? 'non exécuté selon la disposition native' : receipt.status === 'pending' ? 'en cours' : 'issue inconnue'} · versions {receipt.versionBefore} → {receipt.versionAfter}. Aucun mouvement financier autorisé.</Text> : null}
        {receipt?.disposition ? <Text selectable style={styles.caption}>Disposition native : {receipt.disposition.reason} · version observée {receipt.disposition.observedVersion}.</Text> : null}
        {stored.pending.action !== 'prepare' ? <Button variant="secondary" disabled={busy || !allowed || terminal} onPress={() => {void perform('resume');}}>Reprendre cette même commande bornée</Button> : null}
        {stored.pending.action === 'prepare' && body && !terminal ? <Button variant="secondary" disabled={busy || !allowed} onPress={() => {void perform('resume', body.scope);}}>Reprendre la création avec sa portée native exacte</Button> : null}
        {terminal ? <Button variant="secondary" disabled={busy || !frame.focused} onPress={() => {void perform('acknowledge');}}>Relire le reçu terminal et acquitter le suivi</Button> : null}
      </View> : null}
    </> : null}
    {!allowed ? <Text style={styles.caption}>Confirmez votre identité pour lire une portée ou reprendre un rapport privé. Le serveur vérifiera votre habilitation actuelle ; vos propres reçus opaques restent distincts.</Text> : null}
    {reportQuery.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le corps privé n’est plus qualifié. Relisez votre habilitation et le reçu propre ; aucune ancienne projection n’est affichée.</Text> : null}
    {fresh?.reportView?.opaque === true ? <Text style={styles.caption}>En-tête opaque uniquement. L’accès au périmètre, aux groupes et aux pages privées n’est pas accordé.</Text> : null}
    {body ? <>
      <AdminGlobalFinancialReportView key={JSON.stringify([sourceKey, body.version])} report={body} page={page}/>
      {!stored?.pending && body.state !== 'sealed' ? <>
        {body.controlBalance ? <Text style={styles.caption}>Le contrôle de balance suit ce même rapport et ces mêmes commandes bornées. Même équilibré, il n’autorise aucun mouvement financier ni une réouverture.</Text> : null}
        <Button disabled={busy || body.state === 'budget_exhausted' || body.nextPhase === 'ready'} onPress={() => {void perform('advance');}}>Avancer d’une seule page</Button>
        <Button variant="secondary" disabled={busy} onPress={() => {void perform('seal');}}>Sceller ce rapport avec ses limites et inconnus</Button>
        <Text style={styles.caption}>Le scellement termine le parcours documentaire. Une couverture incomplète reste visible et ne devient jamais un solde global réconcilié.</Text>
      </> : null}
      {body.state === 'budget_exhausted' ? <Text style={styles.caption}>Ce rapport a atteint ses limites et reste historique. Un parcours complet des sources connues exige un nouveau rapport choisi explicitement, avec sa propre portée et un nouveau point ; aucune ancienne intention n’est enrichie ou rouverte.</Text> : null}
      {body.lastPageReference ? <Button variant="secondary" disabled={busy} onPress={() => {void readPage(body.lastPageReference!);}}>Lire la dernière page native</Button> : null}
      <Input label="Autre page native — page_…" value={pageId} onChangeText={setPageId} maxLength={body.scope.coverageMode ? 21 : 13} autoCapitalize="none" disabled={busy}/>
      <Input label="Empreinte exacte de cette page" value={pageHash} onChangeText={setPageHash} maxLength={64} autoCapitalize="none" disabled={busy}/>
      <Button variant="secondary" disabled={busy || !isGlobalFinancialPageReference({id: pageId.trim(), contentHash: pageHash.trim()}, body.scope.coverageMode === 'complete_known_sources_v1')} onPress={() => {void readPage({id: pageId.trim(), contentHash: pageHash.trim()});}}>Lire cette page historique exacte</Button>
    </> : null}
    {allowed && own.isSuccess && !own.isFetching && !own.isError ? <>
      {!stored?.pending || stored.pending.action === 'prepare' && !body && !terminal ? <AdminGlobalFinancialScopeForm key={sourceKey} disabled={busy} resumingCreation={stored?.pending?.action === 'prepare'} onCapturePoint={capturePoint} onSubmit={(scope, guard) => {void perform(stored?.pending ? 'resume' : 'prepare', scope, guard);}}/> : null}
      {!stored?.pending ? <>
        <Input label="Rapport existant gfr_…" value={runId} onChangeText={setRunId} maxLength={68} autoCapitalize="none" disabled={busy}/>
        <Input label="Empreinte exacte de sa portée" value={scopeHash} onChangeText={setScopeHash} maxLength={64} autoCapitalize="none" disabled={busy}/>
        <Button variant="secondary" disabled={busy} onPress={() => {void select();}}>Reprendre cette référence enregistrée</Button>
      </> : null}
    </> : null}
    {feedback?.key === binding ? <Text accessibilityRole="alert" style={styles.caption}>{feedback.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
