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

import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthActions } from '@/contexts/AuthContext';
import { AuthService } from '@/services/authService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { User } from '@/types';
import { computeAgeFromIso, MIN_AGE_REGISTER, toIsoDate } from '@/utils/age';

import { ForgotPasswordForm } from './auth-bottom-sheet/ForgotPasswordForm';
import { SignInForm } from './auth-bottom-sheet/SignInForm';
import { SignUpForm } from './auth-bottom-sheet/SignUpForm';
import { SocialConsentForm } from './auth-bottom-sheet/SocialConsentForm';
import { styles } from './auth-bottom-sheet/styles';

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

  const snapPoints = useMemo(() => ['82%'], []);
  const bottomSheetRef = useRef<BottomSheet>(null);
  // Tracks whether the social consent step is pending an explicit resolution
  // (success or rollback). Mirrors `pendingSocialUser` for use inside the
  // `onClose` callback, which can fire from a pan-down / backdrop dismiss.
  const pendingSocialUserRef = useRef<User | null>(null);
  const consentResolvedRef = useRef(false);

  const isVisible = useAuthSheetStore((s) => s.isVisible);
  const displayMessage = useAuthSheetStore((s) => s.message);
  const onSuccessCallback = useAuthSheetStore((s) => s.onSuccess);
  const sheetVersion = useAuthSheetStore((s) => s.version);

  useEffect(() => {
    if (isVisible) {
      bottomSheetRef.current?.expand();
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
  }, []);

  const handleClose = useCallback(() => {
    // If the sheet is dismissed (pan-down / backdrop / programmatic close)
    // while a social consent step is still unresolved, the freshly created
    // social account has no proof of consent → roll it back (Loi 25).
    if (pendingSocialUserRef.current && !consentResolvedRef.current) {
      consentResolvedRef.current = true;
      void rollbackSocialSignIn();
    }
    resetForm();
    useAuthSheetStore.getState().hide();
  }, [resetForm, rollbackSocialSignIn]);

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

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) =>
      isVisible ? (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
      ) : null,
    [isVisible],
  );

  const handleSocialAuth = async (provider: 'Google' | 'Apple') => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      if (provider === 'Google') {
        await signInWithGoogle();
      } else if (provider === 'Apple') {
        await signInWithApple();
      }
      handleSuccess();
    } catch (error: any) {
      Alert.alert('Erreur', error.message || 'Erreur de connexion');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Erreur', 'Veuillez remplir tous les champs');
      return;
    }
    if (authType === 'signUp' && !username.trim()) {
      Alert.alert('Erreur', "Veuillez saisir un nom d'utilisateur");
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

  const renderBody = () => {
    if (authType === 'forgotPassword') {
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
    }
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
          message={displayMessage}
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
          onSwitchToSignIn={() => setAuthType('signIn')}
          onSocialAuth={handleSocialAuth}
        />
      );
    }
    return (
      <SignInForm
        email={email}
        password={password}
        isLoading={isLoading}
        message={displayMessage}
        onChangeEmail={setEmail}
        onChangePassword={setPassword}
        onSubmit={handleEmailAuth}
        onSwitchToSignUp={() => setAuthType('signUp')}
        onForgotPassword={() => setAuthType('forgotPassword')}
        onSocialAuth={handleSocialAuth}
      />
    );
  };

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      enableDynamicSizing={false}
      onClose={handleClose}
      topInset={insets.top}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBackground}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="none"
      android_keyboardInputMode="adjustResize"
    >
      <BottomSheetView style={styles.content}>
        <Animated.View key={authType} entering={FadeIn.duration(200)}>
          {renderBody()}
        </Animated.View>
      </BottomSheetView>
    </BottomSheet>
  );
};

export default AuthBottomSheet;
