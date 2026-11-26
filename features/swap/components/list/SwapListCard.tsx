import React from 'react';
import { StyleSheet, View, Pressable, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Text } from '@/components/ui';
import { getSwapItems } from '@/services/swapService';
import type { Swap } from '@/types';
import { getSwapStatusLabel, getSwapNextStep } from '../../presentation';
import { PAYMENTS_ENABLED } from '@/config/featureFlags';
import { APP_LOCALE } from '@/constants/locale';
import {
  colors,
  spacing,
  components,
  radius,
  typography,
  sizing,
} from '@/constants/theme';
import { formatDisplayName } from '@/utils/formatName';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { SwapItemPreview } from './SwapItemPreview';
export const SwapListCard = React.memo(function SwapListCard({
  swap,
  currentUserId,
  assertCanOpen,
}: {
  swap: Swap;
  currentUserId: string;
  assertCanOpen?: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stacked =
    width < components.troc.compactWidth ||
    fontScale > components.troc.largeFontScale;
  const isInitiator = swap.initiatorId === currentUserId;
  const name = formatDisplayName(
    isInitiator ? swap.receiverName : swap.initiatorName,
  );
  const image = isInitiator ? swap.receiverImage : swap.initiatorImage;
  const myItems = getSwapItems(swap, isInitiator ? 'initiator' : 'receiver');
  const theirItems = getSwapItems(swap, isInitiator ? 'receiver' : 'initiator');
  const label = getSwapStatusLabel(swap.status, isInitiator);
  const nextStep = getSwapNextStep(swap, currentUserId);
  const showNextStep =
    swap.status === 'payment_pending' ||
    swap.status === 'photos_pending' ||
    swap.status === 'shipping' ||
    (swap.status === 'accepted' && !swap.exchangeMode) ||
    (swap.status === 'completed' &&
      !(isInitiator ? swap.initiatorRating : swap.receiverRating));
  const otherId = isInitiator ? swap.receiverId : swap.initiatorId;
  const payer =
    swap.cashTopUp?.payerId === currentUserId
      ? 'Vous'
      : swap.cashTopUp?.payerId === otherId
        ? name
        : 'Payeur à confirmer';
  const date =
    swap.createdAt instanceof Date && Number.isFinite(swap.createdAt.getTime())
      ? swap.createdAt.toLocaleDateString(APP_LOCALE, {
          day: 'numeric',
          month: 'short',
        })
      : '';
  return (
    <Pressable
      style={({ pressed }) => [styles.swapCard, pressed && styles.pressed]}
      onPress={() => {
        try { assertCanOpen?.(); } catch { return; }
        router.push({
          pathname: '/swap/[id]',
          params: { id: swap.id, source: 'my_swaps' },
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={`Échange avec ${name.replace(/\.+$/, '')}. ${label}. ${nextStep}`}
    >
      <View style={styles.memberRow}>
        {image ? (
          <Image
            source={{ uri: image }}
            style={styles.avatar}
            contentFit="cover"
          />
        ) : (
          <View style={styles.avatar}>
            <Ionicons
              name="person-outline"
              size={sizing.iconSM}
              color={colors.foregroundSecondary}
            />
          </View>
        )}
        <View style={styles.memberInfo}>
          <Text style={styles.memberName}>{name}</Text>
          <Text style={styles.statusText}>
            {label}
            {date ? ` · ${date}` : ''}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={sizing.iconSM}
          color={colors.foregroundSecondary}
        />
      </View>
      {showNextStep && <Text style={styles.nextStep}>{nextStep}</Text>}
      <View style={[styles.previewRow, stacked && styles.previewStacked]}>
        <SwapItemPreview items={theirItems} label="Vous recevez" />
        <SwapItemPreview items={myItems} label="Vous proposez" />
      </View>
      {!!swap.cashTopUp?.amount && (
        <Text style={styles.caption}>
          {PAYMENTS_ENABLED ? 'Complément' : 'Complément historique'} :{' '}
          {formatPriceWithCurrency(swap.cashTopUp.amount / 100).replace(
            / /g,
            '\u00A0',
          )}{' '}
          · {PAYMENTS_ENABLED ? 'Payeur' : 'Payeur prévu'} : {payer.replace(/\.+$/, '')}.
        </Text>
      )}
    </Pressable>
  );
});
const styles = StyleSheet.create({
  swapCard: {
    backgroundColor: colors.background,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: components.troc.borderWidth,
    borderColor: colors.borderStrong,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: {
    width: sizing.minTouchTarget,
    height: sizing.minTouchTarget,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceWarm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { ...typography.label, color: colors.foreground },
  statusText: { ...typography.caption, color: colors.primaryDark },
  nextStep: { ...typography.bodySmall, color: colors.foregroundSecondary },
  previewRow: { flexDirection: 'row', gap: spacing.md },
  previewStacked: { flexDirection: 'column' },
  caption: { ...typography.caption, color: colors.foregroundSecondary },
  pressed: { opacity: components.troc.pressedOpacity },
});
