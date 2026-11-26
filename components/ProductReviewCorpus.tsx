import { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { Button, Checkbox } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import type { ProductReviewWorkflowPreviewV2 } from '@/types/productReview';
import type { ProductReviewEvidenceReference } from '@/types/productReviewEvidence';
type Row = {key: string; label: string; id: string; hash: string | null; evidence?: ProductReviewEvidenceReference};
const itemKey = (row: Row) => row.key;
/** This is the complete bounded native preview, not a merge of pagination/cache entries. */
export function ProductReviewCorpus({preview, onSelect, contributionSelection, evidenceSelection, selectAll, onToggleContribution, onToggleEvidence}: {preview: ProductReviewWorkflowPreviewV2;
  onSelect: (evidence: ProductReviewEvidenceReference) => void; contributionSelection: string[]; evidenceSelection: string[]; selectAll: boolean;
  onToggleContribution?: (id: string) => void; onToggleEvidence: (id: string) => void}) {
  const rows: Row[] = [
    ...preview.contributionReferences.map(r => ({key: `contribution:${r.id}`, label: r.qualification === 'native_contribution' ? 'Contribution native examinée' : 'Contribution inconnue', id: r.id, hash: r.contentHash})),
    ...preview.communicationReferences.map(r => ({key: `communication:${r.id}`, label: r.qualification === 'native_communication' ? 'Échange natif examiné' : 'Échange inconnu', id: r.id, hash: r.contentHash})),
    ...preview.evidenceReferences.map(r => r.qualification === 'unknown' ? {key: `evidence:${r.evidenceId}`, label: 'Pièce inconnue', id: r.evidenceId, hash: null} :
      {key: `evidence:${r.evidence.id}`, label: r.evidence.state === 'received' ? 'Pièce liée nativement à sa contribution' : 'Pièce conservée pour rapprochement', id: r.evidence.id, hash: r.evidence.contentHash, evidence: r.evidence}),
  ];
  const render = useCallback(({item}: ListRenderItemInfo<Row>) => <View style={styles.section}>
    <Text style={styles.body}>{item.label}</Text>{preview.scope === 'admin' ? <Text selectable style={styles.caption}>{item.id}{'\n'}Version : {item.hash ?? 'inconnue'}</Text> : null}
    {item.key.startsWith('contribution:') && onToggleContribution ? <Checkbox accessibilityLabel="Lier cette contribution exacte au texte" checked={selectAll || contributionSelection.includes(item.id)}
      disabled={selectAll || item.hash === null} onToggle={() => onToggleContribution(item.id)}><Text style={styles.body}>Lier cette contribution exacte au texte</Text></Checkbox> : null}
    {item.evidence ? <>{preview.scope === 'admin' ? <Text selectable style={styles.caption}>Contribution : {item.evidence.contributionId}{'\n'}Version contribution : {item.evidence.contributionHash}{'\n'}Génération privée : {item.evidence.generation}</Text> : null}
      <Text style={styles.caption}>{item.evidence.typeDeclared === 'received_item_photo' ? 'Photo déclarée du produit reçu' : item.evidence.typeDeclared === 'expertise_image' ? 'Image d’une expertise déclarée' : 'Image d’un document de soutien'}.</Text>
      <Checkbox accessibilityLabel="Lier cette référence de pièce exacte au texte" checked={selectAll || evidenceSelection.includes(item.id)} disabled={selectAll}
        onToggle={() => onToggleEvidence(item.id)}><Text style={styles.body}>Lier cette référence de pièce exacte au texte</Text></Checkbox>
      <Button variant="secondary" onPress={() => onSelect(item.evidence!)}>Consulter cette pièce privée du corpus exact</Button></> : null}
  </View>, [onSelect, contributionSelection, evidenceSelection, selectAll, onToggleContribution, onToggleEvidence, preview.scope]);
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.title}>Corpus documentaire examiné</Text>
    {preview.scope === 'admin' ? <Text selectable style={styles.caption}>Version native du corpus : {preview.documentaryCorpusHash}</Text> : <Text style={styles.caption}>Cet aperçu fixe les références exactes liées au texte que vous confirmez.</Text>}
    <Text style={styles.caption}>{preview.coverage.contributionsInspected} contributions, {preview.coverage.communicationsInspected} échanges, {preview.coverage.evidenceInspected} pièces et {preview.coverage.intentsInspected} intentions inspectés dans les limites natives.</Text>
    <Text style={styles.body}>{preview.coverage.documentaryCompleteCurrentCaseSet ? 'Le corpus courant est qualifié dans cette lecture bornée.' :
      'Le corpus comporte une absence, un élément inconnu, une intention en attente, une pièce à rapprocher ou une limite de lecture. Un examen documentaire complet ne peut pas être enregistré.'}</Text>
    {preview.parcelReview ? <><Text style={styles.caption}>{preview.parcelReview.integrityQualified ? 'L’intégrité native des éléments accessibles est qualifiée.' : 'L’intégrité native des éléments accessibles ne peut pas être qualifiée.'} Leur disponibilité et leur complétude restent distinctes ; aucune photo absente ne prouve une non-réception.</Text>
      {preview.scope === 'admin' ? preview.parcelReview.evidenceAvailability.map(row => <Text key={row.contributionId} selectable style={styles.caption}>Contribution {row.contributionId} : disponibilité déclarée {row.declared === 'available' ? 'disponible' : row.declared === 'unavailable' ? 'indisponible' : 'inconnue'} · {row.nativeFileReceived ? 'pièce native reçue' : 'aucune pièce native reçue dans ce corpus'}.</Text>) : null}</> : null}
    {rows.length ? <View style={styles.list}><FlashList data={rows} keyExtractor={itemKey} renderItem={render} nestedScrollEnabled /></View> : <Text style={styles.caption}>Aucune référence accessible dans cet aperçu natif.</Text>}
    <Text style={styles.caption}>La complétude documentaire ne prouve pas l’authenticité, la sécurité, la qualité de l’émetteur ou la réception physique. Une nouvelle version exige une nouvelle lecture et confirmation explicites.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground},
  caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 10}});
