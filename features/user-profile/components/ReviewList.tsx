/**
 * ReviewList — Rating summary header + reviews list.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, fonts, spacing } from '@/constants/theme';
import { UserStats } from '@/services/userStatsService';
import type { ProfileReview } from '../types';

import { ReviewItem } from './ReviewItem';

interface ReviewListProps {
  stats: UserStats | null;
  reviews: ProfileReview[];
  isLoading?: boolean;
  isOwnProfile?: boolean;
  onReviewerPress: (reviewerId: string) => void;
}

export const ReviewList = React.memo(function ReviewList({
  stats,
  reviews,
  isLoading = false,
  isOwnProfile = false,
  onReviewerPress,
}: ReviewListProps) {
  return (
    <View style={styles.reviewsContainer}>
      {/* Rating Summary */}
      {stats && stats.nombreAvis > 0 && (
        <Animated.View
          entering={FadeInDown.duration(400)}
          style={styles.ratingHeader}
        >
          <Text style={styles.ratingScore}>
            {stats.moyenneNote.toFixed(1)}
          </Text>
          <View style={styles.ratingDetails}>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Ionicons
                  key={star}
                  name={
                    star <= Math.round(stats.moyenneNote)
                      ? 'star'
                      : 'star-outline'
                  }
                  size={16}
                  color={colors.rust}
                />
              ))}
            </View>
            <Text style={styles.ratingCount}>
              {stats.nombreAvis} {stats.nombreAvis > 1 ? 'évaluations' : 'évaluation'}
            </Text>
          </View>
        </Animated.View>
      )}

      {/* Reviews */}
      {isLoading ? (
        <View style={styles.emptyTab}>
          <ActivityIndicator size="small" color={colors.muted} />
        </View>
      ) : reviews.length === 0 ? (
        <View style={styles.emptyTab}>
          <Ionicons name="chatbubble-outline" size={40} color={colors.muted} />
          <Text style={styles.emptyTabText}>
            {isOwnProfile
              ? 'Les avis de vos acheteurs apparaîtront ici.'
              : 'Aucun avis pour le moment'}
          </Text>
        </View>
      ) : (
        reviews.map((review, index) => (
          <ReviewItem
            key={review.id}
            review={review}
            index={index}
            onReviewerPress={onReviewerPress}
          />
        ))
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  reviewsContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    minHeight: 300,
  },
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  ratingScore: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 42,
    lineHeight: 48,
    color: colors.charcoal,
  },
  ratingDetails: {
    gap: spacing.xs,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  ratingCount: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
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
