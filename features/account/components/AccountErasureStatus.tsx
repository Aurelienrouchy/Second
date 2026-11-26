import {StyleSheet, View} from 'react-native';
import {Text, Caption} from '@/components/ui';
import {colors, spacing, radius} from '@/constants/theme';
import type {AccountErasureReceipt, AccountErasureState} from '@/types/accountErasure';

const copy: Record<AccountErasureState, {title: string; body: string}> = {
  requested: {title: 'Demande enregistrée', body: 'Votre demande de suppression est reçue. Son traitement reste à terminer.'},
  inspecting: {title: 'Vérifications en cours', body: 'Les données du compte et les engagements existants sont en cours de vérification.'},
  awaiting_obligations: {title: 'Engagements à finaliser', body: 'La demande est conservée pendant la finalisation des engagements existants. La suppression n’est pas terminée.'},
  awaiting_review: {title: 'Examen en cours', body: 'Des éléments nécessitent un examen ciblé avant de poursuivre. La suppression n’est pas terminée.'},
  awaiting_apple_authorization: {title: 'Autorisation Apple à confirmer', body: 'Une nouvelle autorisation Apple est nécessaire pour poursuivre cette même demande.'},
  erasing: {title: 'Effacement en cours', body: 'L’effacement des données prévu par cette demande est en cours.'},
  auth_deletion_pending: {title: 'Dernières vérifications en cours', body: 'La suppression de l’accès au compte et les étapes requises restent à confirmer.'},
  completed: {title: 'Suppression traitée', body: 'Le serveur confirme l’achèvement des étapes requises et la suppression de l’accès au compte. Les conservations minimales prévues ci-dessous restent distinctes.'},
  needs_attention: {title: 'Une étape reste à vérifier', body: 'La demande est conservée. Une action ou une vérification reste nécessaire avant sa fin.'},
  not_executed: {title: 'Demande non exécutée', body: 'Cette intention n’a pas produit une suppression complète. Relisez sa situation avant de poursuivre.'},
};

export function AccountErasureStatus({receipt}: {receipt: AccountErasureReceipt}) {
  const message = copy[receipt.state];
  return (
    <View style={styles.card} accessibilityRole="alert" testID="account-erasure-status">
      <Text variant="h2">{message.title}</Text>
      <Caption>{message.body}</Caption>
      <Caption>{receipt.progress.completedSteps} étape(s) confirmée(s) sur {receipt.progress.totalSteps}.</Caption>
      <Caption>{receipt.accountAccessClosed ? 'L’accès au compte est fermé.' : 'La fermeture de l’accès au compte n’est pas encore confirmée.'}</Caption>
      {!receipt.deletionComplete && <Caption>Compte fermé et données effacées sont deux étapes distinctes. La fin de l’effacement n’est pas encore confirmée.</Caption>}
      <Caption>Dernier état confirmé : {new Date(receipt.updatedAt).toLocaleString('fr-CA')}.</Caption>
      {receipt.deletionComplete && receipt.observationExpiresAt && <Caption>Ce suivi reste disponible jusqu’au {new Date(receipt.observationExpiresAt).toLocaleDateString('fr-CA')}.</Caption>}
    </View>
  );
}
const styles = StyleSheet.create({card: {padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface,
  borderRadius: radius.sm, borderWidth: 1, borderColor: colors.borderLight}});
