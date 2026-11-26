import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ui';
import { ChildSafetyCommandPanel } from '@/components/ChildSafetyCommandPanel';
import { ProductPhysicalCommandPanel } from '@/components/ProductPhysicalCommandPanel';
import { ProductRoutingCommandHistory } from '@/components/ProductRoutingCommandHistory';
import {ProductMixedOrdersCommandHistory} from '@/components/ProductMixedOrdersCommandHistory';
import { ProductReviewCommandPanel } from '@/components/ProductReviewCommandPanel';
import { isProductReviewContext } from '@/services/productReviewService';
import { colors, spacing, typography } from '@/constants/theme';

/** Admission failure exposes only the SDK actor's exact local intention and native receipt. */
export function ProductReviewHistory({uid}: {uid: string}) {
  const router = useRouter(), params = useLocalSearchParams<{contextKind?: string; contextId?: string}>();
  const context = {kind: params.contextKind, id: params.contextId};
  return <View style={styles.container}><ScreenHeader title="Mon intention conservée" onBack={() => router.back()} />
    <ScrollView contentContainerStyle={styles.content}><Text style={styles.body}>L’accès opérateur actuel ne peut pas être qualifié. Les dossiers privés et les nouvelles démarches sont masqués. Vous pouvez seulement relire votre propre reçu ou neutraliser une intention non engagée.</Text>
      <ProductRoutingCommandHistory uid={uid} />
      <ProductMixedOrdersCommandHistory uid={uid}/>
      {isProductReviewContext(context) ? <><ProductReviewCommandPanel uid={uid} context={context} sourceKey="historical-receipt-only" draft={null} enabled={false} allowResume={false} parcel={context.kind === 'order'}
        onRecorded={() => {}} onSubmitted={() => {}} />{context.kind === 'order' ? <ProductPhysicalCommandPanel uid={uid} context={{kind: 'order', id: context.id}} draft={null} enabled={false} /> : null}{context.kind === 'article_listing' ? <ChildSafetyCommandPanel uid={uid} articleId={context.id} kind="admission" draft={null} sourceKey="" enabled={false} /> : null}</> : <Text style={styles.body}>Ouvrez la référence d’origine de votre intention pour relire son journal personnel.</Text>}
    </ScrollView></View>;
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background}, content: {padding: spacing.md, gap: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}});
