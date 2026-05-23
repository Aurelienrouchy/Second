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

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui';
import { colors, fonts, radius, spacing, animations } from '@/constants/theme';
import { ScreenHeader } from '@/components/ui';
import { useAuthActions } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { formatDisplayName } from '@/utils/formatName';

// =============================================================================
// TYPES
// =============================================================================

interface MenuItem {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  action: () => void;
}

interface StatItemProps {
  value: string | number;
  label: string;
  delay?: number;
}

// =============================================================================
// ANIMATED PRESSABLE
// =============================================================================

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// =============================================================================
// STAT ITEM COMPONENT
// =============================================================================

const StatItem = React.memo(function StatItem({ value, label, delay = 0 }: StatItemProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(delay)}
      style={styles.statItem}
    >
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Animated.View>
  );
});

// =============================================================================
// MENU ITEM COMPONENT
// =============================================================================

interface MenuItemComponentProps {
  item: MenuItem;
  onPress: () => void;
  index: number;
}

const MenuItemComponent = React.memo(function MenuItemComponent({
  item,
  onPress,
  index,
}: MenuItemComponentProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.98, animations.spring.snappy);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1, animations.spring.bouncy);
  }, [scale]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  }, [onPress]);

  return (
    <AnimatedPressable
      entering={FadeInDown.duration(300).delay(100 + index * 50)}
      style={[styles.menuItem, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      testID={`menu-item-${item.id}`}
    >
      <View style={styles.menuItemLeft}>
        <View style={[styles.menuIconContainer, { backgroundColor: item.iconBg }]}>
          <Ionicons name={item.icon} size={16} color={item.iconColor} />
        </View>
        <Text style={styles.menuTitle}>{item.title}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </AnimatedPressable>
  );
});

// =============================================================================
// GUEST STATE COMPONENT
// =============================================================================

