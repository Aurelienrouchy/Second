/**
 * Global auth bottom sheet.
 *
 * Driven entirely by `authSheetStore` — call
 * `useAuthSheetStore.getState().show(message, onSuccess)` from anywhere
 * in the app to open it. Render exactly ONCE in the root layout.
 *
 * Scope: sign-in / sign-up (credentials only) / forgot-password. The mandatory
 * post-signup step (DOB + consents + @pseudo) lives in the full-screen route
 * app/complete-profile.tsx — moved out of the sheet to kill the recurring
 * gorhom black-veil on Android. BOTH flows (email signup AND social sign-in
 * needing consent) close the sheet and navigate to that route; the user is
 * already authenticated at Firebase level by then. The route fires the threaded
 * `onSuccess` once consent completes.
 *
 * Mode-specific UI lives in components/auth-bottom-sheet/. This wrapper owns
 * the BottomSheet, the form state, and the network calls; the sub-components
 * are presentational only.
 */

import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Platform, Pressable, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';

import { track } from '@/lib/analytics';
import { useAuthActions } from '@/hooks/useAuth';
import { AuthService } from '@/services/authService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { getAuthSessionGeneration, useAuthStore } from '@/store/authStore';
import { auth } from '@/config/firebaseConfig';

import { AuthToggle } from './AuthToggle';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { SignInForm } from './SignInForm';
import { SignUpForm } from './SignUpForm';
import { SocialAuthButtons } from './SocialAuthButtons';
import { styles } from './styles';

// Fields entrance: slide up from slightly below + fade in (withTiming + ease-out
// only — no spring). FadeInDown starts the element below its final spot and
// glides it UP into place while fading, which reads as « les champs remontent ».
const FIELDS_DURATION = 240;
const TITLE_DURATION = 200;

type AuthMode = 'signIn' | 'signUp' | 'forgotPassword';
type AuthRequest = {version: number};

// Maps the internal camelCase mode to the analytics enum (snake_case).
const ANALYTICS_MODE = {
  signIn: 'signin',
  signUp: 'signup',
  forgotPassword: 'forgot_password',
} as const;

