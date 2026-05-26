/**
 * Article detail screen — loading & error states.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton } from '@/components/ui/Skeleton';
import { colors, radius, spacing } from '@/constants/theme';

import { articleStyles as styles } from '../styles';

const { width: SCREEN_W } = Dimensions.get('window');

function LoadingStateComponent() {
  return (
    <SafeAreaView style={styles.container}>
      {/* Hero image placeholder */}
      <Skeleton width="100%" height={SCREEN_W * 1.2} borderRadius={radius.none} />

      <View style={skeletonStyles.infoBlock}>
        {/* Brand + Category */}
        <Skeleton width="35%" height={10} style={skeletonStyles.gap12} />
        {/* Title */}
        <Skeleton width="75%" height={28} style={skeletonStyles.gap8} />
        <Skeleton width="50%" height={28} style={skeletonStyles.gap16} />
        {/* Price */}
        <Skeleton width="30%" height={34} style={skeletonStyles.gap12} />
        {/* Engagement row */}
        <View style={skeletonStyles.row}>
          <Skeleton width={60} height={12} />
          <Skeleton width={60} height={12} />
          <Skeleton width={80} height={12} />
        </View>
        {/* Tags */}
        <View style={skeletonStyles.tagsRow}>
          <Skeleton width={70} height={28} borderRadius={radius.none} />
          <Skeleton width={90} height={28} borderRadius={radius.none} />
          <Skeleton width={60} height={28} borderRadius={radius.none} />
        </View>
        {/* Description lines */}
        <Skeleton width="100%" height={14} style={skeletonStyles.gap6} />
        <Skeleton width="100%" height={14} style={skeletonStyles.gap6} />
        <Skeleton width="60%" height={14} style={skeletonStyles.gap16} />
        {/* Seller card */}
        <View style={skeletonStyles.sellerRow}>
          <Skeleton width={40} height={40} borderRadius={radius.full} />
          <View style={skeletonStyles.sellerInfo}>
            <Skeleton width="60%" height={14} style={skeletonStyles.gap4} />
            <Skeleton width="40%" height={12} />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const skeletonStyles = StyleSheet.create({
  infoBlock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  sellerInfo: {
    flex: 1,
  },
  gap4: { marginBottom: spacing.xs },
  gap6: { marginBottom: 6 },
  gap8: { marginBottom: spacing.sm },
  gap12: { marginBottom: 12 },
  gap16: { marginBottom: spacing.md },
});

export const LoadingState = React.memo(LoadingStateComponent);

interface ErrorStateProps {
  onBack: () => void;
  /** true when useQuery caught a network/fetch error (vs article simply not found) */
  isNetworkError?: boolean;
}

function ErrorStateComponent({ onBack, isNetworkError = false }: ErrorStateProps) {
  const icon = isNetworkError ? 'cloud-offline-outline' : 'bag-remove-outline';
  const title = isNetworkError
    ? 'Erreur de connexion'
    : 'Cet article n’est plus disponible';
  const subtitle = isNetworkError
    ? 'Impossible de charger cet article. Vérifiez votre connexion et réessayez.'
    : 'Il a peut-être été vendu ou supprimé par le vendeur.';

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View entering={FadeIn.duration(300)} style={styles.errorContainer}>
        <View style={styles.errorIconCircle}>
          <Ionicons name={icon} size={40} color={colors.muted} />
        </View>
        <Text style={styles.errorTitle}>{title}</Text>
        <Text style={styles.errorText}>{subtitle}</Text>
        <Pressable style={styles.errorButton} onPress={onBack}>
          <Text style={styles.errorButtonText}>
            {isNetworkError ? 'Retour' : 'Retour à l’accueil'}
          </Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

export const ErrorState = React.memo(ErrorStateComponent);
