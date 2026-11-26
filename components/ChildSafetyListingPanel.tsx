import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { ArticleChildSafetyFields } from '@/components/ArticleChildSafetyFields';
import { ChildSafetyCommandPanel } from '@/components/ChildSafetyCommandPanel';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ChildSafetyReviewService } from '@/services/childSafetyReviewService';
import { ProductReviewService, productReviewEqual, productReviewHash } from '@/services/productReviewService';
import { ArticlesService } from '@/services/articlesService';
import { colors, spacing, typography } from '@/constants/theme';
export function ChildSafetyListingPanel({uid, articleId}: {uid: string; articleId: string}) {
  const router = useRouter(), frame = useShippingPurchaseContext(`child-safety-listing:${articleId}`, uid);
  const key = JSON.stringify([uid, articleId, getAuthSessionGeneration(), frame.focusRevision]);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const read = async () => {
    const operation = frame.capture(), current = () => frame.assertCurrent(operation);
    const observed = await ProductReviewService.preview(uid, {kind: 'article_listing', id: articleId}, current); current();
    if (observed.source.protocol !== 'product_review_source_v2') throw new Error('Cette préparation doit être relue.');
    const publication = await ChildSafetyReviewService.publicationPreview(uid, articleId, current); current();
    const revision = observed.source.contextSource.revision?.split(':');
    const expected = revision ? await productReviewHash([articleId, uid, Number(revision[0]), Number(revision[1])]) : null; current();
    if (expected !== publication.articleRevision || observed.source.listingSubmission.childSafety.sourceHash !== publication.source.sourceHash) throw new Error('Les sources ont changé pendant la lecture. Relisez le dossier.');
    return {source: observed.source, publication};
  };
  const query = useQuery({queryKey: ['child-safety-listing', key], enabled: frame.focused, staleTime: 0, gcTime: 0, retry: false, queryFn: read});
  const current = frame.focused && failedSource !== key && query.isSuccess && !query.isFetching && !query.error ? query.data : null;
  const sourceKey = current ? JSON.stringify([key, current.source.sourceHash, current.publication.articleRevision, current.publication.commandSource, current.source.readAt]) : '';
  const [accepted, setAccepted] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null);
  const verified = async () => {try {if (!current || !sourceKey) throw new Error('Relisez les sources actuelles.'); const fresh = await read(); if (!productReviewEqual(fresh.publication, current.publication) || fresh.source.sourceHash !== current.source.sourceHash) throw new Error('Cette source a changé. Relisez et examinez à nouveau la préparation.');} catch (e) {setFailedSource(key); setAccepted(null); throw e;}};
  const withdraw = async () => {
    if (!current?.publication.canWithdrawPreparationNow || busy === key) return;
    const operation = frame.capture(), guard = () => frame.assertCurrent(operation); setBusy(key); setAccepted(null);
    try {await verified(); guard(); await ArticlesService.updateArticle(articleId, {isActive: false}); guard(); await query.refetch(); guard();}
    catch (e) {if (frame.isCurrent(operation)) {setFailedSource(key); Alert.alert('État à relire', e instanceof Error ? e.message : 'L’état reste inconnu. Relisez avant une autre action.');}}
    finally {if (frame.isCurrent(operation)) setBusy(null); frame.finish(operation);}
  };
  return <View style={styles.section}>
    <Text style={styles.title}>Préparation de l’annonce enfant</Text>
    {query.isFetching || query.isPending ? <Text style={styles.body}>Lecture native de l’état actuel…</Text> : query.error || failedSource === key ? <Text style={styles.body}>L’état actuel n’a pas pu être qualifié. Les actions et les anciennes données sont masquées ; votre propre journal reste accessible.</Text> : null}
    <Button variant="secondary" disabled={!frame.focused || busy === key} onPress={() => {setAccepted(null); setFailedSource(null); void query.refetch();}}>Relire la préparation actuelle</Button>
    {current ? <>
      <Text style={styles.body}>{current.source.listingSubmission.isActive === true && current.source.listingSubmission.moderationStatus === 'approved' ? 'La lecture native actuelle indique une annonce en ligne.' : current.publication.blockers.includes('preparation_withdrawn') ? 'Préparation retirée. Elle ne peut pas être rouverte par ce parcours.' : current.source.listingSubmission.isActive === false && current.source.listingSubmission.moderationStatus === 'pending' && !current.publication.blockers.includes('preparation_unqualified') ? 'Préparation enregistrée — votre article reste hors ligne pendant l’examen.' : 'L’état ne qualifie aucune nouvelle publication.'}</Text>
      <ArticleChildSafetyFields categoryIds={current.source.sources.currentListing.content.categoryIds ?? []} value={current.publication.source.declaration} readOnly required />
      <Text style={styles.caption}>{current.publication.admissionQualification === 'native_current_allow' ? 'Une autorisation documentaire actuelle a été qualifiée pour ces sources. La publication reste un geste séparé.' : 'Aucune autorisation actuelle de publication n’a été qualifiée.'} L’examen documentaire et l’admission ne certifient pas la conformité physique du produit.</Text>
      {current.publication.canCorrectPreparationNow ? <Button variant="secondary" disabled={busy === key} onPress={() => {void verified().then(() => {frame.capture(); router.push({pathname: '/article/edit/[id]', params: {id: articleId}} as Href);}).catch(e => Alert.alert('Préparation à relire', e instanceof Error ? e.message : 'La lecture a changé.'));}}>Corriger les renseignements</Button> : null}
      {current.publication.canWithdrawPreparationNow ? <Button variant="secondary" disabled={busy === key} onPress={() => Alert.alert('Retirer la préparation', 'Cette préparation sera retirée. Une ancienne autorisation ou un ancien reçu ne la rouvrira pas.', [{text: 'Conserver', style: 'cancel'}, {text: 'Retirer', onPress: () => {void withdraw();}}])}>Retirer la préparation</Button> : null}
      {current.publication.canPublishNow ? <Checkbox checked={accepted === sourceKey} onToggle={() => setAccepted(accepted === sourceKey ? null : sourceKey)}><Text style={styles.body}>J’ai relu les renseignements et l’autorisation actuelle. Je demande explicitement la publication de cette préparation entière.</Text></Checkbox> : <Text style={styles.caption}>La publication reste bloquée par les gardes actuels. Une réponse du support, une photographie ou une date ne l’autorise pas.</Text>}
    </> : null}
    <ChildSafetyCommandPanel uid={uid} articleId={articleId} kind="publication" sourceKey={sourceKey} enabled={!!current?.publication.canPublishNow && accepted === sourceKey && frame.focused} draft={current?.publication.commandSource ? {...current.publication.commandSource, acknowledged: true} : null} verifyNew={verified} onRecorded={() => {setAccepted(null); setFailedSource(null); void query.refetch();}} />
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.md}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
