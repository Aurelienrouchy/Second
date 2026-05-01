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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { AuthService } from '@/services/authService';
import { useAuthSheetStore } from '@/store/authSheetStore';

import { ForgotPasswordForm } from './auth-bottom-sheet/ForgotPasswordForm';
import { SignInForm } from './auth-bottom-sheet/SignInForm';
import { SignUpForm } from './auth-bottom-sheet/SignUpForm';
import { styles } from './auth-bottom-sheet/styles';

type AuthMode = 'signIn' | 'signUp' | 'forgotPassword';

const AuthBottomSheet: React.FC = () => {
  const [authType, setAuthType] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const { signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithApple, mergeGuestToUser, user } = useAuth();
  const insets = useSafeAreaInsets();

  const snapPoints = useMemo(() => ['82%'], []);
  const bottomSheetRef = useRef<BottomSheet>(null);

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

  const handleClose = useCallback(() => {
    setEmail('');
    setPassword('');
    setUsername('');
    setAuthType('signIn');
    setIsLoading(false);
    setResetEmailSent(false);
    useAuthSheetStore.getState().hide();
  }, []);

  const handleSuccess = useCallback(async () => {
    if (user) {
      await mergeGuestToUser(user.id);
    }
    if (onSuccessCallback) {
      onSuccessCallback();
    }
    handleClose();
  }, [onSuccessCallback, handleClose, user, mergeGuestToUser]);

  const renderBackdrop = useCallback(
    (props: any) => <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />,
    [],
  );

  const handleSocialAuth = async (provider: 'Google' | 'Apple') => {
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
        await signUpWithEmail(email, password, username);
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
          isLoading={isLoading}
          message={displayMessage}
          onChangeEmail={setEmail}
          onChangePassword={setPassword}
          onChangeUsername={setUsername}
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
    >
      <BottomSheetView style={styles.content}>
        {renderBody()}
      </BottomSheetView>
    </BottomSheet>
  );
};

export default AuthBottomSheet;
