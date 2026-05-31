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
import { useAutomatedDecision } from '@/hooks/useAutomatedDecision';
import {
  getDecisionExplanation,
  getDecisionTitle,
  buildCriteriaRows,
  isAutomatedDecisionType,
  type AutomatedDecisionType,
} from '@/lib/automatedDecisionMeta';

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
const REPORT_REASON_OPTIONS: readonly RecourseReasonOption<ReportReasonCode>[] = [
  { code: 'not_received_despite_delivered', label: 'Colis non reçu' },
  { code: 'not_as_described', label: 'Article non conforme à l’annonce' },
  { code: 'damaged', label: 'Article endommagé' },
  { code: 'other', label: 'Autre' },
];

/** "Demander un retour" options → backend return reason codes. */
const RETURN_REASON_OPTIONS: readonly RecourseReasonOption<ReturnReasonCode>[] = [
  { code: 'not_as_described', label: 'Article non conforme à l’annonce' },
  { code: 'damaged', label: 'Article endommagé' },
  { code: 'wrong_item', label: 'Mauvais article reçu' },
  { code: 'other', label: 'Changement d’avis' },
];

/** Loi 25 art. 12.1 — motifs prédéfinis pour contester une décision automatisée. */
type ContestReasonCode =
  | 'disagree_decision'
  | 'incorrect_information'
  | 'special_circumstances'
  | 'other';

const CONTEST_REASON_OPTIONS: readonly RecourseReasonOption<ContestReasonCode>[] = [
  { code: 'disagree_decision', label: 'Je ne suis pas d’accord avec cette décision' },
  { code: 'incorrect_information', label: 'Les informations utilisées sont incorrectes' },
  { code: 'special_circumstances', label: 'Ma situation présente des circonstances particulières' },
  { code: 'other', label: 'Autre' },
];

const CONTEST_REASON_LABELS: Record<ContestReasonCode, string> = {
  disagree_decision: 'Je ne suis pas d’accord avec cette décision',
  incorrect_information: 'Les informations utilisées sont incorrectes',
  special_circumstances: 'Ma situation présente des circonstances particulières',
  other: 'Autre',
};

