import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import type { ProductMaterialAttributes, ProductMaterialObservation, ProductMaterialSources, ProductMaterialStatement } from '@/types/productMaterialReview';
import { PRODUCT_MATERIAL_INTERVENTION_LABELS, PRODUCT_MATERIAL_OBSERVATION_LABELS, PRODUCT_MATERIAL_REASON_LABELS } from '@/utils/productMaterialStatement';
const unknown = 'Inconnu ou non enregistré';
const attributes = (a: ProductMaterialAttributes) => [
  {label: 'Marque', value: a.brandStatus === 'unbranded' ? 'Sans marque, selon la source' : a.brand ?? unknown},
  {label: 'Modèle', value: a.model ?? unknown},
  {label: 'Taille écrite', value: a.size.value ? `${a.size.value} · ${a.size.system ? `système ${a.size.system} déclaré` : 'système non enregistré'}` : unknown},
  {label: 'Couleurs', value: a.colors?.length ? a.colors.join(', ') : unknown},
  {label: 'Matières', value: a.materials?.length ? a.materials.join(', ') : unknown},
  {label: 'Défauts', value: a.hasKnownDefects === true ? a.defectsDescription ?? 'Défauts déclarés sans précision enregistrée' : a.hasKnownDefects === false ? 'Aucun défaut connu déclaré dans cette source' : unknown},
  {label: 'Retouches', value: a.hasAlterations === true ? a.alterationsDescription ?? 'Retouches déclarées sans précision enregistrée' : a.hasAlterations === false ? 'Aucune retouche connue déclarée dans cette source' : unknown},
];
function observationRows(o: ProductMaterialObservation) {
  return [...Object.entries(PRODUCT_MATERIAL_OBSERVATION_LABELS).map(([key, label]) => ({label, value: o[key as keyof typeof PRODUCT_MATERIAL_OBSERVATION_LABELS] ?? unknown})),
    {label: 'Système de taille', value: o.sizeSystem === 'EU' || o.sizeSystem === 'US' ? `${o.sizeSystem}, selon la déclaration` : unknown},
    {label: 'Couleurs', value: o.colors?.length ? o.colors.join(', ') : unknown}, {label: 'Matières', value: o.materials?.length ? o.materials.join(', ') : unknown}];
}
const renderRows = (rows: {label: string; value: string}[]) => rows.map(row => <Text key={row.label} selectable style={styles.body}>{row.label} : {row.value}.</Text>);
const date = (v: string | null) => v ? new Date(v).toLocaleString(APP_LOCALE) : 'Date et heure structurées inconnues ; consultez les éventuelles précisions du récit';
/** A read-only comparison never fills missing contract fields from the current listing. */
export function ProductMaterialComparison({sources, statement, statementState, recordedAt = null}: {sources: ProductMaterialSources | null;
  statement: ProductMaterialStatement | null; statementState: 'draft' | 'recorded' | 'none'; recordedAt?: string | null}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Renseignements enregistrés avec la commande</Text>
    {sources?.contract.qualification === 'native_order_snapshot_recorded' ? renderRows(attributes(sources.contract.content)) :
      <Text style={styles.caption}>Les attributs historiques de la commande ne sont pas qualifiés. L’annonce actuelle ne remplace pas ce qui n’a pas été enregistré.</Text>}
    <Text accessibilityRole="header" style={styles.title}>Annonce actuelle — information distincte</Text>
    {sources?.currentListing.qualification === 'current_listing_recorded' ? renderRows(attributes(sources.currentListing.content)) :
      <Text style={styles.caption}>Les attributs de l’annonce actuelle ne sont pas disponibles dans cette lecture.</Text>}
    <Text style={styles.caption}>Cette source peut avoir changé après l’achat. Elle ne complète pas les champs historiques manquants et ne décrit pas le produit reçu.</Text>
    {statement ? <>
      <Text accessibilityRole="header" style={styles.title}>{statementState === 'draft' ? 'Comparaison préparée — non enregistrée' : 'Comparaison déclarée par une partie'}</Text>
      <Text style={styles.body}>{PRODUCT_MATERIAL_REASON_LABELS[statement.reason]}</Text>
      <Text style={styles.caption}>Étape déclarée : {statement.receivedScope === 'purchase_received' ? 'produit reçu lors de l’achat' : statement.receivedScope === 'return_received' ?
        'contenu reçu en retour par le vendeur' : statement.receivedScope === 'offered_item' ? 'produit proposé par le vendeur' : 'inconnue ou non enregistrée'}. Une déclaration ne certifie pas une réception physique.</Text>
      <Text style={styles.label}>Ce qui était promis selon cette déclaration</Text>{renderRows(observationRows(statement.promised))}
      <Text style={styles.label}>Ce qui a été reçu selon cette observation</Text>{renderRows(observationRows(statement.received))}
      {(['promised', 'received'] as const).map(part => <View key={part} style={styles.section}>
        <Text style={styles.label}>Mesures {part === 'promised' ? 'promises selon la déclaration' : 'du produit reçu selon la déclaration'}</Text>
        {statement[part].measurements?.length ? statement[part].measurements.map((m, index) => <Text key={index} selectable style={styles.body}>
          {m.name} : {m.value} · {m.unit === 'unknown' ? 'unité inconnue' : m.unit}. Méthode déclarée : {m.method ?? unknown}.</Text>) : <Text style={styles.caption}>Mesures non déclarées.</Text>}
      </View>)}
      <Text style={styles.label}>Chronologie selon cette déclaration</Text>
      <Text selectable style={styles.body}>Réception : {date(statement.chronology.receivedAt)}.</Text>
      <Text selectable style={styles.body}>Inspection : {date(statement.chronology.inspectedAt)}.</Text>
      <Text selectable style={styles.body}>Première contestation : {date(statement.chronology.complainedAt)}.</Text>
      <Text style={styles.label}>Interventions après réception</Text>
      <Text style={styles.caption}>{statement.interventions.state === 'none_declared' ? 'L’auteur ne déclare aucune intervention. Cette déclaration ne certifie pas une absence d’intervention.' :
        statement.interventions.state === 'unknown' ? 'Interventions inconnues selon l’auteur.' : 'Interventions déclarées, sans conclusion sur l’origine d’un défaut ou une faute.'}</Text>
      {statement.interventions.entries.map((i, index) => <View key={index} style={styles.section}>
        <Text style={styles.label}>{PRODUCT_MATERIAL_INTERVENTION_LABELS[i.kind]}</Text><Text selectable style={styles.body}>{i.description}</Text>
        <Text selectable style={styles.caption}>Date déclarée : {date(i.occurredAt)}.</Text>
        <Text selectable style={styles.body}>Avant : {i.beforeObservation ?? unknown}. Après : {i.afterObservation ?? unknown}.</Text>
      </View>)}
      {statementState === 'recorded' && recordedAt ? <Text style={styles.caption}>Enregistrement natif le {date(recordedAt)}. Cette date est distincte de la réception, de l’inspection et des interventions déclarées.</Text> : null}
    </> : <Text style={styles.caption}>Le produit reçu reste inconnu dans cette lecture ; aucune correspondance ou différence n’est déduite de l’annonce.</Text>}
    <Text style={styles.caption}>Les tailles et unités ne sont pas converties. Identité physique, couleur, matière, odeur, mesures et faute restent non certifiées. L’examen documentaire, l’instruction de retour et le résultat financier restent distincts.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  label: {...typography.bodySmall, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
