import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { MeetupSpot, MeetupSpotCategoryLabels } from '@/types';

import { MakeOfferContext } from './types';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

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
      if (__DEV__) console.error('Error submitting meetup offer:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', "Impossible d'envoyer votre offre. Veuillez réessayer.");
    } finally {
      actions.setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>RÉCAPITULATIF</Text>

      <View style={styles.summaryContainer}>
        <View style={styles.summarySection}>
          <View style={styles.sectionHeader}>
            <View style={styles.headerIconContainer}>
              <Ionicons name="pricetag" size={16} color={colors.rust} />
            </View>
            <Text style={styles.sectionTitle}>VOTRE OFFRE</Text>
          </View>
          <Text style={styles.offerAmount}>{formatPrice(Number(offerAmount))}</Text>
          <Text style={styles.articleTitle}>{articleTitle}</Text>
        </View>

        {message && (
          <>
            <View style={styles.divider} />
            <View style={styles.messageSection}>
              <Text style={styles.messageText}>"{message}"</Text>
            </View>
          </>
        )}

        <View style={styles.divider} />

        <View style={styles.summarySection}>
          <View style={styles.sectionHeader}>
            <View style={[styles.headerIconContainer, { backgroundColor: colors.sageLight }]}>
              <Ionicons name="location" size={16} color={colors.sage} />
            </View>
            <Text style={styles.sectionTitle}>LIEU DE RENCONTRE</Text>
          </View>
          <Text style={styles.spotName}>{selectedSpot?.name}</Text>
          <Text style={styles.spotDetails}>
            {selectedSpot?.category && MeetupSpotCategoryLabels[selectedSpot.category]} •{' '}
            {selectedSpot?.neighborhood.name}
          </Text>
          {selectedSpot?.address && (
            <Text style={styles.spotAddress}>{selectedSpot.address}</Text>
          )}
        </View>

        <View style={styles.divider} />

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>MONTANT À PAYER</Text>
          <Text style={styles.totalValue}>{formatPrice(Number(offerAmount))}</Text>
        </View>

        <Text style={styles.paymentNote}>
          Aucun frais de service — paiement en main propre lors du meetup
        </Text>
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="information-circle" size={16} color={colors.sage} />
        <View style={styles.infoContent}>
          <Text style={styles.infoTitle}>Comment ça marche?</Text>
          <Text style={styles.infoText}>
            Le vendeur peut accepter, refuser, ou proposer un autre prix ou lieu.
            L'offre expire après 48h sans réponse.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Pressable
          style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color={colors.cream} />
          ) : (
            <>
              <Ionicons name="arrow-forward" size={16} color={colors.cream} />
              <Text style={styles.submitButtonText}>ENVOYER L'OFFRE</Text>
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
  sectionLabel: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
    letterSpacing: 1.5,
    marginBottom: spacing.md,
    textTransform: 'uppercase',
  },
  summaryContainer: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    marginBottom: spacing.lg,
  },
  summarySection: {
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  headerIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  offerAmount: {
    fontSize: 36,
    fontFamily: fonts.sansBold,
    color: colors.charcoal,
  },
  articleTitle: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
    marginTop: spacing.sm,
  },
  messageSection: {
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginVertical: spacing.md,
  },
  messageText: {
    fontSize: 12,
    fontFamily: fonts.sans,
    fontStyle: 'italic',
    color: colors.charcoal,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  spotName: {
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  spotDetails: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
  },
  spotAddress: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
    marginTop: spacing.xs,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  totalLabel: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
  },
  totalValue: {
    fontSize: 22,
    fontFamily: fonts.sansBold,
    color: colors.charcoal,
  },
  paymentNote: {
    fontSize: 10,
    fontFamily: fonts.sans,
    color: colors.muted,
    textAlign: 'center',
  },
  infoBox: {
    flexDirection: 'row',
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 11,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
    marginBottom: spacing.xs,
  },
  infoText: {
    fontSize: 10,
    fontFamily: fonts.sans,
    color: colors.muted,
    lineHeight: 14,
  },
  footer: {
    marginTop: 'auto',
    paddingTop: spacing.lg,
  },
  submitButton: {
    flexDirection: 'row',
    backgroundColor: colors.charcoal,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.cream,
    fontSize: 11,
    fontFamily: fonts.sansMedium,
    letterSpacing: 2.16,
    textTransform: 'uppercase',
  },
});

export default ConfirmStep;
