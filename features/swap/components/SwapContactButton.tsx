/**
 * SwapContactButton
 * "Contacter" CTA that resolves (or creates) the chat thread with the other
 * participant, then navigates to it with the real chatId.
 */

import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts, spacing, radius, sizing } from '@/constants/theme';
import { useUser } from '@/hooks/useAuth';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { ChatService } from '@/services/chatService';
import { track } from '@/lib/analytics';

interface SwapContactButtonProps {
  otherUserId: string;
  otherUserName: string;
}

export const SwapContactButton = React.memo(function SwapContactButton({
  otherUserId,
  otherUserName,
}: SwapContactButtonProps) {
  const currentUser = useUser();
  const showAuthSheet = useAuthSheetStore((state) => state.show);
  const [isLoading, setIsLoading] = useState(false);
  const loadingRef = useRef(false);

  const handlePress = useCallback(async () => {
    if (!currentUser?.id) {
      showAuthSheet('Connectez-vous pour contacter ce participant');
      return;
    }
    if (!otherUserId || loadingRef.current) return;
    loadingRef.current = true;

    setIsLoading(true);
    try {
      const chat = await ChatService.createOrGetChat(currentUser.id, otherUserId);
      track('chat_started', {
        chat_id: chat.id,
        source: 'swap',
        other_user_id: otherUserId,
        is_new_chat: !chat.lastMessage,
        outcome: 'success',
      });
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      if (__DEV__) console.error('Error creating chat:', error);
      track('chat_started', {
        chat_id: '',
        source: 'swap',
        other_user_id: otherUserId,
        is_new_chat: false,
        outcome: 'error',
      });
      Alert.alert('Erreur', 'Impossible de démarrer la conversation.');
    } finally {
      loadingRef.current = false;
      setIsLoading(false);
    }
  }, [currentUser?.id, otherUserId, showAuthSheet]);

  return (
    <Pressable
      style={({ pressed }) => [styles.contactButton, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Contacter ${otherUserName}`}
      accessibilityState={{ disabled: isLoading, busy: isLoading }}
      onPress={handlePress}
      disabled={isLoading}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={colors.sage} />
      ) : (
        <>
          <Ionicons name="chatbubble-outline" size={20} color={colors.sage} />
          <Text variant="body" style={styles.contactButtonText}>
            Contacter {otherUserName}
          </Text>
        </>
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  contactButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: sizing.minTouchTarget,
    backgroundColor: colors.surfaceWarm,
    marginHorizontal: spacing.md,
    marginTop: 20,
    paddingVertical: 16,
    borderRadius: radius.xl,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.foreground,
    flexShrink: 1,
    textAlign: 'center',
  },
});
