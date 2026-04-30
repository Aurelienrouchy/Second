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
import { colors, fonts, radius, spacing } from '@/constants/theme';

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
      const transaction = await TransactionService.getTransactionByChat(
        chatId,
        currentUserId
      );
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
        return colors.success;
      case 'rejected':
      case 'expired':
        return colors.danger;
      case 'counter_price':
      case 'counter_location':
      case 'counter_time':
        return colors.sand;
      default:
        return colors.primary;
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
      <View style={styles.offerBubble}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.statusIcon, { backgroundColor: getStatusIconBackground(status) }]}>
            <Ionicons name={getStatusIcon(status)} size={16} color={statusColor} />
          </View>
          <Text style={styles.headerLabel}>
            {isOwnMessage ? 'VOTRE OFFRE' : 'OFFRE RECUE'}
          </Text>
          {isMeetupOffer && (
            <View style={styles.meetupBadge}>
              <Text style={styles.meetupBadgeText}>Meetup</Text>
            </View>
          )}
        </View>

        {/* Amount Section */}
        <View style={styles.amountSection}>
          <View style={styles.amountDisplay}>
            <Text style={styles.amountPrefix}>$</Text>
            <Text style={styles.amount}>{amount}</Text>
          </View>
          <Text style={styles.amountSubtext}>sur un prix affiche de $XX</Text>

          {/* Shipping info for legacy offers */}
          {shippingEstimate && !isMeetupOffer && (
            <View style={styles.shippingInfo}>
              <Text style={styles.shippingLabel}>
                Livraison ({shippingEstimate.carrier})
              </Text>
              <Text style={styles.shippingAmount}>
                + {shippingEstimate.amount.toFixed(2)}$
              </Text>
            </View>
          )}

          {totalAmount && shippingEstimate && !isMeetupOffer && (
            <View style={styles.totalInfo}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>{totalAmount.toFixed(2)}$</Text>
            </View>
          )}
        </View>

        {/* Meetup Details Card */}
        {isMeetupOffer && meetup && (
          <View style={styles.meetupDetailsCard}>
            <View style={styles.meetupRow}>
              <View style={styles.meetupIconCircle}>
                <Ionicons name="location" size={14} color={colors.primary} />
              </View>
              <View style={styles.meetupContent}>
                <Text style={styles.meetupSpotName}>{meetup.location.name}</Text>
                <Text style={styles.meetupDetail}>
                  {MeetupSpotCategoryLabels[meetup.location.category]} • {meetup.location.neighborhood.name}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Message */}
        {offerMessage && (
          <Text style={styles.offerMessage}>"{offerMessage}"</Text>
        )}

        {/* Status Badge + Expiry */}
        <View style={styles.statusSection}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusBgColor(status) }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {getStatusText(status)}
            </Text>
          </View>
          {expiryText && (
            <Text style={styles.expiryText}>{expiryText}</Text>
          )}
        </View>

        {/* Counter Price Input */}
        {showCounterPriceInput && (
          <View style={styles.counterInputSection}>
            <Text style={styles.counterInputLabel}>PROPOSER UN AUTRE PRIX</Text>
            <TextInput
              style={styles.counterAmountInput}
              placeholder="Montant en $"
              keyboardType="numeric"
              value={counterPriceAmount}
              onChangeText={setCounterPriceAmount}
              placeholderTextColor={colors.muted}
            />
            <TextInput
              style={[styles.counterMessageInput, { minHeight: 60 }]}
              placeholder="Message (optionnel)"
              value={counterMessage}
              onChangeText={setCounterMessage}
              placeholderTextColor={colors.muted}
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
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.counterSubmitText}>Envoyer</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {/* Action Buttons */}
        {canRespondToOffer && !showCounterPriceInput && (
          <View style={styles.actionsSection}>
            <View style={styles.mainActionsRow}>
              <Pressable
                style={[styles.actionButton, styles.rejectButton]}
                onPress={handleReject}
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
                onPress={handleAccept}
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

            {/* Counter-offer button */}
            {onCounterPrice && (
              <Pressable
                style={styles.counterOfferButton}
                onPress={() => setShowCounterPriceInput(true)}
              >
                <Ionicons name="swap-horizontal" size={14} color={colors.primary} />
                <Text style={styles.counterOfferText}>Contre-offre</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Payment Button */}
        {canPay && (
          <Pressable
            style={styles.paymentButton}
            onPress={handlePayment}
            disabled={isLoadingTransaction}
          >
            {isLoadingTransaction ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="card" size={18} color={colors.white} />
                <Text style={styles.paymentButtonText}>Payer maintenant</Text>
              </>
            )}
          </Pressable>
        )}

        {/* Meetup Confirmation Actions */}
        {canConfirmMeetup && (
          <View style={styles.meetupActionsSection}>
            <View style={styles.meetupActionsRow}>
              <Pressable
                style={[styles.actionButton, styles.noShowButton]}
                onPress={handleReportNoShow}
              >
                <Ionicons name="person-remove" size={16} color={colors.danger} />
                <Text style={styles.noShowButtonText}>No-show</Text>
              </Pressable>
              <Pressable
                style={[styles.actionButton, styles.confirmMeetupButton]}
                onPress={handleConfirmMeetup}
              >
                <Ionicons name="checkmark-done" size={16} color={colors.white} />
                <Text style={styles.confirmMeetupText}>Confirmer</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* Meetup Completed Badge */}
        {isMeetupOffer && meetup?.completedAt && (
          <View style={styles.completedBadge}>
            <Ionicons name="checkmark-done-circle" size={18} color={colors.success} />
            <Text style={styles.completedText}>Transaction terminée</Text>
          </View>
        )}

        {/* Timestamp */}
        <Text style={styles.timestamp}>{formatTime(message.timestamp)}</Text>
      </View>
    </View>
  );
};

// Helper function to get status icon background color
const getStatusIconBackground = (status: OfferStatus): string => {
  switch (status) {
    case 'pending':
      return colors.primaryLight;
    case 'accepted':
      return colors.successLight;
    case 'rejected':
    case 'expired':
      return colors.dangerLight;
    case 'counter_price':
    case 'counter_location':
    case 'counter_time':
      return 'rgba(212, 196, 160, 0.12)'; // sand light
    default:
      return colors.primaryLight;
  }
};

// Helper function to get status badge background color
const getStatusBgColor = (status: OfferStatus): string => {
  switch (status) {
    case 'pending':
      return colors.primaryLight;
    case 'accepted':
      return colors.successLight;
    case 'rejected':
    case 'expired':
      return colors.dangerLight;
    case 'counter_price':
    case 'counter_location':
    case 'counter_time':
      return 'rgba(212, 196, 160, 0.12)'; // sand light
    default:
      return colors.primaryLight;
  }
};

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    width: '100%',
    alignSelf: 'stretch',
  },
  ownContainer: {},
  otherContainer: {},
  offerBubble: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  statusIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    fontWeight: '500',
    color: colors.foreground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  meetupBadge: {
    backgroundColor: colors.sageLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  meetupBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.sage,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  // Amount Section
  amountSection: {
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  amountDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  amountPrefix: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 22,
    color: colors.muted,
    marginRight: 4,
  },
  amount: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 36,
    color: colors.charcoal,
  },
  amountSubtext: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.muted,
    marginBottom: spacing.sm,
  },
  shippingInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: spacing.sm,
  },
  shippingLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  shippingAmount: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  totalInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.foreground,
  },
  totalAmount: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.charcoal,
  },

  // Meetup Details Card
  meetupDetailsCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  meetupRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  meetupIconCircle: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  meetupContent: {
    flex: 1,
  },
  meetupSpotName: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  meetupDetail: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
  },

  // Message
  offerMessage: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
    marginBottom: spacing.md,
    lineHeight: 18,
  },

  // Status Section
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.md,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  expiryText: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
  },

  // Counter Input Section
  counterInputSection: {
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  counterInputLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.foreground,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  counterAmountInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  counterMessageInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
    textAlignVertical: 'top',
    marginBottom: spacing.md,
  },
  counterButtonsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  counterCancelButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.border,
  },
  counterCancelText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.muted,
  },
  counterSubmitButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  counterSubmitText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
  },
  buttonDisabled: {
    opacity: 0.6,
  },

  // Actions Section
  actionsSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  mainActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  acceptButton: {
    backgroundColor: colors.sage,
  },
  acceptButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
  },
  rejectButton: {
    backgroundColor: colors.dangerLight,
  },
  rejectButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.danger,
  },
  counterOfferButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.sm,
  },
  counterOfferText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.primary,
  },

  // Payment Button
  paymentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  paymentButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
  },

  // Meetup Actions Section
  meetupActionsSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  meetupActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  noShowButton: {
    backgroundColor: colors.dangerLight,
  },
  noShowButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.danger,
  },
  confirmMeetupButton: {
    backgroundColor: colors.success,
  },
  confirmMeetupText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
  },

  // Completed Badge
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successLight,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  completedText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.success,
  },

  // Timestamp
  timestamp: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.muted,
    textAlign: 'right',
    marginTop: spacing.md,
  },
});

export default OfferBubble;
