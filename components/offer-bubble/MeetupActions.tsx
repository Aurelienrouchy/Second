/**
 * MeetupActions — confirm meetup / report no-show buttons (after acceptance).
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface MeetupActionsProps {
  onConfirm: () => void;
  onReportNoShow: () => void;
}

function MeetupActionsComponent({ onConfirm, onReportNoShow }: MeetupActionsProps) {
  return (
    <View style={styles.meetupActionsSection}>
      <View style={styles.meetupActionsRow}>
        <Pressable
          style={[styles.actionButton, styles.noShowButton]}
          onPress={onReportNoShow}
        >
          <Ionicons name="person-remove" size={16} color={colors.danger} />
          <Text style={styles.noShowButtonText}>No-show</Text>
        </Pressable>
        <Pressable
          style={[styles.actionButton, styles.confirmMeetupButton]}
          onPress={onConfirm}
        >
          <Ionicons name="checkmark-done" size={16} color={colors.white} />
          <Text style={styles.confirmMeetupText}>Confirmer</Text>
        </Pressable>
      </View>
    </View>
  );
}

export const MeetupActions = React.memo(MeetupActionsComponent);
