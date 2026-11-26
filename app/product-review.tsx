import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ui';
import { ChildSafetyListingPanel } from '@/components/ChildSafetyListingPanel';
import { ChildSafetyAdmissionPanel } from '@/components/ChildSafetyAdmissionPanel';
import { ProductPhysicalReviewPanel } from '@/components/ProductPhysicalReviewPanel';
import { ProductReviewCasePanel } from '@/components/ProductReviewCasePanel';
import { CommercialClaimReviewPanel } from '@/components/CommercialClaimReviewPanel';
import { CommercialClaimReviewJournal } from '@/components/CommercialClaimReviewJournal';
import { ProductRoutingReviewPanel } from '@/components/ProductRoutingReviewPanel';
import { ProductAuthenticityReportPanel } from '@/components/ProductAuthenticityReportPanel';
import { ProductCommercialReturnPanel } from '@/components/ProductCommercialReturnPanel';
import { ProductParcelReportPanel } from '@/components/ProductParcelReportPanel';
import { PurchaseRefundAgreementPanel } from '@/components/PurchaseRefundAgreementPanel';
import { RefundRepairOwnerPanel } from '@/components/RefundRepairOwnerPanel';
import { LateCommercialOwnerEntry } from '@/components/LateCommercialOwnerEntry';
import { LateCommercialHistory } from '@/components/LateCommercialHistory';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { isProductReviewContext } from '@/services/productReviewService';
import { isLateCommercialNoticeReference } from '@/services/lateCommercialRecourseService';
import type { LateCommercialNoticeReference } from '@/types/lateCommercialRecourse';
import { colors, spacing, typography } from '@/constants/theme';

export default function ProductReviewScreen() {
  const uid = useAuthenticatedUid(), router = useRouter(), params = useLocalSearchParams<{contextKind?: string; contextId?: string; supportRequestId?: string; lateCommercialNotice?: string}>();
  const candidate = {kind: params.contextKind, id: params.contextId}, context = isProductReviewContext(candidate) ? candidate : null;
  let noticeReference: LateCommercialNoticeReference | undefined, invalidNotice = false;
  if (params.lateCommercialNotice !== undefined) {
    try {
      const reference: unknown = typeof params.lateCommercialNotice === 'string' ? JSON.parse(params.lateCommercialNotice) : null;
      if (!isLateCommercialNoticeReference(reference) || context?.kind !== 'order') invalidNotice = true;
      else noticeReference = reference;
    } catch { invalidNotice = true; }
  }
  return <View style={styles.container}><ScreenHeader title="Examen de l’article" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}>
      {uid ? <CommercialClaimReviewJournal uid={uid} /> : null}
      {uid && context && !invalidNotice ? <>{context.kind === 'order' ? <><PurchaseRefundAgreementPanel uid={uid} transactionId={context.id} /><RefundRepairOwnerPanel uid={uid} transactionId={context.id} /><LateCommercialHistory uid={uid} transactionId={context.id} noticeReference={noticeReference} /></> : null}<ProductReviewCasePanel uid={uid} context={context} scope="own" material={context.kind === 'order'} parcel={context.kind === 'order'} routeAmendment={context.kind === 'order'} routingReview={context.kind === 'order'} mixedOrders={context.kind === 'order'} renderOwnOrderAction={context.kind === 'order'
        ? state => <><CommercialClaimReviewPanel uid={uid} transactionId={context.id} contributions={state.contributions} nativeAdmission={state.nativeAdmission} /><ProductAuthenticityReportPanel uid={uid} transactionId={context.id} material parcel topic="authenticity" {...state} /><ProductAuthenticityReportPanel uid={uid} transactionId={context.id} material parcel topic="nonconformity" {...state} /><ProductParcelReportPanel uid={uid} transactionId={context.id} {...state} /><LateCommercialOwnerEntry uid={uid} transactionId={context.id} {...state} supportRequestId={params.supportRequestId} /></> : undefined}
        renderOrderPhysical={context.kind === 'order' ? nativeAdmission => <ProductPhysicalReviewPanel uid={uid} context={{kind: 'order', id: context.id}} scope="own" nativeAdmission={nativeAdmission} /> : undefined}
        renderOrderRouting={context.kind === 'order' ? nativeAdmission => <ProductRoutingReviewPanel uid={uid} transactionId={context.id} scope="own" nativeAdmission={nativeAdmission} /> : undefined}
        renderOrderCommercial={context.kind === 'order' ? nativeAdmission => <ProductCommercialReturnPanel uid={uid} transactionId={context.id} scope="own" nativeAdmission={nativeAdmission} /> : undefined} />{context.kind === 'article_listing' ? <><ChildSafetyAdmissionPanel uid={uid} articleId={context.id} scope="own" /><ChildSafetyListingPanel uid={uid} articleId={context.id} /></> : null}</> :
        <Text accessibilityRole="alert" style={styles.body}>{invalidNotice ? 'La référence de cet avis est invalide. Reprenez la lecture depuis l’avis d’origine ; aucun autre historique n’est ouvert à sa place.' : 'Connectez-vous au compte concerné et ouvrez ce dossier depuis votre commande, votre signalement ou un avis qui vous est adressé.'}</Text>}
    </ScrollView></View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}});
