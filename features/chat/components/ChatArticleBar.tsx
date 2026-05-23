import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import type { ChatArticleBarProps } from '../types';

export const ChatArticleBar = React.memo(function ChatArticleBar({
  article,
  articleTitle,
  articlePrice,
}: ChatArticleBarProps) {
  const imageUrl = article.images?.[0]?.url;

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
        <Text style={styles.price}>
          ${articlePrice?.toFixed(2)}
        </Text>
      </View>
      <Pressable style={styles.viewButton}>
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