const ShipmentTracking: React.FC<ShipmentTrackingProps> = ({
  transaction,
  onStatusUpdate,
}) => {
  const user = useAuthStore(selectUser);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isBuyer = !!user && user.id === transaction.buyerId;
  const isDelivered = transaction.status === 'delivered';
  const isRecourse =
    transaction.status === 'delivery_failed' || transaction.status === 'lost';
  // "shipped" / "delivered" → buyer can report a problem ("le scan livré fait foi").
  const isReportable =
    transaction.status === 'shipped' || transaction.status === 'delivered';
  const isReturnRequested = transaction.status === 'return_requested';

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
  // BUYER RECOURSE — wired to the buyer-facing callables
  // (functions/src/callable/recourse.ts): requestRefund / reportTransactionProblem
  // / requestReturn. The transaction doc is the source of truth — after a
  // successful call we trigger onStatusUpdate() so the parent refetches and the
  // UI reflects the new status (refund_in_progress / disputed / return_requested).
  // ---------------------------------------------------------------------------

  const { requestRefund, reportProblem, requestReturn } = useTransactionRecourse();
  const reportSheetRef = useRef<RecourseReasonSheetRef>(null);
  const returnSheetRef = useRef<RecourseReasonSheetRef>(null);
  const [isRefunding, setIsRefunding] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [isReturning, setIsReturning] = useState(false);

  const openReportSheet = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    reportSheetRef.current?.present();
  }, []);

  const openReturnSheet = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    returnSheetRef.current?.present();
  }, []);

  const handleSubmitReport = useCallback(
    async (reason: ReportReasonCode, details: string) => {
      if (isReporting) return;
      try {
        setIsReporting(true);
        await reportProblem(transaction.id, reason, details);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        reportSheetRef.current?.dismiss();
        onStatusUpdate?.();
        Alert.alert(
          'Signalement envoyé',
          'Nous avons bien reçu votre signalement. Notre équipe revient vers vous sous 48 h. Le scan livré fait foi, notre équipe examine. Vos fonds restent protégés.',
          [{ text: 'Compris' }],
        );
      } catch (error: unknown) {
        if (__DEV__) console.error('reportTransactionProblem failed:', error);
        Alert.alert('Signalement impossible', getRecourseErrorMessage(error), [
          { text: 'Compris' },
        ]);
      } finally {
        setIsReporting(false);
      }
    },
    [isReporting, reportProblem, transaction.id, onStatusUpdate],
  );

  const submitRefund = useCallback(async () => {
    if (isRefunding) return;
    try {
      setIsRefunding(true);
      const result = await requestRefund(transaction.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onStatusUpdate?.();
      Alert.alert(
        'Demande envoyée',
        result.alreadyRefunded
          ? 'Cette commande a déjà été remboursée. Le montant a été recrédité sur votre moyen de paiement d’origine.'
          : 'Votre remboursement a été enregistré. Le montant sera recrédité sur votre moyen de paiement d’origine. Nous vous tiendrons informé·e de son avancement.',
        [{ text: 'Compris' }],
      );
    } catch (error: unknown) {
      if (__DEV__) console.error('requestRefund failed:', error);
      // Refund refused on a delivered parcel → steer the buyer to the report flow.
      if (isFailedPrecondition(error)) {
        Alert.alert(
          'Remboursement automatique indisponible',
          'Le remboursement automatique est réservé aux colis confirmés perdus ou en échec de livraison. Pour un colis livré présentant un problème, signalez-le à notre équipe.',
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Signaler un problème', onPress: openReportSheet },
          ],
        );
        return;
      }
      Alert.alert('Demande impossible', getRecourseErrorMessage(error), [
        { text: 'Compris' },
      ]);
    } finally {
      setIsRefunding(false);
    }
  }, [isRefunding, requestRefund, transaction.id, onStatusUpdate, openReportSheet]);

  const handleRequestRefund = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Demander un remboursement',
      'Vous pouvez demander le remboursement de cette commande. Une fois validé, le montant sera recrédité sur votre moyen de paiement d’origine.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Confirmer la demande', onPress: submitRefund },
      ],
    );
  }, [submitRefund]);

  const handleSubmitReturn = useCallback(
    async (reason: ReturnReasonCode) => {
      if (isReturning) return;
      try {
        setIsReturning(true);
        await requestReturn(transaction.id, reason);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        returnSheetRef.current?.dismiss();
        onStatusUpdate?.();
        Alert.alert(
          'Demande de retour envoyée',
          'Votre demande est validée. Imprimez l’étiquette de retour ci-dessous et déposez le colis chez le transporteur. Vous serez remboursé·e une fois le retour réceptionné par le vendeur·euse.',
          [{ text: 'Compris' }],
        );
      } catch (error: unknown) {
        if (__DEV__) console.error('requestReturn failed:', error);
        Alert.alert('Retour impossible', getRecourseErrorMessage(error), [
          { text: 'Compris' },
        ]);
      } finally {
        setIsReturning(false);
      }
    },
    [isReturning, requestReturn, transaction.id, onStatusUpdate],
  );

  const handleOpenReturnLabel = useCallback(() => {
    if (transaction.returnLabelUrl) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      Linking.openURL(transaction.returnLabelUrl);
    }
  }, [transaction.returnLabelUrl]);

  // ---------------------------------------------------------------------------
  // AUTOMATED DECISIONS (Loi 25, art. 12.1)
  //
  // The transparent log (getAutomatedDecisionLog) is the source of truth: the
  // presence of an entry means an automated decision (funds released / order
  // expired / label refund) was applied to this transaction. We then surface
  // (a) the juriste notification text, (b) an accessible "Pourquoi cette
  // décision ?" explanation, and (c) the "Contester cette décision" button.
  // Contesting opens a human-review request and REVERSES NOTHING.
  // ---------------------------------------------------------------------------

  const {
    latestDecision,
    hasAutomatedDecision,
    contest,
    isContesting,
  } = useAutomatedDecision(transaction.id);

  const contestSheetRef = useRef<RecourseReasonSheetRef>(null);
  const [isExplanationOpen, setIsExplanationOpen] = useState(false);

  const decisionType: AutomatedDecisionType | null =
    latestDecision && isAutomatedDecisionType(latestDecision.decisionType)
      ? latestDecision.decisionType
      : null;

  const decisionDateLabel = latestDecision?.executedAt
    ? new Date(latestDecision.executedAt).toLocaleDateString(APP_LOCALE, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const criteriaRows = useMemo(
    () =>
      latestDecision ? buildCriteriaRows(latestDecision.criteria, APP_LOCALE) : [],
    [latestDecision],
  );

  const toggleExplanation = useCallback(() => {
    Haptics.selectionAsync();
    setIsExplanationOpen((prev) => !prev);
  }, []);

  const openContestSheet = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    contestSheetRef.current?.present();
  }, []);

  const handleSubmitContest = useCallback(
    async (reason: ContestReasonCode, details: string) => {
      if (isContesting || !decisionType) return;
      // Combine the predefined motive with the optional free-text so the human
      // reviewer gets the full context in a single `reason` string.
      const label = CONTEST_REASON_LABELS[reason];
      const composed = details.trim().length > 0 ? `${label} — ${details.trim()}` : label;
      try {
        await contest({
          transactionId: transaction.id,
          decisionType,
          reason: composed,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        contestSheetRef.current?.dismiss();
        Alert.alert(
          'Contestation transmise',
          'Votre contestation a été transmise. Notre équipe procédera à une révision humaine de cette décision et reviendra vers vous.',
          [{ text: 'Compris' }],
        );
      } catch (error: unknown) {
        if (__DEV__) console.error('contestAutomatedDecision failed:', error);
        Alert.alert('Contestation impossible', getRecourseErrorMessage(error), [
          { text: 'Compris' },
        ]);
      }
    },
    [isContesting, decisionType, contest, transaction.id],
  );

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

      {/* shipped / delivered + buyer — report a problem ("le scan livré fait foi") */}
      {isReportable && isBuyer && (
        <Pressable
          style={[styles.outlineButton, isReporting && styles.buttonDisabled]}
          onPress={openReportSheet}
          disabled={isReporting}
        >
          <Ionicons name="flag-outline" size={16} color={colors.foreground} />
          <Text style={styles.outlineButtonText}>Signaler un problème</Text>
        </Pressable>
      )}

      {/* Delivered + buyer — return-request entry (return fees on buyer) */}
      {isDelivered && isBuyer && (
        <Pressable
          style={[styles.returnButton, isReturning && styles.buttonDisabled]}
          onPress={openReturnSheet}
          disabled={isReturning}
        >
          <Ionicons name="arrow-undo-outline" size={16} color={colors.foreground} />
          <Text style={styles.returnButtonText}>Demander un retour</Text>
        </Pressable>
      )}

      {/* return_requested — return state + label + return tracking */}
      {isReturnRequested && isBuyer && (
        <View style={styles.returnStateBox}>
          <View style={styles.recourseHeader}>
            <Ionicons name="arrow-undo" size={20} color={colors.warning} />
            <Text style={styles.recourseTitle}>Étiquette de retour disponible</Text>
          </View>
          <Text style={styles.recourseBody}>
            Imprimez votre étiquette et déposez le colis chez le transporteur. Vous
            serez remboursé·e une fois le retour réceptionné par le vendeur·euse.
          </Text>

          {transaction.returnTrackingNumber && (
            <View style={styles.trackingNumberContainer}>
              <Text style={styles.trackingNumberLabel}>Suivi du retour :</Text>
              <Text style={styles.trackingNumber}>{transaction.returnTrackingNumber}</Text>
            </View>
          )}

          {transaction.returnLabelUrl && (
            <Pressable style={styles.returnLabelButton} onPress={handleOpenReturnLabel}>
              <Ionicons name="download-outline" size={18} color={colors.cream} />
              <Text style={styles.returnLabelButtonText}>Voir l’étiquette de retour</Text>
            </Pressable>
          )}
        </View>
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
            style={[styles.recourseButton, styles.recourseButtonPrimary, isReporting && styles.buttonDisabled]}
            onPress={openReportSheet}
            disabled={isReporting}
          >
            <Text style={styles.recourseButtonPrimaryText}>Signaler un problème</Text>
          </Pressable>
          <Pressable
            style={[styles.recourseButton, styles.recourseButtonSecondary, isRefunding && styles.buttonDisabled]}
            onPress={handleRequestRefund}
            disabled={isRefunding}
          >
            {isRefunding ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <Text style={styles.recourseButtonSecondaryText}>Demander un remboursement</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Reason sheets — mounted only while open (handled internally) */}
      <RecourseReasonSheet<ReportReasonCode>
        ref={reportSheetRef}
        title="Signaler un problème"
        intro="Sélectionnez ce qui s’est passé. Le scan livré fait foi : notre équipe examine chaque signalement sous 48 h. Vos fonds restent protégés."
        reasons={REPORT_REASON_OPTIONS}
        showDetailsField
        submitLabel="Envoyer le signalement"
        isSubmitting={isReporting}
        onSubmit={handleSubmitReport}
      />
      <RecourseReasonSheet<ReturnReasonCode>
        ref={returnSheetRef}
        title="Demander un retour"
        intro="Vous souhaitez renvoyer cet article ? Expliquez-nous le motif. Une étiquette de retour vous sera fournie après validation."
        reasons={RETURN_REASON_OPTIONS}
        footerNote={{
          title: 'Frais de retour à votre charge',
          body: 'Les frais d’expédition du retour sont à votre charge et seront déduits du remboursement. Le montant de l’article vous sera remboursé une fois le retour réceptionné par le vendeur·euse.',
        }}
        submitLabel="Demander le retour"
        isSubmitting={isReturning}
        onSubmit={handleSubmitReturn}
      />
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
  outlineButton: {
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
  outlineButtonText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.foreground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  returnStateBox: {
    backgroundColor: colors.warningLight,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  returnLabelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs + 2,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.rust,
  },
  returnLabelButtonText: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
    color: colors.cream,
    letterSpacing: 0.3,
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
