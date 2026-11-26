import {useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FlashList, type ListRenderItemInfo} from '@shopify/flash-list';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {Button, Checkbox, Input} from '@/components/ui';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {getAuthSessionGeneration} from '@/store/authStore';
import {newSupportRequestId} from '@/services/supportRequestService';
import {SellerActivityReviewService as Service, isSellerActivityAnchor, isSellerActivityPeriod} from '@/services/sellerActivityReviewService';
import {SellerActivityReviewJournal as Journal} from '@/services/sellerActivityReviewJournal';
import type {SellerActivityAnchor, SellerActivityCriterion, SellerActivityPeriod, SellerActivityReviewPreview} from '@/types/sellerActivityReview';
import {colors, spacing, typography} from '@/constants/theme';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
import {AdminSellerActivityReviewJournal} from './AdminSellerActivityReviewJournal';
type ReviewItem = SellerActivityReviewPreview['facts']['items'][number];
const rowKey = (item: ReviewItem) => item.transactionId;
const amount = (value: number | null) => value === null ? 'inconnu' : `${value} cents CAD`;
const renderRow = ({item}: ListRenderItemInfo<ReviewItem>) => <View style={styles.row}>
  <Text selectable style={styles.body}>Commande {item.transactionId} · {item.recordedStatus ?? 'état inconnu'}</Text>
  <Text style={styles.caption}>Création {item.createdAt.at ?? 'inconnue'} · {item.periodMembership === 'inside' ? 'dans la période' : item.periodMembership === 'outside' ? 'hors période — conservée dans la page' : 'date inconnue — conservée dans la page'}.</Text>
  <Text style={styles.caption}>Prix {amount(item.amounts.articlePrice.amountCents)} · total {amount(item.amounts.orderTotal.amountCents)} · brut vendeur {amount(item.amounts.sellerGross.amountCents)}.</Text>
  <Text style={styles.caption}>Capture carte {amount(item.amounts.cardCaptured.amountCents)} · débit portefeuille {amount(item.amounts.walletDebited.amountCents)}.</Text>
  <Text style={styles.caption}>Crédit vendeur {amount(item.amounts.sellerCredit.amountCents)} · libération des mêmes fonds {amount(item.amounts.release.amountCents)} · remboursement {amount(item.amounts.nativeRefund.total.amountCents)}.</Text>
