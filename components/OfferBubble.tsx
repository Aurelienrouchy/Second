import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  MeetupSpot,
  MeetupSpotCategoryLabels,
  Message,
  MessageOfferWithMeetup,
} from '@/types';
import { colors, radius, spacing } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/utils/formatPrice';
import { SHIPPING_ENABLED } from '@/config/featureFlags';

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

// Counter-offer amount bounds — the upper bound mirrors the server-side ceiling
// enforced in firestore.rules (offer.amount <= 50000). Kept in sync manually.
const MIN_OFFER_AMOUNT = 1;
const MAX_OFFER_AMOUNT = 50000;

// Strict parse of the `AAAA-MM-JJ HH:MM` meetup format (local time). Returns a
// valid Date or null — avoids the engine-dependent behaviour of `new Date(str)`
// for non-ISO inputs. Rejects out-of-range / overflowing components.
const MEETUP_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

// Extracts a low-cardinality error code (FirebaseError.code) for analytics —
// never the raw FR message (cardinality/PII rule).
function errCode(error: unknown): string | undefined {
  const code = (error as { code?: string })?.code;
  return typeof code === 'string' ? code : undefined;
}

function parseMeetupDateTime(raw: string): Date | null {
  const match = MEETUP_DATETIME_RE.exec(raw);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // Guard against overflow normalisation (e.g. 2026-02-31 -> March).
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date;
}

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
  /** Avatar (photo URL) of the other participant — shown on received offers */
  otherAvatar?: string;
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
  otherAvatar,
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

    const role: 'buyer' | 'seller' = isSeller ? 'seller' : 'buyer';
    Alert.alert("Accepter l'offre", confirmMessage, [
      {
        text: 'Annuler',
        style: 'cancel',
        onPress: () =>
          track('offer_responded', {
            chat_id: chatId,
            message_id: message.id,
            article_id: articleId ?? '',
            action: 'accept',
            dialog_outcome: 'cancelled',
            offer_amount_cents: Math.round(amount * 100),
            is_meetup_offer: isMeetupOffer,
            role,
          }),
      },
      {
        text: 'Accepter',
        style: 'default',
        onPress: async () => {
          try {
            setIsAccepting(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await onAcceptOffer(message.id, message.id);
            track('offer_responded', {
              chat_id: chatId,
              message_id: message.id,
              article_id: articleId ?? '',
              action: 'accept',
              dialog_outcome: 'confirmed',
              result: 'success',
              offer_amount_cents: Math.round(amount * 100),
              is_meetup_offer: isMeetupOffer,
              role,
            });
          } catch (error) {
            if (__DEV__) console.error('Error accepting offer:', error);
            // Surface the server reason (FirebaseError message) so a genuine
            // failure is actionable instead of an opaque generic alert.
            const msg = error instanceof Error ? error.message : "Impossible d'accepter l'offre";
            track('offer_responded', {
              chat_id: chatId,
              message_id: message.id,
              article_id: articleId ?? '',
              action: 'accept',
              dialog_outcome: 'confirmed',
              result: 'error',
              error_code: errCode(error),
              offer_amount_cents: Math.round(amount * 100),
              is_meetup_offer: isMeetupOffer,
              role,
            });
            Alert.alert('Erreur', msg);
          } finally {
            setIsAccepting(false);
          }
        },
      },
    ]);
  };

  const handleReject = async () => {
    const role: 'buyer' | 'seller' = isSeller ? 'seller' : 'buyer';
    Alert.alert("Refuser l'offre", `Voulez-vous refuser cette offre de ${formatPrice(amount)} ?`, [
      {
        text: 'Annuler',
        style: 'cancel',
        onPress: () =>
          track('offer_responded', {
            chat_id: chatId,
            message_id: message.id,
            article_id: articleId ?? '',
            action: 'reject',
            dialog_outcome: 'cancelled',
            offer_amount_cents: Math.round(amount * 100),
            is_meetup_offer: isMeetupOffer,
            role,
          }),
      },
      {
        text: 'Refuser',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsRejecting(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await onRejectOffer(message.id, message.id);
            track('offer_responded', {
              chat_id: chatId,
              message_id: message.id,
              article_id: articleId ?? '',
              action: 'reject',
              dialog_outcome: 'confirmed',
              result: 'success',
              offer_amount_cents: Math.round(amount * 100),
              is_meetup_offer: isMeetupOffer,
              role,
            });
          } catch (error) {
            if (__DEV__) console.error('Error rejecting offer:', error);
            track('offer_responded', {
              chat_id: chatId,
              message_id: message.id,
              article_id: articleId ?? '',
              action: 'reject',
              dialog_outcome: 'confirmed',
              result: 'error',
              error_code: errCode(error),
              offer_amount_cents: Math.round(amount * 100),
              is_meetup_offer: isMeetupOffer,
              role,
            });
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
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'price',
        original_amount_cents: Math.round(amount * 100),
        validation_result: 'invalid',
        success: false,
      });
      Alert.alert('Erreur', 'Veuillez entrer un montant valide');
      return;
    }

    if (newAmount > MAX_OFFER_AMOUNT) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'price',
        original_amount_cents: Math.round(amount * 100),
        new_amount_cents: Math.round(newAmount * 100),
        validation_result: 'too_high',
        success: false,
      });
      Alert.alert('Montant trop élevé', `Maximum ${MAX_OFFER_AMOUNT} $ CA`);
      return;
    }

    if (!onCounterPrice) return;

    try {
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterPrice(message.id, newAmount, counterMessage || undefined);
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'price',
        original_amount_cents: Math.round(amount * 100),
        new_amount_cents: Math.round(newAmount * 100),
        validation_result: 'ok',
        success: true,
      });
      setActiveCounterPanel(null);
      setCounterPriceAmount('');
      setCounterMessage('');
    } catch (error) {
      if (__DEV__) console.error('Error counter offering:', error);
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'price',
        original_amount_cents: Math.round(amount * 100),
        new_amount_cents: Math.round(newAmount * 100),
        validation_result: 'ok',
        success: false,
      });
      Alert.alert('Erreur', "Impossible d'envoyer la contre-offre");
    } finally {
      setIsCountering(false);
    }
  };

  const handleCounterLocation = async () => {
    const name = counterLocationName.trim();
    if (!name) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'location',
        validation_result: 'empty',
        success: false,
      });
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
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'location',
        neighborhood_id: meetup.location.neighborhood?.id,
        validation_result: 'ok',
        success: true,
      });
      setActiveCounterPanel(null);
      setCounterLocationName('');
      setCounterMessage('');
    } catch (error) {
      if (__DEV__) console.error('Error counter-offering location:', error);
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'location',
        neighborhood_id: meetup.location.neighborhood?.id,
        validation_result: 'ok',
        success: false,
      });
      Alert.alert('Erreur', "Impossible d'envoyer la contre-offre de lieu");
    } finally {
      setIsCountering(false);
    }
  };

  const handleCounterTime = async () => {
    const raw = counterDateTime.trim();
    if (!raw) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        validation_result: 'empty',
        success: false,
      });
      Alert.alert('Erreur', 'Veuillez entrer une date et heure');
      return;
    }

    if (!onCounterTime) return;

    // Parse the documented `AAAA-MM-JJ HH:MM` format explicitly. `new Date(string)`
    // is implementation-defined for non-ISO inputs (engine-dependent, can silently
    // misparse), so we validate the shape and build the Date from numeric parts.
    const parsed = parseMeetupDateTime(raw);
    if (!parsed) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        validation_result: 'bad_format',
        success: false,
      });
      Alert.alert(
        'Format invalide',
        'Veuillez entrer une date au format "AAAA-MM-JJ HH:MM" (ex: 2026-06-01 14:30).',
      );
      return;
    }

    if (parsed <= new Date()) {
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        validation_result: 'past_date',
        success: false,
      });
      Alert.alert('Date passée', 'La date proposée doit être dans le futur.');
      return;
    }

    const hoursUntilMeetup = Math.round((parsed.getTime() - Date.now()) / 3600000);

    try {
      setIsCountering(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await onCounterTime(message.id, parsed, counterMessage || undefined);
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        hours_until_meetup: hoursUntilMeetup,
        validation_result: 'ok',
        success: true,
      });
      setActiveCounterPanel(null);
      setCounterDateTime('');
      setCounterMessage('');
    } catch (error) {
      if (__DEV__) console.error('Error counter-offering time:', error);
      track('offer_countered', {
        chat_id: chatId,
        article_id: articleId ?? '',
        counter_type: 'time',
        hours_until_meetup: hoursUntilMeetup,
        validation_result: 'ok',
        success: false,
      });
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
      'Signaler une absence',
      "L'autre personne ne s'est pas présentée à la rencontre ? Vous pouvez la signaler.",
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
                "L'autre personne ne s'est pas présentée à la rencontre.",
              );
            } catch (error) {
              if (__DEV__) console.error('Error reporting no-show:', error);
              Alert.alert('Erreur', "Impossible de signaler l'absence");
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
              // B2 : la callable peut échouer si la transaction a été annulée
              // (auto-annulation 7j) ou disputée entre-temps. On surface le
              // message FR du service plutôt qu'un générique, et on ne marque
              // jamais le message « terminée » côté UI tant que le backend n'a
              // pas confirmé (le badge dépend de meetup.completedAt, écrit
              // seulement après succès).
              const message =
                error instanceof Error && error.message
                  ? error.message
                  : 'Impossible de terminer la transaction. Réessayez ou contactez le support.';
              Alert.alert('Transaction non finalisée', message);
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
          {!isOwnMessage && otherAvatar && (
            <Image
              source={{ uri: otherAvatar }}
              style={avatarStyles.otherAvatar}
              contentFit="cover"
            />
          )}
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

// 28x28 avatar slot for received offers — matches the status icon size in
// styles.ts (spacing.lg + spacing.xs = 28) to align with the header rhythm.
const avatarStyles = StyleSheet.create({
  otherAvatar: {
    width: spacing.lg + spacing.xs,
    height: spacing.lg + spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceWarm,
    flexShrink: 0,
  },
});

// Memoised: rendered inside the chat FlashList, where new messages cause
// the parent to re-render frequently. Without memo, every existing offer
// bubble repaints on each new chat message.
export default React.memo(OfferBubble);
