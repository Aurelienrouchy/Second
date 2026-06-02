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
import { SHIPPING_ENABLED } from '@/config/featureFlags';

// Counter-offer amount bounds — the upper bound mirrors the server-side ceiling
// enforced in firestore.rules (offer.amount <= 50000). Kept in sync manually.
const MIN_OFFER_AMOUNT = 1;
const MAX_OFFER_AMOUNT = 50000;

import { CounterLocationInput } from './offer-bubble/CounterLocationInput';
import { CounterPriceInput } from './offer-bubble/CounterPriceInput';
import { CounterTimeInput } from './offer-bubble/CounterTimeInput';
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
  /** The article id linked to this chat — used for checkout fallback */
  articleId?: string;
  /** Original listed price of the article (used for context display) */
  articlePrice?: number;
  // Legacy actions
  onAcceptOffer: (messageId: string, offerId: string) => Promise<void>;
  onRejectOffer: (messageId: string, offerId: string) => Promise<void>;
  // New counter-offer actions
  onCounterPrice?: (messageId: string, newAmount: number, message?: string) => Promise<void>;
  onCounterLocation?: (messageId: string, newLocation: MeetupSpot, message?: string) => Promise<void>;
  onCounterTime?: (messageId: string, newDateTime: Date, message?: string) => Promise<void>;
  // Meetup actions
  onConfirmMeetup?: (messageId: string) => Promise<void>;
  onReportNoShow?: (messageId: string, reason?: string, details?: string) => Promise<void>;
  onCompleteMeetup?: (messageId: string) => Promise<void>;
}

