import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { PRODUCT_REVIEW_FACT_LABELS, PRODUCT_REVIEW_ROLE_LABELS, PRODUCT_REVIEW_TOPIC_LABELS } from '@/components/ProductReviewEntries';
import { colors, spacing, typography } from '@/constants/theme';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { TransactionService } from '@/services/transactionService';
import { ProductReviewEvidenceService } from '@/services/productReviewEvidenceService';
import { ProductReviewService, productReviewEqual } from '@/services/productReviewService';
import type { AdminFinancialPreview } from '@/services/adminFinancialDecisionJournal';
import type { ProductReviewEvidenceReference } from '@/types/productReviewEvidence';
import type { ProductReviewContribution, ProductReviewContributions, ProductReviewCursor } from '@/types/productReview';
import type { ProductMaterialSources } from '@/types/productMaterialReview';
import { ProductMaterialComparison } from '@/components/ProductMaterialComparison';
import { ProductParcelComparison } from '@/components/ProductParcelComparison';
import { ProductParcelOperatorRoutes } from '@/components/ProductParcelOperatorRoutes';
import { ProductParcelAssessmentSummary } from '@/components/ProductParcelAssessmentSummary';
import type { ProductParcelSources } from '@/types/productParcelReview';
import { LateCommercialFinancialSummary } from '@/components/LateCommercialFinancialSummary';
interface EvidenceRow {reference: ProductReviewEvidenceReference; opened: boolean; disabled: boolean; onOpen: (reference: ProductReviewEvidenceReference) => void}
const evidenceKey = (e: EvidenceRow) => e.reference.id;
const renderEvidence = ({item}: ListRenderItemInfo<EvidenceRow>) => <View style={styles.block}>
  <Text style={styles.caption}>{item.reference.typeDeclared === 'expertise_image' ? 'Image d’expertise déclarée' : item.reference.typeDeclared === 'received_item_photo' ? 'Photo déclarée du produit reçu' : 'Image de document de soutien'} · auteur {PRODUCT_REVIEW_ROLE_LABELS[item.reference.actorRole]}.</Text>
  <Text selectable style={styles.caption}>Pièce {item.reference.id} · contribution {item.reference.contributionId}.</Text>
  <Button variant="secondary" disabled={item.disabled} onPress={() => item.onOpen(item.reference)}>{item.opened ? 'Relire cette pièce privée exacte' : 'Ouvrir cette pièce privée exacte'}</Button>
</View>;
interface ContributionRow {contribution: ProductReviewContribution; materialSources: ProductMaterialSources | null; parcelSources: ProductParcelSources | null}
const contributionKey = (c: ContributionRow) => c.contribution.contributionId;
const renderContribution = ({item}: ListRenderItemInfo<ContributionRow>) => <View style={styles.block}>
  <Text style={styles.caption}>Déclaration {PRODUCT_REVIEW_ROLE_LABELS[item.contribution.actorRole]} · {PRODUCT_REVIEW_TOPIC_LABELS[item.contribution.topic]}.</Text><Text selectable style={styles.body}>{item.contribution.statement}</Text>
  {item.materialSources && item.contribution.materialStatement ? <ProductMaterialComparison sources={item.materialSources} statement={item.contribution.materialStatement} statementState="recorded" recordedAt={item.contribution.recordedAt} /> : null}
  {item.parcelSources && item.contribution.parcelStatement ? <ProductParcelComparison sources={item.parcelSources} statement={item.contribution.parcelStatement} recordedAt={item.contribution.recordedAt} /> : null}
  {Object.entries(item.contribution.facts).map(([name, value]) => <Text key={name} selectable style={styles.caption}>{PRODUCT_REVIEW_FACT_LABELS[name as keyof typeof PRODUCT_REVIEW_FACT_LABELS]} : {value ?? 'inconnu, aucune information déclarée'}.</Text>)}
