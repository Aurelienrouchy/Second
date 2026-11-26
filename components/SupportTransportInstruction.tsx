import { StyleSheet, Text, View } from 'react-native';
import { APP_LOCALE } from '@/constants/locale';
import { colors, spacing, typography } from '@/constants/theme';
import type { SupportTransportInstruction as Instruction, TransportInstructionType } from '@/types/supportRequest';

export const TRANSPORT_INSTRUCTION_LABELS: Record<TransportInstructionType, string> = {return: 'Instruction de retour', retain: 'Instruction de conservation', regularisation_review: 'Examen d’une régularisation'};
export function SupportTransportInstruction({instruction}: {instruction: Instruction}) {
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.title}>{TRANSPORT_INSTRUCTION_LABELS[instruction.type]}</Text>
    <Text selectable style={styles.body}>{instruction.ownerMessage}</Text>
    <Text selectable style={styles.body}>Motivation consignée : {instruction.reason}</Text>
    <Text style={styles.caption}>Consignée le {new Date(instruction.recordedAt).toLocaleString(APP_LOCALE)}. Elle porte sur l’observation liée au dossier au moment de cet enregistrement.</Text>
    <Text style={styles.caption}>Il s’agit d’une instruction documentaire. Elle ne prouve ni possession, retour effectué, crédit bancaire ou examen exhaustif. Elle n’autorise aucun paiement, redébit ni remise en vente. Une régularisation demande un examen séparé.</Text>
    {instruction.source.kind === 'return_to_sender_report' ? <Text style={styles.caption}>Cette instruction porte sur un récit de retour à l’expéditeur non vérifié. Elle ne certifie ni contenu, coût, faute ou possibilité d’interception et ne lève aucune garde de la commande.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({section: {gap: spacing.sm}, title: {...typography.body, color: colors.foreground},
  body: {...typography.bodySmall, color: colors.foreground}, caption: {...typography.caption, color: colors.muted}});
