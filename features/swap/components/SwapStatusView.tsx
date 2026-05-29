/**
 * SwapStatusView
 * Simplified layout for non-proposed statuses (accepted, shipping, completed, etc.).
 * Shows status indicator, compact sender card, items display and summary.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Text, Caption } from '@/components/ui';
import SwapItemCard from '@/components/swap/SwapItemCard';
import SwapSummaryBox from '@/components/swap/SwapSummaryBox';
import { colors, fonts } from '@/constants/theme';
import { SwapItemInfo, SwapStatus } from '@/types';

const STATUS_LABELS: Record<SwapStatus, string> = {
  proposed: 'Swap reçu',
  payment_pending: 'Paiement en attente',
  accepted: 'Accepté',
  declined: 'Refusé',
  cancelled: 'Annulé',
  photos_pending: 'Photos en attente',
  shipping: "En cours d'envoi",
  completed: 'Terminé',
  disputed: 'Litige',
};

const SHOW_SUMMARY_STATUSES: ReadonlySet<SwapStatus> = new Set([
  'payment_pending',
  'accepted',
  'photos_pending',
  'shipping',
  'completed',
]);

function getStatusIconName(
  status: SwapStatus
): 'checkmark-circle' | 'close-circle' | 'swap-horizontal' {
  if (status === 'completed') return 'checkmark-circle';
  if (status === 'declined' || status === 'cancelled') return 'close-circle';
  return 'swap-horizontal';
}

interface SwapStatusViewProps {
  status: SwapStatus;
  senderName: string;
  senderImage: string | undefined;
  senderItems: SwapItemInfo[];
  myItems: SwapItemInfo[];
  cashTopUpAmount: number | undefined;
}

export const SwapStatusView = React.memo(function SwapStatusView({
  status,
  senderName,
  senderImage,
  senderItems,
  myItems,
  cashTopUpAmount,
}: SwapStatusViewProps) {
  return (
    <>
      {/* Status Indicator */}
      <View style={styles.statusIndicator}>
        <View style={styles.statusIcon}>
          <Ionicons
            name={getStatusIconName(status)}
            size={20}
            color={colors.surface}
          />
        </View>
        <Text style={styles.statusText}>{STATUS_LABELS[status]}</Text>
      </View>

      {/* Compact Sender Info */}
      <View style={styles.compactSenderCard}>
        <View style={styles.avatarSmall}>
          <Image
            source={senderImage ? { uri: senderImage } : undefined}
            style={styles.avatarImageSmall}
            contentFit="cover"
          />
        </View>
        <View style={styles.compactSenderInfo}>
          <Text style={styles.compactSenderName}>{senderName}</Text>
          <Caption>Villeray · 2.8 km</Caption>
        </View>
      </View>

      {/* Items Display */}
      <View style={styles.itemsSection}>
        <Text style={styles.itemsSectionLabel}>
          {"Éléments de l'échange"}
        </Text>
        <View style={styles.itemsStack}>
          {senderItems.map((item, index) => (
            <SwapItemCard
              key={`sender-${index}`}
              item={item}
              variant="their"
            />
          ))}
        </View>
        <View style={styles.swapDivider}>
          <Ionicons name="swap-horizontal" size={16} color={colors.muted} />
        </View>
        <View style={styles.itemsStack}>
          {myItems.map((item, index) => (
            <SwapItemCard
              key={`receiver-${index}`}
              item={item}
              variant="mine"
            />
          ))}
        </View>
      </View>

      {/* Summary Box — only for relevant statuses */}
      {SHOW_SUMMARY_STATUSES.has(status) && (
        <View style={styles.summaryContainer}>
          <SwapSummaryBox
            youReceive={senderItems.map((item) => item.title).join(', ')}
            youGive={myItems.map((item) => item.title).join(', ')}
            receivedItems={senderItems}
            givenItems={myItems}
            cashSupplement={cashTopUpAmount}
          />
        </View>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: colors.sage,
    gap: 12,
  },
  statusIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.sage,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.charcoal,
  },
  compactSenderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
    gap: 12,
  },
  avatarSmall: {
    width: 36,
    height: 36,
    borderRadius: 18,
    overflow: 'hidden',
  },
  avatarImageSmall: {
    width: '100%',
    height: '100%',
  },
  compactSenderInfo: {
    flex: 1,
  },
  compactSenderName: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.charcoal,
  },
  itemsSection: {
    paddingHorizontal: 24,
    marginTop: 20,
  },
  itemsSectionLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    letterSpacing: 0.15,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },
  itemsStack: {
    gap: 12,
  },
  swapDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  summaryContainer: {
    marginHorizontal: 24,
    marginVertical: 20,
  },
});
