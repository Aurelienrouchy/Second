/**
 * Profile Screen (Own Profile)
 * Design System: Editorial Luxe — Cream, Charcoal, Rust, Sage
 *
 * Features:
 * - Cream header with displayMedium title + MODIFIER CTA
 * - Avatar + name + handle + member since (horizontal layout)
 * - Bio section
 * - Stats row matching public profile (Articles, Ventes, Note, Abonnes)
 * - Menu sections with colored icon circles
 * - Sign out button with danger border
 */

import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useQuery } from '@tanstack/react-query';

import { ScreenHeader, Text } from '@/components/ui';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { colors, radius, spacing, typography } from '@/constants/theme';
import { useAuthActions } from '@/contexts/AuthContext';
import {
  GuestState,
  ProfileHeader,
  ProfileMenu,
} from '@/features/profile';
import type { MenuItem } from '@/features/profile';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { useWallet } from '@/hooks/useWallet';
import { UserStatsService } from '@/services/userStatsService';
import { formatCents } from '@/utils/formatPrice';

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ProfileScreen() {
  const { signOut } = useAuthActions();
  const { user, requireAuth, showAuthSheet } = useAuthRequired();
  const router = useRouter();

  const { data: stats } = useQuery({
    queryKey: ['users', 'stats', user?.id] as const,
    queryFn: () => UserStatsService.getUserStats(user!.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const { wallet } = useWallet(!!user);

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Déconnexion',
      'Êtes-vous sûr de vouloir vous déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Se déconnecter',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            try {
              await signOut();
            } catch (error) {
              if (__DEV__) console.error('Error signing out:', error);
            }
          },
        },
      ]
    );
  }, [signOut]);

  const handleMenuItemPress = useCallback(
    (item: MenuItem) => {
      requireAuth(
        item.action,
        `Vous devez être connecté pour accéder à ${item.title.toLowerCase()}.`,
      );
    },
    [requireAuth],
  );

  const handleConnect = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showAuthSheet(AUTH_MESSAGES.default);
  }, [showAuthSheet]);

  const handleEditProfile = useCallback(() => {
    router.push('/settings/profile-details');
  }, [router]);

  const menuItems: MenuItem[] = useMemo(
    () => [
      {
        id: 'orders',
        title: 'Mes commandes',
        icon: 'cube-outline',
        iconColor: colors.rust,
        iconBg: colors.primaryLight,
        action: () => router.push('/my-orders'),
      },
      {
        id: 'selling',
        title: 'Mes ventes',
        icon: 'pricetag-outline',
        iconColor: colors.sage,
        iconBg: colors.sageLight,
        action: () => router.push('/my-sales'),
      },
      {
        id: 'my-swaps',
        title: 'Mes échanges',
        icon: 'swap-horizontal-outline',
        iconColor: colors.warning,
        iconBg: colors.warningLight,
        action: () => router.push('/my-swaps'),
      },
      {
        id: 'wallet',
        title: 'Porte-monnaie',
        subtitle: wallet?.hasWallet
          ? formatCents(wallet.balance)
          : wallet?.hasWallet === false
            ? 'Non activé'
            : undefined,
        icon: 'wallet-outline',
        iconColor: colors.primary,
        iconBg: colors.primaryLight,
        action: () => router.push('/wallet'),
      },
      {
        id: 'my-articles',
        title: 'Mes articles',
        icon: 'shirt-outline',
        iconColor: colors.charcoal,
        iconBg: colors.surfaceSubtle,
        action: () => router.push('/my-articles'),
      },
      {
        id: 'favorites',
        title: 'Mes favoris',
        icon: 'heart-outline',
        iconColor: colors.danger,
        iconBg: colors.dangerLight,
        action: () => router.push('/(tabs)/favorites'),
      },
      {
        id: 'liked-sellers',
        title: 'Vendeurs aimés',
        icon: 'people-outline',
        iconColor: colors.sage,
        iconBg: colors.sageLight,
        action: () => router.push('/liked-sellers'),
      },
      {
        id: 'saved-searches',
        title: 'Recherches sauvegardées',
        icon: 'bookmark-outline',
        iconColor: colors.sand,
        iconBg: colors.sandLight,
        action: () => router.push('/saved-searches'),
      },
      {
        id: 'settings',
        title: 'Paramètres',
        icon: 'settings-outline',
        iconColor: colors.charcoal,
        iconBg: colors.surfaceSubtle,
        action: () => router.push('/settings'),
      },
      {
        id: 'help',
        title: 'Aide',
        icon: 'help-circle-outline',
        iconColor: colors.charcoal,
        iconBg: colors.surfaceSubtle,
        action: () => router.push('/settings/help'),
      },
    ],
    [router, wallet],
  );

  return (
    <View style={styles.container} testID="profile-screen">
      <ScreenHeader
        title="Mon profil"
        showBack={false}
        rightContent={
          user ? (
            <Pressable style={styles.editButton} onPress={handleEditProfile}>
              <Text style={styles.editButtonText}>MODIFIER</Text>
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Profile Header Zone */}
        <View style={[styles.profileHeaderZone, !user && styles.profileHeaderZoneGuest]}>
          {user ? (
            <ProfileHeader
              profileImage={user.profileImage}
              displayName={user.displayName}
              username={user.username}
              bio={user.bio}
              createdAt={user.createdAt}
              city={user.address?.city}
              styleTags={user.styleProfile?.styleTags}
              articlesCount={stats?.articlesEnVente ?? 0}
              salesCount={stats?.articlesVendus ?? 0}
              rating={stats?.moyenneNote ?? null}
              followersCount={user.sellerLikesCount ?? 0}
            />
          ) : (
            <GuestState onConnect={handleConnect} />
          )}
        </View>

        {/* Menu Section */}
        <ProfileMenu items={menuItems} onItemPress={handleMenuItemPress} />

        {/* Sign Out */}
        {user && (
          <Animated.View
            entering={FadeInDown.duration(300).delay(450)}
            style={styles.signOutSection}
          >
            <Pressable style={styles.signOutButton} onPress={handleSignOut}>
              <Text style={styles.signOutText}>SE DÉCONNECTER</Text>
            </Pressable>
          </Animated.View>
        )}

        {/* App Version */}
        <Animated.View
          entering={FadeIn.duration(300).delay(500)}
          style={styles.versionContainer}
        >
          <Text style={styles.versionText}>Version {Constants.expoConfig?.version ?? '1.0.0'}</Text>
        </Animated.View>

        <View style={styles.bottomPadding} />
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
    paddingBottom: spacing.xl,
  },
  editButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
  },
  editButtonText: {
    ...typography.labelUppercase,
    color: colors.charcoal,
    textTransform: 'uppercase',
  },
  profileHeaderZone: {
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.lg,
  },
  // Guest view: GuestState already has its own paddingVertical (lg), so the
  // cream zone's bottom padding + margin double the gap before the menu block.
  // Collapse them so the "se connecter" block sits flush against MON COMPTE.
  profileHeaderZoneGuest: {
    paddingBottom: 0,
    marginBottom: 0,
  },
  signOutSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  signOutButton: {
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    ...typography.labelUppercase,
    color: colors.danger,
    textTransform: 'uppercase',
  },
  versionContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  versionText: {
    ...typography.caption,
    color: colors.muted,
  },
  bottomPadding: {
    height: spacing['3xl'],
  },
});
