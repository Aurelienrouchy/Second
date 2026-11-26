/**
 * MeetupActions — confirm meetup / report no-show buttons (after acceptance).
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface MeetupActionsProps {
  /**
   * Confirmation de l'étape courante. ABSENT quand la personne ne peut pas
   * confirmer — typiquement l'acheteur avant que le vendeur ait confirmé le
   * rendez-vous. Le bouton n'est alors pas rendu.
   */
  onConfirm?: () => void | Promise<void>;
  /**
   * Signalement d'absence. Les deux boutons sont INDÉPENDANTS : ils étaient
   * rendus en bloc, si bien que le recours n'existait que là où une
   * confirmation était possible. L'acheteur n'avait donc aucun recours tant que
   * le vendeur n'avait pas confirmé, alors que `reportMeetupNoShow` accepte les
   * deux parties sur les deux statuts.
   */
  onReportNoShow?: () => void | Promise<void>;
  /**
   * Libellé du bouton de confirmation. Il était figé à « Confirmer » pour les
   * DEUX étapes, qui ne font pourtant pas la même chose : confirmer un
   * rendez-vous à venir, ou attester une remise déjà faite.
   */
  confirmLabel: string;
}

function MeetupActionsComponent({ onConfirm, onReportNoShow, confirmLabel }: MeetupActionsProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (isProcessing || !onConfirm) return;
    try {
      setIsProcessing(true);
      await onConfirm();
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, onConfirm]);

  const handleNoShow = useCallback(async () => {
    if (isProcessing || !onReportNoShow) return;
    try {
      setIsProcessing(true);
      await onReportNoShow();
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, onReportNoShow]);

  return (
    <View style={styles.meetupActionsSection}>
      <View style={styles.meetupActionsRow}>
        {onReportNoShow && (
        <Pressable
          style={[styles.actionButton, styles.noShowButton, isProcessing && styles.disabledButton]}
          onPress={handleNoShow}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.dangerDark} />
          ) : (
            <>
              <Ionicons name="person-remove" size={16} color={colors.dangerDark} />
              <Text style={styles.noShowButtonText}>Signaler une absence</Text>
            </>
          )}
        </Pressable>
        )}
        {onConfirm && (
        <Pressable
          style={[styles.actionButton, styles.confirmMeetupButton, isProcessing && styles.disabledButton]}
          onPress={handleConfirm}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.foreground} />
          ) : (
            <>
              <Ionicons name="checkmark-done" size={16} color={colors.foreground} />
              <Text style={styles.confirmMeetupText}>{confirmLabel}</Text>
            </>
          )}
        </Pressable>
        )}
      </View>
    </View>
  );
}

export const MeetupActions = React.memo(MeetupActionsComponent);
