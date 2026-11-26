import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter, type Href } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, ScreenHeader } from '@/components/ui';
import { colors, spacing, typography } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ArticleModerationService } from '@/services/articleModerationService';
import type { OwnerModerationArticle } from '@/types/articleModeration';
const keyExtractor = (item: OwnerModerationArticle) => item.id;
export default function OwnerModerationArticlesScreen() {
  const uid = useAuthenticatedUid(), router = useRouter();
  const context = useShippingPurchaseContext('owner-moderation-list', uid);
  const articles = useInfiniteQuery({ queryKey: ['owner-moderation-articles', uid, getAuthSessionGeneration(), context.focusRevision],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const operation = context.capture();
      return ArticleModerationService.listOwnerArticles(uid!, pageParam, () => context.assertCurrent(operation));
    }, enabled: !!uid && context.focused, staleTime: 0, gcTime: 0, retry: false,
    getNextPageParam: page => page.hasMore ? page.cursor ?? undefined : undefined });
  const items = articles.data?.pages.flatMap(page => page.items).filter(item => item.moderationStatus === 'pending' || item.moderationStatus === 'rejected' ||
    item.moderationStatus === 'approved' && item.moderationSource === 'operator_report_review') ?? [];
  const renderItem = useCallback(({ item }: { item: OwnerModerationArticle }) => <View style={styles.card}>
    <Text style={styles.title}>{item.title}</Text>
    <Text style={styles.body}>{item.moderationStatus === 'rejected' ? 'Article retiré' : item.moderationStatus === 'approved' ?
      'Modération favorable · décision privée à relire' : 'Article en examen'}</Text>
    <Text style={styles.body}>{item.isActive ? 'L’annonce est actuellement indiquée active.' : 'L’annonce est actuellement indiquée inactive. Une modération favorable seule ne confirme pas une réactivation.'}</Text>
    <Button variant="secondary" onPress={() => router.push(`/article/moderation/${encodeURIComponent(item.id)}` as Href)}>Consulter la décision privée</Button>
  </View>, [router]);
  if (!uid) return <Redirect href="/(tabs)/profile" />;
  return <View style={styles.container}><ScreenHeader title="Décisions sur mes articles" onBack={() => router.back()} />
    <FlashList data={items} keyExtractor={keyExtractor} renderItem={renderItem} contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.card}>
        <Text style={styles.body}>Les articles retirés, en examen et les décisions favorables issues d’un examen opérateur restent accessibles ici. Seul le dossier privé vous communique la décision et son motif ; aucun état affiché ne certifie l’authenticité, les droits de vente ou la disponibilité pour une nouvelle opération.</Text>
        <Button variant="ghost" onPress={() => { void articles.refetch(); }}>Actualiser</Button>
        {articles.isPending ? <Text style={styles.body}>Lecture de vos articles…</Text> : articles.isError ? <Text style={styles.notice}>Impossible de lire ces références. Réessayez ou contactez notre équipe.</Text>
          : items.length === 0 ? <Text style={styles.body}>Aucun dossier de modération correspondant dans les pages consultées.</Text> : null}
        <Button variant="ghost" onPress={() => router.push('/settings/help')}>Contacter notre équipe</Button>
      </View>}
      ListFooterComponent={articles.hasNextPage ? <Button variant="secondary" disabled={articles.isFetchingNextPage}
        loading={articles.isFetchingNextPage} onPress={() => { void articles.fetchNextPage(); }}>Lire les articles suivants</Button> : null} />
  </View>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: colors.background }, content: { padding: spacing.md },
  card: { padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md }, title: { ...typography.h3, color: colors.foreground },
  body: { ...typography.body, color: colors.foregroundSecondary }, notice: { ...typography.body, color: colors.danger } });
