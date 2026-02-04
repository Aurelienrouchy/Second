import { Ionicons } from '@expo/vector-icons';
import { CardField, useStripe } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { httpsCallable } from '@react-native-firebase/functions';
import { functions } from '@/config/firebaseConfig';

import { useAuth } from '@/contexts/AuthContext';
import { TransactionService } from '@/services/transactionService';
import { Transaction } from '@/types';

export default function PaymentScreen() {
  const { transactionId } = useLocalSearchParams<{ transactionId: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { confirmPayment } = useStripe();

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);

  useEffect(() => {
    loadTransaction();
  }, [transactionId]);

  const loadTransaction = async () => {
    if (!transactionId) return;

    try {
      setIsLoading(true);
      const trans = await TransactionService.getTransaction(transactionId);
      
      if (!trans) {
        Alert.alert('Erreur', 'Transaction introuvable');
        router.back();
        return;
      }

      // Verify user is the buyer
      if (trans.buyerId !== user?.id) {
        Alert.alert('Erreur', 'Vous n\'êtes pas autorisé pour cette transaction');
        router.back();
        return;
      }

      // Check if already paid
      if (trans.status !== 'pending_payment') {
        Alert.alert('Information', 'Cette transaction a déjà été payée');
        router.back();
        return;
      }

      setTransaction(trans);
    } catch (error) {
      console.error('Error loading transaction:', error);
      Alert.alert('Erreur', 'Impossible de charger la transaction');
      router.back();
    } finally {
      setIsLoading(false);
    }
  };

  const handlePayment = async () => {
    if (!transaction || !cardComplete) {
      Alert.alert('Erreur', 'Veuillez remplir toutes les informations de carte');
      return;
    }

    try {
      setIsProcessing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Call Cloud Function to create Payment Intent
      const createPaymentIntent = httpsCallable(functions, 'createPaymentIntent');
      const result = await createPaymentIntent({ transactionId: transaction.id });
      
      const data = result.data as any;
      if (!data.success || !data.clientSecret) {
        throw new Error('Failed to create payment intent');
      }

      // Confirm payment with Stripe
      const { error, paymentIntent } = await confirmPayment(data.clientSecret, {
        paymentMethodType: 'Card',
      });

      if (error) {
        console.error('Payment error:', error);
        Alert.alert('Paiement échoué', error.message);
        return;
      }

      if (paymentIntent?.status === 'Succeeded') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(
          'Paiement réussi !',
          'Votre paiement a été confirmé. L\'étiquette d\'expédition sera générée automatiquement.',
          [
            {
              text: 'OK',
              onPress: () => router.back(),
            },
          ]
        );
      }
    } catch (error: any) {
      console.error('Payment processing error:', error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Erreur', 'Le paiement a échoué. Veuillez réessayer.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F79F24" />
          <Text style={styles.loadingText}>Chargement...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!transaction) {
    return null;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#1C1C1E" />
          </Pressable>
          <Text style={styles.headerTitle}>Paiement</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Order Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Récapitulatif de la commande</Text>
          
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Article</Text>
              <Text style={styles.summaryValue}>{transaction.amount.toFixed(2)}€</Text>
            </View>

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Frais de livraison</Text>
              <Text style={styles.summaryValue}>{transaction.shippingCost.toFixed(2)}€</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.summaryRow}>
              <Text style={styles.totalLabel}>Total à payer</Text>
              <Text style={styles.totalValue}>{transaction.totalAmount.toFixed(2)}€</Text>
            </View>
          </View>
        </View>

        {/* Shipping Address */}
        {transaction.shippingAddress && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Adresse de livraison</Text>
            <View style={styles.addressCard}>
              <Text style={styles.addressText}>{transaction.shippingAddress.name}</Text>
              <Text style={styles.addressText}>{transaction.shippingAddress.street}</Text>
              <Text style={styles.addressText}>
                {transaction.shippingAddress.postalCode} {transaction.shippingAddress.city}
              </Text>
              <Text style={styles.addressText}>{transaction.shippingAddress.country}</Text>
              {transaction.shippingAddress.phoneNumber && (
                <Text style={styles.addressText}>{transaction.shippingAddress.phoneNumber}</Text>
              )}
            </View>
          </View>
        )}

        {/* Payment Method */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informations de paiement</Text>
          
          <View style={styles.cardFieldContainer}>
            <CardField
              postalCodeEnabled={true}
              placeholder={{
                number: '4242 4242 4242 4242',
              }}
              cardStyle={styles.cardField}
              style={styles.cardFieldWrapper}
              onCardChange={(cardDetails) => {
                setCardComplete(cardDetails.complete);
              }}
            />
          </View>

          <View style={styles.secureInfo}>
            <Ionicons name="lock-closed" size={16} color="#34C759" />
            <Text style={styles.secureText}>Paiement 100% sécurisé par Stripe</Text>
          </View>
        </View>

        {/* Payment Button */}
        <Pressable
          style={[
            styles.payButton,
            (!cardComplete || isProcessing) && styles.payButtonDisabled,
          ]}
          onPress={handlePayment}
          disabled={!cardComplete || isProcessing}
        >
          {isProcessing ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="card" size={20} color="#FFFFFF" />
              <Text style={styles.payButtonText}>
                Payer {transaction.totalAmount.toFixed(2)}€
              </Text>
            </>
          )}
        </Pressable>

        <Text style={styles.disclaimer}>
          En confirmant le paiement, vous acceptez nos conditions générales de vente
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F2F7',
  },
  backButton: {
    width: 24,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 12,
  },
  summaryCard: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#666',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginVertical: 8,
  },
  totalLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  totalValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F79F24',
  },
  addressCard: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 16,
  },
  addressText: {
    fontSize: 14,
    color: '#1C1C1E',
    marginBottom: 4,
  },
  cardFieldContainer: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardFieldWrapper: {
    height: 50,
  },
  cardField: {
    backgroundColor: '#FFFFFF',
    textColor: '#1C1C1E',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  secureInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  secureText: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '500',
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#34C759',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 20,
    marginTop: 32,
    gap: 8,
  },
  payButtonDisabled: {
    opacity: 0.5,
  },
  payButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  disclaimer: {
    fontSize: 12,
    color: '#8E8E93',
    textAlign: 'center',
    marginTop: 16,
    marginHorizontal: 20,
    lineHeight: 16,
  },
});

