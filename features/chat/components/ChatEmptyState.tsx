import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/constants/theme';
import { formatDisplayName } from '@/utils/formatName';
import type { ChatEmptyStateProps } from '../types';

export const ChatEmptyState = React.memo(function ChatEmptyState({
  otherParticipantName,
}: ChatEmptyStateProps) {
  return (
    <View style={styles.container}>
      <Ionicons name="chatbubbles-outline" size={64} color={colors.muted} />
      <Text style={styles.title}>Aucun message</Text>
      <Text style={styles.text}>
        Commencez la conversation avec {formatDisplayName(otherParticipantName) || 'ce vendeur'}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  title: {
    fontFamily: fonts.displayMedium,
    fontSize: 20,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    color: colors.foreground,
  },
  text: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
  },
});