const GuestState = React.memo(function GuestState({
  onConnect,
}: {
  onConnect: () => void;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(100)}
      style={styles.guestState}
    >
      <View style={styles.guestAvatarContainer}>
        <Avatar size="xxl" name="" />
      </View>
      <Text style={styles.guestTitle}>Pas encore connecté</Text>
      <Text style={styles.guestSubtitle}>
        Connectez-vous pour accéder à toutes les fonctionnalités
      </Text>
      <Pressable style={styles.connectButton} onPress={onConnect}>
        <Text style={styles.connectButtonText}>SE CONNECTER</Text>
      </Pressable>
    </Animated.View>
  );
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ProfileScreen() {
  const { signOut } = useAuthActions();
  const { user, requireAuth, showAuthSheet } = useAuthRequired();
  const router = useRouter();

  // Handlers
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

  const handleAction = useCallback(
    (action: () => void, message?: string) => {
      requireAuth(action, message);
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

  // Format member since
  const memberSince = useMemo(() => {
    if (!user?.createdAt) return '';
    const date =
      user.createdAt instanceof Date ? user.createdAt : new Date(user.createdAt);
    return `Membre depuis ${date.toLocaleDateString('fr-FR', {
      month: 'short',
      year: 'numeric',
    })}`;
  }, [user?.createdAt]);

  // Menu items with DA-specific icon colors
  const menuItems: MenuItem[] = useMemo(
    () => [
      {
        id: 'orders',
        title: 'Mes commandes',
        icon: 'cube-outline',
        iconColor: colors.rust,
        iconBg: 'rgba(196, 96, 58, 0.08)',
        action: () => router.push('/my-orders'),
      },
      {
        id: 'selling',
        title: 'Mes ventes',
        icon: 'wallet-outline',
        iconColor: colors.sage,
        iconBg: colors.sageLight,
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
        id: 'settings',
        title: 'Paramètres',
        icon: 'settings-outline',
        iconColor: colors.charcoal,
        iconBg: 'rgba(26, 24, 20, 0.04)',
        action: () => router.push('/settings'),
      },
      {
        id: 'help',
        title: 'Aide',
        icon: 'help-circle-outline',
        iconColor: colors.charcoal,
        iconBg: 'rgba(26, 24, 20, 0.04)',
        action: () => router.push('/settings/help' as any),
      },
    ],
    [router],
  );

  return (
    <View style={styles.container}>
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
        <View style={styles.profileHeaderZone}>
          {user ? (
            <>
              {/* Avatar + Info */}
              <Animated.View
                entering={FadeInDown.duration(400)}
                style={styles.avatarSection}
              >
                <Avatar
                  source={user.profileImage}
                  name={user.displayName || 'U'}
                  size="xxl"
                  showOnline
                  isOnline
                />
                <View style={styles.nameSection}>
                  <Text style={styles.userName}>
                    {formatDisplayName(user.displayName)}
                  </Text>
                  {user.displayName && (
                    <Text style={styles.userHandle}>
                      @{user.displayName.toLowerCase().replace(/\s+/g, '.')}
                    </Text>
                  )}
                  <Text style={styles.memberSince}>{memberSince}</Text>
                </View>
              </Animated.View>

              {/* Bio */}
              {user.bio && (
                <Animated.View entering={FadeInDown.duration(400).delay(50)}>
                  <Text style={styles.bio}>{user.bio}</Text>
                </Animated.View>
              )}

              {/* Stats */}
              <View style={styles.statsRow}>
                <StatItem
                  value={user.articlesCount ?? 0}
                  label="Articles"
                  delay={150}
                />
                <View style={styles.statDivider} />
                <StatItem value={0} label="Ventes" delay={200} />
                <View style={styles.statDivider} />
                <StatItem
                  value={user.rating ? user.rating.toFixed(1) : '-'}
                  label="Note"
                  delay={250}
                />
                <View style={styles.statDivider} />
                <StatItem
                  value={user.sellerLikesCount ?? 0}
                  label="Abonnés"
                  delay={300}
                />
              </View>
            </>
          ) : (
            <GuestState onConnect={handleConnect} />
          )}
        </View>

        {/* Menu Section */}
        <View style={styles.menuSection}>
          <Animated.View
            entering={FadeIn.duration(300).delay(200)}
            style={styles.sectionTitleContainer}
          >
            <Text style={styles.sectionTitle}>MON COMPTE</Text>
          </Animated.View>
          {menuItems.map((item, index) => (
            <MenuItemComponent
              key={item.id}
              item={item}
              index={index}
              onPress={() =>
                handleAction(
                  item.action,
                  `Vous devez être connecté pour accéder à ${item.title.toLowerCase()}.`,
                )
              }
            />
          ))}
        </View>

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
          <Text style={styles.versionText}>Version 1.0.0</Text>
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
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.8,
    color: colors.charcoal,
    textTransform: 'uppercase',
  },

  // Profile Header Zone
  profileHeaderZone: {
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    marginBottom: spacing.md,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  nameSection: {
    flex: 1,
  },
  userName: {
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    lineHeight: 28,
    color: colors.charcoal,
  },
  userHandle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 2,
  },
  memberSince: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    marginTop: spacing.xs,
  },

  // Bio
  bio: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 20,
    color: colors.charcoal,
    marginBottom: spacing.md,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.charcoal,
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
    color: colors.muted,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },

  // Guest State
  guestState: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  guestAvatarContainer: {
    marginBottom: spacing.md,
  },
  guestTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    lineHeight: 26,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  guestSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  connectButton: {
    backgroundColor: colors.charcoal,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.sm,
    minWidth: 200,
    alignItems: 'center',
  },
  connectButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },

  // Section Title
  sectionTitleContainer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.8,
    color: colors.muted,
    textTransform: 'uppercase',
  },

  // Menu Section
  menuSection: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  menuIconContainer: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuTitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.charcoal,
  },

  // Sign Out
  signOutSection: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  signOutButton: {
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.2,
    color: colors.danger,
    textTransform: 'uppercase',
  },

  // Version
  versionContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  versionText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    lineHeight: 14,
    color: colors.muted,
    letterSpacing: 0.5,
  },

  // Bottom Padding
  bottomPadding: {
    height: 100,
  },
});
