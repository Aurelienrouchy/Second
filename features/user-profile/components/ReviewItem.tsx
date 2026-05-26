/**
 * ReviewItem — Single review card with avatar, stars, and text.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, fonts, spacing } from '@/constants/theme';
import type { ProfileReview } from '../types';

interface ReviewItemProps {
  review: ProfileReview;
  index: number;
  onReviewerPress?: (reviewerId: string) => void;
}

export const ReviewItem = React.memo(function ReviewItem({
  review,
  index,
  onReviewerPress,
}: ReviewItemProps) {
  const renderStars = useCallback((note: number) => {
    return [1, 2, 3, 4, 5].map((star) => (
      <Ionicons
        key={star}
        name={star <= Math.round(note) ? 'star' : 'star-outline'}
        size={12}
        color={colors.rust}
      />
    ));
  }, []);

  return (
    <Animated.View
      entering={FadeInDown.duration(300).delay(100 + index * 60)}
      style={styles.reviewItem}
    >
      <View style={styles.reviewHeader}>
        <Pressable
          style={styles.reviewAvatarContainer}
          onPress={() => review.reviewerId && onReviewerPress?.(review.reviewerId)}
          disabled={!review.reviewerId}
        >
          {review.reviewerImage ? (
            <Image
              source={{ uri: review.reviewerImage }}
              style={styles.reviewAvatar}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.reviewAvatar, styles.reviewAvatarPlaceholder]}>
              <Text style={styles.reviewAvatarInitial}>
                {review.reviewerName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </Pressable>
        <View style={styles.reviewMeta}>
          <Text style={styles.reviewName}>{review.reviewerName}</Text>
          <View style={styles.reviewStarsRow}>{renderStars(review.note)}</View>
        </View>
        <Text style={styles.reviewDate}>
          {new Date(review.date).toLocaleDateString('fr-CA', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </Text>
      </View>
      <Text style={styles.reviewText}>{review.text}</Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  reviewItem: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  reviewAvatarContainer: {},
  reviewAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  reviewAvatarPlaceholder: {
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewAvatarInitial: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.charcoal,
  },
  reviewMeta: {
    flex: 1,
    gap: 2,
  },
  reviewName: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.charcoal,
  },
  reviewStarsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewDate: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
  },
  reviewText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.charcoal,
  },
});
