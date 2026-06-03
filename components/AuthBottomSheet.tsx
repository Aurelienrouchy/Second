/**
 * Global auth bottom sheet.
 *
 * Driven entirely by `authSheetStore` — call
 * `useAuthSheetStore.getState().show(message, onSuccess)` from anywhere
 * in the app to open it. Render exactly ONCE in the root layout.
 *
 * Mode-specific UI lives in components/auth-bottom-sheet/. This wrapper owns
 * the BottomSheet, the form state, and the network calls; the sub-components
 * are presentational only.
 */

import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthActions } from '@/contexts/AuthContext';
import { AuthService } from '@/services/authService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { User } from '@/types';
import { computeAgeFromIso, MIN_AGE_REGISTER, toIsoDate } from '@/utils/age';

import { AuthToggle } from './auth-bottom-sheet/AuthToggle';
import { ForgotPasswordForm } from './auth-bottom-sheet/ForgotPasswordForm';
import { SignInForm } from './auth-bottom-sheet/SignInForm';
import { SignUpForm } from './auth-bottom-sheet/SignUpForm';
import { SocialAuthButtons } from './auth-bottom-sheet/SocialAuthButtons';
import { SocialConsentForm } from './auth-bottom-sheet/SocialConsentForm';
import { styles } from './auth-bottom-sheet/styles';

// Fields entrance: slide up from slightly below + fade in (withTiming + ease-out
// only — no spring). FadeInDown starts the element below its final spot and
// glides it UP into place while fading, which reads as « les champs remontent ».
const FIELDS_DURATION = 240;
const TITLE_DURATION = 200;

type AuthMode = 'signIn' | 'signUp' | 'forgotPassword' | 'socialConsent';

