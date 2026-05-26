/**
 * Tab Layout — Seconde UI Kit
 *
 * Original tab structure with exact SVG icons from the HTML maquette.
 *   Accueil · Messages · Vendre (raised charcoal CTA) · Favoris · Profil
 */

import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { HapticTab } from '@/components/HapticTab';
import TabBarBackground from '@/components/ui/TabBarBackground';
import {
  HomeIcon,
  PlusIcon,
  HeartIcon,
  MessageIcon,
  UserIcon,
} from '@/components/ui/TabBarIcons';
import { ImmersiveOverlay, useImmersiveOverlay } from '@/components/ui/ImmersiveOverlay';
import { SellOverlayCapture } from '@/features/sell';
import { colors, fonts, radius } from '@/constants/theme';
import { useUser } from '@/contexts/AuthContext';
import { useAuthStore } from '@/store/authStore';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useChatStore, selectUnreadChatCount } from '@/store/chatStore';

// ── Badge component for tab icons ──
function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : `${count}`;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

// ── Icon wrapper with optional badge ──
function IconWithBadge({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <View style={styles.iconBadgeWrapper}>
      {children}
      <TabBadge count={count} />
    </View>
  );
}

// ── Raised "Vendre" icon — charcoal 44×44, borderRadius 12, elevated ──
function SellTabIcon() {
  return (
    <View style={styles.sellIconWrapper}>
      <PlusIcon color={colors.white} size={20} />
    </View>
  );
}

export default function TabLayout() {
  const user = useUser();
  const router = useRouter();
  const { immerse, dismiss } = useImmersiveOverlay();
  // Pre-computed in the store (chatStore.setChats), so this subscription
  // only re-renders when *this user's* unread total actually changes.
  const unreadMessageCount = useChatStore(
    selectUnreadChatCount(user?.id ?? null)
  );
  return (
    <ImmersiveOverlay>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: Platform.select({
          ios: {
            position: 'absolute',
            backgroundColor: 'rgba(245, 240, 232, 0.95)',
            borderTopColor: colors.border,
            borderTopWidth: 1,
          },
          default: {
            backgroundColor: colors.surfaceWarm,
            borderTopColor: colors.border,
            borderTopWidth: 1,
          },
        }),
        tabBarLabelStyle: {
          fontFamily: 'Satoshi-Medium',
          fontSize: 10,
          letterSpacing: 0.5,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarAccessibilityLabel: 'Accueil',
          tabBarIcon: ({ color }) => <HomeIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarAccessibilityLabel: 'Messages',
          tabBarIcon: ({ color }) => (
            <IconWithBadge count={unreadMessageCount}>
              <MessageIcon color={color} />
            </IconWithBadge>
          ),
        }}
      />
      <Tabs.Screen
        name="sell"
        options={{
          title: 'Vendre',
          tabBarAccessibilityLabel: 'Vendre',
          tabBarIcon: () => <SellTabIcon />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            if (!useAuthStore.getState().user) {
              e.preventDefault();
              useAuthSheetStore.getState().show(
                AUTH_MESSAGES.sell,
                () => navigation.navigate('sell')
              );
            } else if (Platform.OS === 'ios') {
              e.preventDefault();
              immerse({
                component: (
                  <SellOverlayCapture
                    onClose={() => dismiss()}
                    onContinue={(photos) => {
                      dismiss();
                      setTimeout(() => {
                        router.push({
                          pathname: '/sell/photos-review',
                          params: { photos: JSON.stringify(photos) },
                        });
                      }, 550);
                    }}
                  />
                ),
              });
            }
            // Android: default tab navigation (sell.tsx → /sell/capture)
          },
        })}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'Favoris',
          tabBarAccessibilityLabel: 'Favoris',
          tabBarIcon: ({ color }) => <HeartIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarAccessibilityLabel: 'Profil',
          // Notifications badge is shown on the bell icon in the header,
          // not on the profile tab (avoids confusion with profile-specific alerts).
          tabBarIcon: ({ color }) => <UserIcon color={color} />,
        }}
      />
    </Tabs>
    </ImmersiveOverlay>
  );
}

const styles = StyleSheet.create({
  iconBadgeWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: colors.surfaceWarm,
  },
  badgeText: {
    fontFamily: fonts.sansBold,
    fontSize: 9,
    color: colors.white,
    lineHeight: 12,
  },
  sellIconWrapper: {
    width: 44,
    height: 44,
    backgroundColor: colors.charcoal,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
});
