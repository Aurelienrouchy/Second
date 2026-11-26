import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Button, Checkbox } from '@/components/ui';
import { ProductReviewCommandPanel } from '@/components/ProductReviewCommandPanel';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ProductReviewService, productReviewEqual, isProductCommercialReturnContestReference } from '@/services/productReviewService';
import { PRODUCT_COMMERCIAL_RETURN_LABELS } from '@/utils/productCommercialReturnContract';
import type { ProductCommercialReturnInstruction } from '@/types/productCommercialReturn';
import type { ProductCommercialReturnContestReference, ProductReviewWorkflowCommand, ProductReviewWorkflowPreviewV2 } from '@/types/productReview';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
interface Form {key: string; instruction: ProductCommercialReturnContestReference | null; text: string; confirmed: boolean}
const reference = (i: ProductCommercialReturnInstruction): ProductCommercialReturnContestReference => ({...i.instructionReference, caseVersion: i.caseVersion});
const instructionKey = (i: ProductCommercialReturnInstruction) => `${i.instructionReference.instructionId}:${i.caseVersion}`;
const qualification = (p: ProductReviewWorkflowPreviewV2) => [p.source.sourceHash, p.caseVersion, p.documentaryCorpusHash, p.parcelReview,
  p.contributionReferences, p.communicationReferences, p.evidenceReferences, p.coverage, p.options, p.commercialReturnInstruction];
