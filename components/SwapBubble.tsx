import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SwapItemInfo, SwapStatus } from '@/types';
import { colors, fonts, radius, spacing } from '@/constants/theme';

export interface SwapMessageData {
  swapId: string;
  initiatorItems: SwapItemInfo[];
  receiverItems: SwapItemInfo[];
  initiatorTotalValue: number;
  receiverTotalValue: number;
  status: SwapStatus;
  message?: string;
  cashTopUp?: {
    amount: number;
    payerId: string;
  };
}

interface SwapBubbleProps {
  swapData: SwapMessageData;
  isOwnMessage: boolean;
  isReceiver: boolean;
  timestamp: Date;
  onAcceptSwap?: (swapId: string) => Promise<void>;
  onDeclineSwap?: (swapId: string) => Promise<void>;
}

export const SwapBubble = React.memo(function SwapBubble({
  swapData,
  isOwnMessage,
  isReceiver,
  timestamp,
  onAcceptSwap,
  onDeclineSwap,
}: SwapBubbleProps) {
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);

  const {
    swapId,
    initiatorItems,
    receiverItems,
    initiatorTotalValue,
    receiverTotalValue,
    status,
    message,
    cashTopUp,
  } = swapData;

  const valueDifference = receiverTotalValue - initiatorTotalValue;
  const isNegativeDifference = valueDifference < 0;
  const showCashTopUp = cashTopUp && cashTopUp.amount > 0;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (s: SwapStatus) => {
    switch (s) {
      case 'accepted':
      case 'photos_pending':
      case 'shipping':
      case 'completed':
        return colors.success;
      case 'declined':
      case 'cancelled':
      case 'disputed':
        return colors.danger;
      default:
        return colors.primary;
    }
  };

  const getStatusBgColor = (s: SwapStatus) => {
    switch (s) {
      case 'accepted':
      case 'photos_pending':
      case 'shipping':
      case 'completed':
        return colors.successLight;
      case 'declined':
      case 'cancelled':
      case 'disputed':
        return colors.dangerLight;
      default:
        return colors.primaryLight;
    }
  };

  const getStatusText = (s: SwapStatus) => {
    switch (s) {
      case 'proposed':
        return 'Proposée';
      case 'accepted':
        return 'Acceptée';
      case 'declined':
        return 'Refusée';
      case 'cancelled':
        return 'Annulée';
      case 'photos_pending':
        return 'Photos requises';
      case 'shipping':
        return 'En cours d\'envoi';
      case 'completed':
        return 'Complétée';
      case 'disputed':
        return 'Litige';
      default:
        return 'En attente';
    }
  };

  const canRespond = !isOwnMessage && isReceiver && status === 'proposed';
  const showItemsStrikethrough =
    status === 'declined' || status === 'cancelled' || status === 'disputed';

  const handleAccept = async () => {
    Alert.alert(
      'Accepter le swap',
      'Acceptez-vous cet échange de produits ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Accepter',
          style: 'default',
          onPress: async () => {
            try {
              setIsAccepting(true);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              if (onAcceptSwap) {
                await onAcceptSwap(swapId);
              }
            } catch (error) {
              console.error('Error accepting swap:', error);
              Alert.alert('Erreur', 'Impossible d\'accepter le swap');
            } finally {
              setIsAccepting(false);
            }
          },
        },
      ]
    );
  };

  const handleDecline = async () => {
    Alert.alert(
      'Refuser le swap',
      'Voulez-vous refuser cet échange ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Refuser',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsDeclining(true);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              if (onDeclineSwap) {
                await onDeclineSwap(swapId);
              }
            } catch (error) {
              console.error('Error declining swap:', error);
              Alert.alert('Erreur', 'Impossible de refuser le swap');
            } finally {
              setIsDeclining(false);
            }
          },
        },
      ]
    );
  };

  const renderSwapItem = (item: SwapItemInfo, showStrike: boolean) => (
    <View key={item.articleId} style={styles.itemCard}>
      {item.imageUrl && (
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.itemImage}
          contentFit="cover"
        />
      )}
      <View style={styles.itemContent}>
        <Text
          style={[
            styles.itemTitle,
            showStrike && styles.strikethrough,
          ]}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <Text
          style={[
            styles.itemPrice,
            showStrike && styles.strikethroughPrice,
          ]}
        >
          {item.price.toFixed(0)}$
        </Text>
        {item.brand && (
          <Text
            style={[
              styles.itemMeta,
              showStrike && styles.strikethroughMeta,
            ]}
            numberOfLines={1}
          >
            {item.brand}
          </Text>
        )}
      </View>
    </View>
  );

  const statusColor = getStatusColor(status);
  const statusBgColor = getStatusBgColor(status);
  const opacity = showItemsStrikethrough ? 0.6 : 1;

  return (
    <View
      style={[
        styles.container,
        isOwnMessage ? styles.ownContainer : styles.otherContainer,
      ]}
    >
      <View style={[styles.bubble, { opacity }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.swapIcon, { backgroundColor: colors.primaryLight }]}>
            <Ionicons
              name="swap-horizontal"
              size={16}
              color={colors.primary}
            />
          </View>
          <Text style={styles.headerLabel}>PROPOSITION DE SWAP</Text>
          <View style={[styles.badge, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>SWAP</Text>
          </View>
        </View>

        {/* Items Section */}
        <View style={styles.itemsSection}>
          {/* Initiator Items */}
          <View style={styles.itemsColumn}>
            <Text style={styles.columnLabel}>
              {isOwnMessage ? 'Tu proposes' : 'Elle propose'}
            </Text>
            <View style={styles.itemsList}>
              {initiatorItems.map((item) =>
                renderSwapItem(item, showItemsStrikethrough)
              )}
            </View>
          </View>

          {/* Arrow */}
          <View style={styles.arrowContainer}>
            <Ionicons
              name="swap-horizontal"
              size={24}
              color={colors.primary}
            />
          </View>

          {/* Receiver Items */}
          <View style={styles.itemsColumn}>
            <Text style={styles.columnLabel}>
              {isOwnMessage ? 'Elle propose' : 'Tu proposes'}
            </Text>
            <View style={styles.itemsList}>
              {receiverItems.map((item) =>
                renderSwapItem(item, showItemsStrikethrough)
              )}
            </View>
          </View>
        </View>

        {/* Value Difference */}
        <View style={styles.valueDifferenceContainer}>
          <Text style={styles.valueDifferenceLabel}>DIFFERENCE DE VALEUR</Text>
          <Text
            style={[
              styles.valueDifferenceAmount,
              {
                color: isNegativeDifference ? colors.danger : colors.sage,
              },
            ]}
          >
            {isNegativeDifference ? '' : '+'}
            {Math.abs(valueDifference).toFixed(0)}$
          </Text>
          {showCashTopUp && (
            <Text style={styles.cashTopUpText}>
              + Ajustement: {cashTopUp.amount.toFixed(0)}$
            </Text>
          )}
        </View>

        {/* Message */}
        {message && (
          <Text style={styles.message}>"{message}"</Text>
        )}

        {/* Status Bar */}
        <View style={styles.statusBar}>
          <View style={[styles.statusBadge, { backgroundColor: statusBgColor }]}>
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {getStatusText(status)}
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        {canRespond && (
          <View style={styles.actionsSection}>
            <Pressable
              style={[styles.actionButton, styles.declineButton]}
              onPress={handleDecline}
              disabled={isDeclining || isAccepting}
            >
              {isDeclining ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <>
                  <Ionicons name="close" size={14} color={colors.danger} />
                  <Text style={styles.declineButtonText}>Décliner</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={[styles.actionButton, styles.acceptButton]}
              onPress={handleAccept}
              disabled={isAccepting || isDeclining}
            >
              {isAccepting ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark" size={14} color={colors.white} />
                  <Text style={styles.acceptButtonText}>Accepter</Text>
                </>
              )}
            </Pressable>
          </View>
        )}

        {/* Timestamp */}
        <Text style={styles.timestamp}>{formatTime(timestamp)}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    width: '100%',
    alignSelf: 'stretch',
  },
  ownContainer: {},
  otherContainer: {},
  bubble: {
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
  swapIcon: {
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
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.xs,
  },
  badgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  // Items Section
  itemsSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  itemsColumn: {
    flex: 1,
  },
  columnLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  itemsList: {
    gap: spacing.xs,
  },
  itemCard: {
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    padding: spacing.sm,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  itemImage: {
    width: 40,
    height: 50,
    borderRadius: radius.xs,
    backgroundColor: colors.border,
  },
  itemContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  itemTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    fontWeight: '600',
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  itemPrice: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 14,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  itemMeta: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: colors.muted,
  },
  strikethrough: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  strikethroughPrice: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  strikethroughMeta: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },

  // Arrow
  arrowContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },

  // Value Difference
  valueDifferenceContainer: {
    backgroundColor: colors.cream,
    borderRadius: radius.sm,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  valueDifferenceLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  valueDifferenceAmount: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 18,
    marginBottom: spacing.xs,
  },
  cashTopUpText: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: colors.muted,
    marginTop: spacing.xs,
  },

  // Message
  message: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
    marginBottom: spacing.md,
    lineHeight: 18,
  },

  // Status Bar
  statusBar: {
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
  },
  statusBadge: {
    alignSelf: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },

  // Actions
  actionsSection: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderStrong,
    paddingTop: spacing.md,
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
    fontWeight: '600',
    color: colors.white,
  },
  declineButton: {
    backgroundColor: colors.dangerLight,
  },
  declineButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    fontWeight: '600',
    color: colors.danger,
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
