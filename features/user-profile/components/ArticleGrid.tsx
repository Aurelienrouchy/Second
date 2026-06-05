/**
 * ArticleGrid — Virtualized grid of seller articles using FlashList.
 */

import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import React, { useCallback, type ReactElement } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/constants/theme';
import { Article } from '@/types';

import { ArticleGridItem } from './ArticleGridItem';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_GAP = 2;
const NUM_COLUMNS = 3;

interface ArticleGridProps {
  articles: Article[];
  onArticlePress: (articleId: string) => void;
  /**
   * Header rendered above the grid (profile header + actions + tabs). When
   * provided, the FlashList is the screen's single scroll container, so
   * virtualization stays alive even for sellers with 50-200 articles.
   */
  ListHeaderComponent?: ReactElement;
  /**
   * Indices of the header children to pin while scrolling (e.g. the tabs row).
   * Forwarded to FlashList's `stickyHeaderIndices`.
   */
  stickyHeaderIndices?: number[];
  /** Padding applied at the very bottom of the scrollable grid. */
  bottomInset?: number;
}

const keyExtractor = (item: Article) => item.id;

export const ArticleGrid = React.memo(function ArticleGrid({
  articles,
  onArticlePress,
  ListHeaderComponent,
  stickyHeaderIndices,
  bottomInset = 0,
}: ArticleGridProps) {
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
  const ListEmptyComponent = ListHeaderComponent ? GridEmpty : undefined;

  if (articles.length === 0 && !ListHeaderComponent) {
    return <GridEmpty />;
  }

  return (
    <View style={styles.gridWrapper}>
      <FlashList
        data={articles}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={NUM_COLUMNS}
        ItemSeparatorComponent={GridSeparator}
        ListHeaderComponent={ListHeaderComponent}
        stickyHeaderIndices={stickyHeaderIndices}
        ListEmptyComponent={ListEmptyComponent}
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
    width: SCREEN_WIDTH,
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
