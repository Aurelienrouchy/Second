import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radius, spacing } from '@/constants/theme';
import type { ChatErrorStateProps } from '../types';

export const ChatErrorState = React.memo(function ChatErrorState({
  errorMessage,
}: ChatErrorStateProps) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
      <Text style={styles.title}>Erreur</Text>
      <Text style={styles.text}>{errorMessage}</Text>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>Retour</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    color: colors.foreground,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
  },
  backButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  backButtonText: {
    fontFamily: fonts.sansMedium,
    color: colors.white,
    fontSize: 16,
  },
});