const AuthBottomSheet: React.FC = () => {
  const [authType, setAuthType] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [resetResultSource, setResetResultSource] = useState<string | null>(null);
  const resetRequestEpoch = useRef(0);
  const activeAuthRequest = useRef<AuthRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => {mounted.current = true; return () => {mounted.current = false;};}, []);
  const startAuthRequest = (): AuthRequest | null => {
    const sheet = useAuthSheetStore.getState();
    if (!sheet.isVisible || activeAuthRequest.current) return null;
    const request = {version: sheet.version};
    activeAuthRequest.current = request;
    setIsLoading(true);
    return request;
  };
  const isAuthRequestCurrent = (request: AuthRequest) => mounted.current && activeAuthRequest.current === request &&
    useAuthSheetStore.getState().isVisible && useAuthSheetStore.getState().version === request.version;
  const finishAuthRequest = (request: AuthRequest) => {
    if (activeAuthRequest.current !== request) return;
    activeAuthRequest.current = null;
    if (mounted.current) setIsLoading(false);
  };
  const resetSession = useAuthStore(useShallow(state => ({uid: state.authenticatedUid, identity: state.identityUser,
    guestId: state.guestSession?.guestId ?? null, loading: state.isLoading})));
  // Device-level Sign in with Apple availability, for the social auth_submitted.
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let mounted = true;
    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (mounted) setAppleAvailable(available);
      })
      .catch(() => {
        if (mounted) setAppleAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithApple,
    beginPendingConsent,
  } = useAuthActions();
  const insets = useSafeAreaInsets();

  // Two snap points so the keyboard-open state has somewhere taller to go. The
  // base snap is 82%; the second (98%) is the keyboard-open target. With
  // keyboardBehavior="extend" the sheet animates to the HIGHEST snap point when
  // the keyboard appears, and the BottomSheetScrollView gets the keyboard height
  // appended as bottom inset so the focused field scrolls clear of the keyboard.
  const snapPoints = useMemo(() => ['82%', '98%'], []);
  const bottomSheetRef = useRef<BottomSheet>(null);
  // Set right before a programmatic close that follows a successful auth /
  // consent route, so handleClose skips the "dismissed without auth" event.
  const didAuthRef = useRef(false);

  const isVisible = useAuthSheetStore((s) => s.isVisible);
  const displayMessage = useAuthSheetStore((s) => s.message);
  const onSuccessCallback = useAuthSheetStore((s) => s.onSuccess);
  const sheetVersion = useAuthSheetStore((s) => s.version);
  const resetSourceKey = JSON.stringify([resetSession.uid, auth.currentUser?.uid ?? null, getAuthSessionGeneration(), sheetVersion, resetSession.guestId, resetSession.loading]);
  const [resetUiSource, setResetUiSource] = useState(resetSourceKey);
  if (resetUiSource !== resetSourceKey) {
    setResetUiSource(resetSourceKey);
    setResetEmailSent(false); setResetResultSource(null);
    if (authType === 'forgotPassword') setEmail('');
  }
  useEffect(() => {
    const requestEpochRef = resetRequestEpoch;
    let activity = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      if (activity === next) return;
      activity = next; resetRequestEpoch.current++;
      setResetEmailSent(false); setResetResultSource(null);
      if (authType === 'forgotPassword') setIsLoading(activeAuthRequest.current !== null);
    });
    return () => {subscription.remove(); requestEpochRef.current++;};
  }, [authType]);

  useEffect(() => {
    if (isVisible) {
      // Open at the base snap (index 0 = 82%). The taller second snap (98%) is
      // reserved for the keyboard-open state so the focused input can scroll
      // above the keyboard; opening with expand() would rest at 98% instead.
      bottomSheetRef.current?.snapToIndex(0);
    } else {
      bottomSheetRef.current?.close();
    }
  }, [isVisible, sheetVersion]);

  const resetForm = useCallback(() => {
    resetRequestEpoch.current++;
    setEmail('');
    setPassword('');
    setDisplayName('');
    setAuthType('signIn');
    setIsLoading(activeAuthRequest.current !== null);
    setResetEmailSent(false);
    setResetResultSource(null);
  }, []);

  const handleClose = useCallback(() => {
    if (didAuthRef.current) {
      didAuthRef.current = false;
    } else {
      track('auth_sheet_dismissed', {
        auth_mode: ANALYTICS_MODE[authType],
        had_pending_action: onSuccessCallback != null,
        email_field_filled: email.trim().length > 0,
      });
    }
    resetForm();
    useAuthSheetStore.getState().hide();
  }, [resetForm, authType, onSuccessCallback, email]);

  // Android hardware back: while the sheet is visible, route through the same
  // close path (so the store hide fires) and consume the event so it never
  // falls through to the underlying navigator.
  useEffect(() => {
    if (!isVisible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleClose();
      return true;
    });
    return () => subscription.remove();
  }, [isVisible, handleClose]);

  // Sign-in of an ALREADY-consented user: fire onSuccess immediately and close.
  const handleSuccess = useCallback(() => {
    didAuthRef.current = true;
    handleClose();
    onSuccessCallback?.();
  }, [onSuccessCallback, handleClose]);

  // Account needs the mandatory consent route (email signup OR social
  // needsConsent): thread the sheet's onSuccess to the store so it fires AFTER
  // the route completes, close the sheet (without firing onSuccess), then
  // navigate. The startup guard would also catch this once pendingConsent flips,
  // but navigating here makes the transition immediate.
  const routeToConsent = useCallback(
    (user: Parameters<typeof beginPendingConsent>[0]) => {
      const onSuccess = onSuccessCallback ?? null;
      beginPendingConsent(user, onSuccess);
      // The upcoming programmatic close is a successful hand-off, not a dismiss.
      didAuthRef.current = true;
      resetForm();
      useAuthSheetStore.getState().hide();
      router.replace('/complete-profile' as never);
    },
    [beginPendingConsent, onSuccessCallback, resetForm],
  );

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) =>
      isVisible ? (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          pressBehavior="close"
        />
      ) : null,
    [isVisible],
  );

  const handleSocialAuth = async (provider: 'Google' | 'Apple') => {
    const request = startAuthRequest();
    if (!request) return;
    const method = provider === 'Google' ? 'google' : 'apple';
    const mode = authType === 'signUp' ? 'signup' : 'signin';
    const hadPendingAction = onSuccessCallback != null;
    track('auth_submitted', {
      method,
      mode,
      had_pending_action: hadPendingAction,
      apple_available: appleAvailable,
    });
    try {
      const result =
        provider === 'Google'
          ? await signInWithGoogle()
          : await signInWithApple();
      if (!isAuthRequestCurrent(request)) return;

      if (result.needsConsent) {
        // New / not-yet-consented social account: DO NOT enter the app. The
        // Firebase user already exists → navigate to the mandatory consent route.
        track('auth_succeeded', {
          method,
          outcome: 'needs_consent',
          had_pending_action: hadPendingAction,
        });
        routeToConsent(result.user);
        return;
      }

      track('auth_succeeded', {
        method,
        outcome: 'signed_in',
        had_pending_action: hadPendingAction,
      });
      handleSuccess();
    } catch (error: unknown) {
      if (!isAuthRequestCurrent(request)) return;
      track('auth_failed', {
        method,
        mode,
        error_message_key: (error as { code?: string })?.code ?? 'unknown',
      });
      Alert.alert('Erreur', error instanceof Error ? error.message : 'Erreur de connexion');
    } finally {
      finishAuthRequest(request);
    }
  };

  const handleEmailAuth = async () => {
    if (activeAuthRequest.current || !useAuthSheetStore.getState().isVisible) return;
    if (!email.trim() || !password.trim()) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs');
      return;
    }
    if (authType === 'signUp' && !displayName.trim()) {
      Alert.alert('Erreur', "Veuillez saisir un nom d'affichage");
      return;
    }
    const request = startAuthRequest();
    if (!request) return;
    const mode = authType === 'signUp' ? 'signup' : 'signin';
    const hadPendingAction = onSuccessCallback != null;
    track('auth_submitted', {
      method: 'email',
      mode,
      had_pending_action: hadPendingAction,
      ...(authType === 'signUp'
        ? { display_name_length: displayName.trim().length }
        : {}),
    });
    try {
      if (authType === 'signUp') {
        // Create the BARE account (no DOB/consent/username). The mandatory
        // consent route collects them next and signs the user in.
        const user = await signUpWithEmail(email, password, displayName);
        if (!isAuthRequestCurrent(request)) return;
        track('auth_succeeded', {
          method: 'email',
          outcome: 'needs_consent',
          had_pending_action: hadPendingAction,
        });
        routeToConsent(user);
        return;
      }
      const signedInUser = await signInWithEmail(email, password);
      if (!isAuthRequestCurrent(request)) return;
      if (useAuthStore.getState().pendingConsent && useAuthStore.getState().authenticatedUid === signedInUser.id) {
        track('auth_succeeded', {method: 'email', outcome: 'needs_consent', had_pending_action: hadPendingAction});
        routeToConsent(signedInUser);
        return;
      }
      track('auth_succeeded', {
        method: 'email',
        outcome: 'signed_in',
        had_pending_action: hadPendingAction,
      });
      handleSuccess();
    } catch (error: unknown) {
      if (!isAuthRequestCurrent(request)) return;
      track('auth_failed', {
        method: 'email',
        mode,
        error_message_key: (error as { code?: string })?.code ?? 'unknown',
      });
      Alert.alert('Erreur', error instanceof Error ? error.message : "Erreur lors de l'authentification");
    } finally {
      finishAuthRequest(request);
    }
  };

  const handleForgotPassword = async () => {
    if (activeAuthRequest.current || AppState.currentState !== 'active') return;
    if (!email.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer votre adresse email');
      return;
    }
    const request = startAuthRequest();
    if (!request) return;
    const requestEpoch = ++resetRequestEpoch.current;
    const version = useAuthSheetStore.getState().version;
    const uid = auth.currentUser?.uid ?? null, session = useAuthStore.getState(), storeUid = session.authenticatedUid,
      guestId = session.guestSession?.guestId ?? null, loading = session.isLoading, generation = getAuthSessionGeneration();
    const sourceKey = JSON.stringify([storeUid, uid, generation, version, guestId, loading]);
    const isCurrent = () => resetRequestEpoch.current === requestEpoch && AppState.currentState === 'active' &&
      auth.currentUser?.uid === (uid ?? undefined) && useAuthStore.getState().authenticatedUid === storeUid && getAuthSessionGeneration() === generation &&
      (useAuthStore.getState().guestSession?.guestId ?? null) === guestId && useAuthStore.getState().isLoading === loading &&
      useAuthSheetStore.getState().isVisible && useAuthSheetStore.getState().version === version;
    try {
      await AuthService.sendPasswordResetEmail(email.trim());
      if (!isCurrent()) return;
      setResetResultSource(sourceKey);
      setResetEmailSent(true);
      track('password_reset_requested', { result: 'sent' });
    } catch (error: unknown) {
      if (!isCurrent()) return;
      track('password_reset_requested', {
        result: 'error',
        error_message_key: (error as { code?: string })?.code ?? 'unknown',
      });
      Alert.alert('Erreur', error instanceof Error ? error.message : 'Impossible de traiter la demande. Réessayez.');
    } finally {
      finishAuthRequest(request);
    }
  };

  const handleContactSupport = useCallback(() => {
    handleClose();
    router.push('/settings/account-access' as never);
  }, [handleClose]);

  // Wraps AuthToggle's onSelect to record the signIn↔signUp switch.
  const handleModeSelect = useCallback(
    (next: AuthMode) => {
      if (activeAuthRequest.current) return;
      if (authType !== next) {
        track('auth_mode_switched', {
          from_mode: ANALYTICS_MODE[authType],
          to_mode: ANALYTICS_MODE[next],
        });
      }
      setAuthType(next);
    },
    [authType],
  );

  const handleForgotPasswordOpen = useCallback(() => {
    if (activeAuthRequest.current) return;
    track('auth_mode_switched', {
      from_mode: 'signin',
      to_mode: 'forgot_password',
      email_prefilled: email.trim().length > 0,
    });
    setAuthType('forgotPassword');
  }, [email]);

  const handleBackToSignIn = useCallback(() => {
    resetRequestEpoch.current++;
    setIsLoading(activeAuthRequest.current !== null);
    track('auth_mode_switched', {
      from_mode: 'forgot_password',
      to_mode: 'signin',
      reset_email_sent: resetEmailSent,
    });
    setAuthType('signIn');
    setResetEmailSent(false);
  }, [resetEmailSent]);

  // Per-mode title (signIn vs signUp). Rendered in AuthBottomSheet above the
  // shared chrome and animated on its own keyed region (FadeIn, ease-out).
  const renderTitle = () => {
    if (authType === 'signUp') {
      return (
        <>
          <Text style={styles.title}>Bienvenue sur</Text>
          <Text style={styles.subtitle}>Seconde</Text>
        </>
      );
    }
    return (
      <>
        <Text style={styles.title}>Content de</Text>
        <Text style={styles.subtitle}>te revoir</Text>
      </>
    );
  };

  // Per-mode fields (signIn vs signUp). The shared chrome (social buttons,
  // divider, toggle) stays mounted; only this region swaps on a mode change.
  const renderFields = () => {
    if (authType === 'signUp') {
      return (
        <SignUpForm
          email={email}
          password={password}
          displayName={displayName}
          isLoading={isLoading}
          onChangeEmail={setEmail}
          onChangePassword={setPassword}
          onChangeDisplayName={setDisplayName}
          onSubmit={handleEmailAuth}
        />
      );
    }
    return (
      <SignInForm
        email={email}
        password={password}
        isLoading={isLoading}
        onChangeEmail={setEmail}
        onChangePassword={setPassword}
        onSubmit={handleEmailAuth}
        onForgotPassword={handleForgotPasswordOpen}
      />
    );
  };

  // The signIn/signUp path keeps its chrome (title region, social buttons,
  // divider, toggle, message) mounted; only the title text and the fields swap.
  const isAuthPath = authType === 'signIn' || authType === 'signUp';

  return (
    <BottomSheet
      ref={bottomSheetRef}
      accessible={false}
      index={-1}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      enableDynamicSizing={false}
      onClose={handleClose}
      topInset={insets.top}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBackground}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isAuthPath ? (
          // Chrome stays mounted across signIn↔signUp. Only the title text and
          // the fields swap (each on its own keyed entering region).
          <View>
            <Animated.View
              key={`title-${authType}`}
              entering={FadeIn.duration(TITLE_DURATION).easing(
                Easing.out(Easing.cubic),
              )}
            >
              {renderTitle()}
            </Animated.View>
            {displayMessage ? (
              <Text style={styles.message}>{displayMessage}</Text>
            ) : null}

            <SocialAuthButtons
              isLoading={isLoading}
              onSocialAuth={handleSocialAuth}
            />

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>ou</Text>
              <View style={styles.dividerLine} />
            </View>

            <AuthToggle active={authType} onSelect={handleModeSelect} />

            <Animated.View
              key={`fields-${authType}`}
              entering={FadeInDown.duration(FIELDS_DURATION).easing(
                Easing.out(Easing.cubic),
              )}
            >
              {renderFields()}
            </Animated.View>
            <Pressable style={styles.linkButton} onPress={handleContactSupport} accessibilityRole="link" accessibilityLabel="Aide pour retrouver l’accès à votre compte">
              <Text style={styles.linkButtonText}>Besoin d’aide pour accéder à votre compte ?</Text>
            </Pressable>
          </View>
        ) : (
          // forgotPassword — full sub-tree swap (keyed FadeIn wrapper intended).
          <Animated.View key={authType} entering={FadeIn.duration(200)}>
            <ForgotPasswordForm
              email={email}
              isLoading={isLoading}
              resetEmailSent={resetEmailSent && resetResultSource === resetSourceKey && AppState.currentState === 'active'}
              onChangeEmail={setEmail}
              onSubmit={handleForgotPassword}
              onBackToSignIn={handleBackToSignIn}
              onContactSupport={handleContactSupport}
            />
          </Animated.View>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
};

export default AuthBottomSheet;