const OfferBubble: React.FC<OfferBubbleProps> = ({
  message,
  isOwnMessage,
  chatId,
  currentUserId,
  sellerId,
  articleId,
  articlePrice: listedPrice,
  onAcceptOffer,
  onRejectOffer,
  onCounterPrice,
  onCounterLocation,
  onCounterTime,
  onConfirmMeetup,
  onReportNoShow,
  onCompleteMeetup,
}) => {
  const router = useRouter();
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isCountering, setIsCountering] = useState(false);

  // Counter-offer state — tracks which counter-offer panel is open
  type CounterOfferPanel = 'price' | 'location' | 'time' | null;
  const [activeCounterPanel, setActiveCounterPanel] = useState<CounterOfferPanel>(null);
  const [counterPriceAmount, setCounterPriceAmount] = useState('');
  const [counterLocationName, setCounterLocationName] = useState('');
  const [counterDateTime, setCounterDateTime] = useState('');
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
    if (isNaN(newAmount) || newAmount < MIN_OFFER_AMOUNT) {
      Alert.alert('Erreur', 'Veuillez entrer un montant valide');
      return;
    }

    if (newAmount > MAX_OFFER_AMOUNT) {
      Alert.alert('Montant trop élevé', `Maximum ${MAX_OFFER_AMOUNT} $ CA`);
      return;
    }

    if (!onCounterPrice) return;

    try {
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterPrice(message.id, newAmount, counterMessage || undefined);
      setActiveCounterPanel(null);
      setCounterPriceAmount('');
      setCounterMessage('');
    } catch (error) {
      if (__DEV__) console.error('Error counter offering:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la contre-offre");
    } finally {
      setIsCountering(false);
    }
  };

  const handleCounterLocation = async () => {
    const name = counterLocationName.trim();
    if (!name) {
      Alert.alert('Erreur', 'Veuillez entrer le nom du lieu');
      return;
    }

    if (!onCounterLocation || !meetup) return;

    // Build a new MeetupSpot using the same neighborhood as the original offer
    const newLocation: MeetupSpot = {
      name,
      category: 'other' as MeetupSpot['category'],
      neighborhood: meetup.location.neighborhood,
      isUserSuggested: true,
    };

    try {
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterLocation(message.id, newLocation, counterMessage || undefined);
      setActiveCounterPanel(null);
      setCounterLocationName('');
      setCounterMessage('');
    } catch (error) {
      if (__DEV__) console.error('Error counter-offering location:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la contre-offre de lieu");
    } finally {
      setIsCountering(false);
    }
  };

  const handleCounterTime = async () => {
    const raw = counterDateTime.trim();
    if (!raw) {
      Alert.alert('Erreur', 'Veuillez entrer une date et heure');
      return;
    }

    if (!onCounterTime) return;

    // Parse the documented `AAAA-MM-JJ HH:MM` format explicitly. `new Date(string)`
    // is implementation-defined for non-ISO inputs (engine-dependent, can silently
    // misparse), so we validate the shape and build the Date from numeric parts.
    const parsed = parseMeetupDateTime(raw);
    if (!parsed) {
      Alert.alert(
        'Format invalide',
        'Veuillez entrer une date au format "AAAA-MM-JJ HH:MM" (ex: 2026-06-01 14:30).',
      );
      return;
    }

    if (parsed <= new Date()) {
      Alert.alert('Date passée', 'La date proposée doit être dans le futur.');
      return;
    }

    try {
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterTime(message.id, parsed, counterMessage || undefined);
      setActiveCounterPanel(null);
      setCounterDateTime('');
      setCounterMessage('');
    } catch (error) {
      if (__DEV__) console.error('Error counter-offering time:', error);
      Alert.alert('Erreur', "Impossible d'envoyer la contre-offre d'horaire");
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
              // `reason` doit être une valeur de l'enum backend ; le texte
              // libre va dans `details`.
              await onReportNoShow(
                message.id,
                'other_party_no_show',
                "L'autre personne ne s'est pas présentée au meetup.",
              );
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
  // Buyer can pay when offer is accepted and it's not a meetup. For shipping
  // offers the transaction may not exist yet — the checkout flow creates it.
  // Shipping désactivé : on ne propose pas de payer une offre shipping legacy.
  const canPay =
    isOwnMessage && status === 'accepted' && !isMeetupOffer && (SHIPPING_ENABLED || isMeetupOffer);
  const isSeller = !!sellerId && currentUserId === sellerId;
  const isBuyer = !!sellerId && currentUserId !== sellerId;
  // Seller confirms meetup ("J'ai rencontre l'acheteur") — before confirmedAt is set
  const canConfirmMeetup = isSeller && status === 'accepted' && isMeetupOffer && meetup && !meetup.confirmedAt && !meetup.completedAt;
  // Either party completes the meetup ("La transaction est terminée") — after
  // confirmedAt, before completedAt. Backend `completeMeetupTransaction`
  // accepts buyer OR seller, so we expose the action to both sides.
  const canCompleteMeetup =
    (isBuyer || isSeller) && status === 'accepted' && isMeetupOffer && meetup && !!meetup.confirmedAt && !meetup.completedAt;
  const expiryText = getTimeUntilExpiry(expiresAt, status);

  const handlePayment = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (transactionId) {
      // Transaction already exists — go straight to payment
      router.push(`/payment/${transactionId}`);
    } else if (articleId) {
      // Shipping offer accepted but no transaction yet — start checkout flow.
      // Transmettre le montant négocié (en dollars, comme `amount`) pour que le
      // checkout facture le prix de l'offre acceptée et non le prix affiché.
      router.push({
        pathname: '/checkout' as '/checkout',
        params: { articleId, chatId, negotiatedPrice: String(amount) },
      });
    } else {
      Alert.alert('Erreur', 'Impossible de procéder au paiement');
    }
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
            <Text style={styles.amount}>{formatPrice(amount)}</Text>
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

        {/* Counter-offer Inline Inputs */}
        {activeCounterPanel === 'price' && (
          <CounterPriceInput
            amount={counterPriceAmount}
            message={counterMessage}
            isSubmitting={isCountering}
            onChangeAmount={setCounterPriceAmount}
            onChangeMessage={setCounterMessage}
            onCancel={() => {
              setActiveCounterPanel(null);
              setCounterPriceAmount('');
              setCounterMessage('');
            }}
            onSubmit={handleCounterPrice}
          />
        )}

        {activeCounterPanel === 'location' && (
          <CounterLocationInput
            locationName={counterLocationName}
            message={counterMessage}
            isSubmitting={isCountering}
            onChangeLocationName={setCounterLocationName}
            onChangeMessage={setCounterMessage}
            onCancel={() => {
              setActiveCounterPanel(null);
              setCounterLocationName('');
              setCounterMessage('');
            }}
            onSubmit={handleCounterLocation}
          />
        )}

        {activeCounterPanel === 'time' && (
          <CounterTimeInput
            dateTime={counterDateTime}
            message={counterMessage}
            isSubmitting={isCountering}
            onChangeDateTime={setCounterDateTime}
            onChangeMessage={setCounterMessage}
            onCancel={() => {
              setActiveCounterPanel(null);
              setCounterDateTime('');
              setCounterMessage('');
            }}
            onSubmit={handleCounterTime}
          />
        )}

        {/* Action Buttons */}
        {canRespondToOffer && !activeCounterPanel && (
          <OfferActions
            isAccepting={isAccepting}
            isRejecting={isRejecting}
            showCounterOfferButton={!!onCounterPrice}
            isMeetupOffer={isMeetupOffer}
            onAccept={handleAccept}
            onReject={handleReject}
            onOpenCounterPrice={() => setActiveCounterPanel('price')}
            onCounterLocation={onCounterLocation ? () => setActiveCounterPanel('location') : undefined}
            onCounterTime={onCounterTime ? () => setActiveCounterPanel('time') : undefined}
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
