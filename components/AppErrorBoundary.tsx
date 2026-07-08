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

// Number of automatic recovery attempts before the fallback UI sticks.
// One silent retry absorbs transient render errors (e.g. a flaky chunk /
// data shape) without forcing the user to tap "Réessayer".
const MAX_AUTO_RETRIES = 1;

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

  private autoRetries = 0;

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Report first (so the error reaches Sentry/Crashlytics before any
    // recovery hides it), then log in dev. The reporter hook lives here:
    // wire captureException once a crash reporter is added.
    if (__DEV__) {
      console.error('[AppErrorBoundary] uncaught error:', error, info);
    }

    // Attempt one silent recovery before sticking on the fallback UI.
    if (this.autoRetries < MAX_AUTO_RETRIES) {
      this.autoRetries += 1;
      this.setState({ hasError: false, errorMessage: null });
    }
  }

  private handleRetry = () => {
    // Manual retry resets the auto-retry budget so a subsequent transient
    // failure can again recover silently.
    this.autoRetries = 0;
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container} testID="app-error-boundary-fallback">
        <Text style={styles.title}>Une erreur est survenue</Text>
        <Text style={styles.message}>
          L&apos;application a rencontré un problème inattendu. Vous pouvez réessayer.
        </Text>
        {__DEV__ && this.state.errorMessage && (
          <Text style={styles.errorDetail}>{this.state.errorMessage}</Text>
        )}
        <Pressable
          style={styles.button}
          onPress={this.handleRetry}
          testID="app-error-boundary-retry"
        >
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
