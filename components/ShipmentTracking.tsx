/**
 * ShipmentTracking — shipping timeline + buyer recourse entry points.
 * Design System: Editorial Luxe — all tokens from constants/theme.
 *
 * Distinguishes `label_created` (label bought, before first carrier scan) from
 * `shipped` (in transit). Surfaces buyer recourse on `delivery_failed` / `lost`
 * and a return-request entry once delivered.
 */

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { httpsCallable } from 'firebase/functions';
import { useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { functions } from '@/config/firebaseConfig';
import {
  RecourseReasonSheet,
  RecourseReasonSheetRef,
  RecourseReasonOption,
} from '@/components/RecourseReasonSheet';
import { Transaction } from '@/types';
import { APP_LOCALE } from '@/constants/locale';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { useAuthStore, selectUser } from '@/store/authStore';
import { getStatusDescription, fillFundsReleaseAt } from '@/lib/transactionStatusMeta';
import {
  useTransactionRecourse,
  isFailedPrecondition,
  getRecourseErrorMessage,
  ReportReasonCode,
  ReturnReasonCode,
} from '@/hooks/useTransactionRecourse';

interface ShipmentTrackingProps {
  transaction: Transaction;
  onStatusUpdate?: () => void;
}

interface CarrierStatusInfo {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  label: string;
  description: string;
}

/** Maps the ShipEngine carrier tracking code to a DS-tokenized presentation. */
function getCarrierStatusInfo(
  transaction: Transaction,
): CarrierStatusInfo {
  switch (transaction.trackingStatus) {
    case 'TRANSIT':
    case 'IN_TRANSIT':
      return {
        icon: 'airplane',
        color: colors.primary,
        label: 'En transit',
        description: transaction.carrierCode
          ? `Votre colis est en cours d'acheminement via ${transaction.carrierCode}`
          : "Votre colis est en cours d'acheminement",
      };
    case 'OUT_FOR_DELIVERY':
      return {
        icon: 'car',
        color: colors.warning,
        label: 'En cours de livraison',
        description: "Votre colis est en livraison aujourd'hui",
      };
    case 'DELIVERED':
      return {
        icon: 'checkmark-circle',
        color: colors.success,
        label: 'Livré',
        description: 'Votre colis a été livré avec succès',
      };
    case 'FAILURE':
    case 'RETURNED':
      return {
        icon: 'alert-circle',
        color: colors.danger,
        label: 'Problème de livraison',
        description: 'Un problème est survenu avec la livraison',
      };
    default:
      // No carrier scan yet — distinguish "label created" from "preparing".
      if (transaction.status === 'label_created') {
        return {
          icon: 'pricetag',
          color: colors.primary,
          label: 'Étiquette créée',
          description: "L'étiquette est prête, le colis va être déposé chez le transporteur",
        };
      }
      return {
        icon: 'cube',
        color: colors.muted,
        label: 'En préparation',
        description: 'Le vendeur prépare votre colis',
      };
  }
}

/** "Signaler un problème" options → backend report reason codes. */
const REPORT_REASON_OPTIONS: ReadonlyArray<RecourseReasonOption<ReportReasonCode>> = [
  { code: 'not_received_despite_delivered', label: 'Colis non reçu' },
  { code: 'not_as_described', label: 'Article non conforme à l’annonce' },
  { code: 'damaged', label: 'Article endommagé' },
  { code: 'other', label: 'Autre' },
];

/** "Demander un retour" options → backend return reason codes. */
const RETURN_REASON_OPTIONS: ReadonlyArray<RecourseReasonOption<ReturnReasonCode>> = [
  { code: 'not_as_described', label: 'Article non conforme à l’annonce' },
  { code: 'damaged', label: 'Article endommagé' },
  { code: 'wrong_item', label: 'Mauvais article reçu' },
  { code: 'other', label: 'Changement d’avis' },
];

const ShipmentTracking: React.FC<ShipmentTrackingProps> = ({
  transaction,
  onStatusUpdate,
}) => {
  const router = useRouter();
  const user = useAuthStore(selectUser);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isBuyer = !!user && user.id === transaction.buyerId;
  const isDelivered = transaction.status === 'delivered';
  const isRecourse =
    transaction.status === 'delivery_failed' || transaction.status === 'lost';

  const releaseDate = transaction.fundsReleaseAt
    ? transaction.fundsReleaseAt.toLocaleDateString(APP_LOCALE, {
        day: 'numeric',
        month: 'long',
      })
    : undefined;

  const perspectiveDescription = fillFundsReleaseAt(
    getStatusDescription(transaction.status, isBuyer ? 'buyer' : 'seller'),
    releaseDate,
  );

  const handleRefresh = useCallback(async () => {
    try {
      setIsRefreshing(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const checkTracking = httpsCallable<{ transactionId: string }, { success: boolean }>(
        functions,
        'checkTrackingStatus',
      );
      const result = await checkTracking({ transactionId: transaction.id });

      if (result.data?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onStatusUpdate?.();
      }
    } catch (error: unknown) {
      if (__DEV__) console.error('Error refreshing tracking:', error);
      Alert.alert('Erreur', 'Impossible de mettre à jour le suivi');
    } finally {
      setIsRefreshing(false);
    }
  }, [transaction.id, onStatusUpdate]);

  const handleOpenTracking = useCallback(() => {
    if (transaction.trackingUrl) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Linking.openURL(transaction.trackingUrl);
    }
  }, [transaction.trackingUrl]);

  const handleDownloadLabel = useCallback(() => {
    if (transaction.shippingLabelUrl) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Linking.openURL(transaction.shippingLabelUrl);
    }
  }, [transaction.shippingLabelUrl]);

  // ---------------------------------------------------------------------------
  // BUYER RECOURSE
  //
  // TODO(backend): no buyer-facing callable exists yet for problem reports /
  // refund requests / return requests (`adminRefundTransaction` is admin-only).
  // Until a `reportTransactionProblem` / `requestRefund` / `requestReturn`
  // callable is exposed, these flows confirm intent with the spec copy and route
  // the buyer to the transaction chat — the real channel to reach the team /
  // seller — instead of inventing a server call. Wire the callable here when
  // available (see followUps).
  // ---------------------------------------------------------------------------

  const goToTransactionChat = useCallback(() => {
    if (transaction.chatId) {
      router.push(`/chat/${transaction.chatId}`);
    }
  }, [router, transaction.chatId]);

  const showReportConfirmation = useCallback(() => {
    Alert.alert(
      'Signalement envoyé',
      'Nous avons bien reçu votre signalement. Notre équipe revient vers vous sous 48 h. Vos fonds restent protégés.',
      [{ text: 'Compris' }],
    );
  }, []);

  const handleReportProblem = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Signaler un problème',
      'Sélectionnez ce qui s’est passé. Notre équipe examine chaque signalement sous 48 h.',
      [
        ...REPORT_REASONS.map((reason) => ({
          text: reason,
          onPress: showReportConfirmation,
        })),
        { text: 'Annuler', style: 'cancel' as const },
      ],
    );
  }, [showReportConfirmation]);

  const handleRequestRefund = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Demander un remboursement',
      'Vous pouvez demander le remboursement de cette commande. Une fois validé, le montant sera recrédité sur votre moyen de paiement d’origine. Le remboursement est traité après vérification par notre équipe.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer la demande',
          onPress: () => {
            Alert.alert(
              'Demande envoyée',
              'Votre demande de remboursement a été transmise. Nous vous tiendrons informé·e de son avancement.',
              [{ text: 'Compris', onPress: goToTransactionChat }],
            );
          },
        },
      ],
    );
  }, [goToTransactionChat]);

  const handleRequestReturn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Demander un retour',
      'Vous souhaitez renvoyer cet article ? Les frais d’expédition du retour sont à votre charge et seront déduits du remboursement. Le montant de l’article vous sera remboursé une fois le retour réceptionné par le vendeur·euse.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Demander le retour',
          onPress: () => {
            Alert.alert(
              'Demande de retour envoyée',
              'Votre demande est en cours de validation. Vous recevrez l’étiquette de retour et les instructions ici même.',
              [{ text: 'Compris', onPress: goToTransactionChat }],
            );
          },
        },
      ],
    );
  }, [goToTransactionChat]);

  const carrierInfo = getCarrierStatusInfo(transaction);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="cube-outline" size={24} color={colors.foreground} />
          <Text style={styles.headerTitle}>Suivi de livraison</Text>
        </View>
        <Pressable
          onPress={handleRefresh}
          disabled={isRefreshing || isDelivered}
          style={styles.refreshButton}
        >
          {isRefreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons
              name="refresh"
              size={20}
              color={isDelivered ? colors.muted : colors.primary}
            />
          )}
        </Pressable>
      </View>

      {/* Perspective-aware status line (buyer/seller) */}
      <Text style={styles.statusDescriptionLine}>{perspectiveDescription}</Text>

      {/* Carrier status card */}
      <View style={[styles.statusCard, { borderLeftColor: carrierInfo.color }]}>
        <View style={styles.statusIconContainer}>
          <View style={[styles.statusIconBg, { backgroundColor: colors.surfaceWarm }]}>
            <Ionicons name={carrierInfo.icon} size={28} color={carrierInfo.color} />
          </View>
        </View>

        <View style={styles.statusContent}>
          <Text style={[styles.statusLabel, { color: carrierInfo.color }]}>
            {carrierInfo.label}
          </Text>
          <Text style={styles.statusDescription}>{carrierInfo.description}</Text>

          {transaction.trackingNumber && (
            <View style={styles.trackingNumberContainer}>
              <Text style={styles.trackingNumberLabel}>Numéro de suivi :</Text>
              <Text style={styles.trackingNumber}>{transaction.trackingNumber}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Timeline */}
      <View style={styles.timeline}>
        <View style={styles.timelineItem}>
          <View style={[styles.timelineDot, styles.timelineDotCompleted]} />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Paiement confirmé</Text>
            {transaction.paidAt && (
              <Text style={styles.timelineDate}>
                {transaction.paidAt.toLocaleDateString(APP_LOCALE)}
              </Text>
            )}
          </View>
        </View>

        {/* Label created — distinct from shipping (before first carrier scan) */}
        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.labelCreatedAt || transaction.shippedAt
                ? styles.timelineDotCompleted
                : transaction.status === 'label_created'
                  ? styles.timelineDotActive
                  : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Étiquette créée</Text>
            {transaction.labelCreatedAt && (
              <Text style={styles.timelineDate}>
                {transaction.labelCreatedAt.toLocaleDateString(APP_LOCALE)}
              </Text>
            )}
            {!transaction.labelCreatedAt && transaction.status === 'label_created' && (
              <Text style={styles.timelineActive}>Bientôt en route</Text>
            )}
          </View>
        </View>

        {/* Shipped — first carrier scan */}
        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.shippedAt
                ? styles.timelineDotCompleted
                : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Colis expédié</Text>
            {transaction.shippedAt && (
              <Text style={styles.timelineDate}>
                {transaction.shippedAt.toLocaleDateString(APP_LOCALE)}
              </Text>
            )}
          </View>
        </View>

        {/* In transit */}
        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.trackingStatus === 'IN_TRANSIT' ||
              transaction.trackingStatus === 'TRANSIT'
                ? styles.timelineDotActive
                : transaction.deliveredAt
                  ? styles.timelineDotCompleted
                  : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>En transit</Text>
            {(transaction.trackingStatus === 'IN_TRANSIT' ||
              transaction.trackingStatus === 'TRANSIT') && (
              <Text style={styles.timelineActive}>En cours</Text>
            )}
          </View>
        </View>

        {/* Delivered */}
        <View style={styles.timelineItem}>
          <View
            style={[
              styles.timelineDot,
              transaction.deliveredAt
                ? styles.timelineDotCompleted
                : transaction.trackingStatus === 'OUT_FOR_DELIVERY'
                  ? styles.timelineDotActive
                  : styles.timelineDotPending,
            ]}
          />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineTitle}>Livré</Text>
            {transaction.deliveredAt && (
              <Text style={styles.timelineDate}>
                {transaction.deliveredAt.toLocaleDateString(APP_LOCALE)}
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        {transaction.trackingUrl && (
          <Pressable style={styles.actionButton} onPress={handleOpenTracking}>
            <Ionicons name="open-outline" size={18} color={colors.primary} />
            <Text style={styles.actionButtonText}>Suivre en ligne</Text>
          </Pressable>
        )}

        {transaction.shippingLabelUrl && (
          <Pressable style={styles.actionButton} onPress={handleDownloadLabel}>
            <Ionicons name="download-outline" size={18} color={colors.primary} />
            <Text style={styles.actionButtonText}>Télécharger l&apos;étiquette</Text>
          </Pressable>
        )}
      </View>

      {/* Delivered — funds-protection note (held 7 days) */}
      {isDelivered && (
        <View style={styles.protectionNote}>
          <Ionicons name="shield-checkmark" size={20} color={colors.success} />
          <Text style={styles.protectionNoteText}>
            {isBuyer
              ? releaseDate
                ? `Colis livré. Vos fonds sont protégés jusqu'au ${releaseDate}.`
                : 'Colis livré. Vos fonds restent protégés durant la fenêtre de réclamation.'
              : releaseDate
                ? `Colis livré. Vos fonds seront disponibles le ${releaseDate}.`
                : 'Colis livré. Vos fonds seront disponibles après la fenêtre de protection.'}
          </Text>
        </View>
      )}

      {/* Delivered + buyer — return-request entry (return fees on buyer) */}
      {isDelivered && isBuyer && (
        <Pressable style={styles.returnButton} onPress={handleRequestReturn}>
          <Ionicons name="arrow-undo-outline" size={16} color={colors.foreground} />
          <Text style={styles.returnButtonText}>Demander un retour</Text>
        </Pressable>
      )}

      {/* delivery_failed / lost — buyer recourse encart */}
      {isRecourse && isBuyer && (
        <View style={styles.recourseBox}>
          <View style={styles.recourseHeader}>
            <Ionicons name="alert-circle" size={20} color={colors.danger} />
            <Text style={styles.recourseTitle}>
              {transaction.status === 'lost'
                ? 'Votre colis semble égaré'
                : "La livraison n'a pas abouti"}
            </Text>
          </View>
          <Text style={styles.recourseBody}>
            {transaction.status === 'lost'
              ? 'Le suivi de votre colis est interrompu. Vos fonds sont gelés et restent protégés. Signalez-nous le problème pour être remboursé·e.'
              : "Le transporteur n'a pas pu livrer votre colis. Vos fonds sont gelés et restent protégés. Dites-nous comment vous souhaitez procéder."}
          </Text>
          <Pressable
            style={[styles.recourseButton, styles.recourseButtonPrimary]}
            onPress={handleReportProblem}
          >
            <Text style={styles.recourseButtonPrimaryText}>Signaler un problème</Text>
          </Pressable>
          <Pressable
            style={[styles.recourseButton, styles.recourseButtonSecondary]}
            onPress={handleRequestRefund}
          >
            <Text style={styles.recourseButtonSecondaryText}>Demander un remboursement</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginVertical: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  refreshButton: {
    padding: spacing.xs,
  },
  statusDescriptionLine: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.foregroundSecondary,
    marginBottom: spacing.md,
  },
  statusCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderLeftWidth: 4,
  },
  statusIconContainer: {
    marginRight: spacing.md,
  },
  statusIconBg: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContent: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 18,
    fontFamily: fonts.sansBold,
    marginBottom: spacing.xs,
  },
  statusDescription: {
    fontSize: 14,
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
  },
  trackingNumberContainer: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  trackingNumberLabel: {
    fontSize: 12,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  trackingNumber: {
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  timeline: {
    marginBottom: spacing.md,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: radius.full,
    marginTop: spacing.xs,
    marginRight: spacing.md,
  },
  timelineDotCompleted: {
    backgroundColor: colors.success,
  },
  timelineDotActive: {
    backgroundColor: colors.primary,
  },
  timelineDotPending: {
    backgroundColor: colors.border,
  },
  timelineContent: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
    marginBottom: 2,
  },
  timelineDate: {
    fontSize: 12,
    color: colors.muted,
  },
  timelineActive: {
    fontSize: 12,
    color: colors.primary,
    fontFamily: fonts.sansMedium,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    gap: spacing.xs + 2,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionButtonText: {
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    color: colors.primary,
  },
  protectionNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.successLight,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    gap: spacing.sm,
  },
  protectionNoteText: {
    flex: 1,
    fontSize: 13,
    color: colors.success,
    fontFamily: fonts.sansMedium,
    lineHeight: 18,
  },
  returnButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.white,
  },
  returnButtonText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  recourseBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  recourseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  recourseTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: fonts.sansBold,
    color: colors.foreground,
  },
  recourseBody: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.foregroundSecondary,
    fontFamily: fonts.sans,
  },
  recourseButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
  },
  recourseButtonPrimary: {
    backgroundColor: colors.danger,
  },
  recourseButtonPrimaryText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.white,
    letterSpacing: 0.3,
  },
  recourseButtonSecondary: {
    backgroundColor: colors.transparent,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  recourseButtonSecondaryText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.danger,
    letterSpacing: 0.3,
  },
});

export default ShipmentTracking;
