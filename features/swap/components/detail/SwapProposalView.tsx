import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '@/components/ui';
import SwapItemCard from '../shared/SwapItemCard';
import { SwapComparisonLayout } from '../shared/SwapComparisonLayout';
import { SwapValueTotals } from '../shared/SwapValueTotals';
import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { formatDisplayName } from '@/utils/formatName';
import { SwapItemInfo } from '@/types';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';

interface SwapProposalViewProps {
  /** The other participant; senderItems are always the items you receive. */
  senderName: string;
  senderImage: string | undefined;
  message: string | undefined;
  senderItems: SwapItemInfo[];
  myItems: SwapItemInfo[];
  cashTopUp: { amount: number; payerId: string } | undefined;
  isInitiator?: boolean;
  currentUserId?: string;
  otherUserId?: string;
  swapId?: string;
  articlePrivacyWithdrawals?: Record<string, unknown>;
}

export const SwapProposalView = React.memo(function SwapProposalView({
  senderName,
  message,
  senderItems,
  myItems,
  cashTopUp,
  isInitiator = false,
  currentUserId,
  otherUserId,
  swapId,
  articlePrivacyWithdrawals,
}: SwapProposalViewProps) {
  // Recreate native text measurements when Dynamic Type changes on this mounted screen.
  const { fontScale } = useWindowDimensions();
  const name = formatDisplayName(senderName);
  const payer =
    cashTopUp?.payerId === currentUserId
      ? 'Vous'
      : cashTopUp?.payerId === otherUserId
        ? name
        : 'Payeur à confirmer';
  return (
    <View key={fontScale} style={styles.content}>
      <Text style={styles.statusTitle}>
        {isInitiator
          ? 'Proposition envoyée · En attente de réponse'
          : 'Proposition reçue'}
      </Text>
      <SwapComparisonLayout
        received={
          <View style={styles.section} testID="swap-received-items">
            <Text style={styles.sectionTitle}>Vous recevez</Text>
            {senderItems.map((item, index) => (
              <SwapItemCard
                key={`${item.articleId}-${index}`}
                item={item}
                showValue={false}
                compact={senderItems.length > 1}
                variant="their"
                publicSellerId={otherUserId}
                swapId={swapId}
                privacyWithdrawalRecorded={!!articlePrivacyWithdrawals && Object.prototype.hasOwnProperty.call(articlePrivacyWithdrawals, item.articleId)}
              />
            ))}
          </View>
        }
        proposed={
          <View style={styles.section} testID="swap-given-items">
            <Text style={styles.sectionTitle}>Vous proposez</Text>
            {myItems.map((item, index) => (
              <SwapItemCard
                key={`${item.articleId}-${index}`}
                item={item}
                showValue={false}
                compact={myItems.length > 1}
                variant="mine"
                publicSellerId={currentUserId}
                swapId={swapId}
                privacyWithdrawalRecorded={!!articlePrivacyWithdrawals && Object.prototype.hasOwnProperty.call(articlePrivacyWithdrawals, item.articleId)}
              />
            ))}
          </View>
        }
      />
      <SwapValueTotals
        receivedTotal={senderItems.reduce((sum, item) => sum + item.price, 0)}
        proposedTotal={myItems.reduce((sum, item) => sum + item.price, 0)}
      />
      {!!message && (
        <View style={styles.message}>
          <Text style={styles.eyebrow}>
            {isInitiator ? 'Votre message' : `Message de ${name}`}
          </Text>
          <Text style={styles.body}>{message}</Text>
        </View>
      )}
      {!!cashTopUp?.amount && (
        <View style={styles.message}>
          <Text style={styles.body}>
            {PAYMENTS_ENABLED ? 'Complément' : 'Complément historique'} :{' '}
            {formatPriceWithCurrency(cashTopUp.amount / 100).replace(
              / /g,
              '\u00A0',
            )}{' '}
            · {PAYMENTS_ENABLED ? 'À régler par' : 'Payeur prévu'} : {payer.replace(/\.+$/, '')}.
          </Text>
        </View>
      )}
    </View>
  );
});
const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg },
  eyebrow: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.foregroundSecondary,
  },
  statusTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    lineHeight: 21,
    color: colors.foreground,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.foregroundSecondary,
  },
  message: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.none,
    padding: spacing.md,
    gap: spacing.sm,
  },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.labelUppercase, color: colors.foreground },
});
