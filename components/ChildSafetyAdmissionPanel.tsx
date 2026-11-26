import { useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { ChildSafetyCommandPanel } from '@/components/ChildSafetyCommandPanel';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ChildSafetyReviewService, CHILD_ADMISSION_ACTIONS, CHILD_ADMISSION_CRITERIA } from '@/services/childSafetyReviewService';
import { productReviewEqual } from '@/services/productReviewService';
import type { ChildSafetyAdmissionAction, ChildSafetyAdmissionCommand, ChildSafetyAssessment, ChildSafetyCriterion, ChildSafetyDocument } from '@/types/childSafetyReview';
import type { ProductReviewCursor, ProductReviewScope } from '@/types/productReview';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
const actionLabels = {allow_listing_for_sources: 'Autoriser pour les sources examinées', retain_review: 'Conserver en examen', refuse_listing: 'Refuser l’admission'};
const criterionLabels = {use_and_regulatory_scope: 'Usage et champ réglementaire', flammability_requirements: 'Exigences d’inflammabilité', label_and_care_information: 'Étiquette et entretien', condition_alterations_and_sale_unit: 'État, retouches et unité vendue', hazards_and_recall_information: 'Dangers et rappels', documentation_limits: 'Limites des documents'};
const documentLabels = {sleepwear_regulations: 'Règlement sur les vêtements de nuit pour enfants', hc_sleepwear_guidance: 'Guide Santé Canada sur l’inflammabilité', hc_second_hand_guidance: 'Guide Santé Canada sur les produits d’occasion'};
interface Form {key: string; action: ChildSafetyAdmissionAction | null; motivation: string; ownerSummary: string; assessments: Partial<Record<ChildSafetyCriterion, {assessment: ChildSafetyAssessment['assessment'] | null; reason: string}>>; documents: ChildSafetyDocument[]; accepted: boolean}
export function ChildSafetyAdmissionPanel({uid, articleId, scope, historicalOnly = false}: {uid: string; articleId: string; scope: ProductReviewScope; historicalOnly?: boolean}) {
  const frame = useShippingPurchaseContext(`child-safety-admission:${articleId}:${scope}`, uid), key = JSON.stringify([uid, articleId, scope, getAuthSessionGeneration(), frame.focusRevision]);
  const [formState, setFormState] = useState<Form | null>(null), [localError, setLocalError] = useState<{key: string; text: string} | null>(null);
  const read = () => {const operation = frame.capture(); return ChildSafetyReviewService.admissionPreview(uid, articleId, scope, () => frame.assertCurrent(operation));};
  const preview = useQuery({queryKey: ['child-safety-admission-preview', key], enabled: frame.focused && !historicalOnly, staleTime: 0, gcTime: 0, retry: false, queryFn: read});
  const admitted = frame.focused && !historicalOnly && preview.isSuccess && !preview.isFetching && !preview.error ? preview.data : null;
  const readKey = admitted ? JSON.stringify([key, admitted.source.sourceHash, admitted.documentaryCorpus.hash, admitted.documentaryCorpus.membersHash, admitted.source.readAt]) : '';
  const pages = useInfiniteQuery({queryKey: ['child-safety-admission-decisions', readKey], enabled: !!admitted?.source.caseSource.present, initialPageParam: null as ProductReviewCursor | null, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({pageParam}) => {if (!admitted) throw new Error('Source actuelle requise.'); const operation = frame.capture(); return ChildSafetyReviewService.admissionPage(uid, articleId, scope, pageParam, admitted, () => frame.assertCurrent(operation));}, getNextPageParam: page => page.coverage.hasMore ? page.nextCursor : undefined});
  const all = pages.data?.pages.flatMap(p => p.entries) ?? [], ids = all.map(e => e.qualification === 'native_admission_decision' ? e.decision.decisionId : e.decisionId);
  // A missing root before its first native contribution has no admission history yet.
  const noHistory = !!admitted && !admitted.source.caseSource.present;
  const current = admitted && localError?.key !== key && (noHistory || pages.isSuccess && !pages.isFetching && !pages.error && new Set(ids).size === ids.length) ? admitted : null;
  const form: Form = formState?.key === readKey && readKey ? formState : {key: readKey, action: null, motivation: '', ownerSummary: '', assessments: {}, documents: [], accepted: false};
  const change = (update: Partial<Form>) => {if (!current || !readKey) return; try {frame.capture(); setFormState({...form, ...update, accepted: false});} catch { /* No draft from stale private sources. */ }};
  const assessmentRows = CHILD_ADMISSION_CRITERIA.map(criterion => ({criterion, assessment: form.assessments[criterion]?.assessment, reason: form.assessments[criterion]?.reason.trim() ?? ''}));
  const referencesKnown = !!current && current.documentaryCorpus.contributionReferences.every(r => r.qualification === 'native_contribution' && r.contentHash !== null) && current.documentaryCorpus.evidenceReferences.every(r => r.qualification === 'native_stored_file');
  const allowEligible = !!current?.canAllowForCurrentSources && current.coverage.documentaryCompleteCurrentCaseSet && form.documents.length === 3 && assessmentRows.every(a => a.assessment !== 'unresolved');
  const draft: ChildSafetyAdmissionCommand | null = scope === 'admin' && current && form.action && form.accepted && form.motivation.trim() && form.ownerSummary.trim() && assessmentRows.every(a => a.assessment && a.reason) && (form.action !== 'allow_listing_for_sources' || allowEligible && referencesKnown) ? {
    context: {kind: 'article_listing', id: articleId}, sourceHash: current.source.sourceHash, childSourceHash: current.childSourceHash, statementHash: current.statementHash, action: form.action,
    motivation: form.motivation.trim(), ownerSummary: form.ownerSummary.trim(), referenceSetHash: current.referenceSetHash, documentsConsidered: [...form.documents].sort(), assessments: (assessmentRows as ChildSafetyAssessment[]).sort((a, b) => a.criterion < b.criterion ? -1 : a.criterion > b.criterion ? 1 : 0), acknowledged: true,
    documentaryCorpus: {hash: current.documentaryCorpus.hash, membersHash: current.documentaryCorpus.membersHash,
      contributionReferences: current.documentaryCorpus.contributionReferences.flatMap(r => r.qualification === 'native_contribution' && r.contentHash ? [{id: r.id, contentHash: r.contentHash}] : []),
      evidenceReferences: current.documentaryCorpus.evidenceReferences.flatMap(r => r.qualification === 'native_stored_file' ? [r.evidence] : [])}} : null;
  const verifyNew = async () => {if (!current || !draft || !readKey) throw new Error('Examinez les sources actuelles et confirmez vos motifs.'); let fresh; try {fresh = await read();} catch (e) {setFormState(null); setLocalError({key, text: 'La nouvelle lecture native a échoué. Les données et actions sont masquées.'}); throw e;} if (fresh.source.sourceHash !== current.source.sourceHash || !productReviewEqual(fresh.documentaryCorpus, current.documentaryCorpus) || fresh.childSourceHash !== current.childSourceHash || fresh.referenceSetHash !== current.referenceSetHash || !productReviewEqual(fresh.coverage, current.coverage) || draft.action === 'allow_listing_for_sources' && !fresh.canAllowForCurrentSources) {setFormState(null); setLocalError({key, text: 'Les sources ou le corpus ont changé. Relisez et refaites l’examen explicite.'}); throw new Error('La source actuelle ne correspond plus à l’examen présenté.');}};
  const corpusRows = current && scope === 'admin' ? [...current.documentaryCorpus.contributionReferences.map(r => ({id: r.id, text: r.qualification === 'native_contribution' ? `Contribution ${r.id} — empreinte ${r.contentHash}` : 'Contribution non qualifiée : contenu inconnu.'})), ...current.documentaryCorpus.evidenceReferences.map(r => ({id: r.qualification === 'native_stored_file' ? r.evidence.id : r.evidenceId, text: r.qualification === 'native_stored_file' ? `Pièce ${r.evidence.id} — ${r.evidence.typeDeclared} — ${r.evidence.state === 'received' ? 'dépôt enregistré' : 'dépôt nécessitant un rapprochement'} — génération ${r.evidence.generation} — empreinte ${r.evidence.contentHash}` : 'Pièce non qualifiée : contenu inconnu.'}))] : [];
  return <View style={styles.section}>
    <Text style={styles.title}>Admission de l’annonce</Text>
    <Text style={styles.body}>Cette décision est distincte de l’issue documentaire et du geste de publication. Elle porte sur les sources examinées ; elle ne certifie pas la conformité physique du produit.</Text>
    {!historicalOnly ? <Button variant="secondary" disabled={!frame.focused} onPress={() => {setFormState(null); setLocalError(null); void preview.refetch();}}>Relire l’aperçu d’admission</Button> : null}
    {localError?.key === key ? <Text accessibilityRole="alert" style={styles.body}>{localError.text}</Text> : null}
    {!historicalOnly && (preview.error || pages.error && !noHistory) ? <Text style={styles.body}>Les sources ou l’historique ne peuvent pas être qualifiés. Les données privées et les nouvelles décisions sont masquées.</Text> : null}
    {current ? <>
      <Text style={styles.caption}>Lecture du dossier : {new Date(current.source.readAt).toLocaleString(APP_LOCALE)}. {current.canAllowForCurrentSources ? 'Le corpus natif actuel permet un examen d’admission.' : 'L’autorisation reste indisponible : des sources, documents, pièces ou gardes doivent être rapprochés.'}</Text>
      {scope === 'admin' ? <>
        <Text selectable style={styles.caption}>Source enfant {current.childSourceHash} ; corpus {current.documentaryCorpus.hash} ; ensemble documentaire {current.documentaryCorpus.membersHash}.</Text>
        <Text style={styles.caption}>Références natives examinées : {corpusRows.length}. Les inconnues, pièces en attente, dépôts à rapprocher et dépassements de pagination empêchent l’autorisation.</Text>
        <View style={styles.list}><FlashList data={corpusRows} keyExtractor={r => r.id} renderItem={({item}) => <Text selectable style={styles.caption}>{item.text}</Text>} /></View>
        <Text style={styles.body}>Documents de référence fournis par le serveur. Leur contenu n’a pas été téléchargé par cet aperçu ; cochez seulement ceux que vous avez effectivement consultés.</Text>
        {current.referenceSet.documents.map(d => <View style={styles.section} key={d.id}>
          <Button variant="secondary" onPress={() => {const op = frame.capture(); void Linking.openURL(d.url).then(() => frame.assertCurrent(op)).catch(() => {});}}>{documentLabels[d.id]}</Button>
          <Checkbox checked={form.documents.includes(d.id)} onToggle={() => change({documents: form.documents.includes(d.id) ? form.documents.filter(id => id !== d.id) : [...form.documents, d.id]})}><Text style={styles.body}>Document considéré dans cet examen</Text></Checkbox>
        </View>)}
        {CHILD_ADMISSION_CRITERIA.map(criterion => <View style={styles.section} key={criterion}>
          <Text style={styles.body}>{criterionLabels[criterion]}</Text>
          {([{value: 'documented', label: 'Documenté'}, {value: 'unresolved', label: 'Non résolu'}, {value: 'not_applicable', label: 'Non applicable'}] as const).map(c => <Button key={c.value} variant={form.assessments[criterion]?.assessment === c.value ? 'primary' : 'secondary'} onPress={() => change({assessments: {...form.assessments, [criterion]: {reason: form.assessments[criterion]?.reason ?? '', assessment: c.value}}})}>{c.label}</Button>)}
          <TextInput accessibilityLabel={`Motif : ${criterionLabels[criterion]}`} value={form.assessments[criterion]?.reason ?? ''} maxLength={2000} multiline style={styles.input} onChangeText={reason => change({assessments: {...form.assessments, [criterion]: {assessment: form.assessments[criterion]?.assessment ?? null, reason}}})} />
        </View>)}
        {CHILD_ADMISSION_ACTIONS.map(a => <Button key={a} variant={form.action === a ? 'primary' : 'secondary'} disabled={a === 'allow_listing_for_sources' && !current.canAllowForCurrentSources} onPress={() => change({action: a})}>{actionLabels[a]}</Button>)}
        <TextInput accessibilityLabel="Motivation privée de l’admission" placeholder="Motivation privée de la décision" value={form.motivation} maxLength={4000} multiline style={styles.input} onChangeText={motivation => change({motivation})} />
        <TextInput accessibilityLabel="Synthèse adressée au vendeur" placeholder="Synthèse motivée adressée au vendeur" value={form.ownerSummary} maxLength={4000} multiline style={styles.input} onChangeText={ownerSummary => change({ownerSummary})} />
        <Checkbox checked={form.accepted} onToggle={() => {try {frame.capture(); setFormState({...form, accepted: !form.accepted});} catch { /* Stale source. */ }}}><Text style={styles.body}>J’ai examiné ces sources et ces références exactes. Je confirme cette décision motivée sans certifier le produit ni demander une publication automatique.</Text></Checkbox>
      </> : null}
      {pages.isSuccess && !pages.isFetching && !pages.error && new Set(ids).size === ids.length ? all.map(e => <View key={e.qualification === 'native_admission_decision' ? e.decision.decisionId : e.decisionId} style={styles.section}>
        {e.qualification === 'native_admission_decision' ? <><Text style={styles.body}>{actionLabels[e.decision.action]} — décision enregistrée le {new Date(e.decision.recordedAt).toLocaleString(APP_LOCALE)}.</Text><Text selectable style={styles.body}>{e.decision.ownerSummary}</Text><Text style={styles.caption}>Cette décision historique ne prouve ni l’admission actuelle ni la visibilité de l’annonce.</Text>{scope === 'admin' ? <Text style={styles.body}>{e.decision.motivation}</Text> : null}</> : <Text style={styles.body}>Une décision historique ne peut pas être qualifiée.</Text>}
      </View>) : null}
      {pages.hasNextPage ? <Button variant="secondary" disabled={pages.isFetching} onPress={() => {void pages.fetchNextPage();}}>Lire la page suivante des décisions</Button> : null}
    </> : null}
    {scope === 'admin' ? <ChildSafetyCommandPanel uid={uid} articleId={articleId} kind="admission" sourceKey={readKey} draft={draft} enabled={!!current && !!draft} verifyNew={verifyNew} onRecorded={() => {setFormState(null); void preview.refetch();}} /> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md, minHeight: spacing.xl * 2}, list: {height: spacing.xl * 8}});
