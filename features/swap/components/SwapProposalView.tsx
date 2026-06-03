/**
 * SwapProposalView
 * Detailed layout shown when a swap has status "proposed" and the current user
 * is the receiver. Includes sender profile, message, items from both sides, and summary.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/ui';
import SwapItemCard from '@/components/swap/SwapItemCard';
import SwapSummaryBox from '@/components/swap/SwapSummaryBox';
import { colors, fonts } from '@/constants/theme';
import { formatPrice } from '@/utils/formatPrice';
import { SwapItemInfo } from '@/types';

interface SwapProposalViewProps {
  senderName: string;
  senderImage: string | undefined;
  message: string | undefined;
  senderItems: SwapItemInfo[];
  myItems: SwapItemInfo[];
  cashTopUp: { amount: number; payerId: string } | undefined;
}

export const SwapProposalView = React.memo(function SwapProposalView({
  senderName,
  senderImage,
  message,
  senderItems,
  myItems,
  cashTopUp,
}: SwapProposalViewProps) {
  // cashTopUp.amount is stored in cents; convert to dollars for display.
  const cashTopUpDollars = cashTopUp ? cashTopUp.amount / 100 : undefined;
  return (
    <>
      {/* Sender Profile Row */}
      <View style={styles.senderProfile}>
        <View style={styles.avatarWrapper}>
          {senderImage ? (
            <Image
              source={{ uri: senderImage }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarLetter}>
                {senderName?.charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.senderInfoColumn}>
          <Text style={styles.senderUsername}>{senderName}</Text>
        </View>
      </View>

      {/* Message Bubble (if exists) */}
      {message && (
        <View style={styles.messageBubble}>
          <Text style={styles.messageText}>{message}</Text>
        </View>
      )}

      {/* Sender proposal section */}
      <View style={styles.proposalSection}>
        <Text style={styles.sectionLabel}>{`${senderName} propose`}</Text>
        <View style={styles.itemsStack}>
          {senderItems.map((item, index) => (
            <SwapItemCard
              key={`sender-${index}`}
              item={item}
              variant="their"
            />
          ))}
        </View>
      </View>

      {/* Supplement Badge (if cash top-up) */}
      {cashTopUp && (
        <View style={styles.supplementBadge}>
          <Ionicons name="information-circle" size={18} color={colors.rust} />
          <Text style={styles.supplementText}>
            {`${senderName} ajoute un complément de `}
            <Text style={styles.supplementAmount}>{formatPrice(cashTopUpDollars!)}</Text> en argent
          </Text>
        </View>
      )}

      {/* "Contre mon article" Section */}
      <View style={styles.proposalSection}>
        <Text style={styles.sectionLabel}>Contre mon article</Text>
        <View style={styles.itemsStack}>
          {myItems.map((item, index) => (
            <SwapItemCard
              key={`my-${index}`}
              item={item}
              variant="mine"
            />
          ))}
        </View>
      </View>

      {/* Summary Box */}
      <View style={styles.summaryContainer}>
        <SwapSummaryBox
          youReceive={senderItems.map((item) => item.title).join(', ')}
          youGive={myItems.map((item) => item.title).join(', ')}
          receivedItems={senderItems}
          givenItems={myItems}
          cashSupplement={cashTopUpDollars}
        />
      </View>
    </>
  );
});

const styles = StyleSheet.create({
  senderProfile: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    gap: 12,
    backgroundColor: colors.surface,
  },
  avatarWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.sageLight,
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.rust,
  },
  avatarLetter: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '400',
    color: colors.surface,
  },
  senderInfoColumn: {
    flex: 1,
  },
  senderUsername: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    fontWeight: '500',
    color: colors.charcoal,
    lineHeight: 18,
  },
  messageBubble: {
    marginHorizontal: 24,
    marginVertical: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: colors.cream,
    borderRadius: 4,
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  messageText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 21,
    fontWeight: '300',
    color: colors.charcoal,
  },
  proposalSection: {
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  sectionLabel: {
    fontFamily: fonts.sans,
    fontSize: 10,
    fontWeight: '400',
    letterSpacing: 0.15,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 8,
  },
  itemsStack: {
    gap: 12,
  },
  supplementBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 24,
    marginVertical: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(196, 96, 58, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(196, 96, 58, 0.2)',
    borderRadius: 10,
  },
  supplementText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.charcoal,
    flex: 1,
  },
  supplementAmount: {
    fontWeight: '700',
  },
  summaryContainer: {
    marginHorizontal: 24,
    marginVertical: 20,
  },
});
