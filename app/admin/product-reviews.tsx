import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, ScreenHeader } from '@/components/ui';
import { ChildSafetyAdmissionPanel } from '@/components/ChildSafetyAdmissionPanel';
import { ProductPhysicalReviewPanel } from '@/components/ProductPhysicalReviewPanel';
import { ProductReviewCasePanel } from '@/components/ProductReviewCasePanel';
import { CommercialClaimReviewPanel } from '@/components/CommercialClaimReviewPanel';
import { ProductRoutingReviewPanel } from '@/components/ProductRoutingReviewPanel';
import { AdminFinancialReauthentication, AdminProductCommercialReturnPanel, AdminSectionNav, AdminLateCommercialReview, AdminCommercialClaimReexamination } from '@/features/admin';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { isProductReviewContext } from '@/services/productReviewService';
import { createProductRoutingInteraction } from '@/utils/productRoutingStatement';
import type { ProductReviewContext } from '@/types/productReview';
import { colors, spacing, typography } from '@/constants/theme';

export default function AdminProductReviewsScreen() {
  const uid = useAuthenticatedUid(), router = useRouter(), params = useLocalSearchParams<{contextKind?: string; contextId?: string}>();
  const frame = useShippingPurchaseContext('product-review-admin-lookup', uid), key = JSON.stringify([uid, getAuthSessionGeneration(), frame.focusRevision]);
  const [search, setSearch] = useState<{key: string; kind: ProductReviewContext['kind'] | null; id: string} | null>(null);
  const [selection, setSelection] = useState<{key: string; context: ProductReviewContext} | null>(null);
  const [commercialRevision, setCommercialRevision] = useState(0);
  const form = search?.key === key ? search : {key, kind: null, id: ''};
  const candidate = {kind: params.contextKind, id: params.contextId};
  const context = selection?.key === key ? selection.context : isProductReviewContext(candidate) ? candidate : null;
  const routingKey = JSON.stringify([key, context]);
  const [routingFrame, setRoutingFrame] = useState(() => ({key: routingKey, interaction: createProductRoutingInteraction()}));
  let currentRoutingFrame = routingFrame;
  if (routingFrame.key !== routingKey) {
    routingFrame.interaction.invalidate();
    currentRoutingFrame = {key: routingKey, interaction: createProductRoutingInteraction()};
    setRoutingFrame(currentRoutingFrame);
  }
  const assertRoutingSelection = currentRoutingFrame.interaction.capture();
  return <View style={styles.container}><ScreenHeader title="Examen des produits" onBack={() => router.back()} /><AdminSectionNav />
    <ScrollView contentContainerStyle={styles.content}>
      {uid ? <AdminLateCommercialReview uid={uid} supportRequestId={null} /> : null}
      <Text style={styles.body}>Choisissez une commande, un signalement ou une annonce en préparation exacte. Les sources privées et les actions apparaissent seulement après leur lecture opérateur actuelle sur le serveur.</Text>
      <Button variant={form.kind === 'order' ? 'primary' : 'secondary'} onPress={() => setSearch({...form, kind: 'order'})}>Commande</Button>
      <Button variant={form.kind === 'article_report' ? 'primary' : 'secondary'} onPress={() => setSearch({...form, kind: 'article_report'})}>Signalement d’annonce</Button>
      <Button variant={form.kind === 'article_listing' ? 'primary' : 'secondary'} onPress={() => setSearch({...form, kind: 'article_listing'})}>Préparation d’annonce enfant</Button>
      <TextInput accessibilityLabel="Référence exacte de la commande ou du signalement" value={form.id} maxLength={128} autoCapitalize="none" style={styles.input} onChangeText={id => setSearch({...form, id})} />
      <Button variant="secondary" disabled={!uid || !frame.focused || !isProductReviewContext({kind: form.kind, id: form.id.trim()})} onPress={() => {
        const requested = {kind: form.kind, id: form.id.trim()}; if (!isProductReviewContext(requested)) return;
        try {frame.capture(); currentRoutingFrame.interaction.invalidate(); setCommercialRevision(revision => revision + 1); setSelection({key, context: requested}); router.setParams({contextKind: requested.kind, contextId: requested.id});} catch { /* No stale-session private lookup. */ }}}>Lire ce dossier exact</Button>
      {uid && context && frame.focused ? <><ProductReviewCasePanel uid={uid} context={context} scope="admin" material={context.kind === 'order'} parcel={context.kind === 'order'} routeAmendment={context.kind === 'order'} routingReview={context.kind === 'order'} mixedOrders={context.kind === 'order'} assertRoutingSelection={assertRoutingSelection}
        renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="commercial" />}
        renderOrderPhysical={context.kind === 'order' ? nativeAdmission => <ProductPhysicalReviewPanel uid={uid} context={{kind: 'order', id: context.id}} scope="admin" nativeAdmission={nativeAdmission} /> : undefined}
        renderOrderRouting={context.kind === 'order' ? nativeAdmission => <ProductRoutingReviewPanel uid={uid} transactionId={context.id} scope="admin" nativeAdmission={nativeAdmission} assertSelection={assertRoutingSelection} renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="commercial" parcel />} /> : undefined}
        renderOrderCommercial={context.kind === 'order' ? nativeAdmission => <><AdminProductCommercialReturnPanel uid={uid} transactionId={context.id} nativeAdmission={nativeAdmission} />
          <CommercialClaimReviewPanel key={JSON.stringify([key, context, commercialRevision])} uid={uid} transactionId={context.id} scope="admin" nativeAdmission={nativeAdmission} assertSelection={assertRoutingSelection}
            renderReauthentication={props => <AdminFinancialReauthentication {...props} purpose="commercial" parcel />}
            renderReexamination={state => <AdminCommercialClaimReexamination uid={uid} transactionId={state.transactionId} claimId={state.claimId} reference={state.reference} nativeAdmission={nativeAdmission}
              assertSelection={() => {assertRoutingSelection(); state.assertCurrent();}} />} /></> : undefined} />{context.kind === 'article_listing' ? <ChildSafetyAdmissionPanel uid={uid} articleId={context.id} scope="admin" /> : null}</> : null}
      <Text style={styles.caption}>Après perte de l’accès opérateur, seul votre propre journal d’intention peut être relu pour la référence choisie. Cette relecture ne donne accès à aucune nouvelle source privée.</Text>
    </ScrollView></View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted},
  input: {...typography.bodySmall, color: colors.foreground, borderWidth: 1, borderColor: colors.border, padding: spacing.md}});
