import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import type { Transaction } from '@/types/transaction';
import { getRefundPresentation, hasBankObligation } from '@/utils/refundPresentation';

export function RefundStatusNotice({transaction, perspective}: {transaction: Transaction; perspective: 'buyer' | 'seller' | 'admin'}) {
  const router = useRouter();
  const refund = getRefundPresentation(transaction, perspective);
  const bank = hasBankObligation(transaction);
  if (!refund && !bank) return null;
  return <View style={styles.container}>
    <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.title}>{refund?.title ?? 'Dossier bancaire à examiner'}</Text>
    <Text style={styles.body}>{refund?.message ?? 'Un dossier bancaire reste ouvert ou nécessite une vérification. Contactez notre équipe.'}</Text>
    {refund?.lines.map(line => <Text key={line} style={styles.body}>{line}</Text>)}
    {bank && refund && <Text style={styles.body}>Un dossier bancaire nécessite aussi une vérification. Sa clôture est distincte du remboursement.</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel="Contacter l’équipe" style={styles.link} onPress={() => router.push('/settings/help')}>
      <Ionicons name="help-circle-outline" size={20} color={colors.foreground} />
      <Text style={styles.linkText}>Contacter l’équipe</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  container: {padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surfaceWarm, borderRadius: radius.md},
  title: {fontFamily: fonts.sansMedium, color: colors.foreground},
  body: {fontFamily: fonts.sans, color: colors.foreground},
  link: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm},
  linkText: {fontFamily: fonts.sansMedium, color: colors.foreground},
});
