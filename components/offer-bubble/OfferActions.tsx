/**
 * OfferActions — accept/reject buttons + optional counter-offer trigger.
 *
 * When the offer is a meetup offer, tapping "Contre-offre" shows a menu
 * with 3 choices: price, location, time. For non-meetup offers only the
 * price counter is available.
 */

import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

import { styles } from './styles';

export interface OfferActionsProps {
  isAccepting: boolean;
  isRejecting: boolean;
  showCounterOfferButton: boolean;
  /** Whether the underlying offer includes meetup details (location/time) */
  isMeetupOffer?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onOpenCounterPrice: () => void;
  onCounterLocation?: () => void;
  onCounterTime?: () => void;
}

function OfferActionsComponent({
  isAccepting,
  isRejecting,
  showCounterOfferButton,
  isMeetupOffer,
  onAccept,
  onReject,
  onOpenCounterPrice,
  onCounterLocation,
  onCounterTime,
}: OfferActionsProps) {
  const handleCounterOffer = () => {
    if (!isMeetupOffer) {
      // Non-meetup: go straight to price counter
      onOpenCounterPrice();
      return;
    }

    // Meetup offer: show a choice between price, location, and time
    const buttons: Array<{ text: string; onPress: () => void; style?: 'cancel' | 'destructive' | 'default' }> = [
      { text: 'Modifier le prix', onPress: onOpenCounterPrice },
    ];

    if (onCounterLocation) {
      buttons.push({ text: 'Proposer un autre lieu', onPress: onCounterLocation });
    }

    if (onCounterTime) {
      buttons.push({ text: 'Proposer un autre horaire', onPress: onCounterTime });
    }

    buttons.push({ text: 'Annuler', onPress: () => {}, style: 'cancel' });

    Alert.alert('Type de contre-offre', 'Que souhaitez-vous modifier ?', buttons);
  };

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
        <Pressable style={styles.counterOfferButton} onPress={handleCounterOffer}>
          <Ionicons name="swap-horizontal" size={14} color={colors.primary} />
          <Text style={styles.counterOfferText}>Contre-offre</Text>
        </Pressable>
      )}
    </View>
  );
}

export const OfferActions = React.memo(OfferActionsComponent);