</View>;
/** Every opened private image is followed by a full current financial-source requalification. */
export function AdminProductFinancialReview({uid, preview, enabled, onCurrentReadChange, assertSelection}: {uid: string; preview: AdminFinancialPreview;
  enabled: boolean; onCurrentReadChange: (current: boolean, allEvidenceOpened: boolean) => void; assertSelection?: () => void}) {
  const parcel = preview.productReview?.parcelCapability === 'product_review_parcel_v1';
  const context = useProductParcelContext(JSON.stringify(['admin-product-financial-review', preview.previewId, enabled]), uid, parcel || !!preview.productReview?.lateCommercial);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), preview.previewId, preview.sourceHash, context.focusRevision, enabled]);
  const currentContext = useRef({key, context}); useLayoutEffect(() => {currentContext.current = {key, context};}, [key, context]);
  const [frame, setFrame] = useState<{key: string; selected: ProductReviewEvidenceReference | null; opened: string[]} | null>(null);
  const currentFrame = frame?.key === key ? frame : {key, selected: null, opened: []};
  const query = useQuery({queryKey: ['admin-product-financial-review', key, currentFrame.selected], enabled: enabled && context.focused && !!preview.productReview,
    staleTime: 0, gcTime: 0, retry: false, queryFn: async () => {
      const op = context.capture(), current = () => {context.assertCurrent(op); assertSelection?.();}; current();
      const productContext = {kind: 'order' as const, id: preview.transactionId};
      const material = preview.productReview?.materialCapability === 'product_review_material_v1';
      const parcel = preview.productReview?.parcelCapability === 'product_review_parcel_v1';
      const documentary = await ProductReviewService.workflowPreview(uid, productContext, 'admin', null, current, true, material, parcel); current();
      if ((preview.productReview?.topic === 'parcel_delivery' ? !documentary.parcelReview?.integrityQualified : !documentary.coverage.documentaryCompleteCurrentCaseSet) || documentary.documentaryCorpusHash !== preview.productReview!.corpusHash)
        throw new Error('Le corpus courant a changé.');
      const contributions: ProductReviewContribution[] = []; let cursor: ProductReviewCursor | null = null;
      for (let pageIndex = 0; pageIndex < 5; pageIndex++) {
        const page: ProductReviewContributions = await ProductReviewService.page(uid, productContext, 'admin', 'contributions', cursor, current, documentary.source.sourceHash, true, documentary.documentaryCorpusHash, material, parcel,parcel,parcel); current();
        for (const entry of page.entries) {if (entry.qualification !== 'native_actor_contribution') throw new Error('Déclaration inconnue.'); contributions.push(entry.contribution);}
        cursor = page.nextCursor; if (!cursor) break;
      }
      if (cursor || contributions.length !== preview.productReviewSource?.contributionReferences.length || new Set(contributions.map(c => c.contributionId)).size !== contributions.length ||
        contributions.some(c => !preview.productReviewSource!.contributionReferences.some(r => r.id === c.contributionId && r.actorId === c.actorId && r.actorRole === c.actorRole && r.topic === c.topic)))
        throw new Error('Les déclarations actuelles ne correspondent plus au corpus.');
      const pixels = currentFrame.selected ? await ProductReviewEvidenceService.file(uid, {kind: 'order', id: preview.transactionId}, 'admin', currentFrame.selected, current, material, parcel) : null;
      const fresh = await TransactionService.previewAdminFinancialDecision(preview.transactionId, preview.expectedDisputeId, uid, preview.decisionType, current,
        'product_review', preview.resume, undefined, preview.productReview!.caseId, preview.productReview!.topic, material, parcel, preview.allocation, preview.productReview!.lateCommercial); current();
      if (fresh.previewId !== preview.previewId || fresh.sourceHash !== preview.sourceHash || !productReviewEqual(fresh.productReview, preview.productReview) ||
        !productReviewEqual(fresh.productReviewSource, preview.productReviewSource) || !productReviewEqual(fresh.allocation ?? null, preview.allocation ?? null) || !productReviewEqual(fresh.allocationSource ?? null, preview.allocationSource ?? null)) throw new Error('Le corpus ou les faits ont changé.');
      return {fresh, pixels, contributions, materialSources: documentary.source.protocol === 'product_review_source_v3' || documentary.source.protocol === 'product_review_source_v4' ? documentary.source.materialAttributes : null,
        parcelSources: documentary.source.protocol === 'product_review_source_v4' ? documentary.source.parcelSources : null, operatorRoutes: documentary.operatorParcelRoutes ?? null};
    }});
  const data = enabled && context.focused && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  const source = data?.fresh.productReviewSource;
  const allOpened = !!source && source.evidenceReferences.every(e => currentFrame.opened.includes(e.id));
  useEffect(() => {let current = !!source, opened = allOpened;
    if (parcel && (current || opened)) {try {if (currentContext.current.key !== key) throw new Error('La lecture a changé.'); currentContext.current.context.capture();} catch {current = false; opened = false;}}
    try {assertSelection?.();} catch {return;}
    onCurrentReadChange(current, opened); return () => {try {assertSelection?.(); onCurrentReadChange(false, false);} catch { /* A superseded source cannot reset the new form. */ }};
  }, [source, allOpened, onCurrentReadChange, parcel, key, assertSelection]);
  const evidenceRows: EvidenceRow[] = source?.evidenceReferences.map(reference => ({reference, opened: currentFrame.opened.includes(reference.id), disabled: query.isFetching,
    onOpen: selected => {try {context.capture(); assertSelection?.(); setFrame(old => ({key, selected, opened: old?.key === key ? old.opened : []}));} catch { /* Stale private selection. */ }}})) ?? [];
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Issue documentaire et pièces examinées</Text>
    {!source ? <Text accessibilityRole="alert" style={styles.caption}>{query.isError ? 'Les sources ont changé ou ne sont plus accessibles. Fermez cet aperçu puis relisez explicitement le dossier.' : 'Les sources et le corpus privés sont en cours de qualification.'}</Text> : <>
      <Text selectable style={styles.body}>{source.issue.text}</Text>
      {source.lateCommercial ? <LateCommercialFinancialSummary situation={source.lateCommercial.financialSituation} /> : null}
      <Text selectable style={styles.caption}>Motivation de l’issue documentaire : {source.issue.motivation ?? 'aucune motivation supplémentaire déclarée'}.</Text>
      {data.operatorRoutes ? <ProductParcelOperatorRoutes routes={data.operatorRoutes} /> : null}
      {source.parcelReview ? <><Text style={styles.caption}>L’appréciation native des sources disponibles est qualifiée. {source.parcelReview.documentaryComplete ? 'Le corpus documentaire est complet dans cette lecture.' : 'L’issue conserve les informations incomplètes ; elle ne certifie pas un examen complet.'} Responsabilité, assurance et attribution de frais restent non décidées.</Text>
        <ProductParcelAssessmentSummary assessment={source.parcelReview.assessment} /></> : null}
      {source.parcelReturnReview ? <Text style={styles.caption}>{source.parcelReturnReview.qualifiesOwnReturnForFinancialReview ? 'Le suivi natif du retour et une déclaration vendeur de réception sont liés à cet aperçu ; le contenu physique et la faute restent non certifiés.' : 'La réception propre du retour ne peut pas être qualifiée dans cet aperçu.'}</Text> : null}
      {source.materialReturnReview ? <Text style={styles.caption}>{source.materialReturnReview.qualification === 'native_parcel_with_actor_return_declaration' ?
        'Le suivi natif du colis de retour et une déclaration de contenu reçu par le vendeur sont liés à cet aperçu. Ils ne certifient pas le contenu physique ou une faute.' :
        source.materialReturnReview.qualification === 'not_applicable' ? 'Aucun retour n’est enregistré dans cet aperçu ; aucun constat de réception en retour n’est déduit.' :
        'La réception du retour ou sa déclaration ne peut pas être qualifiée. Aucune réception physique n’est déduite.'}</Text> : null}
      <Text style={styles.caption}>Version {source.reference.caseVersion}, {source.contributionReferences.length} déclaration(s), {source.evidenceReferences.length} pièce(s) de ce corpus natif. Les originaux d’un émetteur et l’authenticité du produit ne sont pas certifiés.</Text>
      <Text selectable style={styles.caption}>Issue : {source.reference.issueId} · corpus : {source.reference.corpusHash}.</Text>
      <View style={styles.list}><FlashList data={data.contributions.map(contribution => ({contribution, materialSources: data.materialSources, parcelSources: data.parcelSources}))} keyExtractor={contributionKey} renderItem={renderContribution} nestedScrollEnabled /></View>
      <View style={styles.list}><FlashList data={evidenceRows} keyExtractor={evidenceKey} renderItem={renderEvidence} nestedScrollEnabled /></View>
      {data.pixels ? <><Image source={{uri: data.pixels.dataUrl}} style={styles.image} contentFit="contain" cachePolicy="none" recyclingKey={JSON.stringify([key, data.pixels.evidenceId, data.pixels.generation])} />
        <Text style={styles.caption}>Octets privés liés à leur génération et empreinte natives. L’expertise, le contenu physique et la décision financière restent distincts.</Text>
        <Button variant="secondary" disabled={!currentFrame.selected || currentFrame.opened.includes(data.pixels.evidenceId)} onPress={() => {
          try {context.capture(); assertSelection?.(); if (currentFrame.selected && data.pixels?.evidenceId === currentFrame.selected.id) setFrame({...currentFrame, opened: [...currentFrame.opened, currentFrame.selected.id]});} catch { /* Old pixels grant no fresh opening. */ }
        }}>Confirmer l’ouverture de cette pièce exacte</Button></> : null}
      <Text style={styles.caption}>{allOpened ? 'Toutes les pièces de cet aperçu ont été ouvertes dans cette lecture actuelle. Votre examen et votre motivation restent nécessaires.' :
        'Ouvrez toutes les pièces de ce corpus avant de confirmer l’examen. Toute modification impose un nouvel aperçu.'}</Text>
    </>}
    <Button variant="secondary" disabled={!enabled || !context.focused || query.isFetching} onPress={() => {try {context.capture(); assertSelection?.(); setFrame({key, selected: null, opened: []}); void query.refetch();} catch { /* Explicit reading needs current activity. */ }}}>Relire le corpus et les sources actuels</Button>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, block: {gap: spacing.xs, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 8}, image: {width: '100%', height: spacing.xl * 8}});
