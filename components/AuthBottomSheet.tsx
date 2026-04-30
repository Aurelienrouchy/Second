import { useAuth } from '@/contexts/AuthContext';
import { AuthService } from '@/services/authService';
import { useAuthSheetStore } from '@/store/authSheetStore';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius, spacing } from '@/constants/theme';

/**
 * Global auth bottom sheet.
 *
 * Driven entirely by `authSheetStore` — call
 * `useAuthSheetStore.getState().show(message, onSuccess)` from anywhere
 * in the app to open it. Render exactly ONCE in the root layout.
 */
const AuthBottomSheet: React.FC = () => {
  const [authType, setAuthType] = useState<'signIn' | 'signUp' | 'forgotPassword'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const { signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithApple, mergeGuestToUser, user } = useAuth();
  const insets = useSafeAreaInsets();

  const snapPoints = useMemo(() => ['82%'], []);
  const bottomSheetRef = useRef<BottomSheet>(null);

  // Drive the imperative bottom-sheet API from store state.
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
    // sheetVersion ensures we re-trigger expand even when isVisible
    // didn't change (e.g. show() called twice in a row).
  }, [isVisible, sheetVersion]);

  const handleClose = useCallback(() => {
    setEmail('');
    setPassword('');
    setUsername('');
    setAuthType('signIn');
    setIsLoading(false);
    setResetEmailSent(false);
    // Hiding the sheet via the store also clears message/onSuccess.
    useAuthSheetStore.getState().hide();
  }, []);

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

  // ── Forgot Password view ──
  const renderForgotPassword = () => (
    <>
      <Text style={styles.title}>Réinitialiser</Text>
      <Text style={styles.subtitle}>le mot de passe</Text>

      {resetEmailSent ? (
        <>
          <View style={styles.successBox}>
            <View style={styles.successIconCircle}>
              <Ionicons name="mail-outline" size={28} color={colors.primary} />
            </View>
            <Text style={styles.successTitle}>Email envoyé</Text>
            <Text style={styles.successText}>
              Un email de réinitialisation a été envoyé à
            </Text>
            <Text style={styles.emailHighlight}>{email}</Text>
            <Text style={styles.successHint}>
              Vérifiez votre boîte de réception et suivez les instructions.
            </Text>
          </View>
          <Pressable
            style={styles.primaryButton}
            onPress={() => {
              setAuthType('signIn');
              setResetEmailSent(false);
            }}
          >
            <Text style={styles.primaryButtonText}>RETOUR À LA CONNEXION</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.message}>
            Entrez votre adresse email et nous vous enverrons un lien pour créer un nouveau mot de passe.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.muted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Pressable
            style={[styles.primaryButton, !email.trim() && styles.disabledButton]}
            onPress={handleForgotPassword}
            disabled={!email.trim() || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.primaryButtonText}>ENVOYER LE LIEN</Text>
            )}
          </Pressable>
          <Pressable style={styles.linkButton} onPress={() => setAuthType('signIn')}>
            <Text style={styles.linkButtonText}>Retour à la connexion</Text>
          </Pressable>
        </>
      )}
    </>
  );

  // ── Sign In / Sign Up view ──
  const renderAuthForm = () => (
    <>
      <Text style={styles.title}>
        {authType === 'signIn' ? 'Content de' : 'Bienvenue sur'}
      </Text>
      <Text style={styles.subtitle}>
        {authType === 'signIn' ? 'te revoir' : 'Seconde'}
      </Text>
      <Text style={styles.message}>{displayMessage}</Text>

      {/* Social auth */}
      <Pressable
        style={styles.appleButton}
        onPress={() => handleSocialAuth('Apple')}
        disabled={isLoading}
      >
        <Ionicons name="logo-apple" size={20} color={colors.white} />
        <Text style={styles.appleButtonText}>Continuer avec Apple</Text>
      </Pressable>

      <Pressable
        style={styles.socialButton}
        onPress={() => handleSocialAuth('Google')}
        disabled={isLoading}
      >
        <Ionicons name="logo-google" size={18} color={colors.foreground} />
        <Text style={styles.socialButtonText}>Continuer avec Google</Text>
      </Pressable>

      {/* Divider */}
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>ou</Text>
        <View style={styles.dividerLine} />
      </View>

      {/* Toggle tabs */}
      <View style={styles.authToggle}>
        <Pressable
          style={[styles.toggleTab, authType === 'signIn' && styles.toggleTabActive]}
          onPress={() => setAuthType('signIn')}
        >
          <Text style={[styles.toggleTabText, authType === 'signIn' && styles.toggleTabTextActive]}>
            Se connecter
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggleTab, authType === 'signUp' && styles.toggleTabActive]}
          onPress={() => setAuthType('signUp')}
        >
          <Text style={[styles.toggleTabText, authType === 'signUp' && styles.toggleTabTextActive]}>
            S'inscrire
          </Text>
        </Pressable>
      </View>

      {/* Form fields */}
      {authType === 'signUp' && (
        <TextInput
          style={styles.input}
          placeholder="Nom d'utilisateur"
          placeholderTextColor={colors.muted}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />
      )}

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.muted}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextInput
        style={styles.input}
        placeholder="Mot de passe"
        placeholderTextColor={colors.muted}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      {/* Submit */}
      <Pressable
        style={[
          styles.primaryButton,
          (!email.trim() || !password.trim() || (authType === 'signUp' && !username.trim())) &&
            styles.disabledButton,
        ]}
        onPress={handleEmailAuth}
        disabled={
          !email.trim() || !password.trim() || (authType === 'signUp' && !username.trim()) || isLoading
        }
      >
        {isLoading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.primaryButtonText}>
            {authType === 'signUp' ? "S'INSCRIRE" : 'SE CONNECTER'}
          </Text>
        )}
      </Pressable>

      {authType === 'signIn' && (
        <Pressable style={styles.linkButton} onPress={() => setAuthType('forgotPassword')}>
          <Text style={styles.linkButtonText}>Mot de passe oublié ?</Text>
        </Pressable>
      )}
    </>
  );

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
        {authType === 'forgotPassword' ? renderForgotPassword() : renderAuthForm()}
      </BottomSheetView>
    </BottomSheet>
  );
};

