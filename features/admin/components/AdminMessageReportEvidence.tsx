import {useLayoutEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui';
import {colors, spacing, typography} from '@/constants/theme';
import {useAuthenticatedUid} from '@/hooks/useAuth';
import {useLabelLifecycleContext} from '@/hooks/useLabelLifecycleContext';
import {MessageReportService} from '@/services/messageReportService';
import {getAuthSessionGeneration} from '@/store/authStore';
import {AdminFinancialReauthentication} from './AdminFinancialReauthentication';
const exposure = (value: string) => value === 'declared_yes' ? 'oui, déclaré' : value === 'declared_no' ? 'non, déclaré' : 'inconnu';
export function AdminMessageReportEvidence({reportId, reportRevision}: {reportId: string; reportRevision: string}) {
  const uid = useAuthenticatedUid(), frame = useLabelLifecycleContext(JSON.stringify(['admin-message-evidence', reportId, reportRevision]), uid);
  const key = JSON.stringify([uid, getAuthSessionGeneration(), reportId, reportRevision, frame.focusRevision]);
  const interaction = useRef(0), [requestEpoch, setRequestEpoch] = useState(0), [verified, setVerified] = useState<string | null>(null);
  const current = useRef(key); useLayoutEffect(() => {current.current = key;}, [key]);
  const query = useQuery({queryKey: ['admin-message-native-evidence', key], enabled: !!uid && frame.focused && verified === key,
    staleTime: 0, gcTime: 0, retry: false, queryFn: () => {const op = frame.capture(), epoch = interaction.current; return MessageReportService.readEvidence(uid!, reportId, () => {frame.assertCurrent(op); if (current.current !== key || interaction.current !== epoch) throw new Error('Relisez la capture depuis le dossier actuel.');});}});
  const evidence = frame.focused && verified === key && query.isSuccess && !query.isFetching && !query.isError ? query.data : null;
  const content = evidence?.qualification === 'native_capture' ? evidence.source : null;
  return <View style={styles.card}>
    <Text style={styles.title}>Preuve privée du message exact</Text>
    <Text style={styles.body}>Le texte original n’est lu qu’après une confirmation récente de votre identité et une nouvelle autorisation serveur. Les déclarations de lien ouvert, de renseignements partagés et de paiement externe restent distinctes d’une faute, d’un remboursement ou d’une récupération.</Text>
    {uid ? <AdminFinancialReauthentication key={key} uid={uid} sourceKey={key} purpose="moderation" disabled={!frame.focused || query.isFetching} onVerified={() => {
      if (current.current !== key || interaction.current !== requestEpoch) return; try {frame.capture(); interaction.current++; setRequestEpoch(interaction.current); setVerified(key);} catch { /* No stale private admission. */ }
    }} /> : null}
    {verified === key ? <Button variant="secondary" disabled={!frame.focused || query.isFetching} onPress={() => {try {frame.capture(); interaction.current++; setRequestEpoch(interaction.current); void query.refetch();} catch { /* Private read stays qualified. */ }}}>Relire cette capture privée</Button> : null}
    {query.isFetching && verified === key ? <Text style={styles.body}>Qualification du dossier privé…</Text> : query.isError && verified === key ? <Text accessibilityRole="alert" style={styles.body}>La capture ne peut pas être lue avec cette autorisation. Le message actuel ne remplace pas l’original.</Text> : null}
    {evidence?.qualification === 'unknown' ? <Text style={styles.body}>Aucune capture native qualifiée ne peut être établie pour ce signalement historique. Cela ne prouve pas l’absence des faits allégués.</Text> : content && evidence ? <>
      <Text style={styles.title}>Contenu du membre conservé lors du signalement</Text>
      <Text selectable style={styles.body}>{content.message.content ?? content.message.offer?.message ?? 'Aucun texte dans cette capture.'}</Text>
      {content.message.type === 'image' ? <Text style={styles.body}>Une référence d’image figurait dans ce message. Ce protocole ne certifie pas la conservation des pixels ni leur contenu ; aucune image actuelle ne remplace la capture native.</Text> : null}
      <Text selectable style={styles.caption}>Auteur membre : {content.message.senderId}{'\n'}Message : {content.messageId}{'\n'}Conversation : {content.chatId}{'\n'}Version signalée : {content.messageRevision}{'\n'}Capture : {evidence.capturedAt}{'\n'}Empreinte : {evidence.sourceHash}</Text>
      <Text style={styles.body}>Source actuelle : {evidence.sourceCurrentQualification === 'same_native_source' ? 'même source native observée' : evidence.sourceCurrentQualification === 'changed' ? 'source modifiée depuis la capture' : 'inconnue ou indisponible'}. L’original reste affiché séparément.</Text>
      {evidence.exposure ? <><Text style={styles.body}>Lien ouvert : {exposure(evidence.exposure.linkOpened)}</Text><Text style={styles.body}>Renseignements partagés : {exposure(evidence.exposure.informationShared)}</Text><Text style={styles.body}>Paiement externe : {exposure(evidence.exposure.externalPaymentDeclared)}</Text></> : null}
      <Text style={styles.body}>{content.order.qualification === 'native_linked_order' ? `Commande reliée dans la capture : ${content.order.transactionId}. Cette relation n’atteste aucun paiement externe.` : 'Lien avec une commande non qualifié ou non demandé. Aucun lien n’est inféré du texte.'}</Text>
    </> : null}
  </View>;
}
const styles = StyleSheet.create({card: {gap: spacing.sm}, title: {...typography.h3, color: colors.foreground}, body: {...typography.bodySmall, color: colors.foregroundSecondary}, caption: {...typography.caption, color: colors.muted}});
