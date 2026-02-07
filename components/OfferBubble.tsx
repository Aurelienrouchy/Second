import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { TransactionService } from '@/services/transactionService';
import {
  MeetupSpot,
  MeetupSpotCategoryLabels,
  Message,
  MessageOfferWithMeetup,
  OfferStatus,
} from '@/types';

interface OfferBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  chatId: string;
  currentUserId: string;
  // Legacy actions
  onAcceptOffer: (messageId: string, offerId: string) => Promise<void>;
  onRejectOffer: (messageId: string, offerId: string) => Promise<void>;
  // New counter-offer actions
  onCounterPrice?: (messageId: string, newAmount: number, message?: string) => Promise<void>;
  onCounterLocation?: (messageId: string, newLocation: MeetupSpot, message?: string) => Promise<void>;
  // Meetup actions
  onConfirmMeetup?: (messageId: string) => Promise<void>;
  onReportNoShow?: (messageId: string, reason?: string) => Promise<void>;
  onCompleteMeetup?: (messageId: string) => Promise<void>;
}

const OfferBubble: React.FC<OfferBubbleProps> = ({
  message,
  isOwnMessage,
  chatId,
  currentUserId,
  onAcceptOffer,
  onRejectOffer,
  onCounterPrice,
  onCounterLocation,
  onConfirmMeetup,
  onReportNoShow,
  onCompleteMeetup,
}) => {
  const router = useRouter();
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isCountering, setIsCountering] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [isLoadingTransaction, setIsLoadingTransaction] = useState(false);

  // Counter-offer state
  const [showCounterPriceInput, setShowCounterPriceInput] = useState(false);
  const [counterPriceAmount, setCounterPriceAmount] = useState('');
  const [counterMessage, setCounterMessage] = useState('');

  if (!message.offer) return null;

  // Cast to extended offer type with meetup support
  const offer = message.offer as MessageOfferWithMeetup;
  const {
    amount,
    status,
    message: offerMessage,
    shippingEstimate,
    totalAmount,
    meetup,
    expiresAt,
  } = offer;

  const isMeetupOffer = !!meetup;

  // Load transaction if offer is accepted
  useEffect(() => {
    if (status === 'accepted' && !isMeetupOffer) {
      loadTransaction();
    }
  }, [status, isMeetupOffer]);

  const loadTransaction = async () => {
    try {
      setIsLoadingTransaction(true);
      const transaction = await TransactionService.getTransactionByChat(chatId);
      if (transaction) {
        setTransactionId(transaction.id);
      }
    } catch (error) {
      console.error('Error loading transaction:', error);
    } finally {
      setIsLoadingTransaction(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTimeUntilExpiry = (): string | null => {
    if (!expiresAt || status !== 'pending') return null;

    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffMs = expiry.getTime() - now.getTime();

    if (diffMs <= 0) return 'Expirée';

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `Expire dans ${hours}h ${minutes}min`;
    }
    return `Expire dans ${minutes}min`;
  };

  const handleAccept = async () => {
    const confirmMessage = isMeetupOffer
      ? `Voulez-vous accepter cette offre de ${amount}$ avec meetup ?`
      : `Voulez-vous accepter cette offre de ${amount}$ ?`;

    Alert.alert('Accepter l\'offre', confirmMessage, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Accepter',
        style: 'default',
        onPress: async () => {
          try {
            setIsAccepting(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await onAcceptOffer(message.id, message.id);
          } catch (error) {
            console.error('Error accepting offer:', error);
            Alert.alert('Erreur', 'Impossible d\'accepter l\'offre');
          } finally {
            setIsAccepting(false);
          }
        },
      },
    ]);
  };

  const handleReject = async () => {
    Alert.alert('Refuser l\'offre', `Voulez-vous refuser cette offre de ${amount}$ ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Refuser',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsRejecting(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await onRejectOffer(message.id, message.id);
          } catch (error) {
            console.error('Error rejecting offer:', error);
            Alert.alert('Erreur', 'Impossible de refuser l\'offre');
          } finally {
            setIsRejecting(false);
          }
        },
      },
    ]);
  };

  const handleCounterPrice = async () => {
    const newAmount = parseFloat(counterPriceAmount);
    if (isNaN(newAmount) || newAmount <= 0) {
      Alert.alert('Erreur', 'Veuillez entrer un montant valide');
      return;
    }

    if (!onCounterPrice) {
      Alert.alert('Erreur', 'Action non disponible');
      return;
    }

    try {
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterPrice(message.id, newAmount, counterMessage || undefined);
      setShowCounterPriceInput(false);
      setCounterPriceAmount('');
      setCounterMessage('');
    } catch (error) {
      console.error('Error counter offering:', error);
      Alert.alert('Erreur', 'Impossible d\'envoyer la contre-offre');
    } finally {
      setIsCountering(false);
    }
  };

  const handleConfirmMeetup = async () => {
    if (!onConfirmMeetup) return;

    Alert.alert(
      'Confirmer le meetup',
      'Confirmez-vous que le meetup a bien eu lieu et que la transaction est terminée ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await onConfirmMeetup(message.id);
            } catch (error) {
              console.error('Error confirming meetup:', error);
              Alert.alert('Erreur', 'Impossible de confirmer le meetup');
            }
          },
        },
      ]
    );
  };

  const handleReportNoShow = async () => {
    if (!onReportNoShow) return;

    Alert.alert(
      'Signaler un no-show',
      'L\'autre personne ne s\'est pas présentée au meetup ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Signaler',
          style: 'destructive',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await onReportNoShow(message.id, 'L\'autre personne ne s\'est pas présentée');
            } catch (error) {
              console.error('Error reporting no-show:', error);
              Alert.alert('Erreur', 'Impossible de signaler le no-show');
            }
          },
        },
      ]
    );
  };

  const getStatusColor = (s: OfferStatus) => {
    switch (s) {
      case 'accepted':
        return '#34C759';
      case 'rejected':
      case 'expired':
        return '#FF3B30';
      case 'counter_price':
      case 'counter_location':
      case 'counter_time':
        return '#007AFF';
      default:
        return '#F79F24';
    }
  };

  const getStatusIcon = (s: OfferStatus): keyof typeof Ionicons.glyphMap => {
    switch (s) {
      case 'accepted':
        return 'checkmark-circle';
      case 'rejected':
        return 'close-circle';
      case 'expired':
        return 'time-outline';
      case 'counter_price':
        return 'swap-horizontal';
      case 'counter_location':
        return 'location';
      case 'counter_time':
        return 'calendar';
      default:
        return 'cash';
    }
  };

  const getStatusText = (s: OfferStatus) => {
    switch (s) {
      case 'accepted':
        return 'Acceptée';
      case 'rejected':
        return 'Refusée';
      case 'expired':
        return 'Expirée';
      case 'counter_price':
        return 'Contre-offre prix';
      case 'counter_location':
        return 'Autre lieu proposé';
      case 'counter_time':
        return 'Autre horaire proposé';
      default:
        return 'En attente';
    }
  };

  const statusColor = getStatusColor(status);
  const canRespondToOffer = !isOwnMessage && status === 'pending';
  const canPay = isOwnMessage && status === 'accepted' && transactionId && !isMeetupOffer;
  const canConfirmMeetup = status === 'accepted' && isMeetupOffer && meetup && !meetup.completedAt;
  const expiryText = getTimeUntilExpiry();

  const handlePayment = () => {
    if (!transactionId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/payment/${transactionId}`);
  };

  return (
    <View style={[styles.container, isOwnMessage ? styles.ownContainer : styles.otherContainer]}>
      <View style={[styles.offerBubble, { borderColor: statusColor }, status !== 'pending' && styles.completedOfferBubble]}>
        {/* Header */}
        <View style={styles.header}>
          <Ionicons name={getStatusIcon(status)} size={20} color={statusColor} />
          <Text style={[styles.headerText, { color: statusColor }]}>
            {isOwnMessage ? 'Votre offre' : 'Offre reçue'}
          </Text>
          {isMeetupOffer && (
            <View style={styles.meetupBadge}>
              <Ionicons name="people" size={12} color="#007AFF" />
              <Text style={styles.meetupBadgeText}>Meetup</Text>
            </View>
          )}
        </View>

        {/* Amount */}
        <View style={styles.amountContainer}>
          <View style={styles.amountRow}>
            <Text style={styles.amountLabel}>Montant</Text>
            <Text style={styles.amount}>{amount}$</Text>
          </View>

          {/* Shipping info for legacy offers */}
          {shippingEstimate && !isMeetupOffer && (
            <>
              <View style={styles.amountRow}>
                <Text style={styles.amountLabel}>
                  Livraison ({shippingEstimate.carrier})
                </Text>
                <Text style={styles.shippingAmount}>
                  + {shippingEstimate.amount.toFixed(2)}$
                </Text>
              </View>
              {totalAmount && (
                <>
                  <View style={styles.amountDivider} />
                  <View style={styles.amountRow}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalAmount}>{totalAmount.toFixed(2)}$</Text>
                  </View>
                </>
              )}
            </>
          )}
        </View>

        {/* Meetup details */}
        {isMeetupOffer && meetup && (
          <View style={styles.meetupDetails}>
            <View style={styles.meetupRow}>
              <Ionicons name="location" size={16} color="#007AFF" />
              <View style={styles.meetupInfo}>
                <Text style={styles.meetupLocation}>{meetup.location.name}</Text>
                <Text style={styles.meetupSubtext}>
                  {MeetupSpotCategoryLabels[meetup.location.category]} • {meetup.location.neighborhood.name}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Optional message */}
        {offerMessage && (
          <Text style={styles.offerMessage}>"{offerMessage}"</Text>
        )}

        {/* Status badge */}
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>
            {getStatusText(status)}
          </Text>
        </View>

        {/* Expiry warning */}
        {expiryText && (
          <View style={styles.expiryContainer}>
            <Ionicons name="time-outline" size={14} color="#8E8E93" />
            <Text style={styles.expiryText}>{expiryText}</Text>
          </View>
        )}

        {/* Counter price input */}
        {showCounterPriceInput && (
          <View style={styles.counterInputContainer}>
            <Text style={styles.counterInputLabel}>Proposer un autre prix</Text>
            <TextInput
              style={styles.counterInput}
              placeholder="Montant en $"
              keyboardType="numeric"
              value={counterPriceAmount}
              onChangeText={setCounterPriceAmount}
              placeholderTextColor="#8E8E93"
            />
            <TextInput
              style={[styles.counterInput, styles.counterMessageInput]}
              placeholder="Message (optionnel)"
              value={counterMessage}
              onChangeText={setCounterMessage}
              placeholderTextColor="#8E8E93"
              multiline
            />
            <View style={styles.counterButtonsRow}>
              <Pressable
                style={styles.counterCancelButton}
                onPress={() => {
                  setShowCounterPriceInput(false);
                  setCounterPriceAmount('');
                  setCounterMessage('');
                }}
              >
                <Text style={styles.counterCancelText}>Annuler</Text>
              </Pressable>
              <Pressable
                style={[styles.counterSubmitButton, isCountering && styles.buttonDisabled]}
                onPress={handleCounterPrice}
                disabled={isCountering}
              >
                {isCountering ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.counterSubmitText}>Envoyer</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {/* Action buttons (only for receiver and pending offers) */}
        {canRespondToOffer && !showCounterPriceInput && (
          <View style={styles.actionsContainer}>
            <View style={styles.mainActionsRow}>
              <Pressable
                style={[styles.actionButton, styles.rejectButton]}
                onPress={handleReject}
                disabled={isRejecting || isAccepting}
              >
                {isRejecting ? (
                  <ActivityIndicator size="small" color="#FF3B30" />
                ) : (
                  <>
                    <Ionicons name="close" size={18} color="#FF3B30" />
                    <Text style={styles.rejectButtonText}>Refuser</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                style={[styles.actionButton, styles.acceptButton]}
                onPress={handleAccept}
                disabled={isAccepting || isRejecting}
              >
                {isAccepting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                    <Text style={styles.acceptButtonText}>Accepter</Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* Counter-offer button */}
            {onCounterPrice && (
              <Pressable
                style={styles.counterOfferButton}
                onPress={() => setShowCounterPriceInput(true)}
              >
                <Ionicons name="swap-horizontal" size={16} color="#007AFF" />
                <Text style={styles.counterOfferText}>Proposer un autre prix</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Payment button (only for buyer after offer accepted - shipping mode) */}
        {canPay && (
          <Pressable
            style={styles.paymentButton}
            onPress={handlePayment}
            disabled={isLoadingTransaction}
          >
            {isLoadingTransaction ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="card" size={20} color="#FFFFFF" />
                <Text style={styles.paymentButtonText}>Payer maintenant</Text>
              </>
            )}
          </Pressable>
        )}

        {/* Meetup confirmation actions */}
        {canConfirmMeetup && (
          <View style={styles.meetupActionsContainer}>
            <Text style={styles.meetupActionsTitle}>
              Le meetup a eu lieu ?
            </Text>
            <View style={styles.meetupActionsRow}>
              <Pressable
                style={[styles.actionButton, styles.noShowButton]}
                onPress={handleReportNoShow}
              >
                <Ionicons name="person-remove" size={18} color="#FF3B30" />
                <Text style={styles.noShowButtonText}>No-show</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.confirmMeetupButton]}
                onPress={handleConfirmMeetup}
              >
                <Ionicons name="checkmark-done" size={18} color="#FFFFFF" />
                <Text style={styles.confirmMeetupText}>Confirmer</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Meetup completed badge */}
        {isMeetupOffer && meetup?.completedAt && (
          <View style={styles.completedBadge}>
            <Ionicons name="checkmark-done-circle" size={20} color="#34C759" />
            <Text style={styles.completedText}>Transaction terminée</Text>
          </View>
        )}

        {/* Timestamp */}
        <Text style={styles.timestamp}>{formatTime(message.timestamp)}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    paddingHorizontal: 16,
    maxWidth: '90%',
  },
  ownContainer: {
    alignSelf: 'flex-end',
  },
  otherContainer: {
    alignSelf: 'flex-start',
  },
  offerBubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 2,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  completedOfferBubble: {
    opacity: 0.9,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  headerText: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  meetupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F4FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  meetupBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#007AFF',
  },
  amountContainer: {
    marginBottom: 12,
  },
  amountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  amountLabel: {
    fontSize: 14,
    color: '#666',
  },
  amount: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F79F24',
  },
  shippingAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  amountDivider: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginVertical: 6,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  totalAmount: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F79F24',
  },
  meetupDetails: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  meetupRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  meetupInfo: {
    flex: 1,
  },
  meetupLocation: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1C1C1E',
  },
  meetupSubtext: {
    fontSize: 13,
    color: '#8E8E93',
    marginTop: 2,
  },
  offerMessage: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginBottom: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  expiryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  expiryText: {
    fontSize: 12,
    color: '#8E8E93',
  },
  counterInputContainer: {
    backgroundColor: '#F2F2F7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  counterInputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  counterInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#1C1C1E',
    marginBottom: 8,
  },
  counterMessageInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  counterButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  counterCancelButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#E5E5EA',
  },
  counterCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
  },
  counterSubmitButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  counterSubmitText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  actionsContainer: {
    marginTop: 8,
    gap: 8,
  },
  mainActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  acceptButton: {
    backgroundColor: '#34C759',
  },
  acceptButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  rejectButton: {
    backgroundColor: '#FFE5E5',
  },
  rejectButtonText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '700',
  },
  counterOfferButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
  },
  counterOfferText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  paymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#34C759',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
    gap: 8,
  },
  paymentButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  meetupActionsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E5EA',
  },
  meetupActionsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1C1C1E',
    marginBottom: 10,
    textAlign: 'center',
  },
  meetupActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  noShowButton: {
    backgroundColor: '#FFE5E5',
  },
  noShowButtonText: {
    color: '#FF3B30',
    fontSize: 14,
    fontWeight: '700',
  },
  confirmMeetupButton: {
    backgroundColor: '#34C759',
  },
  confirmMeetupText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F9ED',
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 12,
    gap: 8,
  },
  completedText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#34C759',
  },
  timestamp: {
    fontSize: 11,
    color: '#8E8E93',
    textAlign: 'right',
    marginTop: 8,
  },
});

export default OfferBubble;
