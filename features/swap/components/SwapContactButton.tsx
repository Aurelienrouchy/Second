/**
 * SwapContactButton
 * "Contacter" CTA that resolves (or creates) the chat thread with the other
 * participant, then navigates to it with the real chatId.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import { colors, fonts } from '@/constants/theme';
import { useUser } from '@/contexts/AuthContext';
import { useAuthSheetStore } from '@/store/authSheetStore';
import { ChatService } from '@/services/chatService';

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

  const handlePress = useCallback(async () => {
    if (!currentUser?.id) {
      showAuthSheet('Connectez-vous pour contacter ce participant');
      return;
    }
    if (!otherUserId) return;

    setIsLoading(true);
    try {
      const chat = await ChatService.createOrGetChat(currentUser.id, otherUserId);
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      if (__DEV__) console.error('Error creating chat:', error);
      Alert.alert('Erreur', 'Impossible de démarrer la conversation.');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.id, otherUserId, showAuthSheet]);

  return (
    <Pressable
      style={({ pressed }) => [styles.contactButton, pressed && { opacity: 0.7 }]}
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
