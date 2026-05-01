import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/constants/theme';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

/**
 * Top-level Error Boundary mounted in the root layout.
 *
 * Catches uncaught render errors so the app falls back to a recoverable
 * screen instead of crashing to a blank/red screen. Section-level
 * boundaries (`SectionErrorBoundary`) sit below this and catch in
 * narrower scopes — this one is the safety net.
 *
 * In production, errors should also be reported to Sentry/Crashlytics
 * here once the project wires one of those.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) {
      console.error('[AppErrorBoundary] uncaught error:', error, info);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Une erreur est survenue</Text>
        <Text style={styles.message}>
          L'application a rencontré un problème inattendu. Tu peux réessayer.
        </Text>
        {__DEV__ && this.state.errorMessage && (
          <Text style={styles.errorDetail}>{this.state.errorMessage}</Text>
        )}
        <Pressable style={styles.button} onPress={this.handleRetry}>
          <Text style={styles.buttonText}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.serifBold ?? fonts.sans,
    fontSize: 24,
    color: colors.foreground,
    textAlign: 'center',
  },
  message: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 320,
  },
  errorDetail: {
    fontFamily: fonts.sansMedium ?? fonts.sans,
    fontSize: 12,
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  button: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 14,
  },
  buttonText: {
    fontFamily: fonts.sansMedium ?? fonts.sans,
    fontSize: 15,
    color: colors.surface,
    letterSpacing: 0.5,
  },
});