export default AuthBottomSheet;

// =============================================================================
// STYLES — Seconde Design System
// =============================================================================

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  handle: {
    backgroundColor: colors.borderStrong,
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 40,
  },

  // ── Typography ──
  title: {
    fontFamily: fonts.display,
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
    letterSpacing: -0.5,
    color: colors.foreground,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.display,
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 36,
    letterSpacing: -0.5,
    color: colors.primary, // rust accent
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },

  // ── Social buttons ──
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    borderRadius: radius.md,
    paddingVertical: 14,
    gap: 10,
    marginBottom: spacing.sm,
  },
  appleButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.white,
    letterSpacing: 0.3,
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    backgroundColor: colors.surface,
    gap: 10,
    marginBottom: spacing.sm,
  },
  socialButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.foreground,
    letterSpacing: 0.3,
  },

  // ── Divider ──
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    marginHorizontal: spacing.md,
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },

  // ── Toggle tabs ──
  authToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.sm,
    padding: 3,
    marginBottom: spacing.md,
  },
  toggleTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: radius.xs,
  },
  toggleTabActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.charcoal,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  toggleTabText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.3,
  },
  toggleTabTextActive: {
    color: colors.foreground,
  },

  // ── Inputs ──
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },

  // ── Primary CTA ──
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  disabledButton: {
    backgroundColor: colors.muted,
    opacity: 0.5,
  },
  primaryButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.white,
    letterSpacing: 1.2,
  },

  // ── Link button ──
  linkButton: {
    marginTop: spacing.md,
    alignItems: 'center',
  },
  linkButtonText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.primary,
  },

  // ── Success state ──
  successBox: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  successIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  successTitle: {
    fontFamily: fonts.displayMedium,
    fontSize: 22,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  successText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  emailHighlight: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.foreground,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  successHint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: spacing.sm,
  },
});
