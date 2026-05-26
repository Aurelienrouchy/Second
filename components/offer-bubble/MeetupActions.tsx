/**
 * MeetupActions — confirm meetup / report no-show buttons (after acceptance).
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface MeetupActionsProps {
  onConfirm: () => void | Promise<void>;
  onReportNoShow: () => void | Promise<void>;
}

function MeetupActionsComponent({ onConfirm, onReportNoShow }: MeetupActionsProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (isProcessing) return;
    try {
      setIsProcessing(true);
      await onConfirm();
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, onConfirm]);

  const handleNoShow = useCallback(async () => {
    if (isProcessing) return;
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
        <Pressable
          style={[styles.actionButton, styles.noShowButton, isProcessing && styles.disabledButton]}
          onPress={handleNoShow}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <>
              <Ionicons name="person-remove" size={16} color={colors.danger} />
              <Text style={styles.noShowButtonText}>Signaler une absence</Text>
            </>
          )}
        </Pressable>
        <Pressable
          style={[styles.actionButton, styles.confirmMeetupButton, isProcessing && styles.disabledButton]}
          onPress={handleConfirm}
          disabled={isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark-done" size={16} color={colors.white} />
              <Text style={styles.confirmMeetupText}>Confirmer</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export const MeetupActions = React.memo(MeetupActionsComponent);
