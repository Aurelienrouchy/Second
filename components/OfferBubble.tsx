import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import {
  MeetupSpot,
  MeetupSpotCategoryLabels,
  Message,
  MessageOfferWithMeetup,
} from '@/types';
import { colors } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';

import { CounterPriceInput } from './offer-bubble/CounterPriceInput';
import { MeetupActions } from './offer-bubble/MeetupActions';
import { OfferActions } from './offer-bubble/OfferActions';
import { styles } from './offer-bubble/styles';
import { useOfferTransaction } from './offer-bubble/useOfferTransaction';
import {
  formatTime,
  getStatusBgColor,
  getStatusColor,
  getStatusIcon,
  getStatusIconBackground,
  getStatusText,
  getTimeUntilExpiry,
} from './offer-bubble/utils';

interface OfferBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  chatId: string;
  currentUserId: string;
  /** The seller's uid — used to determine roles for meetup actions */
  sellerId?: string;
  /** Original listed price of the article (used for context display) */
  articlePrice?: number;
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
  sellerId,
  articlePrice: listedPrice,
  onAcceptOffer,
  onRejectOffer,
  onCounterPrice,
  onConfirmMeetup,
  onReportNoShow,
  onCompleteMeetup,
}) => {
  const router = useRouter();
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isCountering, setIsCountering] = useState(false);

  // Counter-offer state
  const [showCounterPriceInput, setShowCounterPriceInput] = useState(false);
  const [counterPriceAmount, setCounterPriceAmount] = useState('');
  const [counterMessage, setCounterMessage] = useState('');

  if (!message.offer) return null;

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

  const { transactionId, isLoading: isLoadingTransaction } = useOfferTransaction({
    status,
    isMeetupOffer,
    chatId,
    currentUserId,
  });

  const handleAccept = async () => {
    const confirmMessage = isMeetupOffer
      ? `Voulez-vous accepter cette offre de ${formatPrice(amount)} avec meetup ?`
      : `Voulez-vous accepter cette offre de ${formatPrice(amount)} ?`;

    Alert.alert("Accepter l'offre", confirmMessage, [
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
            if (__DEV__) console.error('Error accepting offer:', error);
            Alert.alert('Erreur', "Impossible d'accepter l'offre");
          } finally {
            setIsAccepting(false);
          }
        },
      },
    ]);
  };

  const handleReject = async () => {
    Alert.alert("Refuser l'offre", `Voulez-vous refuser cette offre de ${formatPrice(amount)} ?`, [
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
            if (__DEV__) console.error('Error rejecting offer:', error);
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

    if (!onCounterPrice) return;

    try {
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterPrice(message.id, newAmount, counterMessage || undefined);
      setShowCounterPriceInput(false);
      setCounterPriceAmount('');
      setCounterMessage('');
    } catch (error) {
      if (__DEV__) console.error('Error counter offering:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la contre-offre");
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
              if (__DEV__) console.error('Error confirming meetup:', error);
              Alert.alert('Erreur', 'Impossible de confirmer le meetup');
            }
          },
        },
      ],
    );
  };

  const handleReportNoShow = async () => {
    if (!onReportNoShow) return;

    Alert.alert(
      'Signaler un no-show',
      "L'autre personne ne s'est pas présentée au meetup ?",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Signaler',
          style: 'destructive',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await onReportNoShow(message.id, "L'autre personne ne s'est pas présentée");
            } catch (error) {
              if (__DEV__) console.error('Error reporting no-show:', error);
              Alert.alert('Erreur', 'Impossible de signaler le no-show');
            }
          },
        },
      ],
    );
  };

  const handleCompleteMeetup = async () => {
    if (!onCompleteMeetup) return;

    Alert.alert(
      'Terminer la transaction',
      'Confirmez-vous que la remise en main propre a bien eu lieu ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Terminer',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await onCompleteMeetup(message.id);
            } catch (error) {
              if (__DEV__) console.error('Error completing meetup:', error);
              Alert.alert('Erreur', 'Impossible de terminer la transaction');
            }
          },
        },
      ],
    );
  };

  const statusColor = getStatusColor(status);
  const canRespondToOffer = !isOwnMessage && status === 'pending';
  const canPay = isOwnMessage && status === 'accepted' && transactionId && !isMeetupOffer;
  const isSeller = !!sellerId && currentUserId === sellerId;
  const isBuyer = !!sellerId && currentUserId !== sellerId;
  // Seller confirms meetup ("J'ai rencontre l'acheteur") — before confirmedAt is set
  const canConfirmMeetup = isSeller && status === 'accepted' && isMeetupOffer && meetup && !meetup.confirmedAt && !meetup.completedAt;
  // Buyer completes meetup ("J'ai bien recu l'article") — after confirmedAt, before completedAt
  const canCompleteMeetup = isBuyer && status === 'accepted' && isMeetupOffer && meetup && !!meetup.confirmedAt && !meetup.completedAt;
  const expiryText = getTimeUntilExpiry(expiresAt, status);

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
          {listedPrice != null && (
            <Text style={styles.amountSubtext}>
              sur un prix affiche de {formatPrice(listedPrice)}
            </Text>
          )}

          {/* Shipping info for legacy offers */}
          {shippingEstimate && !isMeetupOffer && (
            <View style={styles.shippingInfo}>
              <Text style={styles.shippingLabel}>
                Livraison ({shippingEstimate.carrier})
              </Text>
              <Text style={styles.shippingAmount}>
                + {formatPrice(shippingEstimate.amount)}
              </Text>
            </View>
          )}

          {totalAmount && shippingEstimate && !isMeetupOffer && (
            <View style={styles.totalInfo}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmount}>{formatPrice(totalAmount)}</Text>
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
          {expiryText && <Text style={styles.expiryText}>{expiryText}</Text>}
        </View>

        {/* Counter Price Input */}
        {showCounterPriceInput && (
          <CounterPriceInput
            amount={counterPriceAmount}
            message={counterMessage}
            isSubmitting={isCountering}
            onChangeAmount={setCounterPriceAmount}
            onChangeMessage={setCounterMessage}
            onCancel={() => {
              setShowCounterPriceInput(false);
              setCounterPriceAmount('');
              setCounterMessage('');
            }}
            onSubmit={handleCounterPrice}
          />
        )}

        {/* Action Buttons */}
        {canRespondToOffer && !showCounterPriceInput && (
          <OfferActions
            isAccepting={isAccepting}
            isRejecting={isRejecting}
            showCounterOfferButton={!!onCounterPrice}
            onAccept={handleAccept}
            onReject={handleReject}
            onOpenCounterOffer={() => setShowCounterPriceInput(true)}
          />
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

        {/* Meetup Confirmation Actions (seller confirms meetup) */}
        {canConfirmMeetup && (onConfirmMeetup || onReportNoShow) && (
          <MeetupActions
            onConfirm={handleConfirmMeetup}
            onReportNoShow={handleReportNoShow}
          />
        )}

        {/* Meetup Completion Action (buyer completes after seller confirmed) */}
        {canCompleteMeetup && onCompleteMeetup && (
          <MeetupActions
            onConfirm={handleCompleteMeetup}
            onReportNoShow={handleReportNoShow}
          />
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

// Memoised: rendered inside the chat FlashList, where new messages cause
// the parent to re-render frequently. Without memo, every existing offer
// bubble repaints on each new chat message.
export default React.memo(OfferBubble);
