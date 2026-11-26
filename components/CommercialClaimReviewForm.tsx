import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Input } from '@/components/ui';
import { useLabelLifecycleContext } from '@/hooks/useLabelLifecycleContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { COMMERCIAL_CLAIM_REVIEW_ENABLED } from '@/config/featureFlags';
import { CommercialClaimReviewService as Service, commercialClaimReviewFailure } from '@/services/commercialClaimReviewService';
import { CommercialClaimReviewJournal as Journal } from '@/services/commercialClaimReviewJournal';
import { productReviewEqual } from '@/services/productReviewService';
import { COMMERCIAL_CLAIM_ACTION_LABELS, COMMERCIAL_CLAIM_LIMITS, createCommercialClaimInteraction } from '@/utils/commercialClaimReviewPresentation';
import { COMMERCIAL_CLAIM_REVIEW_CAPABILITY, type CommercialClaimNewContribution, type CommercialClaimReviewCommand,
  type CommercialClaimReviewSource, type CommercialClaimReviewAttempt } from '@/types/commercialClaimReview';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import type { ProductReviewContributionEntry } from '@/types/productReview';
import { colors, spacing, typography } from '@/constants/theme';

export function CommercialClaimReviewForm({uid, source, contributions, nativeAdmission, assertSelection, onRecorded}: {
  uid: string; source: CommercialClaimReviewSource; contributions: ProductReviewContributionEntry[];
  nativeAdmission: ProductPhysicalDocumentaryAdmission | null; assertSelection: () => void; onRecorded: () => void;
}) {
  const frame = useLabelLifecycleContext(`commercial-claim-form:${source.transactionId}:${source.claimId}`, uid), client = useQueryClient(), lock = useRef(false);
  const [interaction] = useState(createCommercialClaimInteraction), generation = getAuthSessionGeneration();
  const key = JSON.stringify([uid, generation, source.claimId, source.source?.reference, nativeAdmission?.key, frame.focusRevision]);
  const [formFrame, setFormFrame] = useState(() => ({key, interaction: createCommercialClaimInteraction()}));
  let currentFormFrame = formFrame;
  if (formFrame.key !== key) {
    formFrame.interaction.invalidate();
    currentFormFrame = {key, interaction: createCommercialClaimInteraction()};
    setFormFrame(currentFormFrame);
  }
  const assertFormKey = currentFormFrame.interaction.capture();
  const empty = {key, action: null as CommercialClaimReviewCommand['action'] | null, candidate: null as CommercialClaimNewContribution | null, narrative: '', acknowledged: false};
  const [draft, setDraft] = useState<typeof empty | null>(null), [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const form = draft?.key === key ? draft : empty, choice = interaction.capture(), s = source.source;
  const currentChoice = () => {frame.capture(); assertSelection(); choice(); assertFormKey();};
  const journal = useQuery({queryKey: ['commercial-claim-own-journal', uid, generation, frame.focusRevision], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = frame.capture(); return Journal.read(uid, () => frame.assertCurrent(op));}});
  const allowed = COMMERCIAL_CLAIM_REVIEW_ENABLED && frame.focused && source.scope === 'own' && source.actorId === uid && source.qualification === 'native_original_claim' && !!s && journal.isSuccess && !journal.isFetching && !journal.isError && journal.data === null;
  const admissionMatches = !!s && !!nativeAdmission && nativeAdmission.uid === uid && nativeAdmission.scope === 'own' && nativeAdmission.context.id === source.transactionId && nativeAdmission.sourceHash === s.documentarySourceHash && nativeAdmission.corpusHash === s.reference.corpusHash && nativeAdmission.materialCapability === s.materialCapability && nativeAdmission.parcelCapability === s.parcelCapability;
  const candidates = s?.newContributionCandidates.flatMap(reference => {
    const row = contributions.find(entry => entry.qualification === 'native_actor_contribution' && entry.contribution.actorId === uid && entry.contribution.actorRole === 'buyer' && entry.contribution.contributionId === reference.id && entry.contribution.topic === reference.topic);
    return row?.qualification === 'native_actor_contribution' ? [{reference, statement: row.contribution.statement}] : [];
  }) ?? [];
  const update = (patch: Partial<typeof form>) => {try {currentChoice(); interaction.invalidate(); setDraft({...form, ...patch, acknowledged: patch.acknowledged ?? false});} catch { /* Synchronous form replacement invalidates older NEW callbacks. */ }};
  const canRequest = !!s && s.reviewState === 'withdrawn' && !!s.latestReference && s.documentaryComplete && admissionMatches;
  const ready = allowed && !!s && !!form.action && !!form.narrative.trim() && form.acknowledged && (form.action === 'withdraw_claim' ? s.reviewState !== 'withdrawn' : canRequest && !!form.candidate && candidates.some(row => productReviewEqual(row.reference, form.candidate)));
  const submit = async () => {
    if (!ready || !s || !form.action || lock.current) return; let op; try {op = frame.start();} catch {return;} if (!op) return;
    lock.current = true; setBusy(key); setNotice(null);
    const current = () => {
      frame.assertCurrent(op); assertSelection(); choice(); if (!COMMERCIAL_CLAIM_REVIEW_ENABLED) throw commercialClaimReviewFailure();
      if (form.action === 'request_reexamination') {
        assertFormKey(); if (!nativeAdmission || !admissionMatches) throw commercialClaimReviewFailure(); nativeAdmission.assertCurrent();
      }
    };
    const command: CommercialClaimReviewCommand = {transactionId: source.transactionId, claimId: source.claimId, action: form.action, source: s.reference,
      narrative: form.narrative.trim(), withdrawal: form.action === 'request_reexamination' ? s.latestReference : null,
      newContribution: form.action === 'request_reexamination' ? form.candidate : null, acknowledged: true};
    const attempt: CommercialClaimReviewAttempt = {version: 1, uid, requestId: randomUUID(), capability: COMMERCIAL_CLAIM_REVIEW_CAPABILITY, command};
    const verifyNew = async () => {
      current();
      if (command.action === 'request_reexamination') {if (!nativeAdmission || !admissionMatches) throw commercialClaimReviewFailure(); nativeAdmission.assertCurrent(); await nativeAdmission.revalidate(); current(); nativeAdmission.assertCurrent();}
      const fresh = await Service.source(uid, source.transactionId, source.claimId, 'own', current); current();
      if (fresh.qualification !== 'native_original_claim' || !fresh.source || !productReviewEqual(fresh.source.reference, command.source) || !productReviewEqual(fresh.source.latestReference, s.latestReference) || fresh.source.reviewState !== s.reviewState || command.action === 'request_reexamination' && (!fresh.source.documentaryComplete || !fresh.source.newContributionCandidates.some(candidate => productReviewEqual(candidate, command.newContribution)))) throw commercialClaimReviewFailure();
    };
    try {
      current(); await Journal.prepare(attempt, current); current(); const receipt = await Journal.executeNew(attempt, current, verifyNew); current();
      setNotice({key, text: receipt.state === 'committed' ? 'Votre démarche documentaire exacte est enregistrée. Une admission distincte reste nécessaire pour tout réexamen opérateur.' : receipt.state === 'not_executed' ? 'Cette intention n’a pas été exécutée. Relisez son reçu avant une autre démarche.' : 'Le résultat reste inconnu ; conservez la même intention.'});
      if (receipt.state === 'committed') {current(); onRecorded();}
    } catch (error) {try {current(); setNotice({key, text: `${error instanceof Error ? error.message : 'Résultat inconnu.'} L’intention conservée reste à relire dans votre journal.`});} catch { /* No historical or superseded reply can change a new draft. */ }}
    finally {frame.finish(op); lock.current = false; if (frame.isCurrent(op)) {
      try {current(); setBusy(null);} catch { /* A changed admission cannot update a replacement form. */ }
      void client.invalidateQueries({queryKey: ['commercial-claim-own-journal', uid]});
    }}
  };
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.body}>Votre démarche documentaire pour cette plainte</Text><Text style={styles.caption}>{COMMERCIAL_CLAIM_LIMITS}</Text>
    {!COMMERCIAL_CLAIM_REVIEW_ENABLED ? <Text style={styles.caption}>Les nouvelles démarches sont en préparation. Votre journal et les reçus antérieurs restent accessibles séparément.</Text> : null}
    <Button variant={form.action === 'withdraw_claim' ? 'primary' : 'secondary'} disabled={!allowed || s?.reviewState === 'withdrawn' || busy === key} onPress={() => update({action: 'withdraw_claim', candidate: null})}>{COMMERCIAL_CLAIM_ACTION_LABELS.withdraw_claim}</Button>
    <Button variant={form.action === 'request_reexamination' ? 'primary' : 'secondary'} disabled={!allowed || !canRequest || busy === key} onPress={() => update({action: 'request_reexamination', candidate: null})}>{COMMERCIAL_CLAIM_ACTION_LABELS.request_reexamination}</Button>
    <Text style={styles.caption}>Après le retrait, ajoutez un nouveau constat acheteur d’authenticité ou de différence matérielle dans le dossier article, puis relisez tout le corpus et cette plainte. Un ancien élément ou un simple nouveau récit ne remplace pas cette preuve native. La demande conserve la plainte initiale et ses délais ; elle ne l’ouvre pas automatiquement.</Text>
    {form.action === 'request_reexamination' ? candidates.map(row => <View key={row.reference.id} style={styles.section}><Text selectable style={styles.body}>{row.statement}</Text><Text selectable style={styles.caption}>Nouvelle référence native {row.reference.id} · {row.reference.contentHash}.</Text><Button variant={productReviewEqual(form.candidate, row.reference) ? 'primary' : 'secondary'} disabled={!allowed || !canRequest || busy === key} onPress={() => update({candidate: row.reference})}>Choisir explicitement ce nouvel élément</Button></View>) : null}
    {s?.reviewState === 'withdrawn' && (!candidates.length || !admissionMatches) ? <Text style={styles.caption}>Le nouvel élément et la lecture documentaire exacte ne sont pas encore qualifiés pour cette source. Aucun réexamen n’est déduit de cette absence.</Text> : null}
    <Input label="Motivation de cette démarche exacte" value={form.narrative} multiline maxLength={4000} disabled={!allowed || !form.action || busy === key} onChangeText={narrative => update({narrative})}/>
    <Checkbox checked={form.acknowledged} disabled={!allowed || !form.action || busy === key} onToggle={() => update({acknowledged: !form.acknowledged})}><Text style={styles.caption}>Je confirme cette seule démarche documentaire, sa plainte et ses références. Elle ne modifie aucun résultat financier ou ancien droit ; un réexamen exige une admission opérateur distincte.</Text></Checkbox>
    <Button disabled={!ready || busy === key} onPress={() => {void submit();}}>Enregistrer uniquement cette démarche</Button>
    {notice?.key === key ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
