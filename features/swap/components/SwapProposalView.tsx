import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui';
import SwapItemCard from '@/components/swap/SwapItemCard';
import { colors, fonts, spacing, radius } from '@/constants/theme';
import { formatPriceWithCurrency } from '@/utils/formatPrice';
import { formatDisplayName } from '@/utils/formatName';
import { SwapItemInfo } from '@/types';

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
}

export const SwapProposalView = React.memo(function SwapProposalView({
  senderName, senderImage, message, senderItems, myItems, cashTopUp,
  isInitiator = false, currentUserId, otherUserId,
}: SwapProposalViewProps) {
  const name = formatDisplayName(senderName);
  const payer = cashTopUp?.payerId === currentUserId ? 'Vous' : cashTopUp?.payerId === otherUserId ? name : 'Payeur à confirmer';
  return (
    <View style={styles.content}>
      <View style={styles.member}>
        {senderImage ? <Image source={{ uri: senderImage }} style={styles.avatar} contentFit="cover" /> : <View style={styles.avatarFallback}><Ionicons name="person-outline" size={22} color={colors.foregroundSecondary} /></View>}
        <View style={styles.memberInfo}>
          <Text style={styles.eyebrow}>Échange avec</Text>
          <Text style={styles.name}>{name}</Text>
        </View>
      </View>
      <View style={styles.status}>
        <Ionicons name={isInitiator ? 'paper-plane-outline' : 'mail-outline'} size={20} color={colors.primary} />
        <View style={styles.memberInfo}>
          <Text style={styles.statusTitle}>{isInitiator ? 'Proposition envoyée' : 'Proposition reçue'}</Text>
          <Text style={styles.body}>{isInitiator ? 'Vous attendez la réponse du membre.' : 'Découvrez les articles proposés, puis choisissez votre réponse.'}</Text>
        </View>
      </View>
      {!!message && <View style={styles.message}><Text style={styles.eyebrow}>{isInitiator ? 'Votre message' : `Message de ${name}`}</Text><Text style={styles.body}>{message}</Text></View>}
      <View style={styles.section} testID="swap-given-items">
        <Text style={styles.sectionTitle}>Vous donnez</Text>
        {myItems.map((item, index) => <SwapItemCard key={`${item.articleId}-${index}`} item={item} variant="mine" />)}
      </View>
      <View style={styles.section} testID="swap-received-items">
        <Text style={styles.sectionTitle}>Vous recevez</Text>
        {senderItems.map((item, index) => <SwapItemCard key={`${item.articleId}-${index}`} item={item} variant="their" />)}
      </View>
      {!!cashTopUp?.amount && <View style={styles.message}><Text style={styles.body}>Complément historique : {formatPriceWithCurrency(cashTopUp.amount / 100).replace(/ /g, '\u00A0')} · Payeur prévu : {payer.replace(/\.+$/, '')}.</Text></View>}
    </View>
  );
});
const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.lg },
  member: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.surfaceWarm },
  avatarFallback: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.surfaceWarm, alignItems: 'center', justifyContent: 'center' },
  memberInfo: { flex: 1, minWidth: 0, gap: spacing.xs },
  eyebrow: { fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 17, color: colors.foregroundSecondary },
  name: { fontFamily: fonts.sansMedium, fontSize: 16, lineHeight: 23, color: colors.foreground },
  status: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, backgroundColor: colors.surfaceWarm, borderRadius: radius.xl },
  statusTitle: { fontFamily: fonts.sansMedium, fontSize: 14, lineHeight: 21, color: colors.foreground },
  body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 22, color: colors.foregroundSecondary },
  message: { backgroundColor: colors.surfaceWarm, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm },
  section: { gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.displayMedium, fontSize: 26, lineHeight: 31, color: colors.foreground },
});
