import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import type { ChatArticleBarProps } from '../types';

export const ChatArticleBar = React.memo(function ChatArticleBar({
  article,
  articleTitle,
  articlePrice,
  snapshotPrice,
}: ChatArticleBarProps) {
  const router = useRouter();
  const imageUrl = article.images?.[0]?.url;

  // Detect whether the price changed since the chat was created
  const priceChanged =
    snapshotPrice != null &&
    articlePrice != null &&
    Math.abs(snapshotPrice - articlePrice) >= 0.01;

  return (
    <View style={styles.container}>
      <Image
        source={imageUrl ? { uri: imageUrl } : undefined}
        style={styles.image}
        contentFit="cover"
      />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {articleTitle}
        </Text>
        <View style={styles.priceRow}>
          {priceChanged && (
            <Text style={styles.oldPrice}>
              ${snapshotPrice.toFixed(2)}
            </Text>
          )}
          <Text style={styles.price}>
            ${articlePrice?.toFixed(2)}
          </Text>
        </View>
      </View>
      <Pressable
        style={styles.viewButton}
        onPress={() => router.push(`/article/${article.id}`)}
      >
        <Text style={styles.viewButtonText}>VOIR</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  image: {
    width: 48,
    height: 60,
    borderRadius: radius.xs,
    marginRight: spacing.md,
  },
  info: {
    flex: 1,
  },
  title: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.foreground,
    marginBottom: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  oldPrice: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  price: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 18,
    color: colors.primary,
  },
  viewButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
  },
  viewButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.charcoal,
    letterSpacing: 1.2,
  },
});
