import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { type RefObject, useCallback } from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';

import type { ReportBottomSheetRef } from '@/components/ReportBottomSheet';
import { track } from '@/lib/analytics';
import { ModerationService } from '@/services/moderationService';
import { formatDisplayName } from '@/utils/formatName';
import type { ChatParticipantInfo } from '../types';

interface UseChatModerationParams {
  otherParticipant: ChatParticipantInfo | null;
  currentUserId: string | undefined;
  reportSheetRef: RefObject<ReportBottomSheetRef | null>;
  onResumeMessageReport?: () => void;
}

export function useChatModeration({
  otherParticipant,
  currentUserId,
  reportSheetRef,
  onResumeMessageReport,
}: UseChatModerationParams) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handleMoreOptions = useCallback(() => {
    if (!otherParticipant || !currentUserId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const options = ['Signaler cet utilisateur', 'Bloquer cet utilisateur', 'Mes signalements', 'Annuler'];
    const destructiveButtonIndex = 1;
    const cancelButtonIndex = 3;

    const handleBlock = async () => {
      try {
        await ModerationService.blockUser(currentUserId, otherParticipant.userId, otherParticipant.userName);
        // La liste des bloqués est lue avec `staleTime: 10 * 60 * 1000` par
        // l'écran de chat ET par la liste des conversations, sur la même clé.
        // Sans invalidation, l'application continuait pendant dix minutes à
        // traiter la personne comme non bloquée : pas de badge « Bloqué » dans
        // la liste, sa conversation toujours comptée dans les pastilles, et la
        // barre de saisie encore active si l'on rouvrait le fil. Le blocage est
        // pourtant déjà appliqué côté serveur — l'app se contredisait elle-même.
        await queryClient.invalidateQueries({ queryKey: ['blockedUsers', currentUserId] });
        track('user_blocked', {
          blocked_user_id: otherParticipant.userId,
          source: 'chat',
          success: true,
        });
        Alert.alert(
          'Utilisateur bloque',
          `${formatDisplayName(otherParticipant.userName)} a ete bloque.`,
        );
        router.back();
      } catch (err: unknown) {
        track('user_blocked', {
          blocked_user_id: otherParticipant.userId,
          source: 'chat',
          success: false,
        });
        const message = err instanceof Error ? err.message : 'Une erreur est survenue';
        Alert.alert('Erreur', message);
      }
    };

    const confirmBlock = () => {
      Alert.alert(
        'Bloquer cet utilisateur',
        `Voulez-vous bloquer ${formatDisplayName(otherParticipant.userName)} ? Cette personne ne pourra plus vous contacter.`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Bloquer', style: 'destructive', onPress: handleBlock },
        ],
      );
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, destructiveButtonIndex, cancelButtonIndex },
        (buttonIndex) => {
          if (buttonIndex === 0) {
            reportSheetRef.current?.open('user', otherParticipant.userId, 'chat');
          } else if (buttonIndex === 1) {
            confirmBlock();
          } else if (buttonIndex === 2) {
            onResumeMessageReport?.();
          }
        },
      );
    } else {
      Alert.alert('Options', undefined, [
        {
          text: 'Signaler cet utilisateur',
          onPress: () => reportSheetRef.current?.open('user', otherParticipant.userId, 'chat'),
        },
        { text: 'Bloquer cet utilisateur', style: 'destructive', onPress: confirmBlock },
        { text: 'Mes signalements', onPress: onResumeMessageReport },
        { text: 'Annuler', style: 'cancel' },
      ]);
    }
  }, [otherParticipant, currentUserId, router, reportSheetRef, queryClient, onResumeMessageReport]);

  return { handleMoreOptions };
}
