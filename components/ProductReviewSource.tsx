import { StyleSheet, Text, View } from 'react-native';
import { ArticleChildSafetyFields } from '@/components/ArticleChildSafetyFields';
import { colors, spacing, typography } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import type { ProductReviewSource as Source } from '@/types/productReview';

/** Text-only native projections; listing photos never become received-item evidence. */
export function ProductReviewSource({source}: {source: Source}) {
  const projections = [
    {label: 'Contenu contractuel enregistré dans la commande', item: source.sources.contractSnapshot},
    {label: source.protocol === 'product_review_source_v2' ? 'Annonce en préparation ou état courant' : 'Annonce actuelle', item: source.sources.currentListing},
    {label: 'Version de l’annonce signalée', item: source.sources.reportedListing},
  ];
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>Sources de l’examen</Text>
    <Text style={styles.caption}>Lecture du dossier : {new Date(source.readAt).toLocaleString(APP_LOCALE)}. Ces sources restent distinctes ; une annonce actuelle ne remplace pas le contenu promis.</Text>
    {projections.map(({label, item}) => <View key={label} style={styles.section}>
      <Text style={styles.body}>{label} — {item.qualification === 'unknown' ? 'source inconnue' : 'contenu enregistré'}.</Text>
      <Text selectable style={styles.body}>{item.content.title ?? 'Titre inconnu'}</Text>
      <Text selectable style={styles.body}>{item.content.description ?? 'Description inconnue'}</Text>
      <Text style={styles.caption}>Marque : {item.content.brand ?? 'inconnue'} ; état : {item.content.condition ?? 'inconnu'} ; référence : {item.content.productReference ?? 'inconnue'} ; modèle : {item.content.model ?? 'inconnu'} ; lot : {item.content.lot ?? 'inconnu'}.</Text>
      <Text style={styles.caption}>Matières : {item.content.materials?.join(', ') ?? 'inconnues'} ; espèce déclarée : {item.content.species ?? 'inconnue'} ; provenance déclarée : {item.content.provenance ?? 'inconnue'}.</Text>
      <Text style={styles.caption}>{item.content.imageCountRecorded === null ? 'Nombre de photos non qualifié.' : `${item.content.imageCountRecorded} photo(s) enregistrée(s) dans cette source.`} Ces photos ne sont pas des preuves du produit reçu.</Text>
    </View>)}
    {source.protocol === 'product_review_source_v2' ? <><Text style={styles.body}>Ce dossier de préparation ne constitue pas un accord de vente exécuté. Son état natif est {source.listingSubmission.isActive === true ? 'actif' : source.listingSubmission.isActive === false ? 'hors ligne' : 'inconnu'} ; modération : {source.listingSubmission.moderationStatus ?? 'inconnue'}.</Text><ArticleChildSafetyFields categoryIds={source.sources.currentListing.content.categoryIds ?? []} value={source.listingSubmission.childSafety.declaration} readOnly required /><Text style={styles.caption}>La déclaration enfant est {source.listingSubmission.childSafety.statementQualification === 'native_current' ? 'liée aux sources natives actuelles' : 'non qualifiée'}. Une issue documentaire ne remplace pas la décision d’admission dédiée et aucun article n’est publié automatiquement.</Text></> : null}
    <Text style={styles.body}>Produit reçu : contenu physique inconnu. Une contribution de l’acheteur est une déclaration séparée.</Text>
    <Text style={styles.caption}>Une photo, une expertise déclarée ou un enregistrement ne certifient pas l’authenticité, l’application d’un rappel, la sécurité, l’hygiène, une espèce ou sa licéité. Ce dossier n’autorise aucun mouvement d’argent, changement de stock ou expédition.</Text>
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, paddingVertical: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
