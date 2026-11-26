import { ProductAuthenticityReportPanel } from './ProductAuthenticityReportPanel';
import type { ProductReviewContributionEntry } from '@/types/productReview';
import type { ProductPhysicalDocumentaryAdmission } from '@/types/productPhysicalReview';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';
export function ProductParcelReportPanel(props: {uid: string; transactionId: string; contributions: ProductReviewContributionEntry[]; sourceHash: string | null; enabled: boolean; onRecorded: () => void; nativeAdmission: ProductPhysicalDocumentaryAdmission | null}) {
  return <View style={styles.section}><Text style={styles.caption}>Pour un colis de retour annoncé livré par le transporteur, le vendeur peut relier son constat en déclarant une non-réception ou une réception inconnue. Le scan ne prouve pas sa réception physique ni le contenu du colis. Ce recours reste distinct de la plainte de l’acheteur et ne décide d’aucun remboursement ou frais.</Text><ProductAuthenticityReportPanel {...props} parcel topic="parcel_delivery" /></View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, caption: {...typography.caption, color: colors.muted}});
