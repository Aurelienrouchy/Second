/**
 * OfferActions — accept/reject buttons + optional counter-offer trigger.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface OfferActionsProps {
  isAccepting: boolean;
  isRejecting: boolean;
  showCounterOfferButton: boolean;
  onAccept: () => void;
  onReject: () => void;
  onOpenCounterOffer: () => void;
}

function OfferActionsComponent({
  isAccepting,
  isRejecting,
  showCounterOfferButton,
  onAccept,
  onReject,
  onOpenCounterOffer,
}: OfferActionsProps) {
  return (
    <View style={styles.actionsSection}>
      <View style={styles.mainActionsRow}>
        <Pressable
          style={[styles.actionButton, styles.rejectButton]}
          onPress={onReject}
          disabled={isRejecting || isAccepting}
        >
          {isRejecting ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <>
              <Ionicons name="close" size={16} color={colors.danger} />
              <Text style={styles.rejectButtonText}>Refuser</Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={[styles.actionButton, styles.acceptButton]}
          onPress={onAccept}
          disabled={isAccepting || isRejecting}
        >
          {isAccepting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark" size={16} color={colors.white} />
              <Text style={styles.acceptButtonText}>Accepter</Text>
            </>
          )}
        </Pressable>
      </View>

      {showCounterOfferButton && (
        <Pressable style={styles.counterOfferButton} onPress={onOpenCounterOffer}>
          <Ionicons name="swap-horizontal" size={14} color={colors.primary} />
          <Text style={styles.counterOfferText}>Contre-offre</Text>
        </Pressable>
      )}
    </View>
  );
}

export const OfferActions = React.memo(OfferActionsComponent);
