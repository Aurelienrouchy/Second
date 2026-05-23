import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius } from '@/constants/theme';

type ScreenState = 'loading' | 'complete' | 'error';

interface AnalysisFooterProps {
  screenState: ScreenState;
  bottomInset: number;
  onContinue: () => void;
  onRetry: () => void;
  onManualEntry: () => void;
}

export const AnalysisFooter = React.memo(function AnalysisFooter({
  screenState,
  bottomInset,
  onContinue,
  onRetry,
  onManualEntry,
}: AnalysisFooterProps) {
  return (
    <View style={[styles.footer, { paddingBottom: bottomInset + 16 }]}>
      {screenState === 'complete' && (
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && { opacity: 0.7 },
          ]}
          onPress={onContinue}
        >
          <Text style={styles.primaryButtonText}>MODIFIER LES DÉTAILS</Text>
          <Ionicons name="arrow-forward" size={18} color={colors.cream} />
        </Pressable>
      )}

      {screenState === 'error' && (
        <>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && { opacity: 0.7 },
            ]}
            onPress={onRetry}
          >
            <Ionicons name="refresh-outline" size={18} color={colors.cream} />
            <Text style={styles.primaryButtonText}>RÉESSAYER</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.manualLink,
              pressed && { opacity: 0.7 },
            ]}
            onPress={onManualEntry}
          >
            <Text style={styles.manualLinkText}>ou remplir manuellement</Text>
          </Pressable>
        </>
      )}

      {screenState === 'loading' && (
        <Pressable
          style={({ pressed }) => [
            styles.manualLink,
            pressed && { opacity: 0.7 },
          ]}
          onPress={onManualEntry}
        >
          <Text style={styles.manualLinkText}>
            Passer et remplir manuellement
          </Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  footer: {
    backgroundColor: colors.cream,
    paddingTop: 16,
    paddingHorizontal: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.charcoal,
    paddingVertical: 16,
    borderRadius: radius.md,
    gap: 10,
  },
  primaryButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 2.16,
    color: colors.cream,
    textTransform: 'uppercase',
  },
  manualLink: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  manualLinkText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.72,
  },
});
