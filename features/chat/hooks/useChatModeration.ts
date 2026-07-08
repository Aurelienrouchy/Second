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
}

export function useChatModeration({
  otherParticipant,
  currentUserId,
  reportSheetRef,
}: UseChatModerationParams) {
  const router = useRouter();

  const handleMoreOptions = useCallback(() => {
    if (!otherParticipant || !currentUserId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const options = ['Signaler cet utilisateur', 'Bloquer cet utilisateur', 'Annuler'];
    const destructiveButtonIndex = 1;
    const cancelButtonIndex = 2;

    const handleBlock = async () => {
      try {
        await ModerationService.blockUser(currentUserId, otherParticipant.userId, otherParticipant.userName);
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
            reportSheetRef.current?.open('user', otherParticipant.userId);
          } else if (buttonIndex === 1) {
            confirmBlock();
          }
        },
      );
    } else {
      Alert.alert('Options', undefined, [
        {
          text: 'Signaler cet utilisateur',
          onPress: () => reportSheetRef.current?.open('user', otherParticipant.userId),
        },
        { text: 'Bloquer cet utilisateur', style: 'destructive', onPress: confirmBlock },
        { text: 'Annuler', style: 'cancel' },
      ]);
    }
  }, [otherParticipant, currentUserId, router, reportSheetRef]);

  return { handleMoreOptions };
}
