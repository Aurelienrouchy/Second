import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { MeetupSpot, MeetupSpotCategoryLabels } from '@/types';

import { MakeOfferContext } from './types';

interface ConfirmStepProps {
  context: MakeOfferContext;
  onSubmitMeetup?: (
    amount: number,
    message: string,
    meetupSpot: MeetupSpot
  ) => Promise<void>;
}

const ConfirmStep: React.FC<ConfirmStepProps> = ({ context, onSubmitMeetup }) => {
  const { state, actions, articleTitle, onClose } = context;
  const {
    offerAmount,
    message,
    selectedSpot,
    isSubmitting,
  } = state;

  const handleSubmit = async () => {
    const amount = parseFloat(offerAmount);

    if (!selectedSpot || !onSubmitMeetup) {
      Alert.alert('Erreur', 'Informations manquantes');
      return;
    }

    try {
      actions.setIsSubmitting(true);
      await onSubmitMeetup(amount, message, selectedSpot);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Offre envoyée',
        'Votre offre avec proposition de meetup a été envoyée. Le vendeur peut accepter, refuser ou proposer une contre-offre.'
      );
      onClose();
    } catch (error) {
      console.error('Error submitting meetup offer:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', "Impossible d'envoyer votre offre. Veuillez réessayer.");
    } finally {
      actions.setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Récapitulatif</Text>
      <Text style={styles.subtitle}>
        Vérifiez les détails de votre offre avant envoi
      </Text>

      <View style={styles.summaryContainer}>
        {/* Article and offer */}
        <View style={styles.summarySection}>
          <View style={styles.sectionHeader}>
            <Ionicons name="pricetag" size={20} color="#F79F24" />
            <Text style={styles.sectionLabel}>Votre offre</Text>
          </View>
          <Text style={styles.offerAmount}>{offerAmount}$</Text>
          <Text style={styles.articleTitle}>{articleTitle}</Text>
        </View>

        {message && (
          <View style={styles.messageSection}>
            <Ionicons name="chatbubble-outline" size={16} color="#8E8E93" />
            <Text style={styles.messageText}>"{message}"</Text>
          </View>
        )}

        <View style={styles.divider} />

        {/* Meetup details */}
        <View style={styles.summarySection}>
          <View style={styles.sectionHeader}>
            <Ionicons name="location" size={20} color="#34C759" />
            <Text style={styles.sectionLabel}>Lieu de rencontre</Text>
          </View>
          <Text style={styles.sectionValue}>{selectedSpot?.name}</Text>
          <Text style={styles.sectionSubvalue}>
            {selectedSpot?.category && MeetupSpotCategoryLabels[selectedSpot.category]} •{' '}
            {selectedSpot?.neighborhood.name}
          </Text>
          {selectedSpot?.address && (
            <Text style={styles.sectionAddress}>{selectedSpot.address}</Text>
          )}
        </View>

        <View style={styles.divider} />

        {/* Total */}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Montant à payer</Text>
          <Text style={styles.totalValue}>{offerAmount}$</Text>
        </View>

        <Text style={styles.paymentNote}>
          Le paiement se fera en main propre lors du meetup
        </Text>
      </View>

      {/* Info box */}
      <View style={styles.infoBox}>
        <Ionicons name="information-circle" size={20} color="#007AFF" />
        <View style={styles.infoContent}>
          <Text style={styles.infoTitle}>Comment ça marche?</Text>
          <Text style={styles.infoText}>
            Le vendeur peut accepter, refuser, ou proposer un autre prix ou lieu.
            L'offre expire après 48h sans réponse.
          </Text>
        </View>
      </View>

      {/* Submit button */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="send" size={20} color="#FFFFFF" />
              <Text style={styles.submitButtonText}>Envoyer l'offre</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#8E8E93',
    marginBottom: 24,
  },
  summaryContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  summarySection: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
  },
  sectionValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  sectionSubvalue: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 2,
  },
  sectionAddress: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 4,
  },
  offerAmount: {
    fontSize: 32,
    fontWeight: '700',
    color: '#F79F24',
  },
  articleTitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 4,
  },
  messageSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  messageText: {
    flex: 1,
    fontSize: 14,
    color: '#1C1C1E',
    fontStyle: 'italic',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginVertical: 16,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  totalValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F79F24',
  },
  paymentNote: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 8,
    textAlign: 'center',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: '#E8F4FD',
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    gap: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: '#1C1C1E',
    lineHeight: 18,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 24,
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: '#34C759',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});

export default ConfirmStep;
