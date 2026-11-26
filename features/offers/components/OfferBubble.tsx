import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  MeetupSpot,
  MeetupSpotCategoryLabels,
  Message,
  MessageOfferWithMeetup,
} from '@/types';
import { colors, radius, spacing } from '@/constants/theme';
import { APP_LOCALE } from '@/constants/locale';
import { formatMeetupDateTime } from '@/utils/firestoreDate';
import { formatPrice } from '@/utils/formatPrice';

import { CounterLocationInput } from '@/features/offers/components/offer-bubble/CounterLocationInput';
import { CounterPriceInput } from '@/features/offers/components/offer-bubble/CounterPriceInput';
import { CounterTimeInput } from '@/features/offers/components/offer-bubble/CounterTimeInput';
import { OfferActions } from '@/features/offers/components/offer-bubble/OfferActions';
import { styles } from '@/features/offers/components/offer-bubble/styles';
import {formatTime} from './offer-bubble/utils';
import { useCounterOfferDialogs } from '@/features/offers/components/offer-bubble/useCounterOfferDialogs';
import { useOfferResponseDialogs } from '@/features/offers/components/offer-bubble/useOfferResponseDialogs';

export interface OfferBubbleProps {
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
  // Réponse à une offre. `onAcceptOffer` est OPTIONNEL : `withOfferBlockGuard`
  // le retire quand l'interlocuteur est bloqué, et le type le déclarait
  // obligatoire — un mensonge qui masquait le défaut, puisque le bouton
  // « Accepter » restait alors rendu et inerte. `onRejectOffer` reste
  // obligatoire : refuser est une SORTIE, jamais fermée.
  onAcceptOffer?: (messageId: string, offerId: string) => Promise<void>;
  onRejectOffer: (messageId: string, offerId: string) => Promise<void>;
  onShippingOfferAccepted?: (messageId: string) => Promise<void>;
  // New counter-offer actions
  onCounterPrice?: (messageId: string, newAmount: number, message?: string, assertIntention?: () => void) => Promise<void>;
  onCounterLocation?: (messageId: string, newLocation: MeetupSpot, message?: string, assertIntention?: () => void) => Promise<void>;
  onCounterTime?: (messageId: string, newDateTime: Date, message?: string, assertIntention?: () => void) => Promise<void>;
  // Meetup actions
  onConfirmMeetup?: (messageId: string) => Promise<void>;
  onReportNoShow?: (messageId: string, reason?: string, details?: string, expectedDisputeId?: string | null) => Promise<void>;
  onCancelMeetup?: (messageId: string) => Promise<void>;
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
  onShippingOfferAccepted,
  onCounterPrice,
  onCounterLocation,
  onCounterTime,
}) => {
  const router = useRouter();


  const offer = message.offer as MessageOfferWithMeetup | undefined;
  const isMeetupOffer = !!offer?.meetup;

  // Accepter / refuser : deux actions qui partagent leurs verrous et le même
  // patron de dialogue. Cent cinquante-trois lignes de moins ici.
  //
  // Les trois hooks qui suivent étaient appelés APRÈS un `if (!offer) return
  // null` — une violation des règles des hooks que React ne pardonne pas :
  // une bulle rendue avec son offre puis re-rendue sans (le message perd son
  // champ `offer`) rendait alors moins de hooks qu'au tour précédent et React
  // levait « Rendered fewer hooks than expected », ce qui abat tout le fil de
  // conversation, pas seulement la bulle. Ils sont donc appelés
  // inconditionnellement, et la sortie anticipée est déplacée après eux.
  const { isAccepting, isRejecting, handleAccept, handleReject } = useOfferResponseDialogs({
    chatId,
    articleId,
    messageId: message.id,
    amount: offer?.amount ?? 0,
    isMeetupOffer,
    isSeller: !!sellerId && currentUserId === sellerId,
    onAcceptOffer,
    onRejectOffer,
    onAccepted: async () => {
      if (onShippingOfferAccepted) {await onShippingOfferAccepted(message.id); return;}
      if (!articleId || !sellerId || currentUserId === sellerId || isMeetupOffer) return;
      router.push({pathname: '/checkout/shipping', params: {articleId, chatId, offerMessageId: message.id}});
    },
  });

  const {
    isCountering,
    activeCounterPanel,
    setActiveCounterPanel,
    counterPriceAmount,
    setCounterPriceAmount,
    counterLocationName,
    setCounterLocationName,
    counterDateTime,
    setCounterDateTime,
    counterMessage,
    setCounterMessage,
    handleCounterPrice,
    handleCounterLocation,
    handleCounterTime,
  } = useCounterOfferDialogs({
    chatId,
    articleId,
    messageId: message.id,
    amount: offer?.amount ?? 0,
    meetup: offer?.meetup,
    listedPrice,
    onCounterPrice,
    onCounterLocation,
    onCounterTime,
  });

  if (!offer) return null;

  const {
    amount,
    status,
    message: offerMessage,
    shippingEstimate,
    totalAmount,
    meetup,
  } = offer;

  const canRespondToOffer = !isOwnMessage && status === 'pending';
  const meetupDateTimeLabel = meetup?.dateTime ? formatMeetupDateTime(meetup.dateTime, APP_LOCALE) : null;

  return (
    <View style={[styles.container, isOwnMessage ? styles.ownContainer : styles.otherContainer]}>
      <View style={styles.offerBubble}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.statusIcon}>
            <Ionicons name="cash-outline" size={16} color={colors.primary} />
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
                {!meetup.location.toArrange && <Text style={styles.meetupDetail}>
                  {MeetupSpotCategoryLabels[meetup.location.category]} • {meetup.location.neighborhood.name}
                </Text>}
                {/* L'HEURE du rendez-vous — le cœur de l'accord dans une remise
                    en main propre — n'apparaissait nulle part dans la bulle
                    qu'on accepte. Il fallait remonter le fil jusqu'au message
                    système de contre-offre d'horaire pour la retrouver. */}
                {meetupDateTimeLabel && (
                  <Text style={styles.meetupDetail}>{meetupDateTimeLabel}</Text>
                )}
              </View>
            </View>
          </View>
        )}

        {/* Message */}
        {offerMessage && (
          <Text style={styles.offerMessage}>&quot;{offerMessage}&quot;</Text>
        )}

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
            onAccept={onAcceptOffer ? () => {void handleAccept();} : undefined}
            onReject={handleReject}
            onOpenCounterPrice={() => setActiveCounterPanel('price')}
            onCounterLocation={onCounterLocation ? () => setActiveCounterPanel('location') : undefined}
            onCounterTime={onCounterTime ? () => setActiveCounterPanel('time') : undefined}
          />
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
