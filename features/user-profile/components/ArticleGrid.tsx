/**
 * ArticleGrid — Virtualized grid of seller articles using FlashList.
 */

import { Ionicons } from '@expo/vector-icons';
import { FlashList } from '@shopify/flash-list';
import React, { useCallback } from 'react';
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
}

const keyExtractor = (item: Article) => item.id;

export const ArticleGrid = React.memo(function ArticleGrid({
  articles,
  onArticlePress,
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

  if (articles.length === 0) {
    return (
      <View style={styles.emptyTab}>
        <Ionicons name="shirt-outline" size={40} color={colors.muted} />
        <Text style={styles.emptyTabText}>Aucun article en vente</Text>
      </View>
    );
  }

  return (
    <View style={styles.gridWrapper}>
      <FlashList
        data={articles}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        numColumns={NUM_COLUMNS}
        scrollEnabled={false}
        ItemSeparatorComponent={GridSeparator}
      />
    </View>
  );
});

const GridSeparator = React.memo(function GridSeparator() {
  return <View style={styles.separator} />;
});

const styles = StyleSheet.create({
  gridWrapper: {
    minHeight: 300,
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
