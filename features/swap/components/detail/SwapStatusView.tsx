import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui';
import SwapItemCard from '../shared/SwapItemCard';
import { SwapComparisonLayout } from '../shared/SwapComparisonLayout';
import { SwapValueTotals } from '../shared/SwapValueTotals';
import { colors, fonts, spacing, radius, typography } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { formatDisplayName } from '@/utils/formatName';
import { SwapItemInfo, SwapStatus } from '@/types';
import { getSwapStatusLabel } from '../../presentation';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';

const CAPTIONS: Partial<Record<SwapStatus, string>> = {
  completed: 'La réception des articles a été confirmée par les deux membres.',
};
interface SwapStatusViewProps {
  status: SwapStatus;
  senderName: string;
  senderImage: string | undefined;
  senderItems: SwapItemInfo[];
  myItems: SwapItemInfo[];
  /** Stored amount in cents, retained for existing callers. */
  cashTopUpAmount: number | undefined;
  isInitiator?: boolean;
  nextStep?: string;
  cashTopUpPayer?: 'you' | 'other' | 'unknown';
  swapId?: string;
  acceptedAgreement?: boolean;
  articlePrivacyWithdrawals?: Record<string, unknown>;
}
export const SwapStatusView = React.memo(function SwapStatusView({
  status,
  senderName,
  senderItems,
  myItems,
  cashTopUpAmount,
  isInitiator = false,
  nextStep,
  cashTopUpPayer = 'unknown',
  swapId,
  acceptedAgreement = false,
  articlePrivacyWithdrawals,
}: SwapStatusViewProps) {
  // Recreate native text measurements when Dynamic Type changes on this mounted screen.
  const { fontScale } = useWindowDimensions();
  const name = formatDisplayName(senderName);
  const payer =
    cashTopUpPayer === 'you'
      ? 'Vous'
      : cashTopUpPayer === 'other'
        ? name
        : 'Payeur à confirmer';
  return (
    <View key={fontScale} style={styles.content}>
      <View style={styles.status}>
        <Ionicons
          name={
            status === 'completed'
              ? 'checkmark-circle-outline'
              : status === 'disputed'
                ? 'alert-circle-outline'
                : 'swap-horizontal-outline'
          }
          size={24}
          color={colors.primary}
        />
        <View style={styles.info}>
          <Text style={styles.statusTitle}>
            {getSwapStatusLabel(status, isInitiator)}
          </Text>
          {!!(nextStep || CAPTIONS[status]) && (
            <Text style={styles.body}>{nextStep || CAPTIONS[status]}</Text>
          )}
        </View>
      </View>
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
                swapId={swapId}
                acceptedAgreement={acceptedAgreement}
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
                swapId={swapId}
                acceptedAgreement={acceptedAgreement}
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
      {!!cashTopUpAmount && (
        <View style={styles.legacy}>
          <Text style={styles.body}>
            {PAYMENTS_ENABLED ? 'Complément' : 'Complément historique'} :{' '}
            {formatPriceWithCurrency(cashTopUpAmount / 100).replace(
              / /g,
              '\u00A0',
            )}{' '}
            · {PAYMENTS_ENABLED ? 'Payeur' : 'Payeur prévu'} : {payer.replace(/\.+$/, '')}.
          </Text>
        </View>
      )}
    </View>
  );
});
const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg },
  status: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.none,
  },
  info: { flex: 1, minWidth: 0, gap: spacing.xs },
  statusTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    lineHeight: 22,
    color: colors.foreground,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.foregroundSecondary,
  },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.labelUppercase, color: colors.foreground },
  legacy: {
    backgroundColor: colors.surfaceWarm,
    borderRadius: radius.none,
    padding: spacing.md,
  },
});
