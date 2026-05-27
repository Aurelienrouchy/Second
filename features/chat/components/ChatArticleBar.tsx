import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import type { ChatArticleBarProps } from '../types';

export const ChatArticleBar = React.memo(function ChatArticleBar({
  article,
  articleTitle,
  articlePrice,
  snapshotPrice,
  snapshotImage,
}: ChatArticleBarProps) {
  const router = useRouter();
  const isUnavailable = article === null;
  const isSold = article?.isSold === true;
  const imageUrl = article?.images?.[0]?.url ?? snapshotImage;
  const displayPrice = articlePrice ?? snapshotPrice;

  // Detect whether the price changed since the chat was created
  const priceChanged =
    !isUnavailable &&
    snapshotPrice != null &&
    articlePrice != null &&
    Math.abs(snapshotPrice - articlePrice) >= 0.01;

  return (
    <View style={[styles.container, isUnavailable && styles.containerUnavailable]}>
      <View style={styles.imageWrapper}>
        <Image
          source={imageUrl ? { uri: imageUrl } : undefined}
          style={[styles.image, (isUnavailable || isSold) && styles.imageUnavailable]}
          contentFit="cover"
        />
        {isSold && (
          <View style={styles.soldOverlay}>
            <Text style={styles.soldOverlayText}>VENDU</Text>
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {articleTitle ?? 'Article'}
        </Text>
        {isUnavailable ? (
          <Text style={styles.unavailableLabel}>Article indisponible</Text>
        ) : (
          <View style={styles.priceRow}>
            {priceChanged && (
              <Text style={styles.oldPrice}>
                {formatPrice(snapshotPrice)}
              </Text>
            )}
            <Text style={styles.price}>
              {displayPrice != null ? formatPrice(displayPrice) : ''}
            </Text>
          </View>
        )}
      </View>
      {!isUnavailable && (
        <Pressable
          style={[styles.viewButton, isSold && styles.viewButtonDisabled]}
          onPress={() => router.push(`/article/${article.id}`)}
          disabled={isSold}
        >
          <Text style={[styles.viewButtonText, isSold && styles.viewButtonTextDisabled]}>VOIR</Text>
        </Pressable>
      )}
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
  containerUnavailable: {
    opacity: 0.7,
  },
  imageWrapper: {
    position: 'relative',
    marginRight: spacing.md,
  },
  image: {
    width: 48,
    height: 60,
    borderRadius: radius.xs,
  },
  imageUnavailable: {
    opacity: 0.5,
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
  unavailableLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.danger,
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
