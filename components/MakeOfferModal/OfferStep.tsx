import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MakeOfferContext } from './types';

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

    if (amount >= currentPrice) {
      Alert.alert(
        'Montant trop élevé',
        'Votre offre doit être inférieure au prix actuel. Utilisez le bouton "Acheter" pour acheter au prix affiché.'
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
        <Text style={styles.currentPrice}>Prix actuel : {currentPrice}€</Text>
      </View>

      <View style={styles.inputSection}>
        <Text style={styles.label}>Votre offre</Text>
        <View style={styles.amountInputContainer}>
          <TextInput
            style={styles.amountInput}
            placeholder="0"
            keyboardType="decimal-pad"
            value={offerAmount}
            onChangeText={actions.setOfferAmount}
            autoFocus
          />
          <Text style={styles.currency}>€</Text>
        </View>
        {discount !== null && (
          <Text style={[styles.discountText, discount > 50 && styles.discountWarning]}>
            {discount}% de réduction
          </Text>
        )}
      </View>

      <View style={styles.inputSection}>
        <Text style={styles.label}>
          Message au vendeur <Text style={styles.optional}>(optionnel)</Text>
        </Text>
        <TextInput
          style={styles.messageInput}
          placeholder="Expliquez pourquoi vous faites cette offre..."
          multiline
          numberOfLines={4}
          value={message}
          onChangeText={actions.setMessage}
          maxLength={500}
          textAlignVertical="top"
        />
        <Text style={styles.characterCount}>{message.length}/500</Text>
      </View>

      <View style={styles.tipsContainer}>
        <Ionicons name="bulb-outline" size={20} color="#34C759" />
        <Text style={styles.tipsText}>
          Vous proposerez ensuite un lieu et une date pour le meetup
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
    marginBottom: 24,
    padding: 16,
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
  },
  articleTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  currentPrice: {
    fontSize: 14,
    color: '#666',
  },
  inputSection: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  optional: {
    fontSize: 14,
    fontWeight: '400',
    color: '#8E8E93',
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 56,
  },
  amountInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  currency: {
    fontSize: 24,
    fontWeight: '700',
    color: '#8E8E93',
    marginLeft: 8,
  },
  discountText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#34C759',
    marginTop: 8,
  },
  discountWarning: {
    color: '#FF9500',
  },
  messageInput: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#1C1C1E',
    minHeight: 100,
  },
  characterCount: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'right',
    marginTop: 4,
  },
  tipsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#FFF9F0',
    borderRadius: 12,
    marginBottom: 24,
  },
  tipsText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
    lineHeight: 20,
  },
  submitButton: {
    backgroundColor: '#F79F24',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 'auto',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default OfferStep;
