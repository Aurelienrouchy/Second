import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

import { MakeOfferContext } from './types';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

interface OfferStepProps {
  context: MakeOfferContext;
}

const OfferStep: React.FC<OfferStepProps> = ({ context }) => {
  const { state, actions, articleTitle, currentPrice } = context;
  const { offerAmount, message } = state;

  const calculateDiscount = () => {
    const amount = parseFloat(offerAmount);
    if (!amount || amount <= 0) return null;
    const discount = ((currentPrice - amount) / currentPrice) * 100;
    return Math.round(discount);
  };

  const handleNext = () => {
    const amount = parseFloat(offerAmount);

    if (!amount || amount <= 0) {
      Alert.alert('Erreur', 'Veuillez entrer un montant valide');
      return;
    }

    if (amount > currentPrice) {
      Alert.alert(
        'Montant trop élevé',
        'Votre offre ne peut pas dépasser le prix affiché.'
      );
      return;
    }

    if (amount < currentPrice * 0.3) {
      Alert.alert(
        'Offre trop basse',
        'Votre offre semble trop basse. Le vendeur sera plus enclin à accepter une offre raisonnable.',
        [
          { text: 'Modifier', style: 'cancel' },
          {
            text: 'Continuer quand même',
            onPress: () => {
              actions.setMode('meetup');
              actions.setStep('location');
            },
          },
        ]
      );
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    actions.setMode('meetup');
    actions.setStep('location');
  };

  const discount = calculateDiscount();

  return (
    <>
      <View style={styles.articleInfo}>
        <Text style={styles.articleTitle} numberOfLines={2}>
          {articleTitle}
        </Text>
        <Text style={styles.currentPrice}>
          Prix affiché : <Text style={styles.priceValue}>{formatPrice(currentPrice)}</Text>
        </Text>
      </View>

      <View style={styles.inputSection}>
        <Text style={styles.label}>VOTRE OFFRE</Text>
        <View style={styles.amountInputContainer}>
          <BottomSheetTextInput
            style={styles.amountInput}
            placeholder="0"
            keyboardType="decimal-pad"
            value={offerAmount}
            onChangeText={actions.setOfferAmount}
          />
          <Text style={styles.currencySuffix}>{' '}$</Text>
        </View>
        {discount !== null && discount > 0 && (
          <Text style={[styles.discountText, discount > 50 && styles.discountWarning]}>
            {discount}% de réduction
          </Text>
        )}
      </View>

      <View style={styles.inputSection}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>MESSAGE AU VENDEUR</Text>
          <Text style={styles.optionalLabel}>(optionnel)</Text>
        </View>
        <BottomSheetTextInput
          style={styles.messageInput}
          placeholder="Expliquez pourquoi vous faites cette offre..."
          multiline
          numberOfLines={4}
          value={message}
          onChangeText={actions.setMessage}
          maxLength={500}
          textAlignVertical="top"
          placeholderTextColor={colors.muted}
        />
        <Text style={styles.characterCount}>{message.length}/500</Text>
      </View>

      <View style={styles.tipBox}>
        <View style={styles.tipIconContainer}>
          <Ionicons name="information-circle" size={18} color={colors.sage} />
        </View>
        <Text style={styles.tipText}>
          Vous proposerez ensuite un lieu de rencontre
        </Text>
      </View>

      <Pressable style={styles.submitButton} onPress={handleNext}>
        <Text style={styles.submitButtonText}>Continuer</Text>
      </Pressable>
    </>
  );
};

const styles = StyleSheet.create({
  articleInfo: {
    marginBottom: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  articleTitle: {
    fontSize: 16,
    fontFamily: fonts.displayMedium,
    color: colors.charcoal,
    marginBottom: spacing.sm,
  },
  currentPrice: {
    fontSize: 15,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
  },
  priceValue: {
    fontFamily: fonts.sansBold,
    fontSize: 15,
  },
  inputSection: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: 9,
    fontFamily: fonts.sansMedium,
    color: colors.charcoal,
    marginBottom: spacing.sm,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  optionalLabel: {
    fontSize: 10,
    fontFamily: fonts.sans,
    color: colors.charcoal,
    marginLeft: spacing.xs,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    height: 60,
  },
  currencySuffix: {
    fontSize: 18,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
    marginLeft: spacing.sm,
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontFamily: fonts.sansBold,
    color: colors.charcoal,
  },
  discountText: {
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.sage,
    marginTop: spacing.sm,
  },
  discountWarning: {
    color: '#FF9500',
  },
  messageInput: {
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    fontSize: 13,
    fontFamily: fonts.sans,
    color: colors.charcoal,
    minHeight: 100,
  },
  characterCount: {
    fontSize: 10,
    fontFamily: fonts.sans,
    color: colors.muted,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  tipBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  tipIconContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  tipText: {
    flex: 1,
    fontSize: 11,
    fontFamily: fonts.sans,
    color: colors.muted,
    lineHeight: 16,
  },
  submitButton: {
    backgroundColor: colors.charcoal,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  submitButtonText: {
    color: colors.cream,
    fontSize: 11,
    fontFamily: fonts.sansMedium,
    letterSpacing: 2.16,
    textTransform: 'uppercase',
  },
});

export default OfferStep;
