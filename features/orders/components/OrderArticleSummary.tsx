import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius, spacing, typography } from '@/constants/theme';
import type { TransactionArticlePresentation } from '@/utils/transactionArticlePresentation';
import { usePrivateArticleImage } from '@/hooks/usePrivateArticleImage';
import { Button } from '@/components/ui';
import { useRouter, type Href } from 'expo-router';

export function OrderArticleSummary({ terms, compact = false }: {
  terms: TransactionArticlePresentation; compact?: boolean;
}) {
  const router = useRouter();
  const access = terms.transactionId ? { articleId: terms.articleId, transactionId: terms.transactionId } : null;
  const image = usePrivateArticleImage(access, terms.originalImageReferences?.[0] ?? null, terms.privacyWithdrawalRecorded);
  return <View style={styles.container}>
    <View style={styles.header}>
      <Image source={image.image ? { uri: image.image } : undefined} style={styles.image} contentFit="cover" cachePolicy="none" />
      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={compact ? 2 : undefined}>{terms.title}</Text>
        {!compact && terms.brandLabel && <Text style={styles.body}>{terms.brandLabel}</Text>}
        {!compact && terms.sizeLabel && <Text style={styles.body}>Taille {terms.sizeLabel}</Text>}
        {!compact && terms.condition && <Text style={styles.body}>État : {terms.condition}</Text>}
        {compact && (terms.brandLabel || terms.sizeLabel) ? <Text style={styles.source}>{[terms.brandLabel, terms.sizeLabel].filter(Boolean).join(' · ')}</Text> : null}
      </View>
    </View>
    {image.privateImage ? null
      : image.unavailable || image.withdrawalRecorded ? <Text style={styles.source}>Photo de la commande indisponible.</Text> : null}
    {terms.transactionId && image.withdrawalRecorded ? <Button variant="ghost" onPress={() => router.push(
      `/article/privacy/${encodeURIComponent(terms.articleId)}?transactionId=${encodeURIComponent(terms.transactionId!)}` as Href)}>Informations sur l’annonce retirée</Button> : null}
    {!compact && <>
      {terms.saleUnitLabel ? <Text style={styles.body}>{terms.saleUnitLabel}</Text> : null}
      {terms.description && <Text style={styles.body}>{terms.description}</Text>}
      {terms.historicalColorsLabel ? <><Text style={styles.label}>Couleurs</Text><Text style={styles.body}>{terms.historicalColorsLabel}</Text></> : null}
      {terms.historicalMaterialsLabel ? <><Text style={styles.label}>Matières</Text><Text style={styles.body}>{terms.historicalMaterialsLabel}</Text></> : null}
      {terms.hygieneLabel && <>
        <Text style={styles.label}>Déclaration du vendeur — hygiène</Text>
        <Text style={styles.body}>{terms.hygieneLabel}</Text>
      </>}
      <Text style={styles.label}>Défauts déclarés</Text>
      <Text style={styles.body}>{terms.defectsLabel}</Text>
      <Text style={styles.label}>Retouches déclarées</Text>
      <Text style={styles.body}>{terms.alterationsLabel}</Text>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surfaceWarm },
  header: { flexDirection: 'row', gap: spacing.md },
  image: { width: spacing['4xl'], height: spacing['4xl'], borderRadius: radius.sm, backgroundColor: colors.borderLight },
  titleBlock: { flex: 1, gap: spacing.xs },
  title: { ...typography.body, fontFamily: fonts.sansMedium, color: colors.foreground },
  source: { ...typography.caption, color: colors.muted },
  body: { ...typography.bodySmall, color: colors.foreground },
  label: { ...typography.bodySmall, fontFamily: fonts.sansMedium, color: colors.foreground },
});
