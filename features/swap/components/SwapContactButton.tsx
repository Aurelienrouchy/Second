/**
 * SwapContactButton
 * "Contacter" CTA navigating to chat with the other participant.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';

interface SwapContactButtonProps {
  otherUserId: string;
  otherUserName: string;
}

export const SwapContactButton = React.memo(function SwapContactButton({
  otherUserId,
  otherUserName,
}: SwapContactButtonProps) {
  const handlePress = useCallback(() => {
    router.push(`/chat/${otherUserId}`);
  }, [otherUserId]);

  return (
    <Pressable
      style={({ pressed }) => [styles.contactButton, pressed && { opacity: 0.7 }]}
      onPress={handlePress}
    >
      <Ionicons name="chatbubble-outline" size={20} color={colors.sage} />
      <Text variant="body" style={styles.contactButtonText}>
        Contacter {otherUserName}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 24,
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: 8,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.sage,
  },
});
