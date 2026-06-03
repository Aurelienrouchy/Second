/**
 * Tab Layout — Seconde UI Kit
 *
 * Original tab structure with exact SVG icons from the HTML maquette.
 *   Accueil · Messages · Vendre (raised charcoal CTA) · Favoris · Profil
 */

import { Tabs, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

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
import DraftResumeModal from '@/components/DraftResumeModal';
import draftService, { ArticleDraft } from '@/services/draftService';
import { AuthService } from '@/services/authService';
import { colors, fonts, radius } from '@/constants/theme';
import { useUser } from '@/contexts/AuthContext';
import { useAuthStore } from '@/store/authStore';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { AUTH_MESSAGES, COPY_SELL_GATE } from '@/constants/authMessages';
import { useChatStore, selectUnreadChatCount } from '@/store/chatStore';
import { canSell } from '@/utils/age';

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

  // ── iOS draft resume ──
  // On iOS the sell flow lives inside the immersive overlay, so the step-aware
  // resume logic that Android gets for free via app/(tabs)/sell.tsx is wired
  // here: detect an in-progress draft before opening the overlay and offer to
  // resume at the saved step instead of restarting the camera.
  const [resumeDraft, setResumeDraft] = useState<ArticleDraft | null>(null);

  // Open the camera capture overlay (fresh capture, no draft progression).
  const openCaptureOverlay = useCallback(() => {
    immerse({
      component: (
        <SellOverlayCapture
          onClose={() => dismiss()}
          onContinue={(photos) => {
            // Couple navigation to the real end of the dismiss animation
            // (onDismissed) instead of a magic timer — the push fires exactly
            // when the overlay has fully collapsed, never racing it.
            dismiss({
              onDismissed: () => {
                router.push({
                  pathname: '/sell/photos-review',
                  params: { photos: JSON.stringify(photos) },
                });
              },
            });
          }}
        />
      ),
    });
  }, [immerse, dismiss, router]);

  // Resume an in-progress draft at its saved step (mirrors Android sell.tsx).
  const handleResumeDraft = useCallback(() => {
    const draft = resumeDraft;
    setResumeDraft(null);
    if (!draft) return;
    const step = draft.currentStep;
    if (__DEV__) console.log('[TabLayout] Resuming draft at step:', step);

    if (step >= 4) {
      router.push({ pathname: '/sell/preview', params: { resumeDraft: 'true' } });
    } else if (step >= 3) {
      router.push({ pathname: '/sell/pricing', params: { resumeDraft: 'true' } });
    } else if (step >= 2) {
      router.push({
        pathname: '/sell/details',
        params: {
          resumeDraft: 'true',
          photos: JSON.stringify(draft.photos),
          ...(draft.aiResult ? { aiResult: JSON.stringify(draft.aiResult) } : {}),
        },
      });
    } else {
      // Step 1: only photos captured — re-open the capture overlay to continue.
      openCaptureOverlay();
    }
  }, [resumeDraft, router, openCaptureOverlay]);

  const handleDiscardDraft = useCallback(async () => {
    setResumeDraft(null);
    await draftService.deleteDraft();
    openCaptureOverlay();
  }, [openCaptureOverlay]);

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
          tabBarButtonTestID: 'Accueil',
          tabBarIcon: ({ color }) => <HomeIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarAccessibilityLabel: 'Messages',
          tabBarButtonTestID: 'Messages',
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
            const currentUser = useAuthStore.getState().user;
            if (!currentUser) {
              e.preventDefault();
              useAuthSheetStore.getState().show(
                AUTH_MESSAGES.sell,
                () => navigation.navigate('sell')
              );
            } else if (!canSell(currentUser.dateOfBirth)) {
              // 16-17 ans : achat/navigation OK, mais vente bloquée (18+ Stripe).
              e.preventDefault();
              Alert.alert('Vente non disponible', COPY_SELL_GATE);
            } else if (AuthService.hasPasswordProvider() && !AuthService.isEmailVerified()) {
              // Gate email_verified appliqué côté serveur dans createArticle :
              // pré-check ici pour éviter de remplir tout le formulaire de vente
              // (capture, IA, upload images) avant un refus en fin de flow. Ne
              // concerne que les comptes email — Google/Apple sont toujours
              // email_verified. Redirige vers l'écran de vérification.
              e.preventDefault();
              router.push('/settings/verify-email');
            } else if (Platform.OS === 'ios') {
              e.preventDefault();
              // Detect an in-progress draft first. If one exists, surface the
              // resume modal (step-aware) instead of restarting the camera;
              // otherwise open the capture overlay directly.
              (async () => {
                try {
                  const existingDraft = await draftService.loadDraft();
                  if (existingDraft && existingDraft.photos.length > 0) {
                    setResumeDraft(existingDraft);
                    return;
                  }
                } catch (err) {
                  if (__DEV__) console.error('[TabLayout] Draft check failed:', err);
                }
                openCaptureOverlay();
              })();
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
    {Platform.OS === 'ios' && (
      <DraftResumeModal
        visible={resumeDraft !== null}
        draft={resumeDraft}
        onResume={handleResumeDraft}
        onDiscard={handleDiscardDraft}
      />
    )}
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
