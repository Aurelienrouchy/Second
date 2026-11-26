import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { PARCEL_CHOICE_LABELS, PARCEL_CLOCK_LABELS, PRODUCT_PARCEL_REASON_LABELS } from '@/utils/productParcelStatement';
import type { ProductParcelSources, ProductParcelStatement } from '@/types/productParcelReview';
const unknown = 'Inconnu ou non enregistré';
const date = (value: string | null) => value ? new Date(value).toLocaleString(APP_LOCALE) : 'Date et heure structurées inconnues ; consulter les précisions du récit';
const choice = (value: string) => PARCEL_CHOICE_LABELS[value] ?? value;
export function ProductParcelComparison({sources, statement, recordedAt = null}: {sources: ProductParcelSources | null; statement: ProductParcelStatement | null; recordedAt?: string | null}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Sources natives du trajet — lecture distincte du constat</Text>
    {sources ? <>
      {(['contractRoute', 'returnRoute'] as const).map(key => {const route = sources[key], address = (value: typeof route.origin) => value ? [value.city, value.province, value.country].filter(Boolean).join(', ') || unknown : unknown;
        return <View key={key} style={styles.section}><Text style={styles.label}>{key === 'contractRoute' ? 'Trajet enregistré avec la commande' : 'Trajet gelé de la demande de retour'}</Text><Text style={styles.caption}>Qualification : {route.qualification === 'unknown' ? unknown : 'capture native enregistrée'}.</Text>
          <Text selectable style={styles.body}>Origine : {address(route.origin)}. Destination : {address(route.destination)}.</Text>
          <Text style={styles.caption}>Les adresses exactes restent privées ; aucun profil actuel ne complète cette capture.</Text>
          <Text style={styles.body}>Masse enregistrée : {route.parcel?.weight.value ?? unknown} · {route.parcel?.weight.unit ?? unknown}. Dimensions : {route.parcel?.dimensions.length ?? unknown} × {route.parcel?.dimensions.width ?? unknown} × {route.parcel?.dimensions.height ?? unknown} · {route.parcel?.dimensions.unit ?? unknown}.</Text></View>;})}
      {sources.legs.map(leg => <View key={leg.leg} style={styles.section}><Text style={styles.label}>{choice(leg.leg)}</Text><Text selectable style={styles.body}>Étiquette actuelle qualifiée : {leg.qualification === 'native_current_label' ? leg.identity?.labelId : unknown}.</Text>
        <Text style={styles.caption}>{leg.tracking.qualification === 'native_current_capture' ? `Capture native ${leg.tracking.captureId} · état transporteur ${leg.tracking.providerStatusCode}.` : 'Aucune capture courante ne peut être qualifiée.'} La capture ne certifie pas la possession par le destinataire.</Text></View>)}
    </> : <Text style={styles.caption}>Les sources natives du trajet ne sont pas qualifiées.</Text>}
    {statement ? <>
      <Text accessibilityRole="header" style={styles.title}>Constat déclaré par une partie</Text><Text style={styles.body}>{PRODUCT_PARCEL_REASON_LABELS[statement.reason]} · {choice(statement.leg)}.</Text>
      <Text selectable style={styles.body}>Étiquette déclarée : {statement.labelId ?? unknown}. Réception : {choice(statement.receipt)}.</Text>
      {(['packaging', 'parcel', 'contents', 'location'] as const).map(key => <Text key={key} selectable style={styles.body}>{({packaging: 'Emballage', parcel: 'Aspect du colis', contents: 'Contenu observé', location: 'Lieu déclaré'})[key]} : {statement[key] ?? unknown}.</Text>)}
      <Text style={styles.body}>Scellé : {choice(statement.seal)}. Ouverture : {choice(statement.opening)}.</Text>
      {statement.weights.map((w, index) => <Text key={index} selectable style={styles.body}>Masse déclarée {index + 1} : {w.value ?? unknown} · {choice(w.unit)} ; {choice(w.phase)} ; {choice(w.source)} ; méthode {w.method ?? unknown} ; {date(w.occurredAt)}.</Text>)}
      {statement.handover.map((h, index) => <Text key={index} selectable style={styles.body}>Remise déclarée {index + 1} : {choice(h.from)} → {choice(h.to)} ; {date(h.occurredAt)} ; {h.observation ?? unknown} ; référence {h.reference ?? unknown}.</Text>)}
      <Text style={styles.body}>Tiers : {choice(statement.thirdParty.recipient)} ; {choice(statement.thirdParty.authorization)} ; {choice(statement.thirdParty.signature)} ; référence {statement.thirdParty.reference ?? unknown}.</Text>
      <Text selectable style={styles.body}>Dépôt : {choice(statement.deposit.state)} ; lieu {statement.deposit.location ?? unknown} ; disparition {date(statement.deposit.disappearanceAt)}.</Text>
      {(Object.keys(PARCEL_CLOCK_LABELS) as (keyof typeof PARCEL_CLOCK_LABELS)[]).map(key => <Text key={key} selectable style={styles.body}>{PARCEL_CLOCK_LABELS[key]} : {date(statement.chronology[key])}.</Text>)}
      {statement.lossDocument ? <Text selectable style={styles.body}>Document déclaré : {statement.lossDocument.issuer ?? unknown}, {choice(statement.lossDocument.issuerRole)}, référence {statement.lossDocument.reference ?? unknown}, étiquette {statement.lossDocument.labelId ?? unknown}, date {date(statement.lossDocument.issuedAt)}, conclusion {choice(statement.lossDocument.conclusion)}. L’émetteur et la perte ne sont pas certifiés.</Text> : <Text style={styles.caption}>Aucun document de perte décrit dans cette contribution.</Text>}
      <Text style={styles.caption}>Pièces : {choice(statement.evidenceAvailability)}. Limites déclarées : {statement.evidenceLimitations ?? unknown}.</Text>
      {recordedAt ? <Text style={styles.caption}>Enregistrement natif {date(recordedAt)} ; cette date ne remplace aucune date déclarée.</Text> : null}
    </> : null}
    <Text style={styles.caption}>Un transit hors Québec ne prouve pas une erreur d’acheminement. Un lieu observé ou une correction rapportée reste distinct du contrat et de la route native de l’étiquette ; il ne devient pas une nouvelle adresse de livraison autorisée.</Text>
    <Text style={styles.caption}>Aucune conversion de masse, faute, perte officielle, indemnisation, accord du destinataire ou permission de stock ne découle automatiquement de cette comparaison.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground}, label: {...typography.bodySmall, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
