import {StyleSheet,Text,View} from 'react-native';
import {Button} from '@/components/ui';
import {colors,spacing,typography} from '@/constants/theme';
import {contentRecord} from '@/services/contentSafetyService';
import {CONTENT_REASON_LABELS,type ContentPreview} from '@/types/contentSafety';
const excerpt = (v: unknown) => typeof v === 'string' ? v.slice(0,40000) : 'Contenu non qualifié ou absent.';
export function ContentSafetyEvidence({value,onReadImage,working}: {value: ContentPreview; onReadImage?: () => void; working: boolean}) {
  const message = contentRecord(value.messageEvidence?.source) && contentRecord(value.messageEvidence.source.message) ? value.messageEvidence.source.message : null;
  const original = value.original ?? message ?? value.reportEvidence?.body ?? null;
  return <View style={styles.group}>
    <Text style={styles.title}>Contenu et références examinés</Text>
    <Text selectable style={styles.caption}>{value.targetType === 'review' ? 'Avis' : 'Message'} : {value.targetId}{'\n'}Signalement : {value.reportId ?? 'nouveau'}{'\n'}Source : {value.source.sourceHash}{'\n'}Lien natif : {value.source.parent ? `${value.source.parent.kind} · ${value.source.parent.id}` : 'inconnu'}{'\n'}Qualification : {value.source.qualification === 'native_content' ? 'source native actuelle' : 'inconnue'}</Text>
    <Text style={styles.body}>Contenu actuel</Text><Text selectable style={styles.body}>{value.current?.contentModeration && contentRecord(value.current.contentModeration) && value.current.contentModeration.state !== 'visible' || value.current?.state === 'hidden' ? 'Contenu masqué.' : excerpt(value.current?.text ?? value.current?.content)}</Text>
    {value.report ? <Text style={styles.body}>Allégation : {CONTENT_REASON_LABELS[value.report.reason as keyof typeof CONTENT_REASON_LABELS] ?? 'motif inconnu'} · urgence déclarée : {value.report.urgency === 'yes' ? 'oui' : value.report.urgency === 'no' ? 'non' : 'inconnue'}{'\n'}{value.report.description ?? 'Aucun détail accessible dans cette lecture.'}</Text> : null}
    {value.scope === 'admin' ? <>
      <Text style={styles.body}>Original privé conservé ou capture du signalement</Text><Text selectable style={styles.body}>{excerpt(original?.text ?? original?.content)}</Text>
      <Text style={styles.caption}>Original et contenu actuel sont distincts. Une source manquante ne prouve ni absence de menace ni faute. Les références d’image ne sont pas ouvertes automatiquement.</Text>
      {onReadImage && (contentRecord(original?.image) || value.current?.type === 'image') ? <Button variant="secondary" disabled={working} onPress={onReadImage}>Lire les pixels privés disponibles</Button> : null}
    </> : null}
    {value.currentDecision ? <Text style={styles.body}>Décision courante : {value.currentDecision.action} · {value.currentDecision.ownerMessage ?? 'aucun message communiqué'}{'\n'}{value.currentDecision.reference.id} · version {value.currentDecision.reference.version}</Text> : null}
    {value.selectedDecision ? <Text style={styles.body}>Décision historique sélectionnée : {value.selectedDecision.entry.action} · {value.selectedDecision.entry.ownerMessage ?? 'aucun message communiqué'}{'\n'}{value.selectedDecision.entry.reference.id} · version {value.selectedDecision.entry.reference.version}. Elle ne remplace pas la décision courante.</Text> : null}
    <Text style={styles.caption}>Une mauvaise note seule ne justifie pas un retrait. Cet examen ne décide ni remboursement ni sanction de compte. Les copies déjà reçues ne sont pas effacées ; la révocation des liens d’image reste inconnue.</Text>
    <Text style={styles.caption}>Retrait des accès média gérés : {value.mediaWithdrawal.state==='observed_revoked'?'révocation observée sur les objets qualifiés':value.mediaWithdrawal.state==='not_required'?'non requis pour ce contenu':value.mediaWithdrawal.state==='pending'?'en cours':value.mediaWithdrawal.state==='needs_review'?'rapprochement requis':'inconnu'} · objets gérés : {value.mediaWithdrawal.managedObjectCount??'inconnu'} · conservés en privé : {value.mediaWithdrawal.privatelyPreservedCount??'inconnu'} · révoqués : {value.mediaWithdrawal.revokedObjectCount??'inconnu'}. Les URL externes et les copies reçues ne sont pas effacées par cette observation. Un rétablissement ne réactive pas les anciens accès par lien.</Text>
  </View>;
}
const styles = StyleSheet.create({group:{gap:spacing.sm},title:{...typography.h3,color:colors.foreground},body:{...typography.bodySmall,color:colors.foregroundSecondary},caption:{...typography.caption,color:colors.muted}});
