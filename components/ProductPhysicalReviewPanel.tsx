import { useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button, Checkbox } from '@/components/ui';
import { ProductPhysicalCommandPanel } from '@/components/ProductPhysicalCommandPanel';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ProductPhysicalReviewService, PRODUCT_PHYSICAL_ACTIONS, PRODUCT_PHYSICAL_CRITERIA } from '@/services/productPhysicalReviewService';
import { productReviewEqual } from '@/services/productReviewService';
import type { ProductPhysicalAction, ProductPhysicalAssessment, ProductPhysicalCommand, ProductPhysicalContext, ProductPhysicalCriterion, ProductPhysicalDocument, ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import type { ProductReviewCursor, ProductReviewScope } from '@/types/productReview';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
const actionLabels = {maintain_stop: 'Maintenir l’arrêt conservatoire', allow_forward_only: 'Lever ce seul arrêt pour le trajet aller examiné', allow_return_only: 'Lever ce seul arrêt pour le trajet retour examiné', no_reship_separate_handling: 'Ne pas réexpédier — traitement séparé'};
const criterionLabels = {manufacturer_model_lot: 'Fabricant, modèle et lot', recall_applicability: 'Applicabilité du rappel déclaré', corrective_action: 'Correctif et limites de prise en charge', hygiene_condition: 'État sanitaire et observations d’hygiène', route_handling_limits: 'Limites de manipulation et trajet', documentation_limits: 'Limites des documents et inconnues'};
const documentLabels = {hc_recalls: 'Guide Santé Canada sur les rappels', hc_second_hand: 'Guide Santé Canada sur les produits d’occasion'};
interface Form {key: string; action: ProductPhysicalAction | null; privateNote: string; partyMessage: string; separateHandlingSummary: string; documents: ProductPhysicalDocument[];
  assessments: Partial<Record<ProductPhysicalCriterion, {qualification: ProductPhysicalAssessment['qualification'] | null; summary: string}>>; accepted: boolean}
/** Source-bound safety handling is separate from financial and commercial recourse. */
export function ProductPhysicalReviewPanel({uid, context, scope, nativeAdmission}: {uid: string; context: ProductPhysicalContext; scope: ProductReviewScope; nativeAdmission: ProductPhysicalDocumentaryAdmission | null}) {
  const documentary = nativeAdmission?.uid === uid && nativeAdmission.scope === scope && nativeAdmission.context.id === context.id && nativeAdmission.context.kind === context.kind ? nativeAdmission : null;
  const documentaryKey = documentary?.key ?? null;
  const [documentaryVersion, setDocumentaryVersion] = useState({key: documentaryKey, revision: 0});
  if (documentaryVersion.key !== documentaryKey) setDocumentaryVersion({key: documentaryKey, revision: documentaryVersion.revision + 1});
  const router = useRouter(), client = useQueryClient(), frame = useProductParcelContext(JSON.stringify(['product-physical', context, scope, documentaryKey, documentaryVersion.revision]), uid,
    !nativeAdmission || nativeAdmission.parcelCapability === 'product_review_parcel_v1');
  const key = JSON.stringify([uid, context.id, scope, getAuthSessionGeneration(), frame.focusRevision, documentaryKey, documentaryVersion.revision]);
  const [formState, setFormState] = useState<Form | null>(null), [failedSource, setFailedSource] = useState<string | null>(null);
  const read = () => {const op = frame.capture(), assertCurrent = () => {frame.assertCurrent(op); if (!documentary) throw new Error('Relisez le dossier documentaire.'); documentary.assertCurrent();};
    assertCurrent(); return ProductPhysicalReviewService.preview(uid, context, scope, assertCurrent, documentary?.materialCapability === 'product_review_material_v1', documentary?.parcelCapability === 'product_review_parcel_v1');};
  const preview = useQuery({queryKey: ['product-physical-preview', uid, context.id, scope, key], enabled: frame.focused && !!documentary, staleTime: 0, gcTime: 0, retry: false, queryFn: read});
  const admitted = documentary && frame.focused && failedSource !== key && preview.isSuccess && !preview.isFetching && !preview.error &&
    preview.data.source.sourceHash === documentary.sourceHash && preview.data.documentaryCorpus.hash === documentary.corpusHash ? preview.data : null;
  const sourceKey = admitted ? JSON.stringify([key, admitted.source.sourceHash, admitted.semanticSourceHash, admitted.caseVersion, admitted.guardVersion, admitted.documentaryCorpus.hash, admitted.documentaryCorpus.membersHash, admitted.source.readAt]) : '';
  const history = useInfiniteQuery({queryKey: ['product-physical-history', sourceKey], enabled: !!admitted?.source.caseSource.present, staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as ProductReviewCursor | null,
    queryFn: ({pageParam}) => {if (!admitted) throw new Error('Relisez la source actuelle.'); const op = frame.capture(); return ProductPhysicalReviewService.page(uid, context, scope, pageParam, admitted, () => frame.assertCurrent(op), documentary?.materialCapability === 'product_review_material_v1', documentary?.parcelCapability === 'product_review_parcel_v1');}, getNextPageParam: page => page.coverage.hasMore ? page.nextCursor : undefined});
  const entries = history.data?.pages.flatMap(p => p.entries) ?? [], ids = entries.map(r => r.qualification === 'native_instruction' ? r.instruction.instructionId : r.instructionId);
  const current = admitted && (!admitted.source.caseSource.present || history.isSuccess && !history.isFetching && !history.error && new Set(ids).size === ids.length) ? admitted : null;
  const form: Form = formState?.key === sourceKey && sourceKey ? formState : {key: sourceKey, action: null, privateNote: '', partyMessage: '', separateHandlingSummary: '', documents: [], assessments: {}, accepted: false};
  const change = (update: Partial<Form>) => {if (!current) return; try {frame.capture(); setFormState({...form, ...update, accepted: false});} catch { /* No draft from stale private sources. */ }};
  const rows = PRODUCT_PHYSICAL_CRITERIA.map(criterion => ({criterion, qualification: form.assessments[criterion]?.qualification, summary: form.assessments[criterion]?.summary.trim() ?? ''}));
  const positive = form.action === 'allow_forward_only' || form.action === 'allow_return_only', leg = form.action === 'allow_forward_only' ? 'forward' : form.action === 'allow_return_only' ? 'return' : 'none';
  const signalsKnown = !!current && current.signalReferences.every(r => r.qualified && r.contentHash !== null);
  const corpusKnown = !!current && current.documentaryCorpus.contributionReferences.every(r => r.qualification === 'native_contribution' && r.contentHash !== null) && current.documentaryCorpus.evidenceReferences.every(r => r.qualification === 'native_stored_file' && r.evidence.state === 'received');
  const canPositive = !!current?.canConsiderRouteForSources && current.coverage.documentaryCompleteCurrentCaseSet && corpusKnown && signalsKnown && rows.every(r => r.qualification === 'examined' || r.qualification === 'not_applicable') && form.documents.length === 2 && leg !== 'none' && current.routes[leg] !== null;
  const draft: ProductPhysicalCommand | null = scope === 'admin' && current && form.action && form.accepted && signalsKnown && form.privateNote.trim() && form.partyMessage.trim() && rows.every(r => r.qualification && r.summary) && (!positive || canPositive) && (form.action !== 'no_reship_separate_handling' || form.separateHandlingSummary.trim()) ? {
    ...(documentary?.parcelCapability ? {parcelCapability: documentary.parcelCapability, ...(documentary.materialCapability ? {materialCapability: documentary.materialCapability} : {})} : {}),
    context, sourceHash: current.source.sourceHash, semanticSourceHash: current.semanticSourceHash, caseVersion: current.caseVersion, guardVersion: current.guardVersion,
    signalReferences: current.signalReferences.flatMap(r => r.qualified && r.contentHash ? [{id: r.id, contentHash: r.contentHash}] : []), action: form.action, leg, routeSourceHash: leg === 'none' ? null : current.routes[leg],
    assessments: (rows as ProductPhysicalAssessment[]).sort((a, b) => a.criterion < b.criterion ? -1 : a.criterion > b.criterion ? 1 : 0), privateNote: form.privateNote.trim(), partyMessage: form.partyMessage.trim(), separateHandlingSummary: form.action === 'no_reship_separate_handling' ? form.separateHandlingSummary.trim() : null,
    referenceSetHash: current.referenceSetHash, documentsConsidered: [...form.documents].sort(), acknowledged: true,
    documentaryCorpus: {hash: current.documentaryCorpus.hash, membersHash: current.documentaryCorpus.membersHash,
      contributionReferences: current.documentaryCorpus.contributionReferences.flatMap(r => r.qualification === 'native_contribution' && r.contentHash ? [{id: r.id, contentHash: r.contentHash}] : []),
      evidenceReferences: current.documentaryCorpus.evidenceReferences.flatMap(r => r.qualification === 'native_stored_file' && r.evidence.state === 'received' ? [r.evidence] : [])}} : null;
  const refresh = () => {try {frame.capture(); setFormState(null); setFailedSource(null); void preview.refetch();} catch { /* No stale SDK re-entry. */ }};
  const verifyNew = async () => {
    try {
      if (!current || !draft || !documentary) throw new Error('Examinez et confirmez les sources actuelles.');
      const operation = frame.capture(), assertCurrent = () => {frame.assertCurrent(operation); documentary.assertCurrent();};
      assertCurrent(); await documentary.revalidate(); assertCurrent(); const fresh = await read(); assertCurrent();
      const tuple = (p: typeof current) => [p.source.sourceHash, p.semanticSourceHash, p.caseVersion, p.guardVersion, p.signalReferences, p.routes, p.documentaryCorpus, p.referenceSetHash, p.coverage, p.canConsiderRouteForSources, p.currentInstruction, p.currentForwardAllowedBySafety, p.currentReturnAllowedBySafety];
      if (!productReviewEqual(tuple(fresh), tuple(current))) throw new Error('Les sources, les signaux, le corpus ou le trajet ont changé. Relisez et recommencez l’examen explicite.');
      await documentary.revalidate(); assertCurrent(); return assertCurrent;
    } catch (e) {setFailedSource(key); setFormState(previous => previous?.key === sourceKey ? null : previous); throw e;}
  };
  const corpusRows = current && scope === 'admin' ? [
    ...current.signalReferences.map(r => ({id: `signal:${r.id}`, text: r.qualified ? `Signal ${r.id} — empreinte ${r.contentHash}` : 'Signal non qualifié : contenu et effets actuels inconnus.'})),
    ...current.documentaryCorpus.contributionReferences.map(r => ({id: `contribution:${r.id}`, text: r.qualification === 'native_contribution' ? `Contribution ${r.id} — empreinte ${r.contentHash}` : 'Contribution inconnue.'})),
    ...current.documentaryCorpus.evidenceReferences.map(r => ({id: `evidence:${r.qualification === 'native_stored_file' ? r.evidence.id : r.evidenceId}`, text: r.qualification === 'native_stored_file' ? `Pièce ${r.evidence.id} — génération ${r.evidence.generation} — empreinte ${r.evidence.contentHash} — ${r.evidence.state === 'received' ? 'dépôt enregistré' : 'dépôt à rapprocher'}` : 'Pièce inconnue.'}))] : [];
  return <View style={styles.section}>
    <Text style={styles.title}>Sécurité et instructions de transport</Text>
    <Text style={styles.body}>Un signal explicite de rappel ou d’hygiène déclenche un arrêt conservatoire des nouveaux transports. Il ne prouve pas un danger, une faute ou un état sanitaire et ne crée pas de gel de fonds. Les autres gardes et les recours commerciaux restent indépendants.</Text>
    <Button variant="secondary" disabled={!frame.focused || preview.isFetching || history.isFetching} onPress={refresh}>Relire les sources et instructions actuelles</Button>
    {preview.isFetching || history.isFetching ? <Text style={styles.caption}>Lecture native actuelle…</Text> : !documentary || !admitted || preview.error || history.error || failedSource === key || new Set(ids).size !== ids.length ? <Text accessibilityRole="alert" style={styles.body}>Les données actuelles et les nouvelles instructions sont masquées. Relisez les sources et les pièces du dossier ; votre propre journal reste accessible. Une lecture d’image ne certifie pas son contenu.</Text> : null}
    {current ? <>
      <Text style={styles.caption}>Lecture du dossier : {new Date(current.source.readAt).toLocaleString(APP_LOCALE)}. Cette observation n’est pas une garantie de fraîcheur en temps réel.</Text>
      <Text style={styles.body}>Aller : {current.currentForwardAllowedBySafety ? 'ce lecteur ne retient pas actuellement cet arrêt de sécurité pour ce trajet.' : 'le trajet doit rester suspendu ou être rapproché par l’équipe.'}</Text>
      <Text style={styles.body}>Retour : {current.currentReturnAllowedBySafety ? 'ce lecteur ne retient pas actuellement cet arrêt de sécurité pour ce trajet.' : 'le trajet doit rester suspendu ou être rapproché par l’équipe.'}</Text>
      <Text style={styles.caption}>Ces états concernent seulement le garde de sécurité. Ils ne suffisent pas à autoriser une étiquette, un nouvel envoi ou un retour. Un ancien document d’étiquette reste un document historique ; sa consultation n’autorise pas une nouvelle utilisation.</Text>
      <Text style={styles.body}>{current.currentInstruction.qualification === 'native_current_instruction' ? 'Instruction liée aux sources actuelles examinées' : current.currentInstruction.qualification === 'historical_sources_changed' ? 'Instruction historique — les sources ont changé' : current.currentInstruction.qualification === 'unrecorded' ? 'Aucune instruction native enregistrée dans cet aperçu.' : 'Applicabilité actuelle de l’instruction inconnue.'}</Text>
      {current.currentInstruction.instruction ? <><Text style={styles.body}>{actionLabels[current.currentInstruction.instruction.action]}</Text><Text selectable style={styles.body}>{current.currentInstruction.instruction.partyMessage}</Text>{current.currentInstruction.instruction.separateHandlingSummary ? <Text selectable style={styles.body}>{current.currentInstruction.instruction.separateHandlingSummary}</Text> : null}<Text style={styles.caption}>Enregistrée le {new Date(current.currentInstruction.instruction.recordedAt).toLocaleString(APP_LOCALE)}. Une instruction ne certifie ni une réception physique ni l’authenticité ou la sécurité du bien.</Text></> : null}
      {scope === 'admin' ? <>
        <Text selectable style={styles.caption}>Source {current.source.sourceHash} ; source physique {current.semanticSourceHash} ; version de garde {current.guardVersion ?? 'inconnue'} ; corpus {current.documentaryCorpus.hash} ; membres {current.documentaryCorpus.membersHash}. Aller {current.routes.forward ?? 'trajet inconnu'} ; retour {current.routes.return ?? 'trajet inconnu'}.</Text>
        <Text style={styles.caption}>Le corpus ci-dessous vient de ce seul aperçu natif. Inconnues, pièces en attente, sources non qualifiées ou dépassements empêchent la levée de l’arrêt pour un trajet.</Text>
        <View style={styles.list}><FlashList data={corpusRows} keyExtractor={r => r.id} renderItem={({item}) => <Text selectable style={styles.caption}>{item.text}</Text>} /></View>
        {current.referenceSet.documents.map(d => <View style={styles.section} key={d.id}><Button variant="secondary" onPress={() => {const op = frame.capture(); void Linking.openURL(d.url).then(() => frame.assertCurrent(op)).catch(() => {});}}>{documentLabels[d.id]}</Button><Checkbox checked={form.documents.includes(d.id)} onToggle={() => change({documents: form.documents.includes(d.id) ? form.documents.filter(v => v !== d.id) : [...form.documents, d.id]})}><Text style={styles.body}>Document effectivement considéré ; cet aperçu n’en télécharge pas le contenu.</Text></Checkbox></View>)}
        {PRODUCT_PHYSICAL_CRITERIA.map(criterion => <View style={styles.section} key={criterion}>
          <Text style={styles.body}>{criterionLabels[criterion]}</Text>
          {([{value: 'unknown', label: 'Inconnu'}, {value: 'declared', label: 'Déclaré'}, {value: 'examined', label: 'Examiné'}, {value: 'not_applicable', label: 'Non applicable'}] as const).map(q => <Button key={q.value} variant={form.assessments[criterion]?.qualification === q.value ? 'primary' : 'secondary'} onPress={() => change({assessments: {...form.assessments, [criterion]: {qualification: q.value, summary: form.assessments[criterion]?.summary ?? ''}}})}>{q.label}</Button>)}
          <TextInput accessibilityLabel={`Appréciation : ${criterionLabels[criterion]}`} maxLength={2000} multiline value={form.assessments[criterion]?.summary ?? ''} style={styles.input} onChangeText={summary => change({assessments: {...form.assessments, [criterion]: {qualification: form.assessments[criterion]?.qualification ?? null, summary}}})} />
        </View>)}
        {PRODUCT_PHYSICAL_ACTIONS.map(action => <Button key={action} variant={form.action === action ? 'primary' : 'secondary'} disabled={(action === 'allow_forward_only' || action === 'allow_return_only') && (!current.canConsiderRouteForSources || current.routes[action === 'allow_forward_only' ? 'forward' : 'return'] === null)} onPress={() => change({action})}>{actionLabels[action]}</Button>)}
        <TextInput accessibilityLabel="Motivation privée de l’instruction physique" placeholder="Motivation privée" value={form.privateNote} maxLength={4000} multiline style={styles.input} onChangeText={privateNote => change({privateNote})} />
        <TextInput accessibilityLabel="Message communicable aux deux parties" placeholder="Message adressé aux deux parties, avec les limites et inconnues" value={form.partyMessage} maxLength={4000} multiline style={styles.input} onChangeText={partyMessage => change({partyMessage})} />
        {form.action === 'no_reship_separate_handling' ? <TextInput accessibilityLabel="Traitement séparé sans réexpédition" placeholder="Précisez le traitement séparé sans réexpédition, sans déduire un remboursement ni inventer un procédé sanitaire" value={form.separateHandlingSummary} maxLength={4000} multiline style={styles.input} onChangeText={separateHandlingSummary => change({separateHandlingSummary})} /> : null}
        <Checkbox checked={form.accepted} onToggle={() => {try {frame.capture(); setFormState({...form, accepted: !form.accepted});} catch { /* No stale confirmation. */ }}}><Text style={styles.body}>J’ai examiné ces sources, les signaux, le corpus et ce seul trajet. Je confirme les appréciations et l’instruction motivée ; aucun effet financier, remise en vente, diagnostic ou certification n’est demandé.</Text></Checkbox>
      </> : null}
      {history.isSuccess && !history.isFetching && !history.error && new Set(ids).size === ids.length ? <>
        <Text style={styles.title}>Historique des instructions</Text>
        {entries.map(e => <View key={e.qualification === 'native_instruction' ? e.instruction.instructionId : e.instructionId} style={styles.section}>{e.qualification === 'native_instruction' ? <><Text style={styles.body}>{actionLabels[e.instruction.action]} — enregistrée le {new Date(e.instruction.recordedAt).toLocaleString(APP_LOCALE)}.</Text><Text selectable style={styles.body}>{e.instruction.partyMessage}</Text>{e.instruction.separateHandlingSummary ? <Text style={styles.body}>{e.instruction.separateHandlingSummary}</Text> : null}<Text style={styles.caption}>Cette ligne historique ne qualifie pas l’état ni les permissions actuels.</Text>{scope === 'admin' ? <Text style={styles.body}>{e.instruction.privateNote}</Text> : null}</> : <Text style={styles.body}>Une ligne historique ne peut pas être qualifiée.</Text>}</View>)}
        <Text style={styles.caption}>{history.data.pages.length} page(s) parcourue(s). L’historique accessible n’est pas certifié exhaustif.</Text>
        {history.hasNextPage ? <Button variant="secondary" onPress={() => {void history.fetchNextPage();}}>Lire les instructions suivantes</Button> : null}
      </> : null}
    </> : null}
    {scope === 'own' ? <Button variant="secondary" disabled={!frame.focused} onPress={() => {try {frame.capture(); router.push({pathname: '/settings/support', params: {transactionId: context.id}} as never);} catch { /* The support destination requalifies the native party. */ }}}>Demander un examen commercial au support</Button> : <ProductPhysicalCommandPanel uid={uid} context={context} draft={draft} enabled={!!current && !!draft} material={documentary?.materialCapability === 'product_review_material_v1'} parcel={documentary?.parcelCapability === 'product_review_parcel_v1'} verifyNew={verifyNew} onSourceError={() => setFailedSource(key)} onRecorded={() => {refresh(); void client.invalidateQueries({queryKey: ['product-review-source']});}} />}
    <Text style={styles.caption}>Aucune méthode médicale, décontamination, faute, frais à repayer, remboursement ou remise en vente ne découle automatiquement de ces déclarations ou instructions.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 7}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
