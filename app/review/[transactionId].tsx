/**
 * Review Screen — Leave a review after a completed transaction.
 *
 * Accessible from:
 * - My Orders screen (for delivered/meetup_completed transactions)
 * - My Sales screen (for delivered/meetup_completed transactions)
 *
 * Route: /review/[transactionId]
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScreenHeader } from '@/components/ui';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { useUser } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { ArticlesService } from '@/services/articlesService';
import { createReview } from '@/services/reviewService';
import { TransactionService } from '@/services/transactionService';
import { UserService } from '@/services/userService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import type { Article, Transaction, User } from '@/types';

// =============================================================================
// STAR RATING COMPONENT
// =============================================================================

interface StarRatingProps {
  rating: number;
  onRatingChange: (value: number) => void;
  disabled?: boolean;
}

function StarRating({ rating, onRatingChange, disabled = false }: StarRatingProps) {
  return (
    <View style={starStyles.container}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          onPress={() => {
            if (!disabled) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onRatingChange(star);
            }
          }}
          style={starStyles.starButton}
          hitSlop={8}
          disabled={disabled}
        >
          <Ionicons
            name={star <= rating ? 'star' : 'star-outline'}
            size={36}
            color={star <= rating ? colors.rust : colors.muted}
          />
        </Pressable>
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  starButton: {
    padding: spacing.xs,
  },
});

// =============================================================================
// SCREEN
// =============================================================================

interface ReviewScreenData {
  transaction: Transaction;
  article: Article | null;
  targetUser: User | null;
}

export default function ReviewScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const router = useRouter();
  const currentUser = useUser();
  const showAuthSheet = useAuthSheetStore((state) => state.show);

  // State
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasSubmittedRef = useRef(false);

  // ── Data loading ──

  const { data, isLoading, error } = useQuery<ReviewScreenData | null>({
    queryKey: ['review', 'transaction', transactionId] as const,
    queryFn: async () => {
      if (!transactionId) return null;

      const transaction = await TransactionService.getTransaction(transactionId);
      if (!transaction) return null;

      const [article, targetUser] = await Promise.all([
        ArticlesService.getArticleById(transaction.articleId).catch(() => null),
        // Determine the target user (the other party)
        currentUser?.id === transaction.buyerId
          ? UserService.getUserById(transaction.sellerId).catch(() => null)
          : UserService.getUserById(transaction.buyerId).catch(() => null),
      ]);

      return { transaction, article, targetUser };
    },
    enabled: !!transactionId && !!currentUser,
    staleTime: 10 * 60 * 1000,
  });

  // ── Handlers ──

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleSubmit = useCallback(async () => {
    if (!currentUser?.id) {
      showAuthSheet('Connectez-vous pour laisser un avis');
      return;
    }

    if (rating === 0) {
      Alert.alert('Note requise', 'Veuillez attribuer une note de 1 a 5 etoiles.');
      return;
    }

    if (comment.trim().length > 0 && comment.trim().length < 5) {
      Alert.alert('Commentaire trop court', 'Le commentaire doit contenir au moins 5 caracteres.');
      return;
    }

    if (!data?.transaction || hasSubmittedRef.current || isSubmitting) return;

    const { transaction } = data;
    const targetUserId =
      currentUser.id === transaction.buyerId
        ? transaction.sellerId
        : transaction.buyerId;
    const transactionType: 'achat' | 'vente' =
      currentUser.id === transaction.buyerId ? 'achat' : 'vente';

    hasSubmittedRef.current = true;
    setIsSubmitting(true);

    try {
      await createReview({
        targetUserId,
        transactionId: transaction.id,
        transactionType,
        note: rating,
        text: comment.trim() || 'Bonne transaction.',
        articleId: transaction.articleId,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Merci pour votre avis !',
        'Votre evaluation a bien ete enregistree.',
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (err: unknown) {
      hasSubmittedRef.current = false;
      const message =
        err instanceof Error && err.message.includes('already')
          ? 'Vous avez deja laisse un avis pour cette transaction.'
          : 'Une erreur est survenue. Veuillez reessayer.';
      Alert.alert('Erreur', message);
      if (__DEV__) console.error('Error submitting review:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [currentUser, data, rating, comment, isSubmitting, router, showAuthSheet, transactionId]);

  // ── Auth guard ──

  if (!currentUser) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Laisser un avis" onBack={handleBack} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Connectez-vous pour laisser un avis.</Text>
        </View>
      </View>
    );
  }

  // ── Loading ──

  if (isLoading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Laisser un avis" onBack={handleBack} />
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </View>
    );
  }

  // ── Error / Not found ──

  if (error || !data?.transaction) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Laisser un avis" onBack={handleBack} />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.muted} />
          <Text style={styles.errorText}>Transaction introuvable.</Text>
        </View>
      </View>
    );
  }

  const { transaction, article, targetUser } = data;
  const firstImage = article?.images?.[0];
  // Mirrors the backend gate in `functions/src/callable/reviews.ts`
  // (`terminalStatuses`): a shipping order stays reviewable after it flips from
  // `delivered` to `completed` (J+7 dispute window), and a meetup order once
  // `meetup_completed`.
  const isCompleted =
    transaction.status === 'delivered' ||
    transaction.status === 'completed' ||
    transaction.status === 'meetup_completed';

  if (!isCompleted) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Laisser un avis" onBack={handleBack} />
        <View style={styles.centered}>
          <Ionicons name="time-outline" size={48} color={colors.muted} />
          <Text style={styles.errorText}>
            Vous pourrez laisser un avis une fois la transaction terminee.
          </Text>
        </View>
      </View>
    );
  }

  // ── Render ──

  return (
    <View style={styles.container}>
      <ScreenHeader title="Laisser un avis" onBack={handleBack} />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Article preview */}
        <View style={styles.articleCard}>
          {firstImage?.url ? (
            <Image
              source={{ uri: firstImage.url }}
              style={styles.articleImage}
              contentFit="cover"
              transition={200}
              placeholder={
                firstImage.blurhash
                  ? { blurhash: firstImage.blurhash }
                  : undefined
              }
              cachePolicy="memory-disk"
            />
          ) : (
            <View style={[styles.articleImage, styles.articleImagePlaceholder]}>
              <Ionicons name="image-outline" size={24} color={colors.muted} />
            </View>
          )}
          <View style={styles.articleInfo}>
            <Text style={styles.articleTitle} numberOfLines={2}>
              {article?.title || 'Article'}
            </Text>
            {targetUser && (
              <Text style={styles.targetUserName} numberOfLines={1}>
                {currentUser.id === transaction.buyerId
                  ? `Vendu par ${targetUser.displayName || 'Utilisateur'}`
                  : `Achete par ${targetUser.displayName || 'Utilisateur'}`}
              </Text>
            )}
          </View>
        </View>

        {/* Rating */}
        <View style={styles.ratingSection}>
          <Text style={styles.sectionTitle}>Votre note</Text>
          <StarRating
            rating={rating}
            onRatingChange={setRating}
            disabled={isSubmitting}
          />
          {rating > 0 && (
            <Text style={styles.ratingLabel}>
              {rating === 1 && 'Mauvais'}
              {rating === 2 && 'Decevant'}
              {rating === 3 && 'Correct'}
              {rating === 4 && 'Bien'}
              {rating === 5 && 'Excellent'}
            </Text>
          )}
        </View>

        {/* Comment */}
        <View style={styles.commentSection}>
          <Text style={styles.sectionTitle}>Votre commentaire</Text>
          <TextInput
            style={styles.commentInput}
            value={comment}
            onChangeText={setComment}
            placeholder="Partagez votre experience..."
            placeholderTextColor={colors.muted}
            multiline
            maxLength={2000}
            editable={!isSubmitting}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{comment.length}/2000</Text>
        </View>

        {/* Submit */}
        <Pressable
          style={[
            styles.submitButton,
            (rating === 0 || isSubmitting) && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={rating === 0 || isSubmitting}
        >
          <Text style={styles.submitButtonText}>
            {isSubmitting ? 'Envoi en cours...' : 'ENVOYER MON AVIS'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 100,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  loadingText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },

  // Article card
  articleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xl,
  },
  articleImage: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: colors.borderLight,
  },
  articleImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  articleInfo: {
    flex: 1,
    gap: 4,
  },
  articleTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.charcoal,
  },
  targetUserName: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.muted,
  },

  // Rating
  ratingSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 18,
    lineHeight: 24,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  ratingLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.rust,
    marginTop: spacing.xs,
  },

  // Comment
  commentSection: {
    marginBottom: spacing.xl,
  },
  commentInput: {
    minHeight: 120,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.charcoal,
    marginTop: spacing.sm,
  },
  charCount: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    textAlign: 'right',
    marginTop: spacing.xs,
  },

  // Submit
  submitButton: {
    backgroundColor: colors.charcoal,
    paddingVertical: 16,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.16,
    color: colors.cream,
  },
});
