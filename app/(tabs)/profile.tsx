/**
 * Profile Screen
 * Design System: Luxe Français + Street
 *
 * Features:
 * - Elegant profile header with Avatar component
 * - Animated stats with Bleu Klein accent
 * - Smooth press animations with haptic feedback
 * - Clean menu sections
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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

// Design System
import { colors, spacing, typography, radius, shadows, animations } from '@/constants/theme';
import { Avatar, Button, H1, H2, Body, Caption } from '@/components/ui';

// Hooks & Contexts
import { useAuth } from '@/contexts/AuthContext';
import { useAuthRequired } from '@/hooks/useAuthRequired';
import { AUTH_MESSAGES } from '@/constants/authMessages';

// =============================================================================
// TYPES
// =============================================================================

interface MenuItem {
  id: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
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

const StatItem: React.FC<StatItemProps> = ({ value, label, delay = 0 }) => (
  <Animated.View
    entering={FadeInDown.duration(400).delay(delay)}
    style={styles.statItem}
  >
    <Animated.Text style={styles.statNumber}>{value}</Animated.Text>
    <Caption style={styles.statLabel}>{label}</Caption>
  </Animated.View>
);

// =============================================================================
// MENU ITEM COMPONENT
// =============================================================================

interface MenuItemComponentProps {
  item: MenuItem;
  onPress: () => void;
  index: number;
}

const MenuItemComponent: React.FC<MenuItemComponentProps> = ({ item, onPress, index }) => {
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
    <Animated.View entering={FadeInDown.duration(300).delay(100 + index * 50)}>
      <AnimatedPressable
        style={[styles.menuItem, animatedStyle]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        testID={`menu-item-${item.id}`}
      >
        <View style={styles.menuItemLeft}>
          <View style={styles.menuIconContainer}>
            <Ionicons name={item.icon} size={20} color={colors.primary} />
          </View>
          <Body style={styles.menuTitle}>{item.title}</Body>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </AnimatedPressable>
    </Animated.View>
  );
};

// =============================================================================
// GUEST STATE COMPONENT
// =============================================================================

const GuestState: React.FC<{ onConnect: () => void }> = ({ onConnect }) => (
  <Animated.View
    entering={FadeInDown.duration(400).delay(100)}
    style={styles.guestState}
  >
    <View style={styles.guestAvatarContainer}>
      <Avatar size="xxl" name="" />
    </View>
    <H2 style={styles.guestTitle}>Pas encore connecté</H2>
    <Body color="muted" center style={styles.guestSubtitle}>
      Connectez-vous pour accéder à toutes les fonctionnalités
    </Body>
    <Button
      variant="primary"
      onPress={onConnect}
      style={styles.connectButton}
    >
      Se connecter
    </Button>
  </Animated.View>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ProfileScreen() {
  const { user, signOut, checkAuthRequired } = useAuth();
  const { requireAuth, showAuthSheet } = useAuthRequired();
  const router = useRouter();

  // Settings state
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);

  // Handlers
  const handleSignOut = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }, [signOut]);

  const handleAction = useCallback((action: () => void, message?: string) => {
    if (checkAuthRequired()) {
      requireAuth(action, message);
    } else {
      action();
    }
  }, [checkAuthRequired, requireAuth]);

  const handleConnect = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showAuthSheet(AUTH_MESSAGES.default);
  }, [showAuthSheet]);

  const handleNotificationsToggle = useCallback((value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNotificationsEnabled(value);
  }, []);

  const handleDarkModeToggle = useCallback((value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDarkModeEnabled(value);
  }, []);

  // Menu items with Ionicons
  const menuItems: MenuItem[] = [
    { id: 'orders', title: 'Mes commandes', icon: 'cube-outline', action: () => console.log('Orders') },
    { id: 'selling', title: 'Mes ventes', icon: 'wallet-outline', action: () => router.push('/my-articles') },
    { id: 'favorites', title: 'Mes favoris', icon: 'heart-outline', action: () => router.push('/(tabs)/favorites') },
    { id: 'wallet', title: 'Mon portefeuille', icon: 'card-outline', action: () => console.log('Wallet') },
    { id: 'settings', title: 'Paramètres', icon: 'settings-outline', action: () => router.push('/settings') },
    { id: 'help', title: 'Aide', icon: 'help-circle-outline', action: () => console.log('Help') },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <Animated.View
          entering={FadeIn.duration(300)}
          style={styles.header}
        >
          <H1>Profil</H1>
        </Animated.View>

        {/* Profile Header */}
        <View style={styles.profileHeader}>
          {user ? (
            <>
              <Animated.View entering={FadeInDown.duration(400)}>
                <Avatar
                  source={user.profileImage}
                  name={user.displayName || 'U'}
                  size="xxl"
                  showOnline
                  isOnline
                />
              </Animated.View>
              <Animated.Text
                entering={FadeInDown.duration(400).delay(50)}
                style={styles.userName}
              >
                {user.displayName || 'Utilisateur'}
              </Animated.Text>
              <Animated.View entering={FadeInDown.duration(400).delay(100)}>
                <Caption>{user.email}</Caption>
              </Animated.View>

              {/* Stats */}
              <View style={styles.statsContainer}>
                <StatItem value="0" label="Abonnés" delay={150} />
                <View style={styles.statDivider} />
                <StatItem value="0" label="Abonnements" delay={200} />
                <View style={styles.statDivider} />
                <StatItem value="4.8" label="Étoiles" delay={250} />
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
            <Caption style={styles.sectionTitle}>MON COMPTE</Caption>
          </Animated.View>
          {menuItems.map((item, index) => (
            <MenuItemComponent
              key={item.id}
              item={item}
              index={index}
              onPress={() =>
                handleAction(
                  item.action,
                  `Vous devez être connecté pour accéder à ${item.title.toLowerCase()}.`
                )
              }
            />
          ))}
        </View>

        {/* Settings Section */}
        <View style={styles.settingsSection}>
          <Animated.View
            entering={FadeIn.duration(300).delay(300)}
            style={styles.sectionTitleContainer}
          >
            <Caption style={styles.sectionTitle}>PRÉFÉRENCES</Caption>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.duration(300).delay(350)}
            style={styles.settingItem}
          >
            <View style={styles.settingLeft}>
              <View style={styles.settingIconContainer}>
                <Ionicons name="notifications-outline" size={20} color={colors.primary} />
              </View>
              <Body>Notifications</Body>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={handleNotificationsToggle}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
              thumbColor={notificationsEnabled ? colors.primary : colors.muted}
            />
          </Animated.View>

          <Animated.View
            entering={FadeInDown.duration(300).delay(400)}
            style={styles.settingItem}
          >
            <View style={styles.settingLeft}>
              <View style={styles.settingIconContainer}>
                <Ionicons name="moon-outline" size={20} color={colors.primary} />
              </View>
              <Body>Mode sombre</Body>
            </View>
            <Switch
              value={darkModeEnabled}
              onValueChange={handleDarkModeToggle}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
              thumbColor={darkModeEnabled ? colors.primary : colors.muted}
            />
          </Animated.View>
        </View>

        {/* Sign Out */}
        {user && (
          <Animated.View
            entering={FadeInDown.duration(300).delay(450)}
            style={styles.signOutSection}
          >
            <Button
              variant="danger"
              onPress={handleSignOut}
              style={styles.signOutButton}
            >
              <View style={styles.signOutContent}>
                <Ionicons name="log-out-outline" size={20} color={colors.danger} />
                <Body style={styles.signOutText}>Se déconnecter</Body>
              </View>
            </Button>
          </Animated.View>
        )}

        {/* App Version */}
        <Animated.View
          entering={FadeIn.duration(300).delay(500)}
          style={styles.versionContainer}
        >
          <Caption style={styles.versionText}>Version 1.0.0</Caption>
        </Animated.View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </SafeAreaView>
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

  // Header
  header: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },

  // Profile Header
  profileHeader: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  userName: {
    fontFamily: typography.h2.fontFamily,
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },

  // Stats
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  statItem: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  statNumber: {
    fontFamily: typography.h2.fontFamily,
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary, // Bleu Klein!
  },
  statLabel: {
    marginTop: spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },

  // Guest State
  guestState: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  guestAvatarContainer: {
    marginBottom: spacing.md,
  },
  guestTitle: {
    marginBottom: spacing.sm,
  },
  guestSubtitle: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  connectButton: {
    minWidth: 200,
  },

  // Section Title
  sectionTitleContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    letterSpacing: 1,
    color: colors.muted,
  },

  // Menu Section
  menuSection: {
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  menuTitle: {
    fontWeight: '500',
  },

  // Settings Section
  settingsSection: {
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingIconContainer: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },

  // Sign Out
  signOutSection: {
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  signOutButton: {
    borderColor: colors.danger,
  },
  signOutContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutText: {
    color: colors.danger,
    marginLeft: spacing.sm,
    fontWeight: '600',
  },

  // Version
  versionContainer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  versionText: {
    color: colors.muted,
  },

  // Bottom Padding
  bottomPadding: {
    height: 100,
  },
});
