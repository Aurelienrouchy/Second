import {StyleSheet, ScrollView, View} from 'react-native';
import {useRouter} from 'expo-router';
import {useQuery} from '@tanstack/react-query';
import {readScopedQuery} from '@/utils/readScopedQuery';
import {Button, Caption, Text, ScreenHeader} from '@/components/ui';
import {AccountErasureStatus} from '@/features/account';
import {useAccountErasureRecovery} from '@/hooks/useAccountErasureRecovery';
import {AccountErasureService} from '@/services/accountErasureService';
import {isAccountErasureAttempt} from '@/types/accountErasure';
import {colors, spacing} from '@/constants/theme';

/** Public route; its only remote operation observes the device's secure
 * capability. No creation, resumption or provider authorization is sent here. */
export default function AccountDeletionTrackingScreen() {
  const router = useRouter(), local = useAccountErasureRecovery(), attempt = local.attempt;
  const observation = useQuery({
    queryKey: ['account-erasure-observation', attempt && ('commandId' in attempt ? attempt.commandId : attempt.recoveryId), local.contextKey],
    queryFn: ({signal}) => readScopedQuery(signal, () => local.capture().assertCurrent, assertCurrent => {
      if (!attempt) throw new Error('Suivi indisponible sur cet appareil.');
      return isAccountErasureAttempt(attempt) ? AccountErasureService.observe(attempt, assertCurrent)
        : AccountErasureService.observeRecovery(attempt, assertCurrent);
    }),
    enabled: local.ready && attempt?.phase === 'submitted', staleTime: 0, gcTime: 0, retry: false,
    refetchOnReconnect: false, refetchOnWindowFocus: false,
  });
  const receipt = local.ready && attempt ? observation.data?.receipt ?? (isAccountErasureAttempt(attempt) ? attempt.receipt : null) : null;
  return (
    <View style={styles.container} testID="account-erasure-public-tracking">
      <ScreenHeader title="Suivi de suppression" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text variant="h2">Votre demande de suppression</Text>
        <Caption>Ce suivi permet de vérifier une demande déjà envoyée depuis cet appareil, même après la fermeture de l’accès au compte.</Caption>
        {!local.ready && !local.error && <Caption>Lecture du suivi sécurisé…</Caption>}
        {local.error && <><Caption>Le suivi sécurisé ne peut pas être relu pour le moment.</Caption><Button variant="secondary" onPress={() => {void local.refresh();}}>Relire le suivi sur cet appareil</Button></>}
        {local.ready && !attempt && <Caption>Aucun suivi éligible n’est disponible dans la session actuelle sur cet appareil.</Caption>}
        {local.ready && attempt?.phase === 'prepared' && <Caption>Une intention est préparée sur cet appareil. Son envoi au serveur n’est pas confirmé.</Caption>}
        {receipt && <AccountErasureStatus receipt={receipt} />}
        {local.ready && attempt?.phase === 'submitted' && !receipt && <Caption>Le résultat reste à vérifier. Ce suivi n’envoie aucune nouvelle demande de suppression.</Caption>}
        {local.ready && attempt?.phase === 'submitted' && <Button variant="secondary" loading={observation.isFetching}
          onPress={() => {void observation.refetch();}}>Vérifier l’avancement</Button>}
        {local.ready && observation.isError && <Caption>Le serveur ne confirme pas un nouvel état pour le moment. La même intention est conservée ; aucune nouvelle suppression n’a été envoyée.</Caption>}
        {local.ready && local.uid && attempt && <Button variant="secondary" onPress={() => router.push('/settings/erase-account' as never)}>Ouvrir les étapes de cette demande</Button>}
        <Caption>Les données ordinaires sont effacées pendant le traitement. Une preuve privée minimale d’un accord local terminé peut être conservée au plus trois ans pour la défense de droits. Les éléments nécessaires à un dossier ouvert sont limités à ce dossier et réexaminés sous 30 jours.</Caption>
        <Caption>Une réponse ou un point d’avancement est fourni dans les 30 jours. Ce délai de suivi ne confirme pas l’achèvement d’un dossier encore ouvert.</Caption>
        <Button variant="muted" onPress={() => router.push('/legal/privacy-policy' as never)}>Politique de confidentialité</Button>
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({container: {flex: 1, backgroundColor: colors.background},
  content: {padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md}});