</View>;
export function AdminSellerActivityReview({uid, suggestedAnchor, onOpenReview}: {uid: string; suggestedAnchor?: SellerActivityAnchor | null; onOpenReview?: (id: string) => void}) {
  const [kind, setKind] = useState<'order' | 'article'>('order'), [reference, setReference] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const frame = useLabelLifecycleContext(JSON.stringify(['seller-activity-review', kind, reference, from, to]), uid), client = useQueryClient(), serial = useRef(0), lock = useRef(false), draft = useRef(0);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision, kind, reference, from, to]);
  const [authenticated, setAuthenticated] = useState<string | null>(null), allowed = frame.focused && authenticated === key;
  const [renderSerial, setRenderSerial] = useState(0);
  const [selection, setSelection] = useState<{key: string; serial: number; anchor: SellerActivityAnchor; period: SellerActivityPeriod; cursor: string | null} | null>(null);
  const selected = selection?.key === key && selection.serial === renderSerial ? selection : null;
  const queryKey = ['seller-activity-review-preview', key, selected?.serial] as const;
  const query = useQuery({queryKey, enabled: allowed && !!selected, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {if (!selected) throw new Error('Choisissez une source native.'); const op = frame.capture(), n = serial.current;
      return Service.preview(uid, selected.anchor, selected.period, selected.cursor, () => {frame.assertCurrent(op); if (serial.current !== n) throw new Error('La source sélectionnée a changé.');});}});
  const ownKey = ['seller-activity-review-journal', JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision])] as const;
  const own = useQuery({queryKey: ownKey, enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, () => frame.assertCurrent(op));}});
  const [busyKey, setBusy] = useState<string | null>(null), busy = busyKey === key;
  const preview = allowed && !busy && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  const sourceKey = JSON.stringify([key, selected?.serial, preview?.sourceHash]), [form, setForm] = useState<{key: string; codes: SellerActivityCriterion[]; reason: string; internal: string}>({key: '', codes: [], reason: '', internal: ''});
  const visibleForm = form.key === sourceKey ? form : {key: sourceKey, codes: [], reason: '', internal: ''};
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const edit = (patch: Partial<Omit<typeof form, 'key'>>) => {draft.current++; setForm({...visibleForm, ...patch, key: sourceKey});};
  const invalidate = () => {serial.current++; setRenderSerial(serial.current); draft.current++; setSelection(null); setAuthenticated(null); setForm({key: '', codes: [], reason: '', internal: ''}); setNotice(null);};
  const read = (cursor: string | null = null) => {try {frame.capture(); if (!allowed || lock.current) return; const anchor = {kind, id: reference}, utc = (value: string) => {if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error('Date UTC exacte requise.'); const parsed = new Date(value).toISOString(); if (parsed !== (value.length === 20 ? value.replace('Z', '.000Z') : value)) throw new Error('Date UTC réelle requise.'); return parsed;}, period = {fromInclusive: utc(from), toExclusive: utc(to)};
    if (!isSellerActivityAnchor(anchor) || !isSellerActivityPeriod(period)) throw new Error('Indiquez une ancre native et deux dates UTC explicites (suffixe Z), début inclus et fin exclue.');
    serial.current++; setRenderSerial(serial.current); draft.current++; setSelection({key, serial: serial.current, anchor, period, cursor}); setNotice(null); setForm({key: '', codes: [], reason: '', internal: ''});
  } catch (error) {setNotice({key, text: error instanceof Error ? error.message : 'Portée non qualifiée.'});}};
  const open = async () => {
    if (!preview || !selected || lock.current || own.isError || own.isFetching || own.data !== null || !visibleForm.codes.length || !visibleForm.reason.trim()) return;
    const captured = preview, qData = query.data, ownData = own.data, n = serial.current, draftRevision = draft.current, selectedForm = visibleForm; let op;
    try {op = frame.start();} catch {return;} if (!op) return;
    const current = () => {frame.assertCurrent(op); if (serial.current !== n) throw new Error('La sélection a changé.');};
    const sourceCurrent = () => {current(); if (draft.current !== draftRevision) throw new Error('Les critères ou motifs ont changé.'); const q = client.getQueryState(queryKey);
      const j = client.getQueryState(ownKey); if (!q || q.status !== 'success' || q.fetchStatus !== 'idle' || q.isInvalidated || client.getQueryData(queryKey) !== qData || !j || j.status !== 'success' || j.fetchStatus !== 'idle' || j.isInvalidated || client.getQueryData(ownKey) !== ownData) throw new Error('Relisez l’aperçu natif actuel.');};
    lock.current = true; setBusy(key); setNotice(null);
    try {
      sourceCurrent(); const fresh = await Service.preview(uid, selected.anchor, selected.period, selected.cursor, sourceCurrent); sourceCurrent();
      if (fresh.sourceHash !== captured.sourceHash || fresh.eligibilityVersion !== captured.eligibilityVersion || fresh.criteriaVersion !== captured.criteriaVersion) throw new Error('Les faits ont changé. Relisez l’aperçu et choisissez de nouveau les critères.');
      const command = {anchor: selected.anchor, period: selected.period, cursor: selected.cursor, expectedSourceHash: captured.sourceHash, expectedEligibilityVersion: captured.eligibilityVersion,
        criteriaVersion: captured.criteriaVersion, criteriaCodes: selectedForm.codes, ownerReason: selectedForm.reason.trim(), internalNote: selectedForm.internal.trim() || null};
      const attempt = await Service.attempt(uid, newSupportRequestId(), command, sourceCurrent); sourceCurrent();
      const receipt = await Journal.submit(attempt, command, current, sourceCurrent); current();
      setNotice({key, text: receipt.state === 'committed' ? 'Premier dossier natif ouvert. Observez son reçu dans le suivi ci-dessous pour ouvrir le dossier opérateur et examiner ses suites.' : 'Instruction non exécutée ou inconnue : rapprochez le reçu conservé avant une autre ouverture.'});
      setAuthenticated(null); setSelection(null); setForm({key: '', codes: [], reason: '', internal: ''}); await client.invalidateQueries({queryKey: ['seller-activity-review-journal']}); current();
    } catch (error) {try {current(); setAuthenticated(null); setSelection(null); setForm({key: '', codes: [], reason: '', internal: ''}); setNotice({key, text: error instanceof Error ? error.message : 'L’ouverture doit être rapprochée dans votre suivi conservé.'}); await client.invalidateQueries({queryKey: ['seller-activity-review-journal']});} catch {/* Old private source cannot overwrite the replacement frame. */}}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) setBusy(null);}
  };
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>Ouvrir un examen humain d’activité vendeur</Text>
    <Text style={styles.caption}>Le vendeur vient d’une annonce ou commande native. Le volume ne conclut ni fraude, ni statut professionnel, ni obligation fiscale. L’ouverture crée un dossier et un signal de vente à examiner ; elle n’annule aucune vente et ne déplace aucun fonds.</Text>
    <Button variant="secondary" disabled={busy || !frame.focused} onPress={() => {invalidate(); setKind(kind === 'order' ? 'article' : 'order');}}>{kind === 'order' ? 'Ancre : commande' : 'Ancre : annonce'}</Button>
    <Input label="Référence native de l’ancre" value={reference} maxLength={1500} autoCapitalize="none" disabled={busy} onChangeText={value => {invalidate(); setReference(value);}}/>
    {suggestedAnchor ? <Button variant="secondary" disabled={busy || !frame.focused} onPress={() => {invalidate(); setKind(suggestedAnchor.kind); setReference(suggestedAnchor.id);}}>Utiliser l’ancre proposée : {suggestedAnchor.id}</Button> : null}
    <Input label="Début UTC inclus (suffixe Z)" value={from} maxLength={30} autoCapitalize="none" disabled={busy} onChangeText={value => {invalidate(); setFrom(value);}}/>
    <Input label="Fin UTC exclue (suffixe Z)" value={to} maxLength={30} autoCapitalize="none" disabled={busy} onChangeText={value => {invalidate(); setTo(value);}}/>
    <AdminFinancialReauthentication uid={uid} sourceKey={key} purpose="commercial" parcel disabled={busy || !frame.focused} onVerified={() => {try {frame.capture(); serial.current++; setRenderSerial(serial.current); setSelection(null); setAuthenticated(key);} catch {/* Only the currently selected SDK source. */}}}/>
    <Button variant="secondary" disabled={!allowed || busy} onPress={() => read()}>Lire l’aperçu natif frais</Button>
    {query.isError ? <Text style={styles.caption}>L’aperçu privé ne peut pas être confirmé. Aucun ancien fait n’est affiché ; relisez l’habilitation et la source.</Text> : null}
    {preview ? <>
      <Text selectable style={styles.body}>Vendeur natif : {preview.sellerId} · lecture {preview.readAt}</Text>
      <Text style={styles.caption}>Profil enregistré : {preview.facts.profile.recordedCreatedAt.at ?? 'date inconnue'} · création Auth : {preview.facts.profile.authCreatedAt.at ?? 'date inconnue'}. Ces dates sont distinctes.</Text>
      <Text style={styles.caption}>Déclaration : {preview.facts.activityDeclaration.kind ?? 'inconnue'} — déclarative, non vérifiée juridiquement.</Text>
      <Text style={styles.caption}>{preview.period.fromInclusive} inclus → {preview.period.toExclusive} exclu. {preview.facts.pagination.inspected}/20 commandes inspectées ; ordre par identifiant, couverture historique et de période non vérifiées. Les lignes hors période ou sans date restent visibles. Aucun total global n’est calculé.</Text>
      <View style={styles.list}><FlashList data={preview.facts.items} renderItem={renderRow} keyExtractor={rowKey} nestedScrollEnabled/></View>
      {preview.facts.pagination.hasMore ? <Button variant="secondary" disabled={busy} onPress={() => read(preview.facts.pagination.nextCursor!.lastId)}>Inspecter les vingt références suivantes</Button> : null}
      <Text style={styles.caption}>L’instruction ci-dessous porte sur cette page exacte. Lire une autre page efface les critères et motifs en cours.</Text>
      {preview.criteria.map(criterion => <Checkbox key={criterion.code} checked={visibleForm.codes.includes(criterion.code)} disabled={busy || criterion.code === 'declaration_consistency' && preview.facts.activityDeclaration.qualification === 'unknown'} onToggle={() => edit({codes: visibleForm.codes.includes(criterion.code) ? visibleForm.codes.filter(c => c !== criterion.code) : [...visibleForm.codes, criterion.code]})}><Text style={styles.body}>{criterion.label}</Text></Checkbox>)}
      <Input label="Motif communiqué au propriétaire" value={visibleForm.reason} maxLength={2000} multiline disabled={busy} onChangeText={reason => edit({reason})}/>
      <Input label="Note interne privée (facultative)" value={visibleForm.internal} maxLength={2000} multiline disabled={busy} onChangeText={internal => edit({internal})}/>
      <Button disabled={busy || !visibleForm.codes.length || !visibleForm.reason.trim() || own.isError || own.isFetching || own.data !== null} onPress={() => {void open();}}>Ouvrir ce premier dossier avec ces critères et ce motif</Button>
    </> : null}
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
    <AdminSellerActivityReviewJournal uid={uid} onOpenReview={onOpenReview}/>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.md}, row: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 14}});
