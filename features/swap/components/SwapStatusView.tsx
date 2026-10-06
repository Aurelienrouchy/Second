import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui';
import SwapItemCard from '@/components/swap/SwapItemCard';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { formatDisplayName } from '@/utils/formatName';
import { SwapItemInfo, SwapStatus } from '@/types';
import { getSwapStatusLabel } from '../presentation';

const CAPTIONS: Partial<Record<SwapStatus, string>> = {
  expired: 'Cet échange n’est plus actif.',
  disputed: 'Un litige a été ouvert pour cet échange.',
  declined: 'Cette proposition a été refusée.',
  cancelled: 'Cet échange a été annulé.',
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
}
export const SwapStatusView = React.memo(function SwapStatusView({
  status, senderName, senderImage, senderItems, myItems, cashTopUpAmount,
  isInitiator = false, nextStep, cashTopUpPayer = 'unknown',
}: SwapStatusViewProps) {
  const name = formatDisplayName(senderName);
  const payer = cashTopUpPayer === 'you' ? 'Vous' : cashTopUpPayer === 'other' ? name : 'Payeur à confirmer';
  return (
    <View style={styles.content}>
      <View style={styles.status}>
        <Ionicons name={status === 'completed' ? 'checkmark-circle-outline' : status === 'disputed' ? 'alert-circle-outline' : 'swap-horizontal-outline'} size={24} color={colors.primary} />
        <View style={styles.info}>
          <Text style={styles.statusTitle}>{getSwapStatusLabel(status, isInitiator)}</Text>
          {!!(nextStep || CAPTIONS[status]) && <Text style={styles.body}>{nextStep || CAPTIONS[status]}</Text>}
        </View>
      </View>
      <View style={styles.member}>
        {senderImage ? <Image source={{ uri: senderImage }} style={styles.avatar} contentFit="cover" /> : <View style={styles.avatar}><Ionicons name="person-outline" size={22} color={colors.foregroundSecondary} /></View>}
        <View style={styles.info}><Text style={styles.eyebrow}>Échange avec</Text><Text style={styles.name}>{name}</Text></View>
      </View>
      <View style={styles.section}><Text style={styles.sectionTitle}>Vous donnez</Text>{myItems.map((item, index) => <SwapItemCard key={`${item.articleId}-${index}`} item={item} variant="mine" />)}</View>
      <View style={styles.section}><Text style={styles.sectionTitle}>Vous recevez</Text>{senderItems.map((item, index) => <SwapItemCard key={`${item.articleId}-${index}`} item={item} variant="their" />)}</View>
      {!!cashTopUpAmount && <View style={styles.legacy}><Text style={styles.body}>Complément historique : {formatPriceWithCurrency(cashTopUpAmount / 100).replace(/ /g, '\u00A0')} · Payeur prévu : {payer.replace(/\.+$/, '')}.</Text></View>}
    </View>
  );
});
const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg },
  status: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceWarm, borderRadius: radius.xl },
  info: { flex: 1, minWidth: 0, gap: spacing.xs },
  statusTitle: { fontFamily: fonts.sansMedium, fontSize: 15, lineHeight: 22, color: colors.foreground },
  body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 22, color: colors.foregroundSecondary },
  member: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.surfaceWarm, justifyContent: 'center', alignItems: 'center' },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 17, color: colors.foregroundSecondary },
  name: { fontFamily: fonts.sansMedium, fontSize: 16, lineHeight: 23, color: colors.foreground },
  section: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.displayMedium, fontSize: 26, lineHeight: 31, color: colors.foreground },
  legacy: { backgroundColor: colors.surfaceWarm, borderRadius: radius.xl, padding: spacing.md },
});