/** A seller's disagreement is a new addressed communication, never a replacement of the instruction. */
export function ProductCommercialReturnContestPanel({uid, transactionId, instructions, seller, nativeAdmission, onRecorded}: {
  uid: string; transactionId: string; instructions: ProductCommercialReturnInstruction[]; seller: boolean;
  nativeAdmission: ProductPhysicalDocumentaryAdmission | null; onRecorded: () => void;
}) {
  const documentary = nativeAdmission?.uid === uid && nativeAdmission.scope === 'own' && nativeAdmission.context.kind === 'order' && nativeAdmission.context.id === transactionId && nativeAdmission.parcelCapability === 'product_review_parcel_v1' ? nativeAdmission : null;
  const frame = useProductParcelContext(JSON.stringify(['product-commercial-contest', transactionId, seller, documentary?.key ?? null]), uid, true);
  const key = JSON.stringify([uid, transactionId, getAuthSessionGeneration(), frame.focusRevision, documentary?.key ?? null, seller, instructions.map(reference)]);
  const [formState, setForm] = useState<Form | null>(null), [failed, setFailed] = useState<string | null>(null);
  const interaction = useRef(0);
  const form = formState?.key === key ? formState : {key, instruction: null, text: '', confirmed: false};
  const selected = seller && documentary && frame.focused && form.instruction && instructions.some(i => productReviewEqual(reference(i), form.instruction)) ? form.instruction : null;
  const capture = () => {const op = frame.capture(), assertCurrent = () => {frame.assertCurrent(op); if (!documentary) throw new Error('Relisez les sources documentaires du dossier.'); documentary.assertCurrent();}; assertCurrent(); return assertCurrent;};
  const read = async () => {const current = capture(); if (!selected) throw new Error('Choisissez une instruction commerciale exacte.');
    const value = await ProductReviewService.workflowPreview(uid, {kind: 'order', id: transactionId}, 'own', null, current, true, true, true, selected); current();
    if (!documentary || value.source.sourceHash !== documentary.sourceHash || value.documentaryCorpusHash !== documentary.corpusHash || !value.commercialReturnInstruction) throw new Error('Les sources, les pièces ou l’instruction doivent être relues.'); return value;};
  const preview = useQuery({queryKey: ['product-commercial-return-contest-preview', key, selected], enabled: !!selected && failed !== key && frame.focused,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false, queryFn: read});
  const current = selected && frame.focused && failed !== key && preview.isSuccess && !preview.isFetching && !preview.isError ? preview.data : null;
  const draft: ProductReviewWorkflowCommand | null = current && form.confirmed && form.text.trim() && current.options.includes('contest') && current.commercialReturnInstruction && selected ? {
    context: {kind: 'order', id: transactionId}, sourceHash: current.source.sourceHash, kind: 'contest', text: form.text.trim(), targetRoles: [], privateNote: null,
    result: null, contributionReferences: [], parent: null, acknowledged: false, commercialReturnInstruction: selected} : null;
  const refresh = () => {try {frame.capture(); interaction.current++; setForm({...form, confirmed: false}); setFailed(null); void preview.refetch();} catch { /* No NEW admission from a stale frame. */ }};
  const verify = async () => {
    if (!current || !draft || !documentary || !selected) throw new Error('Examinez et confirmez cette instruction et votre motif.');
    const assertFrame = capture(), epoch = interaction.current, assertCurrent = () => {assertFrame(); if (interaction.current !== epoch) throw new Error('Votre instruction ou votre motif a changé.');};
    try {assertCurrent(); await documentary.revalidate(); assertCurrent(); const fresh = await read(); assertCurrent();
      if (!productReviewEqual(qualification(fresh), qualification(current))) throw new Error('Les sources, les pièces ou la référence ont changé. Relisez avant de contester.');
      await documentary.revalidate(); assertCurrent(); return assertCurrent;
    } catch (error) {setFailed(key); setForm({...form, confirmed: false}); throw error;}
  };
  const renderInstruction = useCallback(({item}: ListRenderItemInfo<ProductCommercialReturnInstruction>) => <Button variant={productReviewEqual(selected, reference(item)) ? 'primary' : 'secondary'} disabled={!isProductCommercialReturnContestReference(reference(item))} onPress={() => {try {frame.capture(); interaction.current++; setForm({key, instruction: reference(item), text: '', confirmed: false}); setFailed(null);} catch { /* No selection from old activity. */ }}}>
    {`${PRODUCT_COMMERCIAL_RETURN_LABELS[item.action]} · version ${item.caseVersion} · ${new Date(item.recordedAt).toLocaleString(APP_LOCALE)}`}</Button>, [selected, frame, key, setForm, setFailed]);
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Contester une instruction commerciale de retour</Text>
    <Text style={styles.caption}>Le vendeur choisit l’instruction et sa version, puis motive sa demande de nouvel examen. La contestation conserve l’instruction d’origine et ne crée aucun remboursement, frais, autorisation de transport ou reconnaissance de réception.</Text>
    {seller && documentary && frame.focused && instructions.length ? <View style={styles.list}><FlashList data={instructions} keyExtractor={instructionKey} renderItem={renderInstruction} nestedScrollEnabled /></View> : null}
    {selected ? <Button variant="secondary" disabled={preview.isFetching} onPress={refresh}>Relire cette instruction et les sources actuelles</Button> : null}
    {preview.isFetching ? <Text style={styles.caption}>Lecture native de l’instruction choisie…</Text> : selected && (!current || preview.isError) ? <Text accessibilityRole="alert" style={styles.caption}>La nouvelle contestation est masquée. Relisez l’instruction et les pièces ; votre propre intention conservée reste consultable.</Text> : null}
    {current?.commercialReturnInstruction ? <><Text selectable style={styles.body}>{current.commercialReturnInstruction.partyMessage}</Text>
      <Text selectable style={styles.caption}>Instruction {selected?.instructionId} · version {selected?.caseVersion}. Enregistrée le {new Date(current.commercialReturnInstruction.recordedAt).toLocaleString(APP_LOCALE)}.</Text>
      <Text style={styles.caption}>{current.commercialReturnInstruction.currentPointerMatches ? 'La commande référence encore cette instruction.' : 'La commande référence une autre instruction ; vous contestez la version affichée.'} Cela n’autorise pas à expédier ou à rembourser.</Text>
      <TextInput accessibilityLabel="Motif de contestation de cette instruction commerciale" placeholder="Expliquez pourquoi vous demandez un nouvel examen" style={styles.input} multiline maxLength={4000} value={form.text} onChangeText={text => {try {frame.capture(); interaction.current++; setForm({...form, text, confirmed: false});} catch { /* No edit or confirmation from old activity. */ }}} />
      <Checkbox checked={form.confirmed} disabled={!form.text.trim()} onToggle={() => {try {frame.capture(); interaction.current++; setForm({...form, confirmed: !form.confirmed});} catch { /* No stale confirmation. */ }}}><Text style={styles.body}>Je demande un nouvel examen de cette instruction et de cette version exactes pour le motif indiqué.</Text></Checkbox></> : null}
    <ProductReviewCommandPanel uid={uid} context={{kind: 'order', id: transactionId}} sourceKey={JSON.stringify([key, selected, current?.source.sourceHash ?? null, current?.documentaryCorpusHash ?? null])}
      draft={draft ? {type: 'workflow', command: draft} : null} enabled={!!draft && !!current} material parcel verifyNew={verify} onSourceError={() => setFailed(key)}
      onSubmitted={() => {interaction.current++; setForm({...form, confirmed: false});}} onRecorded={() => {setForm(null); onRecorded();}} />
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 6}, input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
