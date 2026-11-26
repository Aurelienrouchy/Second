import { serializeRouteParam } from '@/features/sell/utils/routeParams';
/**
 * Tab Layout — Seconde UI Kit
 *
 * Original tab structure with exact SVG icons from the HTML maquette.
 *   Accueil · Messages · Vendre (raised charcoal CTA) · Favoris · Profil
 */

import { Tabs, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
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
import DraftResumeModal from '@/features/sell/components/shared/DraftResumeModal';
import draftService, { ArticleDraft, hasDraftProgress } from '@/features/sell/services/draftService';
import { AuthService } from '@/services/authService';
import { track } from '@/lib/analytics';
import { colors, fonts, radius } from '@/constants/theme';
import { useAuthenticatedUid, useUser } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { AUTH_MESSAGES } from '@/constants/authMessages';
import { useChatStore, selectUnreadChatCount } from '@/store/chatStore';
import { assertSalePreparationAdmission, eligibilityReadUnavailable } from '@/services/newSaleAdmission';
import { useTradeAdmissionError } from '@/hooks/useTradeAdmissionError';
import { useTradeOperation, type TradeOperation } from '@/hooks/useTradeOperation';
import { staleTradeOperation } from '@/services/tradeOperation';
import type { ImmersiveOpening } from '@/store/immersiveOverlayStore';

const sellPlatform = Platform.OS === 'ios' ? 'ios' : 'android';

function draftStepLabel(step: number): '1' | '1b' | '2' | '3' | '4' {
  if (step >= 4) return '4';
  if (step >= 3) return '3';
  if (step >= 2) return '2';
  return '1';
}

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
  const uid = useAuthenticatedUid();
  const sellEntry = useTradeOperation('sell-tab-entry', uid);
  const showAdmissionError = useTradeAdmissionError();
  const router = useRouter();
  const { immerse } = useImmersiveOverlay();
  // Pre-computed in the store (chatStore.setChats), so this subscription
  // only re-renders when *this user's* unread total actually changes.
  const unreadMessageCount = useChatStore(
    selectUnreadChatCount(user?.id ?? null)
  );

  // ── iOS draft resume ──
  // On iOS the sell flow lives inside the immersive overlay, so the step-aware
  // resume logic that Android gets for free via app/(tabs)/sell.tsx is wired
  // here: detect an in-progress draft behind the entering shell and offer to
  // resume at the saved step before mounting the camera.
  const [resumeContext, setResumeContext] = useState<{
    draft: ArticleDraft;
    opening: ImmersiveOpening;
  } | null>(null);
  const activeResumeContext = useRef<typeof resumeContext>(null);
  const pendingDraftAction = useRef<{ opening: ImmersiveOpening; operation: TradeOperation } | null>(null);
  const [draftOwnerFrame, setDraftOwnerFrame] = useState(sellEntry.frame);
  if (draftOwnerFrame !== sellEntry.frame) { setDraftOwnerFrame(sellEntry.frame); setResumeContext(null); }

  // Fill the already entering shell only after admission and draft selection.
  const showCapture = useCallback((opening: ImmersiveOpening) => {
    opening.prepareContent((presentation) => (
        <SellOverlayCapture
          presentation={presentation}
          onClose={() => opening.dismiss()}
          onContinue={(photos) => {
            // Couple navigation to the real end of the dismiss animation
            // (onDismissed) instead of a magic timer — the push fires exactly
            // when the overlay has fully collapsed, never racing it.
            opening.dismiss({
              onDismissed: () => {
                router.push({
                  pathname: '/sell/photos-review',
                  params: { photos: serializeRouteParam(photos) },
                });
              },
            });
          }}
        />
    ));
  }, [router]);

  const reportEntryFailure = useCallback((
    error: unknown,
    operation: TradeOperation,
    opening: ImmersiveOpening | null,
    retry: () => void,
  ) => {
    const showError = () => {
      if (!sellEntry.isCurrent(operation)) return;
      if (!showAdmissionError(error, { isCurrent: () => sellEntry.isCurrent(operation), retry, publication: {uid: operation.session.uid} })) {
        Alert.alert('Vérification impossible', 'Impossible d’ouvrir la vente pour le moment. Votre brouillon est conservé.');
      }
    };
    if (opening) {
      if (opening.isCurrent()) opening.dismiss({ onDismissed: showError });
    } else showError();
  }, [sellEntry, showAdmissionError]);

  const enterSell = useCallback(async function enter(navigateAndroid: () => void) {
    if (!sellEntry.isOriginCurrent()) return;
    let operation: TradeOperation | undefined;
    let opening: ImmersiveOpening | null = null;
    try {
      operation = sellEntry.start() ?? undefined;
      if (!operation) return;
      if (Platform.OS === 'ios') {
        // The visual response starts before either network/draft read. This
        // shell conveys no admission and cannot mount the camera on its own.
        opening = immerse({
          isCurrent: sellEntry.isOriginCurrent,
          onDismiss: () => {
            if (operation) sellEntry.finish(operation);
            const pendingDraft = pendingDraftAction.current;
            if (pendingDraft?.opening === opening) {
              sellEntry.finish(pendingDraft.operation);
              pendingDraftAction.current = null;
            }
            const modal = activeResumeContext.current;
            if (modal?.opening === opening) {
              activeResumeContext.current = null;
              if (sellEntry.isOriginCurrent()) setResumeContext(current => current === modal ? null : current);
            }
          },
        });
        if (!opening) throw eligibilityReadUnavailable();
      }
      const assertCurrent = () => {
        sellEntry.assertCurrent(operation!);
        if (opening && !opening.isCurrent()) throw staleTradeOperation();
      };
      await assertSalePreparationAdmission(operation.session.uid, assertCurrent);
      assertCurrent();
      if (AuthService.hasPasswordProvider() && !AuthService.isEmailVerified()) {
        const showEmail = () => {
          if (sellEntry.isCurrent(operation!)) router.push('/settings/verify-email');
        };
        if (opening) opening.dismiss({ onDismissed: showEmail });
        else showEmail();
        return;
      }
      if (Platform.OS !== 'ios') { navigateAndroid(); return; }
      const existingDraft = await draftService.loadDraft();
      assertCurrent();
      const hasDraft = hasDraftProgress(existingDraft);
      track('sell_entry_tapped', { outcome: 'opened', platform: sellPlatform, has_existing_draft: hasDraft, source: 'tab' });
      if (hasDraft && existingDraft && opening) {
        const modal = { draft: existingDraft, opening };
        activeResumeContext.current = modal;
        setResumeContext(modal);
      } else if (opening) showCapture(opening);
    } catch (error) {
      if (!operation) {
        if (sellEntry.isOriginCurrent()) showAdmissionError(eligibilityReadUnavailable(), {
          isCurrent: () => sellEntry.isOriginCurrent(), retry: () => { void enter(navigateAndroid); },
        });
        return;
      }
      if (!sellEntry.isCurrent(operation)) { opening?.dismiss(); return; }
      reportEntryFailure(error, operation, opening, () => { void enter(navigateAndroid); });
    } finally { if (operation) sellEntry.finish(operation); }
  }, [sellEntry, immerse, router, showCapture, showAdmissionError, reportEntryFailure]);

  // Resume an in-progress draft at its saved step (mirrors Android sell.tsx).
  const handleResumeDraft = useCallback(async function resumeCurrentDraft() {
    const opening = resumeContext?.opening;
    if (!resumeContext || activeResumeContext.current !== resumeContext || !opening?.isCurrent()) return;
    let operation;
    try {
      operation = sellEntry.start('draft');
      if (!operation) return;
      pendingDraftAction.current = { opening, operation };
      const assertCurrent = () => {
        sellEntry.assertCurrent(operation!);
        if (activeResumeContext.current !== resumeContext || !opening.isCurrent()) throw staleTradeOperation();
      };
      await assertSalePreparationAdmission(operation.session.uid, assertCurrent);
      assertCurrent();
      const draft = resumeContext?.draft;
      activeResumeContext.current = null;
      setResumeContext(null);
      if (!draft) return;
      const step = draft.currentStep;
      if (__DEV__) console.log('[TabLayout] Resuming draft at step:', step);

      track('sell_draft_resumed', {
        draft_step: draftStepLabel(step),
        photo_count: draft.photos.length,
        has_ai_result: !!draft.aiResult,
        platform: 'ios',
      });

      if (step >= 2) {
        opening.dismiss({ onDismissed: () => {
          if (!sellEntry.isCurrent(operation!)) return;
          if (step >= 4) {
            router.push({ pathname: '/sell/preview', params: { resumeDraft: 'true' } });
          } else if (step >= 3) {
            router.push({ pathname: '/sell/pricing', params: { resumeDraft: 'true' } });
          } else {
            router.push({
              pathname: '/sell/details',
              params: {
                resumeDraft: 'true',
                photos: serializeRouteParam(draft.photos),
                ...(draft.aiResult ? { aiResult: serializeRouteParam(draft.aiResult) } : {}),
              },
            });
          }
        } });
      } else {
        // Step 1: fill this same shell to continue with the saved photos.
        showCapture(opening);
      }
    } catch (error) {
      if (operation && sellEntry.isCurrent(operation)) reportEntryFailure(error, operation, opening, () => { void enterSell(() => undefined); });
    }
    finally {
      if (pendingDraftAction.current?.operation === operation) pendingDraftAction.current = null;
      if (operation) sellEntry.finish(operation);
    }
  }, [resumeContext, router, showCapture, sellEntry, reportEntryFailure, enterSell]);

  const handleDiscardDraft = useCallback(async () => {
    const opening = resumeContext?.opening;
    if (!resumeContext || activeResumeContext.current !== resumeContext || !opening?.isCurrent()) return;
    let operation;
    try {
      operation = sellEntry.start('draft');
      if (!operation) return;
      pendingDraftAction.current = { opening, operation };
      const assertCurrent = () => {
        sellEntry.assertCurrent(operation!);
        if (!opening.isCurrent()) throw staleTradeOperation();
      };
      await assertSalePreparationAdmission(operation.session.uid, assertCurrent);
      assertCurrent();
      if (resumeContext) {
        track('sell_draft_discarded', {
          draft_step: draftStepLabel(resumeContext.draft.currentStep),
          photo_count: resumeContext.draft.photos.length,
          platform: 'ios',
        });
      }
      activeResumeContext.current = null;
      setResumeContext(null);
      await draftService.deleteDraft();
      assertCurrent();
      showCapture(opening);
    } catch (error) {
      if (operation && sellEntry.isCurrent(operation)) reportEntryFailure(error, operation, opening, () => { void enterSell(() => undefined); });
    }
    finally {
      if (pendingDraftAction.current?.operation === operation) pendingDraftAction.current = null;
      if (operation) sellEntry.finish(operation);
    }
  }, [resumeContext, showCapture, sellEntry, reportEntryFailure, enterSell]);

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
          tabBarButtonTestID: 'Vendre',
          tabBarIcon: () => <SellTabIcon />,
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            if (!useAuthStore.getState().authenticatedUid) {
              useAuthSheetStore.getState().show(AUTH_MESSAGES.sell, () => router.push('/(tabs)/sell'));
              return;
            }
            void enterSell(() => navigation.navigate('sell'));
          },
        })}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: 'Favoris',
          tabBarAccessibilityLabel: 'Favoris',
          tabBarButtonTestID: 'Favoris',
          tabBarIcon: ({ color }) => <HeartIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarAccessibilityLabel: 'Profil',
          tabBarButtonTestID: 'Profil',
          // Notifications badge is shown on the bell icon in the header,
          // not on the profile tab (avoids confusion with profile-specific alerts).
          tabBarIcon: ({ color }) => <UserIcon color={color} />,
        }}
      />
    </Tabs>
    {Platform.OS === 'ios' && (
      <DraftResumeModal
        visible={resumeContext !== null}
        draft={resumeContext?.draft ?? null}
        onResume={handleResumeDraft}
        onDiscard={handleDiscardDraft}
        onDismiss={() => {
          const opening = resumeContext?.opening;
          if (!resumeContext || activeResumeContext.current !== resumeContext || !opening?.isCurrent()) return;
          activeResumeContext.current = null;
          setResumeContext(null);
          opening?.dismiss();
        }}
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