const AuthBottomSheet: React.FC = () => {
  const [authType, setAuthType] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [dobTouched, setDobTouched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  // Set once a social sign-in reports `needsConsent`. While non-null, the
  // mandatory consent step is shown and a back-out must roll the account back.
  const [pendingSocialUser, setPendingSocialUser] = useState<User | null>(null);

  const {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithApple,
    recordSocialConsent,
    rollbackSocialSignIn,
  } = useAuthActions();
  const insets = useSafeAreaInsets();

  // When the keyboard opens, raise the top snap point to nearly full height so
  // the BottomSheetScrollView has room to scroll the focused input above the
  // keyboard. The base snap stays at 82%; the second (98%) is the keyboard-open
  // target that "interactive" pans toward. Single snap point left the sheet with
  // no room to scroll on Android (adjustResize) so the focused field stayed
  // covered — see verification notes.
  const snapPoints = useMemo(() => ['82%', '98%'], []);
  const bottomSheetRef = useRef<BottomSheet>(null);
  // Tracks whether the social consent step is pending an explicit resolution
  // (success or rollback). Mirrors `pendingSocialUser` for use inside the
  // `onClose` callback, which can fire from a pan-down / backdrop dismiss.
  const pendingSocialUserRef = useRef<User | null>(null);
  // Mirrors SocialAuthResult.isNewUser for the pending consent step. Decides
  // whether a back-out rolls back DESTRUCTIVELY (brand-new account) or just
  // signs out (existing account without dateOfBirth — must never be deleted).
  const pendingIsNewUserRef = useRef(false);
  const consentResolvedRef = useRef(false);

  const isVisible = useAuthSheetStore((s) => s.isVisible);
  const displayMessage = useAuthSheetStore((s) => s.message);
  const onSuccessCallback = useAuthSheetStore((s) => s.onSuccess);
  const sheetVersion = useAuthSheetStore((s) => s.version);

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
    setEmail('');
    setPassword('');
    setUsername('');
    setDobDay('');
    setDobMonth('');
    setDobYear('');
    setAcceptedTerms(false);
    setAcceptedPrivacy(false);
    setMarketingOptIn(false);
    setDobTouched(false);
    setAuthType('signIn');
    setIsLoading(false);
    setResetEmailSent(false);
    setPendingSocialUser(null);
    pendingSocialUserRef.current = null;
    pendingIsNewUserRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    // If the sheet is dismissed (pan-down / backdrop / programmatic close)
    // while a social consent step is still unresolved, the freshly created
    // social account has no proof of consent → roll it back (Loi 25).
    if (pendingSocialUserRef.current && !consentResolvedRef.current) {
      consentResolvedRef.current = true;
      void rollbackSocialSignIn(pendingIsNewUserRef.current);
    }
    resetForm();
    useAuthSheetStore.getState().hide();
  }, [resetForm, rollbackSocialSignIn]);

  // Android hardware back: while the sheet is visible, route through the same
  // close path (so the consent rollback + store hide fire) and consume the
  // event so it never falls through to the underlying navigator. During the
  // consent lock, consume without closing — a back-tap must not silently
  // delete the freshly created social account.
  useEffect(() => {
    if (!isVisible) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (authType === 'socialConsent') return true;
        handleClose();
        return true;
      },
    );
    return () => subscription.remove();
  }, [isVisible, authType, handleClose]);

  const handleToggleTerms = useCallback(() => setAcceptedTerms((v) => !v), []);
  const handleTogglePrivacy = useCallback(
    () => setAcceptedPrivacy((v) => !v),
    [],
  );
  const handleToggleMarketing = useCallback(
    () => setMarketingOptIn((v) => !v),
    [],
  );

  const handleSuccess = useCallback(() => {
    onSuccessCallback?.();
    handleClose();
  }, [onSuccessCallback, handleClose]);

  // During the mandatory social consent step the sheet is "locked": a stray
  // backdrop tap / pan-down would silently roll back (delete) the freshly
  // created social account. Block those gestures and require an explicit
  // resolution (submit or the visible back-out, which both confirm intent).
  const isConsentLocked = authType === 'socialConsent';

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) =>
      isVisible ? (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          pressBehavior={isConsentLocked ? 'none' : 'close'}
        />
      ) : null,
    [isVisible, isConsentLocked],
  );

  const handleSocialAuth = async (provider: 'Google' | 'Apple') => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      const result =
        provider === 'Google'
          ? await signInWithGoogle()
          : await signInWithApple();

      if (result.needsConsent) {
        // New / not-yet-consented social account: DO NOT enter the app.
        // Show the mandatory consent step. Until resolved, dismissing the
        // sheet rolls the account back (see handleClose).
        consentResolvedRef.current = false;
        setPendingSocialUser(result.user);
        pendingSocialUserRef.current = result.user;
        pendingIsNewUserRef.current = result.isNewUser;
        // Pre-fill nothing; collect a fresh DOB + consents.
        setDobDay('');
        setDobMonth('');
        setDobYear('');
        setAcceptedTerms(false);
        setAcceptedPrivacy(false);
        setMarketingOptIn(false);
        setDobTouched(false);
        setAuthType('socialConsent');
        setIsLoading(false);
        return;
      }

      handleSuccess();
    } catch (error: any) {
      Alert.alert('Erreur', error.message || 'Erreur de connexion');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialConsentSubmit = async () => {
    if (isLoading || !pendingSocialUser) return;

    const dateOfBirth = toIsoDate(
      parseInt(dobYear, 10),
      parseInt(dobMonth, 10),
      parseInt(dobDay, 10),
    );
    if (!dateOfBirth) {
      Alert.alert('Erreur', 'La date de naissance est invalide');
      return;
    }

    setIsLoading(true);
    try {
      await recordSocialConsent(pendingSocialUser, {
        dateOfBirth,
        acceptedTerms,
        acceptedPrivacy,
        marketingOptIn,
      });
      // Consent recorded server-side → user is now signed in.
      consentResolvedRef.current = true;
      pendingSocialUserRef.current = null;
      pendingIsNewUserRef.current = false;
      handleSuccess();
    } catch (error: any) {
      // Age < 16, missing boxes, or callable failure → roll the account back.
      // Brand-new account → deleted ; existing account → only signed out, so
      // no account with a balance is ever destroyed (Loi 25 + safety).
      consentResolvedRef.current = true;
      try {
        await rollbackSocialSignIn(pendingIsNewUserRef.current);
      } catch {
        // best-effort
      }
      pendingSocialUserRef.current = null;
      pendingIsNewUserRef.current = false;
      setPendingSocialUser(null);
      setIsLoading(false);
      Alert.alert(
        'Inscription non finalisée',
        error.message ||
          'Le consentement n\'a pas pu être enregistré. Votre compte a été supprimé. Veuillez réessayer.',
      );
      handleClose();
    }
  };

  const handleEmailAuth = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs');
      return;
    }
    if (authType === 'signUp' && !username.trim()) {
      Alert.alert('Erreur', "Veuillez saisir un nom d'affichage");
      return;
    }
    setIsLoading(true);
    try {
      if (authType === 'signUp') {
        // The SignUpForm keeps the button disabled until these are valid;
        // toIsoDate is the single source of truth for the calendar date.
        const dateOfBirth = toIsoDate(
          parseInt(dobYear, 10),
          parseInt(dobMonth, 10),
          parseInt(dobDay, 10),
        );
        if (!dateOfBirth) {
          Alert.alert('Erreur', 'La date de naissance est invalide');
          setIsLoading(false);
          return;
        }
        await signUpWithEmail(email, password, username, {
          dateOfBirth,
          acceptedTerms,
          acceptedPrivacy,
          marketingOptIn,
        });
      } else {
        await signInWithEmail(email, password);
      }
      handleSuccess();
    } catch (error: any) {
      Alert.alert('Erreur', error.message || "Erreur lors de l'authentification");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer votre adresse email');
      return;
    }
    setIsLoading(true);
    try {
      await AuthService.sendPasswordResetEmail(email);
      setResetEmailSent(true);
    } catch (error: any) {
      Alert.alert('Erreur', error.message || "Erreur lors de l'envoi de l'email");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToSignIn = useCallback(() => {
    setAuthType('signIn');
    setResetEmailSent(false);
  }, []);

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
          username={username}
          dobDay={dobDay}
          dobMonth={dobMonth}
          dobYear={dobYear}
          acceptedTerms={acceptedTerms}
          acceptedPrivacy={acceptedPrivacy}
          marketingOptIn={marketingOptIn}
          isLoading={isLoading}
          onChangeEmail={setEmail}
          onChangePassword={setPassword}
          onChangeUsername={setUsername}
          onChangeDobDay={setDobDay}
          onChangeDobMonth={setDobMonth}
          onChangeDobYear={setDobYear}
          onToggleTerms={handleToggleTerms}
          onTogglePrivacy={handleTogglePrivacy}
          onToggleMarketing={handleToggleMarketing}
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
        onForgotPassword={() => setAuthType('forgotPassword')}
      />
    );
  };

  const renderBody = () => {
    if (authType === 'socialConsent') {
      // Age + consent validation for the social step (server revalidates).
      const dobComplete =
        dobDay !== '' && dobMonth !== '' && dobYear.length === 4;
      const isoDob = dobComplete
        ? toIsoDate(
            parseInt(dobYear, 10),
            parseInt(dobMonth, 10),
            parseInt(dobDay, 10),
          )
        : null;
      const age = isoDob ? computeAgeFromIso(isoDob) : null;
      const ageValid = age !== null && age >= MIN_AGE_REGISTER;
      const showAgeError =
        dobTouched && dobComplete && (isoDob === null || !ageValid);
      const submitDisabled =
        !ageValid || !acceptedTerms || !acceptedPrivacy || isLoading;

      return (
        <SocialConsentForm
          dobDay={dobDay}
          dobMonth={dobMonth}
          dobYear={dobYear}
          acceptedTerms={acceptedTerms}
          acceptedPrivacy={acceptedPrivacy}
          marketingOptIn={marketingOptIn}
          showAgeError={showAgeError}
          submitDisabled={submitDisabled}
          isLoading={isLoading}
          onChangeDobDay={setDobDay}
          onChangeDobMonth={setDobMonth}
          onChangeDobYear={setDobYear}
          onBlurDob={() => setDobTouched(true)}
          onToggleTerms={handleToggleTerms}
          onTogglePrivacy={handleTogglePrivacy}
          onToggleMarketing={handleToggleMarketing}
          onSubmit={handleSocialConsentSubmit}
        />
      );
    }
    // forgotPassword is the only remaining full-swap mode handled here; the
    // signIn/signUp path is rendered with shared chrome (see the return below).
    return (
      <ForgotPasswordForm
        email={email}
        isLoading={isLoading}
        resetEmailSent={resetEmailSent}
        onChangeEmail={setEmail}
        onSubmit={handleForgotPassword}
        onBackToSignIn={handleBackToSignIn}
      />
    );
  };

  // The signIn/signUp path keeps its chrome (title region, social buttons,
  // divider, toggle, message) mounted; only the title text and the fields swap.
  const isAuthPath = authType === 'signIn' || authType === 'signUp';

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      enablePanDownToClose={!isConsentLocked}
      enableDynamicSizing={false}
      onClose={handleClose}
      topInset={insets.top}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBackground}
      keyboardBehavior="interactive"
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

            <AuthToggle active={authType} onSelect={setAuthType} />

            <Animated.View
              key={`fields-${authType}`}
              entering={FadeInDown.duration(FIELDS_DURATION).easing(
                Easing.out(Easing.cubic),
              )}
            >
              {renderFields()}
            </Animated.View>
          </View>
        ) : (
          // Full-swap modes (forgotPassword / socialConsent): keep the keyed
          // FadeIn wrapper — a complete sub-tree swap is intended here.
          <Animated.View key={authType} entering={FadeIn.duration(200)}>
            {renderBody()}
          </Animated.View>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
};

export default AuthBottomSheet;
