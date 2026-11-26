/**
 * Verify Email Settings
 */

import { useUser } from '@/hooks/useAuth';
import { track } from '@/lib/analytics';
import { AuthService } from '@/services/authService';
import { useTradeOperation } from '@/hooks/useTradeOperation';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { Text, Caption, ScreenHeader, Button } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const user = useUser();
  const context = useTradeOperation('settings-verify-email', user?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [formFrame, setFormFrame] = useState(context.frame);
  if (formFrame !== context.frame) {
    setFormFrame(context.frame); setEmailSent(false); setIsVerified(false); setLoading(false); setChecking(false);
  }

  const checkVerificationStatus = async () => {
    let operation;
    try {operation = context.start('verification');} catch {return;}
    if (!operation) return;
    setChecking(true);
    try {
      await AuthService.reloadUser();
      context.assertCurrent(operation);
      const verified = AuthService.isEmailVerified();
      setIsVerified(verified);
    } catch (error) {
      if (!context.isCurrent(operation)) return;
      if (__DEV__) console.error('Error checking verification status:', error);
    } finally {
      context.finish(operation);
      if (context.isCurrent(operation)) setChecking(false);
    }
  };

  useEffect(() => {
    (async () => {
      await checkVerificationStatus();
    })();
    // A first render may precede navigation focus. Read again when that focus
    // becomes current; local loading/status changes must not start another read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.frame, context.focusRevision]);

  const handleSendVerification = async () => {
    let operation;
    try {operation = context.start('verification');} catch {return;}
    if (!operation) return;
    setLoading(true);
    const isResend = emailSent;
    try {
      await AuthService.sendEmailVerification();
      context.assertCurrent(operation);
      setEmailSent(true);
      track('email_verification_sent', { is_resend: isResend, result: 'success' });
      Alert.alert(
        'Email envoyé',
        'Un email de vérification a été envoyé à votre adresse email. Cliquez sur le lien dans l\'email pour vérifier votre compte.'
      );
    } catch (error: unknown) {
      if (!context.isCurrent(operation)) return;
      track('email_verification_sent', { is_resend: isResend, result: 'error' });
      const message = error instanceof Error ? error.message : 'Une erreur est survenue';
      Alert.alert('Erreur', message);
    } finally {
      context.finish(operation);
      if (context.isCurrent(operation)) setLoading(false);
    }
  };

  const handleCheckVerification = async () => {
    let operation;
    try {operation = context.start('verification');} catch {return;}
    if (!operation) return;
    setChecking(true);
    try {
      await AuthService.reloadUser();
      context.assertCurrent(operation);
      const verified = AuthService.isEmailVerified();
      setIsVerified(verified);

      track('email_verification_checked', { result: verified ? 'verified' : 'not_verified' });

      if (verified) {
        Alert.alert(
          'Email vérifié !',
          'Votre adresse email a été vérifiée avec succès.',
          [{ text: 'OK', onPress: () => {if (context.isCurrent(operation)) router.back();} }]
        );
      } else {
        Alert.alert(
          'Pas encore vérifié',
          'Votre email n\'a pas encore été vérifié. Vérifiez votre boîte de réception et cliquez sur le lien de vérification.'
        );
      }
    } catch (error: unknown) {
      if (!context.isCurrent(operation)) return;
      track('email_verification_checked', { result: 'error' });
      const message = error instanceof Error ? error.message : 'Une erreur est survenue';
      Alert.alert('Erreur', message);
    } finally {
      context.finish(operation);
      if (context.isCurrent(operation)) setChecking(false);
    }
  };

  if (checking && !emailSent) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Vérifier l'e-mail" onBack={() => router.back()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text variant="body" style={styles.loadingText}>Vérification en cours...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Vérifier l'e-mail" onBack={() => router.back()} />

      <View style={styles.content}>
        {isVerified ? (
          <View style={styles.statusContainer}>
            <View style={[styles.iconCircle, styles.iconCircleSuccess]}>
              <Ionicons name="checkmark-circle" size={64} color={colors.success} />
            </View>
            <Text variant="h2" style={styles.statusTitle}>Email vérifié</Text>
            <Caption style={styles.statusText}>
              Votre adresse email est vérifiée et votre compte est sécurisé.
            </Caption>
            <Button
              variant="primary"
              fullWidth
              onPress={() => router.back()}
              style={styles.actionButton}
            >
              Retour
            </Button>
          </View>
        ) : (
          <View style={styles.statusContainer}>
            <View style={[styles.iconCircle, styles.iconCircleWarning]}>
              <Ionicons name="mail-unread" size={64} color={colors.warning} />
            </View>
            <Text variant="h2" style={styles.statusTitle}>Email non vérifié</Text>
            <Text variant="body" style={styles.emailText}>{user?.email}</Text>
            <Caption style={styles.statusText}>
              La vérification de votre email permet de sécuriser votre compte et de recevoir des notifications importantes.
            </Caption>

            {emailSent ? (
              <View style={styles.sentContainer}>
                <View style={styles.sentBox}>
                  <Ionicons name="paper-plane" size={24} color={colors.primary} />
                  <Text variant="bodySmall" style={styles.sentText}>
                    Email de vérification envoyé ! Vérifiez votre boîte de réception.
                  </Text>
                </View>

                <Button
                  variant="primary"
                  fullWidth
                  loading={checking}
                  disabled={!user || loading}
                  onPress={handleCheckVerification}
                  style={styles.actionButton}
                >
                  J&apos;ai vérifié mon email
                </Button>

                <Pressable
                  style={({ pressed }) => [styles.resendButton, pressed && { opacity: 0.7 }]}
                  onPress={handleSendVerification}
                  disabled={!user || loading || checking}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Text variant="body" style={styles.resendButtonText}>
                      Renvoyer l&apos;email
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : (
              <Button
                variant="primary"
                fullWidth
                loading={loading}
                disabled={!user || checking}
                onPress={handleSendVerification}
                style={styles.actionButton}
                leftIcon={<Ionicons name="mail" size={20} color={colors.foreground} />}
              >
                Envoyer l&apos;email de vérification
              </Button>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    color: colors.foregroundSecondary,
  },
  content: {
    flex: 1,
    padding: spacing.lg,
  },
  statusContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing['2xl'],
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconCircleSuccess: {
    backgroundColor: colors.successLight,
  },
  iconCircleWarning: {
    backgroundColor: colors.warningLight,
  },
  statusTitle: {
    color: colors.foreground,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emailText: {
    color: colors.primary,
    fontFamily: fonts.sansMedium,
    marginBottom: spacing.md,
  },
  statusText: {
    textAlign: 'center',
    color: colors.foregroundSecondary,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  actionButton: {
    marginTop: spacing.md,
  },
  sentContainer: {
    width: '100%',
    alignItems: 'center',
  },
  sentBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.lg,
    width: '100%',
  },
  sentText: {
    flex: 1,
    color: colors.foreground,
  },
  resendButton: {
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  resendButtonText: {
    color: colors.primary,
    fontFamily: fonts.sansMedium,
  },
});
