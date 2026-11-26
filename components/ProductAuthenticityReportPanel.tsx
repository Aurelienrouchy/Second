import { useCallback, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { observeProductAuthenticityReportSource } from '@/services/productAuthenticityReportService';
import { TransactionProblemJournal } from '@/services/transactionProblemJournal';
import type { ProductReviewContribution, ProductReviewContributionEntry } from '@/types/productReview';
import { observeProductParcelReportSource } from '@/services/productParcelReportService';
import { productReviewEqual } from '@/services/productReviewService';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import type { TransactionProblemReason } from '@/types/transactionProblem';
const itemKey = (c: ProductReviewContribution) => c.contributionId;
/** An explicit buyer choice links a native declaration to the existing commercial recourse. */
export function ProductAuthenticityReportPanel({uid, transactionId, contributions, sourceHash, enabled, onRecorded, material = false, parcel = false, nativeAdmission = null, topic = 'authenticity'}: {
  uid: string; transactionId: string; contributions: ProductReviewContributionEntry[]; sourceHash: string | null; enabled: boolean; onRecorded: () => void; material?: boolean; parcel?: boolean; nativeAdmission?: ProductPhysicalDocumentaryAdmission | null; topic?: 'authenticity' | 'nonconformity' | 'parcel_delivery';
}) {
  const base = useProductParcelContext(`product-authenticity-journal:${transactionId}`, uid, false);
  const fresh = useProductParcelContext(JSON.stringify(['product-authenticity-report', transactionId, sourceHash, enabled, ...(material ? ['product_review_material_v1', topic] : []), ...(parcel ? ['product_review_parcel_v1', topic, nativeAdmission?.key ?? null] : [])]), uid, parcel);
  const baseKey = JSON.stringify([uid, getAuthSessionGeneration(), transactionId, base.focusRevision]);
  const key = JSON.stringify([baseKey, sourceHash, enabled, fresh.focusRevision, ...(material ? ['product_review_material_v1', topic] : []), ...(parcel ? ['product_review_parcel_v1', topic, nativeAdmission?.key ?? null] : [])]);
  const [draft, setDraft] = useState<{key: string; contributionId: string; details: string; accepted: boolean; reason?: TransactionProblemReason} | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const [busy, setBusy] = useState<string | null>(null), lock = useRef<symbol | null>(null);
  const journal = useQuery({queryKey: ['product-authenticity-report-journal', baseKey], enabled: base.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = base.capture(); return TransactionProblemJournal.read(transactionId, uid, () => base.assertCurrent(op));}});
  const journalReady = base.focused && journal.isSuccess && !journal.isFetching && !journal.isError;
  const attempt = journalReady ? journal.data.attempt : null;
  const receipt = journalReady && attempt && journal.data.receipt?.requestId === attempt.requestId &&
    journal.data.receipt.ownerId === uid && journal.data.receipt.transactionId === transactionId ? journal.data.receipt : null;
  const currentDraft = enabled && fresh.focused && !!sourceHash && draft?.key === key ? draft : null;
  const candidates = enabled && fresh.focused && sourceHash ? contributions.flatMap(e => e.qualification === 'native_actor_contribution' &&
    e.contribution.actorId === uid && (topic === 'parcel_delivery' ? e.contribution.actorRole === 'buyer' || e.contribution.actorRole === 'seller' : e.contribution.actorRole === 'buyer') && e.contribution.topic === topic ? [e.contribution] : []) : [];
  const source = useQuery({queryKey: ['product-authenticity-report-source', key, currentDraft?.contributionId], enabled: !!currentDraft && journalReady && !attempt,
    staleTime: 0, gcTime: 0, retry: false, queryFn: async () => {const op = fresh.capture(); if (!currentDraft) throw new Error('Contribution requise.');
      const value = topic === 'parcel_delivery' ? await observeProductParcelReportSource(uid, transactionId, currentDraft.contributionId, () => fresh.assertCurrent(op)) : await observeProductAuthenticityReportSource(uid, transactionId, currentDraft.contributionId, () => fresh.assertCurrent(op), material, topic, parcel);
      fresh.assertCurrent(op); if (value.productReview && value.productReview.sourceHash !== sourceHash) throw new Error('Sources modifiées.'); return value;}});
  const native = currentDraft && journalReady && !attempt && !source.isFetching && !source.isError ? source.data?.productReview : null;
  const change = (patch: Partial<NonNullable<typeof draft>>) => {if (currentDraft) {try {if (parcel) fresh.capture(); setDraft({...currentDraft, ...patch});} catch { /* Previous activity grants no declaration or consent. */ }}};
  const run = async (action: 'submit' | 'observe' | 'neutralize' | 'acknowledge') => {
    if (lock.current || !journalReady || action === 'submit' && (!native || !currentDraft?.accepted || !currentDraft.details.trim() || topic === 'parcel_delivery' && !currentDraft.reason)) return;
    const owner = action === 'submit' ? fresh : base; let op; try {op = owner.start();} catch {return;} if (!op) return;
    const token = Symbol(); lock.current = token; setBusy(baseKey); setNotice(null);
    try {
      let fence: (() => void) | null = null;
      const assertCurrent = () => {owner.assertCurrent(op); fence?.();};
      if (action === 'submit' && parcel) {
        if (!nativeAdmission || nativeAdmission.uid !== uid || nativeAdmission.context.id !== transactionId || nativeAdmission.scope !== 'own' || nativeAdmission.parcelCapability !== 'product_review_parcel_v1') throw new Error('La lecture documentaire doit être qualifiée.');
        nativeAdmission.assertCurrent(); await nativeAdmission.revalidate(); nativeAdmission.assertCurrent(); fence = nativeAdmission.assertCurrent;
        const reread = topic === 'parcel_delivery' ? await observeProductParcelReportSource(uid, transactionId, currentDraft!.contributionId, assertCurrent) : await observeProductAuthenticityReportSource(uid, transactionId, currentDraft!.contributionId, assertCurrent, material, topic, parcel); assertCurrent();
        if (!productReviewEqual(reread.productReview, native)) throw new Error('La contribution ou les sources du recours ont changé.');
      }
      const value = action === 'submit' ? await TransactionProblemJournal.submit(transactionId, topic === 'parcel_delivery' ? currentDraft!.reason! : 'other', currentDraft!.details, uid, assertCurrent, undefined, native!) :
        action === 'neutralize' ? await TransactionProblemJournal.neutralize(transactionId, uid, assertCurrent) :
        action === 'acknowledge' ? await TransactionProblemJournal.acknowledge(transactionId, uid, assertCurrent) :
        (await TransactionProblemJournal.read(transactionId, uid, assertCurrent)).receipt;
      assertCurrent(); if (!value) throw new Error('Reçu requis.'); setDraft(null);
      await journal.refetch(); assertCurrent(); if (action === 'submit') onRecorded();
      if (action === 'acknowledge') setNotice({key: baseKey, text: 'Le même reçu natif a été relu avant de terminer ce suivi local.'});
    } catch {if (owner.isCurrent(op)) {setDraft(null); setNotice({key: baseKey, text: 'Le résultat reste à vérifier. Relisez la même intention ; le dossier et le support restent accessibles.'}); void journal.refetch();}}
    finally {owner.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  const render = useCallback(({item}: ListRenderItemInfo<ProductReviewContribution>) => <View style={styles.section}>
    <Text selectable style={styles.body}>{item.statement}</Text><Text style={styles.caption}>{topic === 'parcel_delivery' ? 'Votre constat colis enregistré ; ni remise, ni perte, ni contenu ou responsabilité ne sont certifiés.' : topic === 'nonconformity' ? 'Votre comparaison matérielle enregistrée ; aucune différence physique ou faute n’est certifiée.' : 'Votre déclaration d’authenticité enregistrée ; aucune contrefaçon n’est établie.'}</Text>
    <Button variant="secondary" disabled={!journalReady || !!attempt || busy === baseKey} onPress={() => {try {if (parcel) fresh.capture(); setDraft({key, contributionId: item.contributionId, details: '', accepted: false});} catch { /* Old private contribution cannot open a new recourse. */ }}}>
      Examiner la liaison de cette déclaration au recours de la commande</Button>
  </View>, [journalReady, attempt, busy, baseKey, key, topic, parcel, fresh]);
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>{topic === 'parcel_delivery' ? 'Relier le constat colis au recours de la commande' : topic === 'nonconformity' ? 'Relier la comparaison matérielle au recours de la commande' : 'Contestation d’authenticité de la commande'}</Text>
    <Text style={styles.caption}>La déclaration documentaire et le recours sont deux démarches distinctes. La liaison explicite peut enregistrer une plainte et conserver les fonds dans la fenêtre admissible ; elle ne décide d’aucun remboursement.</Text>
    {candidates.length && journalReady && !attempt ? <View style={styles.list}><FlashList data={candidates} keyExtractor={itemKey} renderItem={render} nestedScrollEnabled /></View> : null}
    {currentDraft && !attempt ? <>
      {source.isError || source.isSuccess && !native ? <Text accessibilityRole="alert" style={styles.caption}>La référence actuelle ne peut pas être qualifiée. Relisez le dossier ; aucune liaison n’est proposée.</Text> : null}
      <Button variant="secondary" disabled={source.isFetching || busy === baseKey} onPress={() => {try {if (parcel) fresh.capture(); change({accepted: false}); void source.refetch();} catch { /* A private rereading needs current activity. */ }}}>Relire cette contribution et le dossier actuels</Button>
      {native ? <>
        {topic === 'parcel_delivery' ? (['not_received_despite_delivered', 'not_as_described', 'damaged', 'other'] as const).map(reason => <Button key={reason} variant={currentDraft.reason === reason ? 'primary' : 'secondary'} onPress={() => change({reason, accepted: false})}>{({not_received_despite_delivered: 'Remise annoncée mais non-réception déclarée', not_as_described: 'Différence déclarée avec la description', damaged: 'Dommage déclaré', other: 'Autre motif déclaré'})[reason]}</Button>) : null}
        <Text style={styles.caption}>Votre contribution est reliée à la version {native.caseVersion} du dossier. Une modification impose une nouvelle lecture.</Text>
        <TextInput style={styles.input} multiline maxLength={1000} value={currentDraft.details} editable={busy !== baseKey} placeholder="Expliquez votre contestation pour cette commande" placeholderTextColor={colors.muted}
          onChangeText={details => change({details, accepted: false})} />
        <Checkbox checked={currentDraft.accepted} disabled={busy === baseKey || !currentDraft.details.trim()} onToggle={() => change({accepted: !currentDraft.accepted})}>
          <Text style={styles.caption}>Je demande explicitement la liaison de cette déclaration au recours de cette commande. Le serveur vérifie la fenêtre et les fonds encore conservés. Les délais externes ne sont pas prolongés.</Text>
        </Checkbox>
        <Button disabled={busy === baseKey || !currentDraft.accepted || !currentDraft.details.trim() || topic === 'parcel_delivery' && !currentDraft.reason || parcel && !nativeAdmission} onPress={() => {void run('submit');}}>Enregistrer cette contestation et sa liaison</Button>
      </> : null}
    </> : null}
    {journal.isError ? <Text accessibilityRole="alert" style={styles.caption}>Le journal de cette commande ne peut pas être relu.</Text> : null}
    {attempt ? <>
      <Text selectable style={styles.caption}>Intention conservée : {attempt.requestId}. Son récit et ses références d’origine restent inchangés.</Text>
      <Button variant="secondary" disabled={busy === baseKey} onPress={() => {void run('observe');}}>Relire le reçu de la même intention</Button>
      {receipt ? <Text style={styles.body}>{receipt.state === 'committed' ? receipt.protocol === 'transaction_parcel_report_v1' && !receipt.freezeCommitted ? 'Le constat du colis de retour et son recours sont enregistrés séparément. Ce reçu ne modifie pas la plainte de l’acheteur et n’accorde aucun gel de fonds.' : 'Le signalement et son gel admissible sont enregistrés. Le règlement financier reste distinct.' : receipt.state === 'not_executed' ?
        'Cette intention n’a pas été exécutée. Le dossier documentaire et le support restent accessibles ; aucun fonds déjà libéré n’est repris.' : 'Aucun reçu natif n’est enregistré. Cela ne prouve aucune non-exécution.'}</Text> : null}
      {receipt?.state === 'unrecorded' && attempt.productReview ? <Button variant="secondary" disabled={busy === baseKey} onPress={() => Alert.alert('Neutraliser cette liaison',
        'La référence d’origine sera bloquée avant tout effet non engagé. Un signalement déjà enregistré restera conservé.', [{text: 'Retour', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void run('neutralize');}}])}>Neutraliser cette intention non engagée</Button> : null}
      {receipt && receipt.state !== 'unrecorded' ? <Button variant="secondary" disabled={busy === baseKey} onPress={() => {void run('acknowledge');}}>Relire le reçu puis terminer ce suivi local</Button> : null}
    </> : null}
    <Button variant="ghost" disabled={!base.focused || journal.isFetching || busy === baseKey} onPress={() => {void journal.refetch();}}>Relire le suivi de cette commande</Button>
    {notice?.key === baseKey ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 8},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
