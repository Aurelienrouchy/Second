import {useRef, useState} from 'react';
import {Alert, StyleSheet, Text, View} from 'react-native';
import {useInfiniteQuery, useQuery, useQueryClient} from '@tanstack/react-query';
import {AuthorityLegalReviewPanel} from '@/components/AuthorityLegalReviewPanel';
import {Button, Input} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {AuthorityRequestService as Service, isAuthorityCommand} from '@/services/authorityRequestService';
import {AuthorityRequestJournal as Journal} from '@/services/authorityRequestJournal';
import {newSupportRequestId} from '@/services/supportRequestService';
import {productReviewEqual} from '@/services/productReviewService';
import type {AuthorityCommand, AuthorityPackage, AuthorityPackageReference, AuthorityPreview} from '@/types/authorityRequest';
import {colors, spacing, typography} from '@/constants/theme';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
import {AdminAuthorityReceptionForm} from './AdminAuthorityReceptionForm';
import {AdminAuthorityReviewForm} from './AdminAuthorityReviewForm';
import {AdminAuthorityScopeForm} from './AdminAuthorityScopeForm';
import {AdminAuthorityPackageView} from './AdminAuthorityPackageView';

const stages: Record<string, string> = {received: 'Réception enregistrée', review_recorded: 'Examens consignés', details_requested: 'Précisions à obtenir', refused: 'Refus documentaire consigné', scope_recorded: 'Portée enregistrée', package_prepared: 'Préparation documentaire enregistrée', unknown: 'État inconnu'};
export function AdminAuthorityRequestPanel({uid}: {uid: string}) {
  const [selected, setSelected] = useState<string | null>(null), [authenticated, setAuthenticated] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [busy, setBusy] = useState(false), [refreshRevision, setRefreshRevision] = useState(0);
  const frame = useLabelLifecycleContext(`authority-private:${selected}:${refreshRevision}`, uid), client = useQueryClient(), lock = useRef(false), choice = useRef(0);
  const frameKey = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision, selected, refreshRevision]), nativeAuthKey = JSON.stringify([uid, getAuthSessionGeneration(), selected, refreshRevision]), allowed = frame.focused && authenticated === nativeAuthKey;
  const [stateKey, setStateKey] = useState(frameKey), [reason, setReason] = useState(''), [previewState, setPreviewState] = useState<{key: string; value: AuthorityPreview} | null>(null), [packageState, setPackageState] = useState<{key: string; value: AuthorityPackage | null} | null>(null);
  if (stateKey !== frameKey) {setStateKey(frameKey); setReason(''); setNotice(null); setBusy(false); setPreviewState(null); setPackageState(null);}
  const listKey = ['authority-private-list', frameKey] as const, detailKey = ['authority-private-detail', frameKey] as const;
  const list = useInfiniteQuery({queryKey: listKey, enabled: allowed, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false, initialPageParam: null as string | null,
    queryFn: ({pageParam}) => {const op = frame.capture(); return Service.list(uid, pageParam, () => frame.assertCurrent(op));}, getNextPageParam: last => last.cursor ?? undefined});
  const detail = useInfiniteQuery({queryKey: detailKey, enabled: allowed && !!selected, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false, initialPageParam: null as string | null,
    queryFn: ({pageParam}) => {const op = frame.capture(); return Service.detail(uid, selected!, pageParam, () => frame.assertCurrent(op));}, getNextPageParam: last => last.eventsCursor ?? undefined});
  const own = useQuery({queryKey: ['authority-own-journal', uid, getAuthSessionGeneration(), frame.focusRevision], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, () => frame.assertCurrent(op));}});
  const request = allowed && selected && detail.isSuccess && !detail.isFetching && !detail.isError && detail.data.pages.every(page => productReviewEqual(page.case.source, detail.data.pages[0].case.source)) ? detail.data.pages[0].case : null;
  const sourceKey = JSON.stringify([frameKey, request?.id, request?.source]), preview = previewState?.key === sourceKey ? previewState.value : null, storedPackage = packageState?.key === sourceKey ? packageState.value : null;
  const activeNew = allowed && !busy && own.isSuccess && !own.isFetching && own.data === null && (!selected || !!request);
  const choose = (id: string | null) => {try {frame.capture(); choice.current++; setSelected(id); setAuthenticated(null);} catch {/* Only current selected frame. */}};
  const capture = (draftGuard: () => void = () => {}, newInstruction = false) => {
    const operation = frame.capture(), revision = choice.current, selectedSource = request?.source, selectedDetail = detail.data;
    return () => {
      frame.assertCurrent(operation); if (choice.current !== revision) throw new Error('La sélection a changé.'); draftGuard();
      const detailState = client.getQueryState(detailKey);
      if (selected && (client.getQueryData(detailKey) !== selectedDetail || !selectedSource || detailState?.status !== 'success' || detailState.fetchStatus !== 'idle' || detailState.isInvalidated)) throw new Error('Relisez la source actuelle.');
      if (newInstruction) {
        const ownKey = ['authority-own-journal', uid, getAuthSessionGeneration(), frame.focusRevision], ownState = client.getQueryState(ownKey);
        if (ownState?.status !== 'success' || ownState.fetchStatus !== 'idle' || ownState.isInvalidated || client.getQueryData(ownKey) !== null) throw new Error('Rapprochez le suivi actuel avant une nouvelle instruction.');
      }
    };
  };
  const perform = async (command: AuthorityCommand, guard: () => void) => {
    if (lock.current) return; let op; try {guard(); op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(true); setNotice(null); const current = () => frame.assertCurrent(op); let rpcAttempted = false;
    try {
      current(); guard(); if (!activeNew) throw new Error('Relisez le suivi conservé et confirmez votre identité actuelle.');
      const rid = newSupportRequestId(), attempt = await Service.attempt(uid, rid, command, guard); current(); guard();
      const receipt = await Journal.submit(attempt, command, current, guard, () => {rpcAttempted = true;}); current();
      setNotice(receipt.state === 'committed' ? 'Instruction privée enregistrée. Acquittez son reçu dans votre suivi avant une nouvelle instruction.' : 'Instruction non exécutée ou à rapprocher dans votre suivi privé.');
      setPreviewState(null); setPackageState(null); setAuthenticated(null);
      await client.invalidateQueries({queryKey: ['authority-own-journal', uid]}); current();
    } catch (error) {try {current(); setNotice(error instanceof Error ? error.message : 'L’issue doit être rapprochée dans votre suivi privé.'); if (rpcAttempted) setAuthenticated(null);} catch {/* No late private alert. */}}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) setBusy(false); void client.invalidateQueries({queryKey: ['authority-own-journal', uid]});}
  };
  const confirm = (command: AuthorityCommand, draftGuard: () => void) => {
    try {const current = capture(draftGuard, true); current(); if (!activeNew) return;
      if (!isAuthorityCommand(command)) {setNotice('Vérifiez les champs obligatoires et leurs limites, les références distinctes et les dates UTC exactes. Pour une réception : 2026-10-17T14:00:00.000Z, sans date future ; pour une période : deux bornes cohérentes. Chaque examen déclaré effectué nécessite une motivation et une référence. Votre saisie est conservée.'); return;}
      Alert.alert('Enregistrer cette instruction privée ?', 'La réception et les examens restent déclaratifs. Aucun renseignement ne sera envoyé à un tiers. Le suivi sera conservé avant l’enregistrement.', [{text: 'Annuler', style: 'cancel'}, {text: 'Enregistrer', onPress: () => {try {current(); void perform(command, current);} catch {/* Changed form, source or session. */}}}]);
    } catch {/* No confirmation for stale sources. */}
  };
  const read = async (mode: 'preview' | 'package', reference?: AuthorityPackageReference) => {
    if (!request || lock.current) return; let current: () => void, operation; try {operation = frame.capture(); current = capture(); current();} catch {return;}
    lock.current = true; setBusy(true); setNotice(null);
    try {if (mode === 'preview') {const value = await Service.preview(uid, request.id, request.source, current); current(); setPreviewState({key: sourceKey, value});} else if (reference) {const value = await Service.package(uid, request.id, reference, current); current(); setPackageState({key: sourceKey, value}); if (!value) setNotice('La préparation historique ne peut pas être qualifiée.');}}
    catch (error) {try {current(); setPreviewState(null); setPackageState(null); setNotice(error instanceof Error ? error.message : 'La lecture doit être reprise.');} catch {/* No stale private result. */}}
    finally {lock.current = false; try {frame.assertCurrent(operation); setBusy(false);} catch {/* An old SDK/focus frame never resets a replacement operation. */}}
  };
  const mutateReason = (value: string) => {choice.current++; setReason(value);};
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Demandes externes et autorités — dossier privé</Text>
    <Text style={styles.caption}>Ce parcours documente une demande reçue, son examen et une préparation limitée. Il ne vérifie pas automatiquement un pouvoir légal et n’autorise aucune communication. Aucun membre visé n’est averti par ces actions.</Text>
    <AdminFinancialReauthentication uid={uid} sourceKey={`authority:${nativeAuthKey}`} purpose="legal_review" parcel disabled={busy} onVerified={() => {setAuthenticated(nativeAuthKey);}}/>
    {!allowed ? <Text style={styles.caption}>Confirmez votre identité pour lire les dossiers privés. Le serveur vérifiera encore votre habilitation actuelle.</Text> : <>
      <Button variant="secondary" disabled={busy} onPress={() => {try {frame.capture(); choice.current++; setRefreshRevision(v => v + 1); setAuthenticated(null);} catch {/* No stale refresh. */}}}>Relire la file et renouveler l’accès</Button>
      {selected ? <Button variant="secondary" disabled={busy} onPress={() => choose(null)}>Revenir à la file privée</Button> : null}
      {own.isError || own.data ? <Text style={styles.caption}>Rapprochez et acquittez votre suivi privé avant toute nouvelle instruction. Les lectures de dossiers restent distinctes.</Text> : null}
      {!selected && list.isSuccess && !list.isFetching && !list.isError ? <>{list.data.pages.flatMap(page => page.items).map(item => <Button key={item.id} variant="secondary" disabled={busy} onPress={() => choose(item.id)}>{item.reception.externalReference} · {stages[item.stage]} · {item.receivedAt}</Button>)}
        <Text style={styles.caption}>Chaque page parcourt vingt références au maximum. Une page vide peut masquer d’autres types de dossiers ou des sources inconnues ; elle ne prouve pas l’absence de demandes.</Text>
        {list.hasNextPage ? <Button variant="secondary" disabled={busy || list.isFetchingNextPage} onPress={() => {try {frame.capture(); void list.fetchNextPage();} catch {/* Current private list. */}}}>Parcourir les références suivantes</Button> : null}
        <AdminAuthorityReceptionForm key={frameKey} disabled={!activeNew} onSubmit={confirm}/>
      </> : null}
      {list.isError || detail.isError ? <Text accessibilityRole="alert" style={styles.caption}>La file ou le dossier privé doit être relu avec une habilitation actuelle.</Text> : null}
      {request ? <View style={styles.section}><Text selectable style={styles.title}>{request.reception.externalReference} · {stages[request.stage]}</Text>
        <Text selectable style={styles.body}>{request.reception.requester.name} · {request.reception.requester.organization} · {request.reception.requester.capacity}</Text><Text selectable style={styles.body}>{request.reception.requester.contact}</Text><Text selectable style={styles.body}>{request.reception.summary}</Text>
        <Text style={styles.caption}>Réception déclarée : {request.reception.externallyReceivedAt ?? 'inconnue'} · réception interne : {request.receivedAt}. Identité non certifiée ; originaux non conservés dans ce dossier.</Text>
        {request.reception.evidenceReferences.map(e => <Text selectable key={e.reference} style={styles.body}>{e.reference} · {e.description}</Text>)}
        {request.privateReason ? <Text selectable style={styles.body}>Dernière motivation : {request.privateReason}</Text> : null}
        <AdminAuthorityReviewForm key={`review:${sourceKey}`} request={request} disabled={!activeNew} onSubmit={confirm}/>
        <Input label="Motivation pour demander des précisions, refuser ou préparer" value={reason} onChangeText={mutateReason} maxLength={4000} multiline disabled={!activeNew}/>
        <Button variant="secondary" disabled={!activeNew || !reason.trim()} onPress={() => confirm({action: 'request_details', caseId: request.id, source: request.source, reason: reason.trim()}, () => {})}>Consigner les précisions à obtenir</Button>
        <Button variant="secondary" disabled={!activeNew || !reason.trim()} onPress={() => confirm({action: 'refuse', caseId: request.id, source: request.source, reason: reason.trim()}, () => {})}>Consigner un refus motivé</Button>
        <AdminAuthorityScopeForm key={`scope:${sourceKey}`} request={request} disabled={!activeNew || !request.review || Object.values(request.review).some(e => e.state !== 'declared_reviewed')} onSubmit={confirm} onEdit={() => {choice.current++; setPreviewState(null); setPackageState(null);}}/>
        {request.selection && ['scope_recorded', 'package_prepared'].includes(request.stage) ? <Button variant="secondary" disabled={busy} onPress={() => {void read('preview');}}>Lire l’aperçu de la portée enregistrée</Button> : null}
        {preview ? <><AdminAuthorityPackageView snapshot={preview.snapshot}/><Button disabled={!activeNew || !reason.trim()} onPress={() => confirm({action: 'prepare_package', caseId: request.id, source: request.source, reason: reason.trim(), previewHash: preview.sourceHash}, () => {if (previewState?.key !== sourceKey) throw new Error('Relisez l’aperçu.');})}>Confirmer cette préparation privée exacte</Button></> : null}
        {request.latestPackage ? <Button variant="secondary" disabled={busy} onPress={() => {void read('package', request.latestPackage!);}}>Relire la dernière préparation enregistrée</Button> : null}
        {detail.data?.pages.flatMap(page => page.events).map(event => <View key={event.id} style={styles.section}>
          <Text selectable style={styles.caption}>{event.qualification === 'native' ? `${event.receipt.recordedAt ?? 'date inconnue'} · ${event.receipt.action} · ${event.receipt.state}` : event.qualification === 'unknown' ? 'Événement historique non qualifié.' : 'Référence d’une préparation historique.'}</Text>
          {event.qualification === 'native' && event.command && event.command.action !== 'receive' ? <Text selectable style={styles.body}>{event.command.reason}</Text> : null}
          {event.qualification === 'package_reference_only' && event.packageReference ? <Button variant="secondary" disabled={busy} onPress={() => {void read('package', event.packageReference!);}}>Relire cette préparation historique</Button> : null}
        </View>)}
        {detail.hasNextPage ? <Button variant="secondary" disabled={busy || detail.isFetchingNextPage} onPress={() => {try {frame.capture(); choice.current++; setPreviewState(null); setPackageState(null); void detail.fetchNextPage();} catch {/* Exact current selected case. */}}}>Lire les événements antérieurs</Button> : null}
        {storedPackage ? <AdminAuthorityPackageView snapshot={storedPackage.document}/> : null}
      </View> : null}
    </>}
    <AuthorityLegalReviewPanel uid={uid} caseId={selected} sourceKey={nativeAuthKey} renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="legal_review"/>}/>
    {notice && frame.focused ? <Text accessibilityRole="alert" style={styles.caption}>{notice}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
