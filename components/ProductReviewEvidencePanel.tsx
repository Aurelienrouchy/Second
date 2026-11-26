import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { useProductParcelContext } from '@/hooks/useProductParcelContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ProductReviewEvidenceService, PRODUCT_REVIEW_EVIDENCE_TYPES } from '@/services/productReviewEvidenceService';
import { ProductReviewEvidenceJournal } from '@/services/productReviewEvidenceJournal';
import { ProductReviewService } from '@/services/productReviewService';
import type { ProductReviewContext, ProductReviewCursor, ProductReviewScope } from '@/types/productReview';
import type { ProductReviewEvidence, ProductReviewEvidenceAttempt, ProductReviewEvidenceEntry, ProductReviewEvidenceReceipt, ProductReviewEvidenceType, ProductReviewEvidenceReference } from '@/types/productReviewEvidence';
const labels: Record<ProductReviewEvidenceType, string> = {received_item_photo: 'Photo déclarée du produit reçu', supporting_document_image: 'Image d’un document de soutien', expertise_image: 'Image d’une expertise déclarée'};
const entryId = (e: ProductReviewEvidenceEntry) => e.qualification === 'unknown' ? e.evidenceId : e.evidence.evidenceId;
/** Private transient pixels and one durable exact prepared file per intention. */
export function ProductReviewEvidencePanel({uid, context, scope, sourceHash, corpusHash, contributionId, enabled, onRecorded, selectedReference, selectedReferenceKey, onCurrentReadChange, material = false, parcel = false}: {uid: string; context: ProductReviewContext;
  scope: ProductReviewScope; sourceHash: string | null; corpusHash: string | null; contributionId: string | null; enabled: boolean; onRecorded: () => void;
  selectedReference: ProductReviewEvidenceReference | null; selectedReferenceKey: string | null; onCurrentReadChange: (allowed: boolean) => void; material?: boolean; parcel?: boolean}) {
  const base = useShippingPurchaseContext(JSON.stringify(['product-evidence-journal', context]), uid);
  const fresh = useProductParcelContext(JSON.stringify(['product-evidence-current', context, scope, sourceHash, corpusHash, contributionId, enabled, ...(material ? ['product_review_material_v1'] : []), ...(parcel ? ['product_review_parcel_v1'] : [])]), uid, parcel);
  const baseKey = JSON.stringify([uid, getAuthSessionGeneration(), context, base.focusRevision]);
  const key = JSON.stringify([baseKey, scope, sourceHash, corpusHash, contributionId, fresh.focusRevision, ...(material ? ['product_review_material_v1'] : []), ...(parcel ? ['product_review_parcel_v1'] : [])]);
  const [selectedType, setType] = useState<{key: string; value: ProductReviewEvidenceType} | null>(null);
  const [selection, setSelection] = useState<{key: string; referenceKey: string | null; entry: ProductReviewEvidence} | null>(null);
  const [result, setResult] = useState<{key: string; attempt: ProductReviewEvidenceAttempt; receipt: ProductReviewEvidenceReceipt} | null>(null);
  const [notice, setNotice] = useState<{key: string; text: string} | null>(null);
  const [busy, setBusy] = useState<string | null>(null), lock = useRef<symbol | null>(null);
  const type = selectedType?.key === key ? selectedType.value : null;
  const pending = useQuery({queryKey: ['product-evidence-journal', baseKey], enabled: base.focused, staleTime: 0, gcTime: 0, retry: false,
    queryFn: () => {const op = base.capture(); return ProductReviewEvidenceJournal.pending(uid, context, () => base.assertCurrent(op));}});
  const journalReady = base.focused && pending.isSuccess && !pending.isFetching && !pending.isError;
  const attempt = journalReady ? pending.data : null, receipt = journalReady && result?.key === baseKey && attempt?.requestId === result.attempt.requestId ? result.receipt : null;
  const working = busy === baseKey;
  const preview = useQuery({queryKey: ['product-evidence-preview', key], enabled: scope === 'own' && enabled && fresh.focused && !!contributionId && !!sourceHash,
    staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: () => {const op = fresh.capture(); if (!contributionId) throw new Error('Contribution propre requise.');
      return ProductReviewEvidenceService.preview(uid, context, contributionId, () => fresh.assertCurrent(op), material, parcel);}});
  const uploadPreview = enabled && fresh.focused && preview.isSuccess && !preview.isFetching && !preview.isError && preview.data.sourceHash === sourceHash ? preview.data : null;
  const verifyCurrent = async (assertContext: () => void) => {
    if (!sourceHash || !corpusHash) throw new Error('Les sources doivent être relues.');
    const current = await ProductReviewService.workflowPreview(uid, context, scope, null, assertContext, true, material, parcel); assertContext();
    if (current.source.sourceHash !== sourceHash || current.documentaryCorpusHash !== corpusHash) throw new Error('Les sources ou les pièces ont changé.');
  };
  const files = useInfiniteQuery({queryKey: ['product-evidence-files', key], enabled: enabled && fresh.focused && !!sourceHash && !!corpusHash,
    staleTime: 0, gcTime: 0, retry: false, initialPageParam: null as ProductReviewCursor | null,
    queryFn: async ({pageParam}) => {const op = fresh.capture(), current = () => fresh.assertCurrent(op);
      const page = await ProductReviewEvidenceService.page(uid, context, scope, pageParam, current, material, parcel); await verifyCurrent(current); current(); return page;},
    getNextPageParam: page => page.nextCursor ?? undefined});
  const readable = enabled && fresh.focused && files.isSuccess && !files.isFetching && !files.isError;
  const rows = readable ? files.data.pages.flatMap(page => page.entries) : [], unique = new Set(rows.map(entryId)).size === rows.length;
  const chosen = readable && unique && selection?.key === key && selection.referenceKey === selectedReferenceKey ? rows.find(row => row.qualification === 'native_stored_file' && row.evidence.evidenceId === selection.entry.evidenceId &&
    row.evidence.contentHash === selection.entry.contentHash && row.evidence.generation === selection.entry.generation) : null;
  const selected = chosen?.qualification === 'native_stored_file' ? chosen.evidence : readable && unique && selectedReference &&
    (scope === 'admin' || selectedReference.actorId === uid) ? selectedReference : null;
  const selectedId = selected ? 'evidenceId' in selected ? selected.evidenceId : selected.id : null;
  const pixelContext = useProductParcelContext(JSON.stringify(['product-evidence-pixels', key, selectedId, selected?.contentHash, selected?.generation]), uid, parcel);
  const pixels = useQuery({queryKey: ['product-evidence-pixels', key, selectedId, selected?.contentHash, selected?.generation, pixelContext.focusRevision],
    enabled: !!selected && readable && unique && pixelContext.focused, staleTime: 0, gcTime: 0, retry: false, structuralSharing: false,
    queryFn: async () => {const op = pixelContext.capture(), sourceOp = fresh.capture(), current = () => {pixelContext.assertCurrent(op); fresh.assertCurrent(sourceOp);}; if (!selected) throw new Error('Pièce exacte requise.');
      const value = await ProductReviewEvidenceService.file(uid, context, scope, selected, current, material, parcel); await verifyCurrent(current); current(); return value;}});
  const currentPixels = readable && unique && selected && pixelContext.focused && pixels.isSuccess && !pixels.isFetching && !pixels.isError ? pixels.data : null;
  const currentReadAllowed = !enabled || readable && unique && !pixels.isFetching && !pixels.isError && (!contributionId || scope !== 'own' || !!uploadPreview);
  useEffect(() => {let allowed = currentReadAllowed;
    if (allowed && parcel) {try {fresh.capture();} catch {allowed = false;}}
    onCurrentReadChange(allowed);
  }, [currentReadAllowed, onCurrentReadChange, parcel, fresh]);
  const run = async (mode: 'observe' | 'send' | 'reconcile' | 'neutralize' | 'acknowledge', a: ProductReviewEvidenceAttempt) => {
    if (!journalReady || lock.current || a.uid !== uid || mode === 'send' && (!enabled || !currentReadAllowed || scope !== 'own' || !uploadPreview ||
      uploadPreview.contributionId !== a.command.contributionId || uploadPreview.contributionHash !== a.command.contributionHash || uploadPreview.sourceHash !== a.command.sourceHash || !receipt || receipt.futureEffectsNeutralized)) return;
    let op, sourceOp; try {op = base.start(); if (!op) return; sourceOp = mode === 'send' ? fresh.capture() : null;} catch {if (op) base.finish(op); return;}
    const token = Symbol(); lock.current = token; setBusy(baseKey); setNotice(null);
    const current = () => {base.assertCurrent(op); if (sourceOp) fresh.assertCurrent(sourceOp);};
    try {const proof = await ProductReviewEvidenceJournal[mode](a, current); current(); await pending.refetch(); current();
      setResult(mode === 'acknowledge' ? null : {key: baseKey, attempt: a, receipt: proof});
      if (mode === 'acknowledge') setNotice({key: baseKey, text: 'Le reçu exact a été relu et la copie locale préparée a été supprimée. Le dossier privé conserve sa preuve native.'});
      if (['received', 'stored_requires_review'].includes(proof.state) && mode !== 'acknowledge') onRecorded();
    } catch {if (base.isCurrent(op)) {setNotice({key: baseKey, text: 'La pièce ou son résultat doit être relu. Le même tuple et la copie préparée restent conservés ; aucun autre fichier n’est adopté.'}); void pending.refetch();}}
    finally {base.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  const prepare = async () => {
    if (lock.current || !journalReady || attempt || !uploadPreview || !type || scope !== 'own' || !currentReadAllowed) return;
    let op, sourceOp; try {op = base.start(); if (!op) return; sourceOp = fresh.capture();} catch {if (op) base.finish(op); return;}
    const token = Symbol(); lock.current = token; setBusy(baseKey); setNotice(null); const current = () => {base.assertCurrent(op); fresh.assertCurrent(sourceOp);};
    try {current(); const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); current();
      if (!permission.granted) {setNotice({key: baseKey, text: 'Autorisez l’accès aux photos pour choisir une image privée.'}); return;}
      const picked = await ImagePicker.launchImageLibraryAsync({mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1}); current();
      if (picked.canceled || !picked.assets[0]) return;
      const a = await ProductReviewEvidenceJournal.stage(uid, uploadPreview, type, picked.assets[0].uri, current, material, parcel); current();
      const proof = await ProductReviewEvidenceJournal.observe(a, current); current(); await pending.refetch(); current(); setResult({key: baseKey, attempt: a, receipt: proof});
    } catch {if (base.isCurrent(op)) {setNotice({key: baseKey, text: 'La préparation, la conservation locale ou la source doit être vérifiée. Aucun autre fichier ne remplace une intention déjà conservée.'}); void pending.refetch();}}
    finally {base.finish(op); if (lock.current === token) {lock.current = null; setBusy(null);}}
  };
  const render = useCallback(({item}: ListRenderItemInfo<ProductReviewEvidenceEntry>) => item.qualification === 'unknown' ?
    <Text accessibilityRole="alert" style={styles.caption}>Une pièce de cette page ne peut pas être qualifiée. Elle reste comptée dans l’historique parcouru.</Text> :
    <View style={styles.section}><Text style={styles.body}>{labels[item.evidence.typeDeclared]} — {item.evidence.state === 'received' ? 'liée à sa contribution d’origine' : 'conservée pour rapprochement'}.</Text>
      <Text style={styles.caption}>Enregistrée le {new Date(item.evidence.recordedAt).toLocaleString(APP_LOCALE)}. {item.evidence.width} × {item.evidence.height} pixels ; {Math.ceil(item.evidence.byteLength / 1024)} Kio.</Text>
      <Button variant="secondary" onPress={() => {if (readable && unique) {try {fresh.capture(); setSelection({key, referenceKey: selectedReferenceKey, entry: item.evidence});} catch { /* Stale pixels stay hidden. */ }}}}>Consulter cette image privée exacte</Button></View>, [readable, unique, fresh, key, selectedReferenceKey, setSelection]);
  if (!base.focused) return null;
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Pièces images privées</Text>
    <Text style={styles.caption}>{scope === 'own' ? 'Vous voyez uniquement vos propres pièces. Les originaux des autres parties restent accessibles à l’équipe seule.' : 'Ces originaux privés sont réservés à l’équipe actuellement autorisée.'} Une image déclarée expertise ne certifie ni son émetteur, ni l’authenticité, la sécurité ou le contenu physique du produit.</Text>
    {files.isFetching ? <Text style={styles.caption}>Lecture des pièces natives…</Text> : null}
    {files.isError || !unique || pixels.isError ? <Text accessibilityRole="alert" style={styles.caption}>Cette lecture ne peut pas être qualifiée. Les anciennes métadonnées et images sont masquées ; relisez explicitement les sources du dossier.</Text> : null}
    {readable && unique && !pixels.isFetching && !pixels.isError ? <><Text style={styles.caption}>Pages parcourues : {files.data.pages.length}. La liste accessible ne certifie pas un historique exhaustif.</Text>
      {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={entryId} renderItem={render} nestedScrollEnabled /></View> : <Text style={styles.caption}>Aucune pièce enregistrée sur les pages parcourues.</Text>}
      {files.hasNextPage ? <Button variant="secondary" onPress={() => {setSelection(null); void files.fetchNextPage();}}>Lire les pièces suivantes</Button> : null}</> : null}
    {selected && pixels.isFetching ? <Text style={styles.caption}>Lecture privée de la génération exacte…</Text> : null}
    {selected && pixels.isError ? <Text accessibilityRole="alert" style={styles.caption}>L’image privée ne peut plus être qualifiée pour cette génération et ce reçu. Aucune autre URL ou image ne la remplace.</Text> : null}
    {currentPixels ? <Image source={{uri: currentPixels.dataUrl}} cachePolicy="none" contentFit="contain" style={styles.image} accessibilityLabel="Pièce privée examinée" /> : null}
    {scope === 'own' && contributionId && uploadPreview && journalReady && !attempt && currentReadAllowed ? <>
      <Text style={styles.body}>Choisissez explicitement le type déclaré, puis une seule image. Elle sera préparée en JPEG, limitée à 1 200 pixels et 2 Mio, et liée à cette contribution exacte avant tout dépôt.</Text>
      {PRODUCT_REVIEW_EVIDENCE_TYPES.map(value => <Button key={value} variant={type === value ? 'primary' : 'secondary'} disabled={working} onPress={() => setType({key, value})}>{labels[value]}</Button>)}
      <Button variant="secondary" disabled={working || !type} onPress={() => {void prepare();}}>Choisir et conserver cette image préparée</Button>
    </> : null}
    {scope === 'own' && contributionId && preview.isError ? <Text accessibilityRole="alert" style={styles.caption}>Votre contribution ou ses sources doivent être relues avant de choisir une pièce.</Text> : null}
    {pending.isError ? <><Text accessibilityRole="alert" style={styles.caption}>Le journal de pièce doit être relu avant toute autre image.</Text><Button variant="secondary" onPress={() => {void pending.refetch();}}>Relire le journal de pièce</Button></> : null}
    {attempt ? <View style={styles.section}><Text style={styles.body}>Une image exacte préparée reste conservée pour ce dossier.</Text>
      <Text style={styles.caption}>{labels[attempt.command.typeDeclared]} ; {attempt.command.file.width} × {attempt.command.file.height} pixels ; {Math.ceil(attempt.command.file.byteLength / 1024)} Kio. La copie locale reste liée à ce compte et à cette intention.</Text>
      <Button variant="secondary" disabled={working} onPress={() => {void run('observe', attempt);}}>Relire le reçu natif sans lire le stockage</Button>
      {receipt ? <><Text style={styles.body}>{receipt.state === 'received' ? 'Le stockage natif est qualifié et la pièce est liée à la contribution d’origine.' :
        receipt.state === 'stored_requires_review' ? 'Le fichier est conservé, mais son adoption au dossier demande un rapprochement.' : receipt.state === 'not_executed' ? 'La non-exécution est enregistrée pour cette intention exacte.' :
          'Le résultat du dépôt reste à vérifier. Une absence de reçu ne prouve pas que le fichier n’a pas été envoyé.'}</Text>
        <Text style={styles.caption}>{receipt.futureEffectsNeutralized ? 'Les futurs envois et adoptions sont neutralisés. Un fichier parti auparavant peut encore être conservé pour examen.' : 'Le reçu ne certifie pas l’authenticité, le décodage, la qualité de l’émetteur ou un effet financier.'}</Text>
        {!['received', 'stored_requires_review', 'not_executed'].includes(receipt.state) ? <>
          {scope === 'own' && uploadPreview?.sourceHash === attempt.command.sourceHash && uploadPreview.contributionId === attempt.command.contributionId && !receipt.futureEffectsNeutralized ?
            <Button variant="secondary" disabled={working} onPress={() => {void run('send', attempt);}}>Déposer ou reprendre exactement ces mêmes octets</Button> : null}
          <Button variant="secondary" disabled={working} onPress={() => {void run('reconcile', attempt);}}>Vérifier l’objet exact sans nouvel envoi</Button>
          <Button variant="secondary" disabled={working} onPress={() => Alert.alert('Neutraliser les futurs effets', 'Cette action bloque les futurs envois et adoptions de cette intention. Elle ne retire pas un fichier déjà envoyé et ne certifie pas son absence.',
            [{text: 'Retour', style: 'cancel'}, {text: 'Neutraliser', onPress: () => {void run('neutralize', attempt);}}])}>Neutraliser les futurs effets de cette intention</Button>
        </> : <Button variant="secondary" disabled={working} onPress={() => {void run('acknowledge', attempt);}}>Relire le reçu puis supprimer la copie locale préparée</Button>}
      </> : null}
    </View> : null}
    {notice?.key === baseKey ? <Text accessibilityRole="alert" style={styles.caption}>{notice.text}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 6}, image: {width: '100%', height: spacing.xl * 8}});
