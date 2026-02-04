import { useAuth } from '@/contexts/AuthContext';
import { AuthService } from '@/services/authService';
import BottomSheet, { BottomSheetBackdrop, BottomSheetView } from '@gorhom/bottom-sheet';
import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AuthBottomSheetProps {}

export interface AuthBottomSheetRef {
  show: (onSuccess?: () => void, message?: string) => void;
  hide: () => void;
}

const AuthBottomSheet = forwardRef<AuthBottomSheetRef, AuthBottomSheetProps>((_props, ref) => {
  const [authType, setAuthType] = useState<'signIn' | 'signUp' | 'forgotPassword'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [onSuccessCallback, setOnSuccessCallback] = useState<(() => void) | undefined>();
  const [displayMessage, setDisplayMessage] = useState("Connecte-toi pour continuer");
  const [resetEmailSent, setResetEmailSent] = useState(false);

  const { signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithApple, mergeGuestToUser, user } = useAuth();
  const insets = useSafeAreaInsets();

  // Bottom Sheet configuration
  const snapPoints = useMemo(() => ['80%'], []);
  const bottomSheetRef = React.useRef<BottomSheet>(null);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    show: (onSuccess?: () => void, message?: string) => {
      setOnSuccessCallback(() => onSuccess);
      setDisplayMessage(message || "Connecte-toi pour continuer");
      bottomSheetRef.current?.expand();
    },
    hide: () => {
      bottomSheetRef.current?.close();
    }
  }));

  const handleClose = useCallback(() => {
    setEmail('');
    setPassword('');
    setUsername('');
    setAuthType('signIn');
    setIsLoading(false);
    setOnSuccessCallback(undefined);
    setDisplayMessage("Connecte-toi pour continuer");
    setResetEmailSent(false);
    bottomSheetRef.current?.close();
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
      Alert.alert('Erreur', error.message || 'Erreur lors de l\'envoi de l\'email');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuccess = useCallback(async () => {
    // Merge guest data to user account after successful auth
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
    []
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
      Alert.alert('Erreur', 'Veuillez saisir un nom d\'utilisateur');
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
      Alert.alert('Erreur', error.message || 'Erreur lors de l\'authentification');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      onClose={handleClose}
      topInset={insets.top}
    >
      <BottomSheetView style={styles.content}>
            {authType === 'forgotPassword' ? (
              <>
                <Text style={styles.title}>Réinitialiser le mot de passe</Text>
                {resetEmailSent ? (
                  <>
                    <View style={styles.successBox}>
                      <Text style={styles.successIcon}>✉️</Text>
                      <Text style={styles.successTitle}>Email envoyé !</Text>
                      <Text style={styles.successText}>
                        Un email de réinitialisation a été envoyé à{'\n'}
                        <Text style={styles.emailHighlight}>{email}</Text>
                      </Text>
                      <Text style={styles.successHint}>
                        Vérifiez votre boîte de réception et suivez les instructions pour créer un nouveau mot de passe.
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.submitButton}
                      onPress={() => {
                        setAuthType('signIn');
                        setResetEmailSent(false);
                      }}
                    >
                      <Text style={styles.submitButtonText}>Retour à la connexion</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.message}>
                      Entrez votre adresse email et nous vous enverrons un lien pour réinitialiser votre mot de passe.
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Email"
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                    <TouchableOpacity
                      style={[styles.submitButton, !email.trim() && styles.disabledButton]}
                      onPress={handleForgotPassword}
                      disabled={!email.trim() || isLoading}
                    >
                      {isLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.submitButtonText}>Envoyer le lien</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => setAuthType('signIn')}
                    >
                      <Text style={styles.backButtonText}>Retour à la connexion</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={styles.title}>Connexion requise</Text>
                <Text style={styles.message}>{displayMessage}</Text>

                {/* Boutons d'authentification sociale */}
                <TouchableOpacity
                  style={styles.appleButton}
                  onPress={() => handleSocialAuth('Apple')}
                  disabled={isLoading}
                >
                  <Text style={styles.appleButtonIcon}></Text>
                  <Text style={styles.appleButtonText}>Continuer avec Apple</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.socialButton}
                  onPress={() => handleSocialAuth('Google')}
                  disabled={isLoading}
                >
                  <Text style={styles.socialButtonIcon}>🔍</Text>
                  <Text style={styles.socialButtonText}>Continuer avec Google</Text>
                </TouchableOpacity>

                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>ou</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Toggle entre Sign In et Sign Up */}
                <View style={styles.authToggle}>
                  <TouchableOpacity
                    style={[styles.toggleButton, authType === 'signIn' && styles.activeToggle]}
                    onPress={() => setAuthType('signIn')}
                  >
                    <Text style={[styles.toggleText, authType === 'signIn' && styles.activeToggleText]}>
                      Se connecter
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.toggleButton, authType === 'signUp' && styles.activeToggle]}
                    onPress={() => setAuthType('signUp')}
                  >
                    <Text style={[styles.toggleText, authType === 'signUp' && styles.activeToggleText]}>
                      S'inscrire
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Formulaire */}
                {authType === 'signUp' && (
                  <TextInput
                    style={styles.input}
                    placeholder="Nom d'utilisateur"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                  />
                )}

                <TextInput
                  style={styles.input}
                  placeholder="Email"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <TextInput
                  style={styles.input}
                  placeholder="Mot de passe"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />

                <TouchableOpacity
                  style={[
                    styles.submitButton,
                    (!email.trim() || !password.trim() || (authType === 'signUp' && !username.trim())) && styles.disabledButton
                  ]}
                  onPress={handleEmailAuth}
                  disabled={!email.trim() || !password.trim() || (authType === 'signUp' && !username.trim()) || isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.submitButtonText}>
                      {authType === 'signUp' ? 'S\'inscrire' : 'Se connecter'}
                    </Text>
                  )}
                </TouchableOpacity>

                {authType === 'signIn' && (
                  <TouchableOpacity
                    style={styles.forgotPasswordButton}
                    onPress={() => setAuthType('forgotPassword')}
                  >
                    <Text style={styles.forgotPasswordText}>Mot de passe oublié ?</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </BottomSheetView>
    </BottomSheet>
  );
});

export default AuthBottomSheet;

const styles = StyleSheet.create({
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  appleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
    borderRadius: 12,
    paddingVertical: 16,
    gap: 12,
    marginBottom: 12,
  },
  appleButtonIcon: {
    fontSize: 20,
    color: '#fff',
  },
  appleButtonText: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '500',
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingVertical: 16,
    backgroundColor: '#fff',
    gap: 12,
    marginBottom: 12,
  },
  socialButtonIcon: {
    fontSize: 20,
  },
  socialButtonText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#666',
    fontSize: 14,
  },
  authToggle: {
    flexDirection: 'row',
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 4,
    marginBottom: 20,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  activeToggle: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleText: {
    fontSize: 14,
    color: '#666',
  },
  activeToggleText: {
    color: '#333',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#f8f9fa',
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: '#F79F24',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  disabledButton: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  forgotPasswordButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  forgotPasswordText: {
    color: '#09B1BA',
    fontSize: 14,
    fontWeight: '500',
  },
  backButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#666',
    fontSize: 14,
  },
  successBox: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
  successIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  successText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 20,
  },
  emailHighlight: {
    fontWeight: '600',
    color: '#333',
  },
  successHint: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
  },
});