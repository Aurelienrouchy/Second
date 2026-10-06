/**
 * ArticleGrid — Virtualized grid of seller articles using FlashList.
 */

import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import React, { useCallback, useLayoutEffect, useRef, type ReactElement } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/constants/theme';
import { Article } from '@/types';

import { ArticleGridItem } from './ArticleGridItem';

const GRID_GAP = 2;
const NUM_COLUMNS = 3;

interface ArticleGridProps {
  articles: Article[];
  onArticlePress: (articleId: string) => void;
  /**
   * Header rendered above the grid (profile header + actions + tabs). When
   * provided, the FlashList is the screen's single scroll container, so
   * virtualization stays alive even for sellers with 50-200 articles.
   *
   * Note: FlashList's `stickyHeaderIndices` targets data-row indices, not the
   * children of `ListHeaderComponent`, so pinning the tabs row from here is not
   * possible with a single-element header. Sticky tabs are handled on the
   * reviews tab (plain ScrollView) instead.
   */
  ListHeaderComponent?: ReactElement;
  ListFooterComponent?: ReactElement;
  /** Keep one list/header mounted while retaining each tab's user scroll position. */
  contentKey?: string;
  showEmptyState?: boolean;
  /** Padding applied at the very bottom of the scrollable grid. */
  bottomInset?: number;
}

const keyExtractor = (item: Article) => item.id;

export const ArticleGrid = React.memo(function ArticleGrid({
  articles,
  onArticlePress,
  ListHeaderComponent,
  ListFooterComponent,
  contentKey = 'articles',
  showEmptyState = true,
  bottomInset = 0,
}: ArticleGridProps) {
  const listRef = useRef<FlashListRef<Article>>(null);
  const offsets = useRef<Record<string, number>>({});
  const userScrolling = useRef(false);
  const restoringOffset = useRef<number | null>(null);
  const previousContentKey = useRef(contentKey);

  const restoreScroll = useCallback(() => {
    if (restoringOffset.current === null) return;
    listRef.current?.scrollToOffset({ offset: restoringOffset.current, animated: false, skipFirstItemOffset: true });
  }, []);

  useLayoutEffect(() => {
    if (previousContentKey.current === contentKey) return;
    previousContentKey.current = contentKey;
    userScrolling.current = false;
    restoringOffset.current = offsets.current[contentKey] ?? 0;
    const frame = requestAnimationFrame(restoreScroll);
    return () => cancelAnimationFrame(frame);
  }, [contentKey, restoreScroll]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (userScrolling.current) offsets.current[contentKey] = event.nativeEvent.contentOffset.y;
  }, [contentKey]);
  const renderItem = useCallback(
    ({ item }: { item: Article }) => (
      <ArticleGridItem
        article={item}
        onPress={onArticlePress}
      />
    ),
    [onArticlePress],
  );

  // Empty state still needs the header (profile + tabs) above it when this
  // grid drives the whole screen, so render it through the FlashList rather
  // than short-circuiting to a bare empty view.
  const ListEmptyComponent = showEmptyState && ListHeaderComponent ? GridEmpty : undefined;

  if (articles.length === 0 && !ListHeaderComponent && showEmptyState) {
    return <GridEmpty />;
  }

  return (
    <View style={styles.gridWrapper}>
      <FlashList
        ref={listRef}
        testID="profile-content-list"
        data={articles}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={NUM_COLUMNS}
        ItemSeparatorComponent={GridSeparator}
        ListHeaderComponent={ListHeaderComponent}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        maintainVisibleContentPosition={{ disabled: true }}
        onScroll={handleScroll}
        onScrollBeginDrag={() => { userScrolling.current = true; restoringOffset.current = null; }}
        onMomentumScrollEnd={() => { userScrolling.current = false; }}
        onContentSizeChange={restoreScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: bottomInset }}
      />
    </View>
  );
});

const GridEmpty = React.memo(function GridEmpty() {
  return (
    <View style={styles.emptyTab}>
      <Ionicons name="shirt-outline" size={40} color={colors.muted} />
      <Text style={styles.emptyTabText}>Aucun article en vente</Text>
    </View>
  );
});

const GridSeparator = React.memo(function GridSeparator() {
  return <View style={styles.separator} />;
});

const styles = StyleSheet.create({
  gridWrapper: {
    flex: 1,
    width: '100%',
  },
  separator: {
    height: GRID_GAP,
  },
  emptyTab: {
    paddingVertical: spacing['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  emptyTabText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
});
