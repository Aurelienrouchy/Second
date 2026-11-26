/**
 * SwapContactButton
 * "Contacter" CTA that resolves (or creates) the chat thread with the other
 * participant, then navigates to it with the real chatId.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/ui';
import { colors, sizing } from '@/constants/theme';
import { useAuthenticatedUid } from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
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
  const uid = useAuthenticatedUid();
  const context = useLabelLifecycleContext(`swap-contact:${otherUserId}`, uid);
  const showAuthSheet = useAuthSheetStore((state) => state.show);
  const [isLoading, setIsLoading] = useState(false);
  const loadingRef = useRef(false);

  const handlePress = useCallback(async () => {
    if (!uid) {
      showAuthSheet('Connectez-vous pour contacter ce participant');
      return;
    }
    if (!otherUserId || loadingRef.current) return;
    let operation;
    try {operation = context.capture();} catch {return;}
    loadingRef.current = true;

    setIsLoading(true);
    try {
      const chat = await ChatService.createOrGetChat(
        uid,
        otherUserId,
        undefined,
        {expectedUid: uid, assertCurrent: () => context.assertCurrent(operation)},
      );
      context.assertCurrent(operation);
      track('chat_started', {
        chat_id: chat.id,
        source: 'swap',
        other_user_id: otherUserId,
        is_new_chat: !chat.lastMessage,
        outcome: 'success',
      });
      router.push(`/chat/${chat.id}`);
    } catch (error) {
      if (!context.isCurrent(operation)) return;
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
  }, [uid, otherUserId, showAuthSheet, context]);

  return <Button variant="secondary" accessibilityLabel={`Contacter ${otherUserName}`} loading={isLoading} onPress={() => {void handlePress();}}
    leftIcon={<Ionicons name="chatbubble-outline" size={sizing.iconMD} color={colors.foreground}/>}>Contacter {otherUserName}</Button>;
});
