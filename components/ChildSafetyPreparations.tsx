import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Button } from '@/components/ui';
import { useShippingPurchaseContext } from '@/hooks/useShippingPurchaseContext';
import { getAuthSessionGeneration } from '@/store/authStore';
import { ArticlesService } from '@/services/articlesService';
import { isProductReviewContext } from '@/services/productReviewService';
import { colors, spacing, typography } from '@/constants/theme';
/** This owner index only opens a dossier; no marker or cached row grants an action. */
export function ChildSafetyPreparations({uid}: {uid: string}) {
  const router = useRouter(), scope = useShippingPurchaseContext('child-safety-preparations', uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), scope.focusRevision]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const page = useInfiniteQuery({queryKey: ['child-safety-preparations', key], enabled: scope.focused && expanded === key, initialPageParam: null as string | null, staleTime: 0, gcTime: 0, retry: false,
    queryFn: ({pageParam}) => {const operation = scope.capture(); return ArticlesService.getUserArticlePreparations(uid, pageParam, () => scope.assertCurrent(operation));}, getNextPageParam: p => p.hasMore ? p.cursor : undefined});
  const rows = page.data?.pages.flatMap(p => p.items) ?? [], unique = new Set(rows.map(r => r.articleId)).size === rows.length;
  const readable = scope.focused && expanded === key && page.isSuccess && !page.isFetching && !page.error && unique;
  return <View style={styles.section}>
    <Button variant="secondary" onPress={() => {try {scope.capture(); setExpanded(expanded === key ? null : key);} catch { /* No old-account navigation. */ }}}>Mes dossiers d’annonces enfant</Button>
    {expanded === key && scope.focused ? <>
      <Text style={styles.caption}>Ces références servent à retrouver les préparations, y compris après un retrait. Chaque dossier doit être relu pour connaître son état et ses actions actuels.</Text>
      {page.isFetching || page.isPending ? <Text style={styles.body}>Lecture de vos références natives…</Text> : page.error || !unique ? <><Text style={styles.body}>La liste ne peut pas être qualifiée. Les anciennes références sont masquées.</Text><Button variant="secondary" onPress={() => {void page.refetch();}}>Relire les références</Button></> : null}
      {readable ? <>
        <Text style={styles.caption}>{rows.length} dossier(s) affiché(s), {page.data.pages.reduce((n, p) => n + p.inspected, 0)} annonce(s) inspectée(s). La liste n’est pas complète tant qu’une page suivante existe.</Text>
        <View style={styles.list}><FlashList data={rows} keyExtractor={r => r.articleId} renderItem={({item}) => <Button variant="ghost" disabled={!isProductReviewContext({kind: 'article_listing', id: item.articleId})} onPress={() => {try {scope.capture(); router.push({pathname: '/product-review', params: {contextKind: 'article_listing', contextId: item.articleId}} as never);} catch { /* No permission from this reference. */ }}}>{item.title ?? 'Préparation à lire'}</Button>} /></View>
        {page.hasNextPage ? <Button variant="secondary" onPress={() => {void page.fetchNextPage();}}>Inspecter la page suivante des annonces</Button> : null}
      </> : null}
    </> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm, padding: spacing.md}, body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}, list: {height: spacing.xl * 5}});
